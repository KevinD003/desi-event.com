# Check-in

A ticket is the one object in this application that a stranger presents at a
door and expects to be believed. Everything here is arranged so that being
believed is decided by the database rather than by whichever scanner asked
first.

---

## Check-in happens once — once each night for a ticket good for every night

Not "usually once". Three mechanisms, and each covers what the others cannot:

| Mechanism                                                                                                        | What it guarantees                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique index on `CheckIn(ticketId, eventSessionId)`, and `CheckIn_ticketId_no_night_key` for a row with no night | Two scanners racing produce **one** row per ticket per night                                                                                                                                                      |
| Conditional `UPDATE` on the ticket's status                                                                      | A ticket that admits once moves to `CHECKED_IN` exactly once                                                                                                                                                      |
| Trigger `desi_check_in_ticket_admissible`                                                                        | It locks the ticket, then refuses a row for a refunded, revoked or transferred ticket, on a night that is not the ticket's own, or a second row for a ticket that admits once — whatever the application believed |

Nights are the subject of their own section below.

That is three layers for one property, and not redundancy for its own sake: the
unique index makes the race safe, the conditional update makes the answer
correct, and the trigger makes it true for code that has not been written yet.

### The order matters, and it is the opposite of the obvious one

The `CheckIn` row is inserted **first**, while the ticket is still admissible;
the status moves after. Written the other way round, the trigger reads a ticket
that is already `CHECKED_IN` and refuses the very check-in that moved it.

The transition is then conditional on the ticket still being what it was read
as, and a failed transition **throws** rather than returns. An earlier draft
returned, which committed an attendance row for a ticket that had been revoked
in between — a person admitted against a ticket the system says was withdrawn.

---

## Nights

On an event of more than one night (`EventSession` rows), a ticket's night is
its seat's, else its tier's (`TicketType.eventSessionId`). A tier with no night
of its own is **good for every night** — the event page files it under "Every
night".

- **The door names the night.** The check-in page lists each event's nights
  (`tickets.admissionEvents` → `sessions`) and the steward picks the one they
  are admitting to — tonight's, to start with (the first night that has not ended).
  Every lookup and admission sends it (`eventSessionId`), and the preview
  reference binds it, so a confirmation cannot switch nights
  (`PREVIEW_MISMATCH`). Without a night, a lookup on such an event is refused
  `NIGHT_REQUIRED`: nothing is guessed from the clock.
- **A ticket for one night admits once, on that night.** On any other night it
  is refused `WRONG_NIGHT`, and the door says which night it is for. Admitted,
  it becomes `CHECKED_IN` as before.
- **A ticket good for every night admits once on each night.** The admission
  row carries the night; the ticket stays `VALID` (or `TRANSFER_PENDING`)
  between nights, so its pass, the wallet and the group pass keep working for
  the nights left. "Already in" means already in tonight, with tonight's time.
- **Let in on any night, it is not handed on.** A successor ticket would start
  with no admissions and could be let in again on a night this one already was.
  The offer and the acceptance check its admissions under the ticket's row lock
  (`ALREADY_ADMITTED`, `TICKET_CHANGED`), and `desi_ticket_status_transition`
  refuses the move to `TRANSFER_PENDING` or `TRANSFERRED` whatever the caller
  checked.
- **A refund still applies.** A partly used season pass can be refunded like
  any other admitting ticket; it becomes `REFUNDED` and is refused on the
  nights left.
- **Counting.** Analytics counts tickets that came through the door, not
  admission rows, so a season pass let in on three nights is one ticket.
- **The group pass** admits each ticket on the night the door names, by the
  same rules, and names each ticket's night.
- **Admissions from before admission per night** were given a night by the
  migration that brought it in (`20260929100000_check_in_per_night`): the
  ticket's own night, else the night whose window held the scan, else the
  nearest. A pass good for every night that the old rules had made
  `CHECKED_IN` at its first night is `VALID` again, so it is let in on the
  nights it has not been; each such change is in the audit log as
  `ticket.admission_night_backfilled`.
