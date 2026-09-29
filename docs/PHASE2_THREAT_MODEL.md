# Phase 2 threat model

What is worth stealing, who could try, what stops them, and — the part that
makes a threat model useful rather than reassuring — what does not.

Scope: the Phase 2 surfaces. Commerce, refunds, the ledger, transfers, payouts,
disputes, reconciliation, tickets and check-in.

---

## Assets, in the order an attacker would want them

| Asset                        | Why it is worth taking                             |
| ---------------------------- | -------------------------------------------------- |
| Money in flight              | A refund, transfer or payout redirected is cash    |
| Organiser payout destination | Change it once and every future payout follows     |
| Ticket credentials           | A bearer token. Whoever shows it gets in           |
| Buyer identity and contact   | Names, emails, order history                       |
| Inventory                    | Seats taken without paying, or resold              |
| The ledger                   | An edited ledger hides everything above it         |
| Session and step-up state    | The way to reach all of the above as somebody else |

**Not an asset, because it does not exist here:** card numbers, CVCs,
magnetic-stripe data, payment cryptograms. There is no field, no column, no log
line and no test fixture that holds one, and no code path that could receive
one. This is the single largest reduction in attack surface in the system and it
was achieved by not having the data.

---

## Actors

| Actor                              | Starts with                                          |
| ---------------------------------- | ---------------------------------------------------- |
| Anonymous internet                 | Public catalogue only                                |
| Authenticated buyer                | Their own orders and tickets                         |
| Organiser staff                    | One organisation, one role                           |
| A _different_ organisation's staff | A valid session and no business here                 |
| Door steward                       | A scanner, at one event                              |
| Platform operator                  | Broad read, narrow write                             |
| Compromised operator account       | Everything an operator has                           |
| The payment provider, spoofed      | Whatever an unverified webhook would be trusted with |
| Someone with a database backup     | Rows, without the environment                        |

---

## T1 — Redirect a payout

**Try:** send `destination`, `bankAccount` or `accountId` in a payout request.

**Stopped by:** the field does not exist. Where an organiser's money goes is a
property of their connected account, changed through onboarding with its own
step-up. A payout request that could name a bank account is the shape of every
marketplace payout fraud there has ever been, and the defence is structural
rather than a permission check — so no authorization bug can expose it.

**Residual:** an attacker who can complete Connect onboarding as the organiser
changes the destination legitimately. That defence is Stripe's identity
verification plus the `PAYOUT` step-up, and onboarding is not implemented yet
(`docs/STRIPE_CONNECT.md`), so this path is presently closed by absence rather
than by design.

---

## T2 — Refund more than was paid

**Try:** two concurrent full refunds; a refund naming its own amount; repeated
partial refunds; refund a line twice.

**Stopped by:** `Order.refundedCents + Order.refundPendingCents <= totalCents` as
a CHECK, reserved _before_ the provider is called. PostgreSQL serialises the two
requests on the row and the second violates the constraint. Amounts are derived
from the order's own unit prices — a request may name lines and quantities, never
money. A line's remaining quantity counts what has settled _and_ what unresolved
refunds have already spoken for.

**Evidence:** twelve concurrency cases in `refund-concurrency.test.js` against
real PostgreSQL, plus a load scenario.

---

## T3 — Get in without a valid ticket

**Try:** replay a screenshot of somebody's QR; forge a pass; scan a refunded
ticket; race two scanners on one pass.

**Stopped by:** the credential is an HMAC the holder cannot forge, and carries no
claims — a pass that carried its own authorisation would be a pass a determined
holder could rewrite. A transfer clears the old `credentialHash`, so a screenshot
of a ticket that has been passed on matches nothing. Admissibility is a trigger,
not a code path. The `CheckIn` unique index makes two scanners produce one row.

**Residual, stated plainly:** a screenshot of a pass that has **not** been
transferred is a working pass, exactly as a paper ticket is. Bearer tokens are
bearer tokens; the mitigation is rotation (a version bump), not cryptography.

_Extended 2026-09-29._ Three new ways through a door, each with its control:

