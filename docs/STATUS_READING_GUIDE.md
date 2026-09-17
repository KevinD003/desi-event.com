# Desi-Event Status Reading Guide

Written 2026-09-17, against merged `main` at `09e66bd`.

This repository keeps its history rather than rewriting it. That is a deliberate
discipline and it has a cost: there are more than thirty status-bearing
documents, several of them superseded, and a reader who opens the wrong one
first gets a confident answer that is two cycles out of date.

This guide is navigation only. It decides nothing, supersedes no report, and
introduces no status of its own. Where it and a source report disagree, **the
source report is right and this file is stale** — tell somebody.

---

## Current status at a glance

| Scope                                | State                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| Project Phase 1                      | `COMPLETE` against Phase 1 scope                               |
| Project Phase 2 (commerce)           | `COMPLETE` against its twenty internal gates                   |
| Phase 3 — Phase 1 (privacy auth)     | `PARTIAL` by documented reporting choice; merged               |
| Phase 3 — Phase 2 (redaction engine) | `COMPLETE` against its stated scope; merged in `09e66bd`       |
| Phase 3 — Phase 3 (UI, retention)    | `NOT STARTED`                                                  |
| Phase 3 — Phase 4 (Connect, final)   | `NOT STARTED`                                                  |
| Real Stripe                          | `EXTERNAL VERIFICATION PENDING`                                |
| Real Stripe Connect                  | `EXTERNAL VERIFICATION PENDING`                                |
| Payment mode                         | `MOCK` — production payment processing `DISABLED`              |
| Retention durations                  | `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`                     |
| Personal data redacted in production | **None.** Every redaction has run against disposable test data |

**No personal data has been redacted by this system. No retention deletion has
ever run. No real Stripe or Stripe Connect call has ever been made from this
code.**

---

## Read these first

Five documents, in this order. Everything else is evidence behind them.

| #   | File                                          | Sections                                      | What only this one answers                                                                                           |
| --- | --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/PHASE3_IMPLEMENTATION_REPORT.md`        | §3 table, §3.0, §3A, §4                       | The cross-phase index: which sub-phase is done, which has not begun, and the commit and CI run behind each           |
| 2   | `PHASE2_STATUS.md`                            | header, §2, §5, §7, §10, §12.1                | Phase 2's verdict. It explicitly overrides every other Phase 2 file, and lists what "complete" deliberately excludes |
| 3   | `PHASE1_IMPLEMENTATION_REPORT.md`             | header, "Why this is COMPLETE", "What is not" | Project Phase 1's standing record                                                                                    |
| 4   | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` | §1.3, §1.4, §1.5, §8                          | Why Phase 3's Phase 1 is `PARTIAL`. §1.5 is the shortest complete list of its open decisions                         |
| 5   | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` | §7, §11, §12.0, §14                           | The redaction engine's record, its ten limitations, and the three decisions merging did not resolve                  |

Add `docs/PHASE3_IMPLEMENTATION_PLAN.md` §15 only to learn what Phase 3's
Phase 3 and Phase 4 are _supposed_ to contain — it is a plan and claims no
implementation.

---

## Authority map

| Scope                        | Current state                                       | Authoritative source                                                      | Supporting evidence                                                 | Historical / superseded                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project Phase 1              | `COMPLETE`                                          | `PHASE1_IMPLEMENTATION_REPORT.md`                                         | `PHASE1_FINAL_CLOSURE_REPORT.md` §7 (its ten remaining limitations) | `POST_EFDA577_CORRECTIVE_REPORT.md` — its own header retracts its `PARTIAL` verdict                                                                                                                                                                          |
| Project Phase 2 / commerce   | `COMPLETE`, 20/20 gates                             | `PHASE2_STATUS.md`                                                        | `PHASE2_GATE17_CLOSURE_REPORT.md` §13 (gate 17 evidence)            | `PHASE2_IMPLEMENTATION_REPORT.md`, `PHASE2_COMPLETION_REPORT.md`, `PHASE2_COMMERCE_CYCLE_REPORT.md`, `PHASE2_FINAL_VERIFICATION_REPORT.md`, `PHASE2_FINAL_CLOSEOUT_REPORT.md`, `PHASE2_POST_CLOSEOUT_VERIFICATION.md`, `PHASE2_REQUIREMENTS_TRACEABILITY.md` |
| Phase 3 — Phase 1            | `PARTIAL` by reporting choice                       | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md`                             | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                           | —                                                                                                                                                                                                                                                            |
| Phase 3 — Phase 2            | `COMPLETE` against scope; merged                    | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md`                             | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3A and §3.0                 | —                                                                                                                                                                                                                                                            |
| Phase 3 — Phase 3            | `NOT STARTED`                                       | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                                 | scope in `docs/PHASE3_IMPLEMENTATION_PLAN.md` §15                   | its report file does not exist                                                                                                                                                                                                                               |
| Phase 3 — Phase 4            | `NOT STARTED`                                       | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                                 | subject matter in `docs/STRIPE_CONNECT.md`                          | its report file does not exist                                                                                                                                                                                                                               |
| Privacy policy and retention | policy current; §2 and §4 tables superseded in part | `docs/PRIVACY_AND_RETENTION.md` §8 and "Phase 2: what is now implemented" | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md`                       | §2 and §4 status columns — labelled in place                                                                                                                                                                                                                 |
| Real Stripe / Connect        | `EXTERNAL VERIFICATION PENDING`                     | `docs/STRIPE_CONNECT.md`, `docs/PAYMENTS.md`                              | `PHASE2_STATUS.md`                                                  | —                                                                                                                                                                                                                                                            |
| Production payment readiness | `DISABLED`, not verified, not production-ready      | `PHASE2_STATUS.md` header                                                 | `apps/api/tests/payment-kill-switch.test.js`                        | —                                                                                                                                                                                                                                                            |
| Branch protection            | ruleset active on `main`; its automation unverified | `PHASE2_GATE17_CLOSURE_REPORT.md` §13                                     | live ruleset                                                        | `docs/BRANCH_PROTECTION.md` measured-state table (2026-09-16)                                                                                                                                                                                                |

