# REST API

The Desi-Event HTTP API, as it exists. Every endpoint below is declared in
`packages/api-contract/src/routes.js`, registered from that same descriptor by
`apps/api/src/routes/`, and published in the generated OpenAPI document. A route
that is not in the contract does not exist.

## Base URL and versioning

| Environment       | Base URL                |
| ----------------- | ----------------------- |
| Local development | `http://127.0.0.1:4000` |

Business endpoints sit behind `/v1`. `GET /health` is deliberately unversioned:
a load balancer probing liveness should not have to know which version of the
API is deployed.

## Live documentation

With the API running:

- **http://127.0.0.1:4000/docs** — Swagger UI. Every operation is executable
  against your local instance, including `Authorize` for a bearer token.
- **http://127.0.0.1:4000/openapi.json** — the raw OpenAPI 3.1 document.

The document is not inferred from whatever routes Fastify happens to have. It
is built by `buildOpenApiDocument()` from the same descriptors the routes are
registered with, and served verbatim, so the published contract and the
enforced contract are one artefact. `pnpm build` also writes it to
`apps/api/openapi.json`; `pnpm contract:check` fails the build if the contract
is structurally incoherent.

`/docs` is exempt from rate limiting — throttling documentation only makes the
API look broken to somebody reading about it.

## Authentication

Bearer JWT. Obtain one by registering or signing in:

```bash
curl -s http://127.0.0.1:4000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{
        "email": "priya@example.com",
        "password": "correct-horse-battery-staple",
        "displayName": "Priya Nair",
        "role": "ORGANIZER"
      }'
```

```bash
curl -s http://127.0.0.1:4000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"priya@example.com","password":"correct-horse-battery-staple"}'
```

Both answer with the same envelope:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "tokenType": "Bearer",
  "expiresIn": "7d",
  "user": {
    "id": "clx…",
    "email": "priya@example.com",
    "displayName": "Priya Nair",
    "role": "ORGANIZER"
  }
}
```

Send it on subsequent requests:

```bash
curl -s http://127.0.0.1:4000/v1/auth/me -H "authorization: Bearer $TOKEN"
```

Notes that matter:

- Registration accepts only `ATTENDEE` and `ORGANIZER`. `ADMIN` is granted out
  of band.
- Token lifetime comes from `JWT_EXPIRES_IN` (default `7d`).
- The token carries identity only — never memberships. Organisation roles are
  re-read from the database on every request, so a revoked membership takes
  effect immediately rather than when the token lapses.
- Login answers 401 identically for a wrong password and an unknown email, and
  takes the same time in both cases. The endpoint cannot be used to enumerate
  accounts.
- Against seeded data, every account's password is `DesiEvent!2026`.

### Auth modes

Each route declares one of three modes, and the declaration is what is
enforced — the guard is selected from the descriptor, so a route cannot be left
unprotected by forgetting to add one.

| Mode       | Meaning                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`     | No credential is read                                                                                                                                           |
| `bearer`   | A valid token is required; otherwise 401                                                                                                                        |
| `optional` | Anonymous is allowed, but a token that _is_ present must be valid. A malformed or expired token still answers 401 rather than silently downgrading to anonymous |

`optional` is what lets an organiser see their own draft events from the same
endpoint the public uses, and what lets a guest check out without an account.

### Authorization

Authentication establishes who; authorization is separate. Once the actor is
loaded, capability checks come from `@desi-event/permissions`
(`assertCan(actor, capability, { organizationId })`) — no route compares a role
itself. A failure is `403 FORBIDDEN`. Capabilities include `event:create`,
`event:update`, `event:publish`, `event:view_draft`, `ticketType:manage`,
`order:view`, `order:refund`, `ticket:check_in`, `organization:manage`,
`promo:manage`, `report:view` and `platform:admin`.

A resource you may not see answers `404`, not `403`, when telling the two apart
would itself leak information — a draft event, for instance.

## Error responses

