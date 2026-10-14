# Booking fees, referral codes and paying at the venue — report

- **Date:** 2026-10-13
- **Branch:** `claude/phase4-frontend-ui-ux-completion`
- **Your requests:** 8 October 2026 — a platform fee set per event, coupon
  codes from the Desi-Event team that waive it, and paying for tickets at the
  venue. Your answers to the nine questions that came back are dated 9 October 2026.
- **Payment mode:** `PAYMENT_MODE=MOCK` throughout. No real payment, card
  capture, refund or payout happens anywhere in this work. Every booking fee
  "paid online" and every refund it mentions is simulated.
- **Binding decisions:**
  [ADR 0016](adr/0016-per-event-booking-fee-and-referral-codes.md) (the booking
  fee per event and referral codes) and
  [ADR 0017](adr/0017-paying-at-the-venue-outside-the-ledger.md) (paying at the
  venue, money at the door outside the ledger, cancelling unpaid tickets and
  passing tickets on), indexed in [`DECISIONS.md`](DECISIONS.md).

This report is written for the site's owner. It says what each of your
requests became, the decisions you took and the ones taken for you (each can
be changed), what this build cannot do honestly, and what needs your own
accounts or machines. The site calls your "platform fee" the **booking fee**
everywhere a buyer or organiser reads it, as the checkout already did; the
administrators' screens say once that it is the platform fee. Your "coupon
code" is a **referral code**, so that nobody confuses it with an organiser's
promo code.

---

## What you asked for, and what you get

### A booking fee on every paid ticket, set per event

- Buyers pay it; it is Desi-Event's money, not the organiser's. An
  administrator or super administrator sets each event's own fee — a
  percentage of the ticket price, an amount per ticket, or both — or leaves the
  site's standard fee, which is 5.90% of the ticket price after any promo
  discount plus $0.99 a ticket. An event's own fee can be at most 30% plus
  $100.00 a ticket.
- Where: the event's page under **Platform administration → Events**, section "Booking
  fee and payment". Choose "Set this event’s own fee" or "Use the site
  default", give a reason, and press "Save booking fee". The administrator
  confirms their second factor if they have not in the last ten minutes.
- It can be changed at any time: while the event is a draft, on sale, after it
  ends, even after it is cancelled. Only a deleted event cannot be changed
  (restore it first). Every change needs a reason and is listed on that page
  with who made it and when. The organiser sees the fee on their event page and
  cannot change it.
- An administrator who is a member of the organiser's own team cannot change
  that organiser's fee: another administrator has to.
- **New orders only.** A change applies to orders placed after it is saved;
  every order keeps the fee it was charged. If a buyer is part-way through
  paying when the fee changes, they are told "The booking fee changed", shown
  the new total and asked to confirm it. Nothing was charged the first time.
- **Refunding a booking fee by hand.** Under **Platform administration → Booking fee
  refunds** an administrator finds an order by its reference and refunds its
  booking fee, with a reason. The tickets stay valid and the order stays paid.
  Nobody can refund the fee of their own order, or of an order for an
  organisation they belong to.
- The standard fee itself (5.90% + $0.99) is not changed on any screen, as you
  confirmed. Its percentage is a setting on the server (`PLATFORM_FEE_BPS`);
  the $0.99 a ticket for US-dollar orders is fixed in the code's currency table
  (`packages/pricing/src/currencies.js`), so changing it is a code change (ADR
  0016).

### Referral codes that remove the booking fee

- Administrators and super administrators make them under **Platform administration →
  Referral codes**, with "Make a referral code". Each code removes the whole
  booking fee from one order — and any tax that would have been charged on that
  fee — and nothing else: never the ticket price or the tax on it.
- A code works for every event or for events you choose (up to 50), can stop at
  a date and time (typed in UTC, and labelled so), and can have a total limit of
  uses. The site can draw the code for you, in the form `XXXXX-XXXXX`, or you
  can type your own. A code can be switched off and on again; its text never
  changes.