---

## Current phase index

| Phase             | Scope                                                        | Status                                                                      | Authoritative report                          | Commit                | CI evidence                  |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- | --------------------- | ---------------------------- |
| Project Phase 1   | Catalogue, holds, checkout, tickets                          | `COMPLETE against Phase 1 scope`                                            | `PHASE1_IMPLEMENTATION_REPORT.md`             | —                     | see that report              |
| Project Phase 2   | Commerce, refunds, ledger, disputes, payouts, CI             | `COMPLETE against its 20 internal gates`                                    | `PHASE2_STATUS.md`                            | —                     | see §2 of that report        |
| Phase 3 — Phase 1 | Privacy authorization, step-up policy, schema foundation     | `PARTIAL` — implemented scope complete; named deviation and deferral remain | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` | `aeb65d6` + `d177e2d` | `35189099797` — success, 8/8 |
| Phase 3 — Phase 2 | Redaction service, immutable evidence, data integrity, holds | `COMPLETE against its stated scope; merged`                                 | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` | `0508da1` + `723f7af` | `35244793473` — success, 8/8 |
| Phase 3 — Phase 3 | Privacy UI, exports, retention worker, operations            | `NOT STARTED`                                                               | none — file does not exist                    | —                     | —                            |
| Phase 3 — Phase 4 | Connect mock, sandbox readiness, adversarial verification    | `NOT STARTED`                                                               | none — file does not exist                    | —                     | —                            |

Merged to `main` in merge commit `09e66bd` by `KWinOverAnything` at
`2026-09-17T16:46:06Z`, carrying eleven commits: Phase 3's Phase 1 and Phase 2
together, because Phase 1 was never merged separately.

---

## Historical reports

These are **evidence**, not current status. Each was accurate for its cycle.
Read them to learn _how_ something was established, never to learn _what is true
now_.

| File                                   | Still useful for                                          | Do not use for                                  |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `PHASE1_FINAL_CLOSURE_REPORT.md`       | §7 — the only list of Phase 1's ten remaining limitations | Phase 1 status                                  |
| `POST_EFDA577_CORRECTIVE_REPORT.md`    | The adversarial-review narrative                          | Phase 1 status — its own header retracts it     |
| `PHASE2_IMPLEMENTATION_REPORT.md`      | Early Phase 2 work-item detail                            | Gate status, test totals                        |
| `PHASE2_COMPLETION_REPORT.md`          | Mid-cycle gate reasoning                                  | Gate tallies — revised at least three times     |
| `PHASE2_COMMERCE_CYCLE_REPORT.md`      | Commerce implementation narrative                         | Status — it defers to `PHASE2_STATUS.md` itself |
| `PHASE2_FINAL_VERIFICATION_REPORT.md`  | The 19-agent browser-exposure audit                       | Gate status — self-marked superseded            |
| `PHASE2_FINAL_CLOSEOUT_REPORT.md`      | §9A — CI root-cause analysis                              | Gate 17, overall status                         |
| `PHASE2_POST_CLOSEOUT_VERIFICATION.md` | A cold verification at commit `354e66f`                   | Gate 17 — superseded by the gate 17 closure     |
| `PHASE2_REQUIREMENTS_TRACEABILITY.md`  | Requirement-to-code mapping                               | Status — internally stale in several rows       |