Every failure — validation, authorization, a lost inventory race, an outright
bug — leaves through one handler in one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "statusCode": 400,
    "issues": [
      { "path": "quantity", "code": "too_small", "message": "Too small: expected number to be >=1" }
    ],
    "requestId": "DE-8F3K2Q"
  }
}
```

| Field        | Always present           | Meaning                                                    |
| ------------ | ------------------------ | ---------------------------------------------------------- |
| `code`       | yes                      | Machine-readable. Branch on this, never on `message`       |
| `message`    | yes                      | Human-readable. Safe to show a user                        |
| `statusCode` | yes                      | Mirrors the HTTP status                                    |
| `issues`     | validation failures only | One entry per offending field: `path`, `code`, `message`   |
| `requestId`  | yes                      | Echoes the id in the server logs. Quote it in a bug report |

### Codes

| Status | Code                    | When                                                                                    |
| ------ | ----------------------- | --------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`      | The request failed schema validation; see `issues`                                      |
| 401    | `UNAUTHORIZED`          | Bearer token missing, malformed or expired                                              |
| 403    | `FORBIDDEN`             | Authenticated, but lacking the required capability                                      |
| 404    | `NOT_FOUND`             | No such resource, or it is not visible to this caller                                   |
| 409    | `CONFLICT`              | Collides with current state: a duplicate slug, a hold already spent                     |
| 410    | `HOLD_EXPIRED`          | The hold the request depends on has lapsed                                              |
| 422    | `UNPROCESSABLE`         | Well-formed but not actionable: sold out, outside the sales window, event not published |
| 429    | `RATE_LIMITED`          | Too many attempts; the message says how long to wait                                    |
| 500    | `INTERNAL_SERVER_ERROR` | A bug. In production the message is fixed and the detail stays in the logs              |
| 503    | `SERVICE_UNAVAILABLE`   | The database is unreachable                                                             |

Domain packages set these themselves — `InventoryError` carries
`INSUFFICIENT_INVENTORY`, `BELOW_MINIMUM`, `ABOVE_MAXIMUM` and friends with
their own statuses, and the handler reports what the package decided rather
than re-deriving it.

## Pagination

Every list endpoint takes the same two query parameters and returns the same
metadata block.

| Parameter | Default | Bounds    |
| --------- | ------- | --------- |
| `page`    | `1`     | 1 – 10000 |
| `perPage` | `20`    | 1 – 100   |

```json
{
  "data": [ … ],
  "pagination": {
    "page": 2,
    "perPage": 20,
    "total": 137,
    "totalPages": 7,
    "hasNextPage": true,
    "hasPreviousPage": true
  }
}
```

Offset pagination, ordered deterministically (a tie-break on `id`) so a row
does not slip between pages. Values arrive from a URL as strings and are
coerced, so `?page=2` and `?page=2&perPage=50` both work.

## Response envelopes

| Shape                                           | Used by                       |
| ----------------------------------------------- | ----------------------------- |
| `{ "data": … }`                                 | Every resource endpoint       |
| `{ "data": [ … ], "pagination": { … } }`        | Every list endpoint           |
| `{ "token", "tokenType", "expiresIn", "user" }` | `auth.register`, `auth.login` |
| `{ "ok": true }`                                | `holds.release`               |
| flat object                                     | `GET /health`                 |

Responses are serialised _through_ their schema, so a handler cannot leak a
field the contract does not declare — a password hash cannot escape by
accident.

## Rate limits

| Scope                                           | Budget                             |
| ----------------------------------------------- | ---------------------------------- |
| Global                                          | 300 requests per minute per client |
| `POST /v1/auth/register`, `POST /v1/auth/login` | 10 per minute                      |
| `/docs`                                         | Exempt                             |

The limiter currently uses an in-process store, so budgets are per API instance
rather than per cluster.

## Endpoints

**134 operations across 19 tags.** This page describes the ones whose behaviour
needs prose; the **generated OpenAPI document is authoritative** for the full
list, its schemas and its error catalogue, and it cannot drift because
`pnpm openapi:emit` regenerates it from the same descriptors the server
validates with, and CI fails on a difference.

| Tag          | Ops | Tag            | Ops |
| ------------ | --- | -------------- | --- |
| `events`     | 23  | `finance`      | 12  |
| `auth`       | 18  | `privacy`      | 10  |
| `venues`     | 12  | `tickets`      | 11  |
| `operations` | 12  | `refunds`      | 7   |
| `teams`      | 6   | `ticket-types` | 5   |
| `organizers` | 4   | `holds`        | 3   |
| `orders`     | 3   | `sessions`     | 2   |
| `webhooks`   | 2   | `analytics`    | 2   |
| `payments`   | 1   | `health`       | 1   |
| `waitlist`   | 1   |                |     |

> **Correction — 2026-09-21.** This table said "118 operations across 18 tags",
> and three of its rows were wrong. `privacy` was a nineteenth tag with no row
> at all; `operations` had gained the retention read; and `holds` was already
> stale at 2 before any of this phase's work. The figures above are counted from
> `apps/api/openapi.json`, which is regenerated from the contract and checked by
> CI — so where this table and that file disagree, the file is right.
>
> The last row carries one tag and two empty cells rather than being balanced
> by moving something, because nineteen does not divide into two columns and a
> reordering to make it look tidy would break the descending-count reading.