- **Events of one night, or none,** are unchanged: no night is chosen, and a
  ticket admits once.

A night is the door's word, not the clock's: a steward who picks the wrong
night is refused by every ticket for the right one, and every admission is
recorded with the night it was let in on (`CheckIn.eventSessionId` and the
`ticket.checked_in` audit row).

---

## A re-scan is a no-op that says so

Venue Wi-Fi drops. A steward taps twice because the first beep was drowned out.
Neither may produce a second check-in, and neither may stall a queue with an
error a steward has to think about.

So a repeated confirmation returns `200` with `outcome: "ALREADY_CHECKED_IN"`,
the **original** `checkedInAt`, and `checkedInByYou` — which is what the door
screen shows as _"already admitted at 19:42, by you"_ or _"… by another
steward"_. A ticket that was refunded, revoked, transferred away or cancelled is
different: that is a `409` whose `error.reason` names which, because letting
that person in is wrong rather than redundant.

### The error that made this necessary

The route originally caught Prisma's `P2002` and nothing else. The trigger
raises `P0001`, and **Prisma nests it**: the outer `error.code` is `P2039` and
the real code is at `error.meta.driverAdapterError.cause.originalCode`. So a
trigger refusal became an uncaught 500 — at a door, during admission, for 1.7%
of scans at sixteen concurrent scanners. `databaseErrorCode()` in
`apps/api/src/lib/errors.js` unwraps it, and the load suite reproduces the race.

---

## What the QR carries

The credential, and nothing else. No name, no price, no order reference, no
ticket id, no claim about what the holder is entitled to. A pass that carried
its own authorisation would be a pass a determined holder could rewrite.

The credential is **derived, not stored**:

```
credential = base64url(HMAC-SHA256(key, ticketId + ':' + version))
key        = HKDF(AUTH_SECRET, purpose "ticket-pass-v1")
```

The database holds a SHA-256 of it and nothing else, so a leaked backup is not a
set of working admissions. The server can recompute a pass for an authorised
holder at any time, so a buyer who closed the tab has not lost their ticket.
Rotation is a version bump: the credential changes, the digest changes, and an
old screenshot stops working the moment a ticket is transferred or re-issued.

**The honest limit:** this protects passes against somebody who obtains the
database _without_ the application's environment. It does not protect them
against somebody who has both.

---

## Admission: preview, then confirm

```
POST /v1/tickets/admission/preview   { credential } | { code }            → what the door needs, and a previewReference
POST /v1/tickets/check-in            { credential } | { code } + previewReference → one CheckIn, or the truth about why not
GET  /v1/tickets/admission/events                                           → where this account may admit
POST /v1/tickets/admission/group/preview  { credential } | { code }         → the group, each ticket's outcome, a previewReference
POST /v1/tickets/admission/group/check-in … + previewReference + ticketIds  → each named ticket admitted once, or nobody
```

A steward sees who is in front of them before anything is written. The preview
resolves the pass or code, checks the caller against the ticket's own event,
and answers with the event, its time and timezone, the tier, the seat, the
attendee's name, whether the ticket is already in, and a closed refusal code.
It writes **no** `CheckIn`, changes **no** status and rotates **no** credential.
An admissible ticket carries a `previewReference` that lapses after two
minutes.

The confirmation presents the same pass or code again, with that reference, and
re-derives every fact inside the transaction that writes the admission. A
preview is **not** an authorisation token: a validly signed reference for a
caller who has since lost their scope admits nobody.

### Who may admit

Decided by `admissionAuthorityFor` in `packages/permissions/src/admission.js`,
read from the database on every preview and inside every confirmation:

| Caller                                  | Admits to                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| OWNER, ADMIN                            | Any event of their organisation. They can grant scopes themselves, so a scope adds nothing. |
| MANAGER, STAFF, SCANNER                 | Only events a `ScannerScope` names. No scope, no admission.                                 |
| VIEWER, EVENT_MANAGER, FINANCE          | Nothing. They do not hold `ticket:check_in`, and a scope row does not give it to them.      |
| Platform roles, including `SUPER_ADMIN` | Nothing. Door authority comes from a membership. An attempt is refused and audited.         |
| A member of another organisation        | Nothing, and they are told nothing: the same 404 as a pass that does not exist.             |

