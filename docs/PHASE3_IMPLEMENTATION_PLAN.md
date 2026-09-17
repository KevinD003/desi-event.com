# Phase 3 Implementation Plan

## 1. Planning Scope and Non-Goals

This is a **plan-only** Phase 3 deliverable. It is a planning and policy-design
artifact. It is not an implementation, and it is not legal advice.

No product behaviour, database schema, payment behaviour, user data, Stripe
integration, authentication, authorization, CI enforcement, branch protection or
production configuration was changed while producing it. The only file written
is this one.

**Prohibited work that has not begun.** No Prisma model, enum, constraint,
trigger, table, column or index was created, altered or deleted. No migration
exists. No API route, frontend route, background job, scheduled task, webhook
handler, payment call or Stripe call was added or altered. Real Stripe
processing was not enabled. Payment mode remains `MOCK`. No secret of any kind
was requested, revealed, logged, printed, saved, committed or inspected. No
authentication, authorization, step-up, audit, CI, coverage, scan, rate-limit,
test-assertion or database-integrity control was weakened. No Phase 1 or Phase 2
historical record was rewritten. No pull request was merged. Phase 4 has not
started. No destructive operation was performed against any record.

## 2. Verified Baseline and Evidence

Measured 2026-09-17T05:05Z from the repository and the GitHub API.

| Fact               | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Branch             | `claude/desi-event-js-stack-gb4uqe`                                    |
| HEAD               | `87ead82dc7e209d496a7fe4b09fdeed2fac1449d`                             |
| Upstream `@{u}`    | `87ead82` — 0 ahead, 0 behind                                          |
| `origin/main`      | `d1e0dd2fc88817d7f0ae8a11c48b0c2d3d5e320c` — HEAD is 1 ahead, 0 behind |
| Working tree       | clean, `git status --porcelain=v1` returns 0 entries                   |
| Worktrees          | one                                                                    |
| Open pull requests | 0                                                                      |

### 2.1 CI for the current HEAD

**There is no CI run for `87ead82`.** `GET /actions/runs?head_sha=87ead82`
returns `total_count: 0`; the commit carries 0 check runs.

This is by design, not a failure. `.github/workflows/ci.yml` declares:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

A push to a feature branch triggers nothing. Only a `pull_request` event runs CI
off `main`, and no pull request is open for this commit. **The baseline is
therefore not green for the current HEAD, and this document does not claim it
is.**

### 2.2 Last verified green CI

Run **`35178489515`**, tested SHA `d1e0dd2` (`origin/main`), event `push`,
attempt 1, conclusion `success`. Eight of eight jobs succeeded:
`Policy, lint, contract, tests, build`, `Browser — public catalogue`,
`Browser — production build`, `Browser — organiser venue maps`,
`Browser — event lifecycle`, `Browser — refusals`,
`Browser — accessibility sweep`, `Browser — commerce and operations detail`.
137 steps `success`, 8 `skipped` — the per-job `if: failure()` artefact uploads
— and 0 other. No required job was skipped, cancelled or failed. Required
context set equals successful check-run set. No legacy commit statuses exist.

### 2.3 Branch protection, readable and unchanged

`GET /rules/branches/main`: `deletion`, `non_fast_forward`, `pull_request`,
`required_status_checks` in force. `required_approving_review_count: 1`;
`dismiss_stale_reviews_on_push: true`; `required_review_thread_resolution: true`;
`strict_required_status_checks_policy: true`; 8 required contexts. Ruleset
`23572317`, `enforcement: active`, `bypass_actors: []`,
`current_user_can_bypass: never`. Legacy branch protection is off.

### 2.4 Phase 2 status as documented

`PHASE2_STATUS.md` records `COMPLETE`, all twenty gates `MET`, and states that
completion by the gates is not a claim of production readiness.

### 2.5 Sources used for this inventory

Read directly: `packages/db/prisma/schema.prisma` (2166 lines, 49 models);
every `packages/db/prisma/migrations/*/migration.sql`;
`packages/permissions/src/capabilities.js` (566 lines);
`packages/auth/src/sessions.js` (334 lines);
`packages/providers/src/stripe.js`, `payments.js`, `payment-mode.js`,
`interfaces.js`; `apps/api/src/lib/audit.js`, `webhook-handlers.js`,
`payouts.js`, `presenters.js`; `apps/api/src/routes/` (22 files);
`packages/api-contract/src/route-manifest.js`; `.github/workflows/ci.yml`;
`turbo.json`; `apps/web/e2e/accessibility-sweep.spec.js`;
`scripts/scan-browser-bundle.mjs`; `packages/config/src/vitest-node.js`;
`docs/DATA_MODEL.md`, `docs/PAYMENTS.md`, `docs/BRANCH_PROTECTION.md`,
`docs/SECURITY.md`, `docs/STRIPE_CONNECT.md`, `docs/PROVIDERS.md`.

Line numbers appear below only where verified by opening the file.

### 2.6 Corrections to the previous revision of this document

Three claims were wrong. They were stated in conversation **and committed in the
previous revision of this file** (commit `87ead82`, section 3.1). Recording the
correction rather than quietly replacing it is the repository's established
convention, so they are named here rather than simply overwritten.

1. "Organization-to-provider-account persistence — no model, column or
   migration — `NOT IMPLEMENTED`" was wrong. `model ConnectedAccount` is in the
   schema, has a migration, and is read and written by application code.
2. "Connect onboarding / account-link / account-status adapter method —
   `NOT IMPLEMENTED`" was true only of the mock adapter
   (`packages/providers/src/payments.js`) and misleading as written. Three such
   methods exist on the real Stripe adapter: `createConnectedAccount`,
   `createOnboardingLink`, `getConnectedAccount`.
3. "There is no adapter-defined Connect state vocabulary" was wrong in effect. A
   state vocabulary is already fixed by `enum ConnectOnboardingStatus` in the
   schema, and a mock seam must match it rather than invent one.

