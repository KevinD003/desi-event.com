/**
 * Invariants about how CI is wired, each learned from something that failed.
 *
 * None is expressible as a unit test, because none is about application
 * behaviour: they are properties of `.github/workflows/*.yml` and of the
 * Turborepo task graph. Each went wrong at least once, and in each case the
 * failure was invisible on a green run — which is the argument for checking
 * them on every run rather than noticing again later.
 *
 * The third, fresh test reports, has two halves. CI must produce and judge its
 * Vitest reports through `pnpm run verify:tests:fresh` and no other route, so
 * that the local command and the CI step cannot drift. And `turbo.json` must
 * declare the variables the test suites read, because Turborepo's strict
 * environment mode silently removes every undeclared one: `REQUIRE_DATABASE`,
 * set workflow-wide in CI, reached no test process at all until it was declared.
 *
 * The fourth is where that command's verdict lands. The test step prints its
 * per-package table thousands of lines above the end of the verify job's log,
 * out of reach of anything that reads only the tail, so the job must end by
 * printing the summary file the command writes, with nothing but failure-only
 * steps after it.
 *
 * Run: `pnpm run ci:check`
 *
 * @module scripts/check-ci-invariants
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SUMMARY_PATH } from './verify-tests-fresh.mjs'

/**
 * Characters `actions/upload-artifact` refuses in an artefact name.
 *
 * Taken from the action's own validation, which rejects the upload outright
 * rather than sanitising it. A colon is the one that bit: every end-to-end
 * suite is a pnpm task named `test:e2e:something`, so interpolating the script
 * name produced `playwright-test:e2e` and the step failed *after* the tests had
 * already failed, discarding the reports that would have explained them.
 */
const FORBIDDEN_IN_ARTEFACT_NAME = ['"', ':', '<', '>', '|', '*', '?', '\r', '\n', '\\', '/']

/** Task names whose commands run tests, and so import generated clients. */
const TEST_TASKS = ['test', 'test:coverage']

/**
 * Variables the test suites read that Turborepo must pass through.
 *
 * Declared in `globalEnv` rather than a pass-through list, because each one
 * changes what a test run means — a suite that skips for want of a database and
 * one that fails for it are different results, and a cached result for one must
 * not be replayed for the other.
 */
const TEST_ENVIRONMENT = ['REQUIRE_DATABASE', 'TEST_DATABASE_URL']

/** The one command CI may use to produce and judge Vitest reports. */
const FRESH_REPORT_COMMAND = 'pnpm run verify:tests:fresh'

/**
 * The step that prints that command's summary. Exactly this, so that a missing
 * file fails the step: `cat` exits nonzero, and nothing is piped to hide it.
 */
const SUMMARY_COMMAND = `cat ${SUMMARY_PATH}`

/**
 * Shapes that produce or read Vitest reports outside that command.
 *
 * Each is a route by which a report this run did not write gets judged as
 * though it had: reporter flags handed to a plain test run, or the checker
 * pointed at whatever `find` turns up on disk.
 */
