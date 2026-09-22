/**
 * Scan a built web application for server-only code that reached the browser.
 *
 * Findings NF-15 and NF-16 were the same mistake twice. The platform's scrypt
 * password hashing arrived in the production client bundle through four hops of
 * individually reasonable barrel imports, and later the deployment environment
 * contract arrived the same way. Nothing in the repository failed either time,
 * because nothing was looking at what the build actually produced.
 *
 * There are two guards now and they catch different things:
 *
 *   - `apps/web/src/lib/browser-bundle.js` walks the *import graph* from every
 *     `'use client'` module. It is fast, it runs in the unit suite, and it
 *     fails on the offending import rather than on a minified chunk. But it
 *     reasons about sources, so a leak that arrives some way it does not model
 *     is invisible to it.
 *   - This script reads the *artefacts*. Every file the browser can fetch —
 *     chunks, route bundles, manifests, prerendered RSC payloads, static HTML,
 *     source maps if the build emits them, service workers if one exists, and
 *     everything under `public/` — is searched for markers of code that must
 *     never leave the server. It is slower and it needs a build, which is
 *     exactly why it is the one that tells the truth.
 *
 * It also checks the other direction. A scan that only forbade things could be
 * satisfied by shipping an empty application, so a handful of strings that the
 * client legitimately needs — capability names it renders, route paths it calls
 * — must be *present*. A capability name is not a secret; the permission table
 * that maps names to roles is.
 *
 * Usage: `pnpm run bundle:scan` after `pnpm run build`.
 *
 * @module scripts/scan-browser-bundle
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The repository root, derived from this file rather than the shell's cwd. */
const root = fileURLToPath(new URL('..', import.meta.url))

/** The built web application. */
const webApp = path.join(root, 'apps/web')

/**
 * Directories whose whole contents the browser can fetch.
 *
 * `.next/static` is served at `/_next/static`; `public` is served at the root.
 * `.next/server/app` holds the prerendered RSC payloads and HTML that Next
 * sends for a static route — server-*rendered*, but browser-*delivered*, which
 * is the distinction that matters here.
 *
 * @type {Array<{dir: string, why: string}>}
 */
const DELIVERABLE_ROOTS = [
  { dir: '.next/static', why: 'served at /_next/static' },
  { dir: 'public', why: 'served at the site root' },
  { dir: '.next/server/app', why: 'prerendered payloads and HTML sent to the browser' },
]

/** Extensions worth reading in those directories. Images carry no code. */
const TEXTUAL = new Set(['.js', '.mjs', '.css', '.json', '.map', '.rsc', '.html', '.txt', '.xml'])

/**
 * Markers that must not appear, grouped by the finding that put them here.
 *
 * Each is a string or regular expression distinctive enough that a match means
 * the module it comes from was bundled, not that a common word collided.
 *
 * @type {Array<object>}
 */
