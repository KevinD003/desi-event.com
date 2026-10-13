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
  'packages/schemas/src/index.js':
    'the schemas barrel. It excludes env.js and jobs.js above, which is why it looked harmless, but it re-exports entities.js, requests.js and responses.js — so one status constant imported from it ships every model\u2019s column names. Import a narrow subpath instead.',
  'packages/schemas/src/entities.js':
    'every persisted model\u2019s shape, column by column: Organization.payoutCurrency and contactEmail, auditLogSchema, and the rest of the database as the browser has no business knowing it.',
  'packages/schemas/src/requests.js':
    'the shape of every request the API accepts, including fields a screen never sends and a caller is not meant to discover by reading the bundle.',
  'packages/schemas/src/responses.js':
    'the shape of every response the API can produce, including branches withheld from the caller who loaded this bundle.',
  'packages/permissions/src/capabilities.js':
    'the role-to-capability tables, platform and organisation: which role may refund, pay out, moderate or change a platform role. A screen that needs a role\u2019s name gets it from a narrow schemas subpath, and what a role may do from the API\u2019s answer.',
  'packages/permissions/src/index.js':
    'the permissions barrel, which re-exports the capability tables above and the door-authority policy. Client code never decides what somebody may do; the API does, and says so.',
  'packages/schemas/src/organizer-invitations.js':
    'the organiser-invitation schemas: the administrators\u2019 whole form contract, the private note to the recipient included. The letter a screen shows comes from @desi-event/schemas/code-letters, which imports nothing and is allowed.',
  'packages/providers/src/smtp.js':
    'the SMTP adapter: nodemailer, the mail server\u2019s address and the credentials used to sign in to it.',
  'apps/api/src/lib/code-mailer.js':
    'composes and sends show-once codes by email. A code reaches the recipient\u2019s mailbox and nowhere else.',
  'apps/web/src/lib/traffic-forwarding.js':
    'derives a visitor\u2019s address from the trusted proxy hops (TRAFFIC_TRUSTED_PROXY_HOPS) and forwards it to the API. It runs on the web server only; in a browser it would hand the address to whoever reads the bundle.',
  // SPEC2-XI I: the importer's three modules. `apps/api/` below already
  // covers them; each is named so a refusal says which rule it broke.
  'apps/api/src/lib/event-import.js':
    'the importer: the platform-held organisation, the review exemption and publication of imported events. Only an administrator\u2019s request reaches it, through the API.',
  'apps/api/src/lib/import-images.js':
    'the API\u2019s one outbound fetcher, with the address ranges it refuses and how it pins a connection. A browser holding it is a map of how to get past it.',
  'apps/api/src/lib/import-dataset.js':
    'the import file\u2019s run-time host checks and the plan it makes against the database.',
  'packages/db/': 'Prisma, the schema, and anything that can open a connection.',
  'packages/providers/': 'payment provider adapters, which hold secret-key handling.',
  'packages/ledger/': 'double-entry posting rules. Server-side money, never client-side.',
  'apps/api/': 'the API server itself.',
})