const FORBIDDEN_REPORT_ROUTES = [
  {
    pattern: /outputFile(\.json)?=vitest-report\.json/,
    what: 'writes Vitest reports outside verify:tests:fresh',
  },
  {
    pattern: /check-skipped-tests\.mjs\s+\$\(find/,
    what: "judges whatever reports are on disk rather than this run's",
  },
]

/**
 * Every problem found. Empty means the invariants hold.
 *
 * @type {string[]}
 */
const problems = []

/**
 * Report a failure.
 *
 * @param {string} where Which file the problem is in.
 * @param {string} what What is wrong, and why it matters.
 * @returns {void}
 */
function fail(where, what) {
  problems.push(`${where}: ${what}`)
}

/**
 * The literal values a matrix field takes, read from the workflow text.
 *
 * This is a deliberately small parser rather than a YAML dependency, and it is
 * written to **fail closed**: a construct it cannot read is reported as
 * unverifiable, never assumed to be fine. It handles the one shape this
 * repository uses — a `matrix:` block whose entries are `- field: value` lists.
 *
 * @param {string} source The workflow file's text.
 * @param {string} field The field name, e.g. `name` or `script`.
 * @returns {string[]} Every literal value found for that field inside a matrix.
 */
function matrixValues(source, field) {
  const lines = source.split('\n')
  const values = []
  let insideMatrix = false
  let matrixIndent = 0

  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length

    if (/^\s*matrix:\s*$/.test(line)) {
      insideMatrix = true
      matrixIndent = indent
      continue
    }

    // The matrix block ends at the first line indented no further than it.
    if (insideMatrix && indent <= matrixIndent && !/^\s*matrix:\s*$/.test(line)) {
      insideMatrix = false
    }

    if (!insideMatrix) continue

    const match = line.match(/^\s*(?:-\s+)?([A-Za-z_][\w-]*):\s*(.+?)\s*$/)
    if (match && match[1] === field) values.push(match[2].replace(/^['"]|['"]$/g, ''))
  }

  return values
}

/**
 * The steps of one job, in order.
 *
 * Another deliberately small reader, for the one shape this repository's
 * workflows use: `jobs.<job>.steps` as a list of `- name:` entries whose `run:`
 * is either inline or a `|` block. It fails closed like `matrixValues`: a job
 * or a steps list it cannot find comes back empty, and the caller reports that
 * rather than passing.
 *
 * @param {string} source The workflow file's text.
 * @param {string} job The job's id, e.g. `verify`.
 * @returns {Array<{name: string|null, run: string|null, condition: string|null}>} The steps.
 */
function stepsOf(source, job) {
  const lines = source.split('\n')
  const indentOf = (line) => line.length - line.trimStart().length
  const structural = (line) => line.trim() !== '' && !line.trim().startsWith('#')

  /**
   * The lines inside the block that opens at `start`, up to the next line
   * indented no further than it.
   *
   * @param {number} start Index of the line opening the block.
   * @returns {string[]} The block's lines.
   */
  function blockAfter(start) {
    const indent = indentOf(lines[start])
    let end = start + 1

    while (end < lines.length && !(structural(lines[end]) && indentOf(lines[end]) <= indent)) {
      end += 1
    }

    return lines.slice(start + 1, end)
  }

  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsAt === -1) return []

  /**
   * Where the key opening a block sits among its siblings, or -1.
   *
   * @param {string[]} block The lines holding the siblings.
   * @param {string} key The key.
   * @returns {number} Its index in `block`.
   */
  function keyIn(block, key) {
    const sibling = block.find(structural)
    if (sibling === undefined) return -1

    return block.findIndex(
      (line) => indentOf(line) === indentOf(sibling) && line.trim() === `${key}:`,
    )
  }

  const jobAt = keyIn(blockAfter(jobsAt), job)
  if (jobAt === -1) return []

  const bodyStart = jobsAt + 1 + jobAt
  const stepsAt = keyIn(blockAfter(bodyStart), 'steps')
  if (stepsAt === -1) return []

  const stepLines = blockAfter(bodyStart + 1 + stepsAt)
  const first = stepLines.find((line) => /^\s*-\s/.test(line))
  if (first === undefined) return []

  const itemIndent = indentOf(first)
  const steps = []
  let current = null
  let runBlock = null

  for (const line of stepLines) {
    const indent = indentOf(line)

    if (runBlock !== null) {
      if (line.trim() === '' || indent > itemIndent + 2) {
        runBlock.push(line.trim())
        continue
      }

      current.run = runBlock.join('\n').trim()
      runBlock = null
    }

    if (!structural(line)) continue

    let text = line
    if (indent === itemIndent && /^\s*-\s/.test(line)) {
      current = { name: null, run: null, condition: null, continueOnError: null }
      steps.push(current)
      text = line.replace('-', ' ')
    }

    if (current === null) continue

    const field = text.match(/^\s*(name|run|if|continue-on-error):\s*(.*?)\s*$/)
    if (!field || indentOf(text) !== itemIndent + 2) continue

    const [, key, value] = field
    if (key === 'name') current.name = value
    else if (key === 'if') current.condition = value
    else if (key === 'continue-on-error') current.continueOnError = value
    else if (value === '|') runBlock = []
    else current.run = value
  }

  if (runBlock !== null) current.run = runBlock.join('\n').trim()

  return steps
}

/**
 * Check that every artefact name a workflow can produce is one GitHub accepts.
 *
 * @param {string} file The workflow file name.
 * @param {string} source Its text.
 * @returns {void}
 */
function checkArtefactNames(file, source) {
  const lines = source.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    // Match the directive, not the word. A comment that merely names the action
    // — such as the one this check exists because of — is prose, not a step.
    if (!/^\s*uses:\s*actions\/upload-artifact/.test(lines[index])) continue

    // The `name:` belonging to this step is the next one inside its `with:`.
    let name = null
    for (let look = index + 1; look < Math.min(index + 12, lines.length); look += 1) {
      const match = lines[look].match(/^\s*name:\s*(.+?)\s*$/)
      if (match) {
        name = match[1]
        break
      }
    }

    if (name === null) {
      fail(file, `an upload-artifact step near line ${index + 1} has no name this check could read`)
      continue
    }

    // Resolve every ${{ ... }} the name interpolates. Anything that is not a
    // matrix field this parser understands is reported rather than skipped.
    const expressions = [...name.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1])
    let candidates = [name]

    for (const expression of expressions) {
      const matrixField = expression.match(/^matrix\.[\w-]+\.([\w-]+)$/)
      if (!matrixField) {
        fail(
          file,
          `artefact name "${name}" interpolates \`${expression}\`, which this check cannot resolve — ` +
            `resolve it here or use a literal, because an unresolvable name cannot be proved uploadable`,
        )
        candidates = []
        break
      }

      const values = matrixValues(source, matrixField[1])
      if (values.length === 0) {
        fail(
          file,
          `artefact name "${name}" interpolates \`${expression}\` but no matrix values were found for it`,
        )
        candidates = []
        break
      }

      candidates = candidates.flatMap((candidate) =>
        values.map((value) => candidate.replace(`\${{ ${expression} }}`, value)),
      )
    }

    for (const candidate of candidates) {
      const bad = FORBIDDEN_IN_ARTEFACT_NAME.filter((character) => candidate.includes(character))
      if (bad.length > 0) {
        const shown = bad.map((character) => JSON.stringify(character)).join(', ')
        fail(
          file,
          `artefact name "${candidate}" contains ${shown}, which actions/upload-artifact rejects`,
        )
      }
    }
  }
}