- **A group pass** (`G1.` QR or `DEG-` printed code) admits every ticket on an
  order that its buyer still holds, each exactly once through the same
  `CheckIn.ticketId` unique index. It is derived under its own purpose, stored
  as digests only, drawn only for the order's buyer, and replaced by a version
  bump. A confirmation that finds any named ticket changed admits nobody
  (`GROUP_CHANGED`), and `desi_check_in_group_pass_matches` refuses a group
  admission of a ticket on another order or no longer held by the buyer.
  **Residual:** a screenshot of a group pass admits the buyer's remaining live
  tickets on that order until it is replaced.
- **A platform super administrator** may admit at any event (ADR 0007). Each
  platform lookup and admission is written to the event's own audit trail, the
  role is re-read inside the admitting transaction, and every other platform
  role is refused and audited. **Residual:** a compromised super-administrator
  account can admit holders of real tickets anywhere — as it could already by
  putting an account it controls into the organisation.
- **A handed-on reserved seat** (ADR 0006): the partial unique index
  `Ticket_eventSeatId_live_key` allows one live ticket per seat, and acceptance
  and refund lock the order line in turn, so a refunded predecessor cannot leave
  a live successor admitting.

---

## T4 — Read or change another organisation's data

**Try:** a valid session in organisation A, an id from organisation B.

**Stopped by:** every organisation capability is asserted **with** an
organisation id taken from a declared request field. The NF-05 regression test
walks the whole contract and fails any route that asserts an organisation
capability without a `capabilityScope`, because unscoped it inverts into a
platform check — refusing every organiser and passing every platform admin,
silently.

**Evidence:** two of the four browser refusal journeys drive a real browser as a
member of another organisation and observe the refusal, rather than asserting a
403 in an API test.

_Extended 2026-09-29._ **Try:** create an organisation that is already verified,
or name yourself its owner in another's; reach another organisation's promo
codes, pictures or group passes. **Stopped by:** organisation self-creation takes
five fields and strips the rest — verification, suspension, payout currency,
contact address and owner are set by the server, and a new organisation cannot
publish or be paid until a moderator verifies it. Promo-code routes assert
`promo:manage` with the organisation named in the path; picture routes assert
`event:update` or `event:view_draft` on the event's own organisation and answer
404 to anybody else; a group pass answers its order's buyer and nobody else.

---

## T5 — Forge a provider callback

**Try:** POST a `payment_intent.succeeded` for somebody else's order.

**Stopped by:** signature verification over the **exact bytes received**, before
parsing — a signature over a re-serialised body is a signature over something
else. Storage is idempotent on the provider's event id via a unique index, so a
replayed genuine delivery changes nothing after the first.

**And:** a browser redirect is never proof of payment. Fulfilment is driven from
the callback and from nothing else, so forging the redirect achieves nothing.

---

## T6 — Make an operator do the work for you

**Try:** create a plausible ambiguity, then get an operator to resolve it your
way.

**Stopped by:** an operator cannot set a status. There is no route that takes
one. They can ask the provider again and apply what it said, through the same
domain commands the ordinary path uses. A resolution the provider's answer does
not support is refused at the route: `CONFLICT` and `UNKNOWN` map to the empty
list of permitted resolutions.

**Residual:** a compromised _platform_ account with `reconciliation:manage` can
re-query and resolve genuinely ambiguous items. It still cannot invent a
provider answer, and every action is audited inside the transaction that made
it.

---

## T7 — Edit the ledger to hide it

**Try:** update a posted batch; delete entries; adjust a total.

**Stopped by:** `desi_ledger_batch_immutable` and `desi_ledger_entry_immutable`
refuse the `UPDATE`. `desi_ledger_batch_balance` refuses a posted batch whose
debits and credits disagree. Correction adds a `CORRECTION` batch pointing at the
original; history gains a row and never loses one.

**Detection:** `findImbalances` looks for a posted batch with no entries, entries
that do not balance, and entries disagreeing with the batch's own columns —
which are respectively "entries were lost", "the constraint was bypassed" and
"entries were written outside the batch that owns them". It runs above the totals
on the finance screen, and the load suite runs it against the database after
every scenario.

---

## T8 — Take inventory nobody paid for

**Try:** concurrent holds on the last seat; a hold on another event's ticket
type; hold, then change the price.

**Stopped by:** conditional `UPDATE` with an affected-row-count comparison — the
universal primitive here, and the reason nothing reads a count and then writes
one. Cross-entity coherence is five triggers refusing rows whose foreign keys
point at different events or sessions. Prices are an order-time snapshot, so a
later price change cannot alter what somebody owes.