- Buyers type it in the "Referral code (optional)" field at checkout, separate
  from the organisers' promo codes; one order can use one of each. The summary
  then shows "Booking fee waived (referral code)", and the buyer's order page
  says "Booking fee waived with a referral code." Organisers are never shown
  which code was used.
- Every code records the administrator who made it and every order that used
  it. The referral codes page lists, by administrator, how many orders their
  codes were used on and how much booking fee they waived; each code's page
  shows the uses placed, the uses given back and the uses that count now.
- **A use comes back** when the order that used it is refunded in full or
  cancelled — by the organiser, by Desi-Event, because its payment failed or its
  unpaid tickets were cancelled, or because its event or night was called off.
  It comes back once, and never below zero. A partial refund keeps the use.
- An administrator cannot use their own code. Nobody is paid for referrals:
  paying administrators needs real payments, which this build does not have.
- Guessing: every code that does not apply gets the same answer, whatever the
  reason. After 10 wrong codes in 10 minutes from one account, or 30 from one
  address, further codes are refused for the rest of those 10 minutes.

### Paying at the venue

- An administrator or super administrator switches it on for an event, in the
  same "Booking fee and payment" section, with "Turn on paying at the venue",
  a reason, and the most tickets that may be waiting to be paid at the door at
  one time, across all buyers. There is no limit per buyer, as you answered.
  An unpaid ticket whose night is over still counts against this limit (see
  "What this build cannot do honestly").
  "Save limit" changes the number; "Turn off paying at the venue" stops new
  bookings of this kind and leaves the existing ones as they are. An online
  event has no venue, so it is not offered there.
- Buyers, signed in, then choose "Pay by card now" or "Pay at the venue".
  Paying at the venue means:
  - the booking fee is paid online now (simulated here, like every payment), or
    nothing online at all when a referral code removes it;
  - the ticket price is paid at the door — in cash, or however the organiser
    takes payment there; the site records the amount, not how it was paid;
  - **no sales tax is added to those tickets or to their booking fee**.
- **At the door**, the steward's screen says "Take $30.00 for this ticket
  before letting them in." and one button records the payment and lets the
  ticket in, in one step ("Payment taken: $30.00 — admit"). A ticket that owes
  money lets nobody in until then. Taking the payment and letting the ticket in
  cannot be undone, as letting a ticket in cannot be today. Several tickets of
  one booking can be paid for and let in together with the booking's group
  pass; the screen adds up what to take for the tickets ticked.
- **Passing a ticket on** works like any other ticket, as you answered. What is
  due stays with the ticket: whoever holds it pays at the door, and the door
  shows how much. The person passing it on is told before sending; the person
  receiving it is told the amount before accepting — in the invitation email,
  or by the sender, whose screen shows "Tell them: whoever holds this ticket
  pays … at the door." when the code is handed over in person — and again after
  accepting. A ticket already let in cannot be passed on.
- **The organiser's "Payments at the venue" page** (from their event page, for
  the organisation's owners, administrators and finance members) lists every
  payment taken at the door, every booking still unpaid, and every unpaid
  ticket cancelled. It is the organiser's own count: Desi-Event does not hold
  that money. **A cancelled or deleted event owes nothing at the door**: its
  bookings are not counted as unpaid there or in the analytics, and the
  buyer's order reads "Cancelled — nothing to pay".
- **Unpaid tickets** can be cancelled by the organiser (an owner or
  administrator of their team) or a Desi-Event administrator, at any time while
  the event is live and until the ticket's night is over (for an event with no
  nights listed, until the event ends). On the "Payments at the venue" page,
  "Cancel unpaid tickets…" opens a list of that booking's unpaid tickets, all
  ticked, with a reason to give; administrators find the same list from the
  event's "Bookings waiting to be paid at the door" link. Each cancelled
  ticket's place — reserved seat or general admission — is freed and sells
  again whenever sales for it are open; the screen says plainly when sales are
  closed or paused. Nobody owes its price any more. **Desi-Event keeps the
  booking fee paid online for it**, as you asked. The rest would be the tax on
  that fee, which is nothing, because the online booking fee of a
  pay-at-the-venue booking carries no tax (your answer to question 9) — so
  nothing is refunded. The buyer, and anybody a cancelled ticket was passed to,
  is told why, with the reason given: the buyer on their order page, whoever
  holds the ticket on its wallet card and page. Nothing is cancelled
  automatically, and a buyer who does not come gets nothing back: their booking
  fee is kept.