const FORBIDDEN = [
  {
    group: 'NF-15: @desi-event/auth server-only credential code',
    markers: [
      ['scrypt (password hashing)', 'scrypt'],
      ['promisify (node:util in browser)', 'promisify'],
      ['timingSafeEqual', 'timingSafeEqual'],
      ['scrypt tuning: maxmem', 'maxmem'],
      ['scrypt tuning: keyLength', 'keyLength'],
      ['TOTP replay window', 'REPLAY_WINDOW'],
      ['sealing key derivation', 'deriveSealingKey'],
      ['login lockout thresholds', 'LOCKOUT_THRESHOLD'],
      ['pseudonymize (email/IP digesting)', 'pseudonymize'],
      ['session step-up policy table', 'STEP_UP_WINDOWS'],
      ['per-route step-up windows', 'STEP_UP_POLICIES'],
      ['revocation reason vocabulary', 'REVOCATION_REASONS'],
    ],
  },
  {
    group: 'NF-16: deployment and environment contract',
    markers: [
      ['DATABASE_URL', 'DATABASE_URL'],
      ['REDIS_URL', 'REDIS_URL'],
      ['JWT_SECRET', 'JWT_SECRET'],
      ['AUTH_SECRET', 'AUTH_SECRET'],
      ['placeholder-secret blocklist', 'PLACEHOLDER_SECRETS'],
      ['isInsecureJwtSecret helper', 'isInsecureJwtSecret'],
      ['INSECURE_JWT_SECRETS', 'INSECURE_JWT_SECRETS'],
      ['SECURE_COOKIES guidance prose', 'SECURE_COOKIES'],
      ['fee setting PLATFORM_FEE_BPS', 'PLATFORM_FEE_BPS'],
      ['fee setting PLATFORM_FEE_FLAT_CENTS', 'PLATFORM_FEE_FLAT_CENTS'],
      ['TICKET_HOLD_TTL_SECONDS', 'TICKET_HOLD_TTL_SECONDS'],
      ['ALLOW_DEMO_TAX_IN_PRODUCTION', 'ALLOW_DEMO_TAX_IN_PRODUCTION'],
      ['rate-limit budget', 'RATE_LIMIT_MAX'],
    ],
  },
  {
    group: 'job definitions (worker-only)',
    markers: [
      ['QUEUE_NAMES', 'QUEUE_NAMES'],
      ['JOB_NAMES', 'JOB_NAMES'],
      ['job: expire-holds', 'expire-holds'],
      ['job: issue-tickets', 'issue-tickets'],
      ['notification template: event.changed', 'event.changed:'],
      ['notification template: event.cancelled', 'event.cancelled:'],
    ],
  },
  {
    /*
     * The capability each route demands.
     *
     * A browser that holds the list knows which privileged routes exist and
     * what authority each one wants, which is a map of the platform's
     * administrative surface drawn for anybody who opens devtools. The client
     * never needed it: it places requests and reads the answer.
     */
    group: 'route authorisation metadata',
    markers: [
      ['capability: moderation:review', 'moderation:review'],
      ['capability: payout:manage', 'payout:manage'],
      ['capability: ledger:manage', 'ledger:manage'],
      ['capability: platform:admin', 'platform:admin'],
      ['step-up policy name on a route', 'capabilityScope'],
    ],
  },
  {
    /*
     * Things about an event that are the organiser's, the platform's, or
     * nobody's — and specifically not a visitor's.
     *
     * These are field *names*, and a field name in a bundle means the object
     * carrying it was rendered into one. The public event payload is an
     * allow list twice over (`toEventDetail` names each field,
     * `eventWithRelationsSchema` drops the rest), and this is the third check:
     * whatever the server sends, none of it reached a browser.
     */
    group: 'private event and organiser data',
    markers: [
      ['organiser contact address', 'contactEmail'],
      ['payout currency', 'payoutCurrency'],
      ["a moderator's private note", 'moderationNote'],
      ['submission timestamp', 'reviewSubmittedAt'],
      ['internal fee table', 'FEE_CONFIG_BY_CURRENCY'],
      ['internal tax table', 'TAX_POLICIES'],
    ],
  },
  {
    group: 'the surfaces added for gate 13',
    markers: [
      // The analytics library and its derivations. What an organisation is owed
      // is computed from the ledger on the server; a browser holding the
      // derivation is a browser that can be argued with about the answer.
      ['analytics derivation', 'organizerAnalytics'],
      ['analytics breakdown builder', 'salesBreakdowns'],
      ['analytics export allow list', 'EXPORT_COLUMNS'],
      ['reserved-seat inventory derivation', 'reservedSeatInventory'],
      // The reconciliation evidence allow list. Shipping it tells a reader
      // which keys are dropped, which is the shape of the redaction rather
      // than the redaction itself — useful only to somebody probing it.
      ['reconciliation evidence allow list', 'RECONCILIATION_EVIDENCE_KEYS'],
      ['reconciliation evidence projection', 'toEvidence'],
      // Refund internals. The allocator decides how much of a refund is face
      // value, fee and tax; the browser is told the answer and never the rule.
      ['refund allocator', 'allocateRefund'],
      ['refund state table', 'REFUND_STATES'],
      // Ticket credential material, by every name it has. A browser that can
      // name the deriver is a browser somebody will try to derive from.
      ['ticket credential hash column', 'credentialHash'],
      ['ticket credential version column', 'credentialVersion'],
      ['transfer token minting', 'mintTransferToken'],
      ['transfer token column', 'tokenHash'],
      // Where the masking happens.
      //
      // The column itself, `toEmail`, cannot be a needle: it is a field name in
      // `startTicketTransferRequestSchema`, so a screen that offers a ticket has
      // to name it in the request body, and a scan for the string cannot tell
      // that from the stored address coming back. What it *can* check is that
      // masking stays a server concern — if `maskRecipient` ever reached the
      // browser, the raw address would have had to reach it first, which is the
      // failure the needle is for. The masked value itself is asserted in
      // `ticket-lifecycle.test.js`, where a runtime value can actually be read.
      ['transfer recipient masking', 'maskRecipient'],
    ],
  },
  {
    group: 'permission tables (server-only)',
    markers: [
      ['ORG_ROLE_GRANTS', 'ORG_ROLE_GRANTS'],
      ['PLATFORM_ROLE_CAPABILITIES', 'PLATFORM_ROLE_CAPABILITIES'],
      ['ORG_ROLE_INHERITS', 'ORG_ROLE_INHERITS'],
      ['findRoleCycle (graph internals)', 'findRoleCycle'],
      ['resolveAll (capability resolution)', 'resolveAll'],
      ['PLATFORM_ONLY_CAPABILITIES', 'PLATFORM_ONLY_CAPABILITIES'],
    ],
  },
  {
    group: 'database, provider and ledger internals',
    markers: [
      ['PrismaClient', 'PrismaClient'],
      ['prisma adapter', '@prisma/adapter-pg'],
      ['ledger account codes', 'LEDGER_ACCOUNTS'],
      // Written split so this file does not itself contain the literal a
      // secret scanner looks for.
      ['Stripe secret key prefix', new RegExp(['sk', 'live'].join('_'))],
      ['Stripe webhook secret prefix', new RegExp(['whsec', ''].join('_'))],
    ],
  },
  {
    group: 'commerce service internals (Phase 2 cycle 4)',
    markers: [
      // State tables. The browser renders a status it was given; it has no
      // business knowing which transitions exist, because a client that knows
      // the machine is a client somebody will try to drive it from.
      ['refund transition table', 'REFUND_TRANSITIONS'],
      ['payout transition table', 'PAYOUT_TRANSITIONS'],
      ['transfer transition table', 'TRANSFER_TRANSITIONS'],
      ['dispute transition table', 'DISPUTE_TRANSITIONS'],
      ['ticket transition table', 'TICKET_TRANSITIONS'],
      ['outbox transition table', 'OUTBOX_TRANSITIONS'],
      ['reconciliation transition table', 'TASK_TRANSITIONS'],
      // What the *evidence* is allowed to conclude, and how a conclusion maps
      // to a closure. This is the server's decision procedure.
      //
      // The needle here used to be `SETTLED_FROM_PROVIDER`, on the reasoning
      // that "a client that could name a verdict is a client that could propose
      // one". That was pointing at the wrong string. `SETTLED_FROM_PROVIDER` is
      // a member of `resolveReconciliationRequestSchema` — a *request* enum, in
      // the published OpenAPI document — so an operator's screen has to name it
      // in order to close anything, and naming it proposes nothing: the resolve
      // route re-queries the provider and refuses any closure the answer does
      // not support. The verdict vocabulary is published too, as a response
      // field on the re-query route.
      //
      // What is genuinely server-only is the procedure: which verdict the
      // evidence yields, and which closures each verdict permits. Those are the
      // two names below, and neither appears in any schema.
      ['reconciliation verdict mapping', 'RESOLUTIONS_FOR_VERDICT'],
      ['reconciliation evidence comparison', 'compareEvidence'],
      // Credential derivation. The pass is derived from AUTH_SECRET; the
      // purpose string is half of what a forger would need to know.
      ['ticket credential purpose', 'ticket-pass-v1'],
      ['ticket credential deriver', 'mintTicketCredential'],
      ['transfer token digest', 'transferTokenDigest'],
      // Operational metadata. Lease ownership, retry maths and dedupe keys are
      // how the worker coordinates with itself.
      ['outbox lease claim', 'claimableWhere'],
      ['outbox retry schedule', 'BASE_RETRY_DELAY_MS'],
      ['outbox dedupe key shape', 'dedupeKeyFor'],
      // Balance arithmetic. What is held against an organiser's payable is a
      // server judgement, and the function that makes it is server-only.
      ['organiser balance derivation', 'availableBalance'],
      ['ledger imbalance scan', 'findImbalances'],
      // The load suite's own internals, which are not part of the product.
      ['load thresholds', 'HEALTH_LIMITS'],
    ],
  },
]

