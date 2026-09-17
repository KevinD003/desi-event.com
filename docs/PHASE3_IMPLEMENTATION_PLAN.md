# Phase 3 implementation plan

**Phase 3 implementation has not started.** This document is a plan. No route,
schema, migration, provider call, UI surface or workflow has been written for
either workstream, and none will be until this plan is reviewed.

## 1. Baseline

Verified against GitHub and the working tree at 2026-09-17T04:45Z, not carried
from any earlier report.

| Fact              | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Starting commit   | **`d1e0dd2`** (`origin/main`, `protected: true`)          |
| Produced by       | merge of pull request #4, approved by `KWinOverAnything`  |
| Baseline CI run   | **`35178489515`**, workflow `CI`, event `push`, attempt 1 |
| Conclusion        | **`success`** — 8 of 8 jobs                               |
| Steps             | 137 `success`, 8 `skipped`, 0 other                       |
| Skipped steps     | the `if: failure()` artefact uploads, one per job         |
| Required vs green | identical sets; nothing required missing                  |
| Legacy statuses   | none (`total_count: 0`)                                   |
| Working tree      | clean                                                     |

Branch protection at baseline, unchanged by this plan and not to be changed by
Phase 3: `deletion`, `non_fast_forward`, `pull_request` and
`required_status_checks` in force; 1 approving review;
`dismiss_stale_reviews_on_push`; `required_review_thread_resolution`;
`strict_required_status_checks_policy`; `bypass_actors: []`;
`current_user_can_bypass: never`.

## 2. Scope and non-goals

**In scope — exactly two workstreams.**

1. A Stripe Connect onboarding interface and API boundary, **`MOCK-ONLY`**.
2. Data erasure implemented as auditable, privacy-preserving redaction.

**Explicit non-goals.** None of the following is authorised and none appears in
any milestone below: real Stripe API calls; Stripe test-mode or live-mode
credentials; creating, reading, printing or changing any secret; Stripe account
activation; live onboarding; production payment activation; real payouts,
transfers or refunds through a real provider; tax configuration; real provider
callbacks or webhooks; branch-protection, ruleset or required-context changes;
workflow-permission changes; and any product work outside these two
workstreams.

## 3. Verified inventory

Every line below was read in the repository at `d1e0dd2`. A declared adapter
method, capability constant or document paragraph is **not** treated as proof a
feature exists; a feature exists only where a caller path, an authorization
boundary, persistence and tests all exist.

### 3.1 Stripe Connect

| Finding                                                                                                 | Evidence                                                              | Status                                                                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `CONNECT_MANAGE: 'connect:manage'` — "Start provider onboarding and read the connected account's state" | `packages/permissions/src/capabilities.js:122-123`, granted at `:294` | `NOT IMPLEMENTED` (declared, **zero callers** outside `permissions/src`) |
| `PAYOUT_MANAGE: 'payout:manage'`                                                                        | `packages/permissions/src/capabilities.js:124-125`                    | `IMPLEMENTED` — used at `apps/api/src/routes/finance.js:300,392`         |
| Connect onboarding / account-link / account-status adapter method                                       | absent from `packages/providers/src/payments.js`                      | `NOT IMPLEMENTED`                                                        |
| Transfer to a connected account (`destination`)                                                         | `packages/providers/src/payments.js:704-714`                          | `MOCK-ONLY`                                                              |
| Connect webhook secret handling and same-secret guard                                                   | `packages/providers/src/payment-mode.js:299-321,444-473,518`          | `IMPLEMENTED`                                                            |
| Any Connect API route                                                                                   | none among the 22 files in `apps/api/src/routes/`                     | `NOT IMPLEMENTED`                                                        |
| Any Connect UI surface                                                                                  | none                                                                  | `NOT IMPLEMENTED`                                                        |
| Organization-to-provider-account persistence                                                            | no model, column or migration                                         | `NOT IMPLEMENTED`                                                        |
| Real Stripe network access from current code paths                                                      | no Stripe SDK import on any live path; mode guard refuses boot        | `DISABLED`                                                               |
| Real Stripe verification                                                                                | no credentials have ever been supplied                                | `EXTERNAL VERIFICATION PENDING`                                          |