The corrected position is in §4.8 and §9.

### 2.7 What this revision replaces

The previous revision of this file organised future work as seven milestones.
This revision replaces that structure with the four direct phases in §15, at the
repository owner's explicit direction, and adopts the section structure required
by that same direction. No Phase 1 or Phase 2 historical report was altered; the
change is confined to this forward-looking planning document, and §2.6 above
records what the superseded revision got wrong instead of erasing it.

## 3. Approved Product and Privacy Decisions

Recorded from the authorization of 2026-09-17. **Approved implementation
direction** is policy. **Proposed technical design** is this document's
suggestion and is not yet approved. **Requires human approval** is outstanding.

### 3.1 Approved implementation direction

Personal-data treatment, as approved:

Redact/anonymize — user email, user display name, user phone number, buyer
email, buyer name, organization contact email, event contact email, ticket
holder details, ticket recipient details, `NotificationOutbox` recipient address
after send, `NotificationOutbox` personal-data payload after send.

Retain the financial and operational fact, redact the personal data inside it —
orders, payments, refunds, payouts.

Retain unchanged — tax totals, financial ledger entries, existing `AuditLog`
rows, ticket inventory, ticket state, admission/check-in state unless directly
identifying, active legal-hold data until the hold resolves, active
fraud-investigation data until the investigation resolves.

Retain temporarily then delete on a retention policy — login attempts, session
metadata, browser user-agent and IP/security metadata where stored.

Exports — delete stored exports containing a redacted person's personal data
where technically possible; future exports must not include redacted personal
data.

New audit evidence of redaction is created during future implementation.

**Retain does not mean retaining personal information forever.** It means
preserving financial and operational integrity while removing direct
identifiers wherever the approved treatment says redact.

Irreversibility, approved verbatim:

> Redaction replaces personal fields with deterministic, non-identifying
> placeholders derived from the relevant row ID. Redaction is irreversible. No
> reversal path, original value, backup field, encrypted copy, recoverable
> mapping, or hidden lookup may be stored. Repeating the same redaction is
> idempotent and produces the same safe result.

Audit records, approved: existing rows are never silently edited or deleted; a
new immutable audit event is added for the redaction action; new audit metadata
contains no redactable personal data; only safe identifiers, action type, scope,
actor reference, result, timestamp, policy version and a non-sensitive reason
code are stored; never an old value, new value, raw email, phone number,
address, token, secret, card reference or personal message body.

Authorization, approved: a new narrow capability `privacy:redact`, granted only
to the minimum organization-management role necessary; `platform:admin`,
`organization:manage`, credential and security-role privileges must not be
substituted; a new step-up policy `PRIVACY_ERASURE = 2 * 60 * 1000`; explicit
confirmation; a server-side idempotency key; immutable audit evidence for every
attempt and completion; cross-organization redaction denied; organization scope
enforced at API, service, query and database layers; the browser never decides
eligibility, authorization, retention, legal-hold status or outcome.

Stripe Connect, approved: existing capability `connect:manage` and existing
step-up policy `PAYOUT`, for starting onboarding, reading connected-account
status, and managing payout-destination workflows subject to `PAYOUT`. Payment
mode stays `MOCK`; the production kill switch stays intact; real Stripe
execution stays `EXTERNAL VERIFICATION PENDING`.

### 3.2 Proposed technical design, not yet approved

Placeholder format; transaction boundaries; the legal-hold model shape; the
retention sweeper design; the specific route paths and payload shapes in §10;
the four-phase order in §15.

### 3.3 Requires human approval

Retention durations (§5, §14). Jurisdiction-specific legal review. The
legal-hold and fraud-hold record design, since no such model exists today. Any
decision to seek Stripe sandbox credentials.

## 4. Current-State Architecture Inventory

Status labels are used strictly. A declared constant, adapter method, enum,
schema field or document paragraph is not evidence that a feature works.

### 4.1 Monorepo

`apps/`: `api` (Fastify), `web` (Next.js App Router), `worker` (BullMQ).
`packages/`: `api-contract`, `auth`, `config`, `db`, `inventory`, `ledger`,
`logger`, `notifications`, `permissions`, `pricing`, `providers`, `schemas`,
`ui`. Status: `IMPLEMENTED`.

### 4.2 Database

49 Prisma models in `packages/db/prisma/schema.prisma`: `User`, `Organization`,
`Membership`, `Venue`, `Event`, `TicketType`, `TicketHold`, `Order`,
`OrderItem`, `Ticket`, `Payment`, `WebhookEvent`, `PromoCode`, `WaitlistEntry`,
`AuditLog`, `Session`, `Device`, `MfaFactor`, `AuthToken`, `LoginAttempt`,
`ScannerScope`, `OrganizationVerificationEvent`, `Invitation`, `VenueMap`,
`VenueMapVersion`, `Section`, `SeatRow`, `PriceZone`, `Seat`, `EventSession`,
`EventSeat`, `HoldItem`, `EventModerationAction`, `MediaAsset`,
`ConnectedAccount`, `Refund`, `RefundItem`, `Dispute`, `Transfer`, `Payout`,
`LedgerAccount`, `LedgerBatch`, `LedgerEntry`, `TicketTransfer`, `CheckIn`,
`NotificationOutbox`, `NotificationPreference`, `IdempotencyRecord`,
`ReconciliationTask`. Status: `IMPLEMENTED`.

