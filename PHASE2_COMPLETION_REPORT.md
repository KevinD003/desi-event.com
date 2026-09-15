# Phase 2 completion report

**Status: `PARTIAL`.**

Phase 2 is not finished. The most recent cycle reconciled the browser-exposure
audit to the last agent, re-verified NF-15 and NF-16 against a clean production
build, and built the venue and venue-map vertical slice end to end. Fourteen of
the twenty completion gates remain unmet or partial, §12 lists them one by one,
and Phase 3 has not been started.

Saying so first is the point. A report that opens with what was built and leaves
the reader to infer what was not is the failure mode this document exists to
avoid.

|                                       |                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Phase 2 starting commit               | `efdd640` (Phase 1 closure)                                                                               |
| Latest cycle's starting commit        | `3f5add0`                                                                                                 |
| Latest cycle's last executable commit | `e1b2069`                                                                                                 |
| Branch                                | `claude/desi-event-js-stack-gb4uqe`                                                                       |
| Upstream                              | `origin/claude/desi-event-js-stack-gb4uqe`, in sync                                                       |
| Working tree                          | clean                                                                                                     |
| Unit, integration and database        | **3,836 passed, 0 failed, 0 skipped**, 135 files, 16 suites                                               |
| End-to-end                            | **118** against `next dev`, **19** against a compiled build, **13** organiser journeys against a live API |
| Database checks                       | **68/68** fresh, **19/19** populated-upgrade                                                              |
| Browser bundle scan                   | **173 files, nothing server-only present**                                                                |
| Stripe test credentials               | **none supplied**                                                                                         |
| Real Stripe sandbox operations        | **none, and none claimed**                                                                                |
| Production payments                   | **disabled and unreachable**                                                                              |

**Current status lives in `PHASE2_STATUS.md`**, which is authoritative wherever
this document and it disagree. This one is an account of the `e93d4e9`…`b37b242`
cycle plus the gate scoring; passages that time has overtaken are marked
`HISTORICAL STATUS — SUPERSEDED` in place rather than rewritten.

The cycle-by-cycle verification detail — every command, exit code, duration,
failure and root cause, and the full 19-agent audit reconciliation — is in
`PHASE2_FINAL_VERIFICATION_REPORT.md`.

---

## 1. Commits

The latest cycle, from `3f5add0`:

```
10ab0d3  style: format the files this session added
4c07ee3  test(web): correct the not-found expectation for /organizers, which now has a route
98dd142  feat(venue-maps): author a seating layout whole, publish it once, clone it after
ef5f03d  feat(web): public venue page, with accessibility as fifteen claims
a3fa449  feat(web): the authenticated organiser area, and the seating-map editor
71a3b8e  feat(web): venue authoring end to end, and the browser journeys that prove it
02747f4  test(security): scan the built bundle for server-only code, not just the imports
e1b2069  fix(web): keep the organiser journeys out of the API-down browser suite
```

69 files changed, 11,888 insertions, 421 deletions since `3f5add0`. Security
work and venue work are in separate commits; nothing was combined for
convenience.

The cycle before it, from `e93d4e9`:

```
0786fdf  fix(contract): make the committed OpenAPI artefact impossible to leave stale
3a2d4ff  fix(authz): require and verify a capability scope, closing the rest of NF-05
c5daa04  feat(ledger): post balanced batches, and prove the database refuses the rest
d2d00e3  feat(checkout): settle an order into the ledger and its reserved seats
b5abe1e  feat(checkout): turn an ambiguous charge into a work item, not just a flag
b37b242  fix(auth): stop rotating a session secret the holder cannot be told about
```

29 files changed, 3,535 insertions, 123 deletions. No history was rewritten,
squashed or force-pushed at any point in Phase 2, and no secret, local database,
personal data, provider payload or build cache has been committed.

## 2. Corrections to the previous report

The brief asked for these specifically. All three were wrong in
`PHASE2_IMPLEMENTATION_REPORT.md` as it stood at `e93d4e9`, and all three are
corrected in place there as well as recorded here.

| Claim                                        | Reality                                                                                                                                                | How it was established                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Ten commits landed six of them"             | **Thirteen** commits from `efdd640` through `926d1a3`. The same document's own commit list showed thirteen; only the prose was stale.                  | `git log --oneline efdd640..926d1a3`                                                                                                                                                                                                                                                             |
| "Phase 1 ended at 2,769. Phase 2 added 680." | Phase 1 ended at **2,160** across 13 workspaces. Phase 2 added **1,289**. The 2,769 figure had no provenance.                                          | Every suite re-run at `efdd640` in a throwaway git worktree. The per-workspace numbers sum to exactly the 2,160 that `PHASE1_FINAL_CLOSURE_REPORT.md` recorded at `728ca3a` — the commit `efdd640` sits on, and from which it changed no code at all: five documentation files and `.gitignore`. |
| "`pnpm test` — 3,449 passed, 0 failed"       | **3,444 passed, 5 skipped, 0 failed.** `apps/worker/tests/redis-integration.test.js` skips itself when Redis is unreachable, and no Redis was running. | Re-ran the worker suite with and without Redis: 178 passed / 5 skipped, then 183 passed / 0 skipped.                                                                                                                                                                                             |

