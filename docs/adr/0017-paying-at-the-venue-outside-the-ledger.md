# ADR 0017 — Paying at the venue: money at the door outside the ledger

- **Status:** Accepted
- **Date:** 2026-10-09 (decided in SPEC3 revision 2 and SPEC3-XI revision 2);
  recorded 2026-10-13, with the lock changes the builders made after
  SPEC3-XI was written
- **Supersedes:** nothing. Narrows ADR 0003 for one kind of order (§8).
- **Related:** ADR 0016 (the booking fee and referral codes), ADR 0003 (the
  charge model), ADR 0006 (one live ticket per seat; the order-line lock),
  ADR 0007 (the platform door), `docs/CHECK_IN.md` ("Paying at the door —
  2026-10-09"), `docs/REFUNDS_DISPUTES.md`, `docs/FINANCIAL_LEDGER.md` and the
  owner's report `docs/PHASE4_FEES_AND_VENUE_PAYMENTS_REPORT.md`.

## Context

The owner, on 8 October 2026:

> R1 "If they are going to make the payment through cash or event location
> then it should not add the taxes in the ticket."
>
> A1 Pay at the venue is switched on or off per event by an admin or super
> admin only.

and, answering the open questions on 9 October 2026:

> Q1 (unpaid pay-at-the-venue tickets per account per event): "No per-buyer
> limit".
>
> Q2 (places booked to pay at the venue that are never paid, and buyers who do
> not come): "The admin keeps the platform fee and rest is paid to the buyer."
>
> Q7 (can a ticket booked to pay at the venue be passed on): "Yes".

Until now every order was paid in full online. This decision adds a second way
to pay: the booking fee online, the ticket price at the door.

## Decision

### 1. The switch and its limit (DV1, A1, Q1)

`Event.venuePaymentEnabled`, off by default, and `Event.venuePaymentLimit`
(1–100,000, required to switch on, kept when switched off) are set together by
`paymentTerms.setVenuePayment`: ADMIN or SUPER_ADMIN (`payment_terms:manage`),
step-up `PAYMENT_TERMS`, a reason of 10–500 characters shown to the organiser
with the administrator's name, a compare-and-set on the current values, an
audit row and a history row (`EventVenuePaymentChange`). Allowed in every
status except deleted; refused for the platform-held organisation; switching
**on** is refused for an online event. Switching off or lowering the limit
leaves every booking already made as it is.

**The per-event limit only** (the owner's answer to question 1). The limit is
the most unpaid pay-at-the-venue tickets all buyers together may hold for the
event at one time; there is no limit per account. It is checked in one
statement under a per-event advisory lock, counting PENDING bookings' shares and
PAID bookings' unpaid, standing tickets (409 `VENUE_PAYMENT_FULL`). Without it,
free accounts — and, with a referral code, accounts paying nothing online —
could book a whole event for nothing; with it, what an abuser can hold is what
the administrator chose. The count has no condition on a ticket's night
(`unpaidVenueTickets`, `apps/api/src/lib/venue-booking-limits.js`): an unpaid
ticket whose night is over still counts against the event's limit, and it can
no longer be cancelled (`VENUE_NIGHT_OVER`, §5), so on an event with several
nights the no-shows of earlier nights reduce what later nights can book until
an administrator raises the limit. Leaving tickets of nights that are over out
of the count is an owner decision, recorded in the owner report (decision J).
Sign-in stays required: the wallet, the door's holder, transfers and the group
pass all need an account.

### 2. What a pay-at-the-venue order is (DV2–DV4)

- **Offered** when the switch is on, the event is bookable, not online, not
  platform-held, and the basket's ticket price after its promo is above 0.
- **The online part** is the booking fee and any tax on it — never the ticket
  price (CHECK `order_venue_payment_shape`: `totalCents = feesCents +
taxCents`, `venueDueCents = subtotalCents − discountCents > 0`). With a
  referral code the online part is 0: no `Payment` row, settled in its own
  transaction (ADR 0016).
- **No tax** (R1). No tax is added to the ticket price, and by default none to
  the online booking fee (`AT_VENUE_TAXES_BOOKING_FEE = false`, question 9,
  confirmed). The order records it (`pricingSnapshot.tax.applied = false`,
  reason `PAID_AT_VENUE`); the CHECK allows tax on the fee, so changing
  question 9's answer needs no migration. **The organiser may still owe sales
  tax on those sales**: this site does not work out or report it, and the
  limitations page says so (`tax-on-venue-tickets`). Card orders keep today's
  tax, which is 0 for every US event because US sales tax is a deliberate demo
  zero; R1 is proven on an Ontario event (13% demo HST).
- **The order is PAID when its online part settles** (DV3): its tickets are
  issued then and hold their places, so everything that already handles PAID
  orders — refunds, deletion, night cancellation, group passes, the wallet —
  keeps working. Every screen a buyer reads derives "booked, pay at the door"
  from the tickets' payment state rather than saying "Paid".
- **Per-ticket shares** (DV4). Each ticket carries `venueDueCents`, its share of
  the ticket price after the promo, which never changes
  (`desi_ticket_venue_due_guard`), and `venuePaymentId`, the payment that paid
  it, set once (`desi_ticket_venue_payment_guard`). A ticket owing something
  with no payment does not admit (`check_in_payment_due`).

### 3. A payment is recorded only with the admission it pays for (DV7, DV8)

The steward's screen says how much to take; "Payment taken: {amount} — admit"
records the payment and lets the ticket in, in one transaction. The amount must
equal what is due — no partial payment, tips or change. Several tickets of one
booking are paid for and let in together through the booking's group pass (one
`VenuePayment` with `via = DOOR_GROUP`). A payment for a ticket that is not
being let in is not possible. The deferred trigger `desi_venue_payment_sum`,
checked again from the ticket side by `desi_ticket_venue_payment_sum` and
`…_on_delete`, keeps every payment equal to the tickets it paid for, at commit
and for ever after; `desi_venue_payment_append_only` keeps it unedited.

**No undo**, as there is no undo of an admission. The organiser's "Payments at
the venue" page is what they reconcile their takings against. The site records
the amount, not how it was paid, so screens say "pay at the door" and "payment
taken", never "cash".

### 4. Tickets that owe a payment can be passed on (XT1–XT7, Q7)

SPEC3's "no transfers" is **replaced** by transfers with money due:

- A ticket booked to pay at the door is offered and accepted like any other;
  what is due stays with it (a successor owes exactly what its predecessor owed
  and no ticket's due ever changes), and whoever holds it pays at the door. A
  ticket already let in still cannot be handed on, and a ticket paid at the
  door has always been let in, so a paid ticket is never handed on.
- The group pass covers only the buyer's own current tickets, so a group
  payment never covers someone else's ticket.
- The person passing it on is told before sending; the receiver is told the
  amount before accepting — in the invitation email, or by the sender, whose
  one-time code panel says "Tell them: whoever holds this ticket pays {amount}
  at the door." — and again after accepting.
- **Door money paid by a new holder is theirs** (XT7): every "the {amount} you
  paid at the door is with the organiser" counts only the tickets the buyer
  holds; what other holders paid is counted apart and each of them is told
  themselves.

### 5. Cancelling unpaid tickets (XU1–XU14, Q2)

The owner's "The admin keeps the platform fee and rest is paid to the buyer" is
built as **Cancel unpaid tickets**:

- **Who** (XU2, open question B): the organisation's owners and administrators
  (the members holding `order:refund`, checked against their own membership,
  never through `can()`), and Desi-Event administrators and super administrators
  (new platform capability `venue_booking:cancel`, which moves no money).
  Membership is read first: an administrator whose own membership in the
  organisation lacks `order:refund` is refused `CONFLICT_OF_INTEREST`. Everybody
  else gets 404.
- **What** (XU3): chosen tickets of one booking that still owe their door
  price — VALID or offered, unpaid, never let in, their night not over — with
  "all unpaid" selected by default. Named ids make it exact under races: the
  request is all or nothing (409 `VENUE_BOOKING_CHANGED`), and a repeat of the
  same set is answered with the same cancellation (`replayed: true`).
- **When** (XU4, open questions D and I): while the event is live, at any time
  — even weeks before the doors open — until the ticket's night ends (for an
  every-night ticket, until the last night ends; for an event with no nights
  listed, until the event ends). The status is read again after the ticket
  locks. Nothing is ever cancelled automatically, and a buyer who does not come
  keeps their ticket on paper and the booking fee stays kept (DV6, XU13).
  Buyers cannot cancel their own bookings (open question H).
- **Effect**: each ticket is withdrawn (REVOKED, reason `venue-unpaid:<id>`, its
  pass dead, an outstanding offer withdrawn); nobody owes its price; one
  append-only `VenueBookingCancellation` row records who, when, why, which
  tickets and the amounts (sum checked at commit by
  `desi_venue_booking_cancellation_sum` and from the ticket side). The buyer,
  and every other account holding a cancelled ticket, is told why: the buyer on
  the order page, every holder on the ticket's wallet card and page
  (`venuePayment.cancelled`: when, by the organiser or the Desi-Event team, and
  the reason given, never a name). The `venue_booking.cancelled` notice queued
  for each of them is not emailed in this build. The door
  then refuses the ticket `UNPAID_CANCELLED` when it is looked up by its
  printed code; a scan of its old pass finds nothing.

### 6. Places are freed — on this path only (XU5)

General admission returns through the tier's `quantitySold`, decremented under
the tier's own lock by exactly the tickets this transaction withdrew — the only
decrement of `quantitySold` anywhere; refunds still never decrement it (RF9),
so a refunded general-admission place does not go back on sale (the limitation
`general-admission-refunds`). Reserved seats go back to AVAILABLE at once, even
in the last 24 hours, because freeing the place is the point and the cancelled
pass is dead (open question E). A night's general-admission capacity and the
event's pay-at-the-venue limit follow.

**It cannot oversell.** Every checkout locks a tier before reading what is left,
and the decrement runs under the same lock; each cancelled place was counted
once, by settlement; a REVOKED ticket never moves again and its cancellation is
set once, so no place is given back twice. Hence `quantitySold ≥ standing
tickets` after every cancellation, with CHECK `ticket_type_sold_not_negative` as
the backstop; real-PostgreSQL races C9, C10 and C12 prove it.

**Freed is not "on sale".** A freed place sells only while the event is
bookable and the place's tier and night are selling. The cancelling transaction
works out `placesOnSale` — ALL, SOME or NONE — from the rows it holds, and no
sentence anywhere says "back on sale" unless it is ALL at that moment; an
organiser whose event is paused or sold out is told to open sales on the event
page to sell them.

### 7. The kept fee, and the rest that goes back (XU6, open questions A, C, F)

- **Kept:** each cancelled ticket's share of the booking fee charged,
  apportioned by door price exactly as a lines refund apportions one
  (cumulative floors), capped at what the order still holds. It is added to
  `Order.venueFeeKeptCents` and recorded on the cancellation.
- **Kept is kept** (standing rule 8): no later refund, cancellation, deletion,
  night cancellation or administrator's hand refund reaches it — every refund
  computes from what is left after kept shares, and CHECK
  `order_venue_kept_within_total` (`refundedCents + refundPendingCents +
venueFeeKeptCents ≤ totalCents`) refuses any reservation that would.
- **"The rest is paid to the buyer":** the rest is the cancelled tickets' share
  of the tax on that fee. It is 0 on every order of this build (question 9), so
  no refund is written and nothing is posted to the ledger. **Tax on a fee is
  never kept** — there is no kept-tax column — because the owner said the rest
  goes back. Until that refund is built, a booking that does carry tax is
  refused `VENUE_CANCEL_TAXED` (unreachable while question 9 stands).
- **Every other refund keeps today's rules** (XU14, open question A): card
  orders, and pay-at-the-venue tickets refunded because the event or a night is
  called off, give the booking fee back with the tickets.
- A refund in flight blocks a cancellation (`REFUND_IN_PROGRESS`); disputes do
  not (a dispute on the fee payment is against platform revenue whatever is
  kept).

### 8. Door money is not in the ledger (DV10, §0.1)

Nothing in this build posts a payment taken at a venue to the ledger, counts it
as owed to an organiser, counts it as platform revenue, or refunds it. It is
recorded in its own table and reported beside the ledger, labelled as held by
the organiser. Why not a memorandum account: the money never passes through the
platform, and a ledger account holding it would invite someone to pay it out.

- **The online part is ordinary platform money.** A fee-only `ORDER_PAID` batch
  is `processor_clearing` DEBIT F, `platform_fee_revenue` CREDIT F, with no
  organiser entry (the organiser has no share), and no contra-revenue for a
  promo, which lowered the door price, not platform money.
- **Disputes** on a fee-only payment are taken from `platform_fee_revenue`
  (`heldFrom`), not from an organiser who never received the money; the payout
  liability holds back only card orders' pending refunds and disputes.
- **Refunds give back only the online part** (§10.2's forms): whole and lines
  refunds return the booking fee's share and withdraw tickets; an amount refund
  is refused (`AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS`); the booking fee alone is
  refunded by the Desi-Event team (ADR 0016 §2). Money already taken at the door
  is the organiser's to return, and every screen and notice that refunds such
  an order says so.
- **A future real-payments stage** (DX2) must charge the online booking fee as a
  platform charge — no `on_behalf_of`, no `transfer_data` — and refund it with
  `reverseTransfer: false`, so the fee is never routed to the organiser's
  account. In `PAYMENT_MODE=MOCK` the mock provider captures it like any order,
  and every pay button says "(simulated)".

### 9. The lock law (SPEC3-XI §2, with the changes made while building)

Every transaction these features add or change takes its row locks in one
global order, earliest first:

| #   | Row                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Event` (`FOR NO KEY UPDATE`)                     | night cancellation, deletion, event cancellation, the fee and switch setters. An organiser's tier write re-checks the event's own fee currency under this row (DF3; ADR 0016 §1)                                                                                                                                                                                                                           |
| 2   | `TicketType`, sorted, `FOR UPDATE`                | checkout, night cancellation, deletion, cancel-unpaid, settlement (**moved first**), and a booking with nothing to pay online cancelled unsettled (`recordUnsettledCapture`) or a declined card (`compensateCheckout`)                                                                                                                                                                                     |
| 3   | `EventSession`, sorted                            | `FOR UPDATE`: checkout, night cancellation, deletion. `FOR KEY SHARE`: the door, cancel-unpaid (the tickets' nights **and the order's own**), `settleRefund` (the order's night, **first**), `recordUnsettledCapture` and `compensateCheckout` (after their tiers)                                                                                                                                         |
| 4   | `TicketHold`, then `PromoCode`                    | checkout, hold release and expiry                                                                                                                                                                                                                                                                                                                                                                          |
| 4b  | `Refund` (`FOR UPDATE` or a conditional `UPDATE`) | a refund's own steps — approval, submission, settlement (after the order's night), failure, time-out, cancelling, repair and the send check (`assertRefundSendable`) — each before its order (`apps/api/src/lib/refunds.js`). A refund created in the same transaction after its order's lock (a booking fee refunded by hand, the refund driver's replacement) is a new row no other transaction can hold |
| 5   | `Order`, sorted when several                      | `FOR UPDATE`: refunds, night cancellation and deletion (every PAID order they touch, right after their nights), event cancellation (PENDING orders too), cancel-unpaid, `tickets.revoke`, settlement, the referral re-lock. `FOR SHARE`: the single and the group door                                                                                                                                     |
| 5a  | `GroupPass` `FOR SHARE`                           | the group door                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | `OrderItem`                                       | `FOR UPDATE`: refunds, transfer acceptance, cancel-unpaid. `FOR KEY SHARE`: **the door, single and group**, and **night cancellation and deletion** (the lines of the PAID orders they locked)                                                                                                                                                                                                             |
| 7   | `Ticket`, sorted, `FOR UPDATE` or `UPDATE`        | the door, offers, acceptance, withdrawals, refunds, revocation, settlement's inserts, cancel-unpaid                                                                                                                                                                                                                                                                                                        |
| 8   | `EventSeat` (`UPDATE`)                            | refunds, settlement, cancel-unpaid                                                                                                                                                                                                                                                                                                                                                                         |
| 9   | membership and scope `FOR SHARE`                  | the door's tail                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | `ReferralCode`, ascending id, **last row locks**  | checkout's one code; `settleReferralUsesIfEnded`, once per transaction after its last order, line, ticket and seat write                                                                                                                                                                                                                                                                                   |
| 11  | the event's venue-booking advisory lock           | checkout only                                                                                                                                                                                                                                                                                                                                                                                              |

Two transactions that take subsets of this list in this order cannot wait on
each other in a cycle; sorted acquisition within a kind keeps several rows of
one kind safe. What changed after SPEC3-XI was written, each proven by the test
named:

- **The door takes the ticket's order line `FOR KEY SHARE` between the order
  and the ticket**, single and group. A door that records a payment updates the
  ticket twice (payment, then status), and PostgreSQL re-checks the ticket's
  foreign keys on the second update, taking `KEY SHARE` on its line after the
  ticket; a transfer acceptance holds the line `FOR UPDATE` before the ticket,
  so the two deadlocked. Test 14.
- **`settleRefund` takes the order's night `FOR KEY SHARE` first.** It writes the
  order more than once (its counters, REFUNDED, the referral marker); the second
  update's foreign-key check takes `KEY SHARE` on the night after the order,
  while a night's cancellation or a deletion holds the night and waits for the
  order. C3c.
- **Cancel-unpaid also locks the order's own night** `KEY SHARE`, beside the
  tickets' nights (defensive: it writes the order twice).
- **`recordUnsettledCapture` (nothing to pay online) and `compensateCheckout`
  take tiers, then night `KEY SHARE`, then the order** (`lockAheadOfOrder`). The
  first deadlocked against a deletion's or night cancellation's
  `cancelUnpaidOrders` (R12, R12b); the second's locks are defensive. So the
  pair "deletion's `cancelUnpaidOrders` × `recordUnsettledCapture`" now reads:
  tiers → night → order, serialised at the first shared tier or the night.
- **Night cancellation and deletion take their PAID orders' lines `FOR KEY
SHARE` after the order locks, and read the tickets again** under them, so a
  transfer being accepted is waited out and its successor is withdrawn too
  (C7b).
- **Night cancellation and deletion end transfer offers after the tickets'
  conditional update, from what that update withdrew** — never from a read taken
  before it — the same rule cancel-unpaid follows (C7c).
- **The general rule:** a path that writes an order twice in one transaction
  holds the order's night (and, where it writes a ticket twice, the ticket's
  line) first, because the second write re-checks the foreign keys and takes
  `KEY SHARE` on the rows they name.

Recorded deviations that cannot close a cycle: event cancellation locks its
orders unsorted, but it holds the `Event` row first, as night cancellation and
deletion do, and holds no referral code until its batch; night cancellation and
deletion lock PAID orders before they release holds and their HELD seats, which
no path locks before waiting on a PAID order. A `40P01` that still occurs is
answered 409 `TRY_AGAIN` (nothing was written; `apps/api/src/lib/errors.js`,
`RETRYABLE_CODES`), not the 503 `SERVICE_UNAVAILABLE` a wait that runs out of
time answers; the race tests assert none occurs.

## Consequences

- **Limitations** (`/limitations`): `paying-at-the-venue` (door money is the
  organiser's to return; unpaid tickets stay booked until cancelled; nothing
  automatic), `tax-on-venue-tickets`, `unpaid-bookings` (buyers cannot cancel
  their own; the event's limit bounds what one account can hold; a kept fee is
  never refunded) and `general-admission-refunds`.
- **Organisers** get a "Payments at the venue" page (`finance:view`, step-up
  `FINANCE_VIEW`): payments taken, bookings still unpaid, cancellations, and
  after the event "Not paid by the end of the event". Desi-Event
  administrators get "Bookings waiting to be paid at the door" for any event,
  with no buyer or attendee names.
- **Reserved seats and general admission differ** on refund (RF9, unchanged)
  but not on cancel-unpaid, which frees both.
- **What would change it.** Charging tax on the online fee (question 9),
  keeping the fee on every refund (question A), refunding a kept fee as a
  goodwill gesture (question C) or letting buyers cancel (question H) are each a
  rule in one module, with no migration.