> **Correction — 2026-09-22 (third).** The total read "132 operations" and
> `tickets` read 9. Phase 4's admission work added
> `GET /v1/tickets/admission/events` and `POST /v1/tickets/admission/preview`,
> so the total is 134 across **120** paths and `tickets` is 11. The columns sum
> to 135 against a stated 134, for the `sessions.hold` reason given below.
> Counted from `apps/api/openapi.json` and cross-checked against
> `apiRoutes.length`.

> **Correction — 2026-09-22 (second).** The total read "131 operations" and
> `tickets` read 8. `GET /v1/tickets/:id/pass` was added in Phase 4, so the
> total is 132 across **118** paths and `tickets` is 9. The columns now sum to
> 133 against a stated 132, for the `sessions.hold` reason the note below
> gives. Counted from `apps/api/openapi.json` and cross-checked against
> `apiRoutes.length`.

> **Correction — 2026-09-22.** The total read "129 operations" and `finance`
> read 10. Both were stale from the moment `connect.status` and `connect.start`
> merged in PR #12: two finance-tagged routes, so the total is 131 and `finance`
> is 12. Counted from `apps/api/openapi.json`, which reports 131 operations
> across 117 paths, and cross-checked against `apiRoutes.length`, also 131.
>
> One thing this table cannot show, and which explains why its columns sum to
> 132 rather than 131: `sessions.hold` carries two tags, `sessions` and `holds`,
> so it is counted twice. That was true before this correction as well — the
> previous figures summed to 130 against a stated 129 for the same reason. The
> per-tag rows are counts of tag membership; the total is a count of operations,
> and the two are not the same arithmetic.

`Auth` is the mode described above.

### Four properties that hold across every route

**A route cannot exist without being in the contract.** `defineRoute` takes a
descriptor and refuses an id that is not published, so there is no
hand-registered endpoint and no route the OpenAPI document does not know about.

**The response schema is an allow list.** `zodSerializerCompiler` strips unknown
keys, so a field is emitted only if the schema names it. That is the second of
two allow lists; the first is the presenter.

**An organisation capability names its scope.** A route asserting an
organisation capability must declare the request field carrying the organisation
id. A contract test walks every route and fails one that does not — unscoped,
the check inverts into a platform check (see `docs/SECURITY.md`, NF-05).

**A step-up window is a named server policy.** A route names
`FINANCE_ACTION`, never a number of minutes. A test asserts every named policy
exists and that every route tagged `analytics`, `finance` or `refunds` has one —
or, for the two analytics routes, that the _branch_ carrying money applies the
same window from the same table. That exemption is on a list and the test beside
it proves the branch is gated; an exemption without such a test would be a hole
rather than a design.

### Analytics

| Method | Path                       | Auth    | Purpose                                                      |
| ------ | -------------------------- | ------- | ------------------------------------------------------------ |
| GET    | `/v1/analytics/summary`    | session | Money, inventory, attendance and operations, in one call     |
| GET    | `/v1/analytics/export.csv` | session | The same figures as a spreadsheet, under a column allow list |

**`organizationId` is required, not optional.** There is no platform-wide
analytics view, and an optional organisation is how an organisation capability
quietly becomes a platform one.

**Two capabilities, one route.** `report:view` reaches every organisation role
from VIEWER upward and gets the counts. The ledger figures are **omitted from
the payload** unless the caller also holds `finance:view` _and_ has confirmed a
second factor within the `FINANCE_VIEW` window. Not hidden by the screen: a page
that rendered them behind a conditional would still have been sent them.
`moneyWithheld` says which of the two was missing — `CAPABILITY` is permanent,
`STEP_UP` is something the reader can fix — and the sales breakdowns lose their
value columns along with the totals, because a table headed "sales by event" is
the quiet way money escapes a permission check.

**Money comes from the ledger**, through the same `financeSummary` the finance
screen uses, so the two surfaces cannot disagree. Everything else is counted
from the rows that are the fact. `lineValueCents` is called that rather than
"revenue" because an order line's value is what it was priced at, and what the
organisation keeps is a different figure computed a different way.

**The conversion funnel is not invented.** Nothing here records a page view, so
the step everybody means by "conversion" does not exist as data. Three real
counts are reported — holds taken, orders created, orders paid — and
`funnel.missing` names what cannot be counted.

**The export's columns are an allow list**, written out rather than derived from
the payload's keys: no buyer, no email, no address, no card, no provider
reference. Counts go in `quantity` and money in `amountCents`, never the same
column, so no spreadsheet sums two hundred tickets and two hundred rupees. Every
cell that could begin `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed
with an apostrophe.

### Health

| Method | Path      | Auth | Purpose                                                                                                                                                                                                             |
| ------ | --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health` | none | Liveness and readiness. Reports the database check (and Redis when a client is wired in). A dead database answers 503 so a load balancer drains the instance; a dead Redis reports `degraded` and stays in rotation |