The third is the one worth dwelling on. Reporting a skip as a pass is precisely
what a verification table exists to prevent, and it happened inside a document
whose stated purpose was to avoid it. Every verification in this cycle was run
with PostgreSQL **and** Redis up, and the report says so rather than leaving the
reader to assume it.

## 3. NF-06: the OpenAPI drift check, and its proof

**Closed.**

The old `contract:check` validated the route table against an OpenAPI document
it generated from that same route table. The two always agreed, so the committed
`apps/api/openapi.json` — the document clients actually read — was never looked
at. Worse, `pnpm build` ran the emitter, so a stale artefact was rewritten rather
than reported; the only symptom was a dirty working tree.

`apps/api/src/lib/openapi-artifact.js` now compares the committed file against a
freshly generated document two ways:

- **byte-identical**, which is the real requirement, since the file on disk is
  the published contract; and
- **semantically**, after sorting object keys, so a reordered route table is
  reported as "same API, regenerate it" rather than as an API change. Different
  sentences, because they call for different responses.

A differing set of operations is named operation by operation. `pnpm build` runs
`--check` and never writes; `pnpm openapi:emit` is the only writer;
`pnpm contract:check` runs both.

**The proof, performed rather than asserted.** A one-word change to a route
summary in `packages/api-contract/src/routes.js`:

| Command                                   | Before the defect | With the defect         | After restoring |
| ----------------------------------------- | ----------------- | ----------------------- | --------------- |
| `contract validate` alone (the old check) | exit 0            | **exit 0**              | exit 0          |
| `pnpm openapi:check` (the new check)      | exit 0            | **exit 1**              | exit 0          |
| `apps/api/tests/openapi-artifact.test.js` | 14 passed         | **1 failed, 13 passed** | 14 passed       |

The old validator still exiting 0 _with the defect in place_ is the blind spot,
demonstrated. `packages/api-contract/src/routes.js` and `apps/api/openapi.json`
were restored and both SHA-256 hashes verified identical to before.

## 4. NF-05, the half that was still open

The previous report recorded NF-05 as closed. It was half closed, and the
remaining half was reachable by _forgetting_ a field rather than by spelling one
wrong — which is the more likely mistake.

The first fix let a route declare where its organisation is and checked the
declaration. But nothing _required_ a declaration. A route that omitted
`capabilityScope` fell back to hunting for an `organizationId` in the body, the
query and the params; a path like `/v1/organizations/:id/members` spells it `id`,
so the fallback found nothing and the capability was asserted with no
organisation — which refuses every organiser and passes every platform admin.
And a declared scope was only checked as far as the request _part_: naming a key
the schema does not have passed validation and degraded identically at runtime.

Both are now unregisterable:

- an organisation-scoped capability **must** declare a scope;
- a platform-only capability **must not** (the scope would be silently ignored);
- a declared scope is checked down to the key, which must exist in that route's
  own schema and must be **required** — optional is no good, because an optional
  field is absent on exactly the request that wants it absent.

`objectKeysOf` reads the shape through the wrappers this repository uses,
searching both sides of a pipe: `z.preprocess` puts the object on one side and
`.transform()` on the other, and following only one returns null — which would
have made the rule advisory precisely where it has to bind.

The runtime fallback is deleted. A guard asked to assert an organisation
capability with no scope now refuses and logs it, including for the platform
admin. That last part is the one that matters: a guard which refuses an organiser
and admits an admin is worse than one that refuses both, because only the second
gets noticed.

Fourteen contract tests and eight guard tests. One is a standing assertion over
the real route table, so the next route to forget a scope fails the suite.

## 5. The financial ledger

The schema has enforced a balanced, append-only ledger since `7777322`. Nothing
wrote to it. Every paid order was money the business could not see in the one
place built to show it.

`@desi-event/ledger` is pure — what each commerce event posts, with no database,
no clock and no ids — and `apps/api/src/lib/ledger.js` writes it. The same split
as the seating code, for the same reason: deciding what should happen and finding
out whether it did are different problems, and only the second needs a
transaction.

The composition is where the marketplace shows through:

| Event             | Debit                                                          | Credit                                               |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Order paid        | processor clearing (what the buyer paid), promotional discount | organiser payable, platform fee revenue, tax payable |
| Refund decided    | organiser payable, platform fee revenue, tax payable           | refund clearing                                      |
| Refund settled    | refund clearing                                                | processor clearing                                   |
| Dispute opened    | organiser payable                                              | dispute clearing                                     |
| Dispute won       | dispute clearing                                               | organiser payable                                    |
| Dispute lost      | dispute clearing                                               | processor clearing                                   |
| Transfer          | organiser payable                                              | transfer clearing                                    |
| Transfer reversed | transfer clearing                                              | organiser payable                                    |
| Payout            | payout clearing                                                | transfer clearing                                    |
| Payout failed     | transfer clearing                                              | payout clearing                                      |
| Correction        | every entry of the original, flipped                           |                                                      |

What the buyer pays is credited to the organiser as a **liability**. Only the fee
is revenue. Tax is a liability to an authority. A discount is contra-revenue on
the debit side, so the organiser is credited full face value and the money given
away stays visible instead of vanishing into a smaller payable. A marketplace
that credits the ticket price to its own revenue balances perfectly and
overstates itself by the whole of every ticket sold, so the assertions pin down
the **account** each amount lands in, not just the arithmetic.

Every amount is positive; direction carries the sign. A negative amount would
lose the distinction between "money moved back" and "money never moved", which is
the distinction a dispute turns on.

**Two bugs found by writing the tests**, both kept as regression cases:

1. `postBatch` treated any unique violation as "already posted". `reference` is
   unique too, so a reference collision returned somebody else's batch and the
   caller carried on believing its money had been recorded. Only an
   idempotency-key collision counts as a retry now, and `violatedFields` reads the
   constraint name from both places Prisma puts it — `meta.target` on the classic
   engine, `meta.driverAdapterError.cause.constraint` on the driver adapter this
   project uses. Reading one gives an empty list, indistinguishable from "some
   other constraint".
2. The integration suite could not delete its own rows: `desi_ledger_entry_immutable`
   refuses a raw SQL `DELETE` of a posted batch's entries. That is the invariant
   working, so the teardown was removed and an assertion took its place. A test
   that disables a guard in order to tidy up has quietly disabled the guard.

**Evidence.** 33 composition tests with no database. 13 integration tests against
real PostgreSQL inside `pnpm db:verify:fresh`, including six concurrent posts of
one source event producing exactly one batch, an unbalanced batch whose stored
totals _claim_ to balance being refused by the trigger, and posted batches and
entries resisting update and delete through both Prisma and raw SQL.

## 6. Checkout: the ledger and the seats

Settlement issued tickets, decremented inventory and recorded a payment. It now
also, inside the same transaction that already makes settlement idempotent:

- **posts the ledger batch**, composed from the order's own stored totals, which
  were computed from the versioned pricing snapshot at checkout rather than from
  fee tables that may have moved since; and
- **sells the reserved seats**, moving each held seat `HELD → SOLD` and linking it
  to the order line of its ticket type.

The seats move inside the transaction rather than after it because a seat that is
paid for and still `HELD` is a seat the expiry sweep can release out from under a
ticket. A held seat whose ticket type is not on the order throws rather than being
skipped — skipping would sell the rest and leave that one held against a paid
order.

A decline posts nothing. A free order posts nothing: a zero-value batch would
satisfy the balance rule and mean nothing.

**The provider is still called with no transaction open**, and the Phase 1 test
that proves it by counting open transactions at the moment of the call still
passes. Nothing in this cycle moved a provider call inside a transaction; the
ledger post is a database write and sits where the other database writes are.

## 7. Reconciliation: a flag became a work item

A provider timeout set `reconciliationRequired` on the payment and stopped there.
Nothing read that column. An order whose charge may or may not have succeeded sat
in the database waiting to be noticed by somebody who happened to look, which is
the same as not being handled.

`recordCaptureTimeout` now opens a `PAYMENT_TIMEOUT` reconciliation task in the
same transaction, reusing the deduplicating `openReconciliation` the webhook path
already uses, so a retry increments one task rather than creating a second. The
task carries what was believed at the moment it was created, verbatim.

The order stays `PENDING` and the inventory stays held. That was already right and
is worth restating: cancelling an order whose charge may have succeeded is how you
either refund money that was never taken or strand a buyer who was in fact
charged.

**What is still missing** is the operator surface — search, compare against the
provider, re-query, replay, attach a result, resolve, escalate. The queue fills
and nobody can empty it through the product. That is gate 7, and it is unmet.

