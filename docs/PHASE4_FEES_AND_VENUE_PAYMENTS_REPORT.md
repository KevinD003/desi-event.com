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
- The standard fee itself (5.90% + $0.99) stays a setting on the server: no
  screen changes it, as you confirmed.

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
  that money.
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
  is told why, with the reason given. Nothing is cancelled automatically, and a
  buyer who does not come gets nothing back: their booking fee is kept.
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
  such an order is refunded, or its event or night is called off, the booking
  fee is refunded (simulated) and the organiser must return the money taken at
  the door. When a passed-on ticket was paid at the door by its new holder,
  that money is the organiser's to return as well; if the event or night is
  called off, both the buyer and that holder are told so.
- The site adds no tax to tickets paid at the venue; the organiser may still owe
  sales tax on those sales.
- Payments are simulated (no Stripe); referral rewards are not paid to anyone.
- A booking to pay at the venue holds its places until its night ends or until
  the organiser or Desi-Event cancels its unpaid tickets; nothing releases it
  automatically. Anyone, with a single account, can book up to the event's
  limit without paying the ticket price, and with a referral code without
  paying anything online; the event's limit, and cancelling, are what bound
  that.
- When an order is refunded, reserved seats go back on sale but
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
6. The standard booking fee stays a server setting; only an event's own fee is
   set on screen (question 5).
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

To be filled in by the integrator with the gate run on the final commit.
