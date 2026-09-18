# Security finding — unauthenticated order settlement via the payment webhook

**Status: CONFIRMED — exploit path verified by reading the code end to end.**
A failing regression test is written next; until that test is green-when-fixed
and red-when-not, this document is the evidence and the test is the proof.

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