## 8. Session rotation: an outage on a timer

Found by auditing this repository's own claims rather than by a test failing.

Scheduled rotation replaced a session's secret however the caller presented it,
but the replacement was only ever written back as a `Set-Cookie`. A client using
the bearer form — which the module explicitly supports — was locked out at the
first rotation window: an hour for a privileged session, a day for an attendee
one. It would present a secret that no longer resolved to anything and get a 401
saying the session had ended, with no channel through which to learn the new one.

Rotating a credential the holder cannot learn is not a security control.

`refreshSession` now rotates only when the new secret can be delivered. A
bearer-presented session is reported as `rotationDeferred`, logged rather than
silently skipped, and remains bounded by the same absolute expiry every session
has. Returning the secret in a custom response header was considered and
rejected: `Set-Cookie` is redacted by convention in every logging layer between
here and the client, and a bespoke header carrying a session secret is not.

Confirmed against the defect: restoring `canDeliverSecret: true` makes the new
test fail with exactly the symptom — 401 where 200 was expected.

## 9. New findings

**NF-06** — the OpenAPI drift blind spot. **Closed**, §3.

**NF-07** — a trigger with no probe. **Closed** in the previous cycle.

**NF-08** — the capability-scope hole, the other half of NF-05. **Closed**, §4.

**NF-09** — scheduled rotation locked out bearer clients. **Closed**, §8.

**NF-10** — _open._ The session module's own docstring claims rotation on "sign-in,
password change, MFA enrolment, step-up". Only the password change rotates.
`auth.confirmTotp` revokes sibling sessions and stamps `mfaSatisfiedAt` but does
not rotate; `auth.stepUp` only stamps. Sign-in is a new session rather than a
rotation, so the claim holds there by construction. The consequence is modest —
a secret that was valid before a factor was added is still valid after — but the
documentation overstates the control, which is the part worth fixing.

**NF-11** — _open._ `requireStepUp` takes no arguments and always uses the
module's fifteen-minute default. A finance route cannot demand a tighter window
even though `stepUpSatisfied` already accepts one. The contract flag is a bare
boolean. No finance route exists yet, so nothing is currently affected.

**NF-12** — _open, and the most serious of the three._ Nothing requires a
privileged account to enrol a second factor, and the step-up challenge asks for a
code only when the account _has_ one — so a finance administrator with no factor
satisfies step-up with the same password the session was opened with. Step-up on
such an account is not a second factor; it is a re-typed first one. Closing it
needs a decision about enrolment grace, since the MFA enrolment routes must stay
reachable or a privileged user could never enrol.

**NF-13** — _open._ The acyclicity test on the role-inheritance graph rejects
only directly reciprocal edges. A three-role cycle would pass it.

**NF-10 through NF-13 are all closed now**, in commits `02e4571`, `12ebd07` and
`51feced`. The paragraph above is left as it was written, because a report that
quietly rewrites what it said last time is not a record. What changed since:
sessions rotate on every privilege change; each route names its own step-up
policy from a server-held table; privileged accounts must hold a confirmed
second factor before any guarded route, with the enrolment routes declared
`mfaExempt` in the contract so enrolment stays reachable; recovery codes are
stored as digests; and cycle detection is a depth-first search that returns the
loop it found rather than a check for reciprocal edges.

**NF-14** — _closed._ **The event detail endpoint served an organiser's contact
address to anonymous callers.** `eventWithRelationsSchema` nested
`organizationSchema`, the whole row, so every public request for a published
event returned `contactEmail` — the account contact, not a box office address —
and `payoutCurrency`. Found while building the public organiser page, whose own
schema deliberately excludes both.

Reproduced before the fix, against `/v1/events/navratri-garba-night` with no
credentials:

```json
{"id":"…","name":"Rangoli Collective","slug":"rangoli-collective",
 "contactEmail":"hello@rangoli.example","verified":true,"payoutCurrency":"INR",…}
```

The nested shape is now `publicOrganizerSummarySchema` — id, name, slug,
description, websiteUrl, verified — written as its own schema rather than an
`.omit()` of the row, so the next column added to `Organization` is absent from
the public payload until somebody decides otherwise. `verified` there is derived
from `verificationStatus` rather than copied from the denormalised column, the
same rule the organiser page follows. Commit `33c78ff`.

**NF-15** — _closed, and the most serious found this cycle._ **The platform's
password hashing was compiled into the browser bundle.** Not the dev server: the
production client bundle, at `.next/static/chunks`, contained

```js
;((0, i.i(78585).promisify)(yB.scrypt),
  Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32, saltLength: 16, maxmem: 0x6000000 }))
```

