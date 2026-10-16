# Security

What is implemented, what it defends against, and where the boundaries are. A
control described here is one you can find and run; where something is policy
without an enforcement mechanism, this document says so in those words.

---

## Authentication

**scrypt** passwords (`packages/auth/src/password.js`), from Node's own
`crypto`. Phase 1 used bcrypt at cost 10; bcrypt's work factor is time only,
which is exactly the axis a GPU is good at. scrypt is memory-hard and needs no
native dependency, which matters for the one function that must never stop
working because a build failed.

Sessions are server-side rows. The browser gets an **httpOnly, SameSite** cookie
holding a sealed session secret; a bearer token is still accepted for
non-browser clients. Cookies are `secure` outside development. A session row
carries its own expiry, enforced by a CHECK as well as by code.

**CSRF:** a double-submit token. A second, non-httpOnly cookie holds a token the
browser must echo in `x-desi-csrf`; `csrfTokenMatches` compares them in constant
time. Cookie-authenticated mutations without a matching header are refused. A
bearer-authenticated request does not need one, because it was never sent
automatically by a browser in the first place. The request's `Origin` — falling
back to `Referer` reduced to its origin — is checked as well: the double-submit
token defends against a forged form, the origin check against a browser that
would send the cookie anyway.

**Rate limiting** is global, with a tighter per-route limit on the auth
endpoints and on team invitations — the two surfaces where guessing pays.

_Updated 2026-09-29._ More surfaces now have their own budget: team invitations,
reissued codes and acceptances (10 a minute per account), organisation creation
(5 attempts an hour and 3 organisations a day per account), door lookups and
admissions, single and group (120 a minute), pass and group-pass retrieval (30 a
minute), checkout quotes (30 a minute per account), checkouts that name a promo
code (30 a minute per account, or per address for a guest), picture uploads (20 per ten
minutes, counted before the body is read) and picture reads (their own budget).
The keys are per account where a session exists, because every browser request
reaches the API through one same-origin proxy address. The table is in
`docs/api.md` ("Rate limits").

---

## Multi-factor authentication

TOTP with real recovery codes (`packages/auth/src/totp.js`). Recovery codes are
hashed, single-use, and regenerating them is itself a step-up action.

**A privileged role cannot be reached without a second factor.**
`sessionPolicyFor` returns `mfaRequired` for any privileged actor, and the auth
plugin refuses a guarded route for a privileged user with no verified factor.
That was finding NF-12: the policy existed and nothing consulted it.

The exemption list is small and is **read by a test rather than trusted**:
`security-regression.test.js` asserts that every `mfaExempt` route id matches
`^auth\.|^sessions\.` — the routes an un-enrolled privileged user must still
reach in order to enrol, read themselves, or sign out. Anything else on that
list fails CI on the day it is added.

---

## Step-up: the server owns every window

Ten named policies in `packages/auth/src/sessions.js`. A route names a policy;
it never names a number.

(That count was wrong until Phase 3 — the table held nine, and this line said
ten. Adding `PRIVACY_ERASURE` made the sentence accidentally correct, which is
the sort of thing worth saying out loud rather than letting it quietly become
true. Count from `STEP_UP_POLICIES`, not from here.)

| Policy            | Window | For                                                 |
| ----------------- | ------ | --------------------------------------------------- |
| `CREDENTIAL`      | 2 min  | Removing a factor, regenerating recovery codes      |
| `SECURITY_ROLE`   | 2 min  | Granting or removing a privileged role              |
| `PRIVACY_ERASURE` | 2 min  | Irreversibly redacting a person's personal data     |
| `FINANCE_ACTION`  | 5 min  | A refund; resolving a reconciliation task           |
| `PAYOUT`          | 5 min  | A payout, or changing a payout destination          |
| `EVENT_CANCEL`    | 5 min  | Cancelling or postponing a live event               |
| `OPERATIONS`      | 5 min  | Acting on an operational work item                  |
| `EVENT_PUBLISH`   | 10 min | Making a listing public and taking strangers' money |
| `MODERATION`      | 10 min | Approving or rejecting somebody else's event        |
| `FINANCE_VIEW`    | 15 min | Reading gross, fees, refunds and net                |

Two properties are worth more than the numbers:

**A typo'd policy name throws** rather than falling back to a default. A control
that silently became fifteen minutes would be a control that stopped working
without telling anybody.

**Windows are not client-supplied.** Finding NF-11 was a step-up age the request
could influence. `security-regression.test.js` asserts every `route.stepUp` names
a policy that exists, and that every route tagged `analytics`, `finance` or
`refunds` has one — with exactly four exemptions.

Two are provider callbacks, authenticated by signature, with nobody to
challenge. The other two are the analytics routes, and they are the more
interesting case: **a route-level step-up is a gate, and a gate was the wrong
shape here.** The guard runs before the handler and refuses the whole request,
which meant refusing every VIEWER and door steward — roles this system does not
compel to enrol a second factor — in order to protect a ledger total they were
never going to be sent. The count tier was unreachable in practice.

So the window is applied to the _branch_ that needs it, from the same
`STEP_UP_POLICIES` table the route guard reads. The property NF-11 is about is
unchanged: the window is the server's, the browser cannot see it and cannot ask
for a longer one. What changes is the consequence of failing it — the money is
withheld rather than the page refused, and `moneyWithheld` distinguishes
`CAPABILITY` (permanent) from `STEP_UP` (temporary). A test beside the exemption
proves the branch is gated; an exemption without such a test would be a hole
rather than a design.

---

## Authorization

38 capabilities, derived from the caller's `Membership` role **in a named
organisation**. Nothing is derived from a global role except the six
platform-only capabilities, listed explicitly in
`PLATFORM_ONLY_CAPABILITIES`.

> **Correction — 2026-09-21.** This paragraph read "37 capabilities" and "the
> five platform-only capabilities". Both were undercounts by one from the
> moment `retention:view` was added, and neither number is derived — they were
> restated here by hand, which is how they drifted. The figures above come from
> `ALL_CAPABILITIES.length` and `PLATFORM_ONLY_CAPABILITIES.length` in
> `packages/permissions/src/capabilities.js`; if this paragraph disagrees with
> them again, they are right and it is wrong.

The thirty-seventh is `privacy:redact`, added in Phase 3 and granted to the
organisation `OWNER` and to nobody else — the narrowest grant the table can
express, because OWNER inherits ADMIN and so granting anywhere lower would hand
it to a superset by inheritance. It is organisation-scoped rather than
platform-only, so every route asserting it names an organisation, and a
standing test in `packages/permissions/src/capabilities.test.js` asserts that
exactly one organisation role holds it. Why it is not folded into
`organization:manage` or `platform:admin`, and why a step-up window alone is not
sufficient authority for it, are in `docs/PRIVACY_AND_RETENTION.md`.