/**
 * Capability names a browser must never carry, with why.
 *
 * A capability *name* in a client module is the shape of the administrative
 * surface drawn for anybody who opens devtools: which privileged routes exist
 * and what each wants. Client components are given booleans ("may this person
 * invite?") by the Server Component that decided, never the name it decided by.
 * The artefact scan (`scripts/scan-browser-bundle.mjs`) forbids the same names
 * in a build; this refuses them in the source, before one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FORBIDDEN_CLIENT_LITERALS = Object.freeze({
  'platform:admin': 'the super administrators\u2019 capability.',
  'organizer:invite': 'who may invite an organiser to post events (SPEC2 \u00a70.2).',
  'website_redirect:manage':
    'who may switch an event\u2019s website link on or off (SPEC2 \u00a70.2).',
  'analytics:view_all':
    'who may read every event\u2019s visits across the platform (SPEC2 \u00a70.2).',
  'moderation:review': 'who decides whether an event is published.',
  'payout:manage': 'who moves an organiser\u2019s money.',
  'ledger:manage': 'who may adjust the ledger.',
  // SPEC2-XI §0.7: full control of posted events and the import.
  'event:platform_edit':
    'who on the Desi-Event team may edit any organisation\u2019s posted event (SPEC2-XI \u00a70.7).',
  'event:platform_delete':
    'who on the Desi-Event team may delete any event, or restore one (SPEC2-XI \u00a70.7).',
  'event:import': 'who may import listed events and publish them (SPEC2-XI \u00a70.7).',
  'event:delete_unsold':
    'which organisation role may delete an event; the screen is told whether it may, never the name.',
  // SPEC3 §0.4 and SPEC3-XI §13: booking fees, referral codes and paying at the venue.
  'payment_terms:manage':
    'who may set an event\u2019s booking fee and switch paying at the venue (SPEC3 \u00a70.4).',
  'referral_code:manage':
    'who may make, change and read the referral codes that waive the booking fee (SPEC3 \u00a70.4).',
  'platform_fee:refund': 'who may refund a booking fee by hand (SPEC3 \u00a70.4).',
  'venue_booking:cancel':
    'who on the Desi-Event team may cancel unpaid pay-at-the-venue tickets (SPEC3-XI \u00a713); the dialog is told whether it may.',
})

/**
 * Client modules that must stay client modules, each the browser half of a
 * command SPEC3 or SPEC3-XI adds, with what it does.
 *
 * Listed so a refactor that turns one into a Server Component, or deletes it,
 * fails the bundle test rather than silently moving its strings out of the
 * walk: each is walked from, held to the literal rule above, and kept out of
 * browser storage.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REQUIRED_CLIENT_MODULES = Object.freeze({
  'apps/web/src/components/cancel-unpaid-tickets-dialog.jsx':
    'cancels unpaid pay-at-the-venue tickets (`/venue-cancellations`) after listing the booking (`/venue-bookings`).',
  'apps/web/src/components/unpaid-venue-bookings.jsx':
    'lists unpaid pay-at-the-venue bookings and opens the cancel dialog.',
  'apps/web/src/components/referral-code-field.jsx':
    'takes a buyer\u2019s referral code at checkout; the code lives in component state alone.',
  'apps/web/src/components/payment-method-choice.jsx': 'lets a buyer choose to pay at the door.',
  'apps/web/src/components/payment-terms-panel.jsx':
    'sets an event\u2019s booking fee and its pay-at-the-venue switch (`/platform-fee`, `/venue-payment`).',
  'apps/web/src/app/admin/referral-codes/referral-code-form.jsx':
    'makes and changes referral codes (`/v1/platform/referral-codes`).',
  'apps/web/src/app/admin/referral-codes/referral-code-switch.jsx':
    'switches a referral code off and on.',
  'apps/web/src/app/admin/fee-refunds/fee-refund-form.jsx':
    'previews and refunds a booking fee (`/v1/platform/orders/…/fee-refund`).',
})

/**
 * Browser storage a show-once or bearer value must never reach: local and
 * session storage, IndexedDB, the Cookie Store API, the Cache API, and a
 * cookie written from script, whether set (`=`) or appended to (`+=`).
 */
