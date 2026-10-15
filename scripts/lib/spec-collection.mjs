/**
 * Which Playwright config collects which browser spec, and whether CI runs it.
 *
 * Every browser suite in this repository is a Playwright config, and every
 * config decides for itself which spec files are its own: the public config
 * takes every `*.spec.js` except a list it ignores, and each of the others
 * names its files by pattern. Nothing tied those decisions together, and the
 * gap has already cost a run: four `detail-*` specs were added without an entry
 * in the public config's ignore list, the public job collected them, and they
 * failed against an API that job deliberately never starts. The reverse is
 * quieter and worse. A spec that no CI-run config collects is never run at all,
 * and a green run says nothing about it; the accessibility sweep's own header
 * warns that a new file would land in exactly that gap.
 *
 * So `ci:check` proves it instead. For each browser job in the CI matrix it
 * follows the job's `script` to the root `package.json`, from there to the web
 * package's script, and from there to the `--config` that script runs. It then
 * matches every file under `apps/web/e2e` that Playwright could load against
 * each config's `testMatch` and `testIgnore` the way Playwright does, and
 * requires exactly one CI job per spec — a spec being any file a CI config
 * collects or any file named as a test, so `detail-x.spec.mjs` cannot slip past
 * by its extension. It also refuses a config no job runs, a job whose script or
 * config narrows it to fewer files or cases, a spec or support module that
 * skips or focuses a case, and a browser job whose check is not required on
 * `main`.
 *
 * Nothing here reads a file, imports a config or decides an exit code — that is
 * the checker's job, and keeping it there is what lets every rule below be
 * tested with plain objects, without loading Playwright into Vitest.
 *
 * Wherever a construct cannot be read with certainty, the answer is a failure
 * that says so, never a pass: a `testMatch` written as a regular expression, a
 * script this reader cannot parse, a path Node's glob matcher would read
 * differently from Playwright's. An invariant that passed on what it could not
 * see would be the green run it exists to distrust.
 *
 * @module scripts/lib/spec-collection
 */

import path from 'node:path'

/**
 * A construct this module cannot verify, and so refuses rather than assumes.
 */
export class Unverifiable extends Error {
  /**
   * @param {string} message What could not be verified, and why.
   */
  constructor(message) {
    super(message)
    this.name = 'Unverifiable'
  }
}

/** The file Playwright loads when a script names no `--config`. */
export const DEFAULT_CONFIG = 'playwright.config.js'

/**
 * Playwright's own `testMatch` when a config sets none.
 *
 * Copied from Playwright's config loader, so that a config relying on the
 * default is judged by the default Playwright would apply.
 */
export const DEFAULT_TEST_MATCH = '**/*.@(spec|test).?(c|m)[jt]s?(x)'

/**
 * A variable that narrows a config to fewer spec files.
 *
 * `playwright.detail.config.js` reads `DETAIL_E2E_SPEC` so that one detail
 * surface can be run on its own locally. A CI job that set it would run one
 * spec and report the whole suite green.
 */
export const NARROWING_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*_E2E_SPEC$/u

/** Anywhere a workflow could set a narrowing variable. */
const NARROWING_MENTION = /\b[A-Za-z_][A-Za-z0-9_]*_E2E_SPEC\b/gu

/** The chain Playwright's modifiers hang off: `test`, `test.describe`, `test.describe.serial`… */
const TEST_CHAIN = String.raw`\b(?:test|it|describe)(?:\.describe)?(?:\.(?:serial|parallel))?`

/**
 * Calls that make a spec report something other than what ran.
 *
 * A skipped or `fixme` case is counted by nobody, an expected failure passes
 * when the thing it covers is broken, and a focused case or group silently
 * drops every other case in the run. The configs set `forbidOnly` in CI, which
 * catches `.only` at run time; this catches all four before a runner starts.
 *
 * The named forms come first, so the message says which one it was. The last
 * forms catch everything else that reaches the same modifiers: a `.skip`,
 * `.fixme` or `.fail` on any receiver — `test.step.skip`, or the test-info
 * fixture under whatever name a callback gives it — the same members read by
 * string or destructured, and a static annotation whose type Playwright treats
 * as a skip. A member is reported whether or not it is called on that line, so
 * `const later = test.skip` is found too. When in doubt, this reports.
 *
 * Every pattern is global and ends where the member it found ends, so a place
 * the named forms have already reported is not reported again by a later one.
 *
 * @type {ReadonlyArray<{call: string|function(RegExpExecArray): string, pattern: RegExp}>}
 */