Reference documents that are **not** status records and should not be read as
such: `README.md`, `docs/architecture.md`, `docs/api.md`,
`docs/development.md`, `docs/BRANCH_PROTECTION.md`.

---

## Important corrections and stale entry points

### Corrected in this pass, 2026-09-17

| Where                                     | Was                                                  | Now                                                                  |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3 | Phase 2 row read `not started`, no commit, no CI run | Corrected, with §3.0 explaining the merge and exactly what CI proved |
| `PHASE2_STATUS.md` line 3                 | "Phase 3 has not been started"                       | Labelled current-status update; Phase 2's own verdict untouched      |
| `PHASE2_STATUS.md` §12.3                  | Phase 3 prerequisites read as current                | Labelled `HISTORICAL STATUS — SUPERSEDED`                            |
| `docs/PRIVACY_AND_RETENTION.md` §2        | Three rows read `NOT IMPLEMENTED`                    | Labelled superseded in part; the three rows still true are named     |
| `docs/DATA_MODEL.md`                      | "two read routes"                                    | Updated: nine privacy operations; what is still true is restated     |

### Known and deliberately left alone

- **`PHASE2_STATUS.md` §5.1 and §6.2** still contain passages saying gate 14 is
  `PARTIAL`, contradicting that file's own §5 table which says `MET`. Resolving
  it means deciding which is right about gate 14, which is a Phase 2 question
  and not this pass's to answer.
- **Pull request #5's body** names `62a71e9` as head and cites the pre-merge CI
  run. It is a merged, external GitHub artefact; it was not edited.
- **A migration comment** at `20260917060000_…/migration.sql:555` names three
  write paths where only one writes addresses. It cannot be corrected without
  breaking `migrate deploy` checksums, and is recorded in
  `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` §11.8.

### The one that changes how you read every other number

`docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` §12.0 records that
`scripts/check-skipped-tests.mjs` matched `pending`/`todo` while Vitest's JSON
reporter writes `skipped`. **It never detected a skip.** Every "0 skipped" claim
published before commit `723f7af` was therefore never checked by the gate cited
for it. Those claims may still be true — and for the CI runs cited they
demonstrably are, by per-task counts — but they rest on the counts, not on the
gate. The gate was fixed in `723f7af` and has since run green on a runner.

---

## Open decisions and external prerequisites

Separated by what each actually blocks. Not everything here blocks the next
phase.

| Category      | Decision / prerequisite                                                                | Status                              | Blocks exactly                                                                  | Blocks Phase 3–Phase 3 code? | Owner         |
| ------------- | -------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ------------- |
| Legal/privacy | Historic immutable `AuditLog` rows contain personal data and cannot be redacted        | `OWNER DECISION REQUIRED`           | A truthful "your erasure is complete" statement to a data subject               | No                           | Owner + legal |
| Legal         | No counsel-approved retention durations; all remain `PROPOSED`                         | `BLOCKED — REQUIRES OWNER DECISION` | Any real retention deletion; the sweeper stays dry-run                          | **Design only** — not the UI | Legal         |
| Legal         | Jurisdiction and the shape of a legal-hold / fraud-hold record                         | `OWNER DECISION REQUIRED`           | Retention and hold operations                                                   | Partly                       | Legal         |
| Data          | Backfill `NotificationOutbox.organizationId` on pre-fix rows (all `null`)              | `OWNER DECISION REQUIRED`           | Complete delivery-evidence scrub for older rows                                 | No                           | Owner         |
| Data          | Platform-level erasure for a subject in more than one organisation                     | `OWNER DECISION REQUIRED`           | Erasure completeness for multi-organisation subjects                            | No                           | Owner         |
| Schema        | `privacy_request_held_names_its_hold` contradicts the `HELD` enum's documented meaning | `OWNER DECISION REQUIRED`           | Changing that constraint. Proposed SQL is written and not applied               | No                           | Owner         |
| External      | Stripe test-mode account and sandbox credentials                                       | `EXTERNAL VERIFICATION PENDING`     | Every `EXTERNAL VERIFICATION PENDING` item in the repository                    | No                           | Owner         |
| External      | Merchant-of-record decision and who absorbs a negative balance                         | `OWNER DECISION REQUIRED`           | Production Connect architecture. ADR 0003 covers sandbox only                   | No                           | Owner         |
| Ops           | Branch-protection automation has never completed a successful run                      | Unverified                          | Nothing gate-wise — the live ruleset is active — but the automation is unproven | No                           | Owner         |