**Evidence:** the seated-checkout races, plus two load scenarios asserting
against the database that no tier oversold and no seat carries two live tickets.

_Extended 2026-09-29._ **Try:** spend a promo code with one use left from many
checkouts at once; hold seats past their tier's limits; keep seats held by an
abandoned checkout. **Stopped by:** the code is locked for the rest of the
checkout and re-checked under the lock, with a CHECK keeping redemptions within
the cap (`promo-redemption-integration.test.js`); a seat hold is all or nothing,
held to each tier's minimum and maximum, and the quote and the charge are one
function, so the order is refused with `PRICE_CHANGED` rather than charged a
different total; releasing a hold, the expiry sweep and a lapsed-hold reclaim
now free their seats, except while an order is still waiting on that hold's
payment (`seat-purchase-integration.test.js`). **Residual:** the checkout quote
tells a signed-in buyer whether a code exists but has ended, which also tells
somebody guessing codes; it is limited to 30 quotes a minute per account.

---

## T9 — Escalate to a privileged role

**Try:** grant yourself a role; use a session that predates losing one; reach a
privileged route without a second factor.

**Stopped by:** role changes need `SECURITY_ROLE` step-up (two minutes) and
**rotate or revoke the affected sessions** — finding NF-10, so a privilege taken
away is taken away from the tab that already has it. A privileged actor with no
verified factor cannot reach a guarded route (NF-12), and the exemption list is
asserted by a test to contain only enrol/self-read/sign-out routes.

_Extended 2026-09-29_, for the routes that now grant roles:

- **Platform roles** change only through `platform:admin` plus a
  `SECURITY_ROLE` step-up and a written reason, never on the caller's own
  account, with every super administrator locked so the last one cannot be
  removed (422 `LAST_SUPER_ADMIN`) and two cannot demote each other at once.
  The direct membership grant has the same rules, can grant OWNER to rescue an
  organisation with none, and refuses a suspended account.
- **Creating an organisation** makes the creator OWNER, a privileged role: their
  other sessions end, the current one is shortened, and nothing works until a
  second factor is set up. Limited to three a day per account.
- **Accepting a team invitation** needs the caller to be signed in as the
  invited address, and ends their other sessions. A member cannot invite
  somebody to a role carrying powers they lack, and OWNER cannot be invited.
- **Handing on ownership** is one swap under the owner locks; the new owner's
  sessions all end.
- Every one of these ends sessions with the reason `role_changed` and is
  audited.

**Residual:** this build sends no email, so an account's address is not
confirmed. Somebody who obtains an invitation code and registers the invited
address first can accept it (ADR 0008). Codes are single-use, expire and are
audited on acceptance; an owner can remove the member.

---

## T10 — Learn the server's shape from the browser

**Try:** read the bundle for field names, schemas, capability names, error
catalogues.

**Stopped by:** allow-list presenters, a response schema that strips unknown
keys, and a generated route manifest carrying a path, a method and two booleans
(NF-23). `scripts/scan-browser-bundle.mjs` runs in CI over every
browser-deliverable artefact.

**The rule when it fires:** remove the browser's dependency on the thing. Never
delete the needle — with one qualification the closeout cycle earned twice. A
needle may be _retargeted_ when it cannot express its property: two of them
named strings that are members of published **request** schemas, which a screen
issuing that command must name, and a string scan cannot tell that from the
stored value coming back. Both were replaced with names that appear in no
schema, and the reasoning is written beside them in the scan script. Neither was
removed to obtain a green run, and the distinction is the whole of the rule.

---

## T11 — Steal the database

**Try:** obtain a backup.

**Gets:** order history, buyer names and emails, the ledger. **Does not get:**
card data (never present), passwords (scrypt), session secrets (sealed), ticket
passes (SHA-256 digests only), transfer tokens (digests only).

_Extended 2026-09-29._ Also **gets**: guests' names on tickets, and the event
pictures, whose bytes are in `MediaBlob` — already public for an approved
picture, stripped of camera and location details for all of them. Also **does
not get**: group passes and their printed codes (digests only) or team
invitation codes (digests only).

**The stated limit:** ticket passes and session sealing defend against somebody
with the database _without_ the application's environment. Somebody with both
can derive passes. That is the boundary, and it is written in the modules
themselves rather than implied.

---

## T12 — Corrupt an export