— `packages/auth/src/password.js` with its exact scrypt tuning, served to every
visitor, along with the rest of the auth package: TOTP verification and its
replay window, the sealing key derivation, bearer-secret digesting, the
pseudonymisation of email and IP addresses, and the lockout thresholds.

The chain was four hops, each individually reasonable:

    apps/web/src/lib/api-client.js
      -> @desi-event/api-contract   (barrel)
      -> packages/api-contract/src/validate.js
      -> @desi-event/auth           (barrel)
      -> packages/auth/src/password.js

`validate.js` wanted one frozen array of strings and imported a package barrel
to get it.

It also **crashed**. `node:crypto.scrypt` is undefined in a browser, so
`promisify(undefined)` threw at module evaluation and took the checkout page
into its error boundary. That is what the two long-standing `journey.spec.js`
failures were, and why they only appeared under parallel load — the chunk had to
evaluate before the page settled. They were present on the committed baseline
before any of this cycle's work: confirmed by stashing every uncommitted change
and reproducing them identically.

How it was missed for two phases: nothing in the repository looked. There was no
lint rule, no exports-map restriction, no bundler configuration and no test that
would fail if `apps/web` imported `packages/auth/src/password.js`.

Closed in `3e9a327`:

- `@desi-event/auth` exposes `./sessions`, which imports nothing, and
  `validate.js` takes the policy names from there.
- `validate.js` left the api-contract barrel for
  `@desi-event/api-contract/validate`. It is a build- and CI-time check over the
  whole contract and the only module in that package that reaches outside it, so
  importing the client should not drag it in.
- `apps/web/src/lib/browser-bundle.js` walks the import graph statically from
  every file carrying `'use client'` — found by reading the directive rather
  than from a list, because a list is what fails open — and refuses a set of
  named server-only modules, each with a recorded reason.

**Proven by restoring the defect.** With the two imports put back, the walker
reported all six leaked auth modules and the exact chain to each:

```
LEAK: packages/auth/src/password.js
  chain: apps/web/src/lib/api-client.js -> packages/api-contract/src/index.js
         -> packages/api-contract/src/validate.js -> packages/auth/src/index.js
         -> packages/auth/src/password.js
  why: scrypt password hashing and its tuning parameters. Calls
       promisify(node:crypto.scrypt) at module scope, which throws in a browser.
```

With the fix in place: `leaks after the fix: 0 of 22 modules`. Empirically, a
clean rebuild leaves no `scrypt`, `promisify`, `timingSafeEqual`, `maxmem` or
`keyLength` anywhere in `.next/static/chunks`, and the client bundle fell from
1.7M to 1.3M — 400KB of server code every visitor was being made to download.
The browser suite is 105/105.

**NF-16** — _closed._ **The API and worker deployment contract shipped in the
browser bundle.** Found by an audit run after NF-15, on the suspicion that one
barrel had probably not been the only one.

`packages/api-contract/src/routes.js` takes about seventy named schemas from the
`@desi-event/schemas` barrel. A barrel is all-or-nothing and that package had no
subpaths, so `export * from './env.js'` came along, and with it — served to
every visitor of the checkout page — the PostgreSQL and Redis variable names,
the 32-character floor on `JWT_SECRET`, the rule that `AUTH_SECRET` silently
falls back to `JWT_SECRET` when unset, `SECURE_COOKIES` and its "Only turn this
off for local HTTP" prose, the fee constants, and the complete
`INSECURE_JWT_SECRETS` blocklist — which is a precise statement of the check an
attacker is probing against. `jobs.js` came too: the worker's queue names and
job payloads.

Reproduced over HTTP against a production build, not a dev server:

```
$ curl -s .../_next/static/chunks/0uu376hw17ojf.js | grep -o 'Object.freeze(\["dev-only-insecure-secret-change-me-before-any-deploy.\{120\}'
Object.freeze(["dev-only-insecure-secret-change-me-before-any-deploy","change-me",
"changeme","secret","supersecret","development","test-secret"]);function va(t){…}

$ … | grep -o 'DATABASE_URL:\w*,REDIS_URL:\w*,JWT_SECRET.\{80\}'
DATABASE_URL:vo,REDIS_URL:vs,JWT_SECRET:md.string().min(32,{message:"JWT_SECRET
must be at least 32 characters"}),JWT_EXPIRES_IN:…
```

No secret _value_ leaked — `env.js` reads `process.env` only as a default
parameter, so nothing evaluates in a browser — and this is disclosure rather
than a crash. It is still the server's deployment contract published to the
public.

