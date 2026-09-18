# Desi-Event Status Reading Guide

Written 2026-09-17, against merged `main` at `510d75a`.

This repository keeps its history rather than rewriting it. That is a deliberate
discipline and it has a cost: there are more than thirty status-bearing
documents, several of them superseded, and a reader who opens the wrong one
first gets a confident answer that is two cycles out of date.

This guide is **navigation only**. It decides nothing, supersedes no report, and
introduces no status of its own. Where it and a source report disagree, **the
source report is right and this file is stale** — tell somebody.

---

## Current status at a glance

| Scope                                | State                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| Project Phase 1                      | `COMPLETE` against Phase 1 scope                               |
| Project Phase 2 (commerce)           | `COMPLETE` against its twenty internal gates                   |
| Phase 3 — Phase 1 (privacy auth)     | `PARTIAL` by documented reporting choice; merged               |
| Phase 3 — Phase 2 (redaction engine) | `COMPLETE` against its stated scope; merged                    |
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
| 1   | `docs/PHASE3_IMPLEMENTATION_REPORT.md`        | §3 table, §3.0, §3.0.1, §3A, §4               | The cross-phase index: which sub-phase is done, which has not begun, and the commit and CI run behind each           |
| 2   | `PHASE2_STATUS.md`                            | header, §2, §5, §7, §10, §12.1                | Phase 2's verdict. It explicitly overrides every other Phase 2 file, and lists what "complete" deliberately excludes |
| 3   | `PHASE1_IMPLEMENTATION_REPORT.md`             | header, "Why this is COMPLETE", "What is not" | Project Phase 1's standing record                                                                                    |
| 4   | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` | §1.3, §1.4, §1.5, §8                          | Why Phase 3's Phase 1 is `PARTIAL`. §1.5 is the shortest complete list of its open decisions                         |
| 5   | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` | §7, §11, §12.0, §14                           | The redaction engine's record, its limitations, and the decisions merging did not resolve                            |

Add `docs/PHASE3_IMPLEMENTATION_PLAN.md` §15 only to learn what Phase 3's
Phase 3 and Phase 4 are _supposed_ to contain — it is a plan and claims no
implementation.

---

## Current phase index

| Phase             | Scope                                                        | Status                                                                      | Authoritative report                          | Commit                | CI evidence                         |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- | --------------------- | ----------------------------------- |
| Project Phase 1   | Catalogue, holds, checkout, tickets                          | `COMPLETE against Phase 1 scope`                                            | `PHASE1_IMPLEMENTATION_REPORT.md`             | —                     | see that report                     |
| Project Phase 2   | Commerce, refunds, ledger, disputes, payouts, CI             | `COMPLETE against its 20 internal gates`                                    | `PHASE2_STATUS.md`                            | —                     | see §2 of that report               |
| Phase 3 — Phase 1 | Privacy authorization, step-up policy, schema foundation     | `PARTIAL` — implemented scope complete; named deviation and deferral remain | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` | `aeb65d6` + `d177e2d` | `35189099797` — success, 8/8        |
| Phase 3 — Phase 2 | Redaction service, immutable evidence, data integrity, holds | `COMPLETE against its stated scope; merged`                                 | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` | `0508da1` + `723f7af` | `35248621822` att. 2 — success, 8/8 |
| Phase 3 — Phase 3 | Privacy UI, exports, retention worker, operations            | `NOT STARTED`                                                               | none — file does not exist                    | —                     | —                                   |
| Phase 3 — Phase 4 | Connect mock, sandbox readiness, adversarial verification    | `NOT STARTED`                                                               | none — file does not exist                    | —                     | —                                   |

`PARTIAL` on Phase 3's Phase 1 is a **reporting convention** about named
deviations and deferrals, not a claim that its code is half-finished. Read its
own report rather than this row.

"No report file exists" is the evidence for `NOT STARTED`, and it is checkable:
`docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md` and
`docs/PHASE3_FINAL_VERIFICATION_REPORT.md` are both absent from the tree.

---

## Authority map