Eighteen database functions/triggers exist in the migrations and are
`DB-ENFORCED`: `desi_check_in_ticket_admissible`, `desi_event_revision_forward`,
`desi_event_seat_map_matches`, `desi_event_session_map_frozen`,
`desi_hold_item_line_matches`, `desi_hold_item_session_matches`,
`desi_ledger_batch_balance`, `desi_ledger_batch_immutable`,
`desi_ledger_entry_immutable`, `desi_map_version_frozen`,
`desi_map_version_publish_once`, `desi_map_version_revision_forward`,
`desi_order_item_event_matches`, `desi_payout_currency_matches`,
`desi_refund_within_order_total`, `desi_seat_frozen_and_coherent`,
`desi_ticket_status_transition`, `desi_ticket_type_session_matches`.

**There is no audit-immutability trigger.** Ledger rows are `DB-ENFORCED`
immutable; audit rows are not. Audit immutability today is `IMPLEMENTED` by
convention only.

### 4.3 API

Fastify, 22 route files under `apps/api/src/routes/`. Routes are declared in the
contract; the browser-facing manifest in
`packages/api-contract/src/route-manifest.js` is generated and deliberately
carries only `id`, `method`, `path`, `auth`, `body`, `query` — never request or
response schemas, because those describe every column of every entity. Drift is
caught by `manifest.test.js` and `pnpm openapi:check`. Status:
`AUTOMATICALLY TESTED`.

### 4.4 Web and worker

Next.js App Router with server/client boundaries; BullMQ worker with a
notification outbox dispatcher. Status: `IMPLEMENTED`.

### 4.5 Permissions

23 capabilities in `packages/permissions/src/capabilities.js`: `attendee:export`,
`connect:manage`, `event:cancel`, `event:create`, `event:delete`,
`event:publish`, `event:update`, `finance:view`, `inventory:manage`,
`ledger:manage`, `moderation:review`, `order:refund`, `order:view`,
`organization:manage`, `payout:manage`, `platform:admin`, `promo:manage`,
`reconciliation:manage`, `report:view`, `team:invite`, `team:remove`,
`ticket:revoke`, `venue:manage`. Status: `IMPLEMENTED`.

`connect:manage` is declared at lines 122–123 — "Start provider onboarding and
read the connected account's state" — and granted at line 294, but **no route,
service or UI references it**. Status: `SEAM ONLY`.

No privacy, redaction or erasure capability exists. Status: `NOT IMPLEMENTED`.

### 4.6 Authentication and step-up

Nine step-up policies in `packages/auth/src/sessions.js` lines 80–123:
`FINANCE_VIEW` 15 min, `FINANCE_ACTION` 5 min, `PAYOUT` 5 min, `CREDENTIAL`
2 min, `SECURITY_ROLE` 2 min, `EVENT_PUBLISH` 10 min, `EVENT_CANCEL` 5 min,
`MODERATION` 10 min, `OPERATIONS` 5 min. `PAYOUT` is documented as "A payout, or
a change to a connected account's payout destination." `stepUpWindowFor` throws
on an unknown policy name rather than defaulting. Each route declares its policy
in the contract, so a browser can neither send a window nor widen one. Status:
`AUTOMATICALLY TESTED`.

No policy governs irreversible personal-data destruction. Status:
`NOT IMPLEMENTED`.

### 4.7 Provider adapters

`packages/providers/src/`: `email.js`, `errors.js`, `index.js`, `interfaces.js`,
`internal.js`, `payment-mode.js`, `payments.js`, `registry.js`, `sms.js`,
`storage.js`, `stripe.js`, `webhooks.js`.

`payment-mode.js` resolves the credential mode and gates boot. Status:
`IMPLEMENTED`. Production payments: `DISABLED`, with executable proof in
`apps/api/tests/payment-kill-switch.test.js`.

`stripe.js` is the real adapter, test-mode only. It imports the Stripe SDK
lazily inside a closure — `const { default: Stripe } = await import('stripe')`
around line 231 — reachable only if `resolvePaymentMode` returns `STRIPE_TEST`,
which requires a coherent set of test credentials supplied on purpose. Its own
header states that nothing in the module has been run against Stripe. Status:
`EXTERNAL VERIFICATION PENDING`. The only other repository reference to the
`stripe` package is in the kill-switch test, which asserts its absence from
browser-deliverable code.

### 4.8 Connect — corrected inventory

| Item                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                    | Status                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `model ConnectedAccount` — `organizationId @unique`, `provider`, `providerAccountId`, `providerMode`, `country`, `defaultCurrency`, `onboardingStatus`, `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`, `disabledReason`, `requirementsDue`, `syncedAt`; `@@unique([provider, providerAccountId])`; cascade from `Organization` | `schema.prisma`                                                                             | `IMPLEMENTED`            |
| `enum ConnectOnboardingStatus` — `NOT_STARTED`, `IN_PROGRESS`, `REQUIREMENTS_DUE`, `COMPLETE`, `DISABLED`                                                                                                                                                                                                                               | `schema.prisma`                                                                             | `SCHEMA ONLY`            |
| `createConnectedAccount({ organizationId, email, country })`                                                                                                                                                                                                                                                                            | `providers/src/stripe.js:455`                                                               | `SEAM ONLY` — no callers |
| `createOnboardingLink({ accountId, refreshUrl, returnUrl })`                                                                                                                                                                                                                                                                            | `providers/src/stripe.js:488`                                                               | `SEAM ONLY` — no callers |
| `getConnectedAccount(accountId)`                                                                                                                                                                                                                                                                                                        | `providers/src/stripe.js:512`                                                               | `SEAM ONLY` — no callers |
| Connect methods on the **mock** adapter                                                                                                                                                                                                                                                                                                 | absent from `providers/src/payments.js`                                                     | `NOT IMPLEMENTED`        |
| Connect in the declared provider interface                                                                                                                                                                                                                                                                                              | absent from `providers/src/interfaces.js`                                                   | `NOT IMPLEMENTED`        |
| `account.updated` webhook updates `ConnectedAccount`                                                                                                                                                                                                                                                                                    | `apps/api/src/lib/webhook-handlers.js` around lines 316–383                                 | `IMPLEMENTED`            |
| `ConnectedAccount` read by payouts and finance                                                                                                                                                                                                                                                                                          | `apps/api/src/lib/payouts.js` ~1006, `routes/finance.js` ~256, `lib/presenters.js` ~443/468 | `IMPLEMENTED`            |
| Separate Connect webhook secret and same-secret guard                                                                                                                                                                                                                                                                                   | `providers/src/payment-mode.js`                                                             | `IMPLEMENTED`            |
| Any Connect onboarding API route                                                                                                                                                                                                                                                                                                        | none among 22 route files                                                                   | `NOT IMPLEMENTED`        |
| Any Connect onboarding UI                                                                                                                                                                                                                                                                                                               | none                                                                                        | `NOT IMPLEMENTED`        |

