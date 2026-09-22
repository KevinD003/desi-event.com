# Phase 3 final verification report

Independent verification of what Phase 3 actually delivered, read from merged
`main` rather than from the reports that describe it. Written 2026-09-22.

Method, stated first because it is what the conclusions rest on: seven areas
were verified by separate readers, and each verification was then **challenged**
by a second reader whose job was to refute it. The challenges found real errors
in the verifications — a fabricated `printRoutes` block, a spliced log quote,
absolute row counts cited from a mutable shared database, and one inverted
verdict. Every finding below that changed a conclusion was re-run by hand before
being written down. Where a claim rests on a document rather than on execution,
it says so.

## Verification baseline

|                          |                                                               |
| ------------------------ | ------------------------------------------------------------- |
| `main`                   | `e054b08a374af6d3e1052d0bcd89d79ed5cb352d`                    |
| Local `HEAD` at baseline | identical; `git status --short` clean                         |
| Branch                   | `claude/phase3-final-verification-report`, from `e054b08`     |
| PostgreSQL               | restored (`pg_ctlcluster 16 main start`) and used; not waived |
| Redis                    | restored and used; not waived                                 |

`docs/PHASE3_FINAL_VERIFICATION_REPORT.md` did not exist before this document.

## Git and CI evidence

The three Phase 3 merges, confirmed both locally and against the GitHub API, and
strictly sequential — each PR's base is the previous merge commit:

| PR  | Head merged | Merge commit | Direct-main CI run | Conclusion |
| --- | ----------- | ------------ | ------------------ | ---------- |
| #10 | `d581f58`   | `12d46fa`    | 35343299639        | success    |
| #11 | `3160355`   | `8f0ab16`    | 35654984108        | success    |
| #12 | `a75ee27`   | `e054b08`    | 35674923613        | success    |

All three runs are `run_attempt: 1` — no re-run masks an earlier failure — and
every one of the 8 jobs is `success` at job and check-run level. Each approval by
`KWinOverAnything` is recorded against the exact head that merged
(`d581f58` 12:02:45Z, `3160355` 21:01:57Z, `a75ee27` 01:03:18Z), each preceding
its own `merged_at`.

**Branch protection is enforced, and the obvious way to check says it is not.**
`GET /branches/main` reports `protected: true` alongside
`protection.enabled: false` and an empty `contexts` array. That is not an
absence of enforcement; it is enforcement living in a **repository ruleset**,
which the legacy view cannot see. The ruleset requires exactly the eight
contexts that ran, with `strict_required_status_checks_policy: true`,
`required_approving_review_count: 1`, `dismiss_stale_reviews_on_push: true`,
`required_review_thread_resolution: true`, and blocks `deletion` and
`non_fast_forward`. An earlier phase had to re-source check names from a
successful run; this is why. RUNTIME.