### Auth

| Method | Path                | Auth   | Purpose                                                         |
| ------ | ------------------- | ------ | --------------------------------------------------------------- |
| POST   | `/v1/auth/register` | none   | Create an account and return a token. 201                       |
| POST   | `/v1/auth/login`    | none   | Exchange email and password for a token                         |
| GET    | `/v1/auth/me`       | bearer | Resolve the token to its user. Never includes the password hash |

### Events

| Method | Path                     | Auth     | Purpose                                                                                                                                   |
| ------ | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/events`             | optional | Paginated, filterable discovery. Anonymous callers see `PUBLISHED` events only; a token widens the set to drafts the caller may view      |
| GET    | `/v1/events/:slug`       | optional | Full detail: venue, organisation and ticket types. A draft answers 404 without `event:view_draft`                                         |
| POST   | `/v1/events`             | bearer   | Create an event in `DRAFT`. Requires `event:create`. The slug is unique platform-wide. 201                                                |
| PATCH  | `/v1/events/:id`         | bearer   | Partial update; at least one field. The owning organisation is immutable. Requires `event:update`                                         |
| POST   | `/v1/events/:id/publish` | bearer   | Move between `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED`. Publishing with no on-sale ticket type answers 422. Requires `event:publish` |

`GET /v1/events` query parameters, beyond `page` and `perPage`:

| Parameter                     | Values                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                           | Free-text search, 1–120 characters                                                                                                                                                                                   |
| `category`                    | `MUSIC_CONCERT`, `GARBA_DANDIYA`, `BOLLYWOOD_NIGHT`, `CLASSICAL_DANCE`, `COMEDY`, `FILM_SCREENING`, `CULTURAL_FESTIVAL`, `FOOD_FESTIVAL`, `WEDDING_EXPO`, `RELIGIOUS`, `THEATRE`, `WORKSHOP`, `NETWORKING`, `SPORTS` |
| `status`                      | `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED`                                                                                                                                                                       |
| `city`                        | Venue city                                                                                                                                                                                                           |
| `organizationId`              | Restrict to one organiser                                                                                                                                                                                            |
| `isOnline`                    | `true` / `false`                                                                                                                                                                                                     |
| `startsAfter`, `startsBefore` | `YYYY-MM-DD` or a full ISO timestamp. `startsBefore` must be after `startsAfter`                                                                                                                                     |
| `sort`                        | `startsAt:asc` (default), `startsAt:desc`, `createdAt:desc`, `title:asc`                                                                                                                                             |

### Ticket types

| Method | Path                               | Auth     | Purpose                                                                                                                                            |
| ------ | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/events/:eventId/ticket-types` | optional | Tiers with live availability folded in. `availableQuantity` already subtracts active holds, so it can be lower than `quantityTotal - quantitySold` |
| POST   | `/v1/events/:eventId/ticket-types` | bearer   | Add a tier. Prices are integer minor units. Requires `ticketType:manage`. 201                                                                      |

### Holds

| Method | Path            | Auth     | Purpose                                             |
| ------ | --------------- | -------- | --------------------------------------------------- |
| POST   | `/v1/holds`     | optional | Reserve inventory for the length of a checkout. 201 |
| DELETE | `/v1/holds/:id` | optional | Return held inventory to the pool                   |

```bash
curl -s http://127.0.0.1:4000/v1/holds \
  -H 'content-type: application/json' \
  -d '{"ticketTypeId":"clx…","quantity":2}'
```

```json
{
  "data": {
    "id": "clx…",
    "ticketTypeId": "clx…",
    "quantity": 2,
    "expiresAt": "2026-09-14T18:05:00.000Z"
  }
}
```

`ttlSeconds` may override the default `TICKET_HOLD_TTL_SECONDS` (600). The
reservation is released automatically at `expiresAt`, so a client must be ready
for a later order to still fail: 422 when the tier sold out in the meantime,
410 when the hold itself lapsed.

Releasing is idempotent — a hold that already expired or was already released
reports success, because a checkout page unmounting twice must not raise an
error. Only a hold already converted into a paid order answers 409.

### Orders