**The consequence that shapes §9 and §15.** Connect onboarding methods exist
only on the _real_ adapter, which has never run. The mock has none. There is
therefore **no mock seam for onboarding today**, and the first Connect work is
to create one — not to wire up an existing one.

### 4.9 Payments, exports, notifications, audit

Payments: two-phase boundary, provider calls outside database transactions,
`MOCK-ONLY`. Exports: `attendee:export` capability exists; export surfaces
require audit in Phase 3 (§5). Notifications: `NotificationOutbox` with
`recipient`, `payload`, `dedupeKey @unique`, retry counters; documented as
"Retained after send as delivery evidence"; `IMPLEMENTED`.

Audit: `model AuditLog` with `id`, `actorId`, `action`, `entityType`,
`entityId`, `metadata Json?`, `createdAt`; `actor User? @relation(onDelete:
SetNull)`; indexed on `[entityType, entityId]` and `[createdAt]`. Fifty action
constants in `apps/api/src/lib/audit.js`. **No organization column**, so
organization scope must be carried in `metadata` or derived from the entity.
Status: `IMPLEMENTED`; immutability is convention, not `DB-ENFORCED`.

### 4.10 CI and branch protection

`.github/workflows/ci.yml`: `push` on `main` only, plus `pull_request` and
`workflow_dispatch`; `concurrency` with `cancel-in-progress: true`;
`permissions: contents: read`; a `verify` job and a seven-way `browser` matrix
producing the eight required contexts. Guard scripts: language policy, secret
scan, browser-bundle scan, CI invariants, skipped-test check. Coverage floor
`branches: 75` in `packages/config/src/vitest-node.js`. Status:
`AUTOMATICALLY TESTED`.

`turbo.json`: `test` and `test:coverage` declare `dependsOn: ["^build",
"build"]`; `test:e2e` declares `["^build"]` only. Recorded as a reliability
observation; **not changed by Phase 3**. Status: `CARRIED`.

Branch protection as §2.3. Status: `IMPLEMENTED`, verified live.

## 5. Data Classification and Retention Matrix

All durations below are **PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW**. Nothing in
this section is a compliance claim.

