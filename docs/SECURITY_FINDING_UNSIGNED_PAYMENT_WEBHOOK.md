# Security finding — unauthenticated order settlement via the payment webhook

**Status: CONFIRMED by regression test, then REMEDIATED.** The sections from
"Confirmation through regression test" onwards were added after the fix; §1–§8
are the pre-fix record and are left as they were written.

**Severity: CRITICAL** for any deployment reachable by an untrusted network.
The precondition is met by the attacker themselves, so this is not a
guess-the-identifier finding.

**Written before any code change**, on branch
`claude/security-payment-webhook-auth`, cut from `origin/main` at `510d75a`.

---

## 1. The route

| Field      | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Method     | `POST`                                                      |
| Path       | `/v1/payments/webhook`                                      |
| Contract   | `packages/api-contract/src/routes.js` — `payments.webhook`  |
| Manifest   | `packages/api-contract/src/route-manifest.js`               |
| `auth`     | **`none`**                                                  |
| Handler    | `apps/api/src/routes/payments.js`, `defineRoute` at :33     |
| Registered | `apps/api/src/routes/index.js:65` — mounted on the live app |

`auth: 'none'` installs **no guard at all**. `apps/api/src/lib/register.js`
pushes a guard only for `session`, `bearer` and `optional`:

```js
if (route.auth === 'session') guards.push(app.requireSession)
if (route.auth === 'bearer') guards.push(app.authenticate)
if (route.auth === 'optional') guards.push(app.optionalAuth)
```

There is no `else`. `none` falls through with an empty guard list.

## 2. What the handler trusts

Every field comes from the request body, validated by
`paymentWebhookRequestSchema` (`packages/schemas/src/requests.js:498`) for
**shape only**:

| Field             | Source           | Checked against anything? |
| ----------------- | ---------------- | ------------------------- |
| `provider`        | caller           | No — any string, 1–64     |
| `providerEventId` | caller           | No — any string, 1–200    |
| `eventType`       | caller           | Enum membership only      |
| `orderReference`  | caller           | Looked up, not authorised |
| `amountCents`     | caller, optional | **Never read**            |
| `currency`        | caller, optional | **Never read**            |

`amountCents` and `currency` are accepted and then ignored: the handler never
compares them to the order total. A caller may claim any amount, or none.

The handler performs **no** signature verification. `apps/api/src/routes/payments.js`
does not import `verifyWebhook`, and no HMAC, timestamp, nonce, shared secret,
IP restriction or server-side provider lookup appears anywhere in its path.

## 3. The settlement path

`eventType: 'payment.succeeded'` reaches `settleCheckout`
(`apps/api/src/lib/checkout.js:300`), which gates on **one** condition:

```js
const { count } = await tx.order.updateMany({
  where: { id: order.id, status: 'PENDING' },
  data: { status: 'PAID', paidAt: now },
})
if (count === 0) return { settled: false }
```

It does **not** check that a `Payment` row exists, that a payment succeeded,
that an authorisation was captured, or that any money moved. A `PENDING` order
becomes `PAID`, and then, for every order item:

- seats are sold (`sellHeldSeats`);
- a **ticket is issued per unit** (`issueTicket`), carrying a credential signed
  with `AUTH_SECRET`;
- `TicketType.quantitySold` is incremented;
- active holds are converted.

## 4. Threat model

**Attacker:** any anonymous HTTP client that can reach the API. No account, no
session, no token, no prior relationship.

**Knowledge required:** one order reference in `PENDING` state. The attacker
does not have to guess it — **they are given it.**

`orders.create` (`POST /v1/orders`) is `auth: 'optional'`, so an unauthenticated
guest may place an order. The order is created with `status: 'PENDING'`
(`apps/api/src/routes/orders.js:427`) and the response body is `toOrder(order)`,
which spreads the row and therefore includes `reference`.

**The chain, all anonymous:**

1. `POST /v1/orders` → a `PENDING` order, and its `reference` in the response.
2. `POST /v1/payments/webhook` with that reference, `eventType:
'payment.succeeded'`, any `provider`, and any previously-unused
   `providerEventId`.
3. The order becomes `PAID`; tickets are issued.

**No money moves at any point.** The attacker obtains valid tickets for free.

### Why the idempotency key does not help

Replay protection keys on `(provider, providerEventId)`, and **both are chosen
by the caller**. Replay of the _same_ event is correctly a no-op; a _fresh_
`providerEventId` is a fresh event. The index defends against provider retries,
which is what it was built for. It was never an authorisation control.