| Method | Path                    | Auth     | Purpose                                                                                                                                  |
| ------ | ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/orders`            | optional | Convert holds into a paid order. 201                                                                                                     |
| GET    | `/v1/orders/:reference` | bearer   | Look an order up by its customer-facing reference, e.g. `DE-8F3K2Q`. Visible to the buyer, and to organisation members with `order:view` |
| GET    | `/v1/orders`            | bearer   | The authenticated user's own orders, newest first                                                                                        |

```bash
curl -s http://127.0.0.1:4000/v1/orders \
  -H 'content-type: application/json' \
  -d '{
        "eventId": "clx…",
        "buyerEmail": "priya@example.com",
        "buyerName": "Priya Nair",
        "items": [{ "ticketTypeId": "clx…", "quantity": 2 }],
        "holdIds": ["clx…"],
        "promoCode": "GARBA500"
      }'
```

**Client-supplied prices are ignored.** Only `ticketTypeId` and `quantity` are
trusted; every amount is recomputed server-side from the ticket type rows, in
integer cents, by `@desi-event/pricing`. Order, items, tickets, the sold
counters and the hold conversions are written in one transaction that the
payment runs inside, so a decline leaves the database exactly as it was.

Guest checkout is supported (`auth: optional`). The order becomes readable
through `GET /v1/orders/:reference` once someone signs in with the email it was
placed under.

### Tickets

| Method | Path                               | Auth   | Purpose                                                                                   |
| ------ | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| GET    | `/v1/tickets/admission/events`     | bearer | The events this account may admit to, and on what authority                               |
| POST   | `/v1/tickets/admission/preview`    | bearer | Look a pass or printed code up at the door. Writes nothing to the ticket                  |
| POST   | `/v1/tickets/check-in`             | bearer | Admit a previewed ticket, exactly once. Needs the preview's `previewReference`            |
| GET    | `/v1/tickets`                      | bearer | The caller's own tickets                                                                  |
| GET    | `/v1/tickets/:id`                  | bearer | One ticket, its event, and every transfer it has been through                             |
| GET    | `/v1/tickets/:id/pass`             | bearer | The holder's own admission credential. Holder only, never cached, rate-limited            |
| POST   | `/v1/tickets/:id/transfers`        | bearer | Offer a ticket to an email address                                                        |
| POST   | `/v1/ticket-transfers/accept`      | bearer | Accept an offer, by its one-time token                                                    |
| POST   | `/v1/ticket-transfers/decline`     | bearer | Decline an offer                                                                          |
| POST   | `/v1/tickets/:id/transfers/cancel` | bearer | Withdraw an offer you made                                                                |
| POST   | `/v1/tickets/:id/revoke`           | bearer | Withdraw a ticket, with a reason. Requires `ticket:revoke`, under an `OPERATIONS` step-up |

**Admission is preview, then confirm.** Both take exactly one of `credential`
(the holder's secure pass, which the server hashes and looks up by digest) or
`code` (the printed reference, typed by a steward). The preview resolves the
ticket, authorises the caller against _the ticket's own event_, and answers
with what a door needs — event, tier, seat, attendee name, whether it is
already in, and a closed refusal code — plus a two-minute `previewReference`
when the ticket is admissible. It writes no check-in, changes no status and
rotates nothing. The confirmation presents the same pass or code with that
reference and re-derives everything inside the admitting transaction. The
reference is bound to the scanner and the way the pass was presented; it is
not an authorisation token.

**Who may admit.** OWNER and ADMIN, to any event of their organisation.
MANAGER, STAFF and SCANNER, only to events a door scope names (set with
`PATCH /v1/organizations/:id/members/:memberId`). Platform roles, including
`SUPER_ADMIN`, to none: door authority comes from a membership, and a
platform attempt is refused and audited. A caller not authorised for the
ticket's event receives the same 404 as a caller who presented nothing real.
See [`CHECK_IN.md`](./CHECK_IN.md).

**The method is recorded, not chosen.** `QR_SCAN` when the secure pass was
presented, `MANUAL_CODE` when the printed code was. The request schemas are
strict: a `method`, `checkedInAt`, `force` or `eventSessionId` is a 400.

A confirmation for an already-admitted ticket — a network retry, or a second
steward — answers **200 with `outcome: "ALREADY_CHECKED_IN"`**, the
**original** instant, and `checkedInByYou`, and writes nothing. A ticket that
may not be admitted answers **409** with `error.reason` from
`ADMISSION_REFUSAL_REASONS` (`REFUNDED`, `REVOKED`, `WRONG_EVENT`,
`PREVIEW_EXPIRED`, …); a client branches on that, never on the message.

**A transfer is an invitation, not a handover.** Offering does not move the
ticket; the current holder can still walk in. Offers lapse after 72 hours. The
one-time token is delivered out of band and **never appears in a response** —
the database holds only its digest, and the screen that accepts it takes it as a
pasted value in a request body rather than as a query parameter, because a
secret in a URL survives in a history, a `Referer` and a proxy log long after it
is spent.

**`GET /v1/tickets/:id` has two readers and branches in the handler.** The
person holding the ticket asks whether it still gets them in; the organiser asks
whether it still should. So there is no single capability to declare: the holder
may read it, and so may anybody holding `ticket:revoke` in the organisation
whose event it is. Anybody else gets what somebody guessing identifiers gets.
The payload carries no pass, no token and no credential digest, and recipient
addresses come back masked to `p****a@example.com` — enough for the sender to
recognise, not enough for anybody to harvest.

_Corrected 2026-09-23._ The recipient is now `••••@example.com` for the holder
who sent the offer: the domain, and nothing of the local part. An organiser
reading the ticket gets `Hidden email`.

Full reasoning: `docs/CHECK_IN.md`.

### Refunds

Seven operations. Every one requires MFA. Reads need a `FINANCE_VIEW` step-up
(fifteen minutes); anything that moves a refund along needs `FINANCE_ACTION`
(five minutes).

| Method | Path                            | Step-up          | Purpose                                            |
| ------ | ------------------------------- | ---------------- | -------------------------------------------------- |
| GET    | `/v1/orders/:reference/refunds` | `FINANCE_VIEW`   | What is refundable, and what is already spoken for |
| POST   | `/v1/orders/:reference/refunds` | `FINANCE_ACTION` | Request a refund. Reserves the amount. 201         |
| GET    | `/v1/refunds`                   | `FINANCE_VIEW`   | The queue                                          |
| GET    | `/v1/refunds/:id`               | `FINANCE_VIEW`   | One refund                                         |
| POST   | `/v1/refunds/:id/approve`       | `FINANCE_ACTION` | Approve somebody else's request                    |
| POST   | `/v1/refunds/:id/submit`        | `FINANCE_ACTION` | Send it to the provider                            |
| POST   | `/v1/refunds/:id/cancel`        | `FINANCE_ACTION` | Withdraw it before it goes                         |

**A request may name an amount, or name order items and quantities — never a
price.** The money is derived from the order's own unit prices. A caller who
could name what a ticket cost could refund more than was paid.

**Separation of duties:** an approver holding only `order:refund_approve` may not
wave through their own request. Somebody holding `order:refund` may, because
that capability is what says one person may do both.

Full reasoning: `docs/REFUNDS_DISPUTES.md`.

### Finance, payouts, transfers and disputes

Ten operations. Reading needs `finance:view` and a `FINANCE_VIEW` step-up
(fifteen minutes); moving money needs `payout:manage` and a `PAYOUT` step-up
(five minutes).

| Method | Path                              | Step-up        | Purpose                                      |
| ------ | --------------------------------- | -------------- | -------------------------------------------- |
| GET    | `/v1/finance/summary`             | `FINANCE_VIEW` | Ledger-derived totals, integrity check first |
| GET    | `/v1/finance/balance`             | `FINANCE_VIEW` | What an organiser may actually be paid       |
| GET    | `/v1/finance/export.csv`          | `FINANCE_VIEW` | CSV, escaped against spreadsheet injection   |
| GET    | `/v1/finance/payouts`             | `FINANCE_VIEW` | The payout list                              |
| POST   | `/v1/finance/payouts`             | `PAYOUT`       | Schedule one. 201                            |
| GET    | `/v1/finance/payouts/:id`         | `FINANCE_VIEW` | One payout                                   |
| POST   | `/v1/finance/payouts/:id/send`    | `PAYOUT`       | Send it to the provider                      |
| POST   | `/v1/finance/payouts/:id/reverse` | `PAYOUT`       | Record a reversal                            |
| GET    | `/v1/finance/transfers`           | `FINANCE_VIEW` | Transfers to connected accounts              |
| GET    | `/v1/finance/disputes`            | `FINANCE_VIEW` | Open and resolved disputes                   |

**No route accepts a payout destination.** Where an organiser's money goes is a
property of their connected account. The field does not exist, so no
authorization bug can expose it.

Scheduling against a balance that cannot support it produces a `HELD` payout
with the reason stored — _"only 300000 of 700000 is available"_ — rather than an
error, because a payout that did not go and cannot say why is the complaint the
surface exists to prevent.

Full reasoning: `docs/FINANCIAL_LEDGER.md` and `docs/STRIPE_CONNECT.md`.

### Reconciliation

Seven operations under `/v1/operations/reconciliation`, inside the `operations`
tag. Reading is scoped: with an `organizationId` the caller needs `finance:view`
in it; without one they need `reconciliation:manage`, which is platform-only.
The five actions require `reconciliation:manage` and are platform-only
throughout.

| Method | Path                                         | Step-up          | Purpose                                          |
| ------ | -------------------------------------------- | ---------------- | ------------------------------------------------ |
| GET    | `/v1/operations/reconciliation`              | `FINANCE_VIEW`   | The queue: unresolved first, then oldest         |
| GET    | `/v1/operations/reconciliation/:id`          | `FINANCE_VIEW`   | One item, with the evidence recorded at the time |
| POST   | `/v1/operations/reconciliation/:id/claim`    | `FINANCE_ACTION` | Take it off the queue                            |
| POST   | `/v1/operations/reconciliation/:id/requery`  | `FINANCE_ACTION` | Ask the provider again. Writes no status         |
| POST   | `/v1/operations/reconciliation/:id/resolve`  | `FINANCE_ACTION` | Apply the verdict through a domain command       |
| POST   | `/v1/operations/reconciliation/:id/escalate` | `FINANCE_ACTION` | Say you cannot decide it alone                   |
| POST   | `/v1/operations/reconciliation/:id/notes`    | `FINANCE_ACTION` | Append a note. Never replaces one                |

**There is no route that takes a status.** An operator establishes what the
provider says and the system draws the consequence, exactly once, through the
same commands the ordinary path uses. A resolution the provider's answer does
not support is refused: `CONFLICT` and `UNKNOWN` permit none.

Full reasoning: `docs/RECONCILIATION_RUNBOOK.md`.

### Privacy

Ten operations under `/v1/organizations/:id/privacy`, and the striking thing
about them is how little the authority varies: **every one of them requires
`privacy:redact`**, including the five reads. Reading who has asked to be
erased is not a lesser act than erasing them — the list of people who have
asked is itself a list of people — so it is not a lesser permission.
`privacy:redact` is granted to the organisation `OWNER` and to nobody else.

| Method | Path                                    | Step-up           | Purpose                                    |
| ------ | --------------------------------------- | ----------------- | ------------------------------------------ |
| GET    | `…/privacy/requests`                    | —                 | The queue, newest first                    |
| GET    | `…/privacy/requests/:requestId`         | —                 | One request, with the scope it would touch |
| GET    | `…/privacy/requests/:requestId/events`  | —                 | Its immutable audit trail                  |
| GET    | `…/privacy/holds`                       | —                 | What is holding people's data in place     |
| GET    | `…/privacy/exports`                     | —                 | The export register                        |
| POST   | `…/privacy/requests`                    | `PRIVACY_ERASURE` | Raise a request. Does not erase anything   |
| POST   | `…/privacy/requests/:requestId/confirm` | `PRIVACY_ERASURE` | Perform the erasure                        |
| POST   | `…/privacy/requests/:requestId/cancel`  | `PRIVACY_ERASURE` | Withdraw it                                |
| POST   | `…/privacy/holds`                       | `PRIVACY_ERASURE` | Place a hold, naming the matter            |
| POST   | `…/privacy/holds/:holdId/release`       | `PRIVACY_ERASURE` | Release one                                |

**The five commands need a fresh second factor; the five reads do not.** That
is the line the step-up policy draws — a step-up proves somebody is still at
the keyboard, which is worth asking for before an irreversible act and is not
worth asking for before a list.

**Confirmation is not the same as step-up, and both are required.** Nothing
consumes a step-up, so one would otherwise authorise every command inside its
two-minute window. The confirmation is single-use and server-issued, which is
what makes "they meant _this_ one" checkable.

**The export register records that an export happened and never what was in
it.** `storageKey` is reduced to a boolean on the way out, and there is no route
that serves an export's bytes — every export is streamed to whoever asked and
nothing is kept. `subjectCount` is 0 for every artefact this system produces,
because both exports are aggregates; `docs/PRIVACY_AND_RETENTION.md` §5B
explains why that is a finding rather than an unimplemented feature.

Full reasoning: `docs/PRIVACY_AND_RETENTION.md`.

### Retention

One operation, and it is a `GET`.

| Method | Path                              | Auth             | Purpose                                       |
| ------ | --------------------------------- | ---------------- | --------------------------------------------- |
| GET    | `/v1/operations/retention/sweeps` | `retention:view` | What a rehearsal counted, and changed nothing |

Tagged `operations` rather than `privacy`, because it is platform-wide:
`RetentionSweep` has no `organizationId`, and `retention:view` is in
`PLATFORM_ONLY_CAPABILITIES`, so no organisation role reaches it however senior.

**There is no route that starts a sweep, and that absence is the design.** The
API holds no queue client — nothing in `apps/api` enqueues a BullMQ job — so
adding one to gain a "run it now" button would mean the one surface reachable
from a browser had acquired the ability to start a job whose durations nobody
has approved. A rehearsal is enqueued against the worker by somebody with
access to it.

**Every duration in the response carries
`PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`, per row rather than once in a
heading**, so a figure copied into a ticket brings its status with it. The
response also carries `notEvaluated`, naming classes the policy lists that no
rehearsal covers and why, and an optional `summary` giving the most recent run
per class regardless of the filters — because a paginated, filtered list cannot
distinguish "this class was last swept four pages ago" from "this class has
never been swept".

`leaseOwner` is dropped on the way out: it names a worker process, which is
infrastructure a reader cannot act on and an attacker would rather have.

Full reasoning: `docs/RETENTION_RUNBOOK.md`.

### Waitlist

| Method | Path                           | Auth     | Purpose                                    |
| ------ | ------------------------------ | -------- | ------------------------------------------ |
| POST   | `/v1/events/:eventId/waitlist` | optional | Register interest in a sold-out event. 201 |

The `eventId` in the path wins over any value in the body. Joining twice with
the same email returns the existing entry rather than creating a duplicate.

## Calling the API from JavaScript

Do not hand-write URLs. `@desi-event/api-contract` generates a client from the
same descriptors, with one method per route id:

```js
import { createApiClient, ApiClientError } from '@desi-event/api-contract'