| Data category                             | Actual model / field                                                                                                      | Classification                                                | Current retention                              | Approved treatment                                                     | Legal hold      | Future technical enforcement                                                | Status / evidence                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| User email                                | `User.email` (`@unique`)                                                                                                  | Direct identifier                                             | Silent in policy                               | Redact/anonymize                                                       | Overrides       | Deterministic placeholder from row id; uniqueness preserved by construction | `NOT IMPLEMENTED`                                                                                         |
| User display name                         | `User.displayName`                                                                                                        | Direct identifier                                             | Silent                                         | Redact/anonymize                                                       | Overrides       | Placeholder                                                                 | `NOT IMPLEMENTED`                                                                                         |
| User phone                                | `User.phone`                                                                                                              | Direct identifier                                             | Silent                                         | Redact/anonymize                                                       | Overrides       | Null or placeholder                                                         | `NOT IMPLEMENTED`                                                                                         |
| Buyer identity                            | `Order.buyerEmail`, `Order.buyerName`                                                                                     | Direct identifier on a financial row                          | "Order… indefinite; counterpart to the ledger" | Retain row, redact identity                                            | Overrides       | Placeholder; amounts, dates, state untouched                                | `NOT IMPLEMENTED`                                                                                         |
| Organization contact                      | `Organization.contactEmail`                                                                                               | Direct identifier                                             | Silent                                         | Redact/anonymize                                                       | Overrides       | Placeholder                                                                 | `NOT IMPLEMENTED`                                                                                         |
| Event contact                             | `Event.contactEmail`                                                                                                      | Direct identifier                                             | Silent                                         | Redact/anonymize                                                       | Overrides       | Placeholder                                                                 | `NOT IMPLEMENTED`                                                                                         |
| Ticket holder / recipient                 | `Ticket.attendeeName`, `TicketTransfer.toEmail`                                                                           | Direct identifier                                             | Silent                                         | Retain ticket and status, redact identity                              | Overrides       | Placeholder; `desi_ticket_status_transition` untouched                      | `NOT IMPLEMENTED`                                                                                         |
| Notification recipient                    | `NotificationOutbox.recipient`                                                                                            | Direct identifier                                             | "Retained after send as delivery evidence"     | Redact after send                                                      | Overrides       | Placeholder; `dedupeKey` untouched                                          | `NOT IMPLEMENTED`                                                                                         |
| Notification payload                      | `NotificationOutbox.payload` (Json)                                                                                       | Direct + indirect                                             | Same                                           | Redact personal keys after send                                        | Overrides       | Key allow-list scrub                                                        | `NOT IMPLEMENTED`                                                                                         |
| Financial facts                           | `Order`, `OrderItem`, `Payment`, `Refund`, `RefundItem`, `Payout`, `Transfer`, `Dispute`                                  | Financial                                                     | Indefinite                                     | Retain amounts, dates, states, non-personal refs                       | Overrides       | Identifier fields only are replaced                                         | `DB-ENFORCED` constraints retained                                                                        |
| Tax totals                                | order/tax fields                                                                                                          | Financial                                                     | Indefinite                                     | Retain unchanged                                                       | Overrides       | No change                                                                   | `IMPLEMENTED`                                                                                             |
| Ledger                                    | `LedgerEntry`, `LedgerBatch`, `LedgerAccount`                                                                             | Financial                                                     | "Indefinite. Not deletable by design"          | Retain unchanged                                                       | Overrides       | Never touched                                                               | `DB-ENFORCED` — `desi_ledger_entry_immutable`, `desi_ledger_batch_immutable`, `desi_ledger_batch_balance` |
| Ticket inventory / state / check-in       | `Ticket`, `CheckIn`, `EventSeat`, `Seat`                                                                                  | Operational                                                   | Silent                                         | Retain unless directly identifying                                     | Overrides       | Identity fields only                                                        | `NOT IMPLEMENTED`                                                                                         |
| Existing audit rows                       | `AuditLog`                                                                                                                | Security evidence                                             | "Indefinite… cannot be pruned selectively"     | Retain unchanged                                                       | Overrides       | New immutability trigger proposed                                           | Convention only today                                                                                     |
| New redaction audit event                 | `AuditLog`                                                                                                                | Security evidence                                             | n/a                                            | Create, PII-free                                                       | n/a             | Safe metadata only                                                          | `NOT IMPLEMENTED`                                                                                         |
| Login attempts                            | `LoginAttempt.emailHash`, `LoginAttempt.ipHash`, `outcome` — SHA-256 with a server pepper, so no raw identifier is stored | Security metadata, hashed                                     | "Short-lived; for rate limiting, not history"  | Retain temporarily, then delete — deletion by retention, not redaction | Overrides       | Scheduled sweeper — 30 days PROPOSED                                        | `NOT IMPLEMENTED` — no sweeper                                                                            |
| Sessions and tokens                       | `Session`, `AuthToken`, `Device`                                                                                          | Security metadata                                             | "Expire and are deleted"                       | Retain temporarily, then delete                                        | Overrides       | Sweeper — 30 days after expiry PROPOSED                                     | Expired on read, not swept                                                                                |
| User agent / IP                           | `Session.userAgent`, `Session.ipHash`, `LoginAttempt.ipHash` — the address is stored only as a SHA-256 hash, never raw    | Indirect identifier, hashed                                   | Silent                                         | Retain temporarily, then delete                                        | Overrides       | Sweeper — 90 days PROPOSED                                                  | `NOT IMPLEMENTED`                                                                                         |
| MFA factors                               | `MfaFactor`                                                                                                               | Credential                                                    | Silent                                         | Not applicable — credential, not content                               | Overrides       | Removed with account closure, never logged                                  | `IMPLEMENTED`                                                                                             |
| Stored exports                            | export artefacts                                                                                                          | Direct identifier                                             | Silent                                         | Delete where technically possible                                      | Overrides       | Invalidation list + deletion job                                            | `NOT IMPLEMENTED`                                                                                         |
| Future exports                            | export generation                                                                                                         | Direct identifier                                             | Silent                                         | Must exclude redacted data                                             | Overrides       | Presenter-level exclusion + test                                            | `NOT IMPLEMENTED`                                                                                         |
| Connected-account references              | `ConnectedAccount.providerAccountId`, `requirementsDue`                                                                   | Provider identifier; `requirementsDue` may carry indirect PII | Silent                                         | Not applicable to person redaction; review `requirementsDue`           | Overrides       | Data minimisation review                                                    | `IMPLEMENTED`                                                                                             |
| Webhook payloads                          | `WebhookEvent`                                                                                                            | Provider data                                                 | Silent                                         | Already key-redacted on intake                                         | Overrides       | Extend the redacted-key set if needed                                       | `IMPLEMENTED` — `lib/webhook-intake.js`                                                                   |
| Legal hold / fraud investigation          | **no model exists**                                                                                                       | Governance                                                    | n/a                                            | Retain unchanged until resolved                                        | Is the override | Requires a new model                                                        | `NOT IMPLEMENTED`                                                                                         |
| Logs, fixtures, snapshots, browser bundle | repository artefacts                                                                                                      | Mixed                                                         | n/a                                            | Must never contain redactable PII                                      | n/a             | Extend `scripts/scan-browser-bundle.mjs`                                    | `AUTOMATICALLY TESTED` for current rules                                                                  |

### 5.1 The conflict, and the approved resolution

Historical retention evidence and privacy redaction genuinely conflict in three
places. The approved resolution is:

- **Audit rows are retained unchanged.** Redaction never edits or deletes an
  existing `AuditLog` row. It writes a new event recording that redaction
  occurred.
- **Notification delivery evidence is retained without the recipient address or
  message PII.** The evidence that a message was sent is the row, its template,
  its `dedupeKey`, its status and its timestamps — not the address it went to.
- **Financial facts are retained without direct identifiers.** Amounts, dates,
  currency, transaction states, tax and non-personal references are untouched;
  names, emails and phone numbers within those rows are replaced.
- **Legal and fraud holds override redaction until resolved.** While a hold is
  active, redaction refuses and records the refusal.

**This is not a claim of legal compliance.** It is a product policy and a
technical design.

## 6. Privacy Redaction Design

Design only. Nothing here is built.

**Initiation.** A request is raised by an authorized organization member on
behalf of a data subject, or by a platform operator through the same route. The
browser supplies a subject reference and a confirmation token; it never supplies
authority, organization identity, eligibility or outcome.

**Authorization.** Session required; `privacy:redact` required; organization
resolved server-side from the session, never from the request body;
`PRIVACY_ERASURE` step-up required and validated server-side within two minutes.

**Identity confirmation and explicit confirmation.** The operator must confirm a
typed, non-guessable confirmation string rendered by the server. The preview
shows the _scope_ of what will be redacted — counts and categories — and never
the values themselves.