- **Card payments** keep today's tax: zero for events in the US, because US
  sales tax is not worked out by this site. "No tax at the venue" was checked on
  a test event in Ontario, Canada, where the demonstration tax is 13%: by card
  the buyer pays the tax on the tickets and the booking fee; at the venue they
  pay none.

### What Desi-Event's books record

- The booking fee paid online is recorded in the platform's ledger as platform
  revenue, as card orders' fees always were. A waived fee is not recorded as
  money at all.
- Money taken at the door is never in the ledger, in payouts or in refunds: it
  never passes through Desi-Event. Keeping it out stops anyone mistaking it for
  money the platform holds and paying it out.

## What this build cannot do honestly

- Desi-Event does not hold money paid at the door and cannot refund it. When
  such an order is refunded, its night is called off or its event deleted, the
  booking fee is refunded (simulated); when its event is cancelled, a refund of
  the booking fee is asked for, and it is sent (simulated) once someone who may
  approve refunds approves it. Either way the organiser must return the money
  taken at the door. When a passed-on ticket was paid at the door by its new
  holder, that money is the organiser's to return as well; if the event or
  night is called off, both the buyer and that holder are told so.
- The site adds no tax to tickets paid at the venue; the organiser may still owe
  sales tax on those sales.
- Payments are simulated (no Stripe); referral rewards are not paid to anyone.
- A booking to pay at the venue holds its places until its night ends or until
  the organiser or Desi-Event cancels its unpaid tickets; nothing releases it
  automatically. Anyone, with a single account, can book up to the event's
  limit without paying the ticket price, and with a referral code without
  paying anything online; the event's limit, and cancelling, are what bound
  that.
- An unpaid ticket whose night is over still counts against the event's limit
  and can no longer be cancelled, so on an event with several nights the
  no-shows of earlier nights reduce what later nights can book until an
  administrator raises the limit (decision J below).
- When an order is refunded, reserved seats go back on sale (except in the 24
  hours before the event, when a refunded seat is held back) but
  general-admission places do not — as for every refund on the site today.
  Cancelling unpaid tickets is the one action that puts general-admission
  places back.
- A booking fee kept when unpaid tickets are cancelled cannot be refunded
  afterwards, even by an administrator.
- Buyers cannot cancel their own bookings, paid or unpaid, as today.
- If a card payment is still going through when its event is cancelled and is
  completed only afterwards, the order stays paid and is not refunded
  automatically: the organisation's finance team can refund it, and deleting
  the event refunds it too (simulated here).
- Smaller things, recorded so nobody is surprised:
  - The door's "Recent" list, kept on the steward's device for that visit
    only, shows times in the device's own time zone; every other new screen
    names the event's time zone.
  - A booking-fee refund whose payment provider has not answered links to its
    refund page only for accounts that may read refunds (finance
    administrators and super administrators); a platform administrator sees the
    same sentence without the link.
  - On your own machine, refunding an order the development seed made —
    booking fee by hand included — answers that the refund failed, because its
    payment was never made through the running server's simulated provider.
    Place an order on the site and refund that one.

The public limitations page (`/limitations`) carries seven entries from this
work — "Refunding money paid at the venue", "Sales tax on tickets paid at the
venue", "Cancelling your own unpaid booking", "Putting refunded
general-admission places back on sale", "Changing the standard booking fee on a
screen", "Rewards for referral codes" and "Refunding a payment completed after
its event was cancelled" — and four existing entries gained a sentence: real
payments, splitting payment for a group, what a published event can change
without review, and what a deleted event keeps. The full list, word for word, is
the §Limitations table of
[`PHASE4_ONBOARDING_ANALYTICS_REPORT.md`](PHASE4_ONBOARDING_ANALYTICS_REPORT.md),
which a test holds to the page.