export const FORBIDDEN_CALLS = Object.freeze([
  { call: 'test.skip(', pattern: new RegExp(`${TEST_CHAIN}\\??\\.skip\\b`, 'gu') },
  { call: 'test.fixme(', pattern: new RegExp(`${TEST_CHAIN}\\??\\.fixme\\b`, 'gu') },
  { call: 'test.fail(', pattern: new RegExp(`${TEST_CHAIN}\\??\\.fail\\b`, 'gu') },
  { call: 'test.step.skip(', pattern: /\btest\??\.step\??\.skip\b/gu },
  { call: 'testInfo.skip(', pattern: /\b(?:testInfo|info\(\))\??\.(?:skip|fixme|fail)\b/gu },
  { call: '.only(', pattern: /\??\.only\b/gu },
  {
    call: (match) => `${match[1]}.${match[2]}(`,
    pattern: /([\w$]+(?:\(\))?)\??\.(skip|fixme|fail)\b/gu,
  },
  {
    call: (match) => `[${match[1]}${match[2]}${match[1]}]`,
    pattern: /\[\s*(['"`])(skip|fixme|fail|only)\1\s*\]/gu,
  },
  {
    call: (match) => `{ ${match[1]} } =`,
    pattern: /\{[^{}]*?\b(skip|fixme|fail|only)\b[^{}]*\}\s*=(?![=>])/gu,
  },
  {
    call: (match) => `an annotation of type '${match[2]}'`,
    pattern: /\btype\s*:\s*(['"`])(skip|fixme|fail)\1/gu,
  },
])

/** Shell operators that sequence commands, each of which then runs. */
const SEQUENCE = new Set(['&&', ';'])

/**
 * Split a package script into words and operators, the way a shell would.
 *
 * Small on purpose, and failing closed. It keeps quoted strings and `$(…)`
 * substitutions whole — `ORGANIZER_E2E_TAG=e2e$(date +%s)` is one word — and
 * reports anything unbalanced rather than guessing where a word ends.
 *
 * @param {string} command The script.
 * @returns {Array<string|{operator: string}>} Words, and operators between them.
 */
function tokenize(command) {
  const tokens = []
  let current = ''
  let started = false
  let quote = null
  let depth = 0

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote !== null) {
      current += character
      if (character === quote) quote = null
      continue
    }

    if (depth > 0) {
      current += character
      if (character === '(') depth += 1
      else if (character === ')') depth -= 1
      continue
    }

    if (character === '\\') {
      current += character + (command[index + 1] ?? '')
      index += 1
      started = true
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
      started = true
      continue
    }

    if (character === '$' && command[index + 1] === '(') {
      depth = 1
      current += '$('
      index += 1
      started = true
      continue
    }

    if (/\s/u.test(character)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }

    if (character === ';' || character === '&' || character === '|') {
      if (started) tokens.push(current)
      current = ''
      started = false

      let operator = character
      if (character !== ';' && command[index + 1] === character) {
        operator += character
        index += 1
      }

      tokens.push({ operator })
      continue
    }

    current += character
    started = true
  }

  if (quote !== null || depth > 0) {
    throw new Unverifiable(`"${command}" has unbalanced quoting, so its words cannot be read`)
  }

  if (started) tokens.push(current)

  return tokens
}

/**
 * A word with one layer of matching quotes taken off.
 *
 * @param {string} word The word.
 * @returns {string} Its value.
 */
function unquoted(word) {
  const match = word.match(/^(['"])(.*)\1$/su)

  return match ? match[2] : word
}

/**
 * Split a script into the commands it runs one after another.
 *
 * Only `&&` and `;` are understood. A pipe or a background `&` changes what a
 * failure means, and `||` may not run the command at all, so each is refused.
 *
 * @param {string} command The script.
 * @returns {string[][]} Each command's words.
 */
function commandsOf(command) {
  const commands = [[]]

  for (const token of tokenize(command)) {
    if (typeof token === 'string') {
      commands[commands.length - 1].push(token)
      continue
    }

    if (!SEQUENCE.has(token.operator)) {
      throw new Unverifiable(
        `"${command}" uses "${token.operator}", which this check cannot follow — ` +
          'only "&&" and ";" between commands can be proved to run each one',
      )
    }

    commands.push([])
  }

  return commands.filter((words) => words.length > 0)
}

/**
 * Whether a word is a leading `NAME=value` assignment.
 *
 * @param {string} word The word.
 * @returns {string|null} The variable's name, or null.
 */
function assignedName(word) {
  const match = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=/u)

  return match ? match[1] : null
}

/**
 * The web package script a root script delegates to.
 *
 * Every browser job's script is `pnpm --filter <web> [run] <name>` and nothing
 * else. Anything longer could pass arguments through to Playwright, and a
 * shape this reader does not know is refused rather than read loosely.
 *
 * @param {string} command The root script.
 * @param {string} webPackage The web package's name.
 * @returns {string} The name of the web script it runs.
 */
function delegatedScript(command, webPackage) {
  const commands = commandsOf(command)

  if (commands.length !== 1) {
    throw new Unverifiable(`"${command}" is not a single "pnpm --filter ${webPackage}" command`)
  }

  const words = commands[0].map(unquoted)

  if (words[0] !== 'pnpm') {
    throw new Unverifiable(`"${command}" does not delegate to ${webPackage} through pnpm`)
  }

  let index = 1
  let filter = null

  if (words[index] === '--filter' || words[index] === '-F') {
    filter = words[index + 1]
    index += 2
  } else if (words[index]?.startsWith('--filter=')) {
    filter = words[index].slice('--filter='.length)
    index += 1
  }

  if (filter !== webPackage) {
    throw new Unverifiable(`"${command}" does not filter to ${webPackage}`)
  }

  if (words[index] === 'run') index += 1

  const name = words[index]

  if (name === undefined || words.length !== index + 1) {
    throw new Unverifiable(
      `"${command}" does not name exactly one ${webPackage} script and nothing else`,
    )
  }

  return name
}

/**
 * The Playwright run a web script makes, and anything that narrows it.
 *
 * @param {string} command The web package's script.
 * @returns {{configFile: string, narrowedBy: string[]}} The config it runs, and every narrowing found.
 */
function playwrightRunOf(command) {
  const commands = commandsOf(command)
  const narrowedBy = []

  for (const words of commands) {
    for (const word of words) {
      const name = assignedName(word)
      if (name !== null && NARROWING_VARIABLE.test(name)) narrowedBy.push(`${name}=`)
    }
  }

  const runs = commands.filter((words) => words.includes('playwright'))

  if (runs.length !== 1) {
    throw new Unverifiable(
      runs.length === 0
        ? `"${command}" does not run Playwright`
        : `"${command}" runs Playwright ${runs.length} times, so which files it collects is ambiguous`,
    )
  }

  const words = runs[0]
  let index = 0

  while (index < words.length && assignedName(words[index]) !== null) index += 1

  if (words[index] === 'npx') index += 1
  else if (words[index] === 'pnpm' && words[index + 1] === 'exec') index += 2

  if (words[index] !== 'playwright' || words[index + 1] !== 'test') {
    throw new Unverifiable(`"${command}" runs Playwright in a shape this check cannot read`)
  }

  index += 2

  let configFile = DEFAULT_CONFIG

  while (index < words.length) {
    const word = words[index]

    if (word === '--config' || word === '-c') {
      if (words[index + 1] === undefined) {
        throw new Unverifiable(`"${command}" passes ${word} with no file`)
      }

      configFile = unquoted(words[index + 1])
      index += 2
      continue
    }

    if (word.startsWith('--config=')) {
      configFile = unquoted(word.slice('--config='.length))
      index += 1
      continue
    }

    // A file filter, `--grep`, `--project`, `--shard`: each runs fewer cases
    // than the config collects. None is used today, so none is allowed.
    narrowedBy.push(unquoted(word))
    index += 1
  }

  return { configFile: path.posix.normalize(configFile).replace(/^\.\//u, ''), narrowedBy }
}

/**
 * Follow a CI matrix script to the Playwright config it runs.
 *
 * @param {string} matrixScript The matrix entry's `script`, e.g. `test:e2e:detail`.
 * @param {Record<string, string>} rootScripts The root `package.json` scripts.
 * @param {Record<string, string>} webScripts The web package's scripts.
 * @param {string} [webPackage] The web package's name.
 * @returns {{webScript: string, configFile: string, narrowedBy: string[]}} The web script, its config file (relative to the web package) and anything narrowing it.
 * @throws {Unverifiable} When any step cannot be followed with certainty.
 */
export function resolveSuite(
  matrixScript,
  rootScripts,
  webScripts,
  webPackage = '@desi-event/web',
) {
  const root = rootScripts?.[matrixScript]

  if (typeof root !== 'string') {
    throw new Unverifiable(`the root package.json has no "${matrixScript}" script`)
  }

  const webScript = delegatedScript(root, webPackage)
  const command = webScripts?.[webScript]

  if (typeof command !== 'string') {
    throw new Unverifiable(`${webPackage} has no "${webScript}" script`)
  }

  return { webScript, ...playwrightRunOf(command) }
}

/**
 * Resolve every matrix suite, recording rather than throwing what cannot be.
 *
 * @param {Array<{name: string|null, script: string|null}>} suites The matrix entries.
 * @param {Record<string, string>} rootScripts The root `package.json` scripts.
 * @param {Record<string, string>} webScripts The web package's scripts.
 * @param {string} [webPackage] The web package's name.
 * @returns {Array<{name: string|null, script: string|null, configFile: string|null, narrowedBy: string[], problem: string|null}>} One entry per suite.
 */
export function resolveSuites(suites, rootScripts, webScripts, webPackage = '@desi-event/web') {
  return suites.map(({ name, script }) => {
    if (typeof script !== 'string' || script === '') {
      return { name, script, configFile: null, narrowedBy: [], problem: 'it names no script' }
    }

    try {
      return {
        name,
        script,
        ...resolveSuite(script, rootScripts, webScripts, webPackage),
        problem: null,
      }
    } catch (error) {
      if (!(error instanceof Unverifiable)) throw error

      return { name, script, configFile: null, narrowedBy: [], problem: error.message }
    }
  })
}

/**
 * Whether a path segment's name starts with a dot, other than `.` and `..`.
 *
 * @param {string} segment One segment of a path.
 * @returns {boolean} Whether it does.
 */
function dotLed(segment) {
  return segment.startsWith('.') && !/^\.\.?$/u.test(segment)
}

/**
 * Stands in for the dot that starts a directory name at or above a testDir.
 *
 * A private-use character: no file system path in this repository holds one,
 * and no glob character matches it except a wildcard — which is exactly how
 * Playwright's `dot: true` treats the dot it replaces.
 */
const HIDDEN_DOT = ''

/**
 * A pattern that could name a segment starting with a dot: a dot at its start,
 * or just after a separator or the opening of a brace list, group or class.
 */
const NAMES_A_DOT_SEGMENT = /(?:^|[/{,(|[!])\./u

/**
 * Whether a file matches any of a config's patterns, as Playwright decides it.
 *
 * Playwright prefixes a pattern that does not start with `**` + `/` with one,
 * and matches it against the file's absolute path, ignoring case and treating
 * dot-directories like any other. This does the same with `path.matchesGlob`,
 * which differs in one way: it never lets a wildcard match a segment that
 * starts with a dot.
 *
 * Below the config's testDir, where the specs are, that difference is refused
 * rather than papered over: a spec under a dot-directory there fails the
 * check. At and above the testDir it is only where the checkout happens to be
 * — `~/.cache/…`, a `.claude/worktrees/…` clone — and says nothing about which
 * specs a config collects, so those dots are replaced by a character only a
 * wildcard matches, which is Playwright's reading. A pattern that could name
 * such a directory itself is then refused, since the replacement would hide it.
 *
 * @param {string} filePath The spec's absolute path.
 * @param {string|RegExp|Function|Array<string|RegExp|Function>|undefined} patterns The config's `testMatch` or `testIgnore`.
 * @param {string} [testDir] The absolute testDir the spec was found under. Without it, every segment of the path is held to the rule below the testDir.
 * @returns {boolean} Whether any pattern matches.
 * @throws {Unverifiable} On a regular expression or a function, which no glob reading can prove equivalent; on a dot-directory below the testDir; and on a pattern that could name a dot-directory above it.
 */
export function matchesAny(filePath, patterns, testDir) {
  if (patterns === undefined || patterns === null) return false

  const list = Array.isArray(patterns) ? patterns : [patterns]
  const target = filePath.split(path.sep).join('/')
  const base =
    typeof testDir === 'string' ? testDir.split(path.sep).join('/').replace(/\/+$/u, '') : ''
  const above = base !== '' && target.startsWith(`${base}/`) ? base : ''
  const below = target.slice(above.length)

  if (below.split('/').some(dotLed)) {
    throw new Unverifiable(
      `${target} sits under a directory whose name starts with a dot, or has such a name itself, ` +
        "below the testDir, where Node's glob matcher and Playwright's disagree",
    )
  }

  const shown = above
    .split('/')
    .map((segment) => (dotLed(segment) ? `${HIDDEN_DOT}${segment.slice(1)}` : segment))
    .join('/')
  const subject = `${shown}${below}`.toLowerCase()

  return list.some((pattern) => {
    if (typeof pattern !== 'string') {
      const kind = pattern instanceof RegExp ? 'a regular expression' : `a ${typeof pattern}`

      throw new Unverifiable(
        `a pattern is ${kind} (${String(pattern)}), which this check cannot prove matches what ` +
          'Playwright would match — write it as a glob string',
      )
    }

    if (shown !== above && NAMES_A_DOT_SEGMENT.test(pattern)) {
      throw new Unverifiable(
        `the pattern "${pattern}" could name a directory whose name starts with a dot, and ` +
          `${above} holds one, where Node's glob matcher and Playwright's disagree`,
      )
    }

    const glob = pattern.startsWith('**/') ? pattern : `**/${pattern}`

    return path.posix.matchesGlob(subject, glob.toLowerCase())
  })
}

/**
 * The directory one project of a config collects from.
 *
 * @param {string} dir The config's directory.
 * @param {object} config The config.
 * @param {object} project One of its projects, or `{}`.
 * @returns {string} The absolute testDir: the project's, else the config's, else the config's own directory.
 */
function testDirOf(dir, config, project) {
  return path.resolve(dir, project.testDir ?? config.testDir ?? '.')
}

/**
 * Every directory a loaded config collects from that lies outside a root.
 *
 * The checker lists files under one directory only. A config reaching past it
 * could collect a file the check never sees, so such a config is reported.
 *
 * @param {{dir: string, config: object}} entry The config's directory and its default export.
 * @param {string} specRoot The absolute directory the checker lists.
 * @returns {string[]} Each testDir outside it, once.
 */
export function testDirsOutside({ dir, config }, specRoot) {
  const projects =
    Array.isArray(config.projects) && config.projects.length > 0 ? config.projects : [{}]
  const outside = projects
    .map((project) => testDirOf(dir, config, project))
    .filter((testDir) => {
      const relative = path.relative(specRoot, testDir)

      return relative.startsWith('..') || path.isAbsolute(relative)
    })

  return [...new Set(outside)]
}

/**
 * Whether one loaded config collects one spec.
 *
 * A config's projects may each set their own `testDir`, `testMatch` and
 * `testIgnore`; a project's value wins over the config's, as in Playwright,
 * and the config collects the spec when any of its projects does.
 *
 * @param {{dir: string, config: object}} entry The config's directory and its default export.
 * @param {string} specPath The spec's absolute path.
 * @returns {boolean} Whether the config collects it.
 * @throws {Unverifiable} When a pattern cannot be read with certainty.
 */
export function collects({ dir, config }, specPath) {
  const projects =
    Array.isArray(config.projects) && config.projects.length > 0 ? config.projects : [{}]

  return projects.some((project) => {
    const testDir = testDirOf(dir, config, project)
    const relative = path.relative(testDir, specPath)

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false

    const testMatch = project.testMatch ?? config.testMatch ?? DEFAULT_TEST_MATCH
    const testIgnore = project.testIgnore ?? config.testIgnore ?? []

    return !matchesAny(specPath, testIgnore, testDir) && matchesAny(specPath, testMatch, testDir)
  })
}

/** The config fields that run fewer cases than a config collects. */
const NARROWING_FIELDS = Object.freeze(['grep', 'grepInvert', 'shard'])

/**
 * Every field by which one loaded config runs fewer cases than it collects.
 *
 * A `grep` or `grepInvert` drops every case whose title it excludes, and a
 * `shard` runs a fraction of the files — each while the job reports the whole
 * suite, just as a narrowed script would.
 *
 * @param {{config: object}} entry The loaded config.
 * @returns {string[]} Each narrowing field set, on the config or on a project.
 */
export function narrowingFields({ config }) {
  const projects = Array.isArray(config.projects) ? config.projects : []
  const found = []

  for (const [where, holder] of [
    ['', config],
    ...projects.map((project, index) => [`projects[${index}].`, project]),
  ]) {
    for (const field of NARROWING_FIELDS) {
      if (holder?.[field] !== undefined && holder[field] !== null) found.push(`${where}${field}`)
    }
  }

  return found
}

/** The extensions Playwright loads a test file from; any other file it passes over. */
const TEST_FILE_EXTENSION = /\.[cm]?[jt]sx?$/u

/** A file named the way Playwright's default `testMatch` names a test. */
const NAMED_AS_TEST = /\.(?:spec|test)\.[cm]?[jt]sx?$/iu

/**
 * Whether Playwright would load a file as a test at all, by its extension.
 *
 * @param {string} name A file name.
 * @returns {boolean} Whether it would.
 */
export function testFileExtension(name) {
  return TEST_FILE_EXTENSION.test(name)
}

/**
 * Whether a file is named as a test, the way Playwright's default does it.
 *
 * `detail-new.spec.mjs` is; `detail-world.mjs` is not. A file named as a test
 * that no CI job collects is a spec that never runs, whatever its extension.
 *
 * @param {string} name A file name or path.
 * @returns {boolean} Whether it is.
 */
export function namedAsTest(name) {
  return NAMED_AS_TEST.test(name)
}

/**
 * The configs, among those given, that collect a spec.
 *
 * @param {string} specPath The spec's absolute path.
 * @param {Array<{file: string, dir: string, config: object}>} configs Loaded configs.
 * @returns {string[]} The files of the configs that collect it.
 */
export function collectingConfigs(specPath, configs) {
  return configs.filter((entry) => collects(entry, specPath)).map((entry) => entry.file)
}

/**
 * Every skip, fixme, expected failure or focus a spec's code makes.
 *
 * Read line by line, and lines that are prose — inside a JSDoc block or after
 * `//` — are passed over, so a comment explaining why nothing is skipped does
 * not fail the check. A call written after code on the same line is still
 * found: when in doubt, this reports.
 *
 * @param {string} source The spec's text.
 * @returns {Array<{call: string, line: number}>} Each forbidden call, with its 1-based line.
 */
export function forbiddenCalls(source) {
  const found = []

  source.split('\n').forEach((text, index) => {
    const trimmed = text.trimStart()

    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return

    // Where each report ends on this line, so one member is reported once.
    const reported = new Set()

    for (const { call, pattern } of FORBIDDEN_CALLS) {
      for (const match of text.matchAll(pattern)) {
        const end = match.index + match[0].length

        if (reported.has(end)) continue

        reported.add(end)
        found.push({ call: typeof call === 'function' ? call(match) : call, line: index + 1 })
      }
    }
  })

  return found
}

/**
 * The approved `main` ruleset, read out of the document rather than retyped.
 *
 * Shared with `scripts/apply-branch-protection.mjs`, which applies exactly
 * this payload: the checks CI must name are the checks that document requires,
 * by construction rather than by two lists agreeing.
 *
 * @param {string} markdown The document's text.
 * @param {string} [where] Its path, for the error.
 * @returns {object} The payload, exactly as the document specifies it.
 * @throws {Error} When the document holds no ruleset payload.
 */
export function approvedRulesetFrom(markdown, where = 'docs/BRANCH_PROTECTION.md') {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1])

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block)
      if (parsed && parsed.target === 'branch' && Array.isArray(parsed.rules)) return parsed
    } catch {
      continue
    }
  }

  throw new Error(`No branch ruleset payload found in ${where}`)
}

/**
 * The contexts a ruleset payload requires.
 *
 * @param {object} ruleset A ruleset payload or a rules listing entry.
 * @returns {string[]} Context names.
 */
export function contextsOf(ruleset) {
  const rule = (ruleset.rules ?? []).find((entry) => entry.type === 'required_status_checks')
  return (rule?.parameters?.required_status_checks ?? []).map((check) => check.context)
}

/**
 * The status checks the approved ruleset requires on `main`.
 *
 * @param {string} markdown The branch-protection document's text.
 * @param {string} [where] Its path, for the error.
 * @returns {string[]} Context names.
 */
export function requiredContextsFrom(markdown, where) {
  return contextsOf(approvedRulesetFrom(markdown, where))
}

/**
 * Indentation of a line.
 *
 * @param {string} line The line.
 * @returns {number} Leading spaces.
 */
function indentOf(line) {
  return line.length - line.trimStart().length
}

/**
 * Whether a line carries structure rather than being blank or a comment.
 *
 * @param {string} line The line.
 * @returns {boolean} Whether it does.
 */
function structural(line) {
  return line.trim() !== '' && !line.trim().startsWith('#')
}

/**
 * A YAML scalar with its surrounding quotes taken off.
 *
 * @param {string} value The raw value.
 * @returns {string} The value.
 */
function scalar(value) {
  return value.replace(/^['"]|['"]$/gu, '')
}

/**
 * The entries of every `matrix:` list in a workflow, one object per entry.
 *
 * A deliberately small reader for the one shape this repository uses: a
 * `matrix:` block holding a list whose entries are `- field: value` lines. An
 * entry missing a field comes back without it, and the caller reports that.
 *
 * @param {string} source The workflow's text.
 * @returns {Array<Record<string, string>>} Each entry's fields.
 */
export function matrixEntries(source) {
  const lines = source.split('\n')
  const entries = []
  let matrixIndent = null
  let entryIndent = null
  let current = null

  for (const line of lines) {
    if (!structural(line)) continue

    const indent = indentOf(line)

    if (/^\s*matrix:\s*$/u.test(line)) {
      matrixIndent = indent
      entryIndent = null
      current = null
      continue
    }

    if (matrixIndent === null) continue

    if (indent <= matrixIndent) {
      matrixIndent = null
      current = null
      continue
    }

    const item = line.match(/^(\s*)-\s+([A-Za-z_][\w-]*):\s*(.*?)\s*$/u)

    if (item) {
      entryIndent = item[1].length
      current = { [item[2]]: scalar(item[3]) }
      entries.push(current)
      continue
    }

    const field = line.match(/^\s*([A-Za-z_][\w-]*):\s*(.*?)\s*$/u)

    if (field && current !== null && entryIndent !== null && indent === entryIndent + 2) {
      current[field[1]] = scalar(field[2])
    }
  }

  return entries
}

/**
 * The browser suites a workflow's matrix runs.
 *
 * @param {string} source The workflow's text.
 * @returns {Array<{name: string|null, script: string|null}>} One per matrix entry.
 */
export function matrixSuites(source) {
  return matrixEntries(source).map((entry) => ({
    name: entry.name ?? null,
    script: entry.script ?? null,
  }))
}

/** The expression a browser job's name interpolates. */
const SUITE_NAME = /\$\{\{\s*matrix\.suite\.name\s*\}\}/u

/**
 * The job-level `name:` that interpolates the matrix suite's name.
 *
 * That name is what GitHub reports as the check's context, so it is what the
 * branch ruleset has to require. A step or an artefact interpolating the same
 * expression is not a job name, and is passed over: the line must sit directly
 * under a job id, which sits directly under `jobs:`.
 *
 * @param {string} source The workflow's text.
 * @returns {string|null} The template, e.g. `Browser — ${{ matrix.suite.name }}`, or null.
 */
export function suiteJobNameTemplate(source) {
  const lines = source.split('\n')

  /**
   * The nearest structural line above one, indented less than it.
   *
   * @param {number} index A line's index.
   * @returns {number} The parent's index, or -1.
   */
  function parentOf(index) {
    const indent = indentOf(lines[index])

    for (let look = index - 1; look >= 0; look -= 1) {
      if (structural(lines[look]) && indentOf(lines[look]) < indent) return look
    }

    return -1
  }

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s+name:\s*(.*?)\s*$/u)
    if (!match || !SUITE_NAME.test(match[1])) continue

    const job = parentOf(index)
    if (job === -1 || !/^\s+[\w-]+:\s*$/u.test(lines[job])) continue

    const jobs = parentOf(job)
    if (jobs !== -1 && /^jobs:\s*$/u.test(lines[jobs])) return scalar(match[1])
  }

  return null
}

/**
 * Every narrowing variable a workflow mentions.
 *
 * Set in a job's `env:` it would narrow every config the job runs, whatever the
 * scripts say, so a mention anywhere in the workflow is reported.
 *
 * @param {string} source The workflow's text.
 * @returns {string[]} The variable names, once each.
 */
export function narrowingInWorkflow(source) {
  return [...new Set(source.match(NARROWING_MENTION) ?? [])]
}

/**
 * Judge every spec against the configs CI runs.
 *
 * @param {object} input What the checker gathered.
 * @param {Array<{name: string|null, script: string|null, configFile: string|null, narrowedBy: string[], problem: string|null}>} input.suites Resolved matrix suites.
 * @param {string[]} input.configFiles Every Playwright config file in the web package.
 * @param {Array<{file: string, dir: string, config: object}>} input.configs The configs CI runs, loaded.
 * @param {Array<{path: string, relative: string, source: string}>} input.specs Every file under the browser tests' directory that Playwright could load — specs and support modules alike. Each is scanned for forbidden calls; each that a CI config collects, or that is named as a test, must be collected exactly once.
 * @param {string} [input.workflow] The workflow's path, for messages.
 * @param {string} [input.webDirectory] The web package's path, for messages.
 * @param {string} [input.specRoot] The absolute directory `specs` were listed from. When given, a CI-run config collecting from anywhere else is reported.
 * @returns {{problems: Array<{where: string, what: string}>, collectedBy: Map<string, string[]>}} Every problem, and which suites collect each spec. A support module no config collects is not a spec and is left out.
 */
export function judgeSpecCollection({
  suites,
  configFiles,
  configs,
  specs,
  workflow = '.github/workflows/ci.yml',
  webDirectory = 'apps/web',
  specRoot,
}) {
  const problems = []
  const report = (where, what) => problems.push({ where, what })
  const byFile = new Map(configs.map((entry) => [entry.file, entry]))
  const run = new Set()

  if (suites.length === 0) {
    report(workflow, 'no browser matrix entries could be read, so no spec can be proved to run')
  }

  for (const suite of suites) {
    const label = `the "${suite.name ?? '(unnamed)'}" browser job`

    if (suite.problem !== null) {
      report(workflow, `${label} cannot be followed to a Playwright config: ${suite.problem}`)
      continue
    }

    if (!configFiles.includes(suite.configFile)) {
      report(
        workflow,
        `${label} runs ${webDirectory}/${suite.configFile}, which is not a Playwright config in ${webDirectory}`,
      )
      continue
    }

    run.add(suite.configFile)

    for (const narrowing of suite.narrowedBy) {
      report(
        workflow,
        `${label} runs ${suite.configFile} narrowed by "${narrowing}", so it may run fewer specs ` +
          'than that config collects while the job reports the whole suite',
      )
    }
  }

  for (const file of configFiles) {
    if (!run.has(file)) {
      report(
        `${webDirectory}/${file}`,
        'is run by no CI browser job, so any spec only it collects never runs in CI — add a ' +
          'matrix leg and a required check for it, or delete it',
      )
    }
  }

  for (const entry of configs) {
    if (!run.has(entry.file)) continue

    for (const field of narrowingFields(entry)) {
      report(
        `${webDirectory}/${entry.file}`,
        `sets ${field}, so it runs fewer cases than it collects while its job reports the whole ` +
          'suite — take the narrowing out of the config',
      )
    }

    if (typeof specRoot !== 'string') continue

    for (const testDir of testDirsOutside(entry, specRoot)) {
      report(
        `${webDirectory}/${entry.file}`,
        `collects from ${testDir}, outside ${specRoot}, where this check does not look — keep ` +
          'every browser spec under that one directory',
      )
    }
  }

  const unverifiable = new Set()
  const collectedBy = new Map()

  for (const spec of specs) {
    const suitesCollecting = []

    for (const suite of suites) {
      const entry = suite.problem === null ? byFile.get(suite.configFile) : undefined
      if (entry === undefined || unverifiable.has(entry.file)) continue

      try {
        if (collects(entry, spec.path)) suitesCollecting.push(suite.name)
      } catch (error) {
        if (!(error instanceof Unverifiable)) throw error

        unverifiable.add(entry.file)
        report(
          `${webDirectory}/${entry.file}`,
          `cannot be proved to collect or ignore ${spec.relative}: ${error.message}`,
        )
      }
    }

    // A support module no config collects is not a spec. One named as a test
    // is, whatever its extension: `detail-new.spec.mjs` never runs, and says so.
    const isSpec = suitesCollecting.length > 0 || namedAsTest(spec.relative)

    if (isSpec) collectedBy.set(spec.relative, suitesCollecting)

    if (isSpec && suitesCollecting.length === 0 && unverifiable.size === 0) {
      report(
        spec.relative,
        'is collected by no Playwright config a CI browser job runs, so it never runs in CI. ' +
          'Name a new detail spec detail-<feature>.spec.js, which playwright.detail.config.js ' +
          'collects, or put an accessibility case in accessibility-sweep.spec.js',
      )
    }

    if (suitesCollecting.length > 1) {
      report(
        spec.relative,
        `is collected by ${suitesCollecting.length} CI browser jobs (${suitesCollecting.join(', ')}), ` +
          'so it runs in each — and in the one whose servers it does not expect, it fails. ' +
          "Add it to the other configs' testIgnore",
      )
    }

    for (const { call, line } of forbiddenCalls(spec.source)) {
      report(
        `${spec.relative}:${line}`,
        `calls ${call}, so the run reports something other than what ran. Fix or delete the case`,
      )
    }
  }

  return { problems, collectedBy }
}

/**
 * Judge that every browser job is a required check on `main`.
 *
 * A browser job that is not required can fail on every pull request and still
 * be merged past, which is the same as not running it.
 *
 * @param {object} input What the checker gathered.
 * @param {Array<{name: string|null}>} input.suites The matrix suites.
 * @param {string|null} input.template The browser job's name template.
 * @param {string[]} input.requiredContexts The contexts the approved ruleset requires.
 * @param {string} [input.workflow] The workflow's path, for messages.
 * @param {string} [input.document] The ruleset document's path, for messages.
 * @returns {Array<{where: string, what: string}>} Every problem.
 */
export function judgeRequiredContexts({
  suites,
  template,
  requiredContexts,
  workflow = '.github/workflows/ci.yml',
  document = 'docs/BRANCH_PROTECTION.md',
}) {
  if (template === null) {
    return [
      {
        where: workflow,
        what:
          'no job-level name interpolating ${{ matrix.suite.name }} was found, so no browser ' +
          'job can be matched to the check the ruleset requires',
      },
    ]
  }

  return suites
    .filter((suite) => typeof suite.name === 'string' && suite.name !== '')
    .map((suite) => template.replace(SUITE_NAME, suite.name))
    .filter((context) => !requiredContexts.includes(context))
    .map((context) => ({
      where: document,
      what:
        `the approved ruleset does not require "${context}", so that browser job can fail and ` +
        'a pull request still merge — add it to required_status_checks',
    }))
}