**No CI context was added, removed or renamed by Phase 3.** Stronger than a
diff, which cannot see a change-and-revert: the `.github/` tree blob is
byte-identical at `650a1fd` (before #10), `12d46fa`, `8f0ab16` and `e054b08` —
`48adb6d5eea0382d2918f8c9bfd1549c1dfee3fb` at all four — and no commit in the
39-commit range touched `.github/` at all. The workflow declares two jobs, one
of which is a 7-entry matrix, producing 8 contexts.

## Privacy operations verification

The privacy screens exist under `apps/web/src/app/privacy/` and are exercised by
`detail-privacy.spec.js` (10 journeys) plus cases inside the accessibility
sweep. Focus restoration after cancelling an irreversible action is proved by
`request-actions.test.jsx`, and falsified during this audit by substituting the
captured-node pattern, which drops focus to `document.body`. RUNTIME.

The refusal vocabulary is closed and schema-driven, and no refusal string claims
an erasure that did not happen.

One correction to how a prior claim was evidenced rather than to the claim
itself: `ALREADY_IN_FLIGHT` genuinely never reaches the browser, but the probe
originally offered as proof was a _hold_ refusal at raise time, not an in-flight
refusal. The property holds by reading `toErrorBody`; the runtime evidence
offered for it did not show it. The in-flight refusal depends on the partial
unique index `PrivacyRequest_one_in_flight_per_subject_key`, which only real
PostgreSQL enforces — against the stub, a second raise returns 201.

## Retention and export-governance verification

Retention is dry-run only, and this is now established by the strongest
available evidence rather than by reading the code. The real processor was
invoked with `activated: true` against live PostgreSQL, bracketed by global row
counts across twelve tables:

```
RESULT {"activated":true,"swept":4,"deduplicated":0}
DELTA  0 loginAttempt  0 session  0 notificationOutbox  0 privacyHold
       0 exportArtifact  0 exportArtifactSubject  0 user  0 order
       0 ticket  0 privacyRequest  0 auditLog   4 retentionSweep
```

An activated run against a real database changed exactly one thing: it inserted
four evidence rows. It deleted nothing. RUNTIME.

Supporting facts, each verified:

- No deletion path exists in the retention worker or API. The only `deleteMany`
  in that subtree is a test that **forbids** one.
- `RETENTION_ENFORCEMENT_ACTIVATED` defaults `false`
  (`packages/schemas/src/env.js:307`, asserted at `env.test.js:299-304`). With it
  false every class records `SKIPPED_DISABLED` and nothing is examined. Flipping
  it leaves all three `mode: 'DRY_RUN'` literals untouched.
- A CHECK constraint refuses a `DRY_RUN` row with a non-zero `affectedCount`.
- No scheduler, and no route that can start a sweep.
- Durations remain `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`.

**Nothing writes `ExportArtifactSubject`.** There is no `create`, `upsert` or
`createMany` against it anywhere outside tests, and `export-register.js` says so
in its own comments. `subjectCount` is therefore 0 for every export this system
produces, which is a fact about the exports rather than a gap in the register.
SOURCE, exhaustively.

## Mock Connect and payout-trigger verification

The installed function on a fully migrated database reads `"defaultCurrency"`:

```
SELECT prosrc FROM pg_proc WHERE proname='desi_payout_currency_matches';
  →  SELECT "defaultCurrency" INTO account_currency
```

`payout-currency-trigger.test.js` (6 cases) and
`connect-lifecycle-integration.test.js` (10 cases) both pass against real
PostgreSQL. The unique constraint on `ConnectedAccount.organizationId` is
enforced by the database — a duplicate insert raises the real Prisma
`ConnectedAccount_organizationId_key` violation — and is now modelled by the
stub as well. SQLSTATE 42703 does not occur on any path. RUNTIME.

`DISABLED` is terminal, a replayed `START` cannot regress a `COMPLETE` row, and
concurrent transitions cannot compose an illegal path; the compare-and-set was
falsified during this audit by substituting a read-then-write, whereupon both
concurrent actions succeed and the account reaches `COMPLETE` having passed
through `DISABLED`.

### Three findings recorded, not repaired

All three are latent, all three sit on webhook or payout paths this
authorization places out of scope, and none is reachable in mock mode.

**The capability flags have a second writer.** `advanceMockConnect` is the only
writer of `onboardingStatus` and derives the flags from it. It is not the only
writer of the flags: `applyAccountUpdated`
(`apps/api/src/lib/webhook-handlers.js:330`, `:383`) sets `chargesEnabled`,
`payoutsEnabled`, `detailsSubmitted`, `disabledReason` and `requirementsDue`
straight from a webhook payload, independent of `onboardingStatus`, with a
`where` of `{ providerAccountId }` carrying no provider and no mode filter. So
"derived, never supplied" holds for the Connect surface and **not**
repository-wide. Inert today: `secretFor` (`apps/api/src/routes/webhooks.js:93`)
returns null outside `STRIPE_TEST`, so no Connect delivery can be verified.

**A type mismatch on one column.** The presenter reads `requirementsDue` as an
array (`connect.js:205`); that webhook writer stores an object
`{ currentlyDue, pastDue }`. `requirementsDueCount` would silently read 0.

**The currency invariant is one-sided.** The trigger is on `Payout` only;
`ConnectedAccount` has none. Moving an account's `defaultCurrency` leaves
existing payouts in breach — and, worse, **un-updatable**, because the
`BEFORE UPDATE` trigger re-checks a condition the row cannot satisfy or fix.
Demonstrated in a rolled-back transaction. Latent only because every mock
account carries `defaultCurrency` NULL.

## Payment and provider-boundary verification

`payment-kill-switch.test.js` passes. The Stripe-host scan covers `api`,
`checkout`, `connect`, `dashboard`, `js` and `files` `.stripe.com`; the
SDK-import check covers the bare `stripe` specifier and `@stripe/*`. Both were
falsified during this audit with temporary offenders and both caught them.

The **built bundle** was grepped directly, which is stronger than the source
scan: `grep -rl "js.stripe.com\|api.stripe.com" apps/web/.next` returns nothing.
Two `.next/static` chunks contain the string "stripe" and both are benign — the
forbidden-phrase vocabulary (`/stripe\s+verified/iu`) and the route manifest's
own `/v1/webhooks/stripe` paths. `bundle:scan` reports 355 browser-deliverable
files with nothing server-only present. RUNTIME.

Worth stating plainly: `apps/web/package.json` has **no** Stripe dependency, so
`@stripe/stripe-js` and `@stripe/react-stripe-js` sit on the permitted-SDK
allow-list with no consumer. The allow-list is pre-widened for a phase that has
not landed.

One route is `auth: 'none'` and is not behind `assertMockConnectAvailable`:
`POST /v1/webhooks/stripe/connect`. It is defensible — the signature is verified
against a Connect-specific secret before anything is stored, and the handler
never writes `onboardingStatus` — but it is not covered by that guard, and it is
the path that reaches both `ConnectedAccount` writers named above.

## Journey 14 verification

Journey 14 remains `NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN` as a CI question,
and this audit did not attempt to reproduce or repair it.

What it did establish: **Journey 14 passes on `e054b08`.** An initial
verification pass concluded it never executed, from a two-run sample in which
journey 12 failed first. Four further runs of the whole events configuration —
two by the challenge reader, two by hand, the last during this branch's final
battery — returned `20 passed`, with journey 14 passing at 5.3s and 5.4s, inside
the 4.5–5.2s band `STATUS_READING_GUIDE.md` records and far inside the 90s
budget. The `Browser — event lifecycle` job is also green on the direct-main run
for all three merges.

One thing worth leaving for whoever does eventually investigate: journey 14
**cannot be run on its own**. `e2e/event-lifecycle.spec.js:128` is a
`test.describe.serial` of twenty ordered journeys over one shared event, and
journey 14 opens by editing an event that journey 13 put into
`CHANGES_REQUIRED`. Selecting it with `--grep` produces a failure with no
bearing on anything — confirmed here, and recorded so the next reader does not
mistake that failure for the CI one. The whole configuration is the smallest
honest unit.

Journey 12 is **intermittently** flaky in this container — two failures in five
observations — and a cold-cache probe affirmatively rules out the on-demand
compile that was proposed as its cause. That is a host-load artifact of this
environment, not a property of `main`, and nothing was changed to make it pass.

No Phase 3 commit touched event lifecycle, moderation, Journey 14's spec, or the
seed paths; and no retry, timeout, serial-mode, skip or quarantine setting was
introduced. `check-skipped-tests` reports **5,373 cases across 16 reports, 0
skipped, 0 allow-listed, 0 undeclared**.

## Documentation reconciliation

Verified true against the artefacts: `SECURITY.md`'s 38 capabilities and six
platform-only; `DATA_MODEL.md`'s 55 models, 45 enums, 23 triggers and 59 CHECK
constraints; `STRIPE_CONNECT.md`'s ten-field response shape and its
`sessions.js:258` citation.

Five defects were found and corrected — see the next section. Two further
observations that qualify rather than falsify:

- Several documents say "the live database". `DATABASE_URL` selects
  `desi_event`, which is **behind the migrations** (15 non-internal triggers).
  The invariants hold in `desi_event_test` (23). Where a document grounds a
  claim in "the live database", the database it means is the test one.
- Absolute row counts taken from `desi_event_test` are not evidence of anything.
  It is shared and accumulates across runs; three separate counts taken hours
  apart during this audit disagreed. Deltas on tagged identifiers are the only
  sound control there.

## Verified contradictions and corrections

Five, each verified against the artefact rather than against a report, each
corrected here. PR #12 moved the numbers behind three of them and the deltas
match it exactly. `adr/0004` has contradicted itself since the day it was
accepted, and `STATUS_READING_GUIDE.md` had been wrong about one phase since
2026-09-18 and about another since PR #12 merged.

| Document                  | Said                                                                          | Is                                                                         | Evidence                                                    |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `api.md`                  | 129 operations, `finance` 10                                                  | **131**, **12**                                                            | `openapi.json`, `apiRoutes`                                 |
| `SECURITY.md`             | "eight reads **already**… three actions"                                      | 7/3 before, 8/4 now                                                        | contract enumeration                                        |
| `UX.md`                   | sweep 53, detail 37, total 264, "five surfaces"                               | **56 / 48 / 278 / six**                                                    | `playwright --list`, all seven configs                      |
| `adr/0004`                | "ten functions, twelve triggers" _and_ "thirteen"                             | **21 / 23**                                                                | migration grep, reproduced                                  |
| `STATUS_READING_GUIDE.md` | Phase 3's Phase 3 and Phase 4 `NOT STARTED`, on report files it called absent | `PARTIAL` and `COMPLETE WITH EXPLICIT OWNER DECISIONS`; both files present | `git ls-tree e054b08`, and the guide's own other two tables |

The `SECURITY.md` defect was an internal inconsistency rather than staleness:
its "eight reads" counted `connect.status`, which that same change added, while
its "three actions" excluded `connect.start`, which it added alongside. "Already"
was false of one number and true of the other.

`adr/0004` contradicted itself on the day it was accepted. Its body is left
exactly as written under a dated addendum, because its decision does not depend
on either figure and rewriting an accepted ADR to make its arithmetic agree
would hide that it never did.

`STATUS_READING_GUIDE.md` is the fifth, and the one a reader was most likely to
be misled by, because navigation is all it is for. Its _Authority map_ called
Phase 3's Phase 3 `NOT STARTED` and gave "its report file does not exist" as the
evidence, while its _Current phase index_, twenty lines above, called the same
phase `PARTIAL` and named that same file as authoritative. The file has been in
the tree since `017f707`, 2026-09-18 — confirmed present at `e054b08` by
`git ls-tree`, so it is a defect in merged `main` and not an artefact of this
branch. Two further rows called Phase 3's Phase 4 `NOT STARTED` after PR #12
merged the surface, and one sentence offered the absence of both report files as
a check anybody could run; one of the two had existed for four days, and writing
this report falsified the other. Four rows and that sentence are corrected, each
recorded in the guide's own Where/Was/Now table and in a dated section that keeps
what they said.

No status was invented there. Each new cell is ported from the report named
beside it, which is the rule that guide sets for itself.

`packages/config/tests/status-guide-consistency.test.js` now fails if those
three tables ever disagree about a phase again, if a Phase 3 sub-phase goes
missing from one of them, or if the guide names a document the tree does not
hold. It was falsified against `e054b08`'s own copy, where it names the
contradiction exactly. **Its first version passed against a planted missing
file**: inline code is found by pairing backticks, a fence is three of them, and
every pair after the first fence was shifted by one — the same failure as
`check-skipped-tests.mjs` matching the wrong word, recorded in
`PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` §12.0. It strips fenced blocks first
now, and was falsified again before being trusted. It sees 38 documents.

What it deliberately does not check is whether a status is _right_. Three tables
can agree and be stale together, which is precisely what the two Phase 3 — Phase
4 rows were; only a reader comparing the guide against the source report catches
that.

The `api.md` drift is now **structurally impossible**:
`apps/api/tests/api-doc-counts.test.js` derives the total from `openapi.json`
and each tag row from `apiRoutes`, and was falsified against the exact numbers
that shipped. It also pins the one piece of arithmetic that looks wrong and is
not — the rows sum to 132 against a total of 131, because `sessions.hold`
carries two tags.

## Owner decisions and external prerequisites

Two decisions were deliberately not taken by this audit, and neither is a
defect to fix:

**Connected-account payout eligibility.** `payouts.schedule`
(`apps/api/src/routes/finance.js:277`) does `findFirst({ where: { organizationId } })`
with no filter on `payoutsEnabled`, `chargesEnabled`, `providerMode` or
`onboardingStatus`. A simulated account is therefore a payout destination in
every state, disabled included, and nothing on the payout path reads the
capability flags. Confirmed unimplemented. Filtering changes real payout
behaviour and needs explicit authorization. The mitigation in place is that a
simulated row carries `defaultCurrency` NULL, which keeps it clear of the
repaired trigger.

**The `paymentsOverride` gate bypass.** `apps/api/src/app.js:87` still reads
`paymentsOverride ?? gated`, replacing the gate's result wholesale, and the
comment above it claims the opposite in both clauses. Not reachable in any
deployment — no call site passes it — but payment mode is a protected boundary.
Confirmed unimplemented.

Still external, and unchanged by any of this: legal approval of retention
durations; audit-log erasure disclosure; pre-organization outbox treatment; real
Connect and provider launch decisions, credentials, jurisdictions, account type,
eligibility, KYC/KYB, tax, sanctions, dispute and refund obligations, webhook
and incident ownership.

## Validation results

Run from this branch, against real PostgreSQL and real Redis.

| Gate                  | Result                                                           |
| --------------------- | ---------------------------------------------------------------- |
| `format:check`        | pass                                                             |
| `policy:check`        | 703 files, no violations                                         |
| `ci:check`            | 2 workflows, uploadable artefact names, tasks order their build  |
| `secrets:scan`        | 702 files, nothing credential-shaped                             |
| `lint`                | pass                                                             |
| `contract:check`      | 131 routes, 131 operations, 117 paths; artefact current          |
| `test --force`        | 19 tasks; `apps/api` 65 files / 1,257 cases, `apps/web` 41 / 688 |
| `test:coverage`       | 18 tasks, thresholds met                                         |
| `db:verify:fresh`     | **99/99**                                                        |
| `db:verify:upgrade`   | **25/25**, 1,485 catalogue entries agree                         |
| `build --force`       | 3 tasks                                                          |
| `bundle:scan`         | 355 files, nothing server-only                                   |
| `check-skipped-tests` | 5,373 cases, **0 skipped**, 0 undeclared                         |

Browser, every configuration: default 118, sweep 56, detail 48, events 20,
production 19, organizer 13, refusals 4 — **278**, matching `--list`.

Nothing was retried, slowed, serialised, skipped or quarantined to reach any of
this.

## Final Phase 3 disposition

```
COMPLETE WITH EXPLICIT OWNER DECISIONS
```

Every authorized Phase 3 engineering deliverable is present on `main` and
verified by execution where the invariant lives in PostgreSQL, Redis, the
browser or the bundle. Five documentation defects were found and corrected, two
of them now guarded by tests. Three latent findings on webhook and payout paths
are recorded above and are outside what this phase was authorized to change.

What remains is not engineering: two owner decisions, and a set of external
legal, tax, identity and provider prerequisites that no amount of code in this
repository can discharge.

```
PAYMENT_MODE=MOCK
Production payments disabled
Real Stripe = EXTERNAL VERIFICATION PENDING
Real Stripe Connect = EXTERNAL VERIFICATION PENDING
```