The thirty-eighth is `retention:view`, and it went the other way: it is in
`PLATFORM_ONLY_CAPABILITIES` rather than in any organisation role, because the
thing it reads is platform-wide. `RetentionSweep` has no `organizationId` and a
rehearsal counts across every tenant at once, so there is no honest per-tenant
figure to derive from it — an organisation role that could read it would be an
organiser reading counts drawn from other people's data.

That is asserted rather than reviewed for: `ORG_ROLE_CAPABILITIES` is checked at
**module load** against `PLATFORM_ONLY_CAPABILITIES`, so an organisation role
that acquired `retention:view` would fail the import of the permissions package
rather than one test that might be skipped.

It also pushes on the inversion described under NF-05 below, in the safe
direction. `sessionCan(session, capability)` with no organisation asks the
_platform_ list — which is backwards for `privacy:redact` and exactly right for
`retention:view`. The route asserts it with an empty context for that reason,
and `apps/api/src/routes/retention.js` says so at the call site.

### NF-05, and why it has a standing test

An organisation capability asserted without an organisation silently becomes a
platform check — which refuses every organiser and passes every platform admin.
The inversion is invisible in a code review and obvious in production.

So every route that names an organisation capability must also name a
`capabilityScope` pointing at the request field that carries the organisation
id, and a test walks the **whole contract** asserting it. A route added without
one fails on the day it is added, which is the only time the fix is cheap.

It has caught real regressions since: the finance and operations layouts were
written with unscoped `sessionCan` and were corrected before they shipped.

### Nothing trusts the browser

Not identity, not organisation, not role, not price, not tax, not fee, not
discount, not seat state, not payment state, not refund amount, not transfer
amount, not payout destination. Each of those is derived server-side from rows
the caller cannot write:

- A refund's amount comes from the order's own unit prices. A request may name
  lines and quantities; it may not name money.
- A payout has **no destination field at all**. Where an organiser's money goes
  is a property of their connected account.
- A hold's owner is a column with a CHECK, not a claim in a body.
- No route accepts a payment mode, and a test asserts no request schema has a
  field matching `paymentmode|livemode|stripemode`.

### Sessions rotate on privilege change

Finding NF-10. Granting or removing a role, changing a password, enrolling or
removing a factor — each rotates or revokes the affected sessions, so a
privilege that was taken away is taken away from the tab that already has it.

_Extended 2026-09-29._ Every route that can grant or move a role now does the
same, through `apps/api/src/lib/privilege-change.js` and a new revocation
reason, `ROLE_CHANGED`, which ends every session:

- **Authority gained by the caller** — creating an organisation (the creator
  becomes OWNER) or accepting a team invitation: every _other_ session of
  theirs ends, the current one is shortened to the new role's lifetime, and a
  cookie session gets a new secret. A privileged role then needs a verified
  second factor before any guarded route answers (NF-12).
- **Authority changed for somebody else** — a platform role change, a direct
  membership grant, being handed ownership: every session of theirs ends,
  inside the transaction that made the change.

### An organisation always has an owner

Four routes can take OWNER away from somebody: a role change, a removal, an
ownership transfer and the platform's direct grant. Each locks every owner
membership of the organisation `FOR UPDATE`, ordered by id, and then the target
row, and only then counts owners and re-reads the target
(`apps/api/src/lib/memberships.js`). Under READ COMMITTED, two demotions of two
different owners would otherwise each count two and both proceed, leaving none.
`apps/api/tests/platform-roles-integration.test.js` races them against real
PostgreSQL: two owners demoting each other, a removal or demotion waiting on a
transfer, a transfer whose heir is removed while it waits, and two grants to one
newcomer.

### Platform roles

Six platform roles — `ATTENDEE`, `ORGANIZER`, `SUPPORT`, `MODERATOR`,
`FINANCE_ADMIN`, `SUPER_ADMIN` — changed only by a super administrator
(`platform:admin`) through `POST /v1/platform/users/:id/role`:

- a second factor confirmed within `SECURITY_ROLE` (two minutes) and a written
  reason, recorded on the audit row;
- never the caller's own account (403), because promoting yourself is the
  attack and demoting yourself is how a platform ends up with nobody at the top;
- every super administrator is locked and the caller's role re-read before the
  change, so two administrators demoting each other at once cannot both
  succeed, and a change that would leave none is 422 `LAST_SUPER_ADMIN`;
- every session of the target ends in the same transaction.

The account search is a POST, so an email address never reaches an access log
or a browser history; it answers `no-store` and carries no credential, hash or
factor. The direct membership grant follows the same rules and refuses a
suspended account. The role tables stay on the server: the bundle scan forbids
`PLATFORM_ROLE_CAPABILITIES`, `ORG_ROLE_GRANTS` and `platform:admin` in any
browser artefact.

A platform `SUPER_ADMIN` may also admit at any event's door, recorded as its
own authority on the event's audit trail; every other platform role is refused
at the door and audited (ADR 0007, `docs/CHECK_IN.md`).

### An organisation anybody can create