### What an attacker cannot do

Stated so the severity is not inflated:

- **Not** settle an order already `PAID` or `CANCELLED` — `settleCheckout`'s
  `status: 'PENDING'` predicate makes that a no-op.
- **Not** mint tickets for an order they did not cause to exist, without knowing
  its reference. Blind guessing faces `DE-` plus 8 characters from a 32-symbol
  alphabet, about 2^40.
- **Not** move real money. Payment mode is `MOCK` and no Stripe call is
  reachable.

The severity does not rest on any of those. It rests on the attacker creating
their own `PENDING` order and being handed the reference.

### Guest checkout

Guest orders are affected and are in fact the cleanest exploitation route,
because `orders.create` accepts an unauthenticated caller by design.

### Information disclosure

An unknown reference returns `ORDER_NOT_FOUND` rather than a generic
acknowledgement, which distinguishes "no such order" from "order settled" to an
unauthenticated caller. That is an oracle for probing reference existence. It is
secondary to the settlement issue and noted rather than emphasised.

## 5. Current mitigations, honestly assessed

| Claimed mitigation                           | Does it prevent this?                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Payment mode is `MOCK`                       | **No.** Tickets are issued by this repository's own code. Mode gates the _provider_, not the settlement path. |
| Production payments disabled                 | **No.** The kill switch prevents real charges; it does not prevent an order being marked paid.                |
| Idempotency on `(provider, providerEventId)` | **No.** Both values are caller-chosen.                                                                        |
| Body schema validation                       | **No.** Shape is not authority.                                                                               |
| Order reference entropy                      | **No.** The attacker is issued the reference.                                                                 |

**Why mock mode is not a sufficient mitigation.** The asset at risk is a
**ticket**, not a card charge. Tickets are minted, credential-signed and
inventory-decrementing objects produced entirely inside this system. A public,
unauthenticated, state-changing endpoint that mints them is unacceptable
regardless of which payment provider is wired behind it. "Real payments are
disabled" answers a different question than the one this finding asks.

## 6. Was this known?

Partly, and that matters for how it is fixed rather than whether. The contract's
own description says:

> In production this endpoint is authenticated by the provider signature; the
> Phase 1 mock provider posts unsigned callbacks and real payments remain
> disabled.

So the unsigned callback was a deliberate Phase 1 convenience with a stated
future intention. Two things make it a finding now rather than a known gap:

1. **Nothing implements the promised production authentication.** There is no
   signature-verification seam on this route at all — not a disabled one, not a
   configured-off one. The sentence describes code that does not exist.
2. **The repository already knows how to do this correctly elsewhere.**
   `/v1/webhooks/stripe` states the opposite posture and implements it: "There
   is no mode that skips verification, and a deployment with no Stripe
   credentials refuses every delivery rather than accepting unsigned ones."
   Two webhook endpoints in one API hold opposite positions on whether unsigned
   input may change state.

## 7. What remains unproven at the time of writing

- No exploit has been executed against a running server. The chain above is
  read from source; the regression test in the next step is what converts it
  from argued to demonstrated.
- Whether any deployment of this API is currently reachable from an untrusted
  network is outside this repository's knowledge.
- The blast radius of `payment.failed` (the other enum member, routed to
  `compensateCheckout`) is not analysed here beyond noting that it too is
  reachable unauthenticated and can move an order to a terminal state.

## 8. Handling constraints observed

No credential, secret, real order reference, customer datum or copy-pasteable
exploit payload appears in this document. No request was made against any
deployed service. No Stripe call of any kind was made.

---

## Confirmation through regression test

The reading in §1–§4 was argued. This is what the code actually did, measured
against the stub database with disposable fixture data only.

A guest placed an order through the ordinary anonymous route. The provider was
configured to time out on that amount, which leaves the order `PENDING` — the
same state a real reconciliation case produces. One unsigned `POST` followed,
carrying a provider name the caller invented, an event id the caller invented,
the caller's own order reference, and `amountCents: 1`:

```text
http status  : 200
order before : { status: "PENDING", tickets: 0 }
order after  : { status: "PAID",    tickets: 1 }
```

A ticket, for one unit of currency claimed and none paid. The probe that
produced this was removed once it had; the committed evidence is
`apps/api/tests/payment-webhook-auth.test.js`, which asserts the **secure**
behaviour and therefore failed 4 of 4 against the vulnerable code:

```text
AssertionError: expected 200 to be greater than or equal to 400
```

