# REST API

The Desi-Event HTTP API, as it exists. Every endpoint below is declared in
`packages/api-contract/src/routes.js`, registered from that same descriptor by
`apps/api/src/routes/`, and published in the generated OpenAPI document. A route
that is not in the contract does not exist.

## Base URL and versioning

| Environment | Base URL |
| --- | --- |
| Local development | `http://127.0.0.1:4000` |

Business endpoints sit behind `/v1`. `GET /health` is deliberately unversioned:
a load balancer probing liveness should not have to know which version of the
API is deployed.

## Live documentation

With the API running:

* **http://127.0.0.1:4000/docs** — Swagger UI. Every operation is executable
  against your local instance, including `Authorize` for a bearer token.
* **http://127.0.0.1:4000/openapi.json** — the raw OpenAPI 3.1 document.

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
  "user": { "id": "clx…", "email": "priya@example.com", "displayName": "Priya Nair", "role": "ORGANIZER" }
}
```

Send it on subsequent requests:

```bash
curl -s http://127.0.0.1:4000/v1/auth/me -H "authorization: Bearer $TOKEN"
```

Notes that matter:

* Registration accepts only `ATTENDEE` and `ORGANIZER`. `ADMIN` is granted out
  of band.
* Token lifetime comes from `JWT_EXPIRES_IN` (default `7d`).
* The token carries identity only — never memberships. Organisation roles are
  re-read from the database on every request, so a revoked membership takes
  effect immediately rather than when the token lapses.
* Login answers 401 identically for a wrong password and an unknown email, and
  takes the same time in both cases. The endpoint cannot be used to enumerate
  accounts.
* Against seeded data, every account's password is `DesiEvent!2026`.

### Auth modes

Each route declares one of three modes, and the declaration is what is
enforced — the guard is selected from the descriptor, so a route cannot be left
unprotected by forgetting to add one.

| Mode | Meaning |
| --- | --- |
| `none` | No credential is read |
| `bearer` | A valid token is required; otherwise 401 |
| `optional` | Anonymous is allowed, but a token that *is* present must be valid. A malformed or expired token still answers 401 rather than silently downgrading to anonymous |

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

| Field | Always present | Meaning |
| --- | --- | --- |
| `code` | yes | Machine-readable. Branch on this, never on `message` |
| `message` | yes | Human-readable. Safe to show a user |
| `statusCode` | yes | Mirrors the HTTP status |
| `issues` | validation failures only | One entry per offending field: `path`, `code`, `message` |
| `requestId` | yes | Echoes the id in the server logs. Quote it in a bug report |

### Codes

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | The request failed schema validation; see `issues` |
| 401 | `UNAUTHORIZED` | Bearer token missing, malformed or expired |
| 403 | `FORBIDDEN` | Authenticated, but lacking the required capability |
| 404 | `NOT_FOUND` | No such resource, or it is not visible to this caller |
| 409 | `CONFLICT` | Collides with current state: a duplicate slug, a hold already spent |
| 410 | `HOLD_EXPIRED` | The hold the request depends on has lapsed |
| 422 | `UNPROCESSABLE` | Well-formed but not actionable: sold out, outside the sales window, event not published |
| 429 | `RATE_LIMITED` | Too many attempts; the message says how long to wait |
| 500 | `INTERNAL_SERVER_ERROR` | A bug. In production the message is fixed and the detail stays in the logs |
| 503 | `SERVICE_UNAVAILABLE` | The database is unreachable |

Domain packages set these themselves — `InventoryError` carries
`INSUFFICIENT_INVENTORY`, `BELOW_MINIMUM`, `ABOVE_MAXIMUM` and friends with
their own statuses, and the handler reports what the package decided rather
than re-deriving it.

## Pagination

Every list endpoint takes the same two query parameters and returns the same
metadata block.

| Parameter | Default | Bounds |
| --- | --- | --- |
| `page` | `1` | 1 – 10000 |
| `perPage` | `20` | 1 – 100 |

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

| Shape | Used by |
| --- | --- |
| `{ "data": … }` | Every resource endpoint |
| `{ "data": [ … ], "pagination": { … } }` | Every list endpoint |
| `{ "token", "tokenType", "expiresIn", "user" }` | `auth.register`, `auth.login` |
| `{ "ok": true }` | `holds.release` |
| flat object | `GET /health` |

Responses are serialised *through* their schema, so a handler cannot leak a
field the contract does not declare — a password hash cannot escape by
accident.

## Rate limits

| Scope | Budget |
| --- | --- |
| Global | 300 requests per minute per client |
| `POST /v1/auth/register`, `POST /v1/auth/login` | 10 per minute |
| `/docs` | Exempt |

The limiter currently uses an in-process store, so budgets are per API instance
rather than per cluster.

## Endpoints

Eighteen operations. `Auth` is the mode described above.

### Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness and readiness. Reports the database check (and Redis when a client is wired in). A dead database answers 503 so a load balancer drains the instance; a dead Redis reports `degraded` and stays in rotation |

### Auth

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | none | Create an account and return a token. 201 |
| POST | `/v1/auth/login` | none | Exchange email and password for a token |
| GET | `/v1/auth/me` | bearer | Resolve the token to its user. Never includes the password hash |

### Events

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/events` | optional | Paginated, filterable discovery. Anonymous callers see `PUBLISHED` events only; a token widens the set to drafts the caller may view |
| GET | `/v1/events/:slug` | optional | Full detail: venue, organisation and ticket types. A draft answers 404 without `event:view_draft` |
| POST | `/v1/events` | bearer | Create an event in `DRAFT`. Requires `event:create`. The slug is unique platform-wide. 201 |
| PATCH | `/v1/events/:id` | bearer | Partial update; at least one field. The owning organisation is immutable. Requires `event:update` |
| POST | `/v1/events/:id/publish` | bearer | Move between `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED`. Publishing with no on-sale ticket type answers 422. Requires `event:publish` |