`POST /v1/organizations` is open to any signed-in account, because a new
organisation starts `UNVERIFIED` and cannot publish or be paid until a
moderator verifies it. The request body has no field for verification state,
badge, suspension, payout currency, contact address, owner or creator — the
schema names five fields and strips every other key before the handler sees
it, the server sets the rest, and a contract test refuses the verification and
suspension keys in any request schema. It is limited per account (5 attempts an hour, 3 organisations a day,
the second counted with the creator's user row locked).

### Colleagues' addresses on the team list

`GET /v1/organizations/:id/members` needs `organization:view_members`, which
VIEWER holds and every organisation role but SCANNER inherits. Until the
Phase 4 work it returned every member's and every invitee's full address to all
of them, including VIEWER and STAFF sessions that need no second factor. The
server now decides, and the response schema enforces, one of two shapes:

| Caller                                     | `emailVisibility` | What each entry carries                      |
| ------------------------------------------ | ----------------- | -------------------------------------------- |
| OWNER, ADMIN, MANAGER (hold `team:invite`) | `FULL`            | `email`                                      |
| Platform `SUPER_ADMIN`                     | `FULL`            | `email` — unscoped capabilities, MFA-gated   |
| VIEWER, STAFF, EVENT_MANAGER, FINANCE      | `MASKED`          | `emailMasked` (must contain `*`), no `email` |
| SCANNER                                    | —                 | 403: no `organization:view_members`          |
| A member of another organisation           | —                 | 403                                          |

The masked shape has no `email` key at all, so an address a presenter left in
is stripped by the serializer; and `emailMasked` must contain a `*`, so a full
address put in its place is a serialization failure rather than a leak. The
forwarded-invitation refusal on `POST /v1/invitations/accept` names the
invited address masked, where it used to name it in full. Door responses carry
no address of any kind.

_Corrected 2026-09-23, first Phase 4 commit. The table and paragraph above are
left as written; they described the rule after Phase 3._ The masked form kept
the first and last characters of the local part and one `*` for each of the
rest, so it gave away the local part's length and both its ends. The owner
asked for it to go. The list now has three shapes, and none of the two without
addresses carries any part of one:

| Caller                                                                      | `emailVisibility`  | What each entry carries                       |
| --------------------------------------------------------------------------- | ------------------ | --------------------------------------------- |
| OWNER, ADMIN: `team:role_manage` through their own membership, stepped up   | `FULL`             | `email`                                       |
| The same, with no second factor confirmed in the `MEMBER_EMAIL_VIEW` window | `STEP_UP_REQUIRED` | no address field                              |
| MANAGER, EVENT_MANAGER, FINANCE, STAFF, VIEWER                              | `HIDDEN`           | no address field                              |
| Platform `SUPER_ADMIN` who is not a member                                  | `HIDDEN`           | no address field: this is not an audited path |
| SCANNER; a member of another organisation                                   | —                  | 403                                           |

- **Step-up.** `MEMBER_EMAIL_VIEW` is ten minutes. Signing in with a second
  factor counts. A `STEP_UP_REQUIRED` list is still the list, without
  addresses; a step-up and a second request show them.
- **Names.** On the two shapes without addresses, an address in a display name
  or an inviter's name is replaced with `Hidden email`, and the schema refuses
  one that gets through.
- **The forwarded invitation.** The refusal names no part of the address now.
- **Transfers.** A recipient is `••••@example.com` to the parties: four bullets,
  whatever the local part, so two recipients at one domain read the same. An
  organiser reading the ticket gets `Hidden email`. The schema accepts nothing
  else.
- **The operations queue.** No recipient in any form. An address in a stored
  error is replaced, and the schema refuses one that gets through.
- **Orders.** An organisation reading an order (`order:view`, VIEWER and up) no
  longer gets the buyer's address. The buyer's own reads do.
- **The door.** An address typed as a name reaches the door as `Hidden email`.
- **Audit rows.** A transfer's audit rows no longer copy the recipient's
  address. Audit rows are immutable and outside what a privacy redaction
  rewrites, so an address there outlived its erasure. Rows written before this
  change still hold one.
- **Logs.** The logger redacts `email`, `toEmail`, `buyerEmail` and
  `recipient`. The worker's email job keeps the recipient out of its log line,
  its result and its errors.
- **Payment metadata.** Identifiers only. It carried the buyer's address, which
  the adapters' own rule forbids.
- **Sign-in.** The form posts. It has named fields and no method, so a press
  before the page's script arrived would have put the address and the password
  in the URL.

---

## What leaves the server

**Allow-list presenters.** Every response is built field by field. The Zod
response schema strips unknown keys, so the schema _is_ a second allow list.
`security-regression.test.js` feeds each money presenter a row carrying a buyer
email, a name, a card suffix and a raw provider payload, and asserts none of it
appears in the output — the test exists because a presenter written as a spread
would pass all four through and look correct.

**The generated route manifest carries a path, a method and two booleans.**
Finding NF-23 was a browser artefact describing the server's entities. A test
walks every manifest entry and refuses any key outside
`{id, method, path, auth, body, query}`.

**`scripts/scan-browser-bundle.mjs`** runs in CI over every browser-deliverable
artefact, looking for server contract that leaked into it. When a scan has
fired, the fix has been to remove the browser's dependency on the thing — not to
delete the needle.

Twice, though, the needle itself was wrong, and both are recorded rather than
quietly deleted:

- `SETTLED_FROM_PROVIDER` stood for "the reconciliation verdict vocabulary". It
  is a member of `resolveReconciliationRequestSchema`, a **request** enum
  published in `openapi.json`, so a screen that closes an item has to name it —
  and naming it proposes nothing, because the resolve route re-queries the
  provider and refuses any closure the answer does not support. Retargeted at
  `RESOLUTIONS_FOR_VERDICT` and `compareEvidence`, which appear in no schema.
- `toEmail` stood for "the unmasked recipient of a transfer". It is a field in
  `startTicketTransferRequestSchema`, so a screen that offers a ticket must name
  it in a request body, and a string scan cannot tell that from the stored
  address coming back. Retargeted at `maskRecipient`: if the masking function
  ever reached the browser, the raw address must have reached it first. The
  masked value is asserted at runtime instead, where a value can be read.
  _Updated 2026-09-23:_ `maskRecipient` no longer exists. The needle is now
  `transferRecipient`, which replaced it, and `maskRecipient` stays a needle so
  the old masker cannot come back unnoticed.

The rule that survives both: **a needle is removed only when it cannot express
its property, and only with a replacement that can.** Neither was deleted to
obtain a green run.

Fourteen needles were added for the surfaces built in the closeout cycle: the
analytics derivations and export allow list, the reconciliation evidence allow
list and its projection, the refund allocator and state table, and every name
ticket credential material goes by — `credentialHash`, `credentialVersion`,
`mintTransferToken`, `tokenHash`.

**Reconciliation evidence is projected onto a reviewed key list.** `localState`
and `providerState` used to be `z.unknown()`, so the serialiser stripped nothing
inside them and the presenter passed both through. Every writer happened to
store a small summary; that was a habit rather than a guarantee, and one writer
replacing it with a provider's raw object would have put a card's last four
digits and a billing email onto a screen read on a shared desk. `toEvidence`
now drops keys off `RECONCILIATION_EVIDENCE_KEYS`, **and** drops an allowed key
whose value is an object or an array — an allow list of key _names_ is no
protection when `status` can hold a whole charge.

**Log redaction** is path-based (`packages/logger/src/redaction.js`) and covers
secrets, tokens, credentials, authorization headers and provider payloads.
_Updated 2026-09-29:_ it also covers `invitationCode`, `groupCode`, `codeHash`,
`promoCode`, and the guest names `attendees`, `attendeeName` and
`attendeeNames`.

---

## Payments and card data

Covered in full by `docs/PAYMENTS.md`. The three sentences that belong here:

1. Production payments **refuse the boot** rather than being disabled.
2. **No field anywhere** holds a card number, CVC, magnetic-stripe data or a
   payment cryptogram, and no code path could receive one. The PCI boundary is
   the browser's connection to the provider; this application is outside it.
3. Only `packages/providers/src/stripe.js` imports the Stripe SDK, and a test
   asserts the list has exactly one entry.

`scripts/scan-secrets.mjs` runs in CI over every tracked file.

---

## Ticket credentials

A QR pass is a bearer token, so the database holds a SHA-256 of it and nothing
else. The credential is derived by HMAC from a purpose-separated key rather than
stored, so a buyer who closed the tab has not lost their ticket and a leaked
backup is not a set of working admissions.

**The stated limit:** this defends against somebody who obtains the database
_without_ the application's environment. It does not defend against somebody who
has both. Same boundary as session sealing, same reason.

**No screen renders a pass.** A pass on a page is a pass in a screenshot, and a
screenshot of a QR code is a ticket. `GET /v1/tickets/:id` returns the ticket,
its event and its transfer history and carries no credential, no digest and no
token; three browser cases assert the markup contains none of the three names
they go by.

_Corrected 2026-09-23, Phase 3 closure audit. The paragraph above is left as
written; it described Phase 2._ Since Phase 3 (`739cc58`), one screen does
render a pass. The holder's ticket page draws it as a QR code, and only when
the holder presses **Show my entry pass**. The drawing comes from
`GET /v1/tickets/:id/pass`. It answers the holder alone, gives anyone else a
404, and is `private, no-store`.

- The component keeps the drawing and never the credential text. It drops the
  drawing on **Hide pass**, when the page is hidden, on `pagehide`, and when
  the page is left.
- The page tells the holder that anybody holding the code, a screenshot
  included, can use it to get in once. It claims no way of preventing a
  screenshot.
- `GET /v1/tickets/:id` itself still carries no credential, digest or token
  (`ticket-lifecycle.test.js`). The ticket page's markup still carries none of
  `credentialHash`, `credentialVersion` or `ticket-pass-v1`
  (`detail-transfers.spec.js`). The drawing arrives only from the pass
  endpoint, after the press.
- No end-to-end spec shows a real pass where a screenshot, trace or video
  could keep it. Either the spec file turns all three off, or the case answers
  the pass request itself. `apps/web/src/lib/e2e-pass-hygiene.test.js`
  enforces this.

**A group pass is built the same way, and kept apart.** One QR (`G1.` and an
HMAC under the purpose `group-pass-v1`) and one printed code (`DEG-` and twelve
characters under `group-pass-code-v1`) admit every ticket on an order that its
buyer still holds. Only their SHA-256 digests are stored, a CHECK refuses
anything else, and a version bump replaces both. The route that draws it
answers the order's buyer alone — every other caller, an organiser and a
platform administrator included, gets the same 404 — and is `no-store` and
rate-limited. **The stated limit:** a screenshot of a group pass admits every
live ticket the buyer still holds on that order, once each, until it is
replaced; a ticket handed on leaves the group.

**A transfer invitation is a bearer secret and is treated as one.** It is
delivered out of band, never in a response, and the screen that accepts it takes
it as a pasted value in a password field. The accept route reads no query
parameter that could carry one, because a secret in a URL survives in the
browser's history, in the next request's `Referer`, in every proxy log along the
way, and in any screenshot of the address bar — long after it is spent. Every
refusal of an invitation reads identically, whether it expired, was withdrawn,
was already used or never existed; telling them apart tells whoever is feeding
in guesses which of their guesses was real.

_Corrected 2026-09-29._ "Never in a response" was written for a delivery
provider this build never had. The next section is the rule now.

---

## Show-once codes

A team invitation and a ticket offer each mint a single-use code. With no
delivery provider (`DELIVERY_MODE=MANUAL`, this build), the code is returned to
whoever issued it, **once** (ADR 0008):

- in the 201 that minted it only, as `data.delivery.invitationCode`, with
  `cache-control: no-store, private` and `pragma: no-cache`, which the web
  proxy forwards;
- stored only as a SHA-256 digest, so it cannot be shown again to anybody —
  a lost team code is replaced by reissuing (which withdraws the old one in the
  same transaction), a lost transfer code by withdrawing the offer;
- never logged (`invitationCode` is on both logger redaction lists), never in
  an audit row (`deliveryMode` is recorded instead), never in the notification
  outbox, never in a URL;
- 43 url-safe characters, pinned by `invitationCodeSchema`, so no other value
  can travel under that name;
- drawn by one component, `one-time-code-panel.jsx`, from React state only —
  never `localStorage`, `sessionStorage` or a link — and dropped when the
  issuer says they have handed it over. An end-to-end spec that reaches one
  must turn screenshots, traces and video off (`e2e-code-hygiene.test.js`).

Naming `DELIVERY_MODE=EMAIL` with no provider **refuses to boot**, rather than
minting codes nobody can receive. (Updated 2026-10-06, ADR 0011: `EMAIL` with an
SMTP server now sends the code instead of returning it, and an organiser
invitation is a third code of the same kind; see "SMTP" below.)

The recipient must be signed in at the invited address, and every code is
single-use, expires (14 days for a team invitation, 72 hours for a ticket
offer) and can be withdrawn.

**The stated limit.** No address is ever confirmed by email (and in `MANUAL`
mode nothing is emailed at all), so registering an address is not proof of
owning it. Somebody who obtains a code and registers the invited
address before its owner does can use it. The issuer is told to pass the code
on privately; every acceptance is audited; an owner can remove a member who
should not be there. A deployment with a delivery provider (`EMAIL`) removes
the issuer as a holder of the secret but, without address confirmation, not
this.

---

## Promo codes

A promo code is a bearer discount. Making one, or resuming a paused one,
needs `promo:manage` in the organisation and a second factor within
`PROMO_ACTION` (ten minutes); pausing and deleting only reduce what is on offer
and need neither step-up. Audit rows never record a code's text, and the logger
redacts `promoCode`.

Trying codes is bounded, not prevented: the checkout quote is signed-in only and
allows 30 quotes a minute per account. The charge is the other place a code can be
tried — `POST /v1/orders` takes guests, refuses an unknown code and moves the total
for a known one before anything is written — so a checkout that names a code draws
on a budget of the same size, per account or, for a guest, per address (a hold
token is no key: anybody can mint another). A checkout with no code is never
counted. A code that does not exist and a code for
another event both answer `UNKNOWN`; a code that exists for the event but has
ended, not started, been paused or been used up says so, so that a buyer can act
on it — which also tells somebody guessing that the code exists. Redemption is
counted server-side under a row lock, so a code with one use left gives one
discount however many buyers race for it.

---

## Uploaded pictures

An organiser's cover and gallery pictures are the one place a stranger's file
becomes part of a public page. The pipeline is in [MEDIA.md](MEDIA.md); this
is the threat model it answers.

| Threat                                                                                                      | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Script in a picture.** An SVG, or HTML, renamed `cover.png`                                               | The type is sniffed from the bytes; only JPEG, PNG and WebP are accepted (415 otherwise). A body declared as anything but a picture type or `application/octet-stream` — JSON and plain text included — is 415 before it is read. No SVG anywhere: the optimiser has `dangerouslyAllowSVG: false`. Served with `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so even a picture opened directly is inert                                                                                      |
| **Polyglots.** A valid picture that is also a ZIP, an HTML page or a script, via trailing data or a comment | Each file is rebuilt from an allow-list of structures; comments, unknown segments and chunks, and anything after the end marker are not copied. A JPEG's JFIF segment is rebuilt from its fixed fields, so bytes after them are not copied either. The rebuilt file is sniffed again                                                                                                                                                                                                                                 |
| **Location and identity in metadata.** EXIF GPS, camera serials, XMP, IPTC, embedded thumbnails             | Not copied, and that includes a thumbnail inside a JFIF or JFXX segment, which can still show what a crop removed. A JPEG's orientation is rebuilt as a new EXIF segment holding that one tag. Pinned by a round-trip test that stores a camera JPEG with GPS and reads back bytes without it                                                                                                                                                                                                                        |
| **Decompression and dimension bombs**                                                                       | 10 MiB body cap, enforced while reading; 8,000 pixels a side and 40 megapixels, read from the header; no pixel data is ever decompressed on the server                                                                                                                                                                                                                                                                                                                                                               |
| **Parser bugs**                                                                                             | The sanitisers are small, pure JavaScript, bounds-checked, and refuse what they do not understand; a seeded fuzz test feeds them 500 mutated files and accepts only a clean refusal or a valid output                                                                                                                                                                                                                                                                                                                |
| **Resource exhaustion**                                                                                     | Authorisation, status, gallery room and quota are checked in an `onRequest` gate before the body is read; 20 uploads per ten minutes per person; 1 GiB per organisation; the proxy buffers at most one picture and refuses a larger body itself                                                                                                                                                                                                                                                                      |
| **A private picture leaking through a cache.** A draft's cover, or one taken down                           | Only an approved, sanitised picture of a publicly visible event is served `public`; everything else is `private, no-store`, and 404 to anybody who may not see it. A public picture read with the session cookie is `private, max-age=86400`, because that reply can carry a rotated session cookie; a refusal, a missing picture's included, is `no-store` with no entity tag. The optimiser fetches without cookies, so it can only cache public pictures. The social card fetches anonymously for the same reason |
| **Existence probing.** Guessing picture ids for unannounced events                                          | A picture the caller may not see is 404, identical to one that does not exist; ids are CUIDs; the listing route answers 404 too                                                                                                                                                                                                                                                                                                                                                                                      |
| **Pointing the server at a third party.** SSRF through an image URL                                         | There is no image URL any more: `coverImageUrl` was dropped, and a request carrying it is 400. The optimiser allows no remote host and only `/api/v1/media/**` with no query                                                                                                                                                                                                                                                                                                                                         |
| **Storage keys**                                                                                            | Never on the wire, never in a browser bundle (`scan-browser-bundle.mjs` forbids `storageKey`), never in an audit row                                                                                                                                                                                                                                                                                                                                                                                                 |

What remains, stated rather than implied:

- **No antivirus engine.** The check is structural. A moderator reviews every
  picture before it is public.
- **No pixel re-encoding.** A decoder flaw in a viewer's browser triggered by
  valid pixel data is not prevented by rebuilding the container around it.
- **A taken-down picture can linger in caches** that fetched it publicly, for
  up to the 24 hours it was served with. There is no purge.

---

## Transport and headers

The API registers Helmet, with CSP: `default-src 'self'`, `base-uri 'self'`,
`frame-ancestors 'none'`, `object-src 'none'`.

**Two directives are weaker than they should be, and are recorded rather than
glossed:** `script-src` and `style-src` both permit `'unsafe-inline'`, because
the bundled Swagger UI at `/docs` is built that way. The API otherwise answers
JSON, which no browser runs. Written here so nobody reads "CSP is configured"
as "CSP is strict".

**The web app's pages are served with no Content-Security-Policy at all.**
Helmet's policy is on the API's responses, not on the pages Next.js renders,
and a nonce-based policy for them is not built. So nothing the organiser types
may reach a page as markup. React escapes text; the one place the web app
writes raw markup is the JSON-LD block on the event and venue pages, which goes
through `serializeJsonLd` (`apps/web/src/lib/json-ld.js`). `JSON.stringify`
leaves `<` alone, so a title, a performer's name, a night's label or a venue's
name holding `</script><script>…` used to close the block and run as every
visitor, with their CSRF cookie in reach. `serializeJsonLd` writes `<`, `>`,
`&`, U+2028 and U+2029 as `\uXXXX` escapes, which leave the JSON a search
engine reads unchanged. `json-ld.test.js` fails the build when any other source
file writes raw markup or opens a script element, and both pages have a test
that renders a hostile payload to HTML and parses it back.

CORS is an explicit origin list with `credentials: false`.

---

## Audit

Every consequential mutation writes an `AuditLog` row **inside the same
transaction as the change**. An audit row that can commit separately from its
change is an audit row that can be missing for the one change somebody is asking
about.

Rows name the actor, the entity, the previous state and the request id.
Operator notes on reconciliation items **append**; they never replace.

**`AuditLog` is append-only at the database**, from Phase 3.
`desi_audit_log_immutable` refuses every `UPDATE` and `DELETE`. Until then the
claim that audit rows could not be pruned selectively was a convention — no
trigger, no constraint, no revoked grant — and a redaction implementation could
have rewritten history with no failure and no trace, which is exactly the power
an auditable redaction must not have.

One consequence, stated rather than left to be discovered: the actor foreign key
is `ON DELETE SET NULL`, so deleting a `User` is an `UPDATE` of every audit row
that person produced, and is now refused. **A person who has acted cannot be
deleted.** That is the design — erasure here is redaction, and the row survives
it — and no route has ever deleted a user.

`PrivacyAuditEvent` is a second, narrower audit table for the privacy surface,
also append-only at the database and carrying its evidence as typed columns
rather than as free-form JSON. It exists because `AuditLog` has no organisation
column and no correlation column, so the questions privacy evidence must answer
are not expressible against it.

---

## Incident response

What this repository actually supports, in the order you would use it:

1. **Establish what the system believed.** `AuditLog` for the entity, plus the
   `ReconciliationTask`'s stored `providerState` where there is one. Neither is
   editable through any route.
2. **Contain.** Revoke the actor's sessions (a role change does this as a side
   effect). Pause sales on an event; hold a payout. Both are ordinary product
   actions with their own audit rows.
3. **Establish what the provider believed.** The reconciliation re-query path,
   which never writes a status from a request.
4. **Correct money by adding to the ledger**, never by editing it. A
   `CORRECTION` batch points at the batch it compensates.
5. **Rotate.** See below.

**Not implemented, and not claimed:** alerting, paging, an on-call rota, log
shipping, a SIEM, or automated anomaly detection. This is the evidence and the
controls, not a monitored service.

---

## Key rotation

| Secret                | Rotating it                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`         | Invalidates every session and **every outstanding ticket pass**, because passes are derived from it. Not a routine operation                                            |
| Ticket credential     | Per ticket, by bumping `credentialVersion`. This is the routine one, and a transfer does it automatically                                                               |
| Group pass            | Per order, by the buyer replacing it (`POST /v1/orders/:reference/group-pass/rotate`), which bumps its version. `AUTH_SECRET` rotation invalidates every group pass too |
| Stripe API keys       | Replace the environment variables and restart; the boot gate re-validates the whole set and refuses a mixed one                                                         |
| Stripe webhook secret | Same. A secret key with no webhook secret refuses to boot                                                                                                               |
| Session cookie secret | Derived from `AUTH_SECRET` by HKDF with its own purpose label, so it cannot be produced by code deriving another purpose                                                |

Purpose separation is the load-bearing part: every derived key names its
purpose, and changing a purpose label invalidates exactly that use and nothing
else.

---

## The threat model

`docs/PHASE2_THREAT_MODEL.md` — the assets, the actors, what each could try, and
what stops them.

---

## The simulated connected-account surface — 2026-09-22

Two routes, `connect.status` and `connect.start`, both organisation-scoped under
`/v1/organizations/:id/connect`.

### Authorization

Both require `connect:manage`, scoped `params.id`. The effective holder set is
`FINANCE`, and `ADMIN` and `OWNER` through inheritance, plus `SUPER_ADMIN`
platform-wide — the capability, not a role, is what the screen filters on, which
is what keeps an owner from being locked out of a screen they are the natural
person to use. `MANAGER` and `EVENT_MANAGER` are excluded by the same
separation-of-duties rule that keeps "can publish" and "can move money" apart.

Step-up is split by tier, matching what the rest of the finance surface already
does: `FINANCE_VIEW` (15 minutes) on the read, `PAYOUT` (5 minutes) on the
action. Seven finance reads carried the first and three finance actions the
second before this surface existed; with `connect.status` and `connect.start`
the counts are eight and four. A ten-minute-old second factor reads and cannot
act, and there is a test that says so — without it the split would be a claim in
a document.

> **Correction — 2026-09-22.** This paragraph read "Eight finance reads already
> carry the first and three finance actions the second", and the two halves
> counted differently: the eight included `connect.status`, which this very
> change added, while the three excluded `connect.start`, which it added
> alongside. "Already" was therefore false of one number and true of the other.
> Counted from the contract: eight finance-tagged routes carry `FINANCE_VIEW`
> (`finance.balance`, `finance.summary`, `finance.export`, `payouts.list`,
> `payouts.get`, `transfers.list`, `disputes.list`, `connect.status`) and four
> carry `PAYOUT` (`payouts.schedule`, `payouts.send`, `payouts.reverse`,
> `connect.start`). Thirteen routes in total carry `FINANCE_VIEW` once
> non-finance-tagged ones are included, which is a different question from the
> one this paragraph asks.

An earlier draft of the design proposed a `CONNECT_ONBOARDING` step-up instead.
That is not a step-up policy: it is an `AuthTokenPurpose` lifetime
(`packages/auth/src/tokens.js:44`), `STEP_UP_POLICIES` has ten members and that
is not one of them, and because `apps/api/src/lib/register.js:75` resolves the
window at registration rather than per request, the API would not have booted.
Adding a member to `STEP_UP_POLICIES` was considered and rejected: it changes a
shared security table, and it would put one string on two unrelated controls —
the collision `packages/auth/src/sessions.test.js:343-348` already records for
`PRIVACY_ERASURE` against `CREDENTIAL`.

### Tenancy

The organisation in the path is refused with 403 whether it belongs to another
tenant or does not exist, with identical status, code and message template, so
the refusal is not an existence oracle. That is the rule for a path
organisation and **not** the rule for an identifier nested under one; a nested id
would follow `apps/api/src/routes/privacy.js:166-168` and answer a 404
indistinguishable from a nonexistent id. `ConnectedAccount` is keyed on
`organizationId` alone, so this surface has no nested subject today.

Neither body carries an `organizationId`, `actorId`, `state`, `capability`,
`stepUp` or `idempotencyKey`. The guard reads `params.id` and the writer reads
the same value — a guard on the path and a writer on the body is a cross-tenant
write. The invariant at `apps/api/tests/security-regression.test.js` that forbids
those fields is widened **by route id**, never by tag: widening to `finance` or
to `MONEY_TAGS` trips immediately on `payouts.schedule`, whose body legitimately
carries both `organizationId` and `idempotencyKey`.

### Mode boundary

Both routes refuse unless `app.payments.mode === MOCK` **and**
`providers.payments.name === 'in-memory-payments'`. See `docs/PAYMENTS.md` for
why both halves.

### Guards widened by this change

| Guard                                                 | What it did not cover before                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/browser-bundle.js`                  | The `@desi-event/schemas` barrel, which re-exports `entities.js`, `requests.js` and `responses.js` — so one status constant imported from it shipped every model's column names to the browser. The auth and inventory barrels were already forbidden; schemas was the inconsistency. |
| The Stripe host scan in `payment-kill-switch.test.js` | `connect.stripe.com`, `dashboard.stripe.com`, `js.stripe.com`, `files.stripe.com`                                                                                                                                                                                                     |
| The SDK-import check in the same file                 | `@stripe/stripe-js` and `@stripe/react-stripe-js`, both on the permitted-dependency allow-list, so a browser Stripe import was caught by nothing                                                                                                                                      |
| The presenter allow-list `it.each`                    | The connect presenter; its `NEVER` list gains the mint prefix, a requirement string and a currency                                                                                                                                                                                    |
| The audit-action source scan                          | Its pattern matched the tail of `CONNECT_AUDIT_ACTIONS.X` and demanded an `AUDIT_ACTIONS.X` that was never meant to exist. Now has a lookbehind, plus a companion scan covering the connect map by name.                                                                              |

### Reported, not repaired: the `paymentsOverride` gate bypass

`apps/api/src/app.js:87` reads `const payments = paymentsOverride ?? gated`,
which replaces the boot gate's result wholesale. The comment four lines above
claims the opposite — "The supplied resolution replaces the _result_, never the
check, and it cannot name a mode the gate would have refused" — and both clauses
are false. The only residual checks are `payments.live === true` and mode
membership, so an override carrying `live: false` and `mode: 'STRIPE_TEST'` boots
in an environment where the gate would have refused. It also passes `label`,
`message` and `credentials` through verbatim, supplying `credentials`
_enumerably_ and so defeating the non-enumerable attachment
`payment-mode.js:509-523` exists to provide against log and serialise leakage.

It is not reachable in any deployment: only an in-process `buildApp` caller can
set it, `server.js:48-57` does not, and no call site in the repository passes it.
It is recorded here rather than fixed because payment mode is a protected area
under this phase's authorisation. The repair would be to re-apply the gate to
the override rather than replace the result with it, correct or delete the
comment, and add the missing invariant to `payment-kill-switch.test.js`.

---

## Invite-only organisers, the website link and visit counting — 2026-10-06

Recorded from SPEC2 §9. The decisions are ADRs 0010–0013.

### Organiser invitations

- The code exists only in the `MANUAL` 201 body, in the administrator's page
  state until "handed over", in the recipient's password field, or in the SMTP
  message. It is never in a URL, a log, an audit row or an outbox row. Only its
  digest is stored.
- **Email ownership is not verified.** Whoever registers the invited address
  first and obtains the code can accept it. Mitigations: the code is
  single-use, bound to the address, expires after fourteen days, can be
  withdrawn, and every acceptance is audited with its inviter; the issuing
  screen tells the administrator to hand it over privately.
- Staff accounts cannot be invited or accept (422 / 403 `STAFF_ACCOUNT`).
- `organizer:invite`, `website_redirect:manage` and `analytics:view_all` are
  forbidden literals in browser bundles, like `platform:admin`; client
  components receive booleans (`browser-bundle.js`, `scan-browser-bundle.mjs`).

### Alias accounts

An ADMIN can invite a second address of their own, run an organisation from it,
and approve its events from the first account; reviewer independence cannot see
through this. Every acceptance is audited with its inviter, so a super
administrator can list the organisations created from each administrator's
invitations (the invitations list, status ACCEPTED, and the audit log).

### The review gate

`desi_event_status_requires_review` refuses any move into a public status that
did not come through APPROVED (or a platform restore). Approval names the
revision reviewed. A reviewer who belongs to the organisation is refused
`CONFLICT_OF_INTEREST`, the submitter `SELF_REVIEW`. Three source scans in
`apps/api/tests/security-regression.test.js` pin every path to "public" in
`apps/*/src`.

### SMTP

- TLS is required in production (`SMTP_SECURE` or `SMTP_REQUIRE_TLS`, refused at
  boot otherwise); certificate checks stay on.
- Credentials are redacted by the logger (`SMTP_PASSWORD`, `smtpPassword`,
  nodemailer's `auth.pass`), and nodemailer's own logger and debug output are
  off, because an SMTP transcript contains the message.
- A failed send withdraws what it issued (503 `DELIVERY_FAILED`).
- At most three codes a day reach one address, and a sender may email at most
  five ticket transfers an hour. The address's codes are counted inside the
  transaction that writes the new one, under a transaction-scoped advisory lock
  on the lower-cased address, so requests to one address that arrive together
  are counted one after another and cannot pass the cap between them.
- Sender-written text is quoted and marked as the sender's.

### Visit counting and the traffic trust chain

- The API believes `x-desi-client-address` only from
  `TRAFFIC_TRUSTED_FORWARDERS` (loopback by default). **The API port must not be
  publicly reachable** where loopback is trusted, or anybody could send the
  header.
- With `TRAFFIC_TRUSTED_PROXY_HOPS=0` behind a proxy, every visitor looks like
  the proxy, and a visitor talking to the web server directly can choose the
  address the code is made from. Dedupe and the per-visitor, per-event and
  per-process caps bound the effect, and the copy says the figures are a guide.
  The web server logs a warning in production when the hops are 0.
- No address, browser string or account is stored; the day's secret is deleted
  when the day ends. Only `lib/traffic.js` and `@desi-event/db/traffic-rollup`
  read or write raw visit rows (a source scan).

### Outbound links and the website redirect

- No open redirect: the destination is only ever the decided address of a
  publicly visible event, re-validated when decided, when read and before the 302.
- The same 404 for every refusal; 302 with `no-store, private`; prefetch and
  prerender answered 503 without a lookup; `HEAD` 405.
- Only `lib/website-redirect.js` writes the switch (a source scan). An INSERT
  could create an ON row; only seeds do, and the importer goes through
  `decideWebsiteRedirect`.
- Every decision is audited with the administrator, the reason and the address
  seen, under a MODERATION step-up.

---

## Full control of posted events and the listing import — 2026-10-06

Recorded from SPEC2-XI §10. The decisions are ADRs 0014 and 0015.

### Money

- Every refund that deletion, night cancellation or event cancellation causes
  goes through `requestRefund`'s reservation, under the order CHECK and
  `desi_refund_within_order_total`. A retry reserves again.
- A disputed payment is never refunded here (409 `PAYMENT_DISPUTED`; left to
  finance).
- Provider calls happen outside transactions.
- A whole-remainder refund returns exactly what is left of each part (face
  value, fee, tax).
- No caller chooses an amount, an order or a recipient: an administrator's
  deletion refunds are whole-order.
- **A late payment is never lost.** A success on a closed order opens a
  reconciliation task (`payment.succeeded_after_close`).

### Platform editing

- A reason, an MFA step-up, a sitting of at most 60 minutes bound to one browser
  session, and a fresh second factor every ten minutes of writes.
- The re-check reads the sitting `FOR SHARE` inside every write, and every write
  is audited with the sitting and the reason.
- Membership is read first: `ALL_CAPABILITIES` never silently edits another
  organisation's event.
- **Stated limit:** a non-member SUPER_ADMIN keeps the lifecycle moves
  (publish, sales, postpone, cancel, reschedule) without a sitting. Each is
  audited and shown as "by the team at The Desi Events".
- `event:platform_edit`, `event:platform_delete` and `event:import` are
  forbidden literals in browser bundles.

### Deletion

- The typed web address is checked on the server; the outcome is pinned by the
  request; the revision is compared; an EVENT_CANCEL step-up is required.
- Refused while a payment is in flight, including a success not yet applied.
- The lock order is Event, tiers, sessions, so deletion cannot deadlock with
  checkout or authoring.
- Tickets are withdrawn in the same transaction, and the door refuses DELETED
  events and CANCELLED nights.
- Restore is platform-only, lands on-sale events paused, and is guarded by one
  SQL function (`desi_event_restore_target`) used by two triggers.

### Pictures

An unreviewed image is never public, and the uploader never approves their own
(403 `SELF_REVIEW`). Until 2026-10-15 imported pictures were the one
exception; nothing is copied from a listing any more, so there is none.

### Imports make no outbound request (2026-10-15)

Until 2026-10-15 the importer copied pictures from the source's picture host
(`lib/import-images.js`, with its own host allow-list, address pinning and
redirect checks). The owner asked for "no contact at all", so that fetcher,
its route ("Retry pictures"), its table and its settings (`IMPORT_IMAGE_*`) are
removed, and the API has no outbound caller left to defend:

- No module under `apps/api/src` imports a network client or calls `fetch`
  (a source scan, `apps/api/tests/security-regression.test.js`, "the API has no
  way out").
- An import, from planning both committed files to approving and opening
  sales, makes no request, socket or name lookup
  (`apps/api/tests/import-no-outbound.test.js` watches `fetch`, `http`,
  `https`, `net`, `tls` and `dns`, with a control).
- An uploaded file may carry no web address and no name of the source site:
  the fields that held them (`sourceUrl`, `ticketUrl`, `images`, and the
  header's `sourceName`, `sourceSite`, `imageHosts`) are refused with a
  problem that names neither.

### Review independence for imports

- The exemption covers only imported events of an organisation with
  `platformHeldSource`. That organisation can have no members (a trigger) and
  no team invitations.
- Approval still needs `moderation:review`, an EVENT_PUBLISH step-up and the
  revision the administrator saw.
- The approve route accepts only imported events of that run in a platform-held
  organisation, so it can never publish an organiser's own event.
- Since 2026-10-15 a platform-held event's tickets are sold on The Desi Events
  (in this build, with simulated payments). Approving opens sales of the
  ticket types the import made; the platform administrators open and pause
  sales only in an audited editing session (ADR 0014), which a super
  administrator does not need; paying at the venue is refused
  (`VENUE_PAYMENT_UNAVAILABLE`), and only a super administrator admits at the
  door (ADR 0007).
- Who imported and who approved are both stored and audited. Reassignment ends
  the exemption.

### Imported data

- Stored credential-free: the dataset validator refuses email and phone
  patterns.
- No address on the source site is stored, served or followed: the datasets
  carry none, migration `20261015100000_imported_events_sold_here` cleared the
  ones stored before, and the website rule refuses that site for every event
  (`isRetiredSourceHost`, the same pattern the migration uses).

### Free text

Reasons typed when deleting, restoring, cancelling a night, opening a platform
editing sitting or reassigning are stored as typed and are not redacted by the
privacy process — on the event and night (`deletionReason`,
`cancellationReason`), its history, the sitting, the change notice, the import
record and audit metadata, on every refund a deletion or a night's
cancellation asks for (`Refund.reasonNote`), and in the notice queued for each
buyer (`NotificationOutbox.payload.reason`), which the message templates print
(not emailed by this build's in-memory provider; a real mail provider would
send it to every buyer). See
[PRIVACY_AND_RETENTION.md](PRIVACY_AND_RETENTION.md#free-text-reasons--2026-10-06).
Every such form says: "Shown with the event's history. Do not include
anybody's personal details."

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017.

### Referral codes are bearer codes

Stored in plain text, as promo codes are (ADR 0016 §4), and kept out of every
place a promo code's text is kept out of: no route takes a code in its path or
query; responses carrying one name the field `referralCode`, never `code`, and
only `referral_code:manage` responses carry it; `referralCode` is in both of the
logger's redaction lists; the `err` serialiser drops PostgreSQL's `detail` from
an error's `cause`, `meta` and driver-adapter chain, which could quote a failing
row; audit metadata records a label only as `labelSet` / `labelChanged`; no
outbox payload carries a code; nothing stores one in the browser; the browser
journeys turn screenshots, traces and video off. Buyers send a code only in the
bodies of `orders.quote` and `orders.create`, signed in.

### Guessing, and the two residuals (DR10)

Every reason a code does not apply answers the same `NOT_ACCEPTED`, after the
same queries. The control is a budget of wrong guesses only: 10 per 10 minutes
per account, 30 per 10 minutes per address (an HMAC of the address with a
process key), and, when no address is known, one shared bucket of 300 per 10
minutes that is never skipped.

- **Timing.** A guesser could still tell that a code exists, and applies to
  them, from a lock wait at the charge. The budget is what bounds it.
- **The shared bucket with no proxy named.** A production web server with
  `TRAFFIC_TRUSTED_PROXY_HOPS` 0 (or unset or unusable) forwards **no** address
  on checkouts, because without a named proxy the last `X-Forwarded-For` entry
  is one the browser chose. Every wrong code then counts in `referral:shared`,
  which one guesser can fill for everybody naming a code for ten minutes. A
  deployment behind a proxy or load balancer must set the hops to match it;
  with hops ≥ 1 the entry the nearest named proxy appended is forwarded, as for
  visit counting.

### Conflict of interest

- An administrator holding any membership in an event's organisation cannot
  change its booking fee or pay-at-the-venue switch.
- An administrator cannot refund the booking fee of their own order, by account
  or as a guest with their own address, nor of an order on an event of an
  organisation they belong to.
- A referral code's maker cannot use it.
- Unpaid tickets are cancelled on the actor's own membership first: an
  administrator whose membership in the organisation lacks `order:refund` is
  refused rather than allowed through platform authority.

The first, second and fourth are a 403 `CONFLICT_OF_INTEREST`; a maker naming
their own code gets the same `NOT_ACCEPTED` as any code that does not apply
(`apps/api/src/lib/referral-codes.js`, `applies()`), so the answer does not say
the code exists (DR10, ADR 0016 §5). Each is tested.

### Capabilities and step-up

Four platform-only capabilities join the platform administrator's allow-list,
now fourteen and still checked at load: `payment_terms:manage`,
`referral_code:manage`, `platform_fee:refund` (also FINANCE_ADMIN) and
`venue_booking:cancel`. A new step-up policy, `PAYMENT_TERMS` (ten minutes),
covers the fee, the switch and referral codes, except switching a code off; the
booking-fee refund and cancelling unpaid tickets use `FINANCE_ACTION`, and the
two reports of bookings and payments at the venue `FINANCE_VIEW`. All four
capability literals are forbidden in browser bundles; client components get
booleans. Every new route answers `no-store`.

### Source scans

`security-regression.test.js` holds the writers of every new column to their one
module (`docs/DATA_MODEL.md`, "Booking fees, referral codes and paying at the
venue"), including the one decrement of `quantitySold`; no `NOT_BUILT` stub
literal survives under `apps/api/src`; no `returnReferralUse(` exists and only
`settleReferralUsesIfEnded` gives uses back; the referral modules pass no code
or label to an audit or a log call; settlement locks its tiers before its order;
the worker's ticket issuer refuses pay-at-the-venue orders.

Widened on 2026-10-13 after the guards review:

- **Logs.** No log call in the API, the worker or the packages names a referral
  value or hands over a whole request body, and each log call in the modules
  where a buyer's code arrives (`routes/orders.js`, `lib/checkout-pricing.js`,
  `lib/checkout.js`, `plugins/rate-limit.js`) is pinned key by key.
- **Audit and outbox.** `order.paid`'s metadata and every queued notice's
  payload are pinned key by key, so a code's text under a new name fails the
  scan.
- **At run time.** `show-once-logging.test.js` sends refused codes (one nobody
  made, one switched off, one for another event; as typed, lower-cased and
  padded) through the quote and the charge and finds none in the logs. After a
  card order, a pay-at-the-venue booking and the event's cancellation, it finds
  a code's text and label in no table but the code's own row.
- **Browser.** `browser-bundle.test.js` keeps a code out of local and session
  storage, IndexedDB, the Cookie Store, the Cache API and cookies written or
  appended from script. In the modules that hold a code, it also checks every
  address-bar write (the History API, the router, `location`): none may name a
  code, and each one is listed.
- **End-to-end specs.** `e2e-code-hygiene.test.js` refuses a code-shaped
  literal that a spec types, presses or sends, however it gets there. Any spec
  that mentions a referral must turn screenshots, traces and video off; the
  limitations page's titles are the one exception.

### Free text

Reasons for a booking fee, a pay-at-the-venue change, a booking-fee refund, a
referral code switched off and a cancellation of unpaid tickets, and referral
codes' labels, are stored as typed like the reasons above, and are not redacted
(`docs/PRIVACY_AND_RETENTION.md`). The cancellation's reason is shown to the
buyer (their order page) and to each holder of a cancelled ticket (its wallet
card and page, `venuePayment.cancelled.reason`, without the name of who wrote
it); the forms say so.