**Idempotency.** A server-generated idempotency key is stored in
`IdempotencyRecord` (a model that already exists). A repeated request with the
same key returns the original outcome without repeating side effects.

**Hold evaluation.** Before any mutation, legal-hold and fraud-hold state is
evaluated server-side. An active hold refuses the request and writes a refusal
audit event.

**Redaction strategy.** Deterministic placeholders derived from the row id, for
example a stable non-reversible token rendered into a shape the column accepts.
`User.email` is `@unique`, so a row-id-derived placeholder is unique by
construction. Placeholders must be visibly synthetic so no operator mistakes one
for a real person, and must not collide with any real value.

**One-way guarantee.** No original value, backup column, encrypted copy,
reversal table, hidden lookup or recoverable mapping may be stored anywhere.

**Transactions and partial failure.** Redaction runs in a single database
transaction wherever service boundaries permit. Where they do not, a durable
state machine with an explicit incomplete state and safe retries is used; silent
partial redaction is forbidden. A failure leaves data in a consistent,
explainable state.

**Post-action.** A new audit event is written. Sessions and tokens for the
subject are revoked. Stored exports containing the subject are invalidated and
deleted where technically possible. Caches and any search index entries are
invalidated. Outbox rows are scrubbed after send.

**Downstream effects.** Ticket transfers, check-in, refunds, disputes, payouts
and reconciliation continue to function on the retained non-personal facts.
Ticket status transitions remain governed by `desi_ticket_status_transition`.

**Backups and disaster recovery.** Backups taken before redaction may still
contain the original values. This is a real limitation and must be documented in
the runbook, not hidden. A restore requires re-running redaction for every
completed request since the backup was taken.

**Recordkeeping.** A data-subject request record retains the request id,
organization, timestamps, outcome and policy version — and no personal data.

**Old values must never appear in** audit metadata, error messages, logs,
analytics, webhooks, queues, exports, browser bundles, screenshots, UI alerts,
or retry payloads. Each of these is a test in §12.

## 7. Authorization and Step-Up Design

**New capability `privacy:redact`.** Permitted scope: initiating and executing a
privacy redaction for a subject within the caller's own organization; reading
the redaction request record. Prohibited: any cross-organization action, any
platform-wide sweep, any retention-policy change.

**Minimum grant.** Only the minimum organization-management role. Not granted to
event, finance, moderation, scanner or support roles.

**Prohibited substitutes, and why.** `organization:manage` is insufficient
because it authorises routine administration — team, venue, settings — and is
held by people who should not be able to destroy personal data irreversibly;
granting redaction through it silently widens every existing holder's authority.
`platform:admin` is too broad: it is a superuser capability, and using it would
make the control unauditable as a distinct decision and impossible to grant
narrowly. `CREDENTIAL` and `SECURITY_ROLE` step-up policies do not authorize
privacy destruction because they gate authentication authority — removing a
factor, changing a role — which is reversible; redaction is not, and a policy
name that says "credential" would misdescribe what was approved.

**New policy `PRIVACY_ERASURE = 2 * 60 * 1000`.** Two minutes, matching the
scale used for the least reversible existing actions. Declared in the route
contract, resolved server-side; a browser can neither send nor widen it.

**Connect remains `connect:manage` + `PAYOUT`.** Appropriate because
`connect:manage` is documented for exactly this action and `PAYOUT` is
documented as covering "a change to a connected account's payout destination".
No new capability or policy is proposed for Connect.

**Enforcement.** Server-side only, at route, service, query and database layers.
Organization scope is derived from the session. A caller-supplied organization
id, subject id, status or return target never grants authority. UI state never
escalates privilege.

## 8. Auditability and Evidence Design

Future audit records carry: action type; actor id; organization id; an opaque
target reference; policy version; a non-sensitive reason code; the legal-hold
decision; an idempotency reference or hash; result status; timestamps; and a
correlation id.

They carry **no** personal data, no old or new values, no raw email, phone,
address, token, secret, card reference or message body.

Because `AuditLog` has no organization column, organization id is carried in
`metadata`. Because audit immutability is convention rather than `DB-ENFORCED`,
this plan proposes a `desi_audit_log_immutable` trigger following the existing
ledger pattern, so that "immutable audit event" is a property of the database
rather than an assertion.

Operational queries to support: all redaction events for an organization in a
period; all refusals and their reason codes; all events for one opaque target;
all events by actor. Incident evidence must be answerable without reintroducing
personal data.

## 9. Stripe Connect Architecture Plan

Plan only. Nothing is implemented, and no Stripe call is described as working.

**Starting position, corrected.** `ConnectedAccount` and
`ConnectOnboardingStatus` exist and are used by payouts, finance and the
`account.updated` webhook handler. Three Connect methods exist on the real
adapter and have **no callers**. The mock adapter has **no** Connect methods.
The declared provider interface does not include Connect.

**Therefore the first Connect task is to define the Connect portion of the
provider interface and implement it in the mock**, matching the real adapter's
signatures so the seam is honest. Onboarding state vocabulary is already fixed
by `ConnectOnboardingStatus` and must not be invented anew.

Planned coverage: connected-account creation; account-link generation;
onboarding return and refresh handling through internal routes only, validated
server-side, never accepting an arbitrary redirect; onboarding status read that
does not mutate; account verification requirements surfaced from
`requirementsDue` with data minimisation; payout-destination handling under
`PAYOUT`; `connect:manage` + `PAYOUT` enforced server-side; the existing
one-organization-to-one-account uniqueness preserved; platform and
connected-account webhooks kept separate with distinct secrets, as
`payment-mode.js` already enforces; Connect webhook signature validation;
idempotent start; durable reconciliation of account state; provider calls kept
outside database transactions, as the existing payment boundary already does;
mock behaviour covering every `ConnectOnboardingStatus` value; production
behaviour `DISABLED`; observability that never logs a secret, a full onboarding
URL or a provider payload; defined failure and retry behaviour; account
disconnect and deauthorization handling; and transfer/payout ledger interactions
left exactly as they are.