`GET /v1/events` query parameters, beyond `page` and `perPage`:

| Parameter | Values |
| --- | --- |
| `q` | Free-text search, 1–120 characters |
| `category` | `MUSIC_CONCERT`, `GARBA_DANDIYA`, `BOLLYWOOD_NIGHT`, `CLASSICAL_DANCE`, `COMEDY`, `FILM_SCREENING`, `CULTURAL_FESTIVAL`, `FOOD_FESTIVAL`, `WEDDING_EXPO`, `RELIGIOUS`, `THEATRE`, `WORKSHOP`, `NETWORKING`, `SPORTS` |
| `status` | `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED` |
| `city` | Venue city |
| `organizationId` | Restrict to one organiser |
| `isOnline` | `true` / `false` |
| `startsAfter`, `startsBefore` | `YYYY-MM-DD` or a full ISO timestamp. `startsBefore` must be after `startsAfter` |
| `sort` | `startsAt:asc` (default), `startsAt:desc`, `createdAt:desc`, `title:asc` |

### Ticket types

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/events/:eventId/ticket-types` | optional | Tiers with live availability folded in. `availableQuantity` already subtracts active holds, so it can be lower than `quantityTotal - quantitySold` |
| POST | `/v1/events/:eventId/ticket-types` | bearer | Add a tier. Prices are integer minor units. Requires `ticketType:manage`. 201 |

### Holds

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/holds` | optional | Reserve inventory for the length of a checkout. 201 |
| DELETE | `/v1/holds/:id` | optional | Return held inventory to the pool |

```bash
curl -s http://127.0.0.1:4000/v1/holds \
  -H 'content-type: application/json' \
  -d '{"ticketTypeId":"clx…","quantity":2}'
```

```json
{ "data": { "id": "clx…", "ticketTypeId": "clx…", "quantity": 2, "expiresAt": "2026-09-14T18:05:00.000Z" } }
```

`ttlSeconds` may override the default `TICKET_HOLD_TTL_SECONDS` (600). The
reservation is released automatically at `expiresAt`, so a client must be ready
for a later order to still fail: 422 when the tier sold out in the meantime,
410 when the hold itself lapsed.

Releasing is idempotent — a hold that already expired or was already released
reports success, because a checkout page unmounting twice must not raise an
error. Only a hold already converted into a paid order answers 409.

### Orders

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/orders` | optional | Convert holds into a paid order. 201 |
| GET | `/v1/orders/:reference` | bearer | Look an order up by its customer-facing reference, e.g. `DE-8F3K2Q`. Visible to the buyer, and to organisation members with `order:view` |
| GET | `/v1/orders` | bearer | The authenticated user's own orders, newest first |

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

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/tickets/check-in` | bearer | Scan a ticket at the door. Requires `ticket:check_in` |

Re-scanning an already-admitted ticket answers **200 with
`data.alreadyCheckedIn: true`**, not an error, so a flaky scanner never blocks
the queue.

### Waitlist

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/events/:eventId/waitlist` | optional | Register interest in a sold-out event. 201 |

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
