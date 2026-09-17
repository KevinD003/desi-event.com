# Phase 3 implementation report

A record, kept as evidence is produced. It is not a summary written at the end,
and it is not marketing copy: where something is unproven it says so, and where
a claim was wrong it is corrected here rather than quietly replaced.

Phase 3 has two authorised workstreams — auditable privacy-preserving redaction,
and Stripe Connect readiness in mock mode only — delivered in four direct
phases. Each phase has its own report; this file is the spine that ties them
together and holds the starting state.

---

## 1. Starting state

Measured 2026-09-17T05:16Z, from the repository and the GitHub API, before any
Phase 3 file was written.

| Fact               | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Branch             | `claude/desi-event-js-stack-gb4uqe`                                    |
| Local HEAD         | `f7cbe25f9636a7651b75a43a8704d33622367011`                             |
| Upstream HEAD      | `f7cbe25f9636a7651b75a43a8704d33622367011` — 0 ahead, 0 behind         |
| `origin/main`      | `d1e0dd2fc88817d7f0ae8a11c48b0c2d3d5e320c` — HEAD is 2 ahead, 0 behind |
| Working tree       | clean; `git status --porcelain=v1` returned 0 entries                  |
| Worktrees          | one                                                                    |
| Open pull requests | none; #1–#4 are all closed and merged                                  |

No unknown or uncommitted file existed at the start. Nothing was reset,
stashed, discarded or committed on anybody's behalf.

### 1.1 Baseline CI for the exact starting HEAD

**There was no CI run for `f7cbe25` when Phase 3 began.**
`GET /actions/runs?head_sha=f7cbe25…` returned `total_count: 0`,
`GET /commits/f7cbe25…/check-runs?filter=all` returned `total_count: 0`, and
`GET /commits/f7cbe25…/status` returned `state: pending` with zero statuses.

That is structural, not a failure. `.github/workflows/ci.yml` declares
`on: push: branches: [main]`, `pull_request` and `workflow_dispatch`, so a push
to a feature branch triggers nothing and no pull request was open.
**The baseline was therefore not green, and this report does not claim it was.**

Rather than assert a green baseline from an older commit, CI was dispatched
against the exact starting SHA:

| Baseline run | `35185073072`, event `workflow_dispatch`, ref `claude/desi-event-js-stack-gb4uqe`, head `f7cbe25` |
| ------------ | ------------------------------------------------------------------------------------------------- |

**It completed `success`, 8 of 8 jobs.** `Policy, lint, contract, tests, build`,
`Browser — public catalogue`, `Browser — production build`,
`Browser — organiser venue maps`, `Browser — event lifecycle`,
`Browser — refusals`, `Browser — accessibility sweep` and
`Browser — commerce and operations detail` — every one `success`. The baseline
for the exact starting SHA is therefore green, established by running it rather
than by inheriting a claim from an earlier commit.

`workflow_dispatch` is the mechanism used throughout Phase 3 to obtain a real CI
run on an exact feature-branch SHA without opening a pull request.

The last previously verified green run, for reference, is `35178489515` on
`d1e0dd2` (`origin/main`), event `push`, 8 of 8 jobs `success`.

### 1.2 Baseline security controls

Each verified by reading the code, not by reading an earlier report.