**There is no adapter-defined Connect state vocabulary.** It does not exist yet
and will be defined by the mock seam in Milestone 2 — not copied from Stripe's
real vocabulary, and not documented before it is implemented.

### 3.2 Authorization

Twenty-three capabilities exist in `packages/permissions/src/capabilities.js`:
`attendee:export`, `connect:manage`, `event:cancel`, `event:create`,
`event:delete`, `event:publish`, `event:update`, `finance:view`,
`inventory:manage`, `ledger:manage`, `moderation:review`, `order:refund`,
`order:view`, `organization:manage`, `payout:manage`, `platform:admin`,
`promo:manage`, `reconciliation:manage`, `report:view`, `team:invite`,
`team:remove`, `ticket:revoke`, `venue:manage`.

**No privacy, redaction or erasure capability exists.** `attendee:export` is the
only privacy-adjacent one and is a bulk _read_, not a destructive action.

### 3.3 Step-up

Nine policies, `packages/auth/src/sessions.js:80-123`:

| Policy           | Window | Defined purpose                                                         |
| ---------------- | ------ | ----------------------------------------------------------------------- |
| `FINANCE_VIEW`   | 15 min | reading gross, fees, refunds, net                                       |
| `FINANCE_ACTION` | 5 min  | a refund, or resolving a reconciliation task                            |
| `PAYOUT`         | 5 min  | "A payout, **or a change to a connected account's payout destination**" |
| `CREDENTIAL`     | 2 min  | removing a factor, regenerating recovery codes                          |
| `SECURITY_ROLE`  | 2 min  | granting or removing a privileged role                                  |
| `EVENT_PUBLISH`  | 10 min | making an event public or open for sale                                 |
| `EVENT_CANCEL`   | 5 min  | cancelling or postponing a live event                                   |
| `MODERATION`     | 10 min | acting on somebody else's event                                         |
| `OPERATIONS`     | 5 min  | acting on an operational work item                                      |

`stepUpWindowFor` throws on an unknown name rather than defaulting
(`sessions.js:133-145`), so a typo cannot silently become a fifteen-minute
window. Each route declares its policy in the contract, so **a browser can
neither send a window nor widen one**. Status: `IMPLEMENTED`.

**No policy governs irreversible personal-data destruction.** `CREDENTIAL` and
`SECURITY_ROLE` concern authentication authority, not personal data.

### 3.4 Audit

`model AuditLog` — `packages/db/prisma/schema.prisma`: `id`, `actorId`,
`action`, `entityType`, `entityId`, `metadata Json?`, `createdAt`;
`actor User? @relation(onDelete: SetNull)`; indexed on
`[entityType, entityId]` and `[createdAt]`. Fifty action constants in
`apps/api/src/lib/audit.js`.

Two findings that shape Milestone 1:

1. **`AuditLog` has no organization column.** Organization scope is carried by
   `entityType`/`entityId` or by `metadata`. A redaction audit event must
   therefore record organization explicitly in `metadata`.
2. **`AuditLog` immutability is convention, not `DB-ENFORCED`.** The migrations
   define `desi_ledger_entry_immutable` and `desi_ledger_batch_immutable` but
   no equivalent for audit rows. The approved decision requires "a new
   immutable audit event", so Milestone 1 proposes
   `desi_audit_log_immutable` following the existing ledger trigger pattern.
   Until that ships, any claim of audit immutability must read `IMPLEMENTED`,
   not `DB-ENFORCED`.

### 3.5 Retention and data model

`docs/DATA_MODEL.md:188-219` carries a **table-level** retention table and the
heading **"Erasure is NOT IMPLEMENTED"**, stating there is no erasure or
redaction route, no redaction command and no scheduled retention job, and that
the redaction shape described there "is the shape of the work, not a
description of code that exists".

No redaction model, column, enum or migration exists. The only `redact` symbol
in the codebase is `apps/api/src/lib/webhook-intake.js:53-83`, which strips keys
from inbound webhook payloads and is unrelated to personal-data erasure.

Personal-data fields confirmed in `packages/db/prisma/schema.prisma`:
`email` (`:61`, `@unique`), `displayName` (`:63`), `phone` (`:64`),
`contactEmail` (`:108`, `:299`), `buyerEmail`/`buyerName` (`:456-457`),
`userAgent` (`:837`), further `email` columns at `:783` and `:1053`, and
`name` columns at `:105`, `:217`, `:344`, `:1087`, `:1141`, `:1173`, `:1771`.