> **⚠ CORRECTED — see "Evidence correction — 2026-09-17" below.** The two
> sentences above misattribute this measurement. It was real, but it described
> an earlier pre-commit shape of the test file, not the committed suite and not
> commit `aa811ba` — which cannot run standalone at all, because it imports a
> helper added by the following commit. The committed suite fails **8 of 11**
> against the vulnerable route. The probe output above is unaffected.

## Remediation

`apps/api/src/lib/mock-webhook.js` adds the thing that was missing: proof the
message came from the provider. The route verifies before it does anything else,
and refuses with a bare 400 whose reason goes only to the log.

**The key is derived, not configured.** `AUTH_SECRET` already fans out through
HKDF with a distinct purpose label per use, so this adds a purpose rather than a
secret. There is no new environment variable, so there is no deployment that is
accidentally unprotected because somebody missed one; nothing new appears in
`.env.example` to be copied into production as a real value; and `AUTH_SECRET`
never reaches the browser, so neither does this key.

**It fails closed.** No secret, no signature, no stale timestamp, no match — all
refuse. There is deliberately no mock-mode branch that accepts an unsigned body:
"we are only pretending to take payments" is not a reason to let a stranger issue
a ticket. This is the posture `/v1/webhooks/stripe` already had, brought to the
endpoint that lacked it.

**The signature covers fields, not raw bytes, and that is a deliberate
divergence.** Stripe signs bytes, so the Stripe route must verify bytes. Here we
define both ends, so the signature covers a canonical sorted encoding of every
field the schema allows — including `amountCents`, which the handler does not
read today but which any future amount check would have to trust. This avoids a
second raw-body parser and the byte-fidelity plumbing that comes with it.

**Why not an end-user session.** A provider has no session. Requiring one would
have meant either inventing a service account for a caller that is not a user, or
letting the buyer authenticate their own payment confirmation — which is the same
capability the finding is about, wearing a cookie.

The legitimate senders now sign: the test helper in `payment-flow.test.js` and
the `webhook-duplicates` load scenario, both through the exported
`signMockWebhook`, so there is one implementation of the scheme rather than three
that can drift.

## Residual limitations

- **Replay inside the tolerance window is bounded by identity, not by the
  signature.** A captured delivery re-sent within 300 seconds carries a valid
  signature; what stops it changing anything is the unique index on
  `(provider, providerEventId)` and `settleCheckout`'s `PENDING` predicate. Both
  are tested. A nonce store would close the window itself and is not built.
- **This is the mock provider's boundary only.** It proves nothing about Stripe.
  Real Stripe and real Stripe Connect remain `EXTERNAL VERIFICATION PENDING`, no
  credential has been supplied, and no Stripe call of any kind was made here.
- **`settleCheckout` still does not verify that money moved.** It gates on
  `PENDING` and trusts its caller. That is now defensible because the only caller
  that can reach it from outside is authenticated — but the deeper check, that a
  captured payment exists for the amount claimed, is not implemented and would be
  the natural next hardening.
- **The `ORDER_NOT_FOUND` oracle is closed by accident rather than by design.**
  Unverified deliveries are now refused before the order is looked up, so the
  distinction is no longer observable; a test pins that. It was not the reason for
  the fix.
- **No deployment was tested.** Everything here is measured against the test
  harness. Whether any running instance of this API is reachable from an untrusted
  network is outside what this repository can tell.

---

## Evidence correction — 2026-09-17

Pre-PR adversarial verification found that one sentence in this document, and
the commit message of `aa811ba`, attributed a measurement to the wrong artefact.
Nothing above is deleted; this section is the correction, and it is here rather
than edited into place because a security document that quietly rewrites itself
is one nobody can audit.

**The finding is still confirmed, and the fix is still sound.** What was wrong
is the provenance of one number, not the vulnerability and not the remedy.

### What was claimed

The "Confirmation through regression test" section above says the committed
suite "failed 4 of 4 against the vulnerable code", quoting
`AssertionError: expected 200 to be greater than or equal to 400`. The `aa811ba`
commit message says the same. Both imply that commit ran four failing
assertions.

### What is actually true

`aa811ba` adds `apps/api/tests/payment-webhook-auth.test.js`, which at line 38
imports `../src/lib/mock-webhook.js`. That helper does not exist until the next
commit, `8530814`:

```text
$ git cat-file -e aa811ba:apps/api/src/lib/mock-webhook.js
fatal: path 'apps/api/src/lib/mock-webhook.js' exists on disk, but not in 'aa811ba'
```