/**
 * Check that a package's tests wait for that package's own build.
 *
 * `packages/db`'s build is `prisma generate`, and the client it generates lands
 * in shared `node_modules`, not in any directory Turborepo tracks as an output.
 * With `dependsOn: ["^build"]` alone, a package's tests are ordered against its
 * *dependencies'* builds but not its own — so `@desi-event/db#build` and
 * `@desi-event/db#test:coverage` were free to run at the same time. On run
 * `35103232838` they did: the generate landed 9s into a vitest run that was
 * importing the very client it was rewriting, and Node refused the half-written
 * `package.json` with "Invalid package config". The suite reported `(0 test)` —
 * its assertions did not run at all.
 *
 * @returns {void}
 */
function checkTaskOrdering() {
  const file = 'turbo.json'
  const config = JSON.parse(readFileSync(file, 'utf8'))

  for (const task of TEST_TASKS) {
    const definition = config.tasks?.[task]
    if (!definition) {
      fail(file, `task "${task}" is missing, so its ordering cannot be checked`)
      continue
    }

    const dependsOn = definition.dependsOn ?? []
    if (!dependsOn.includes('build')) {
      fail(
        file,
        `task "${task}" does not depend on "build", so a package's tests may run while its own ` +
          `generated client is being rewritten (see run 35103232838)`,
      )
    }
  }
}

/**
 * Check that the test suites can see the variables they read.
 *
 * @returns {void}
 */
function checkTestEnvironment() {
  const file = 'turbo.json'
  const declared = JSON.parse(readFileSync(file, 'utf8')).globalEnv ?? []

  for (const name of TEST_ENVIRONMENT) {
    if (!declared.includes(name)) {
      fail(
        file,
        `"${name}" is not in globalEnv, so Turborepo's strict environment mode removes it from ` +
          `every test process and a workflow that sets it changes nothing`,
      )
    }
  }
}