| Scope                        | Current state                                       | Authoritative source                                                      | Supporting evidence                                                 | Historical / superseded                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project Phase 1              | `COMPLETE`                                          | `PHASE1_IMPLEMENTATION_REPORT.md`                                         | `PHASE1_FINAL_CLOSURE_REPORT.md` §7 (its ten remaining limitations) | `POST_EFDA577_CORRECTIVE_REPORT.md` — its own header retracts its `PARTIAL` verdict                                                                                                                                                                          |
| Project Phase 2 / commerce   | `COMPLETE`, 20/20 gates                             | `PHASE2_STATUS.md`                                                        | `PHASE2_GATE17_CLOSURE_REPORT.md` §13 (gate 17 evidence)            | `PHASE2_IMPLEMENTATION_REPORT.md`, `PHASE2_COMPLETION_REPORT.md`, `PHASE2_COMMERCE_CYCLE_REPORT.md`, `PHASE2_FINAL_VERIFICATION_REPORT.md`, `PHASE2_FINAL_CLOSEOUT_REPORT.md`, `PHASE2_POST_CLOSEOUT_VERIFICATION.md`, `PHASE2_REQUIREMENTS_TRACEABILITY.md` |
| Phase 3 — Phase 1            | `PARTIAL` by reporting choice                       | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md`                             | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                           | —                                                                                                                                                                                                                                                            |
| Phase 3 — Phase 2            | `COMPLETE` against scope; merged                    | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md`                             | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3A, §3.0 and §3.0.1         | —                                                                                                                                                                                                                                                            |
| Phase 3 — Phase 3            | `NOT STARTED`                                       | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                                 | scope in `docs/PHASE3_IMPLEMENTATION_PLAN.md` §15                   | its report file does not exist                                                                                                                                                                                                                               |
| Phase 3 — Phase 4            | `NOT STARTED`                                       | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3                                 | subject matter in `docs/STRIPE_CONNECT.md`                          | its report file does not exist                                                                                                                                                                                                                               |
| Privacy policy and retention | policy current; §2 and §4 tables superseded in part | `docs/PRIVACY_AND_RETENTION.md` §8 and "Phase 2: what is now implemented" | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md`                       | §2 and §4 status columns — labelled in place                                                                                                                                                                                                                 |
| Real Stripe / Connect        | `EXTERNAL VERIFICATION PENDING`                     | `docs/STRIPE_CONNECT.md`, `docs/PAYMENTS.md`                              | `PHASE2_STATUS.md`                                                  | —                                                                                                                                                                                                                                                            |
| Production payment readiness | `DISABLED`, not verified, not production-ready      | `PHASE2_STATUS.md` header                                                 | `apps/api/tests/payment-kill-switch.test.js`                        | —                                                                                                                                                                                                                                                            |
| Journey 14 CI investigation  | `NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN`         | `docs/CI_RUN_35248621822_EVENT_LIFECYCLE_EVIDENCE.md`                     | `docs/POST_MERGE_CI_RELIABILITY_FIX_REPORT.md`                      | that file's own §8, superseded in part by its §7A                                                                                                                                                                                                            |

---

## The privacy surface, since it is the most-misquoted number

`docs/DATA_MODEL.md` said for a while that privacy was "two read routes". It is
**nine operations**, counted from `packages/api-contract/src/route-manifest.js`,
all under `/v1/organizations/:id/privacy/…`:

| Method | Path                                     | Kind            |
| ------ | ---------------------------------------- | --------------- |
| GET    | `/v1/organizations/:id/privacy/requests` | read            |
| GET    | `…/requests/:requestId`                  | read            |
| GET    | `…/requests/:requestId/events`           | read (audit)    |
| GET    | `/v1/organizations/:id/privacy/holds`    | read            |
| POST   | `/v1/organizations/:id/privacy/requests` | command (raise) |
| POST   | `…/requests/:requestId/confirm`          | command         |
| POST   | `…/requests/:requestId/cancel`           | command         |
| POST   | `/v1/organizations/:id/privacy/holds`    | command         |
| POST   | `…/holds/:holdId/release`                | command         |

Nine operations over **seven** distinct paths — `/privacy/requests` and
`/privacy/holds` each carry both a GET and a POST. Four reads and five commands;
equivalently, six request operations and three hold operations. (The old draft
said "two hold routes"; there are three.)

**Every one of the nine requires `privacy:redact`**, including the reads —
`apps/api/src/routes/privacy.js` explains why reading who has asked to be erased
needs the same authority as erasing them — and that capability is granted to the
organisation `OWNER` and to nobody else. **The five commands additionally require
a fresh `PRIVACY_ERASURE` step-up; the four reads do not.**

Adding these operations widened what can be done, not who may do it. Organization
scoping, hold refusals, and the immutability of `AuditLog` and `PrivacyAuditEvent`
all still apply.

**What is not built:** any privacy **user interface** (this is API-only), export
invalidation or deletion (`ExportArtifact` is schema), and retention **execution**
(nothing creates a `RetentionSweep` row at all). Those are Phase 3's Phase 3.

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

## Labelled corrections, and where they live

Every correction in this repository is labelled in place rather than applied
silently. These are the current ones:

| Where                                          | Was                                       | Now                                                                  |
| ---------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `PHASE2_STATUS.md` line 3                      | "Phase 3 has not been started"            | Labelled current-status update; Phase 2's own verdict untouched      |
| `PHASE2_STATUS.md` §12.3                       | Phase 3 prerequisites read as current     | Labelled `HISTORICAL STATUS — SUPERSEDED`                            |
| `docs/DATA_MODEL.md`                           | "no redaction command"; "two read routes" | Labelled update: engine exists; nine operations, itemised            |
| `docs/PRIVACY_AND_RETENTION.md` §2             | Two rows read `NOT IMPLEMENTED`           | Labelled superseded in part; the four rows still true are named      |
| `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3      | Phase 2 row read `not started`            | Corrected, with §3.0 and §3.0.1 explaining the merges and current CI |
| `docs/CI_RUN_…_EVENT_LIFECYCLE_EVIDENCE.md` §8 | Journey 14 called "deterministic on CI"   | Withdrawn in §7A; the failure is intermittent                        |