## Decisions taken for you (each can be changed)

### You answered

1. **How many unpaid pay-at-the-venue tickets may one account hold for one
   event?** You said: "No per-buyer limit". Built: no limit per account
   anywhere; the per-event limit an administrator sets stays.
2. **What happens to places booked to pay at the venue that are never paid, and
   to buyers who do not come?** You said: "The admin keeps the platform fee and
   rest is paid to the buyer." Built: cancelling unpaid tickets, as described
   above — places freed, the booking fee kept, nothing else to refund in this
   build; nothing automatic for buyers who do not come.
3. **Should a refunded or cancelled order give its referral code's use back?**
   You said: "Yes". Built: a full refund or cancellation gives the use back,
   once; a partial refund keeps it.
4. **Can a ticket booked to pay at the venue be passed on?** You said: "Yes".
   Built: yes, with what is due travelling with the ticket, and both people told
   the amount. (This was question 7.)

### You confirmed

5. Organisers see that a booking fee was waived by a referral code, not which
   code (question 4).
6. The standard booking fee is not set on any screen; only an event's own fee
   is (question 5). Its percentage is a server setting; its $0.99 a ticket for
   US-dollar orders is fixed in the code.
7. How administrators are rewarded for their codes is not built (question 6).
8. An event's own booking fee can be at most 30% plus $100 a ticket (question
   8).
9. A pay-at-the-venue booking pays no tax on its online booking fee
   (question 9).

### Decided for you (each can be changed)

- **A. Only cancelled unpaid tickets keep their booking fee.** We asked whether
  you meant every refund to keep the booking fee and have no answer. Every
  other refund — card orders, and pay-at-the-venue tickets refunded because the
  event or a night is called off — gives the booking fee back with the
  tickets, as today.
- **B. Who may cancel unpaid tickets:** the organiser's owners and
  administrators (the people who may refund the organisation's orders) and
  Desi-Event administrators and super administrators. Not the organiser's
  finance members (they can ask for refunds but not decide them alone), not
  their managers, event managers or door staff, and not Desi-Event finance
  administrators.
- **C. A booking fee kept this way cannot be refunded afterwards**, by any
  refund or by an administrator's booking-fee refund by hand. Say if an
  administrator should be able to give it back as a goodwill gesture.
- **D. Until when:** until the ticket's night ends (for a ticket good for every
  night, until the last night ends; for an event with no nights listed, until
  the event ends), while the event is live (published, on sale, sales paused,
  sold out or postponed). After that nothing can be cancelled and the fee stays
  kept.
- **E. A cancelled reserved seat is always freed at once**, even in the last 24
  hours before the event, when a refunded seat is held back. Freeing the place
  is the reason for cancelling, and the cancelled ticket's pass stops working.
- **F. If the online booking fee ever carries tax** (question 9), the tax on a
  fee kept this way would go back to the buyer, following your "the rest is
  paid to the buyer". Nothing is taxed today, so this cannot happen in this
  build; if question 9 changes, cancelling unpaid tickets of a taxed booking is
  refused (the organiser refunds those tickets instead) until that refund is
  built. Say if the tax should be kept with the fee instead.
- **G. An organiser withdrawing every ticket of an order** gives its referral
  use back when the order then has nothing left to refund (for example a
  booking whose fee was waived and nothing was paid online). An order with
  money not refunded keeps its use.
- **H. Buyers cannot cancel their own unpaid booking**, as buyers cannot cancel
  their own bookings today. Say if they should, and whether the booking fee
  would be kept then too.
- **I. From when:** unpaid tickets can be cancelled at any time while the event
  is live — even weeks before the doors open, when the buyer has had no chance
  to pay (payment is only taken at the door) — and the booking fee is kept then
  too. The alternative is to allow it only once the ticket's night's doors are
  open; before that the organiser would refund the tickets instead, which gives
  the fee back.