**Sandbox verification plan.** Requires authorized Stripe test credentials,
which do not exist in this repository and are not requested here. Until a
sandbox run happens with real credentials and recorded evidence, every real
Stripe action is `EXTERNAL VERIFICATION PENDING`. **Live verification**
additionally requires an approved operational launch plan and is out of scope
for Phase 3 entirely.

## 10. API, UI, Worker, and Database Change Plan

Every item below is **FUTURE IMPLEMENTATION — NOT EXECUTED**.

**Proposed API routes.** A Connect start action, a Connect status read, a
privacy redaction request creation, a redaction confirmation/execution action,
and a redaction request read. Exact paths follow the existing contract
conventions and are settled at implementation time.

**Fields that must never be accepted from a browser:** organization id, actor
id, capability, step-up state, subject authority, connected-account id, provider
account id, onboarding status, redaction outcome, legal-hold state, retention
class, idempotency key.

**Errors.** Reuse the canonical error shape. Unauthorized, cross-organization
and unknown-subject responses must be indistinguishable — non-enumerating.

**UI.** An organizer Connect settings surface with states not authorized,
step-up required, not started, start available, in progress, requirements due,
complete (mock), disabled, provider unavailable, failure. A privacy
administration surface with preview, typed confirmation, success,
already-redacted, retryable failure, denied and hold-refused states.

**Worker.** A retention sweeper with durable state, leases, idempotency,
observability and a defined recovery path. An export invalidation job. Neither
is enqueued without durable state.

**Database.** New models for the redaction request and the legal/fraud hold; a
`desi_audit_log_immutable` trigger; no change to any ledger, order, payment or
ticket constraint. **FUTURE IMPLEMENTATION — NOT EXECUTED.**

**Configuration.** Any new environment variable is validated at boot by the
existing validator. No secret is added by Phase 3.

## 11. Security Threat Model

For each threat: prevention, detection, recovery.

| Threat                      | Prevention                                             | Detection                      | Recovery                             |
| --------------------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------------ |
| Cross-tenant redaction      | org scope from session at every layer                  | cross-org refusal audit events | none needed; refused before mutation |
| Accidental redaction        | typed confirmation, scope preview, step-up             | audit trail                    | irreversible — see §13               |
| Repeat / redelivery         | idempotency record                                     | duplicate-key audit            | returns original outcome             |
| Request replay              | short step-up window, single-use confirmation          | audit                          | refuse                               |
| CSRF                        | existing session and origin controls                   | auth logs                      | revoke session                       |
| Session theft               | short step-up, revocation on privilege change          | login attempt records          | revoke all sessions                  |
| Missing/expired step-up     | server-side window check that throws on unknown policy | refusal audit                  | re-authenticate                      |
| Malicious browser payload   | schema validation, server-derived authority            | validation errors              | reject                               |
| Admin privilege misuse      | narrow `privacy:redact`, minimum grant                 | immutable audit                | access revocation, review            |
| Audit PII leakage           | metadata allow-list, no old values                     | audit-content tests            | cannot be undone — prevent           |
| Export re-identification    | export invalidation and exclusion                      | export tests                   | delete artefacts                     |
| Notification leakage        | outbox scrub after send                                | outbox tests                   | scrub                                |
| Cache / index resurrection  | invalidation step                                      | presenter tests                | re-invalidate                        |
| Race conditions             | transaction boundaries, locking                        | concurrency tests              | idempotent retry                     |
| Partial redaction           | single transaction or durable state machine            | explicit incomplete state      | resume                               |
| Worker retry duplication    | leases and idempotency                                 | job observability              | safe replay                          |
| Webhook spoofing            | signature validation, separate Connect secret          | intake logs                    | reject                               |
| Connected-account takeover  | `connect:manage` + `PAYOUT`, uniqueness constraint     | account audit                  | disconnect                           |
| Token / private-key leakage | secrets never read by this work; secret scan in CI     | `pnpm secrets:scan`            | rotate externally                    |
| Ruleset / CI bypass         | `bypass_actors: []`, required checks                   | protection verification        | restore ruleset                      |
| Supply chain                | pinned dependencies, audit step                        | `pnpm audit`                   | pin or revert                        |
| Logging risk                | no PII in logs by construction                         | log review                     | scrub                                |
| Backup resurrection         | documented caveat; re-run redaction after restore      | restore checklist              | re-run redaction                     |

## 12. Testing and CI Verification Plan

Layers: unit; integration; database against real disposable PostgreSQL; API
route; browser; accessibility; concurrency; load and reliability; workflow and
CI invariants; security regression; secret scan; bundle scan.

Acceptance test cases: audit-trail verification; redaction idempotency;
legal-hold refusal; fraud-hold refusal; cross-tenant refusal; expired step-up
refusal; missing capability refusal; export deletion and invalidation; no PII in
post-redaction presentation; no PII in audit metadata; no PII in the browser
bundle; no skipped or zero-test result; Stripe mock-only tests; and a Stripe
external-verification checklist that remains unticked.