_Corrected 2026-09-29._ The platform row above is the rule until ADR 0007. The
rule now:

| Caller                                  | Admits to                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform `SUPER_ADMIN`                  | Any event, on `PLATFORM_ROLE` authority — but only when no membership or scope gives it one, so a super administrator who is also OWNER is recorded as OWNER. |
| `SUPPORT`, `MODERATOR`, `FINANCE_ADMIN` | Nothing. A 403 before any lookup, and the attempt is audited against the account with `PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY`.                                  |

A platform admission is recorded apart from an organiser's: every platform
lookup and admission writes `ticket.admission_platform_authority` on the
**Event**, and the `ticket.checked_in` row carries `authority: 'PLATFORM_ROLE'`,
the role and the event's `organizationId`. The platform role and `suspendedAt`
are re-read from the `User` row inside the confirming transaction, so a super
administrator demoted since the preview is refused. A second module-load
assertion, `assertPlatformAdmissionPolicy`, throws if any platform role other
than `SUPER_ADMIN` gains `ticket:check_in`, or if `SUPER_ADMIN` stops holding
`platform:admin`. For a super administrator, `GET /v1/tickets/admission/events`
lists every organisation's current door events, filterable by organisation and
by a search of the event title or organisation name, cut at the 100 that start
soonest with `meta.truncated` saying so.

_Corrected 2026-10-16._ ADR 0018: the platform administrator, `ADMIN`, admits
on `PLATFORM_ROLE` authority exactly as `SUPER_ADMIN` does, recorded as `ADMIN`
on the event's record and on the admission's; `assertPlatformAdmissionPolicy`
requires exactly `ADMIN` and `SUPER_ADMIN` to hold `ticket:check_in`, and both
to hold `platform:admin`. ADR 0019: a STAFF or SCANNER team invitation names the
events it will admit at (`eventIds`), and accepting it makes them the new
member's `ScannerScope` rows in the same transaction. An owner or administrator
may name any of the organisation's events, a manager only those it is scoped to
itself. The organisation that holds imported events takes door scanners,
invited by a platform administrator, and refuses every other role.

STAFF and MANAGER hold `ticket:check_in` only because they inherit SCANNER.
Before this work that inheritance was the whole check, so a STAFF member could
admit to every event the organisation ran. A module-load assertion now refuses
a role table in which any role holding `ticket:check_in` is not classified as
exactly one of the two groups.

### Resolve first, authorise second

The ticket is resolved from what was presented, and its event and organisation
are read from the database. Only then is the caller's authority checked —
against that event, never against an event id the browser sent. An
`expectedEventId` from the browser is compared afterwards and produces a
`WRONG_EVENT` refusal; it never grants anything. A caller not authorised for the
ticket's event receives the same 404, byte for byte, as a caller who presented
nothing real. Before this work an unknown pass answered 404 and a real one 403 —
with the owning organisation in the message.

### Locks, in one order everywhere

> **Corrected 2026-10-09.** Paying at the door changed the first locks: a
> confirmation now takes the door's night, the order and the ticket's order
> line before the ticket ("Paying at the door — 2026-10-09", below, and ADR 0017
> §9). The rest of this section stands.

The confirmation locks the ticket row, then the caller's membership, then the
scope — `FOR UPDATE`, `FOR SHARE`, `FOR SHARE` — before reading any of them. The
team routes lock the membership before touching its scopes. So a scope
withdrawal or a member removal that is in flight holds the confirmation until
it commits, and the confirmation then sees it gone; a refund or revocation in
flight does the same through the ticket row. The real-PostgreSQL suite proves
each interleaving by holding one lock and waiting until PostgreSQL reports the
other transaction blocked on it.