| Control                                    | State at the start                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability vocabulary                      | 36 capabilities in `packages/permissions/src/capabilities.js`, pinned for exact equality by `capabilities.test.js`                                                                                                                           |
| Platform-only capabilities                 | 5 — `support:view_order`, `moderation:review`, `reconciliation:manage`, `ledger:manage`, `platform:admin`; an org role granting one throws at import                                                                                         |
| Privacy / erasure capability               | none                                                                                                                                                                                                                                         |
| Step-up policies                           | 9 in `packages/auth/src/sessions.js`; `stepUpWindowFor` throws on an unknown name rather than defaulting                                                                                                                                     |
| Step-up policy for irreversible data loss  | none                                                                                                                                                                                                                                         |
| Contract-driven guards                     | `requireMfaEnrolment` → `requireCapability` → `requireStepUp`, installed from the contract by `apps/api/src/lib/register.js`, never from a handler                                                                                           |
| Organisation-scope inversion guard (NF-05) | three independent mechanisms: contract validation, the runtime guard's `CAPABILITY_SCOPE_MISSING`, and a whole-contract test                                                                                                                 |
| Database triggers                          | 20 `CREATE TRIGGER` statements; ledger batches and entries immutable once `POSTED`                                                                                                                                                           |
| CHECK constraints                          | 34                                                                                                                                                                                                                                           |
| Audit immutability                         | **convention only** — no trigger, no constraint, no revoked grant on `AuditLog`                                                                                                                                                              |
| Audit organisation scope                   | none — `AuditLog` has no `organizationId` column and no `requestId` column                                                                                                                                                                   |
| Payment mode                               | `MOCK`; production payments refused at boot by `assertPaymentModeAllowed` and proven unreachable by `apps/api/tests/payment-kill-switch.test.js`                                                                                             |
| Stripe SDK import sites                    | exactly one, `packages/providers/src/stripe.js`, asserted by the kill-switch test                                                                                                                                                            |
| Connect                                    | `ConnectedAccount` and `ConnectOnboardingStatus` exist; three adapter methods exist on the real adapter with **no callers**; the mock has none                                                                                               |
| Coverage floor                             | `branches: 75` in `packages/config/src/vitest-node.js`; the `apps/api` margin is thin                                                                                                                                                        |
| Branch protection on `main`                | re-read live at 05:14Z: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`; 1 approving review; stale reviews dismissed; thread resolution required; strict up-to-date policy; 8 required contexts; ruleset `23572317` |

**Real Stripe remains disabled.** Payment mode is `MOCK`, the production kill
switch is intact, no Stripe credential exists in this repository, and no real
Stripe or Stripe Connect call is made by any code Phase 3 adds. Every real
Stripe and Stripe Connect operation remains **EXTERNAL VERIFICATION PENDING**
until the repository owner intentionally supplies sandbox credentials and
separately authorises external verification.

**Phase 3 work is beginning.** No user data has been redacted, no retention
deletion has run, and no production configuration has changed.

---

## 2. Corrections to earlier Phase 3 documents

Recorded here rather than silently rewritten, which is this repository's
established convention.

1. `docs/PHASE3_IMPLEMENTATION_PLAN.md` §4.5 states "23 capabilities" and lists
   23 names. **The real count is 36.** The list in the plan omitted
   `event:pause_sales`, `event:submit_review`, `event:view_draft`,
   `hold:release_any`, `order:refund_approve`, `order:refund_request`,
   `organization:submit_verification`, `support:view_order`, `team:role_manage`,
   `ticket:check_in`, `ticketType:manage`, `venueMap:manage` and counted
   `order:refund` once where three refund capabilities exist. Verified by
   executing the module and by reading `capabilities.js:67-164`. The plan's
   conclusion — that no privacy capability exists — was correct.
2. The plan's §4.6 and §4.2 counts (9 step-up policies, 49 models, 18 triggers)
   were re-checked. Step-up policies: 9, correct. Models: 49, correct.
   Triggers: **20**, not 18 — the plan's list omitted `desi_map_version_frozen`
   as a shared function driving three triggers (`desi_section_frozen`,
   `desi_seat_row_frozen`, `desi_price_zone_frozen`), and
   `desi_map_version_revision_forward`. Sourced from
   `grep -rn 'CREATE TRIGGER' packages/db/prisma/migrations/`, which is the only
   reliable index; `docs/DATA_MODEL.md` also says 20.

## 3. Phase records

| Phase                                                            | Report                                        | Commit                  | CI run                                                        | State                        |
| ---------------------------------------------------------------- | --------------------------------------------- | ----------------------- | ------------------------------------------------------------- | ---------------------------- |
| Baseline                                                         | this file, §1                                 | `f7cbe25`               | `35185073072` — success, 8/8                                  | verified green               |
| 1 — Privacy authorization, policy enforcement foundation, schema | `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` | `aeb65d6`, then the fix | `35187664416` — **failure**, 7/8; see the Phase 1 report §1.1 | superseded by the fix commit |
| 2 — Redaction service, immutable audit evidence, data integrity  | `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` | —                       | —                                                             | not started                  |
| 3 — Privacy UI, exports, retention worker, operations            | `docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md` | —                       | —                                                             | not started                  |
| 4 — Connect mock, sandbox readiness, adversarial verification    | `docs/PHASE3_FINAL_VERIFICATION_REPORT.md`    | —                       | —                                                             | not started                  |

### 3.1 Runs, in order

| Run           | Commit    | Event               | Conclusion  | Jobs                                   |
| ------------- | --------- | ------------------- | ----------- | -------------------------------------- |
| `35185073072` | `f7cbe25` | `workflow_dispatch` | success     | 8/8                                    |
| `35187664416` | `aeb65d6` | `workflow_dispatch` | **failure** | 7/8 — `Browser — organiser venue maps` |

No run was cancelled. The eight `if: failure()` artefact uploads are skipped on
every green job; on the failing job the upload ran and succeeded, which is the
only time that path is exercised.

The failure is analysed in `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` §1.1:
one failure this change caused and fixed, one that could not be reproduced in
four local runs and for which no mechanism connects it to this change. Neither
is written off as a flake.

## 4. Known conflicts between the authorised rules and the repository

Named here as they are found, with the stronger control preserved.

1. **Route-contract metadata cannot be declared ahead of a handler.**
   `apps/api/tests/contract.test.js` asserts that every route in the contract is
   registered on the server. Declaring privacy route descriptors before their
   handlers exist would fail that test. The stronger control is kept: each
   privacy route descriptor lands in the same phase as its handler.
2. **`AuditLog.metadata` already contains raw e-mail addresses**, written by
   `apps/api/src/lib/tickets.js`, `apps/api/src/lib/checkout.js` and
   `apps/api/src/routes/teams.js`, in the one table `docs/DATA_MODEL.md`
   describes as unprunable. The authorised rules say existing audit rows are
   retained unchanged, so those historical addresses cannot be redacted in
   place. This is recorded as **BLOCKED — REQUIRES OWNER DECISION** and carried
   through the phase reports rather than silently omitted.
3. **`LedgerEntry.memo` is permanently unredactable.** `desi_ledger_entry_immutable`
   refuses any UPDATE once the owning batch is `POSTED`. If a memo ever carried
   a person's name, no mechanism can remove it. Financial immutability is the
   stronger control and is preserved.
