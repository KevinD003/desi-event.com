# ADR 0016 — Per-event booking fee and referral codes

- **Status:** Accepted
- **Date:** 2026-10-09 (decided in SPEC3 revision 2 and SPEC3-XI revision 2);
  recorded 2026-10-13
- **Supersedes:** nothing. ADR 0010's "the platform administrator holds nothing
  touching money" is narrowed here (§5), with the owner's words as the reason.
- **Related:** ADR 0017 (paying at the venue), ADR 0003 (the charge model a real
  payments stage would use), ADR 0010 (the `ADMIN` role and its allow-list),
  `docs/PAYMENTS.md`, `docs/REFUNDS_DISPUTES.md` ("Booking fees, referral codes
  and paying at the venue — 2026-10-09"), `docs/SECURITY.md` ("Booking fees,
  referral codes and paying at the venue — 2026-10-09"), and the owner's report
  `docs/PHASE4_FEES_AND_VENUE_PAYMENTS_REPORT.md`.

## Context

The owner's requests of 8 October 2026, in their words:

> R2 "And add platform fee."
>
> R3 "Admjn can create a coupon code which can waive off the platform fee."
>
> R4 "It should get changed by admin for each different event. It can edited
> anytime adter the event goes live in the website or after the pre or post
> event."
>
> A2 "It automatically charges to the buyer but to get 100% off of the platform
> then it should ask for referral code. This referral code will be added by
> admin and superadmin and gets paid to admin only. … Admin can enter the amount
> per event for the platform fee and can changr the amount anytime. It should
> not get freeze once the event goes live."
>
> A3 Each coupon is scoped by the admin: one event, several events or all
> events; optional expiry; optional usage limit.
>
> A4 A fee change applies to new orders only; past orders keep their fee; an
> admin can still refund a fee on a past order by hand.

Before this, every event paid the same booking fee — a server setting, 5.90% of
the discounted ticket price plus a flat amount per ticket — and nothing could
waive it. The checkout already called the fee "Booking fee", and its tests pin
that word, so buyers and organisers keep reading "booking fee"; administrator
screens say "booking fee (the platform fee)" once, then "booking fee". The
owner's "coupon code" is the **referral code**, kept apart from the organisers'
promo codes.

## Decision

### 1. An event's own booking fee (DF1–DF7, DF9)

- **Terms.** An event uses the site default, or its own terms: a percentage
  (0–3000 basis points, 0.00%–30.00%) and an amount per ticket (0–10,000 minor
  units, up to 100.00 in the event's currency). Either may be 0; both 0 reads
  "This event has no booking fee." everywhere. The bounds guard against typing
  mistakes, and the owner confirmed them (question 8).
- **Formula unchanged** (DF2): the fee is worked out on the discounted ticket
  price, half up, plus the flat amount for every ticket, and is 0 when the
  discounted price is 0; tax, where there is any, is on the discounted price
  plus the fee. Only the numbers come from the event.
- **The site default stays a server setting** (question 5, confirmed): its
  percentage is `PLATFORM_FEE_BPS`; its flat part is `PLATFORM_FEE_FLAT_CENTS`
  for INR orders only and the currency table for every other currency, so a USD
  order's flat part is always $0.99 (F3; `docs/development.md` says so since
  this change).
- **One currency** (DF3). An event sells in one currency, and its own terms are
  stored in it when they are set. While an event has its own terms, an organiser
  cannot price a tier in another currency (409 `FEE_TERMS_CURRENCY`), so an
  organiser's edit never moves the fee. The check runs twice: before the
  transaction, and again under the event's row inside it
  (`assertHeldFeeTermsCurrency`), because a fee change saved between the two
  would otherwise pass unseen — the review of 2026-10-12 found that race, and
  six real-PostgreSQL cases hold it now. No new lock: the event row was already
  the first lock those transactions take. An order whose currency is not the
  terms' currency (unreachable after this rule) is priced with the site default.
- **New orders only** (DF4, A4). Pricing reads the terms in the pricing
  transaction and the order records them: `feeSource`, the numbers used, the
  decision row (`feeSettingId`), `feeGrossCents`, `feeWaivedCents` and
  `feesCents`. Nothing ever reprices an order. A change committed between a
  quote and the order refuses the order when the buyer's figure no longer
  matches (409 `PRICE_CHANGED`, the buyer is shown the new total).
- **Any time, any status except deleted** (DF5, R4): draft, under review, on
  sale, paused, sold out, postponed, finished, cancelled, rejected, archived.
  A deleted event refuses (409 `NOT_EDITABLE`); its settings stay as they were,
  so a restore brings them back. The platform-held organisation that holds
  imported events refuses (409 `SOLD_ON_SOURCE`). _Superseded 2026-10-15 (ADR 0015, addendum
  "2026-10-15 (2)"): its tickets are sold here, so its fee is set like any
  other event's; only paying at the venue is refused for it (409
  `VENUE_PAYMENT_UNAVAILABLE`)._