### Known and deliberately left alone

- **`PHASE2_STATUS.md` §5.1 and §6.2** still contain passages saying gate 14 is
  `PARTIAL`, contradicting that file's own §5 table which says `MET`. Resolving
  it means deciding which is right about gate 14, which is a Phase 2 question.
- **Pull request #5's body** names `62a71e9` as head and cites the pre-merge CI
  run. It is a merged, external GitHub artefact and was not edited.
- **A migration comment** at `20260917060000_…/migration.sql:555` names three
  write paths where only one writes addresses. It cannot be corrected without
  breaking `migrate deploy` checksums, and is recorded in
  `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` §11.8.
- **`apps/web/e2e/support/seed-refusals.mjs`** once carried a dead
  `auditLog.deleteMany`. It was removed; the source invariant at
  `apps/web/src/lib/e2e-seed-invariants.test.js` now prevents its return in any
  seed.

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
| External      | Stripe account and credentials                                                         | `EXTERNAL VERIFICATION PENDING`     | Every `EXTERNAL VERIFICATION PENDING` item in the repository                    | No                           | Owner         |
| External      | Merchant-of-record decision and who absorbs a negative balance                         | `OWNER DECISION REQUIRED`           | Production Connect architecture. ADR 0003 covers sandbox only                   | No                           | Owner         |
| Ops           | Branch-protection automation has never completed a successful run                      | Unverified                          | Nothing gate-wise — the live ruleset is active — but the automation is unproven | No                           | Owner         |

Read that table with its distinctions intact. Retention approval blocks
_deletion_, not privacy UI work. Stripe credentials block _external
verification_, not mock-mode documentation. The audit-PII decision blocks a
_claim_, not code.

The repository owner has stated that Stripe access will be provided only after
the project is otherwise complete. Until then, payment mode stays `MOCK`,
production payment processing stays disabled, and every real Stripe and Connect
item stays `EXTERNAL VERIFICATION PENDING`.

---

## What CI proves — and does not prove

### The runs that matter, from GitHub