A group confirmation takes the same locks after its own: the order
`FOR SHARE`, the group pass `FOR SHARE`, the named tickets `FOR UPDATE` sorted
by id, then the membership and scope `FOR SHARE`. A refund settling an order
updates the order before it touches tickets, and a pass replacement updates the
group pass, so each takes turns with a group admission rather than slipping
underneath it. A platform role is read, not locked: nothing changes a platform
role inside a transaction that also touches tickets.

Accepting a transfer and refunding an order line both lock the **order line**
(`OrderItem`) `FOR UPDATE` before they read its tickets (ADR 0006), so every
writer that changes whether a line's tickets admit follows one order: Refund,
Order, OrderItem, Tickets.

### The method is recorded, not chosen

`QR_SCAN` when the secure pass was presented, `MANUAL_CODE` when the printed
code was. The server cannot see whether a camera or a keyboard produced a
credential; what it records is which secret was presented, and the door
screen's manual mode sends only the printed code. `ASSISTED` exists in the enum
and is never written: nothing in this application implements an assisted or
override admission, and none is exposed.

### What a scanner may not decide

The request schemas are strict. A `method`, a `checkedInAt`, a `force` or an
`eventSessionId` is a 400, not a field quietly ignored. The admission instant is
the server's.

`deviceId` and `gate` are free text from the scanner, and they go into the
**audit metadata** as `scannerId` and `gate` — not into `CheckIn.deviceId`.
That column is a foreign key to a registered device, and a client-supplied
string arriving in it was a guaranteed 500 at a door.

### What is never recorded

The presented credential, the presented code, and the preview reference: not in
an audit row, not in a log line. `@desi-event/logger` redacts `credential` and
`previewReference` by key in case a handler slips.

> **Correction — 2026-09-22.** This section used to say that `code` "admits
> nobody by itself" and is "accepted only from somebody who already holds
> `ticket:check_in` in the organisation that owns the event", and that
> `checkedInAt` from a request is "accepted only as the recorded instant of an
> offline scan". The first was true of the capability and false of the scope:
> any STAFF member could admit to any of the organisation's events. The second
> let a client backdate an admission. Both are gone: authority is now the
> event-scoped policy above, and the request schema refuses `checkedInAt`.
> Offline admission is not implemented.

---

## The group pass: one QR for a party arriving together

A buyer holding two to fifty tickets on a paid order can take out one pass for
all of them, and keeps it while any one still admits. It is the buyer's alone — `Order.userId` decides, and an organiser, a
platform administrator, another account signed in with the buyer's address and
a guest order all get the same 404 as a reference nobody has used.

**What it carries.** The QR is `G1.` and 43 base64url characters, an HMAC of
the pass id and version under a key derived for the purpose `group-pass-v1`.
The printed code, for when the QR will not scan, is `DEG-` and twelve
characters from the ticket-code alphabet, under its own purpose
`group-pass-code-v1`. Neither is stored: the database keeps their SHA-256
digests and a CHECK refuses anything else. The `.` never occurs in a ticket
credential, so the door routes a scan to the right lookup by shape alone.

**What it admits is computed at every read**: the tickets on the order its
buyer still holds, minus rows a later row superseded. A ticket handed on leaves
the group when its transfer is accepted, and the recipient has their own pass,
so a screenshot of the group pass can only ever admit the buyer's own live
tickets. Replacing the pass bumps its version, which changes both the QR and the
code; each ticket's own pass is untouched.

**At the door** the preview lists every ticket in the group with the outcome a
single lookup would give, and the steward ticks who is actually there —
everybody admissible is ticked to start with. The confirmation names those
tickets (`ticketIds`):

- a ticket already admitted is reported, not refused, so a retry after a lost
  answer is safe;
- a ticket that stopped admitting for any other reason — refunded, withdrawn,
  handed on — admits **nobody**, and the answer is 409 `GROUP_CHANGED`: look
  the group up again;