Closed by giving `@desi-event/schemas` the subpaths `./env` and `./jobs` and
taking both off the barrel; seventeen server-side and worker-side imports moved
across. The barrel test now asserts the opposite of what it used to: that these
names are _absent_ from the package entry point and present at their own. Both
modules were added to the guard from NF-15, which now covers what it did not
catch. After a clean rebuild, none of `DATABASE_URL`, `REDIS_URL`,
`JWT_SECRET`, `ALLOW_DEMO_TAX_IN_PRODUCTION`, `PLATFORM_FEE_BPS`,
`QUEUE_NAMES`, the blocklist or the cookie prose appears anywhere in
`.next/static/chunks`.

**The audit that found it was partial and is recorded as such.** Nineteen agents
ran; nine verifiers died on a session limit before reporting. Of the ten that
finished, the confirmed findings were NF-15 (already closed) and NF-16. The
unverified vectors were the remaining built-chunk checks and the guard-coverage
review, and they are being re-run.

## 10. Verification

Every command below was run at `b37b242` with PostgreSQL 16.13 and Redis 7.0.15
up, on Node v22.22.2 and pnpm 10.33.0. No stale server owned either end-to-end
port — checked before the run, not assumed.

| Command                     | Exit | Result                                               | Duration | Cache                  |
| --------------------------- | ---- | ---------------------------------------------------- | -------- | ---------------------- |
| `pnpm policy:check`         | 0    | 408 tracked files, no violations                     | 1s       | n/a                    |
| `pnpm secrets:scan`         | 0    | 407 tracked files, nothing credential-shaped         | 1s       | n/a                    |
| `pnpm format:check`         | 0    | clean                                                | 8s       | n/a                    |
| `pnpm lint`                 | 0    | clean                                                | 8s       | n/a                    |
| `pnpm contract:check`       | 0    | 45 routes, 45 operations, 42 paths; artefact current | 2s       | n/a                    |
| `pnpm test --force`         | 0    | **3,540 passed, 0 failed, 0 skipped**                | 57s      | **0 cached, 16 tasks** |
| `pnpm db:verify:fresh`      | 0    | **68/68**                                            | 12s      | n/a                    |
| `pnpm db:verify:upgrade`    | 0    | **17/17**                                            | 4s       | n/a                    |
| `pnpm build --force`        | 0    | 3 tasks                                              | 8s       | **0 cached**           |
| `pnpm audit`                | 0    | no known vulnerabilities                             | 1s       | n/a                    |
| `pnpm test:e2e`             | 0    | **89 passed**                                        | 80s      | n/a                    |
| `pnpm test:e2e:prod`        | 0    | **19 passed** against a freshly compiled build       | 13s      | n/a                    |
| Phase 2 accessibility suite | —    | **does not exist as a separate suite**               | —        | —                      |
| Phase 2 load suite          | —    | **does not exist**                                   | —        | —                      |

Nothing was retried. Nothing was skipped. The two rows that do not exist say so
rather than being omitted.

### Test counts by workspace

| Workspace                  | Tests     |
| -------------------------- | --------- |
| `@desi-event/permissions`  | 530       |
| `@desi-event/schemas`      | 527       |
| `@desi-event/providers`    | 478       |
| `@desi-event/api`          | 386       |
| `@desi-event/auth`         | 348       |
| `@desi-event/inventory`    | 254       |
| `@desi-event/web`          | 235       |
| `@desi-event/worker`       | 183       |
| `@desi-event/api-contract` | 177       |
| `@desi-event/pricing`      | 116       |
| `@desi-event/db`           | 102       |
| `@desi-event/ui`           | 97        |
| `@desi-event/logger`       | 63        |
| `@desi-event/ledger`       | 33        |
| `@desi-event/config`       | 11        |
| **Total**                  | **3,540** |

## 11. Stripe

**No test credentials were supplied.** `.env` contains no `STRIPE_*` variable at
all, so the resolved payment mode is `MOCK` throughout.

Consequently: no PaymentIntent was created, no 3-D Secure flow was exercised, no
Connect account was onboarded, no `stripe listen` delivered an event, no refund,
transfer or payout was performed, and no dashboard object exists. Every Stripe
test in this repository runs against a double with the real call shapes. There
are no fabricated dashboard identifiers, request logs, CLI transcripts or
screenshots anywhere in this repository.

Real Stripe sandbox execution remains **EXTERNAL VERIFICATION PENDING**.

**Production payments are disabled and unreachable.** There is no `LIVE`
constant to reach for; `PAYMENT_MODE=live` and its synonyms are refused before
the server listens; the adapter refuses to construct unless the resolved mode is
`STRIPE_TEST`; and a repository guard asserts that only
`packages/providers/src/stripe.js` imports `stripe` at all. Nothing in this cycle
touched the kill switch, and `apps/api/tests/payment-kill-switch.test.js` and
`startup-safety.test.js` both still pass.