So at `aa811ba` the file cannot load. The run ends at module resolution with
**zero test cases executed** — not four assertion failures. `aa811ba` is a
genuine historical test-first commit, but it is **not standalone runnable**,
because the suite it adds depends on a module the implementation commit
introduces.

The "4 of 4" figure was a real measurement. It described an **earlier, smaller,
pre-commit shape of the test file** — the four unsigned-caller cases, before the
signed-path, tampering and oracle cases were written. It does not describe the
committed file, which holds eleven cases.

### The reconstructed measurement

To get the number that the committed suite actually produces against the
vulnerable route, the branch tree was extracted to a **disposable copy outside
the repository**, `apps/api/src/routes/payments.js` was replaced there with its
`origin/main` version, and the suite was run in that copy:

```text
Tests  8 failed | 3 passed (11)
```

The eight are the four anonymous-caller cases, the three signature-binding cases
(tampering, cross-order swap, stale timestamp), and the refusal-oracle case. The
three that pass are the legitimate-settlement cases, which is what one would
expect: the vulnerable route settles a signed callback too, because it settles
anything.

That counterfactual was never committed, never pushed, and is not part of
repository history. The working tree was verified clean and identical to
`52db7c8` afterwards.

### What is unchanged

The exploit probe reported above stands exactly as written, and was measured
independently of any of this:

```text
http status  : 200
order before : { status: "PENDING", tickets: 0 }
order after  : { status: "PAID",    tickets: 1 }
```

An anonymous caller settled their own order and was issued a ticket. That is the
finding, and it is confirmed.

### A limitation that cannot be fixed

The `aa811ba` commit message carries the same incorrect attribution. Correcting
it would mean rewriting published history, which is not permitted here, so it
stands and this section is the correction of record. A reader who checks out
`aa811ba` and finds it will not run should read this rather than conclude the
finding was fabricated.

### Scope of this correction

Evidence attribution only. It changes nothing about the demonstrated
vulnerability, the secure boundary, or the validation results. No real Stripe,
Stripe Connect, or external provider was involved in producing it; every
measurement was taken against the test harness with disposable fixture data.

## Correction to the outbox claim — 2026-09-17

The same verification found that the refusal snapshot's `outbox` counter was
inert. `settleCheckout` writes no `NotificationOutbox` row — the only writers
are ticket transfer, event cancellation and material-change — so a legitimate,
correctly signed, 200-OK settlement leaves the outbox at zero just as a refused
forgery does. Asserting it unchanged compared zero with zero.

It has been removed from the domain-state proof. The suite does not claim to
prevent a notification effect that settlement does not produce. No outbox side
effect was added to make an assertion pass.

The remaining snapshot fields were each checked for the same defect and are
sound: order status, `paidAt`, ticket count, `quantitySold`, ledger batches and
ledger entries all demonstrably move on a genuine settlement.

## Ledger positive control — 2026-09-17

The ledger counters were non-vacuous but unguarded: nothing in the committed
suite asserted they move, so if `postOrderLedger` were later removed the
"unchanged after refusal" assertions would have silently degraded into the same
zero-versus-zero comparison the outbox counter already was.

"The trusted mock provider still settles" now asserts, **order-linked** rather
than globally, that a legitimate settlement posts exactly one balanced batch
against that order, with the entry count derived from the order's own money, and
debit and credit totals equal to what the buyer was charged. Replay is asserted
to add nothing. Disabling `postOrderLedger` in a disposable copy fails three
cases where it previously failed none.

## Contract correction — 2026-09-17

`packages/api-contract/src/routes.js` described this endpoint as one the "Phase 1
mock provider posts unsigned callbacks" to. That was true when §6 quoted it and
false the moment the fix landed, which left the published contract and the
regenerated OpenAPI artifact telling integrators that unsigned callbacks were
valid input to a route that now refuses them.

The description now states that verification is required, that unsigned,
malformed, stale or altered callbacks are refused, that this is a provider
callback boundary rather than a way for a buyer to confirm their own payment,
and that it is not for browser clients or untrusted callers. `apps/api/openapi.json`
was regenerated with the repository's own emitter; one description line changed
and the operation count was unchanged. The route is still published — it was not
hidden — and its `auth` is still `none`, because a provider has no session and
concealing the endpoint would not have been a fix.

The quotation in §6 above is left as it was: it is the contract text as it stood
at the time of the finding, and that is the point it is making.