- otherwise each is admitted through the same `admit()` a single ticket uses,
  exactly once — once a night for a ticket good for every night — by the unique
  `CheckIn(ticketId, eventSessionId)`, with `CheckIn.groupPassId`
  set. The trigger `desi_check_in_group_pass_matches` refuses a group admission
  of a ticket on another order, or one its buyer no longer holds.

The rest of the group can be admitted later — by the QR again or the typed
group code — as each person arrives. A new pass needs two tickets on the order
that still admit; one already taken out keeps showing on the order page while
any one of its tickets still does, so the guest who arrives last is let in the
same way as the others. When none still admits, `orders.groupPass` answers 409
`TOO_FEW_TICKETS` and `orders.rotateGroupPass` refuses the same way: a new code
could not be shown to anybody. The pass is drawn only on request, on the
order page, from a holder-only `no-store` route; the component keeps the
drawing, not the QR text, and the printed code only while the pass is shown.

---

## Transfers: an invitation, not a handover

```
VALID ──► TRANSFER_PENDING ──► TRANSFERRED   (accepted)
              └──────────────► VALID          (declined, withdrawn, or lapsed)
```

Starting a transfer **does not move the ticket**. `TRANSFER_PENDING` means
somebody has been asked; the current holder can still walk in. An invitation
nobody accepted must not leave a paying attendee at the door. What it does stop
is a second transfer starting.

On acceptance the old ticket becomes `TRANSFERRED` and its `credentialHash` is
cleared, so the old pass matches nothing. The new ticket is a new row with a new
credential at version one.

A transfer is offered to an **email address**, never a user id: the recipient may
not have an account yet, and letting a sender name an account would let them
push a ticket at somebody who never asked for one. The invitation token is
delivered out of band; the database holds only its digest, and no response ever
echoes it — a bearer secret in a response is a bearer secret in a browser cache,
a proxy log and a screenshot.

_Corrected 2026-09-29._ The paragraph above assumed a delivery provider this
build never had, so no offer could ever be accepted. Under ADR 0008, with no
provider (`DELIVERY_MODE=MANUAL`, this build) the one-time code is returned to
the sender **once**, as `data.delivery.invitationCode` in the 201 that created
the offer, `cache-control: no-store, private`, and the sender passes it on. It
is still stored only as a digest, never logged, audited or put in the
notification outbox, and never shown again; a lost code means withdrawing the
offer and making a new one. The recipient must be signed in at the offered
address to use it.

**A reserved seat goes with its ticket** (ADR 0006). The old row keeps the seat
as history, the new one holds it, and the partial unique index
`Ticket_eventSeatId_live_key` allows one live ticket per seat.

**It is not in a link either.** `/tickets/accept` takes the code as a pasted
value in a password field and sends it in a request body; the route reads no
query parameter that could carry one. A link with the secret in it would leave
that secret in the browser's history, in the next request's `Referer`, in every
proxy along the way, and in any screenshot of the address bar — and it would
still be there long after the invitation was spent. Every refusal of an
invitation reads identically, whether it expired, was withdrawn, was already
used or never existed; telling them apart tells whoever is feeding in guesses
which of their guesses was real.

### The screens

`/tickets` lists what an account holds. `/tickets/:id` shows one ticket, its
event and every transfer it has been through, and says **Admits** or **Does not
admit** in words before any colour says it. Recipient addresses are masked to
`p****a@example.com`: enough for the sender to recognise who they offered it to,
not enough for anybody to collect them.

_Corrected 2026-09-23._ Recipient addresses are now shown as their domain alone,
`••••@example.com`, to the holder who made the offer, and as `Hidden email` to
an organiser. Nothing of the local part reaches the page, not even in its
source.

**One screen renders a pass, on request, to its holder.** The ticket's own
page (`/tickets/:id`) offers **Show my entry pass** to the person holding a
ticket that admits. Pressing it fetches the credential from the holder-only,
`no-store` endpoint and draws it as a QR code on the device; the text is
encoded and dropped, never placed in the markup, an attribute, storage or the
address, and the drawing is removed when the holder hides it, leaves the page
or the page is hidden. Next to it, in plain words: whoever holds this code,
including as a screenshot, can use it once. Nothing here pretends screenshots
can be prevented. The wallet list and the organiser's view of the same page
never draw one.