`NotificationOutbox.recipient` is documented in-schema as "Recipient address.
Present because it must be sent to; never logged."

### 3.6 API contract

Routes are declared in the contract and the browser-facing manifest is
**generated**: `packages/api-contract/src/route-manifest.js` carries only
`id`, `method`, `path`, `auth`, `body`, `query`, deliberately excluding request
and response schemas because those "describe every column of every entity —
including an organiser's contact address". `manifest.test.js` fails on drift;
regenerate with
`pnpm --filter @desi-event/api-contract run manifest:emit`. OpenAPI drift is
checked by `pnpm openapi:check`. Status: `AUTOMATICALLY TESTED`.

### 3.7 Web UI, accessibility, CI

Seven Playwright configs exist: `playwright.config.js`, `.detail`, `.events`,
`.organizer`, `.production`, `.refusals`, `.sweep`. The accessibility sweep runs
three viewports — phone 320×720, tablet 768×1024, desktop 1280×900
(`apps/web/e2e/accessibility-sweep.spec.js:59-61`) — with
`withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])` and **no rule disabled**
(`:212`). `scripts/scan-browser-bundle.mjs` enforces a `FORBIDDEN` list and a
`REQUIRED` list over the browser-deliverable roots. Coverage floor:
`branches: 75` in `packages/config/src/vitest-node.js:19`.

**Reliability observation, not a change.** `turbo.json` gives `test` and
`test:coverage` `dependsOn: ["^build", "build"]`, but `test:e2e` still declares
`["^build"]` only, so the class of race fixed in `79ff795` remains structurally
possible there. No failure has been traced to it. **Phase 3 does not change
this**; it is recorded so a future decision can be made deliberately.

## 4. Approved decisions

Recorded verbatim from the authorisation of 2026-09-17. These are policy, not
proposals.

### 4.1 Personal-data treatment

**Redact / anonymize:** user email; user display name; user phone; buyer email;
buyer name; organization contact email; event contact email; ticket holder and
ticket recipient personal details; `NotificationOutbox` recipient address and
personal-data payload after sending.

**Retain the financial and operational fact, redact the personal data within
it:** orders, order items, payments, refunds, payouts, tax data, ledger
entries, ticket inventory and ticket status. Amounts, dates, transaction
states, tax and ticket status and non-personal references are kept unchanged;
names, email addresses, phone numbers and other direct identifiers are removed
or replaced.

**Retain unchanged:** existing `AuditLog` rows; financial ledger records; active
legal-hold and fraud-investigation data until the hold or investigation is
resolved. Old audit rows are never edited or deleted; redaction **adds** a new
audit event recording that redaction was performed.

**Retain temporarily, then delete on a documented schedule:** login attempts;
session metadata; user-agent data; IP or security metadata where stored.

**Exports:** stored exports containing a redacted user's personal data are
deleted where technically possible; future exports must not include redacted
personal data.

### 4.2 Irreversibility (approved wording)

> Redaction replaces personal fields with deterministic, non-identifying
> placeholders derived from the relevant row ID. Redaction is irreversible. No
> reversal path, original value, backup field, or recoverable mapping may be
> stored. Repeating the same redaction is idempotent and produces the same safe
> result.

### 4.3 Authorization

- New capability **`privacy:redact`**, granted only to the minimum
  organization-management role necessary.
- New step-up policy **`PRIVACY_ERASURE`**, window **2 minutes**.
- Every redaction action writes a new immutable audit event.
- Broad administrator, organization-management, credential or security-role
  privileges must **not** be reused as a substitute for `privacy:redact`.

### 4.4 Stripe Connect

`connect:manage` + `PAYOUT` step-up, for starting onboarding and reading
connected-account status. Payment mode stays `MOCK`. All real Stripe
verification stays `EXTERNAL VERIFICATION PENDING`.

## 5. Per-category treatment table