**Try:** name a ticket type `=HYPERLINK(...)` and wait for somebody to export
and open it.

**Stopped by:** every CSV cell beginning `=`, `+`, `-`, `@`, tab or carriage
return is prefixed with an apostrophe. The value is **never stripped**, so a
ticket type genuinely called `-Premium` still reads correctly — a stripping
implementation would silently corrupt real data while defending against this.
Columns are an explicit allow list, so an export cannot widen because a model
gained a field.

---

## T13 — Turn on live payments

**Try:** set `PAYMENT_MODE=live`; supply a live key; mix test and live keys;
set a mode in a `NEXT_PUBLIC_` variable.

**Stopped by:** each of those **refuses the boot**, in any mode. A
browser-readable variable is not authority. Credential values never leave the
gate module, and the resolved credentials hang off the result as a
non-enumerable property so logging or serialising the resolution cannot leak
them.

**Asserted by:** `payment-kill-switch.test.js`, run in CI as its own named step
so a failure is unmissable. Plus a contract test that no request schema anywhere
has a field matching `paymentmode|livemode|stripemode`.

---

## T14 — Smuggle something in a picture

_Added 2026-09-29._ **Try:** upload an SVG or HTML page named `cover.png`; a
valid picture that is also a ZIP or a script; a photo carrying GPS coordinates;
a small file declaring an enormous image; a flood of uploads.

**Stopped by:** the format is decided by the bytes (JPEG, PNG, WebP only); each
file is rebuilt from an allow-list of its format's structures, so metadata,
comments, thumbnails and trailing data are not copied; dimensions are read from
the header and no pixel is decompressed; bodies are capped at 10 MiB while they
are read, uploads at 20 per ten minutes per account and storage at 1 GiB per
organisation; a moderator approves every picture before it is public; pictures
are served with `nosniff` and a sandboxing CSP. Full table: `docs/SECURITY.md`,
"Uploaded pictures", and ADR 0009.

**Residual:** no antivirus engine and no pixel re-encoding. A decoder flaw in a
viewer's browser triggered by valid pixel data is not prevented, and a
taken-down picture can stay in caches for up to a day.

---

## What this model does not cover

Named rather than omitted:

- **Denial of service.** Rate limiting exists on the surfaces where guessing
  pays. There is no capacity plan, no autoscaling and no DDoS posture, and the
  load suite explicitly does not measure capacity
  (`docs/LOAD_AND_CAPACITY.md`).
- **Supply chain.** Versions are pinned and the lockfile is committed. There is
  no SBOM, no dependency signing and no automated advisory gate.
- **Infrastructure.** No production deployment exists, so network segmentation,
  secret management at rest, and host hardening are out of scope rather than
  solved.
- **Insider threat at the platform level.** A compromised operator account is
  modelled (T6); a malicious operator with database access is not, and the
  honest control there is the append-only ledger and the audit log, not
  prevention.
- **Detection and response.** There is no alerting, no paging and no log
  shipping. `docs/SECURITY.md` says what evidence exists to respond _with_; it
  does not claim anybody is watching.
- **Anything exercised against real Stripe.** EXTERNAL VERIFICATION PENDING
  throughout.

---

## Findings this model has already produced

The controls above are not hypothetical; several exist because something got
through:

| Finding | What it was                                                                               |
| ------- | ----------------------------------------------------------------------------------------- |
| NF-04   | An `OrderItem` could reference another event's `TicketType`                               |
| NF-05   | An organisation capability asserted without an organisation                               |
| NF-10   | A session outliving the privilege it was granted under                                    |
| NF-11   | A step-up window the request could influence                                              |
| NF-12   | A privileged route reachable with no second factor                                        |
| NF-23   | A browser artefact describing the server's entities                                       |
| —       | A check-in race that became a 500 at the door (1.7% of scans)                             |
| —       | A duplicate webhook that became a 500 (9 per 10-second window)                            |
| —       | An attendance row that could outlive its rollback                                         |
| —       | A client-supplied string arriving in a foreign-key column                                 |
| —       | Reconciliation evidence with no allow list, so a raw provider object would have shipped   |
| —       | Sales breakdowns carrying money past the check that withheld the totals                   |
| —       | A refund payload that never said whose refund it was, so every caller had to ask unscoped |
| —       | An analytics screen substituting your own organisation for the one the URL named          |
