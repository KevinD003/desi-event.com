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

37 capabilities, derived from the caller's `Membership` role **in a named
organisation**. Nothing is derived from a global role except the five
platform-only capabilities, listed explicitly in
`PLATFORM_ONLY_CAPABILITIES`.

The thirty-seventh is `privacy:redact`, added in Phase 3 and granted to the
organisation `OWNER` and to nobody else — the narrowest grant the table can
express, because OWNER inherits ADMIN and so granting anywhere lower would hand
it to a superset by inheritance. It is organisation-scoped rather than
platform-only, so every route asserting it names an organisation, and a
standing test in `packages/permissions/src/capabilities.test.js` asserts that
exactly one organisation role holds it. Why it is not folded into
`organization:manage` or `platform:admin`, and why a step-up window alone is not
sufficient authority for it, are in `docs/PRIVACY_AND_RETENTION.md`.

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

**A transfer invitation is a bearer secret and is treated as one.** It is
delivered out of band, never in a response, and the screen that accepts it takes
it as a pasted value in a password field. The accept route reads no query
parameter that could carry one, because a secret in a URL survives in the
browser's history, in the next request's `Referer`, in every proxy log along the
way, and in any screenshot of the address bar — long after it is spent. Every
refusal of an invitation reads identically, whether it expired, was withdrawn,
was already used or never existed; telling them apart tells whoever is feeding
in guesses which of their guesses was real.

---

## Transport and headers

Helmet, with CSP: `default-src 'self'`, `base-uri 'self'`,
`frame-ancestors 'none'`, `object-src 'none'`.

**Two directives are weaker than they should be, and are recorded rather than
glossed:** `script-src` and `style-src` both permit `'unsafe-inline'`, because
Next.js's App Router emits inline bootstrap and style. Closing them needs a
nonce threaded through the framework's document, which is real work and is not
done. Written here so nobody reads "CSP is configured" as "CSP is strict".

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

| Secret                | Rotating it                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`         | Invalidates every session and **every outstanding ticket pass**, because passes are derived from it. Not a routine operation |
| Ticket credential     | Per ticket, by bumping `credentialVersion`. This is the routine one, and a transfer does it automatically                    |
| Stripe API keys       | Replace the environment variables and restart; the boot gate re-validates the whole set and refuses a mixed one              |
| Stripe webhook secret | Same. A secret key with no webhook secret refuses to boot                                                                    |
| Session cookie secret | Derived from `AUTH_SECRET` by HKDF with its own purpose label, so it cannot be produced by code deriving another purpose     |

Purpose separation is the load-bearing part: every derived key names its
purpose, and changing a purpose label invalidates exactly that use and nothing
else.

---

## The threat model

`docs/PHASE2_THREAT_MODEL.md` — the assets, the actors, what each could try, and
what stops them.