/**
 * Check that CI produces and judges reports only through the fresh-report command.
 *
 * @param {Array<{file: string, source: string}>} files The workflow files.
 * @returns {void}
 */
function checkFreshReports(files) {
  const ci = files.find(({ file }) => file.endsWith('ci.yml'))

  if (!ci) {
    fail(workflowDirectory, 'ci.yml not found, so the fresh-report command cannot be checked')

    return
  }

  if (!ci.source.includes(FRESH_REPORT_COMMAND)) {
    fail(
      ci.file,
      `does not run "${FRESH_REPORT_COMMAND}", so CI's test reports are not proved to be this run's`,
    )
  }

  for (const { file, source } of files) {
    for (const route of FORBIDDEN_REPORT_ROUTES) {
      if (route.pattern.test(source)) fail(file, `a step ${route.what}`)
    }
  }

  checkFreshReportSummary(ci)
}

/**
 * Check that the verify job ends by printing the fresh-report summary.
 *
 * @param {{file: string, source: string}} ci The CI workflow.
 * @returns {void}
 */
function checkFreshReportSummary(ci) {
  const steps = stepsOf(ci.source, 'verify')

  if (steps.length === 0) {
    fail(ci.file, "the verify job's steps could not be read, so its summary step cannot be checked")

    return
  }

  const tested = steps.findIndex((step) => step.run === FRESH_REPORT_COMMAND)
  const summary = steps.findIndex((step) => step.run === SUMMARY_COMMAND)

  if (summary === -1) {
    fail(
      ci.file,
      `the verify job has no step that runs exactly "${SUMMARY_COMMAND}", so the fresh-report ` +
        `table sits thousands of lines above the end of its log, where a reader of the tail never sees it`,
    )

    return
  }

  // The step exists to fail a green run that lost its summary: a condition
  // could skip it on exactly that run, and continue-on-error would swallow the
  // failure.
  const { condition, continueOnError } = steps[summary]

  if (condition !== null) {
    fail(ci.file, `"${SUMMARY_COMMAND}" carries "if: ${condition}", so a green run may skip it`)
  }

  if (continueOnError !== null && continueOnError !== 'false') {
    fail(
      ci.file,
      `"${SUMMARY_COMMAND}" carries "continue-on-error: ${continueOnError}", so a missing summary ` +
        `would not fail the job`,
    )
  }

  if (tested === -1 || summary < tested) {
    fail(
      ci.file,
      `"${SUMMARY_COMMAND}" runs before "${FRESH_REPORT_COMMAND}" in the verify job, so it could ` +
        `only print a summary some earlier run left`,
    )
  }

  const later = steps.slice(summary + 1).filter((step) => step.condition !== 'failure()')

  if (later.length > 0) {
    const names = later.map((step) => `"${step.name ?? step.run}"`).join(', ')

    fail(
      ci.file,
      `${names} run(s) after "${SUMMARY_COMMAND}" on a green run, so the fresh-report summary ` +
        `no longer ends the verify job's log — move the summary step after them, or make them failure-only`,
    )
  }
}

const workflowDirectory = '.github/workflows'
const workflows = readdirSync(workflowDirectory).filter(
  (file) => file.endsWith('.yml') || file.endsWith('.yaml'),
)

if (workflows.length === 0) {
  fail(workflowDirectory, 'no workflow files found, so no artefact name could be checked')
}

const sources = workflows.map((file) => ({
  file: join(workflowDirectory, file),
  source: readFileSync(join(workflowDirectory, file), 'utf8'),
}))

for (const { file, source } of sources) checkArtefactNames(file, source)

checkTaskOrdering()
checkTestEnvironment()
checkFreshReports(sources)

if (problems.length > 0) {
  console.error('CI invariants failed:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(
  `CI invariants hold: ${workflows.length} workflow file(s) produce only uploadable artefact names, ` +
    `${TEST_TASKS.length} test tasks order their own build, ${TEST_ENVIRONMENT.length} test ` +
    `variables reach the suites, reports come only from ${FRESH_REPORT_COMMAND}, and the verify ` +
    `job ends by printing ${SUMMARY_PATH}.`,
)