/**
 * Strings the client legitimately needs, which a leak-hunting scan must not
 * quietly delete along with the leaks.
 *
 * A capability *name* is one of these. The client renders "you cannot do this"
 * from names, and a build that stripped them would pass every check above by
 * shipping an application that does nothing. The permission *table* that maps
 * names to roles is the secret, and it is forbidden above.
 *
 * Only names the client genuinely uses belong here. `venue:manage`, for
 * instance, appears in the server render but never reaches the browser, which
 * is correct — requiring it would be requiring a leak.
 *
 * @type {Array<string[]>}
 */
const REQUIRED = [
  // `moderation:review` used to be here, and it is deliberately gone.
  //
  // It was in the bundle because the route table carried each route's required
  // *capability*, and the browser's API client imported that table for its
  // paths. No client component ever read it: the only capability check in the
  // browser's half of this application is in a Server Component, where it
  // belongs. Requiring it here would be requiring the leak that put it there.
  ['route path /v1/organizers', '/v1/organizers'],
  ['route path /v1/venues', '/v1/venues'],
  ['route path /v1/auth/login', '/v1/auth/login'],
  ['route path /v1/venue-map-versions', '/v1/venue-map-versions'],
  ['CSRF double-submit header', 'x-desi-csrf'],
  ['accessibility vocabulary', 'STEP_FREE_ENTRANCE'],
  // The finance and operations screens are server-rendered, so their route
  // paths reach the browser only through the client's API base. What must be
  // present is the export link the finance page renders, because a build that
  // dropped it would pass every forbidden check above by shipping a screen with
  // no way to get the data out.
  ['finance export path', '/v1/finance/export.csv'],
  // The same argument for the surfaces added this cycle. Each is a client
  // component that issues a command, so its path must reach the browser — and
  // a build that dropped one would pass every forbidden check above by shipping
  // a screen whose buttons do nothing.
  ['reconciliation action path', '/v1/operations/reconciliation/'],
  ['refund action path', '/v1/refunds/'],
  ['ticket transfer path', '/v1/ticket-transfers/'],
  // The door. Both halves must ship: a build with the lookup and no admission
  // would be a screen that shows who is at the door and can never let them in.
  ['door lookup path', '/v1/tickets/admission/preview'],
  ['door admission path', '/v1/tickets/check-in'],
]

