/**
 * What the browser is allowed to be given.
 *
 * Finding NF-15: `apps/web/src/lib/api-client.js` imports the
 * `@desi-event/api-contract` barrel, which re-exported `validate.js`, which
 * imported the `@desi-event/auth` barrel for one frozen array of strings. The
 * auth barrel re-exports `password.js`, and the production client bundle
 * therefore contained this:
 *
 *     (0,i.i(78585).promisify)(yB.scrypt),
 *     Object.freeze({N:32768,r:8,p:1,keyLength:32,saltLength:16,maxmem:0x6000000})
 *
 * — the platform's password hashing and its exact scrypt tuning, compiled into
 * a chunk served to every visitor. It also crashed: `node:crypto.scrypt` is
 * undefined in a browser, so `promisify` threw at module evaluation and took
 * the checkout page's error boundary with it.
 *
 * Neither half was caught by anything. A bundle is the wrong place to notice
 * this — by then it has shipped — so this module walks the import graph
 * statically, from the files a browser actually loads, and the test beside it
 * fails the moment a server-only module becomes reachable again.
 *
 * This is deliberately a *static* walk over source text rather than a check
 * against a built bundle: it needs no build, it runs in milliseconds, and it
 * names the import chain rather than a minified identifier.
 *
 * @module lib/browser-bundle
 */

import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** The workspace root, derived from this file rather than from the cwd. */
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../../..')

/**
 * Modules a browser must never be given, as `package/path` prefixes.
 *
 * Listed as what is forbidden rather than what is allowed, because the
 * allow-list would have to be revised every time a component is added and a
 * forgotten revision fails open. Each entry says why.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FORBIDDEN = Object.freeze({
  'packages/auth/src/password.js':
    'scrypt password hashing and its tuning parameters. Calls promisify(node:crypto.scrypt) at module scope, which throws in a browser.',
  'packages/auth/src/totp.js': 'second-factor verification, including the replay window.',
  'packages/auth/src/sealing.js': 'the key derivation that protects stored TOTP secrets.',
  'packages/auth/src/tokens.js':
    'bearer-secret digesting and the pseudonymisation of email and IP addresses.',
  'packages/auth/src/throttle.js': 'the lockout thresholds an attacker would like to know.',
  'packages/auth/src/index.js': 'the auth barrel, which re-exports every module above.',
  'packages/inventory/src/ownership.js':
    'hold-ownership secrets: it digests and compares guest tokens with node:crypto, which does not exist in a browser.',
  'packages/inventory/src/index.js':
    'the inventory barrel, which re-exports ownership.js. The whole-layout validator is at @desi-event/inventory/layout and imports nothing.',
  'packages/schemas/src/env.js':
    'the API and worker deployment contract: the PostgreSQL and Redis variable names, the floor on JWT_SECRET, the AUTH_SECRET fallback rule, the fee constants, and the verbatim list of placeholder secrets production refuses.',
  'packages/schemas/src/jobs.js':
    'worker queue and job payload schemas. The browser does not enqueue work.',
  'packages/db/': 'Prisma, the schema, and anything that can open a connection.',
  'packages/providers/': 'payment provider adapters, which hold secret-key handling.',
  'packages/ledger/': 'double-entry posting rules. Server-side money, never client-side.',
  'apps/api/': 'the API server itself.',
})

/** Where a bare workspace specifier resolves to. */
const WORKSPACE_PACKAGES = Object.freeze({
  '@desi-event/api-contract': 'packages/api-contract',
  '@desi-event/auth': 'packages/auth',
  '@desi-event/config': 'packages/config',
  '@desi-event/db': 'packages/db',
  '@desi-event/inventory': 'packages/inventory',
  '@desi-event/ledger': 'packages/ledger',
  '@desi-event/logger': 'packages/logger',
  '@desi-event/permissions': 'packages/permissions',
  '@desi-event/pricing': 'packages/pricing',
  '@desi-event/providers': 'packages/providers',
  '@desi-event/schemas': 'packages/schemas',
  '@desi-event/ui': 'packages/ui',
})