Browser and accessibility work uses the existing standard: viewports 320×720,
768×1024 and 1280×900; `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; no rule
disabled; keyboard-only; 200% zoom; reduced motion; real authenticated sessions
and real seeded rows; and a direct route call without step-up must be refused.

**Existing coverage floors must not be lowered.** `branches: 75` stands. The
`apps/api` margin is thin — approximately `+0.83` points at last measurement —
so every new branch introduced by Phase 3 carries a test obligation in the same
change that introduces it. No file may be excluded from coverage to pass CI.

## 13. Rollback, Incident Response, and Operational Runbooks

**Software rollback is possible. Redaction is not reversible.** These must never
be conflated. Reverting a deployment restores code; it does not restore a
redacted person, and no design may claim otherwise.

Incident response: stop accepting new redaction requests by disabling the route;
pause queue workers; halt the scheduled retention sweeper; preserve audit
evidence, which is safe because it contains no personal data; classify severity;
revoke access if misuse is suspected; communicate with affected parties;
escalate to legal for a hold question; conduct a post-incident review.

Backup and restoration: a restore may resurrect data redacted after the backup
was taken. The runbook must require re-running redaction for every completed
request since the backup point, and must record that this window exists.

Provider incidents: a Stripe or Connect incident is handled through the mock
boundary in Phase 3, because no real provider call is made. Connected-account
compromise handling is disconnect and re-verify.

## 14. Legal, Privacy, and External Verification Boundaries

This plan is **not legal advice**. Every retention duration in §5 is
**PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW** and requires counsel approval
before implementation. Jurisdiction-specific requirements require counsel
review. No claim of GDPR, CCPA/CPRA, PCI DSS, HIPAA, tax, employment, fraud or
consumer-law compliance is made anywhere in this document, and none may be added
without a source in this repository that proves it.

Stripe sandbox verification requires authorized test credentials that do not
exist here. Production Stripe and Connect verification additionally requires an
approved operational launch plan. **Payment mode remains `MOCK`.** Real Stripe
and Stripe Connect actions remain `EXTERNAL VERIFICATION PENDING`. This plan
does not make the system compliant by itself.

## 15. Phased Implementation Order

Four phases. No subphases. None begins without an explicit instruction naming it.

### Phase 1 — Privacy policy enforcement foundation

Scope: add `privacy:redact` and grant it to the minimum organization-management
role; add `PRIVACY_ERASURE`; add redaction and Connect audit action constants;
add the `desi_audit_log_immutable` trigger. Files: `packages/permissions`,
`packages/auth`, `apps/api/src/lib/audit.js`, one migration. Invariants: no
existing route changes behaviour; no personal data moves. Tests before
advancing: capability and role-graph tests; `stepUpWindowFor('PRIVACY_ERASURE')`
returns 120000 and unknown names still throw; a database test proving `UPDATE`
and `DELETE` on `AuditLog` are refused. Excluded: any route, UI or redaction
logic. Completion: full suite green, no behaviour change. Approval: owner.
Stop condition: any existing test changes result.

### Phase 2 — Privacy redaction service, database integrity, and audit evidence

Scope: redaction request and hold models; the deterministic placeholder
strategy; the transactional service; the redaction API route with authorization,
step-up, confirmation and idempotency; the audit events. Invariants: ledger and
audit rows untouched; referential integrity preserved; no reversal path stored.
Tests: database tests against real PostgreSQL for concurrency, idempotency,
integrity and non-recoverability; route tests for every refusal case; audit
content tests. Excluded: UI, exports, retention sweeper, Connect. Completion:
every §16 criterion for redaction passes. Approval: owner, plus legal sign-off
on §5 durations if the sweeper is in scope. Stop: any integrity test fails.

### Phase 3 — Privacy request UI, exports, retention worker, and operational controls

Scope: the administrative UI; export invalidation and exclusion; the retention
sweeper with durable state; operational dashboards and runbooks. Invariants:
server decides everything; no PII in any client-visible surface. Tests: browser
and accessibility at the existing standard; export tests; sweeper idempotency
and recovery tests. Excluded: Connect. Completion: §16 UI and export criteria
pass. Approval: owner, plus counsel approval of retention durations. Stop:
any PII appears in a client surface.

### Phase 4 — Stripe Connect mock integration, sandbox verification readiness, and final adversarial verification

Scope: define the Connect portion of the provider interface; implement it in the
mock across every `ConnectOnboardingStatus` value; the Connect API boundary
under `connect:manage` + `PAYOUT`; the organizer Connect UI; a sandbox
verification checklist left unticked. Invariants: payment mode stays `MOCK`; the
kill switch stays intact; no real Stripe call. Tests: mock-only unit and route
tests; browser and accessibility tests; kill-switch proof unchanged. Excluded:
any real Stripe call, any credential. Completion: §16 Connect criteria pass and
every real Stripe item still reads `EXTERNAL VERIFICATION PENDING`. Approval:
owner. Stop: any code path can reach a real provider.

## 16. Acceptance Criteria

Pass/fail, all required.

Every data category in §5 is treated as the matrix says, proven by test. No
personal data resurfaces through presenters, exports, notifications, audit
metadata, logs, queues, caches, OpenAPI examples, fixtures or the browser
bundle. A repeated redaction is idempotent and produces identical state. Every
redaction route refuses without a session, without `privacy:redact`, without
fresh `PRIVACY_ERASURE` step-up, across organizations, and for an unknown
subject — with a non-enumerating response. An active legal or fraud hold refuses
redaction and records the refusal. Every attempt and completion writes an
immutable audit event containing no personal data, and no existing audit row is
modified or deleted. Ledger balance, financial totals, tax, refunds, payouts and
reconciliation remain correct. Tickets, transfers and check-in continue to work.
Stored exports containing a redacted subject are deleted where possible and
future exports exclude them. CI passes with coverage floors unchanged and every
new branch covered. Branch protection is unchanged. Every Connect path is
`MOCK-ONLY` and every real Stripe action still reads
`EXTERNAL VERIFICATION PENDING`. Production payments remain `DISABLED` with
executable proof. Documentation describes only implemented behaviour.

## 17. Explicit Non-Implementation Statement

Phase 3 application implementation has not begun. This document is a planning
and policy-design artifact only. No database migration, API route, UI feature,
worker, Stripe operation, user-data redaction, retention deletion, or production
configuration change was performed by this planning task.