- **J. Unpaid tickets of nights that are over keep counting** against the
  event's pay-at-the-venue limit: the limit counts every unpaid ticket, whatever
  its night, and a ticket whose night is over can no longer be cancelled. On an
  event with several nights, the no-shows of earlier nights therefore use up
  places later nights could book, until an administrator raises the limit. The
  alternative is to leave tickets of nights that are over out of the count.

- **K. A refund of some tickets of a booking to pay at the venue takes the
  unpaid ones first.** A ticket good for every night is still valid after it
  was paid for at the door and let in on the first night. When the organiser
  refunds some of a booking's tickets, the tickets not yet paid at the door
  are withdrawn first; a ticket already paid for is withdrawn only when the
  refund asks for more tickets than are unpaid, and then the buyer is told the
  money they paid at the door is with the organiser. The alternative is to
  refuse a refund that would withdraw a ticket already paid at the door.

## What needs your accounts or your machines

- **Real payments:** your own Stripe account, with its Connect onboarding and
  verification, and a later change that makes live payments reachable at all.
  With real payments, the booking fee paid online for a pay-at-the-venue
  booking is charged as a platform charge and refunded without touching any
  organiser's transfer (ADR 0017). Payments here are simulated
  (`PAYMENT_MODE=MOCK`); production payments are unreachable in this
  repository, which refuses to start with a live key (`docs/PAYMENTS.md`), and
  simulated refunds return no money.
- **Sending email:** an SMTP account with a mail provider, and its settings in
  the deployment's environment. Until then tickets are passed on in `MANUAL`
  mode, and the sender tells the receiver what is due at the door.
- **Somewhere to run the site:** hosting for the web server, the API and the
  worker, with PostgreSQL and Redis beside them, an https address, and the
  secrets in that deployment's environment. Nothing in this repository deploys
  it.
- **Behind a proxy or load balancer:** set `TRAFFIC_TRUSTED_PROXY_HOPS` on the
  web server to match the deployment. Without it the server cannot tell
  visitors' addresses apart, so the budget of wrong referral codes is shared by
  everybody, and one person guessing can make codes refuse everyone for ten
  minutes (`docs/SECURITY.md`).
- **Sales tax advice:** whether an organiser owes sales tax on tickets paid at
  the door is between the organiser and their tax adviser; this site does not
  work it out or report it.

## Trying it on your own machine

`pnpm db:seed` (see `docs/development.md`) adds, beside the usual demonstration
data:

- "Navratri Night One: Garba Under the Lights" with its own booking fee of
  3.00% + $1.49 a ticket, and one order placed with it whose fee a referral
  code waived;
- two referral codes, one for every event (limit 100) and one for that event
  alone. Their texts are drawn when they are first written and are never
  printed or kept in the repository: sign in as
  `platform-admin@desi-event.example` and read them under **Platform administration →
  Referral codes**;
- paying at the venue switched on for "Dandiya Raas with a Live Dhol Ensemble"
  (Houston, on sale), with two unpaid bookings by `aarav.shah@mail.example`,
  and for "Garba Warm-Up Night" (already held), where one ticket was paid for at
  the door, one was cancelled unpaid and one was never paid.

Then, for example:

1. As `aarav.shah@mail.example`, book the Houston dandiya night: choose "Pay at
   the venue", type a referral code into "Referral code (optional)" and press
   "Apply". The summary shows the booking fee waived and the ticket price to pay
   at the door.
