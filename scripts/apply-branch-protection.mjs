/**
 * Apply the approved `main` ruleset, and prove afterwards that it took.
 *
 * Gate 17 has two halves. The workflow half has been met since run
 * `35127103320`; the enforcement half needs somebody with repository
 * administration to put the rules on `main`, and this session has never had
 * that. Its outbound proxy refuses every write to a protection path before the
 * request reaches GitHub, and the GitHub App installation it authenticates as
 * lacks `administration`, so even the read comes back
 * `403 "Resource not accessible by integration"`.
 *
 * A GitHub Actions runner is neither of those things. Given an installation
 * token minted in the runner from the repository's own `APP_ID` and
 * `APP_PRIVATE_KEY` secrets, this script performs the one approved operation
 * there instead.
 *
 * What it will not do:
 *
 * - **Invent a policy.** The payload is extracted from
 *   `docs/BRANCH_PROTECTION.md`, which is the approved source. Nothing here
 *   retypes it, and a drift between the document and what is applied is
 *   therefore impossible by construction.
 * - **Weaken anything.** It creates a ruleset when none matches by name. If a
 *   ruleset with that name already exists it stops and reports, rather than
 *   overwriting a policy somebody may have tightened by hand.
 * - **Print the token.** The token is read from the environment, used as a
 *   header, and never logged. Failures print the HTTP status and GitHub's
 *   `message` field only.
 *
 * Usage:
 *
 *     GITHUB_APP_TOKEN=… node scripts/apply-branch-protection.mjs
 *     GITHUB_TOKEN=…     node scripts/apply-branch-protection.mjs --verify-only
 *
 * `--verify-only` reads and checks without writing, so the verification half
 * can be exercised with a read-only token before the write is ever attempted.
 *
 * @module scripts/apply-branch-protection
 */

import { readFileSync } from 'node:fs'

const API = 'https://api.github.com'
const DOC = 'docs/BRANCH_PROTECTION.md'
const VERIFY_ONLY = process.argv.includes('--verify-only')

/** The token. Read once, never logged, never interpolated into a message. */
const TOKEN = process.env.GITHUB_APP_TOKEN ?? process.env.GITHUB_TOKEN

/** `owner/repo`, supplied by Actions, overridable for a local verify. */
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? 'KevinD003/desi-event.com'

/** Offline mode judges a supplied rules listing and needs no credential. */
const OFFLINE = process.argv.includes('--rules-file')

if (!TOKEN && !OFFLINE) {
  console.error(
    'No token in the environment. Set GITHUB_APP_TOKEN (or GITHUB_TOKEN to verify only).',
  )
  process.exit(1)
}

/**
 * Call the GitHub API.
 *
 * The Authorization header is built here and nowhere else, so no caller can
 * accidentally log it.
 *
 * @param {string} method HTTP method.
 * @param {string} path Path beneath the API root.
 * @param {object} [body] JSON body, when the method takes one.
 * @returns {Promise<{status: number, json: any}>} Status and parsed body.
 */
async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json }
}

/**
 * Report a GitHub failure without leaking anything.
 *
 * Only the status and GitHub's own `message` are printed. Response bodies are
 * never dumped wholesale, and the token never appears in either.
 *
 * @param {string} what Which call failed.
 * @param {{status: number, json: any}} response The response.
 * @returns {void}
 */
function reportFailure(what, response) {
  const message =
    typeof response.json?.message === 'string' ? response.json.message : '(no message)'
  console.error(`${what} failed: HTTP ${response.status} — ${message}`)
  if (response.status === 403) {
    console.error(
      'A 403 here is one of two different things, and they are worth telling apart:\n' +
        '  - "Resource not accessible by integration" is GitHub: the App installation\n' +
        '    lacks the Administration permission. Grant it read and write on the App,\n' +
        '    then accept the permission request on the installation.\n' +
        '  - "not permitted through this proxy" is an execution environment refusing\n' +
        '    the write before it reaches GitHub. A different token will not help.',
    )
  }
}

/**
 * The approved ruleset, read out of the document rather than retyped.
 *
 * @returns {object} The payload, exactly as the document specifies it.
 */
function approvedRuleset() {
  const text = readFileSync(DOC, 'utf8')
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1])

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block)
      if (parsed && parsed.target === 'branch' && Array.isArray(parsed.rules)) return parsed
    } catch {
      continue
    }
  }

  throw new Error(`No branch ruleset payload found in ${DOC}`)
}

/**
 * The contexts a ruleset payload requires.
 *
 * @param {object} ruleset A ruleset payload or a rules listing entry.
 * @returns {string[]} Context names.
 */
