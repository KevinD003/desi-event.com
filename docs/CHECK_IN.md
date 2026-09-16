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

Venue Wi-Fi drops. A steward scans twice because the first beep was drowned out.
Neither may produce a second check-in, and neither may stall a queue with an
error a steward has to think about.

So a second scan returns `200` with `alreadyCheckedIn: true` and the
**original** `checkedInAt` — which is what a scanner app shows as _"already
admitted at 19:42"_. A ticket that was refunded, revoked, transferred away or
cancelled is different: that is a `409`, because letting that person in is wrong
rather than redundant, and the message says which of those it was.

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

## Scanning: the pass first, the code second

```
POST /v1/tickets/check-in   { credential } | { code }
```

`credential` is the primary path — the server hashes what was sent and looks up
the digest, so a scanner never transmits a guessable identifier.

`code`, the printed reference, is the deliberate fallback for a pass that will
not scan. Its schema says it "admits nobody by itself", and it is accepted only
from somebody who already holds `ticket:check_in` in the organisation that owns
the event. The capability is the authorisation; the code is only the lookup.

### What a scanner may not decide

`eventId` and `eventSessionId` are **narrowing filters**, not authority: a scan
that names the wrong event is refused rather than redirected. `checkedInAt` from
a request is accepted only as the recorded instant of an offline scan, never as
a reason to admit.

`deviceId` and `gate` are free text from the scanner, and they go into the
**audit metadata** as `scannerId` and `gate` — not into `CheckIn.deviceId`.
That column is a foreign key to a registered device, and a client-supplied
string arriving in it was a guaranteed 500 at a door. Found by writing the
load suite; fixed before it ran.

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
PostgreSQL, wired into `pnpm run db:verify:fresh`. The load suite's **check-in
concurrency** scenario runs the same property at sixteen concurrent scanners and
asserts against the database that no ticket was admitted twice.

Both were what found the nested-error bug and the ordering bug above. Neither is
reachable by a single-threaded test.

---

## Where to look

| Question                        | File                                           |
| ------------------------------- | ---------------------------------------------- |
| What may a ticket become?       | `apps/api/src/lib/tickets.js`                  |
| Who may scan?                   | `apps/api/src/routes/tickets.js`               |
| How is a pass derived?          | `apps/api/src/lib/ticket-credentials.js`       |
| What does the database enforce? | `packages/db/prisma/migrations/` (the trigger) |
