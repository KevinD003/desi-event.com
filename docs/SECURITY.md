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