| Head commit | Run           | Branch / event          | Result                                                      |
| ----------- | ------------- | ----------------------- | ----------------------------------------------------------- |
| `723f7af`   | `35244793473` | branch / `pull_request` | att. 2 — `success`, 8/8                                     |
| `09e66bd`   | `35248621822` | `main` / `push`         | att. 1 — **`failure`**, 2 jobs red; att. 2 — `success`, 8/8 |
| `7db5fec`   | `35273492335` | `main` / `push`         | `success`, 8/8, attempt 1                                   |
| `510d75a`   | `35279635031` | `main` / `push`         | `success`, 8/8, attempt 1                                   |

### What it proves about `main`

**`main` is green at `510d75a`.** Run `35279635031` is a `push` event whose head
SHA is that merge commit; all eight jobs concluded `success` on the first
attempt with no re-runs. That is direct evidence about `main` itself, not
inherited from a branch.

The two merge commits before it were tested the same way, directly. That matters
because inheritance is not proof: `09e66bd` shared a tree with a green branch
commit and its own first run still failed.

> **A false claim to watch for.** A superseded draft of this repository's status
> documentation asserted that **"No CI run has ever had `09e66bd` as its head
> SHA."** That is false. Run `35248621822` had exactly that head SHA, on `main`,
> on a `push` event, and concluded `failure` on attempt 1. The claim was never
> merged, and the branch carrying it must not be merged. See the scope note
> below.

### Journey 14, stated exactly

The event-lifecycle browser suite's journey 14 failed once, on `09e66bd`
attempt 1, with a 90-second timeout. It has passed on every observation since —
four of them, between 4.5 and 5.2 seconds each against the same 90-second
budget. Its status is:

```text
NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN
```

**Do not read that as fixed.** No change was made to journey 14, its spec, its
selectors or its timeouts. The App Router client-router-cache theory remains an
**unconfirmed candidate**. Three other theories are disproven and recorded:
the `AuditLog` cleanup did not cause it (the refusal is stamped in teardown,
88 seconds after the journey began), a slow runner did not cause it (journeys
1–13 took 23 seconds in total), and the organiser panel is not optimistic (it
sets status from the server's response). The evidence file is
`docs/CI_RUN_35248621822_EVENT_LIFECYCLE_EVIDENCE.md`; the page snapshot that
would settle it is in a CI artefact that the execution environment's egress
policy refuses.

### What it does not prove

A green run here is a statement about this repository's own checks in mock mode.
It is **not** evidence of: production card processing; any real Stripe or Stripe
Connect behaviour; legal, privacy, GDPR, CCPA/CPRA, PCI DSS or HIPAA compliance;
behaviour under production load; or operational incident readiness.

---

## How to verify this yourself

```bash
# Where main is, and what its own CI said
git rev-parse origin/main
gh api repos/KevinD003/desi-event.com/actions/runs/35279635031 \
  --jq '{head_sha, event, status, conclusion, run_attempt}'

# The historical failure that a superseded draft denied existed
gh api repos/KevinD003/desi-event.com/actions/runs/35248621822/attempts/1 \
  --jq '{head_sha, event, conclusion}'

# Which phase reports exist, and which do not
ls docs/PHASE3_*.md
test -f docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md || echo 'Phase 3-3: no report — NOT STARTED'
test -f docs/PHASE3_FINAL_VERIFICATION_REPORT.md   || echo 'Phase 3-4: no report — NOT STARTED'

# The privacy surface, counted rather than remembered
grep -c "id: 'privacy\." packages/api-contract/src/route-manifest.js

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

## A superseded branch that must not be merged

The branch `claude/docs-post-merge-status-reconciliation` contains an earlier
attempt at this guide. It holds genuinely useful corrections — the ones now
carried into `main` and listed above — **and two false statements** asserting
that no CI run ever had `09e66bd` as its head SHA.

It was assessed for deletion and **retained**, because deleting it would discard
the record; it was not merged, because merging it would publish the falsehood.
Its valid content has been ported here. Do not merge it. Do not quote its CI
section. The assessment is recorded in
`docs/CI_RUN_35248621822_EVENT_LIFECYCLE_EVIDENCE.md` §9 and the port in
`docs/STATUS_DOCUMENTATION_PORT_REPORT.md`.

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