2. As `anjali.desai@chaniya.example` (the organiser's owner), open that event's
   "Payments at the venue" page, press "Cancel unpaid tickets…" on a booking and
   follow the dialog.
3. As the platform administrator, open the event under **Platform administration →
   Events** and use "Booking fee and payment" to change its fee or the
   pay-at-the-venue limit.

## Verification

Every step of CI's verify job was run on 13 October 2026, from 05:17 to 05:39
UTC, in CI's order, on freshly made private databases, with payments simulated
(`PAYMENT_MODE=MOCK`). The tree was commit `58ccaf0` with 93 changed files in
the working tree, the same 93 files that were then committed as `d909fdf` and
`6bf215d`. Every step passed:

- 13,829 test cases across 16 packages ran, none failed and none was skipped
  (3,866 in the API, 4,496 in the web app);
- coverage held every threshold: the API 93.28% of statements, 83.93% of
  branches, 97.5% of functions and 95.42% of lines, against 80, 75, 80 and 80;
  the web app 87.73%, 81.6%, 81.48% and 88.57%, with no threshold set;
- the database checks: 348 of 348 on a fresh database and 98 of 98 on one
  upgraded from the previous release;
- the language policy, the CI invariants, the secret scan, formatting, lint,
  the API contract (208 routes), the OpenAPI document, the browser bundle scan,
  the dependency audit ("No known vulnerabilities found"), the payment kill
  switch and the reliability smoke (holds on general admission and reserved
  seats, and check-in, each under load).

That run fixed two failures it found first: the load suite's "no overselling"
check still counted cancelled unpaid tickets as sold, and a moderate advisory
in a dependency of the sign-in tokens (fast-jwt, raised to 6.3.4). The browser
suites (Playwright) were not run in that gate.

The changes made afterwards, by the reviews of the guards and of these
documents on 13 October, were checked with the suites and checks they touch —
the full API and web suites among them — not by a second full run of the
verify job.

The final review of the door, the locks and concurrency found two more things,
both fixed. Two changes ending different orders, on different events, that
used the same referral code could block each other until the database stopped
one of them: a refund being recorded after the payment provider had already
paid it, for example, was then left to reconciliation. The code is now locked
in a way those changes do not trip over (ADR 0017 §9), and four new races prove
it. And editing or switching a referral code, revoking a ticket, and the door
now each wait a bounded time behind another change — the door at most a few
seconds — and say plainly that nothing was done and to try again.

The final review of the codes, authority, privacy and copy found two things a
buyer or an organiser was told wrongly about money; both are fixed. When a
Desi-Event administrator had already refunded a booking's fee by hand,
cancelling its unpaid tickets, or its night, told the buyer "Nothing was paid
online", and the cancel dialog said Desi-Event keeps the fee. The buyer is now
told the fee was refunded earlier (or that none of it is kept for those
tickets), "Nothing was paid online" is said only when nothing was, and the
dialog reads what of the fee the booking still holds. And when some of the
cancelled tickets had been passed on to other people, the buyer was told they
no longer owe those tickets' price too; the buyer is now told only what they
no longer owe for their own tickets, and the ones they passed on are named
apart (their holders are told separately, as before).

### The final gate and CI

The review fixes were committed as `226d75a`. GitHub's CI ran on that exact
commit (run 79) and every job passed: the verify job (policy, lint, contract,
every test suite, the build) and all seven browser suites, among them the
journeys for booking fees, referral codes and paying at the venue.

The full local gate ran on `226d75a` on 13 October 2026, from 23:17 to 23:47
UTC, on a clean tree:

- the coverage step ran 13,901 test cases across 16 packages, none failed and
  none was skipped (3,906 in the API, 4,525 in the web app);
- coverage held every threshold: the API 93.32% of statements, 83.99% of
  branches, 97.51% of functions and 95.45% of lines, against 80, 75, 80 and 80;
  the web app 87.78%, 81.66%, 81.55% and 88.62%;
- the database checks: 348 of 348 on a fresh database and 98 of 98 on one
  upgraded from the previous release;
- the contract, the OpenAPI document, the build manifest, the browser bundle
  scan, the dependency audit ("No known vulnerabilities found"), the payment
  kill switch, and the reliability smoke and the whole reliability suite.

One step did not pass: `pnpm verify`, which runs every package's suite at once,
failed three API tests while the machine was heavily slowed down (neighbouring
tests ran 10 to 30 times slower than in the coverage step minutes later). Two
were one real defect: a team invitation that waited past five seconds answered
an error (500) instead of "busy, try again", because the database library
handed back nothing instead of saying its time had run out. That is fixed in
`fbe2b9d`: team invitations and new codes for them now wait a bounded time and
answer 503 with nothing issued, and a test holds the organisation past five
seconds to prove it. The third was a test's own transaction starved of time,
with no defect behind it.