/**
 * Every file under a directory, recursively.
 *
 * @param {string} dir Where to start.
 * @returns {Promise<string[]>} Absolute paths.
 */
async function walk(dir) {
  /** @type {string[]} */
  const found = []

  /** @type {Array<{name: string, isDirectory: Function}>} */
  let entries

  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) found.push(...(await walk(full)))
    else found.push(full)
  }

  return found
}

/**
 * Whether a marker appears in a file's contents.
 *
 * @param {string} contents The file.
 * @param {string|RegExp} marker What to look for.
 * @returns {boolean} True when present.
 */
function matches(contents, marker) {
  return typeof marker === 'string' ? contents.includes(marker) : marker.test(contents)
}

/**
 * Scan the build and report.
 *
 * @returns {Promise<void>} Resolves once reported; exits non-zero on a finding.
 */
async function main() {
  const built = await stat(path.join(webApp, '.next')).catch(() => null)

  if (!built) {
    console.error('No build to scan. Run `pnpm run build` first.')
    process.exitCode = 1
    return
  }

  /** @type {Array<{path: string, relative: string, contents: string}>} */
  const files = []

  for (const { dir } of DELIVERABLE_ROOTS) {
    for (const file of await walk(path.join(webApp, dir))) {
      if (!TEXTUAL.has(path.extname(file).toLowerCase())) continue

      files.push({
        path: file,
        relative: path.relative(root, file),
        contents: await readFile(file, 'utf8').catch(() => ''),
      })
    }
  }

  const sourceMaps = files.filter((file) => file.relative.endsWith('.map'))
  const serviceWorkers = files.filter((file) =>
    /(^|\/)(sw|service-worker|workbox-[^/]*)\.js$/.test(file.relative),
  )

  console.log(`browser-deliverable files scanned: ${files.length}`)

  for (const { dir, why } of DELIVERABLE_ROOTS) {
    const count = files.filter((file) =>
      file.relative.startsWith(path.join('apps/web', dir) + path.sep),
    ).length

    console.log(`  ${String(count).padStart(4)}  ${dir}  (${why})`)
  }

  console.log(`  source maps: ${sourceMaps.length === 0 ? 'none emitted' : sourceMaps.length}`)
  console.log(
    `  service workers: ${serviceWorkers.length === 0 ? 'none present' : serviceWorkers.length}`,
  )

  let leaked = 0

  for (const { group, markers } of FORBIDDEN) {
    console.log(`\n--- ${group} ---`)

    for (const [label, marker] of markers) {
      const hits = files.filter((file) => matches(file.contents, marker))

      if (hits.length === 0) {
        console.log(`absent  ${label}`)
        continue
      }

      leaked += 1
      console.log(`LEAKED  ${label}`)

      for (const hit of hits.slice(0, 5)) console.log(`          ${hit.relative}`)
      if (hits.length > 5) console.log(`          … and ${hits.length - 5} more`)
    }
  }

  let missing = 0

  console.log('\n--- legitimate client-side strings that must be preserved ---')

  for (const [label, marker] of REQUIRED) {
    const hits = files.filter((file) => matches(file.contents, marker))

    if (hits.length === 0) {
      missing += 1
      console.log(`MISSING ${label}`)
      continue
    }

    console.log(`present ${label}  (${hits.length} file(s))`)
  }

  console.log('')

  if (leaked > 0 || missing > 0) {
    console.error(
      `Browser bundle scan: ${leaked} server-only marker(s) leaked, ${missing} required string(s) missing.`,
    )
    process.exitCode = 1
    return
  }

  console.log(
    `Browser bundle scan: OK — ${files.length} browser-deliverable files, nothing server-only present.`,
  )
}

await main()