/** Matches the specifier of a static `import`, `export … from` or `import()`. */
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * Every static specifier a module imports.
 *
 * Regex rather than a parser, and that is a real limitation worth stating: it
 * sees static `import`/`export … from` and literal `import()`, which is what
 * a bundler follows into a chunk, and it does not see a computed specifier.
 * Nothing in this repository uses one, and a test asserts that too.
 *
 * @param {string} source The module's text.
 * @returns {string[]} The specifiers, in source order.
 */
export function specifiersIn(source) {
  const found = []

  for (const match of source.matchAll(SPECIFIER)) {
    found.push(match[1] ?? match[2])
  }

  return found.filter(Boolean)
}

/**
 * Resolve a specifier to a repo-relative path, or null when it leaves the repo.
 *
 * Handles the two forms that matter: a relative path, and a workspace package
 * with or without a subpath. A bare third-party specifier resolves to null —
 * `react` is not this module's problem.
 *
 * @param {string} specifier The import specifier.
 * @param {string} fromFile The importing file, repo-relative.
 * @returns {string|null} A repo-relative path, or null.
 */
export function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('.')) {
    return relative(ROOT, resolve(ROOT, dirname(fromFile), specifier))
  }

  for (const [name, directory] of Object.entries(WORKSPACE_PACKAGES)) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue

    const subpath = specifier.slice(name.length).replace(/^\//, '')

    // The subpath is an exports-map key, not a file path: `./sessions` means
    // `src/sessions.js`. Resolving it that way is what makes an entry point
    // narrower than a barrel actually narrower here too.
    return subpath ? `${directory}/src/${subpath}.js` : `${directory}/src/index.js`
  }

  return null
}

/**
 * Read a module, trying the extensions a bundler would.
 *
 * @param {string} file A repo-relative path, possibly without an extension.
 * @returns {{path: string, source: string}|null} The module, or null when there is none.
 */
function readModule(file) {
  const candidates = [
    file,
    `${file}.js`,
    `${file}.jsx`,
    join(file, 'index.js'),
    join(file, 'index.jsx'),
  ]

  for (const candidate of candidates) {
    try {
      return { path: candidate, source: readFileSync(resolve(ROOT, candidate), 'utf8') }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Whether a module's first statement is the `'use client'` directive.
 *
 * The naive check — look for the directive in the first couple of hundred
 * characters — is wrong in this repository specifically, because the house
 * style opens every module with a long docstring explaining why it exists. A
 * client component whose reasoning runs to fifteen lines would not be
 * recognised as a browser entry point at all, and the guard would pass while
 * the component shipped whatever it liked. That is not hypothetical: it is how
 * the first version of this file missed a component importing the placeholder
 * secret blocklist.
 *
 * So comments and blank lines are stripped from the head first, and the
 * directive has to be what is left — which is also the rule the bundler
 * applies.
 *
 * @param {string} source The module's text.
 * @returns {boolean} True when the module is a client component.
 */
export function declaresUseClient(source) {
  const head = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trimStart()

  return /^['"]use client['"]/.test(head)
}

/**
 * Whether a path is one the browser must never be given, and why.
 *
 * @param {string} file A repo-relative path.
 * @returns {string|null} The reason it is forbidden, or null.
 */
export function forbiddenReason(file) {
  for (const [prefix, reason] of Object.entries(FORBIDDEN)) {
    if (file === prefix || file.startsWith(prefix)) return reason
  }

  return null
}

/**
 * Walk the import graph from an entry point, returning every module reached.
 *
 * @param {string[]} entryPoints Repo-relative entry points.
 * @returns {Map<string, string[]>} Each reached module, mapped to the chain that reached it.
 */
export function reachableFrom(entryPoints) {
  /** @type {Map<string, string[]>} */
  const reached = new Map()
  const queue = entryPoints.map((entry) => ({ file: entry, chain: [entry] }))

  while (queue.length > 0) {
    const { file, chain } = queue.shift()
    const module = readModule(file)

    if (!module || reached.has(module.path)) continue

    reached.set(module.path, chain)

    for (const specifier of specifiersIn(module.source)) {
      const target = resolveSpecifier(specifier, module.path)

      if (target && !reached.has(target)) {
        queue.push({ file: target, chain: [...chain, target] })
      }
    }
  }

  return reached
}
