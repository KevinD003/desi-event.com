# Post-Merge CI Reliability Fix Report

Date: 2026-09-17.

---

## 1. Purpose and scope

Merged `main` is red. CI run `35248621822` ran on merge commit `09e66bd` and
failed. This pass fixes what can be fixed in the two failing checks, corrects the
status index that never recorded the failure, and states plainly which of the two
failures is **not** fixed.

**Not in scope, and not done.** Phase 3's Phase 3 and Phase 4; privacy UI,
exports or retention workers; Stripe or Stripe Connect; payment mode; production
behaviour; schema or migrations; CI workflow; branch protection; repository
settings. No external call was made. No pull request was opened and nothing was
merged.

---

## 2. Starting state

| Fact              | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Starting branch   | `claude/docs-post-merge-status-reconciliation`                 |
| Starting SHA      | `e6da1344bd5fd8a0e27a2bf7f26f97502c4e0114`                     |
| `origin/main` SHA | `09e66bde09b4c712c741c5cb87682b836af2608b`                     |
| Working tree      | **clean**                                                      |
| New branch        | `claude/fix-post-merge-ci-reliability`, cut from `origin/main` |

Neither `claude/desi-event-js-stack-gb4uqe` nor
`claude/docs-post-merge-status-reconciliation` was used as a base.

---

## 3. The failed CI run on merged `main`

| Field      | Value                                                 |
| ---------- | ----------------------------------------------------- |
| Run        | `35248621822`                                         |
| Head SHA   | `09e66bde09b4c712c741c5cb87682b836af2608b`            |
| Branch     | `main`                                                |
| Event      | `push`                                                |
| Attempt    | 1                                                     |
| Created    | `2026-09-17T16:46:10Z` — four seconds after the merge |
| Conclusion | **failure** — 2 of 8 jobs                             |

Passed: `Browser — accessibility sweep`, `— commerce and operations detail`,
`— organiser venue maps`, `— production build`, `— public catalogue`,
`— refusals`.

**No later run on `main` exists.** `main` is red as of this report.

### 3.1 Failure one — the fresh-database verification

Job `Policy, lint, contract, tests, build`, step 19, `95/96 checks passed.`
Steps 1–18 all passed, including `Test`, the skipped-test gate and coverage.

```
FAIL tests/privacy-redaction-integration.test.js > redacting a subject who belongs
     to one organisation > replaces every approved field and leaves the money
     exactly as it was

AssertionError: expected { status: 'PAID', …(10) } to deeply equal { … }
-   "ledgerEntries": 59,
+   "ledgerEntries": 61,
    at tests/privacy-redaction-integration.test.js:266
```

### 3.2 Failure two — the event-lifecycle browser suite

Job `Browser — event lifecycle`, step 10. Thirteen journeys passed, journey 14
failed, six did not run.

```
1) e2e/event-lifecycle.spec.js:422 › journey 14: the organiser resubmits and the
   moderator approves

   Test timeout of 90000ms exceeded.
   Error: locator.click: Target page, context or browser has been closed
     - waiting for getByRole('button', { name: 'Approve' })
     at apps/web/e2e/event-lifecycle.spec.js:436
```

"Target page… has been closed" is the teardown after the timeout, not the cause.

---

## 4. Why the earlier documentation claim was wrong

An earlier account of this merge asserted:

> No CI run has ever had `09e66bd` as its head SHA.

**False.** Run `35248621822` had exactly that head SHA and failed.

The error was methodological. Every query behind the claim was filtered to the
feature branch — `?branch=claude/desi-event-js-stack-gb4uqe`, and the workflow's
runs for that branch — so a `push` run on `main` could never appear in the
result set. The conclusion was then built on that absence: that tree equality
between `723f7af` and `09e66bd` was the only available evidence about `main`.

The tree equality is real; both commits are
`8b53048d643b4c1ef7cdbd8810cb01a0b6041f95`. It simply never mattered. `main` was
tested directly, and the answer was a failure that the identical-tree argument
would have talked a reader out of looking for.