> **Correction — 2026-09-22.** This paragraph said "No screen renders a pass",
> and the ticket page said the pass is "handed over once". The first became
> false with the Phase 4 QR work; the second was never true of the API, which
> derives the pass again for its holder on every request.

The same screen serves two readers, and the API branches on which: the person
holding the ticket asks whether it still gets them in, the organiser asks
whether it still should. Anybody else gets what somebody guessing identifiers
gets.

Offers lapse after **72 hours** (`TRANSFER_TTL_HOURS`). A lapsed offer returns
the ticket to `VALID`; accepting one is refused with `transferExpired`.

---

## The door screen

`/organizer/check-in`, linked from the organiser navigation for members whose
role carries `ticket:check_in` — never for a platform role, which the door
refuses. It lists what `GET /v1/tickets/admission/events` returns: the events
this account may admit to and the authority each rests on ("Assigned to this
event (scanner)", "Every event of Rangoli (owner)"). An account with none is
told so and given nothing to press.

_Corrected 2026-09-29._ The navigation now offers **Check-in** to a platform
`SUPER_ADMIN` too (ADR 0007), and to no other platform role. (_Corrected
2026-10-16:_ and to the platform administrator `ADMIN`, ADR 0018.) For a super
administrator the page adds a filter by organisation and by search text, a
persistent notice above the event picker that every lookup and admission is
recorded against their account on the event's own record, and a notice when the
list was cut at 100 events. The screen recognises a group pass — by the QR's
shape, or a typed code in the `DEG-` shape — and shows the group with a tick box
for each person; the session list names a group as "First name and N more", or
"Group pass" when nobody on it is named.

A ticket is presented by typing its printed code or by scanning its QR pass:

- **The camera** starts only when the steward presses **Start camera**. Frames
  are decoded on the device (`jsqr`, loaded only then), never uploaded or
  kept, and the camera stops — every track — when it is stopped, when the
  steward switches to typing, when the page is left or hidden. A refused
  permission, a device with no usable camera and a browser with no camera API
  each say so and point at the printed code. A QR code that is not a pass is
  reported and never sent.
- **A decode is a lookup, not an admission.** It becomes a preview; decoding
  pauses while the preview is on screen, so the same pass held in front of the
  camera is looked up once.
- **Admit** is a separate press. It is disabled while in flight, so a double
  press sends one request. An admission whose answer never arrives is reported
  as exactly that — it may or may not have admitted them — with a retry that
  cannot admit twice and says which it was.
- **No offline admission.** Offline, the screen says so and looks nothing up.
- **A slow connection keeps what was typed.** The field is usable before the
  page's script arrives; whatever was typed or chosen by then is taken up
  when it does, rather than left on screen beside a disabled **Look up**.
  Until then **Look up** is disabled, so nothing is sent early.

The pass or code in hand lives in memory from lookup to admission or clearing;
the recent list holds a name, a tier and an outcome for the session, in memory
only.

## `CHECKED_IN` is terminal

A ticket that went through the door has been used. Every later claim on it — a
refund, a transfer, a revocation — is a decision about money or about the audit
trail, not about admission, and marking an admitted ticket `REFUNDED` would
contradict the person who scanned it.

A refund of an admitted ticket is therefore a money decision recorded against
the order, and the attendance record stands. This is why the refund tests
include _a refund against a check-in, in both orders_.

---

## Revocation

`ticket:revoke`, held by an event manager, withdraws a ticket with a reason that
the holder can read. It is the counterpart to the terminal rule above: a ticket
that has not been used can be taken back; one that has, cannot.

---

## Under contention

`apps/api/tests/ticket-concurrency.test.js` runs eleven races against real
PostgreSQL, wired into `pnpm run db:verify:fresh`.
`apps/api/tests/admission-integration.test.js` adds the preview-and-confirm
workflow: eleven authorisation refusals, ten admission races (two
confirmations, two stewards, a QR scan against a typed code, a scope withdrawal,
a revocation, a refund and a transfer landing between preview and confirmation,
repeated and in-flight retries), and a deadlock check against member removal.
The load suite's **check-in concurrency** scenario previews and confirms at
sixteen concurrent scanners, alternating the secure pass and the printed code
for the same tickets, and asserts against the database that no ticket was
admitted twice.

Both were what found the nested-error bug and the ordering bug above. Neither is
reachable by a single-threaded test.

`apps/api/tests/group-admission-integration.test.js` adds twelve group cases
against real PostgreSQL: two confirmations racing on one group, a group racing
a single-ticket confirmation on an overlapping ticket, a refund and a handover
landing between preview and confirmation (`GROUP_CHANGED`), admitting two of
three and the third later by the typed code, a pass replaced mid-way, an
out-of-scope scanner and a super administrator, the trigger refusing another
order's ticket, a refund settling while a group confirmation runs, and mixed
group, single and refund traffic that never deadlocks.
`apps/api/tests/seat-transfer-integration.test.js` covers a reserved seat
through offer, acceptance, refund and check-in races. Both run in
`pnpm db:verify:fresh`.

---

## Where to look

| Question                            | File                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| What may a ticket become?           | `apps/api/src/lib/tickets.js`                                |
| Who may admit, and to what?         | `packages/permissions/src/admission.js`                      |
| Preview and confirmation            | `apps/api/src/lib/admission.js`                              |
| The group pass, and its door        | `apps/api/src/lib/group-passes.js`, `lib/group-admission.js` |
| How is a group pass derived?        | `apps/api/src/lib/group-pass-credentials.js`                 |
| How is a transfer code handed over? | `apps/api/src/lib/delivery.js`                               |
| How is a pass derived?              | `apps/api/src/lib/ticket-credentials.js`                     |
| How is a pass drawn and read?       | `apps/web/src/lib/qr.js`, `lib/qr-decode.js`                 |
| The door screen                     | `apps/web/src/components/door-workspace.jsx`                 |
| What does the database enforce?     | `packages/db/prisma/migrations/` (the trigger)               |

## Paying at the door — 2026-10-09

ADR 0017. On an event where paying at the venue is on, a ticket can owe its
share of the ticket price at the door (`Ticket.venueDueCents`). Such a ticket
lets nobody in until it is paid, and the payment is recorded only in the step
that lets it in.

### One ticket

The preview says how much to take: `payment: { dueCents, currency, paid: false,
booking: { otherUnpaidTickets, otherUnpaidCents, groupPass } }` — the rest
counts the other unpaid tickets **of the same holder** on the booking, and
`groupPass` says whether the booking's group pass covers them. A ticket paid on
an earlier night reads `paid: true` and admits normally ("Paid at the door
earlier"); a card ticket reads `payment: null`.

The steward's button reads "Payment taken: {amount} — admit" and sends
`payment: { amountCents }`. The amount must equal what the ticket owes (422
`PAYMENT_AMOUNT_MISMATCH` otherwise; no partial payments, tips or change);
without it the confirmation is refused 409 `PAYMENT_DUE`, audited as a refused
admission. With it, one transaction writes the `VenuePayment` (`via`
`DOOR_TICKET`, the door's authority and role, the night, the gate), points the
ticket at it with a conditional update (409 `PAYMENT_NOT_RECORDED` if it moved),
and admits. The result says "Payment recorded: {amount}". A confirmation
retried after a lost answer finds the ticket admitted and records nothing twice:
the ticket's payment, once set, never changes. If the server gives no answer the
steward is told to keep the money in hand and press "Retry: payment taken
{amount} — admit", which sends the same request.

### The group pass

Each line reads "Pay {amount} at the door" or "Paid at the door earlier"; a
"Payment to take" box totals the ticked tickets and the button includes it.
The confirmation sends `paymentCents`, which must equal the named tickets'
unpaid shares; one `VenuePayment` (`via` `DOOR_GROUP`) pays exactly those, and
each is admitted. Paying for a ticket that is not being let in is not possible.
The group pass covers only the buyer's own tickets: a ticket passed on leaves
the group, the preview counts it in `handedOnUnpaidTickets`, and its new holder
pays at the single-ticket door.

### Passed-on tickets

A ticket that owes a payment can be passed on (the owner's answer to question
7). What is due goes with it — a successor owes exactly what its predecessor
owed (`desi_ticket_venue_due_guard`) — and the door shows the amount for the
ticket presented, whoever holds it. Money paid at the door by a new holder is
theirs: notices about a cancelled event or night tell each holder about their
own payment.

### Cancelled unpaid tickets

A ticket cancelled because it was not paid for (ADR 0017 §5) is refused
`UNPAID_CANCELLED` — "This ticket was cancelled because it was not paid for." —
when it is looked up by its printed code, or when its pass was previewed before
the cancellation and is then confirmed; the screen's heading reads "Cancelled —
not paid". A fresh scan of its old pass answers "No ticket with that pass.", as
for every withdrawn ticket, because its credential was cleared. The database
refuses its admission and refuses a payment for it anyway.

### No undo

Recording a payment cannot be undone, as letting a ticket in cannot. The
organiser's "Payments at the venue" page lists every payment taken — when,
which night, who took it, which booking and tickets, how much, single or group —
and is what they reconcile their takings against. The site records the amount,
not how it was paid; screens say "payment taken", never "cash".

### What the database holds

- `desi_check_in_ticket_admissible` refuses an admission of a ticket that owes
  something and has no payment (`check_in_payment_due`), beside its per-night
  rules.
- `desi_ticket_venue_payment_guard`: a ticket's payment is set once, to a
  payment of its own order, only while it owes something.
- `desi_venue_payment_sum` (deferred) and, from the ticket side,
  `desi_ticket_venue_payment_sum` and `…_on_delete`: at every commit a payment's
  tickets number its `ticketCount` and their dues sum to its `amountCents`.
- `desi_venue_payment_append_only`: a payment is never edited or deleted.
- `desi_ticket_venue_cancellation_guard`: a ticket is cancelled unpaid only by a
  cancellation of its own order, while it owes something, unpaid and never let
  in, in the same change that withdraws it.

### The lock order, corrected

The confirmation's locks, single and group, are now taken in this order before
anything is decided: the door's night `FOR KEY SHARE` (when the event has
nights) → the order `FOR SHARE` → (group) the pass `FOR SHARE` → the ticket's
order line(s) `FOR KEY SHARE` → the ticket(s) `FOR UPDATE` → membership and
scope `FOR SHARE`. This replaces "the confirmation locks the ticket row first"
under "Locks, in one order everywhere" above. The night and the order come
first because a refund, a night's cancellation or a deletion that holds either
must never wait on a door that holds the ticket and waits for them. The line
comes before the ticket because a door that records a payment updates the
ticket twice, and the second update re-checks its foreign keys, taking
`KEY SHARE` on the line; a transfer acceptance locks the line before the ticket,
so taken after the ticket the two deadlocked (race test 14). Two stewards both
hold the order `FOR SHARE` and take turns on the ticket: one records and
admits, the other is told the ticket is already in. The whole law, every path's
place in it and the reasons are in ADR 0017 §9.

A confirmation waits at most four seconds for any one of those locks (and five
for any one statement): a night's cancellation or an event's deletion can hold
the night and the order for its whole budget, so a door queued behind one is
answered 503 `SERVICE_UNAVAILABLE` with `Retry-After` within moments — nobody
let in, no payment recorded — and the workspace says so in the API's words and
offers a fresh lookup (`DOOR_LOCK_WAIT` in `apps/api/src/lib/admission.js`;
tests 18 and 18b in `venue-payment-integration.test.js`).