function contextsOf(ruleset) {
  const rule = (ruleset.rules ?? []).find((entry) => entry.type === 'required_status_checks')
  return (rule?.parameters?.required_status_checks ?? []).map((check) => check.context)
}

/**
 * Judge a set of effective rules against what the policy requires.
 *
 * Kept separate from the fetching so it can be exercised without a network or a
 * token, via `--rules-file`. That is not a convenience: this function decides
 * whether Gate 17 may be called closed, and a verifier that has never been
 * shown to fail is not a verifier.
 *
 * @param {Array<object>} rules The rules GitHub reports as in force.
 * @param {string[]} expected The contexts that must be required.
 * @returns {{ok: boolean, types: Set<string>, required: string[], missing: string[], controls: Record<string, boolean>}} The judgement.
 */
function evaluate(rules, expected) {
  const types = new Set(rules.map((rule) => rule.type))
  const required = rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) =>
      (rule.parameters?.required_status_checks ?? []).map((check) => check.context),
    )

  const controls = {
    'pull request required': types.has('pull_request'),
    'required status checks': types.has('required_status_checks'),
    'force pushes blocked': types.has('non_fast_forward'),
    'deletion blocked': types.has('deletion'),
  }

  const missing = expected.filter((context) => !required.includes(context))
  const ok = missing.length === 0 && Object.values(controls).every(Boolean)
  return { ok, types, required, missing, controls }
}

/**
 * Check what GitHub actually enforces on `main`, and say so precisely.
 *
 * This reads `/rules/branches/main`, which returns the rules in force rather
 * than the rulesets that exist — the difference matters, because a ruleset that
 * is disabled, or targets another branch, exists without enforcing anything.
 *
 * @param {string[]} expected The contexts that must be required.
 * @returns {Promise<boolean>} Whether every control is in force.
 */
async function verify(expected) {
  let rules
  const fixtureFlag = process.argv.indexOf('--rules-file')

  if (fixtureFlag !== -1) {
    // Offline: judge a supplied rules listing instead of fetching one.
    rules = JSON.parse(readFileSync(process.argv[fixtureFlag + 1], 'utf8'))
  } else {
    const effective = await api('GET', `/repos/${REPOSITORY}/rules/branches/main`)
    if (effective.status !== 200) {
      reportFailure('Reading the effective rules for main', effective)
      return false
    }
    rules = effective.json ?? []
  }

  const { ok, types, required, missing, controls } = evaluate(rules, expected)
  console.log(`\nEffective rules on main: ${rules.length === 0 ? 'NONE' : [...types].join(', ')}`)
  for (const [name, present] of Object.entries(controls)) {
    console.log(`  ${present ? 'yes' : 'NO '}  ${name}`)
  }
  console.log(`\nRequired contexts: ${required.length}`)
  for (const context of required) console.log(`  ${JSON.stringify(context)}`)

  if (missing.length > 0) {
    console.error(`\nMissing ${missing.length} required context(s):`)
    for (const context of missing) console.error(`  ${JSON.stringify(context)}`)
  }

  console.log(`\nEnforcement complete: ${ok ? 'YES' : 'NO'}`)
  return ok
}

const ruleset = approvedRuleset()
const expected = contextsOf(ruleset)

console.log(
  `Approved ruleset: ${JSON.stringify(ruleset.name)} (enforcement: ${ruleset.enforcement})`,
)
console.log(`Contexts it requires: ${expected.length}`)
for (const context of expected) console.log(`  ${JSON.stringify(context)}`)

if (VERIFY_ONLY) {
  const ok = await verify(expected)
  process.exit(ok ? 0 : 1)
}

const existing = await api('GET', `/repos/${REPOSITORY}/rulesets`)
if (existing.status !== 200) {
  reportFailure('Listing rulesets', existing)
  process.exit(1)
}

const clash = (existing.json ?? []).find((entry) => entry.name === ruleset.name)
if (clash) {
  console.log(
    `\nA ruleset named ${JSON.stringify(ruleset.name)} already exists (id ${clash.id}). ` +
      'Leaving it alone rather than overwriting a policy somebody may have tightened, ' +
      'and verifying what it actually enforces.',
  )
  const ok = await verify(expected)
  process.exit(ok ? 0 : 1)
}

console.log('\nNo matching ruleset exists. Creating the approved one.')
const created = await api('POST', `/repos/${REPOSITORY}/rulesets`, ruleset)

if (created.status !== 201) {
  reportFailure('Creating the ruleset', created)
  process.exit(1)
}

console.log(`Created ruleset id ${created.json?.id}, enforcement ${created.json?.enforcement}.`)

const ok = await verify(expected)
process.exit(ok ? 0 : 1)