Read that table with its distinctions intact. Retention approval blocks
_deletion_, not privacy UI work. Stripe credentials block _external
verification_, not mock-mode documentation. The audit-PII decision blocks a
_claim_, not code.

---

## What CI proves — and does not prove

The last run before the merge, verified from GitHub:

| Fact                     | Value                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| Run                      | `35244793473`, **attempt 2**                                                    |
| Head SHA                 | `723f7af`                                                                       |
| Event                    | `pull_request`                                                                  |
| Conclusion               | `success`, 8 of 8 jobs                                                          |
| Skipped-test gate        | step 17 `Refuse an undeclared skipped test` — `success`                         |
| Cases                    | `4889 case(s) ran across 16 report(s); 0 skipped, 0 allow-listed, 0 undeclared` |
| `apps/api` coverage      | statements 87.28, **branches 76.06**, functions 92.28, lines 89.98 (floor 75)   |
| Fresh / upgrade database | 96/96 and 24/24                                                                 |
| Payment kill switch      | step 26 `Production payments are unreachable` — `success`                       |

### What it proves about `main`

**No CI run has ever had `09e66bd` as its head SHA.** What closes that gap is a
measurement, not an assumption: `723f7af` and `09e66bd` have the **same tree**,
`8b53048d643b4c1ef7cdbd8810cb01a0b6041f95`, and `d1e0dd2` is an ancestor of
`723f7af`, so the merge changed no file. The content on `main` is byte-identical
to the content that ran green.

That is stronger than "CI passed on the branch" and weaker than "CI ran on
`main`". Both halves matter and neither should be dropped when quoting it.

**Attempt 1 of that run started no jobs at all** — all eight were refused by
GitHub for an account billing condition, each reporting zero steps. No code
differed between the attempts.

### What it does not prove

A green run here is a statement about this repository's own checks in mock mode.
It is **not** evidence of: production card processing; any real Stripe or Stripe
Connect behaviour; legal, privacy, GDPR, CCPA/CPRA, PCI DSS or HIPAA compliance;
behaviour under production load; or operational incident readiness.

---

## How to verify this yourself

```bash
# The merge, its parents, and who merged it
git log -1 --format='%H%nparents=%P%nauthor=%an <%ae>%ndate=%cI' 09e66bd

# The claim that main's content equals the tested commit
git rev-parse 723f7af^{tree} 09e66bd^{tree}   # must print the same SHA twice
git diff 723f7af 09e66bd                      # must print nothing

# What the merge added
git log --oneline d1e0dd2..09e66bd

# Which phase reports exist, and which do not
ls docs/PHASE3_*.md
test -f docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md || echo 'Phase 3-3: no report — NOT STARTED'
test -f docs/PHASE3_FINAL_VERIFICATION_REPORT.md   || echo 'Phase 3-4: no report — NOT STARTED'

# Every explicit correction or supersession marker
grep -rnE '^(#{1,6} .*(Correction|HISTORICAL STATUS|SUPERSEDED|Current-status update))|^> \*\*(Correction|HISTORICAL STATUS|Current-status update)' \
  --include='*.md' . --exclude-dir=node_modules --exclude-dir=.git
```

Repository validation:

```bash
pnpm run policy:check
pnpm run secrets:scan
pnpm run format:check
pnpm run lint
pnpm run contract:check
pnpm run test
pnpm run build
```

The integration suites need PostgreSQL and Redis. Without them, database-backed
suites skip themselves, coverage falls below its floor, and — since `723f7af` —
the skipped-test gate fails loudly rather than reporting a clean run.

---

## Scope warning

Everything recorded in this repository was produced in mock mode, against
disposable data, under this project's own internal gates.

**Merged code, green internal CI, and a `COMPLETE` phase verdict do not prove:**

- production card processing;
- real Stripe verification;
- Stripe Connect verification;
- legal or privacy compliance in any jurisdiction;
- PCI DSS compliance;
- behaviour at production scale;
- production incident readiness.

No compliance claim is made for GDPR, CCPA/CPRA, PCI DSS, HIPAA or any other
regime. Retention durations are `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`. A
data subject cannot truthfully be told their erasure is complete while historic
immutable audit rows stand.