const client = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL })

const { data, pagination } = await client.events.list({ category: 'GARBA_DANDIYA', perPage: 12 })
const event = await client.events.get({ slug: 'navratri-garba-dhamaal-mumbai' })

const authed = client.withToken(token)
const order = await authed.orders.get({ reference: 'DE-8F3K2Q' })

try {
  await client.holds.create({ ticketTypeId, quantity: 2 })
} catch (error) {
  if (error instanceof ApiClientError && error.status === 422) {
    // Sold out, or outside the sales window. error.body.error.code says which.
  }
}
```

Path parameters, query parameters and body fields are separated from one flat
input object by the route's own schemas, so `{ slug }` becomes a path segment
and `{ perPage }` becomes a query string without the caller saying which is
which. A non-2xx response throws `ApiClientError` carrying `status`, `code` and
the parsed `body`; a transport failure throws the same error with `status: 0`
and `code: 'NETWORK_ERROR'`.

Adding an endpoint means adding a descriptor to
`packages/api-contract/src/routes.js` and a handler registered with
`defineRoute(app, '<id>', …)`. The server's contract test asserts the two lists
match, so an endpoint added to one and forgotten in the other fails the suite
rather than 404ing in production.

## The simulated connected-account routes — 2026-09-22

| Route            | Method | Path                                  | Capability                      | Step-up        |
| ---------------- | ------ | ------------------------------------- | ------------------------------- | -------------- |
| `connect.status` | GET    | `/v1/organizations/:id/connect`       | `connect:manage` on `params.id` | `FINANCE_VIEW` |
| `connect.start`  | POST   | `/v1/organizations/:id/connect/start` | `connect:manage` on `params.id` | `PAYOUT`       |

Both are tagged `finance`, and the tag is load-bearing rather than cosmetic:
`MONEY_TAGS` in `apps/api/tests/security-regression.test.js` drives the invariant
that every money route declares a step-up. A new `connect` tag would have placed
a money-adjacent surface outside that invariant without anybody deciding it.

Both declare `API_ERRORS.stepUpRequired` rather than `API_ERRORS.forbidden`,
because a route may document each status only once and both are 403 — the
contract validator rejects the pair with `DUPLICATE_ERROR_STATUS`.

`connect.start` takes one body field, `action`, from the closed vocabulary
`START`, `SIMULATE_REQUIREMENTS`, `SIMULATE_READY`, `SIMULATE_DISABLE`. There is
no `state` field, so a caller cannot name a destination: the server reads the
row, looks the pair up in a fixed table and refuses anything absent from it. The
vocabulary does map one-to-one onto destination states, so what holds the line is
that _legality_ is decided server-side from the row, not the spelling of the
field.

`START` is create-only and idempotent — a replay returns the existing row
unchanged rather than walking a later state backwards. Every other action is a
compare-and-set against the state it was read in and answers 409 when it loses.

`connect.status` answers `NOT_STARTED` for an organisation with no row rather
than 404, because "nothing has been simulated yet" is the answer. Its payload is
a ten-field allow list; see `docs/STRIPE_CONNECT.md` for what is deliberately
absent and why.

Both refuse with `NOT_MOCK_MODE` unless the deployment is running the in-memory
mock. Neither contacts a payment provider in any mode.
