# Check-in

A ticket is the one object in this application that a stranger presents at a
door and expects to be believed. Everything here is arranged so that being
believed is decided by the database rather than by whichever scanner asked
first.

---

## Check-in happens once

Not "usually once". Three mechanisms, and each covers what the others cannot:

| Mechanism                                   | What it guarantees                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Unique index on `CheckIn.ticketId`          | Two scanners racing produce **one** row                                                  |
| Conditional `UPDATE` on the ticket's status | The ticket moves to `CHECKED_IN` exactly once                                            |
| Trigger `desi_check_in_ticket_admissible`   | No row for a refunded, revoked or transferred ticket — whatever the application believed |

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

The confirmation locks the ticket row, then the caller's membership, then the
scope — `FOR UPDATE`, `FOR SHARE`, `FOR SHARE` — before reading any of them. The
team routes lock the membership before touching its scopes. So a scope
withdrawal or a member removal that is in flight holds the confirmation until
it commits, and the confirmation then sees it gone; a refund or revocation in
flight does the same through the ticket row. The real-PostgreSQL suite proves
each interleaving by holding one lock and waiting until PostgreSQL reports the
other transaction blocked on it.

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

**No screen renders a pass.** A pass on a page is a pass in a screenshot, and a
screenshot of a QR code is a ticket. `GET /v1/tickets/:id` carries no
credential, no digest and no token, and a browser case asserts the markup
contains none of the three names they go by.

The same screen serves two readers, and the API branches on which: the person
holding the ticket asks whether it still gets them in, the organiser asks
whether it still should. Anybody else gets what somebody guessing identifiers
gets.

Offers lapse after **72 hours** (`TRANSFER_TTL_HOURS`). A lapsed offer returns
the ticket to `VALID`; accepting one is refused with `transferExpired`.

---

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

---

## Where to look

| Question                        | File                                           |
| ------------------------------- | ---------------------------------------------- |
| What may a ticket become?       | `apps/api/src/lib/tickets.js`                  |
| Who may admit, and to what?     | `packages/permissions/src/admission.js`        |
| Preview and confirmation        | `apps/api/src/lib/admission.js`                |
| How is a pass derived?          | `apps/api/src/lib/ticket-credentials.js`       |
| What does the database enforce? | `packages/db/prisma/migrations/` (the trigger) |