## 12. The completion gates, one by one

| #   | Gate                                                                       | Status                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | NF-06 fixed and proven                                                     | **MET** — §3                                                                                                                                                                                                                                                             |
| 2   | Report inconsistencies reconciled                                          | **MET** — §2                                                                                                                                                                                                                                                             |
| 3   | Organizer verification, public routes, venues, venue maps, event lifecycle | **PARTIAL** — organiser verification and the whole venue / venue-map slice are built, tested and on screen; event lifecycle and moderation are not                                                                                                                       |
| 4   | GA and reserved inventory concurrency-safe                                 | **MET** — carried, and the nine real-PostgreSQL probes still pass                                                                                                                                                                                                        |
| 5   | Attendee completes mock checkout through order, payment, ledger, tickets   | **MET for general admission.** Order, payment, ledger and tickets all happen and are asserted end to end in `apps/api/tests/checkout-ledger.test.js`. The reserved-seat path is implemented but has no test that buys a _seated_ order end to end, so it is not claimed. |
| 6   | Provider calls outside database transactions                               | **MET** — carried, still proven by instrumentation                                                                                                                                                                                                                       |
| 7   | Timeouts enter durable reconciliation and can be resolved safely           | **PARTIAL** — they enter it (§7); nothing can resolve it                                                                                                                                                                                                                 |
| 8   | Full and partial refunds, no over-refund                                   | **NOT MET** — database ceilings exist; no refund service                                                                                                                                                                                                                 |
| 9   | Dispute, transfer, payout state machines in mock mode                      | **NOT MET** — ledger composition exists; no services                                                                                                                                                                                                                     |
| 10  | Every completed commerce action posts balanced protected ledger entries    | **PARTIAL** — true for a paid order; the other actions do not exist to post                                                                                                                                                                                              |
| 11  | Ticket transfer, revocation, check-in concurrency-safe                     | **NOT MET** — Phase 1 check-in carried; no transfer, no revocation                                                                                                                                                                                                       |
| 12  | Notifications use an idempotent outbox                                     | **NOT MET** — table exists, nothing writes it                                                                                                                                                                                                                            |
| 13  | Organizer and operations dashboards                                        | **NOT MET** — the venue screens are the first authenticated surface; no dashboard                                                                                                                                                                                        |
| 14  | Phase 2 UI passes accessibility and responsive tests                       | **PARTIAL** — the venue and map screens pass at phone, tablet and desktop widths and with reduced motion; the remaining screens do not exist                                                                                                                             |
| 15  | All 20 required E2E journeys pass                                          | **PARTIAL** — the twelve venue journeys pass, alongside 118 + 19 carried; the other eight do not exist                                                                                                                                                                   |
| 16  | Load and reliability tests exist                                           | **NOT MET**                                                                                                                                                                                                                                                              |
| 17  | CI enforces the Phase 2 gates                                              | **NOT MET** — no workflow                                                                                                                                                                                                                                                |
| 18  | All required documentation complete                                        | **NOT MET** — 2 of 16 written                                                                                                                                                                                                                                            |
| 19  | Production payments technically disabled                                   | **MET** — §11                                                                                                                                                                                                                                                            |
| 20  | All code-owned checks pass, committed, pushed, clean tree                  | **MET** — §10                                                                                                                                                                                                                                                            |

Six met, six partial, eight not met. Phase 2 is `PARTIAL`, and would be
`PARTIAL` even if Stripe credentials had been supplied: the missing credentials
are much the smaller of the two reasons.

Gate 20's evidence — the final pushed HEAD, upstream equality and a clean tree —
is in `PHASE2_FINAL_VERIFICATION_REPORT.md` §7 and §10, together with every
command, exit code and duration behind the numbers above.

Phase 3 has not been started.

## 13. What was built, precisely

**New files**

- `packages/ledger/` — `accounts.js`, `batches.js`, `errors.js`, `index.js`, `batches.test.js`
- `apps/api/src/lib/ledger.js`, `apps/api/src/lib/openapi-artifact.js`
- `apps/api/tests/ledger-integration.test.js`, `checkout-ledger.test.js`, `openapi-artifact.test.js`, `capability-guard.test.js`
- `apps/api/turbo.json`

**Modified**