| Data category                                  | Storage locations                                  | Existing retention policy                      | Existing enforcement                                                                                      | Phase 3 treatment                                                         | Decision status                              |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| User email                                     | `User.email` (`schema.prisma:61`, `@unique`)       | silent                                         | none                                                                                                      | Redact/anonymize                                                          | Approved                                     |
| User display name                              | `User.displayName` (`:63`)                         | silent                                         | none                                                                                                      | Redact/anonymize                                                          | Approved                                     |
| User phone                                     | `User.phone` (`:64`)                               | silent                                         | none                                                                                                      | Redact/anonymize                                                          | Approved                                     |
| Buyer identity                                 | `Order.buyerEmail`, `Order.buyerName` (`:456-457`) | "Order… indefinite; counterpart to the ledger" | none                                                                                                      | Retain row, redact identity fields                                        | Approved                                     |
| Organization contact                           | `contactEmail` (`:108`)                            | silent                                         | none                                                                                                      | Redact/anonymize                                                          | Approved                                     |
| Event contact                                  | `contactEmail` (`:299`)                            | silent                                         | none                                                                                                      | Redact/anonymize                                                          | Approved                                     |
| Ticket holder / recipient                      | ticket holder and recipient fields                 | silent                                         | none                                                                                                      | Retain ticket + status, redact identity                                   | Approved                                     |
| Notification recipient and payload             | `NotificationOutbox.recipient`, `.payload`         | "Retained after send as delivery evidence"     | none                                                                                                      | Redact after send; the send record is the evidence, not the address       | Approved (resolves the conflict)             |
| Order / item / payment / refund / payout / tax | order, payment, refund, payout, tax models         | indefinite                                     | `DB-ENFORCED` constraints                                                                                 | Retain amounts, dates, states, tax, non-personal refs; redact identifiers | Approved                                     |
| Ledger entries and batches                     | `LedgerEntry`, `LedgerBatch`                       | "Indefinite. Not deletable by design"          | `DB-ENFORCED` — `desi_ledger_entry_immutable`, `desi_ledger_batch_immutable`, `desi_ledger_batch_balance` | Retain unchanged                                                          | Approved                                     |
| Audit rows                                     | `AuditLog`                                         | "Indefinite… cannot be pruned selectively"     | convention only — **no trigger**                                                                          | Retain unchanged; add a new event                                         | Approved                                     |
| Legal hold / fraud investigation               | no model exists yet                                | silent                                         | none                                                                                                      | Retain unchanged until resolved                                           | Approved — **model does not exist**, see §11 |
| Login attempts                                 | `LoginAttempt`                                     | "Short-lived; for rate limiting, not history"  | none (no sweeper)                                                                                         | Retain temporarily, then delete on schedule                               | Approved                                     |
| Session metadata                               | `Session`, `AuthToken`                             | "Expire and are deleted"                       | expired on read, not swept                                                                                | Retain temporarily, then delete on schedule                               | Approved                                     |
| User-agent data                                | `userAgent` (`:837`)                               | silent                                         | none                                                                                                      | Retain temporarily, then delete on schedule                               | Approved                                     |
| IP / security metadata                         | not confirmed stored                               | silent                                         | n/a                                                                                                       | Retain temporarily, then delete if stored                                 | Approved, conditional on existence           |
| Exports                                        | export surfaces                                    | silent                                         | none                                                                                                      | Delete stored exports where possible; exclude from future exports         | Approved                                     |
| Provider / account identifiers                 | none exist yet                                     | n/a                                            | n/a                                                                                                       | Not applicable — no Connect account persistence exists                    | Approved                                     |
| Logs, fixtures, snapshots, browser bundle      | repository artefacts                               | n/a                                            | `scripts/scan-browser-bundle.mjs`                                                                         | Must never contain redactable personal fields; scan extended              | Approved                                     |

## 6. Retention schedule and legal hold

**Recommended schedule**, to be implemented as an explicitly scheduled job with
durable state, not as an implicit side effect:

| Data                            | Proposed retention          | Rationale                                        |
| ------------------------------- | --------------------------- | ------------------------------------------------ |
| `LoginAttempt`                  | 30 days                     | its stated purpose is rate limiting, not history |
| `Session`, `AuthToken`          | delete 30 days after expiry | a spent token has no further use                 |
| `userAgent` / security metadata | 90 days                     | long enough for incident review                  |