That false statement stands uncorrected on the unmerged branch
`claude/docs-post-merge-status-reconciliation`, in
`docs/STATUS_READING_GUIDE.md`, `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md`
and its `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3.0. **That branch must not be
merged until it is corrected or superseded by this one.**

---

## 5. Failure one — root cause and fix

### Root cause

`financialFacts()` measured the ledger like this:

```js
const ledger = await prisma.ledgerEntry.aggregate({ _count: { _all: true } })
```

That counts **every `LedgerEntry` row in the database**. Vitest runs suites in
parallel, so a neighbour posting a batch between the two snapshots moved the
number underneath the assertion.

The deeper defect is worse than flakiness. **The fixture posted no ledger batch
of its own.** `paidOrder()` created an `Order`, an `OrderItem` and `Ticket` rows
and stopped. So every row the assertion counted belonged to some other suite, and
not one of them could ever have been changed by redacting this subject. The
assertion was simultaneously non-deterministic and vacuous: it could fail for
reasons unrelated to redaction, and it could never pass for a reason related to
it.

The suite's own header had said all along that "every amount, tax figure, status
and **ledger row** is captured before the redaction and compared afterwards." The
intent was right; the implementation counted a table.

### Fix

Two changes, in `apps/api/tests/privacy-redaction-integration.test.js`:

1. **`paidOrder()` now posts a real balanced batch** through the ledger's own
   `orderPaidBatch()` and `postBatch()`, linked by `orderId`, with amounts taken
   from the order it belongs to. A paid order that posted no ledger batch was not
   a paid order.
2. **`financialFacts()` reads the order's own entries** through
   `where: { batch: { orderId: order.id } }` — a foreign key, so no other suite
   can reach it — and returns the **rows**, not a tally: id, batch, account,
   direction, amount, currency, `memo` and organisation, ordered by id. A count
   cannot distinguish a row left alone from a row deleted while another appeared,
   and `memo` is the field §11 of the Phase 2 report names as the one a redaction
   can never reach, so it is read back rather than assumed.

The assertion is now strictly stronger than the one it replaces and is
deterministic by construction.

### What was not done

The assertion was not deleted, loosened to an inequality, skipped, quarantined or
given a retry, and no suite was serialised.

---

## 6. Failure two — root cause and what is **not** fixed

### What the brief expected, and what the logs say

The expectation was that a Playwright seed deleting `AuditLog` rows was refused
by `desi_audit_log_immutable` and failed the suite. The first half is true and
the second is not.

`apps/web/e2e/support/seed-events.mjs` did carry

```js
await prisma.auditLog.deleteMany({ where: { entityId: event.id } }).catch(() => {})
```

and the database did refuse it — `Code: 23514`, visible in the run's PostgreSQL
service log. But the call catches its own rejection, so it failed the suite on no
run, including green ones. It has emitted that error on **every** run since the
trigger landed.

**The suite failed on a 90-second test timeout**, waiting for the moderator's
Approve button. The audit error appears in the log one line above the failure,
which is exactly how it invited the wrong diagnosis.

### What was fixed

The impossible delete is removed. `AuditLog.entityId` is a plain string with no
foreign key to `Event`, so the `event.delete()` below it never depended on it:
removing the line changes no behaviour and stops a guaranteed failure from
writing an alarming error into every run's log. The user-cleanup path in the same
file already had this treatment, with a comment explaining that the audit rows
deliberately stay; the event path had been missed.

`apps/web/src/lib/e2e-seed-invariants.test.js` fails if any mutation of
`AuditLog` — `delete`, `deleteMany`, `update`, `updateMany`, `upsert` or raw SQL
— returns to that seed, and also asserts that the mutable cleanup it should still
do is still there, so the invariant cannot be satisfied by deleting nothing at
all. It scans the file with comments stripped, because the first version failed on
the seed's own sentence explaining the trigger.

### What is **not** fixed, stated plainly

**The journey-14 timeout is not fixed, because it could not be reproduced.** The
event-lifecycle suite passes locally — 20 of 20, in about 45 seconds, three
consecutive times — and passed locally _before_ this change as well. The removed
delete is not a credible cause of a 90-second wait for a button.

The evidence is consistent with a slow CI runner: CI spent 2.1 minutes reaching
journey 14 where a local run completes all twenty in 45 seconds. Raising the
timeout, adding a retry or adding a wait would have hidden it rather than fixed
it, and all three are forbidden here — correctly.

**So it may recur.** If it does, the next step is the Playwright artefacts from
the failing run, which were uploaded and which name the page state at the moment
of the timeout.

### What was not done

`desi_audit_log_immutable` was not weakened, dropped or bypassed. No raw SQL was
used to get around it. `AuditLog` was not truncated. No constraint was disabled.
The suite was not skipped, and no timeout or retry setting was touched.

---

## 7. Regression tests and repeated-run evidence

### New tests

| Test                                                                                                        | Proves                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy-redaction-integration.test.js` — "is unmoved by a neighbouring order posting its own ledger batch" | A second organisation's order posts its own batch between the snapshots; the scoped snapshot is unchanged and the neighbour's entries are untouched |
| `apps/web/src/lib/e2e-seed-invariants.test.js` — 8 cases                                                    | No `AuditLog` mutation can return to the event-lifecycle seed, by any verb or by raw SQL                                                            |

The regression test asserts that the interference **actually happened** —
`expect(globalAfterNeighbour).toBeGreaterThan(globalBefore)` — before asserting
it was survived. Without that line it would pass for the wrong reason.

### Repeated runs

| Check             | Run 1               | Run 2               | Run 3               |
| ----------------- | ------------------- | ------------------- | ------------------- |
| `db:verify:fresh` | **96/96**           | **96/96**           | **96/96**           |
| `test:e2e:events` | **20 passed** 45.4s | **20 passed** 44.7s | **20 passed** 45.3s |