- **Who** (DF6): `payment_terms:manage` (ADMIN, SUPER_ADMIN), step-up
  `PAYMENT_TERMS` (ten minutes), a reason of 10–500 characters, a
  compare-and-set on the decision's sequence, an audit row
  (`event.platform_fee_changed`) and an append-only history row
  (`EventFeeSetting`, trigger `desi_event_fee_setting_append_only`), all in one
  transaction. Organisers read the fee and its history, with the
  administrator's name and reason; they never write it.
- **The event's revision is not moved** (DF7), so an organiser's open editor is
  not made stale by a fee change, as the website switch does not.

### 2. Refunding a booking fee by hand (DF8, A4)

`platformFees.refund` refunds what is left of **one order's** booking fee and
the tax that fee carried, nothing else: no ticket is withdrawn, no place
returns, and the order's status does not change. Its `Refund` row says so:
`ticketsRevoked: false`, `inventoryReturned: false` (corrected on 2026-10-13;
the first build stamped every settled refund `true`/`true`).

- It is a **request-and-approve authority in one hand**: the refund records the
  same administrator as requester and approver. That is safe enough to allow
  because it is bounded — one order's fee, a reason, `FINANCE_ACTION` step-up,
  30 refunds an hour per administrator — and recorded like every refund.
- `platform_fee:refund` is held by ADMIN, FINANCE_ADMIN and SUPER_ADMIN.
  ADMIN reads **one order's booking-fee figures by reference** through
  `platformFees.preview` (no buyer name or address); every other money report
  stays behind `finance:view`.
- An order whose booking fee was kept when its unpaid tickets were cancelled
  (ADR 0017) has that part out of reach of this refund too (open question C).
- The FEE form is never promoted to a whole refund, whatever is left.

### 3. Referral codes (DR1–DR13)

- **Made by the team at The Desi Events only** (DR1): ADMIN and SUPER_ADMIN
  (`referral_code:manage`) create, edit, switch on and off, list and report
  them. There is no delete: a code is switched off. Creating, editing and
  switching on need the `PAYMENT_TERMS` step-up; switching off only reduces what
  is on offer and needs none.
- **Effect** (DR2): removes 100% of the order's booking fee and any tax on that
  fee — never the ticket price, the tax on it, or a promo code's discount, which
  applies first. With no fee to waive the code is neither evaluated nor used.
  A buyer may use one promo code and one referral code on an order.