**Legal hold.** No legal-hold or fraud-investigation model exists in the schema.
The approved policy requires that such data be retained until the hold is
resolved, which cannot be honoured without a hold record to consult. Phase 3
therefore introduces a minimal hold marker in Milestone 4 and **redaction
refuses, with an explicit refusal audit event, while a hold is active**. A
refusal is a safe outcome; a silent redaction through a hold is not.

## 7. Milestones

Each milestone is one reviewable pull request against `main`, opened only after
its own tests pass locally, and merged only through the existing protected
review process. No milestone begins until this plan is approved.

### Milestone 1 — foundation

**Goal.** Shared vocabulary and audit integrity only.
**Non-goals.** No route, no UI, no provider action, no destructive operation.

- Add `privacy:redact` to `packages/permissions/src/capabilities.js`, granted to
  the minimum organization-management role.
- Add `PRIVACY_ERASURE: 2 * 60 * 1000` to `STEP_UP_POLICIES`.
- Add redaction and Connect audit action constants to `apps/api/src/lib/audit.js`.
- Add migration `desi_audit_log_immutable`, matching the existing ledger trigger
  pattern, so audit immutability becomes `DB-ENFORCED` rather than convention.

**Tests.** Capability and role-graph unit tests; `stepUpWindowFor('PRIVACY_ERASURE')`
returns 120000 and an unknown name still throws; a database test proving an
`UPDATE` and a `DELETE` against `AuditLog` are both refused.
**Acceptance.** No behaviour change to any existing route; full suite green;
no document claims either feature exists.

### Milestone 2 — Connect API boundary (`MOCK-ONLY`)

**Goal.** Authenticated, organization-scoped start/status boundary over the
existing mock seam.
**Non-goals.** No real SDK, no network, no webhook handling, no UI.

- Define the Connect adapter methods and their mock implementation; the state
  vocabulary is whatever the mock can actually produce and no more.
- Persist the minimum organization-scoped account state; the association is
  unique per organization.
- Routes require a session, `connect:manage`, `PAYOUT` step-up, and server-side
  organization resolution. A client-supplied organization id, account id,
  status or return target never grants authority.
- Status reads do not mutate. A repeated start is idempotent.
- Return/refresh URLs, if any, are internal routes only, validated server-side.
- Responses expose no secret, token, credential or unnecessary provider
  metadata; raw provider errors are never serialised to clients.

**Tests.** Route tests for happy path, missing session, missing capability,
missing and stale step-up, invalid input, cross-organization target, unknown
target with a non-enumerating response, duplicate request, mock failure, and
the audit event in each case.
**Acceptance.** `pnpm openapi:check` and the manifest test pass; no Connect
schema field reaches the browser manifest; documentation says `MOCK-ONLY`.

### Milestone 3 — Connect organizer UI

**Goal.** An organizer settings surface over the Milestone 2 boundary.

States rendered: not authorized; step-up required; not started; start available;
pending / action needed; mock-only status; provider unavailable; failure. Any
dashboard link is generated by the mock boundary and labelled mock/test-only.
No surface suggests production payouts can be enabled.

**Tests.** A new browser suite at 320/768/1280 with
`wcag2a, wcag2aa, wcag21a, wcag21aa` and no rule disabled; keyboard-only;
200% zoom; reduced motion; real authenticated session and real seeded rows;
a direct route call without step-up is refused.

### Milestone 4 — redaction model and migration

**Goal.** A durable, auditable redaction request/action model, plus the legal-hold
marker §6 requires.

- Deterministic placeholders derived from the row id; irreversible; no original
  value, backup column or mapping stored anywhere.
- Unique constraints, including `User.email @unique`, satisfied by construction
  since placeholders are row-id-derived and therefore distinct.
- Foreign keys and ledger references survive untouched.
- Concurrency handled by transaction boundaries and an idempotency record, so a
  repeated or concurrent request cannot produce inconsistent state.

**Tests.** Database tests against real disposable PostgreSQL: transactional
integrity, concurrent requests against one subject, no broken references,
ledger and audit invariants intact, retained accounting records still
internally consistent, redacted values unrecoverable through joins.

### Milestone 5 — redaction API, authorization, audit

**Goal.** The route, with authority and an audit trail.