- `packages/api-contract/src/validate.js` and its suite — the capability-scope rules
- `apps/api/src/plugins/auth.js` — the guard's fallback removed; rotation delivery
- `apps/api/src/lib/sessions.js` — `canDeliverSecret`
- `apps/api/src/lib/checkout.js` — ledger posting, seat selling, reconciliation on timeout
- `apps/api/scripts/emit-openapi.mjs` — check mode
- `apps/api/tests/helpers/prisma-stub.js` — nested creates, three ledger models, their relations and constraints
- `apps/api/tests/helpers/fixtures.js` — the chart of accounts
- `packages/db/scripts/verify-fresh-database.mjs` — runs the ledger integration suite
- `package.json`, `apps/api/package.json`, `turbo.json` — script wiring
- `PHASE2_IMPLEMENTATION_REPORT.md`, `PHASE2_REQUIREMENTS_TRACEABILITY.md`

**Deliberately untouched**

The Phase 1 payment kill switch, the credential gate, the webhook intake path,
the seating concurrency primitives and the migration files. Nothing in this cycle
needed a schema change, which is itself worth noting: the Phase 2 data model
anticipated the ledger service correctly.

## 14. Deviations

- **The ledger is a new workspace package** rather than a module inside the API.
  The worker will need to post batches too (a webhook-driven refund settles in the
  worker, not in a request), and a package is the boundary that makes that
  possible without the worker importing from `apps/api`.
- **The ledger integration suite does not clean up after itself.** See §5. The
  alternative was to work around an invariant in order to tidy, which would have
  disabled it.
- **NF-10 through NF-13 were recorded, not fixed.** Each needs a product decision
  or sits behind work that does not exist. Fixing NF-12 in particular requires
  deciding what happens to a privileged user who has not yet enrolled.

  > **HISTORICAL STATUS — SUPERSEDED.** All four were closed after this cycle, in
  > `12ebd07`, `02e4571` and `51feced`. The bullet is left as written because a
  > report that quietly rewrites what it said last time is not a record. Current
  > status: `PHASE2_STATUS.md` §4.

## 15. Residual risks

1. **The reconciliation queue has no operator.** Timeouts now create work items
   and nothing in the product can resolve them. This is strictly better than the
   previous state — the work is visible — but an unbounded queue nobody can empty
   is its own hazard.
2. **NF-12: step-up is password-only for an account with no second factor**,
   which is most likely to be exactly the privileged account that needs one.

   > **HISTORICAL STATUS — SUPERSEDED.** Closed in `51feced`: a privileged role
   > now requires a confirmed factor before any guarded route, with the
   > enrolment routes declared `mfaExempt` so enrolment stays reachable.
   > `PHASE2_STATUS.md` §4.

3. **Reserved-seat checkout is implemented but not end-to-end tested.** The
   mechanism is asserted at unit level and the seat transitions are proven under
   concurrency; what is missing is one test that buys a seated order and checks
   the seat ends `SOLD` against an order line.
4. **The Stripe adapter has never spoken to Stripe.** Its call shapes are
   asserted against a double. Shapes agreed with a double are shapes, not a
   working integration.
5. **Fourteen of the sixteen required documents do not exist**, so the system's
   security model, data model and runbooks live only in source comments and these
   reports.

   > **HISTORICAL STATUS — SUPERSEDED.** The count has moved: twelve are absent,
   > four were written or updated, and three more exist but carry no Phase 2
   > content. The substance of the risk stands. `PHASE2_STATUS.md` §7.

## 16. Phase 3 prerequisites

Nothing in this cycle changes them. The boundaries the previous report listed as
ready are still ready, and still empty: licensed feed ingestion, live seat
availability, native apps, offline scanner synchronisation, wallet passes,
production tax certification. Production Stripe activation remains deliberately
absent rather than merely unimplemented.

## 17. Manual reviewer checklist

1. `git log --oneline e93d4e9..HEAD` — six commits, each independently green.
2. `pnpm contract:check` — then edit any route summary and run it again. It must
   exit 1. Restore.
3. `pnpm db:verify:fresh` — 68 checks, including 13 ledger integration cases
   against real PostgreSQL.
4. Read `packages/ledger/src/batches.js` and ask of each function: does the money
   land in an account of the right _type_? A liability where a liability belongs?
5. Read `apps/api/src/plugins/auth.js` `requireCapability`. Confirm there is no
   path that asserts an organisation capability without an organisation.
6. `grep -rn "sk_live\|pk_live" --include=*.js .` — nothing outside the refusal
   lists.
7. Confirm `.env` has no `STRIPE_*` variable, so §11's claim that no sandbox call
   was made is structurally true rather than merely asserted.

## Reports

- This document.
- `PHASE2_IMPLEMENTATION_REPORT.md` — the cycle that preceded this one, corrected.
- `PHASE2_REQUIREMENTS_TRACEABILITY.md` — every work item and acceptance
  criterion mapped to files, tests and status, including the ones with status
  `NOT IMPLEMENTED`.