The `db:verify:fresh` runs are meaningful: that check failed on CI and now passes
repeatedly. **The `test:e2e:events` runs are weaker evidence than they look** —
that suite passed locally before the change too, so three green runs confirm no
regression rather than a fix.

---

## 8. Validation

| Command                                         | Result                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `format:check`                                  | **PASS**                                                            |
| `policy:check`                                  | **PASS**                                                            |
| `secrets:scan`                                  | **PASS**                                                            |
| `lint`                                          | **PASS**                                                            |
| `contract:check`                                | **PASS**                                                            |
| `bundle:scan`                                   | **PASS**                                                            |
| `ci:check`                                      | **PASS**                                                            |
| `test`                                          | **PASS** — 19 of 19 tasks; `apps/api` 1,147, `apps/web` 479         |
| `check-skipped-tests.mjs` (CI's own invocation) | **PASS** — `4898 case(s) … 0 skipped, 0 allow-listed, 0 undeclared` |
| `test:coverage`                                 | **PASS** — `apps/api` branches 76.09 against a floor of 75          |
| `db:verify:fresh`                               | **PASS** — 96/96, three times                                       |
| `db:verify:upgrade`                             | **PASS** — 24/24                                                    |
| `build`                                         | **PASS** — 3 of 3 tasks                                             |
| `test:e2e:events`                               | **PASS** — 20 of 20, three times                                    |
| `git diff --check`                              | clean                                                               |

Case count rose from 4,889 to 4,898: one new integration case and eight new
invariant cases.

---

## 9. Files changed

| File                                                   | Change                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `apps/api/tests/privacy-redaction-integration.test.js` | Fixture posts a real ledger batch; snapshot scoped to it; regression case added |
| `apps/web/e2e/support/seed-events.mjs`                 | Impossible `auditLog.deleteMany` removed, with the reason recorded              |
| `apps/web/src/lib/e2e-seed-invariants.test.js`         | **New.** Source invariant, 8 cases                                              |
| `docs/PHASE3_IMPLEMENTATION_REPORT.md`                 | Phase 2 row corrected; new §3.0 records the merge and the failed run            |
| `docs/POST_MERGE_CI_RELIABILITY_FIX_REPORT.md`         | **New.** This file                                                              |

No schema, migration, payment-provider, Stripe, kill-switch, workflow, manifest,
lockfile or production file changed. No unrelated browser suite changed.

---

## 10. What local validation proves

That the ledger assertion is now deterministic and meaningful, on this machine,
against real PostgreSQL, three times consecutively; that the full suite, coverage
floors, both database verifications, the contract checks, the bundle scan and the
build all pass with the changes in place; and that no test was skipped, weakened
or quarantined to get there.

## 11. What still requires GitHub CI

Everything about whether `main` goes green. Local runs use one machine with its
own timing, and the journey-14 timeout is a timing failure that never reproduced
here. Specifically unproven locally:

- that the fresh-database verification passes on a CI runner;
- that the event-lifecycle suite passes on a CI runner;
- that `main` is green after this branch merges.

**No claim of CI success is made in this report.** `main` is red and stays red
until a GitHub run says otherwise.

---

## 12. Documentation corrections made

1. `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3 — the Phase 2 row read `not started`
   with no commit and no CI run, while §3A recorded it COMPLETE. Corrected.
2. `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3.0 — new, and it records the merge,
   the failed run on `09e66bd`, both failing jobs, and a labelled correction of
   the "no CI run had `09e66bd`" claim including why the method produced it.

Nothing historical was deleted. The corrections are dated and labelled.

---

## 13. Remaining limitations and owner decisions

**Left undone deliberately, and needing your decision:**

- **`apps/web/e2e/support/seed-refusals.mjs:311` carries the identical impossible
  `auditLog.deleteMany`.** It is the same one-line dead code with the same
  guaranteed failure and the same misleading log line. It belongs to the refusals
  suite, which the scope guard names, so it was left alone and the new invariant
  covers only the event-lifecycle seed. One word from you and it goes.
- **The journey-14 timeout is unexplained and unfixed.** See §6.

**Unchanged by this pass**, and unresolved as before: historic immutable
`AuditLog` personal data; `NotificationOutbox.organizationId` backfill; the
`PrivacyRequest.HELD` constraint mismatch; counsel-approved retention durations;
Stripe test-mode credentials; merchant-of-record. Also unchanged:
`PHASE2_STATUS.md` contradicts itself about gate 14, which needs a Phase 2
judgement.

---

## 14. Statement of limits

- No real Stripe, Stripe Connect, payment, webhook or email operation occurred.
- No production system was accessed, tested or verified.
- No legal, privacy or compliance conclusion is drawn. Retention durations remain
  `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`.
- Payment mode remains `MOCK`; production payment processing remains `DISABLED`.
- No Phase 3–Phase 3 or Phase 3–Phase 4 work began.
- No merge occurred and no pull request was opened.