Requires session, `privacy:redact`, `PRIVACY_ERASURE` step-up, server-side
organization ownership, and explicit human confirmation. Non-enumerating:
unauthorized and cross-organization requests are indistinguishable from
not-found. Malformed, stale, duplicate and unauthorized requests are refused
with no partial mutation. Audit records actor, organization, a privacy-safe
target reference, action, outcome, correlation id and timestamps — and never
the personal data just removed. Refusal under legal hold is itself audited.

### Milestone 6 — redaction UI

**Goal.** A constrained administrative surface with confirmation and honest
messaging: redaction removes personal data and does **not** rewrite financial
or audit history. Server-side authorization and step-up regardless of UI
gating. States: confirmation, success, already-redacted, retryable failure,
denied. No personal data in URLs, query strings, logs, error boundaries, aria
labels or audit views.

### Milestone 7 — verification and documentation

Update only what has become factually stale: `docs/STRIPE_CONNECT.md`,
`docs/DATA_MODEL.md`, `docs/SECURITY.md`, `docs/api.md`, `docs/DECISIONS.md`,
and applicable provider, UX, retention and threat-model documents. Connect
stays `MOCK-ONLY`; real Stripe stays `EXTERNAL VERIFICATION PENDING`;
production payments stay `DISABLED` with executable kill-switch proof.
`PHASE3_COMPLETION_REPORT.md` is written only after every gate has passed, and
never claims a result on the commit that introduces it.

## 8. Risk register

| Risk                                         | Consequence                                        | Mitigation                                                                                                            |
| -------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Redaction breaks ledger balance              | financial records stop balancing                   | never touch `LedgerEntry`/`LedgerBatch`; `desi_ledger_batch_balance` proves it                                        |
| Placeholder collides on `User.email @unique` | migration fails or wrong row updated               | placeholders derived from row id, therefore unique by construction                                                    |
| Partial redaction                            | subject believes data is gone when it is not       | single transaction; durable state machine with an explicit incomplete state if boundaries force it; no silent partial |
| Redacted data resurfaces                     | privacy failure after the fact                     | presenter tests, export tests, audit-metadata tests, extended bundle scan                                             |
| Audit rows mutated by redaction              | destroys the evidence trail                        | `desi_audit_log_immutable` trigger in Milestone 1                                                                     |
| Coverage floor breached                      | CI red, `apps/api` margin is thin                  | every new branch gets a test in its own milestone; no threshold is lowered                                            |
| Connect state vocabulary invented            | documentation claims behaviour that does not exist | vocabulary defined by the mock seam only                                                                              |
| New browser suite escapes CI                 | untested surface ships                             | suite added to the `ci.yml` matrix deliberately; required context names unchanged                                     |

## 9. External verification

Every real Stripe action remains **`EXTERNAL VERIFICATION PENDING`**. No Stripe
credential has ever been supplied to this repository and none is requested by
this plan. The Connect flow delivered by Milestones 2 and 3 is **`MOCK-ONLY`**:
it exercises a test double with the real call shapes and proves nothing about
Stripe. No Stripe object id, dashboard screenshot, CLI transcript, webhook
delivery or provider event may be fabricated anywhere.

The `Apply branch protection` workflow is separately **unverified** — its three
runs failed in local PEM parsing before any token was minted. That is unrelated
to Phase 3 and is not addressed here.

## 10. Production safety

Production payments remain **`DISABLED`** and must retain executable proof.
`apps/api/tests/payment-kill-switch.test.js` runs as its own named CI step and
must continue to pass unchanged. No milestone may remove, weaken, bypass or
condition the kill switch, and no milestone changes payment mode away from
`MOCK`.

## 11. Decisions still required

The approved decisions of 2026-09-17 resolve treatment, irreversibility and
authorization. Two narrower questions remain, and implementation of the
affected milestone should not begin until they are answered.

1. **Legal-hold model.** No hold or fraud-investigation record exists in the
   schema, so "retain until the hold is resolved" has nothing to consult.
   Proposed: a minimal hold marker scoped to a subject and organization, set and
   cleared by an existing privileged role, with redaction refusing and auditing
   the refusal while a hold is active. Confirm, or name an alternative.
2. **Retention schedule values.** The 30/30/90-day figures in §6 are proposals,
   not policy. Confirm them or supply the intended values before the sweeper is
   built.

Nothing in this plan authorises implementation. Phase 3 begins only on an
explicit instruction to start a named milestone.