const BROWSER_STORAGE =
  /\b(?:localStorage|sessionStorage|indexedDB|cookieStore)\b|\bcaches\s*(?:\?\.|\.)\s*(?:open|match|has|keys|delete)\s*\(|\bdocument\s*\.\s*cookie\s*\+?=(?!=)/u

/**
 * A module's text with its comments removed, as the storage and literal rules
 * read it.
 *
 * @param {string} source The module's text.
 * @returns {string} The code.
 */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Whether a module's code (comments aside) touches browser storage: local or
 * session storage, IndexedDB, the Cookie Store, the Cache API, or a cookie
 * written from script.
 *
 * Reading `document.cookie` is not storage (the API client reads the CSRF
 * cookie the server set); writing it is.
 *
 * @param {string} source The module's text.
 * @returns {boolean} True when it does.
 */
export function usesBrowserStorage(source) {
  return BROWSER_STORAGE.test(codeOf(source))
}

/**
 * What puts something in the address bar, and so in the history, the
 * `Referer` of the next request and every log that sees the address: the
 * History API, the App Router's navigation, `location` and `window.open`, and
 * a server redirect. A `const location = …` is a name, not a write.
 */
const ADDRESS_BAR_WRITE =
  /\bhistory\s*(?:\?\.|\.)\s*(?:pushState|replaceState)\s*\(|\b[\w$]*[Rr]outer\s*(?:\?\.|\.)\s*(?:push|replace|prefetch)\s*\(|\blocation\s*(?:\?\.|\.)\s*(?:assign|replace)\s*\(|\bwindow\s*(?:\?\.|\.)\s*open\s*\(|\b(?:redirect|permanentRedirect)\s*\(|(?<!\b(?:const|let|var)\s+)\blocation(?:\s*\.\s*(?:href|search|hash|pathname))?\s*=(?![=>])/gu

/**
 * The index of the bracket closing the one at `open`, strings and templates
 * read past.
 *
 * @param {string} code The code.
 * @param {number} open Index of `(`.
 * @returns {number} Index of the matching `)`, or the end of the code.
 */
function closingBracket(code, open) {
  let depth = 0

  for (let at = open; at < code.length; at += 1) {
    const char = code[at]

    if (char === "'" || char === '"' || char === '`') {
      at += 1
      while (at < code.length && code[at] !== char) at += code[at] === '\\' ? 2 : 1
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth += 1

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return at
    }
  }

  return code.length
}

/**
 * Every write to the address bar in a module's code (comments aside), with
 * what it is given: a call's arguments, or what is assigned.
 *
 * @param {string} source The module's text.
 * @returns {Array<{write: string, argument: string}>} The writes, in source order.
 */
export function addressBarWrites(source) {
  const code = codeOf(source)
  const writes = []

  for (const match of code.matchAll(ADDRESS_BAR_WRITE)) {
    const start = match.index + match[0].length
    const called = match[0].endsWith('(')
    const end = called
      ? closingBracket(code, start - 1)
      : Math.min(
          ...[code.indexOf(';', start), code.indexOf('\n', start), code.length].filter(
            (at) => at !== -1,
          ),
        )

    writes.push({
      write: match[0].replace(/[\s(=]+/gu, ''),
      argument: code.slice(start, end).trim(),
    })
  }

  return writes
}

/**
 * The names in an address-bar write's argument that could hold a referral
 * code: anything named for a referral (its id and a constant path aside), and
 * the referral field's own `code` and `draft` (a code's id, `code.id`, aside).
 * The words of a string are not names; what a template substitutes is.
 *
 * @param {string} argument The write's argument text.
 * @returns {string[]} The names found.
 */
export function referralNamesIn(argument) {
  const code = argument
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/gu, "''")
    .replace(/`(?:\\.|[^`\\])*`/gu, (template) =>
      [...template.matchAll(/\$\{([^}]*)\}/gu)].map((substitution) => substitution[1]).join(' '),
    )
  const found = []

  for (const [chain] of code.matchAll(/[\w$]+(?:\s*(?:\?\.|\.)\s*[\w$]+)*/gu)) {
    const parts = chain.split(/\s*(?:\?\.|\.)\s*/u)
    const named = parts.some(
      (part) => /referral/iu.test(part) && !/^[A-Z0-9_]+$/u.test(part) && !/Ids?$/u.test(part),
    )
    const field = /^(?:code|draft)$/u.test(parts[0]) && parts[1] !== 'id'

    if (named || field) found.push(chain)
  }

  return found
}

/**
 * The forbidden capability names a module's code (comments aside) contains.
 *
 * Comments are left out because a minifier drops them: a docstring explaining
 * that a page is for `organizer:invite` holders ships nothing.
 *
 * @param {string} source The module's text.
 * @returns {string[]} The names found, in {@link FORBIDDEN_CLIENT_LITERALS} order.
 */
export function forbiddenLiteralsIn(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

  return Object.keys(FORBIDDEN_CLIENT_LITERALS).filter((literal) => code.includes(literal))
}

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