- **Shape** (DR3, DR4): typed by the administrator or generated; trimmed and
  upper-cased; 6–32 of `A–Z`, `0–9` and `-`, starting and ending with a letter
  or digit, no `--` (CHECK `referral_code_shape`); generated codes are
  `XXXXX-XXXXX` from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` with `crypto.randomInt`,
  drawn again on a clash up to five times. Globally unique. Typed codes are
  allowed because administrators hand a memorable code out in public; the form
  warns that short or common words are easy to guess.
- **Scope, expiry, limit** (DR6, DR7, A3): every event, or 1–50 chosen events
  (a deleted event cannot be added; one deleted later stays in the scope and
  sells nothing); an optional expiry; an optional total limit of 1–1,000,000
  (CHECK `referral_code_use_within_limit`). No per-buyer limit.
- **Sign-in** (DR9): naming a code needs a signed-in account.
- **Attribution** (DR11, A2): every code records the administrator who made it
  (kept as "A former administrator" once the account is gone) and every order
  that used it, and the pages report uses and fees waived per code and per
  administrator. **Nobody is paid for referrals** (question 6, confirmed): a
  payout needs real payments. The limitation `referral-rewards` says so.
- **What others see** (DR12, question 4 confirmed): buyers and organisers read
  "Booking fee waived with a referral code" — never the code's text, id, label
  or maker. Order payloads carry `referralApplied: boolean` only.

### 4. Plain text, named `referralCode` (DR5)

A code is stored in plain text, as promo codes are, for three reasons:
administrators must be able to read a code back from the list to share it
again; a code is worth at most one order's booking fee and grants no access to
any account; and a digest would hide nothing from someone who can read the
database, which holds the orders themselves. Everything a promo code's text is
kept out of, this code is kept out of too: URLs (no route takes a code in its
path or query; finding one is a filter over the rows already on the page),
logs, audit metadata (the label is recorded only as `labelSet` /
`labelChanged`), outbox rows, browser storage, bundles and screenshots. Every
response field carrying a code is named `referralCode` — never `code` — so the
logger redacts it by key in both of its lists, and the error serialiser drops
PostgreSQL's `detail`, which could quote a failing row.

### 5. Guessing: one answer, a budget, and two residuals (DR10)

- Unknown, switched off, expired, out of scope, used up, and its own maker
  using it all answer the same `NOT_ACCEPTED`, and the lookup runs the same
  queries whatever it finds (a malformed value is looked up as a sentinel that
  cannot match).
- **The control is a refusal budget** that counts only `NOT_ACCEPTED` answers
  of a quote or an order: 10 per 10 minutes per account, 30 per 10 minutes per
  address (an HMAC of the address, no browser description), and, when no
  address is known, one shared bucket of 300 per 10 minutes that is never
  skipped. Applying and re-quoting a good code costs nothing.
- **Residual 1, timing.** A guesser could still infer that a code exists from a
  lock wait at the charge for a code applicable to them. The budget is what
  bounds it.
- **Residual 2, the shared bucket** (review of 2026-10-12). A production web
  server whose `TRAFFIC_TRUSTED_PROXY_HOPS` is 0 (unset) forwards **no**
  address on checkouts, because with no proxy named the last
  `X-Forwarded-For` entry is one the browser chose. Wrong codes then all fall
  into `referral:shared`, which a guesser can fill for everybody naming a code
  for ten minutes. A deployment behind a proxy or load balancer should set the
  hops to match it (`docs/SECURITY.md`).

### 6. A use is given back when its order ends without being used (SPEC3-XI XR)

The owner answered question 3 "Yes": a refunded or cancelled order gives its
referral code's use back. Built:

- **Once, never below zero.** An order "ends without being used" when it is
  cancelled, expired or refunded, or when it is paid but nothing of it stands,
  nothing is left to refund and none of its tickets was ever let in (or its
  event was cancelled). Partial refunds, the booking fee refunded by hand and a
  partly cancelled booking keep the use. The causes recorded are
  `PAYMENT_FAILED`, `NOT_COMPLETED` (a booking with nothing to pay online that
  could not be completed), `UNPAID_ORDER_CANCELLED`, `REFUNDED`,
  `VENUE_UNPAID_CANCELLED`, `EVENT_CANCELLED`, `EVENT_DELETED`,
  `SESSION_CANCELLED` and `TICKETS_REVOKED` (the organiser withdrew every ticket
  and nothing was left to refund — open question G).
- **A marker on the order** is the exactly-once decision: a conditional update
  sets `Order.referralUseReturnedAt` and its cause only while it is null, in
  the same transaction as the decrement and under the order's row lock; trigger
  `order_referral_return_once` keeps a set marker for ever, and
  `order_referral_code_fixed` keeps the code an order used. So
  `useCount = orders naming the code whose marker is null`; the reports show
  uses placed, uses given back and uses now, and a used-up code can come back.
- **Codes are the last row locks of their transaction, in ascending id order.**
  One entry point, `settleReferralUsesIfEnded`, is called once per transaction,
  after its last order, line, ticket and seat write. A transaction that cancels
  many orders (an event's cancellation, a deletion, a night's cancellation)
  must not give uses back order by order inside its loop: it would hold code C1
  while waiting for its next order, which a single-order path may hold while
  waiting for C1, and two such transactions could take C1 and C2 in opposite
  orders. Real-PostgreSQL races R1–R13 prove it (`docs/REFUNDS_DISPUTES.md`).
- Promo codes are unchanged: a refund never gives an organiser's promo use back.

### 7. Three conflict-of-interest rules (DF6, DF8, DR13)

- An administrator who holds any membership in an event's organisation cannot
  change that event's booking fee or pay-at-the-venue switch (403
  `CONFLICT_OF_INTEREST`): another administrator has to.
- An administrator cannot refund the booking fee of their own order — by
  account, or a guest order placed with their own address (the same rule as
  reading one's own order) — or of an order on an event of an organisation they
  belong to.
- A code's maker cannot use it, so nobody can inflate their own report.

### 8. The platform administrator now sets money terms

ADR 0010 gave `ADMIN` exactly ten capabilities and "nothing touching money".
The owner asked for administrators to set fees (R4, A2), make referral codes
(R3, A2) and refund fees by hand (A4), and answered question 2 so that they
cancel unpaid bookings (ADR 0017). So the allow-list grows to **fourteen**:
`payment_terms:manage`, `referral_code:manage`, `platform_fee:refund` and
`venue_booking:cancel` join it, all platform-only; the load-time bound
(`assertPlatformAdministratorBounds`) still holds the role to exactly the list,
and a doctored table giving it `order:refund` still throws. Its doc comment now
says what is true: it sets the booking fee and pay-at-the-venue switch of any
event, makes referral codes that waive the fee, refunds one order's booking fee
by hand and cancels unpaid pay-at-the-venue tickets of any event, keeping their
booking fee; it moves no organiser's money, refunds no ticket price and holds
no posting capability. None of the four literals reaches a browser bundle.

## Consequences

- **What organisers see changes, what they control does not.** They see their
  events' booking fee and its history, and "Booking fee waived with a referral
  code" on such orders; they change neither.
- **Reports, not payouts.** Uses and fees waived are counted per code and per
  administrator from the orders, labelled as not from the ledger, because a
  waiver moves no money (`docs/FINANCIAL_LEDGER.md`).
- **The limitations page** lists `booking-fee-default` (the site default is a
  server setting) and `referral-rewards` (nobody is paid for referrals), and
  says under its list what a referral code does and gives back.
- **The fee is the platform's.** It is `platform_fee_revenue` in the ledger,
  never an organiser's share; a future real-payments stage must charge it that
  way (ADR 0017 §8).
