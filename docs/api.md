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
        "role": "ATTENDEE"
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

- Registration accepts only `ATTENDEE` (corrected 2026-10-06: it used to
  accept `ORGANIZER` too). Organisers join by an organiser invitation from the
  Desi-Event team (`organizerInvitations.accept`, below); the platform roles
  `SUPER_ADMIN`, `ADMIN` and `MODERATOR` are granted by a super administrator
  (`platform.setUserRole`), never by registering.
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

_Corrected 2026-09-29._ The contract's modes are `none`, `optional` and
`session`, not `bearer`: a session is a server-side row, which a browser
presents as an `HttpOnly` cookie and an API client as a bearer secret (the
OpenAPI document declares both, `sessionCookie` and `bearerAuth`). The tables
below that still say `bearer` mean `session`. The JWT examples above describe
the Phase 1 API; `docs/SECURITY.md` ("Authentication") describes sessions as
they are.

### Authorization

Authentication establishes who; authorization is separate. Once the actor is
loaded, capability checks come from `@desi-event/permissions`
(`assertCan(actor, capability, { organizationId })`) — no route compares a role
itself. A failure is `403 FORBIDDEN`. Capabilities include `event:create`,
`event:update`, `event:publish`, `event:view_draft`, `ticketType:manage`,
`order:view`, `order:refund`, `ticket:check_in`, `organization:manage`,
`promo:manage`, `report:view` and `platform:admin`. Since 2026-10-06 the
platform administrator (`ADMIN`) holds exactly ten platform capabilities, an
allow-list a load-time check enforces: `moderation:review`, `event:view_draft`,
`venue:manage`, `organizer:invite`, `report:view`, `website_redirect:manage`,
`analytics:view_all`, `event:platform_edit`, `event:platform_delete` and
`event:import`. An organisation's members gain `event:delete_unsold` and
`event:delete`.

_Corrected 2026-10-09._ The platform administrator now holds fourteen platform
capabilities: the ten above, `payment_terms:manage`, `referral_code:manage`,
`platform_fee:refund` and `venue_booking:cancel` (ADRs 0016 and 0017). The
platform finance administrator gains `platform_fee:refund`.

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

| Field            | Always present                        | Meaning                                                    |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| `code`           | yes                                   | Machine-readable. Branch on this, never on `message`       |
| `message`        | yes                                   | Human-readable. Safe to show a user                        |
| `statusCode`     | yes                                   | Mirrors the HTTP status                                    |
| `issues`         | validation failures only              | One entry per offending field: `path`, `code`, `message`   |
| `orderReference` | checkout answers about a placed order | The order to look at instead of paying again (see Orders)  |
| `requestId`      | yes                                   | Echoes the id in the server logs. Quote it in a bug report |

### Codes

| Status | Code                     | When                                                                                    |
| ------ | ------------------------ | --------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | The request failed schema validation; see `issues`                                      |
| 401    | `UNAUTHORIZED`           | Bearer token missing, malformed or expired                                              |
| 403    | `FORBIDDEN`              | Authenticated, but lacking the required capability                                      |
| 404    | `NOT_FOUND`              | No such resource, or it is not visible to this caller                                   |
| 409    | `CONFLICT`               | Collides with current state: a duplicate slug, a hold already spent                     |
| 410    | `HOLD_EXPIRED`           | The hold the request depends on has lapsed                                              |
| 413    | `PAYLOAD_TOO_LARGE`      | The body is larger than the route accepts (a picture: 10 MiB)                           |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | The body is not a type the route accepts; for a picture, judged from its bytes          |
| 422    | `UNPROCESSABLE`          | Well-formed but not actionable: sold out, outside the sales window, event not published |
| 429    | `RATE_LIMITED`           | Too many attempts; the message says how long to wait                                    |
| 500    | `INTERNAL_SERVER_ERROR`  | A bug. In production the message is fixed and the detail stays in the logs              |
| 503    | `SERVICE_UNAVAILABLE`    | The database is unreachable, or the change could not wait for another; see below        |

Checkout adds its own outcomes, with sentences written for the buyer that
production does not mask: 402 `PAYMENT_DECLINED`, 409 `ORDER_PENDING` and
`ORDER_CANCELLED`, 500 `ORDER_NOT_COMPLETED` and 502 `PAYMENT_TIMEOUT` (see
Orders).

A command that waits behind another change to the same event (deleting it,
cancelling a night, restoring it, opening or closing a sitting, the website
link, a picture's decision, an import's listing or approval, the refund
driver's passes), and a team invitation or a new code for one, which waits
behind another change to its organisation or its address, runs in a
transaction with a budget and bounded waits
(`apps/api/src/lib/transaction-budget.js`): no lock is waited for longer than
15 seconds and no statement outlives the budget. One that runs out is rolled
back whole and answered `503 SERVICE_UNAVAILABLE` with `Retry-After: 5` and a
sentence saying what was not changed, never a 500 carrying the database's
words; trying again usually meets the other change's own refusal
(`STALE_REVISION`, `ALREADY_DELETED`) or succeeds. In a batch (an import run,
an approval, the refund driver) only the item that ran out is refused
(`TRY_AGAIN`, or counted waiting), and the rest go on. Any other transaction
that runs out of time (`P2028`, SQLSTATE `55P03` or `57014`) gets the same 503.

A NUL (U+0000) in any string or key of a validated body, query or path is a
400 `VALIDATION_ERROR` whose issue names the field: PostgreSQL stores that
character in no text or JSON column, so it is refused before the handler
writes anything, whatever the field's own schema allows. Should one reach the
database by another road, PostgreSQL's refusal (SQLSTATE 22021 for a text
column, 22P05 for a JSON one) is answered with the same 400, never a 500. A
lone UTF-16 surrogate (half of a pair, as a `\ud800` escape in JSON) is
refused the same way: a JSON column refuses it (22P02, Prisma P2007) and a
text column would keep U+FFFD in its place.

Numbers and dates are held to what their columns hold. A revision sent as a
precondition is at most 2147483647 (an `integer` column), and a query's date
filter (`from`, `to`, `startsAfter`, `startsBefore`) is from 1 January 1970
on; either outside is a 400 naming the field. Should a value outside its
column's range reach the database by another road (SQLSTATE 22003, Prisma
P2020, or 22008 for a date), the answer is the same 400, never a 500.

Domain packages set these themselves — `InventoryError` carries
`INSUFFICIENT_INVENTORY`, `BELOW_MINIMUM`, `ABOVE_MAXIMUM` and friends with
their own statuses, and the handler reports what the package decided rather
than re-deriving it.

Event pictures add their own, each with a sentence the organiser can act on
(see [MEDIA.md](MEDIA.md)): 400 `EMPTY_UPLOAD`; 409 `GALLERY_FULL`,
`MEDIA_QUOTA_EXCEEDED`, `GALLERY_CHANGED` and `MEDIA_CHANGED`; and 422
`MALFORMED_IMAGE`, `ANIMATED_IMAGE`, `IMAGE_TOO_SMALL` and `IMAGE_TOO_LARGE`.

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

| Scope                                                                                                                                                                              | Budget                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global                                                                                                                                                                             | 300 requests per minute per client                                                                                                                      |
| The credential routes: `auth.register`, `auth.login`, `auth.stepUp`, `auth.enrollTotp`, `auth.confirmTotp`, `auth.disableFactor`, `auth.changePassword` and the email-token routes | 10 per minute                                                                                                                                           |
| `teams.invite`, `teams.reissueInvitation`, `teams.accept`                                                                                                                          | 10 per minute per account                                                                                                                               |
| `organizations.create`                                                                                                                                                             | None of its own since 2026-10-06: it refuses everybody (403 `ORGANIZER_INVITATION_REQUIRED`) before reading the body, so only the global budget applies |
| `organizerInvitations.create` and `organizerInvitations.reissue`, together                                                                                                         | 30 an hour per administrator                                                                                                                            |
| `organizerInvitations.accept`                                                                                                                                                      | The credential budget, 10 per minute per account                                                                                                        |
| `platformEvents.openEdit`                                                                                                                                                          | 30 sittings an hour per administrator                                                                                                                   |
| `eventImports.preview`, `eventImports.apply` and `eventImports.retryImages`, together                                                                                              | 20 an hour per administrator                                                                                                                            |
| `traffic.beacon`                                                                                                                                                                   | 60 per minute per visitor; beyond 3,000 a minute for one event or 6,000 a minute for one API process, beacons are answered and not counted              |
| `traffic.websiteVisit`                                                                                                                                                             | 120 per minute per visitor (6,000 shared); at most 300 counted visits per event a minute per process                                                    |
| `tickets.startTransfer`, in `EMAIL` delivery only                                                                                                                                  | 5 an hour per sender                                                                                                                                    |
| Codes emailed to one address (`teams.invite`, `teams.reissueInvitation`, `tickets.startTransfer`), in `EMAIL` delivery only                                                        | 3 a day per recipient address (429 `RECIPIENT_DAILY_LIMIT`)                                                                                             |
| Door lookups and admissions, single and group                                                                                                                                      | 120 per minute per account                                                                                                                              |
| `tickets.pass`, `orders.groupPass`, `orders.rotateGroupPass`                                                                                                                       | 30 per minute per account                                                                                                                               |
| `orders.quote`                                                                                                                                                                     | 30 per minute per account                                                                                                                               |
| `orders.create` when the body names a `promoCode` (a checkout with no code is never counted)                                                                                       | 30 per minute per account, or per address for a guest                                                                                                   |
| `events.addMedia`                                                                                                                                                                  | 20 per ten minutes per account, counted before the body is read                                                                                         |
| `media.get`                                                                                                                                                                        | 1,200 per minute per account or address, its own budget                                                                                                 |
| `/docs`                                                                                                                                                                            | Exempt                                                                                                                                                  |

A 429 carries `Retry-After`. The limiter uses an in-process store, so budgets
are per API instance rather than per cluster. Budgets keyed "per account" fall
back to the client address for a request that has no session; every browser
request reaches the API through the web app's same-origin proxy, which is why
the per-account keys exist — keyed by address, the whole site would share one
budget.

## Endpoints

**208 operations across 25 tags.** This page describes the ones whose behaviour
needs prose; the **generated OpenAPI document is authoritative** for the full
list, its schemas and its error catalogue, and it cannot drift because
`pnpm openapi:emit` regenerates it from the same descriptors the server
validates with, and CI fails on a difference.

| Tag              | Ops | Tag           | Ops |
| ---------------- | --- | ------------- | --- |
| `events`         | 49  | `auth`        | 18  |
| `tickets`        | 15  | `finance`     | 12  |
| `operations`     | 12  | `venues`      | 12  |
| `privacy`        | 10  | `organizers`  | 9   |
| `imports`        | 8   | `orders`      | 9   |
| `platform`       | 8   | `teams`       | 8   |
| `referral-codes` | 7   | `refunds`     | 7   |
| `ticket-types`   | 6   | `promo-codes` | 5   |
| `holds`          | 3   | `traffic`     | 3   |
| `analytics`      | 2   | `sessions`    | 2   |
| `webhooks`       | 2   | `health`      | 1   |
| `media`          | 1   | `payments`    | 1   |
| `waitlist`       | 1   |               |     |

> **Correction — 2026-10-09 (unpaid tickets cancelled).** The total read
> "206 operations across 25 tags". Cancelling unpaid pay-at-the-venue tickets
> adds two operations and no tag, so the total is **208** across **186** paths:
> `venueBookings.unpaid` on `events` and `venueBookings.cancel` on `orders`.

> **Correction — 2026-10-09.** The total read "193 operations across 24
> tags". Booking fees, referral codes and paying at the venue add thirteen
> operations and one tag, so the total is **206** across **184** paths: the
> three `paymentTerms.*` routes and `venuePayments.report` on `events`, the
> seven `referralCodes.*` routes on the new `referral-codes` tag, and the two
> `platformFees.*` routes on `orders`.

> **Correction — 2026-10-06.** The total read "164 operations across 22
> tags". Three pieces of work added twenty-nine operations and two tags, so the
> total is **193** across **173** paths:
>
> - **Invite-only organisers** (ADR 0010): the four `organizerInvitations.*`
>   administrator routes on the `platform` tag and `organizerInvitations.accept`
>   on `organizers`.
> - **The website link and visit counting** (ADRs 0012 and 0013): a new
>   `traffic` tag (`traffic.beacon`, `traffic.events`, `traffic.websiteVisit`),
>   and `moderation.setWebsiteRedirect` and `moderation.websiteLinks` on
>   `events`.
> - **Full control of posted events** (ADR 0014): eleven routes on `events` —
>   `events.deletionPreview`, `events.delete`, `events.finishRefunds`,
>   `events.sessionCancellationPreview`, `events.cancelSession`,
>   `events.platformEdits`, the four `platformEvents.*` routes and
>   `moderation.mediaQueue`.
> - **Importing listed events** (ADR 0015): a new `imports` tag with the eight
>   `eventImports.*` routes.
>
> The rows sum to 196, three more than the total, for the multi-tag reason
> given below, which is unchanged. Counted from `apps/api/openapi.json` and
> cross-checked against `apiRoutes.length`;
> `apps/api/tests/api-doc-counts.test.js` holds both.

> **Correction — 2026-09-29.** The total read "134 operations across 19
> tags". The feature-completion work added thirty operations and three tags —
> `platform` (four super-administrator routes), `promo-codes` (five organiser
> routes) and `media` (`GET /v1/media/:id`, which serves a picture's bytes) — so
> the total is **164** across **146** paths. The rows sum to 167, three more
> than the total, because three routes carry two tags: `sessions.hold` as
> before, and the group pass's `orders.groupPass` and `orders.rotateGroupPass`,
> tagged `tickets` and `orders`. Counted from `apps/api/openapi.json` and
> cross-checked against `apiRoutes.length`; `apps/api/tests/api-doc-counts.test.js`
> holds this table, the headline and the list of multi-tagged routes to the
> contract.

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

**`organizationId` is required, not optional.** An optional organisation is how
an organisation capability quietly becomes a platform one. (Corrected
2026-10-06: this said there was no platform-wide analytics view. There is now
one, and it is a separate route, `traffic.events` below, held by the platform
capability `analytics:view_all` and carrying counts only, never money.)

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

**The conversion funnel is not invented.** Its steps are counted from rows that
exist: visitors and visitors who chose tickets or seats (from the daily visit
totals, ADR 0013), then holds taken, orders created and orders paid.
`funnel.missing` names what is not counted. (Corrected 2026-10-06: this said
nothing recorded a page view, which was true until first-party visit counting
was built.)

**Visits (`traffic`).** Both routes carry a `traffic` branch for the
organisation, or with `eventId` for one event: page views, visitors (distinct
per event per UTC day), card clicks by place, ticket and seat clicks, website
visits, where page views came from as five categories, a per-day series of at
most 366 days, and paid orders against visitors. With no `from` the window
starts on the first day anything was counted, and paid orders are counted from
that day too, so an order paid before visits were counted is never set against
visitors. It is read from `TrafficDaily`, never from raw visits. `traffic.updatedAt` says when the background roll-up last
finished, `traffic.stale` is set when that is over two hours ago, and
`includesDemonstration` is true when any summed row was written by the
development seed. Robots, signed-in members of the organisation and Desi-Event
staff are not counted; a browser sending Global Privacy Control or Do Not Track
is counted in views, never in visitors.

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

| Method | Path                         | Auth     | Purpose                                                                                                                                                                                                                                                                                                                                     |
| ------ | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/events`                 | optional | Paginated, filterable discovery. Anonymous callers see the listed statuses only: `PUBLISHED`, `ON_SALE`, `SALES_PAUSED` and `SOLD_OUT` (`PUBLIC_EVENT_STATUSES`). A token adds every event, in any status, of each organisation where the caller holds `event:view_draft`; `platform:admin` sees every event                                |
| GET    | `/v1/events/:slug`           | optional | Full detail: venue, organisation, tiers and nights. A stranger can open an event in a listed status or one that is `COMPLETED`, `POSTPONED` or `CANCELLED`, so a ticket holder's link still resolves; any other status answers 404 unless the caller holds `event:view_draft` for its organisation, `moderation:review` or `platform:admin` |
| POST   | `/v1/events`                 | session  | Create an event in `DRAFT`, whatever status the body names. Requires `event:create`. The slug is unique platform-wide. 201                                                                                                                                                                                                                  |
| PATCH  | `/v1/events/:id`             | session  | Partial update; at least one field. Requires `event:update`. The owning organisation and the status are not writable here — a `status` in the body is dropped; the status moves only by the commands below. A live event's material changes need a confirmation and a reason (see "Event authoring after publication")                      |
| GET    | `/v1/events/:id/transitions` | session  | The moves open from the current status, each marked allowed or not with what blocks it. A convenience for the console; every command decides again for itself                                                                                                                                                                               |

**The status moves only by command.** Each command is its own route, with no
status in the body: the destination is the route. Each checks the caller's
capability for the owning organisation once the event is loaded, checks its
gates, and writes the move and its audit row in one transaction; a command
called from a status it does not start from answers 409 `ILLEGAL_TRANSITION`,
and a gate that fails answers 422 with the reasons.

| Path                                      | From → to                                                                                                                                                         | Capability                         | Step-up         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------- |
| `POST /v1/events/:id/submit-review`       | `DRAFT`, `CHANGES_REQUIRED` → `REVIEW_PENDING`; 422 with the problems when the event is not complete enough to review                                             | `event:submit_review`              | —               |
| `POST /v1/events/:id/withdraw-review`     | `REVIEW_PENDING` → `DRAFT`, while no moderator has ruled                                                                                                          | `event:update`                     | —               |
| `POST /v1/moderation/events/:id/decision` | `REVIEW_PENDING` → `APPROVED`, `CHANGES_REQUIRED` or `REJECTED`; before publication an approval can be taken back (`APPROVED` → `CHANGES_REQUIRED` or `REJECTED`) | `moderation:review`                | `MODERATION`    |
| `POST /v1/events/:id/rework`              | `REJECTED` → `DRAFT`                                                                                                                                              | `event:update`                     | —               |
| `POST /v1/events/:id/publish`             | `APPROVED`, `POSTPONED` → `PUBLISHED`; the organisation must be verified, the event complete and its inventory prepared                                           | `event:publish`                    | `EVENT_PUBLISH` |
| `POST /v1/events/:id/open-sales`          | `PUBLISHED`, `SALES_PAUSED`, `POSTPONED` → `ON_SALE`; the organisation must be verified and a tier ready to sell                                                  | `event:publish`                    | `EVENT_PUBLISH` |
| `POST /v1/events/:id/pause-sales`         | `ON_SALE`, `SOLD_OUT` → `SALES_PAUSED`                                                                                                                            | `event:pause_sales`                | —               |
| `POST /v1/events/:id/postpone`            | `PUBLISHED`, `ON_SALE`, `SALES_PAUSED`, `SOLD_OUT` → `POSTPONED`, with a reason code and prose                                                                    | `event:cancel`                     | `EVENT_CANCEL`  |
| `POST /v1/events/:id/reschedule`          | `POSTPONED` → `PUBLISHED` or `ON_SALE`, with the new dates in the same transaction                                                                                | `event:update` and `event:publish` | `EVENT_PUBLISH` |
| `POST /v1/events/:id/cancel`              | Any live or postponed status → `CANCELLED`, terminal, with a reason code and prose; refund work is created `PENDING`, once per order                              | `event:cancel`                     | `EVENT_CANCEL`  |

The full table of moves, including the ones only the system makes (`SOLD_OUT`,
`COMPLETED`), is `TRANSITIONS` in `packages/schemas/src/lifecycle.js`.

`GET /v1/events` query parameters, beyond `page` and `perPage`:

| Parameter                     | Values                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                           | Free-text search, 1–120 characters; no control characters                                                                                                                                                                                                                                                                                                       |
| `category`                    | `MUSIC_CONCERT`, `GARBA_DANDIYA`, `BOLLYWOOD_NIGHT`, `CLASSICAL_DANCE`, `COMEDY`, `FILM_SCREENING`, `CULTURAL_FESTIVAL`, `FOOD_FESTIVAL`, `WEDDING_EXPO`, `RELIGIOUS`, `THEATRE`, `WORKSHOP`, `NETWORKING`, `SPORTS`                                                                                                                                            |
| `status`                      | Any of the fourteen event statuses (`eventStatusSchema`: `DRAFT`, `REVIEW_PENDING`, `CHANGES_REQUIRED`, `APPROVED`, `PUBLISHED`, `ON_SALE`, `SALES_PAUSED`, `SOLD_OUT`, `COMPLETED`, `POSTPONED`, `CANCELLED`, `REJECTED`, `ARCHIVED`, `DELETED`). It narrows what the caller may already see and never widens it: anonymously, `status=DRAFT` is an empty page |
| `city`                        | Venue city; no control characters                                                                                                                                                                                                                                                                                                                               |
| `organizationId`              | Restrict to one organiser                                                                                                                                                                                                                                                                                                                                       |
| `isOnline`                    | `true` / `false`                                                                                                                                                                                                                                                                                                                                                |
| `startsAfter`, `startsBefore` | `YYYY-MM-DD` or a full ISO timestamp. `startsBefore` must be after `startsAfter`                                                                                                                                                                                                                                                                                |
| `sort`                        | `startsAt:asc` (default), `startsAt:desc`, `createdAt:desc`, `title:asc`                                                                                                                                                                                                                                                                                        |

### Ticket types

| Method | Path                               | Auth     | Purpose                                                                                                                                            |
| ------ | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/events/:eventId/ticket-types` | optional | Tiers with live availability folded in. `availableQuantity` already subtracts active holds, so it can be lower than `quantityTotal - quantitySold` |
| POST   | `/v1/events/:eventId/ticket-types` | bearer   | Add a tier (minor units, `ticketType:manage`, audited). No currency: the event's. Another currency 422; a taken name 409 `TIER_NAME_TAKEN`. 201    |

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

| Method | Path                                      | Auth     | Purpose                                                                                                                                  |
| ------ | ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/orders`                              | optional | Convert holds into a paid order. 201                                                                                                     |
| POST   | `/v1/orders/quote`                        | session  | Price a basket, holds and promo code without buying anything. Writes nothing                                                             |
| GET    | `/v1/orders/:reference`                   | bearer   | Look an order up by its customer-facing reference, e.g. `DE-8F3K2Q`. Visible to the buyer, and to organisation members with `order:view` |
| GET    | `/v1/orders`                              | bearer   | The authenticated user's own orders, newest first                                                                                        |
| GET    | `/v1/orders/:reference/group-pass`        | session  | The buyer's one QR and printed code for every ticket on the order they still hold                                                        |
| POST   | `/v1/orders/:reference/group-pass/rotate` | session  | Stop the current group pass working and derive a new one                                                                                 |

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

**The quote and the charge are one function.** `POST /v1/orders/quote` runs
`priceCheckout` inside a read-only transaction and returns the subtotal, the
discount and each line's share of it, fees, tax and the total. `POST /v1/orders`
recomputes the same figures under lock; send the quote's `totalCents` as
`expectedTotalCents`, and a different recomputed total is refused with 409
`PRICE_CHANGED` before anything is written or charged. An unknown promo code is
not an error on the quote — it answers `promo.applied: false` with a reason —
so a buyer can fix a typo; the quote is signed-in only and rate-limited per
account so it cannot be used to try codes at speed. `POST /v1/orders` refuses an
unknown code and moves the total for a known one, both before anything is
written, so a checkout that names a code draws on a budget of the same size (per
account, or per address for a guest); a checkout with no code is never counted.
A promo code is locked for the rest of the checkout and re-checked under the
lock, so a code with one use left gives one discount however many buyers race
for it.

**A hold belongs to one order at a time.** Each hold a checkout names is locked
(after the tiers and the nights, before the promo code), and so is a hold being
released, so a release and a checkout on one hold take turns: the release that
comes first gives the hold back and the checkout answers 410 before anything is
charged; the checkout that comes first keeps it, and the release answers 409. A
hold attached to an order whose payment is still being confirmed — a
double-submitted checkout, or a retry after a capture timed out — answers 409
until that payment is settled or refused. If the charge succeeds and the order
still cannot be completed, the capture is recorded on the payment
(`reconciliationRequired`, the provider's reference) with a `PROVIDER_MISMATCH`
reconciliation task, the order stays `PENDING`, and the answer is a 500
`ORDER_NOT_COMPLETED` telling the buyer not to pay again. A capture the provider
does not answer is a 502 `PAYMENT_TIMEOUT` with the order left `PENDING` the
same way. Both name the order in `error.orderReference` and keep their code and
sentence in production, where any other 5xx is masked. A free order whose
settlement refuses moved no money: it is cancelled, which gives its promo use
back, and the answer is a 409 `ORDER_CANCELLED` — nothing was charged, reserve
again.

**One `Idempotency-Key`, one attempt.** A retry with the key an earlier request
used never places a second order and never charges twice. It is answered with
that attempt's outcome, read from the order as it stands now, so it can differ
from the first answer when the payment has settled since:

| The order the key placed is                                                                            | The retry answers                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `PAID`, or `REFUNDED` since                                                                            | 201 and the order                                |
| `PENDING` (a first request still running, a capture that timed out, or one captured and not completed) | 409 `ORDER_PENDING`, with `error.orderReference` |
| `CANCELLED` after a declined card                                                                      | 402 `PAYMENT_DECLINED`, as the attempt was       |
| `CANCELLED` otherwise (a free order), or `EXPIRED`                                                     | 409 `ORDER_CANCELLED`                            |

So a 201 is always a sale: a client never has to guess from a success status
that nothing was booked. Trying again after a decline is a new attempt, with a
new key. Two requests with one key that both miss the opening read (a double
submission) meet on the key's unique index, and the second is answered the same
way rather than with a 500.

**Guest names.** `attendees` names the guests, one per ticket, all optional; a
ticket nobody named carries the buyer's name. A name that is an email address
is refused.

**Hidden tiers and nights.** A hidden tier answers 404 like an unknown one
unless the caller holds `ticketType:manage` in its organisation. On the site,
the checkout and seat pages read the event as such a member, so hidden and
complimentary tiers are listed there for them (marked Team only) and booked
through the same checkout; the tickets land in the booker's account and are
handed on with transfer codes. A tier for one night is held to that night's
sales window and capacity. A seat hold keeps its tiers and night from being
deleted under it (`FOR KEY SHARE`), so one racing the removal of its night or
tier answers 422, never a foreign-key 500.

**The group pass is the buyer's alone.** `GET …/group-pass` returns the QR
content and the printed code to the account that bought the order and to
nobody else: an organiser with `order:view`, a platform administrator, another
account using the buyer's address and a guest order all get the same 404 as a
reference nobody has used. It is created on first request and derived, never
stored — the database holds SHA-256 digests only. It needs a paid order, an
event that is not cancelled and at most 50 tickets that still admit — 2 of them
to be taken out the first time, 1 to keep showing afterwards, so the last guest
of a group is let in by it too (409 with a reason otherwise). A ticket handed on
leaves the group when its transfer is accepted. Rotating it bumps the version,
so the old QR and code match nothing; the response carries the new version and
no secret, and it is refused (409 with the same reasons) when the pass could not
be shown. Both are rate-limited and never
cached.

### Tickets

| Method | Path                                   | Auth   | Purpose                                                                                   |
| ------ | -------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| GET    | `/v1/tickets/admission/events`         | bearer | The events this account may admit to, and on what authority                               |
| POST   | `/v1/tickets/admission/preview`        | bearer | Look a pass or printed code up at the door. Writes nothing to the ticket                  |
| POST   | `/v1/tickets/check-in`                 | bearer | Admit a previewed ticket, exactly once. Needs the preview's `previewReference`            |
| POST   | `/v1/tickets/admission/group/preview`  | bearer | Look a group pass or its printed `DEG-` code up. Writes nothing                           |
| POST   | `/v1/tickets/admission/group/check-in` | bearer | Admit the named people from a previewed group, each exactly once                          |
| GET    | `/v1/tickets`                          | bearer | The caller's own tickets                                                                  |
| GET    | `/v1/tickets/:id`                      | bearer | One ticket, its event, and every transfer it has been through                             |
| GET    | `/v1/tickets/:id/pass`                 | bearer | The holder's own admission credential. Holder only, never cached, rate-limited            |
| POST   | `/v1/tickets/:id/transfers`            | bearer | Offer a ticket to an email address. In `MANUAL` delivery, returns the one-time code once  |
| POST   | `/v1/ticket-transfers/accept`          | bearer | Accept an offer, by its one-time code (sent as `token`)                                   |
| POST   | `/v1/ticket-transfers/decline`         | bearer | Decline an offer                                                                          |
| POST   | `/v1/tickets/:id/transfers/cancel`     | bearer | Withdraw an offer you made                                                                |
| POST   | `/v1/tickets/:id/revoke`               | bearer | Withdraw a ticket, with a reason. Requires `ticket:revoke`, under an `OPERATIONS` step-up |

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
`PATCH /v1/organizations/:id/members/:memberId`). A platform `SUPER_ADMIN`, to
any event, on `PLATFORM_ROLE` authority, when no membership gives it one: every
platform lookup and admission writes `ticket.admission_platform_authority` on
the event, and the role is re-read inside the admitting transaction (ADR 0007).
`SUPPORT`, `MODERATOR` and `FINANCE_ADMIN` admit nobody; an attempt is a 403
and is audited. A caller not authorised for the ticket's event receives the
same 404 as a caller who presented nothing real. For a super administrator,
`GET /v1/tickets/admission/events` takes `organizationId` and `q`, is cut at
the 100 events that start soonest, and says so in `meta.truncated`. See
[`CHECK_IN.md`](./CHECK_IN.md).

_Corrected 2026-09-29._ This paragraph said platform roles, `SUPER_ADMIN`
included, admit to no event. ADR 0007 reverses that for `SUPER_ADMIN` alone.

**A group pass admits the people at the door, not the order.** The group
preview resolves the QR (`G1.` and 43 characters) or the printed code (`DEG-`
and 12 characters) and lists every ticket on the order that its buyer still
holds, each with the outcome a single lookup would give. The confirmation names
the tickets being admitted now in `ticketIds`; each must have been admissible
in the preview (else 409 `PREVIEW_MISMATCH`). A ticket already admitted is
reported, not refused, so a retry is safe. If any named ticket stopped admitting
for another reason, nobody is admitted and the answer is 409 `GROUP_CHANGED`.
Each admission is the same exactly-once `CheckIn` a single ticket gets, with
`CheckIn.groupPassId` set, and a database trigger refuses a group admission of
a ticket on another order or one its buyer no longer holds.

**The method is recorded, not chosen.** `QR_SCAN` when the secure pass was
presented, `MANUAL_CODE` when the printed code was. The request schemas are
strict: a `method`, `checkedInAt`, `force` or `eventSessionId` is a 400.

A confirmation for an already-admitted ticket — a network retry, or a second
steward — answers **200 with `outcome: "ALREADY_CHECKED_IN"`**, the
**original** instant, and `checkedInByYou`, and writes nothing. A ticket that
may not be admitted answers **409** with `error.reason` from
`ADMISSION_REFUSAL_REASONS` (`REFUNDED`, `REVOKED`, `WRONG_EVENT`,
`WRONG_NIGHT`, `NIGHT_REQUIRED`, `PREVIEW_EXPIRED`, …); a client branches on
that, never on the message. On an event of more than one night every lookup and
confirmation names the night the door is admitting to (`eventSessionId`, from
`tickets.admissionEvents` → `sessions`): a ticket for another night is
`WRONG_NIGHT`, and a ticket good for every night admits once on each night
([`CHECK_IN.md`](CHECK_IN.md), "Nights").

**A transfer is an invitation, not a handover.** Offering does not move the
ticket; the current holder can still walk in. Offers lapse after 72 hours. How
the one-time code reaches the recipient is `data.delivery.mode` (ADR 0008).
With no delivery provider — `MANUAL`, this build — `data.delivery.invitationCode`
carries it **once, in the 201 only**, sent `cache-control: no-store, private`;
the sender passes it on themselves. With a provider (`EMAIL`) the field is
`null`. The database holds only its digest, so nobody can be shown it again,
and it is never logged, audited or put in the notification outbox. The screen
that accepts it takes it as a pasted value in a request body rather than as a
query parameter, because a secret in a URL survives in a history, a `Referer`
and a proxy log long after it is spent. The recipient must be signed in at the
offered address.

A reserved seat is offered like any other ticket and goes with it: the old row
keeps the seat as history and the new one holds it, and the database allows one
live ticket per seat (ADR 0006).

_Corrected 2026-09-29._ This paragraph said the token "never appears in a
response". That assumed a delivery provider this build never had.

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

### Seats and nights

| Method | Path                     | Auth     | Purpose                                                                                     |
| ------ | ------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| GET    | `/v1/sessions/:id/seats` | optional | Every seat on sale at one night, by section and row, with its tiers, prices and seat limits |
| POST   | `/v1/sessions/:id/holds` | optional | Hold a set of seats for a checkout. All or nothing. 201                                     |

`GET /v1/events/:slug` lists the event's nights as `sessions`, each with its
label, times, sales window, whether it has a seat map and how many seats a
buyer could take now. The seat map says whether each seat is available and
never why it is not; accessibility attributes are published to everybody,
because somebody who needs an accessible seat has to be able to find one.

A hold names seats and nothing else: price, tier, duration and whether the
buyer may have them are decided server-side. An accessible seat takes its
companion and a companion takes its accessible seat. Each seat is sold under
the reserved tier that prices its zone, which must be of this night and on
sale; the most seats one hold may take is the smallest of those tiers' limits,
never above ten, and each tier's own minimum applies (422 `BELOW_MINIMUM`
naming the tier). If somebody takes one of the seats first, none is reserved
and the response says which seat went. Seats held by a lapsed hold are taken
back first, unless an order is still waiting on that hold's payment.

### Teams and organisations

| Method | Path                                                  | Auth    | Purpose                                                                                      |
| ------ | ----------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| POST   | `/v1/organizations`                                   | session | Refused for everybody: 403 `ORGANIZER_INVITATION_REQUIRED` (since 2026-10-06)                |
| GET    | `/v1/organizations/:id`                               | session | The organisation's profile as its members see it. `organization:view_members`                |
| POST   | `/v1/organizations/:id/invitations`                   | session | Invite an address to a role. `team:invite`. In `MANUAL` delivery, returns the code once. 201 |
| POST   | `/v1/organizations/:id/invitations/:memberId/reissue` | session | Withdraw an invitation and issue a new code for it, in one transaction. 201                  |
| POST   | `/v1/invitations/accept`                              | session | Join with a code, signed in as the invited address                                           |
| POST   | `/v1/organizations/:id/ownership`                     | session | Hand ownership to another member. `organization:manage`, `SECURITY_ROLE` step-up             |
| GET    | `/v1/moderation/organizations`                        | session | The verification queue. `moderation:review`                                                  |
| GET    | `/v1/moderation/organizations/:id`                    | session | One organisation, with its verification history. `moderation:review`                         |

**Nobody makes themselves an organiser** (since 2026-10-06, ADR 0010).
`organizations.create` answers 403 `ORGANIZER_INVITATION_REQUIRED` to every
caller without reading the body. An organisation is started only by accepting an
organiser invitation (`organizerInvitations.accept`, below), which creates it
VERIFIED with the inviting administrator as verifier and the acceptor as OWNER;
OWNER is privileged, so accepting is a privilege change (NF-10) and
`data.session` says whether a second factor must be set up. Before 2026-10-06
anybody signed in could create an `UNVERIFIED` organisation; those already made
keep their state and still need a moderator's verification to publish.

**Posting roles come from the Desi-Event team.** An OWNER, ADMIN or MANAGER may
invite or move members only to roles that cannot create or publish events
(FINANCE, STAFF, SCANNER and VIEWER, derived from `capabilities.js`); a member
who already posts may be moved only downwards. Anything else is 403
`POSTING_ROLE_NEEDS_PLATFORM`. A posting role is given by an organiser
invitation (the new organisation's OWNER) or by a super administrator's
`platform.grantMembership`. `teams.list` gives, per member, `postsEvents` and
`roleChoices` — the roles this caller may set for that member. Ownership may be
handed only to a member who already posts (422 `HEIR_MUST_POST_EVENTS`).

**Invitation codes are shown once** (ADR 0008). `teams.invite` and
`teams.reissueInvitation` answer 201 with `data.delivery = { mode,
invitationCode }`; in `MANUAL` the code is there once, `no-store`, and only its
digest is kept. A member cannot invite somebody to a role carrying powers they
lack, OWNER cannot be invited at all, and the database holds at most one live
invitation per address, so two invitations issued at once give one invitation
and one 409. Invitations lapse after 14 days. Accepting needs the caller to be
signed in as the invited address, ends their other sessions and, for a
privileged role, shortens the current one; `data.joined` is false when the
account already belonged to the organisation.

**Ownership moves as one swap.** The named member becomes OWNER and the caller
ADMIN, with the owners locked, so there is never a moment with no owner or a
second one nobody meant. The new owner's sessions all end.

**The verification queue carries no contact address.** It opens on `PENDING`,
oldest first. The decision itself is the existing
`POST /v1/organizations/:id/verification/decision`, under a `SECURITY_ROLE`
step-up.

### Platform

Eight routes on the `platform` tag. The four below are `platform:admin` (super
administrators only); the other four are the organiser invitations, held by
`organizer:invite` (ADMIN and SUPER_ADMIN), described under "Organiser
invitations". Neither capability names an organisation scope.

| Method | Path                                     | Step-up         | Purpose                                                                    |
| ------ | ---------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| POST   | `/v1/platform/users/search`              | —               | Find accounts by email, name or exact id. A POST so the query is not a URL |
| POST   | `/v1/platform/users/:id/role`            | `SECURITY_ROLE` | Change an account's platform role, with a written reason                   |
| GET    | `/v1/platform/organizations`             | —               | Find organisations by name or slug, with member and owner counts           |
| POST   | `/v1/platform/organizations/:id/members` | `SECURITY_ROLE` | Put an existing account into an organisation, OWNER included               |

**Never the caller's own account** (403). A role change is made with every
super administrator locked and the caller's own role re-read, so two
administrators demoting each other at once cannot both succeed, and a change
that would leave no super administrator is 422 `LAST_SUPER_ADMIN`. A grant
refuses a suspended account and a change that would leave the organisation with
no owner (422, decided with the owners locked); it creates no invitation. Both
end every session the account holds in the same transaction, and both are
audited with their reason. The search answers `no-store` and carries no
credential, hash or factor.

### Event authoring after publication

| Method | Path                        | Auth    | Purpose                                                                     |
| ------ | --------------------------- | ------- | --------------------------------------------------------------------------- |
| GET    | `/v1/events/:id/tiers`      | session | Every tier, drafts and hidden ones included, with its night, zone and holds |
| POST   | `/v1/events/:id/rework`     | session | Move a rejected event back to draft. `event:update`                         |
| POST   | `/v1/events/:id/reschedule` | session | Bring a postponed event back with new dates. `EVENT_PUBLISH` step-up        |

**A published event can still be edited.** `PATCH /v1/events/:id` on a live
event (published, on sale, paused, sold out or postponed) treats a change to the
date, time zone, venue, age limit, online status or policies as material: it
needs `confirmMaterialChange: true` and a `changeReason`, and it records a
notice for every current order, shown on its order page; notices are not
emailed in any delivery mode. Everything else, the event page content included,
is housekeeping. A live online event with no joining link is 422. Nothing here
is reviewed again (ADR 0014); the Desi-Event team edits another organisation's
posted event only in an editing session (`platformEvents.openEdit`).

**Tiers change under row locks.** A tier that has sold may be re-priced — every
order keeps the price it was bought at — but not change currency (409
`TIER_SOLD`; corrected 2026-10-06, ADR 0014: a sold tier used to keep its price
outright). One with live holds keeps its price until they are bought or
released (409 `TIER_IN_USE`), and a quantity may be lowered only to what is sold
and held (409 `TIER_QUANTITY_BELOW_SOLD`). Two tiers on one event may not share a name, a
complimentary tier is free and hidden, and a hidden tier is left off every
public view. Removing the last night of a live event is 409 `LAST_SESSION`.

**Reschedule is one transaction.** The event and the named nights move to their
new dates, and the event returns to `PUBLISHED` or `ON_SALE`, so there is never
a live event carrying the date it was postponed from. It takes the revision as
a precondition (409 `STALE_REVISION`), a confirmation and a reason, and records
one notice per current order. A night's own sales window moves as the request
says; each ticket type's own window moves in the same transaction by as much as
what it is sold for — a tier for one night with that night's start (not at all
if that night keeps its date), a tier for every night with the event's start —
so a window that closed at the postponed date does not keep the tier off sale.
A move that would have a night's tier close after the night has finished is a
422 naming the tier; the audit row lists each tier's window before and after.

### Pictures

| Method | Path                                | Auth     | Purpose                                                                     |
| ------ | ----------------------------------- | -------- | --------------------------------------------------------------------------- |
| GET    | `/v1/events/:id/media`              | session  | The cover and gallery as the organisation and a moderator see them          |
| POST   | `/v1/events/:id/media`              | session  | Upload a cover or gallery picture. The body is the raw file. 201            |
| PATCH  | `/v1/events/:id/media/:mediaId`     | session  | Describe a picture again                                                    |
| PUT    | `/v1/events/:id/media/order`        | session  | Put the gallery in a new order                                              |
| DELETE | `/v1/events/:id/media/:mediaId`     | session  | Remove a picture and its bytes                                              |
| GET    | `/v1/media/:id`                     | optional | A picture's bytes: public once approved, otherwise only to its organisation |
| POST   | `/v1/moderation/media/:id/decision` | session  | Take one picture down, or put it back. `MODERATION` step-up                 |

The body of an upload is the file itself; `kind`, `altText` and `revision`
travel in the query. The bytes decide the format — JPEG, PNG or WebP only, 415
for anything else whatever it claims to be — and the picture is rebuilt from an
allow-list of its format's structures, so camera and location details,
comments, embedded thumbnails and trailing data do not survive. A picture added
while the event is a draft or has changes requested is public only after a
moderator approves the event. A picture added to a posted event, or a
replacement cover, is stored `PENDING` and is public only after somebody on the
Desi-Event team other than its uploader approves it (`moderation.mediaQueue`,
then `moderation.decideMedia`; 403 `SELF_REVIEW` for the uploader); the old
cover stays until then (corrected 2026-10-06, ADR 0014). No storage path,
uploader or scan detail is ever in a public response. Full reasoning:
[`MEDIA.md`](MEDIA.md) and ADRs 0009 and 0014.

### Promo codes

Five operations under `/v1/organizations/:id/promo-codes`, all `promo:manage`
in the organisation (EVENT_MANAGER and up; FINANCE, VIEWER, STAFF and SCANNER
are refused, because a code is a bearer discount, not report data).

| Method | Path                                | Step-up        | Purpose                                                                |
| ------ | ----------------------------------- | -------------- | ---------------------------------------------------------------------- |
| GET    | `…/promo-codes`                     | —              | The organisation's codes with their computed status and use counts     |
| POST   | `…/promo-codes`                     | `PROMO_ACTION` | Make a code: a percentage or a fixed amount off, optionally capped     |
| POST   | `…/promo-codes/:promoCodeId/pause`  | —              | Stop it giving a discount. Orders already placed keep theirs           |
| POST   | `…/promo-codes/:promoCodeId/resume` | `PROMO_ACTION` | Make a paused code live again. An ended code is 409 `PROMO_ENDED`      |
| DELETE | `…/promo-codes/:promoCodeId`        | —              | Delete a code nobody has used and no order names (else `PROMO_IN_USE`) |

Making a discount live changes what buyers pay, so making or resuming a code
needs a second factor confirmed within `PROMO_ACTION` (ten minutes); pausing and
deleting only reduce what is on offer. There is no general edit: pause a code
and make a new one. A code applies to every event of the organisation or to one
of its events. Audit rows never record the code's text.

### Organiser invitations — 2026-10-06

The only way anybody comes to post events (ADR 0010).

| Method | Path                                             | Step-up         | Purpose                                                                        |
| ------ | ------------------------------------------------ | --------------- | ------------------------------------------------------------------------------ |
| GET    | `/v1/platform/organizer-invitations`             | —               | The invitations issued, waiting ones by default. `organizer:invite`            |
| POST   | `/v1/platform/organizer-invitations`             | `SECURITY_ROLE` | Invite an address to start a new organisation as its owner. 201                |
| POST   | `/v1/platform/organizer-invitations/:id/revoke`  | —               | Withdraw a waiting invitation. Idempotent                                      |
| POST   | `/v1/platform/organizer-invitations/:id/reissue` | `SECURITY_ROLE` | Withdraw it and issue a new code for the same invitation, in one go. 201       |
| POST   | `/v1/organizer-invitations/accept`               | —               | Accept with the code, signed in as the invited address; makes the organisation |

`organizer:invite` is held by ADMIN and SUPER_ADMIN. The administrator writes
the organisation's name, and optionally its public description and website; the
recipient chooses only its web address and time zone. The organisation is made
VERIFIED with the inviting administrator as verifier. The code is single-use,
bound to the address, lasts fourteen days, and is shown once in the `MANUAL`
201 (`data.delivery.invitationCode`, `no-store`) or emailed in `EMAIL` mode
(ADR 0011), never both; only its SHA-256 digest is stored. Refusals: 403
`SELF_INVITATION`, 422 `STAFF_ACCOUNT` (and 403 at accept for a staff account,
the code unspent), 409 `INVITATION_OUTSTANDING`, 409 `NOT_OUTSTANDING` (also
for reissuing an expired invitation whose address was erased), one 403
`INVITATION_UNUSABLE` at accept that names no part of the address, and 503
`DELIVERY_FAILED` in `EMAIL` mode with the invitation withdrawn.

### Review — 2026-10-06

An event becomes public only after a review decision (ADR 0010). The database
holds the rule (`desi_event_status_requires_review`): APPROVED only from
REVIEW_PENDING, and a public status only from APPROVED, another public status
or a platform restore. A move the trigger refuses is 409 `REVIEW_REQUIRED`.
`moderation.decide` approve **requires** the `revision` the reviewer saw (400
without it, 409 `STALE_REVISION` when it moved). A reviewer who belongs to the
event's organisation is refused 403 `CONFLICT_OF_INTEREST`, and the person who
sent it for review 403 `SELF_REVIEW`; the one exception is an imported event of
the platform-held organisation (ADR 0015). Sending an imported event back for
changes is 409 `IMPORTED_EVENT_NO_EDITOR`, because nobody could make them.

### The website link — 2026-10-06

| Method | Path                                         | Auth    | Purpose                                                                     |
| ------ | -------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| GET    | `/v1/moderation/website-links`               | session | The administrators' worklist: `waiting`, `drafts`, `on`, `off`, `all`       |
| POST   | `/v1/moderation/events/:id/website-redirect` | session | Turn an event's website link on or off, with a reason. `MODERATION` step-up |
| POST   | `/v1/traffic/website-visits`                 | none    | Where the link goes now, for the web server's redirect route only           |

Both moderation routes need `website_redirect:manage` (ADMIN and SUPER_ADMIN).
An organiser's address change never moves the switch: a changed address waits,
and while the switch is on the link keeps going to the address an administrator
approved (`websiteDecidedUrl`). A decision names the address the administrator
saw, compared on the exact stored string (409 `WEBSITE_CHANGED`, with
`details.currentWebsiteUrl`, when it moved). `traffic.websiteVisit` answers the
decided address or one identical 404, `no-store`; the web proxy refuses it, so
its only caller is the web route `GET /events/[slug]/website`, which answers a 302. Full reasoning: ADR 0012.

### Visits — 2026-10-06

| Method | Path                  | Auth    | Purpose                                                                  |
| ------ | --------------------- | ------- | ------------------------------------------------------------------------ |
| POST   | `/v1/traffic/beacons` | none    | Record a page view, a card click or a ticket or seat press. Always 202   |
| GET    | `/v1/traffic/events`  | session | Visits to every event on the platform, counts only. `analytics:view_all` |

A beacon names the event, the kind and the place, and for a page view only the
referring site's host; nothing about the visitor is stored. It reads no session,
and it is answered 202 whether or not it was counted, so it says nothing about
an event that is not public. The address the visitor code is made from is
believed from `x-desi-client-address` only when the request comes from
`TRAFFIC_TRUSTED_FORWARDERS`. Figures reach the screens through the daily
totals a background job writes. Full reasoning: ADR 0013.

### Deleting, restoring and editing posted events — 2026-10-06

| Method | Path                                              | Step-up         | Purpose                                                                    |
| ------ | ------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| GET    | `/v1/events/:id/deletion`                         | —               | What a deletion would do now, decided on the server from what was sold     |
| POST   | `/v1/events/:id/delete`                           | `EVENT_CANCEL`  | Delete the event (it becomes DELETED and is kept)                          |
| POST   | `/v1/events/:id/refunds/finish`                   | `EVENT_CANCEL`  | Send the refunds a deletion or a cancelled night left waiting              |
| GET    | `/v1/events/:id/sessions/:sessionId/cancellation` | —               | What cancelling one night would do                                         |
| POST   | `/v1/events/:id/sessions/:sessionId/cancel`       | `EVENT_CANCEL`  | Cancel one night and refund its tickets                                    |
| GET    | `/v1/events/:id/platform-edits`                   | —               | The Desi-Event team's editing sittings on the event, and what each changed |
| GET    | `/v1/platform/events`                             | —               | Every event, for the Desi-Event team. `event:platform_edit`                |
| POST   | `/v1/platform/events/:id/edit`                    | `MODERATION`    | Open an editing sitting on a posted event, with a reason                   |
| POST   | `/v1/platform/events/:id/edit/close`              | —               | Close it                                                                   |
| POST   | `/v1/platform/events/:id/restore`                 | `EVENT_PUBLISH` | Bring a deleted event back. `event:platform_delete`                        |
| GET    | `/v1/moderation/media`                            | —               | Pictures waiting for approval on posted events. `moderation:review`        |

A deletion's outcome — REMOVE, CANCEL_AND_REFUND or REMOVE_AFTER_EVENT — is
decided on the server from what was sold and when, and the request must name
the outcome the preview showed (409 `OUTCOME_CHANGED`), the revision, and the
event's web address typed back (422 `CONFIRMATION_MISMATCH`). Refunds run
through the refund service after the commit, 500 a request with simulated
payments and 25 with a provider; `events.finishRefunds` sends the rest. Restore
is platform-only and brings an on-sale event back paused. A Desi-Event
administrator edits another organisation's posted event only inside a sitting
that answers one browser session, lasts up to an hour, and asks for a second
factor again every ten minutes of writes. Full reasoning: ADR 0014.

### Imports — 2026-10-06

Eight routes on the `imports` tag, all `event:import` (ADMIN and SUPER_ADMIN);
approving also needs `moderation:review`.

| Method | Path                                            | Step-up         | Purpose                                                                |
| ------ | ----------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| GET    | `/v1/platform/imports`                          | —               | The import runs                                                        |
| POST   | `/v1/platform/imports`                          | —               | Upload a dataset file and plan it; writes only the run. Up to 2 MiB    |
| GET    | `/v1/platform/imports/:runId`                   | —               | One run: its plan, notes, events and pictures                          |
| POST   | `/v1/platform/imports/:runId/apply`             | `MODERATION`    | Import the plan the administrator read; events land in review          |
| POST   | `/v1/platform/imports/:runId/images/retry`      | `MODERATION`    | Try copying pictures again                                             |
| POST   | `/v1/platform/imports/:runId/approve`           | `EVENT_PUBLISH` | Approve and publish named events, with their pictures and Sulekha link |
| GET    | `/v1/platform/import-targets`                   | —               | Organisations an imported event may move to                            |
| POST   | `/v1/platform/imports/events/:eventId/reassign` | `EVENT_PUBLISH` | Move an imported event to an organiser's own organisation              |

Imported events belong to the member-less platform-held organisation "Sulekha
Events", are published without ticket types or sales (409 `SOLD_ON_SOURCE` for
adding tiers or opening sales there), and link to their Sulekha page through
the website switch. Pictures are copied only from `https://usimg.sulekha.io`.
The CLI `pnpm import:events` previews and applies; it never approves. Full
reasoning: ADR 0015.

### Booking fees, referral codes and paying at the venue — 2026-10-09

Fifteen routes (ADRs 0016 and 0017). Every one answers `no-store`.

| Method | Path                                           | Capability             | Step-up          | Purpose                                                                                 |
| ------ | ---------------------------------------------- | ---------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| GET    | `/v1/platform/events/:id/payment-terms`        | `payment_terms:manage` | —                | An event's booking fee and pay-at-the-venue setting, with their history                 |
| POST   | `/v1/platform/events/:id/platform-fee`         | `payment_terms:manage` | `PAYMENT_TERMS`  | Set the event's own booking fee, or return it to the site default                       |
| POST   | `/v1/platform/events/:id/venue-payment`        | `payment_terms:manage` | `PAYMENT_TERMS`  | Switch paying at the venue on or off, or change its limit                               |
| GET    | `/v1/platform/referral-codes`                  | `referral_code:manage` | —                | Referral codes, newest first, 50 a page                                                 |
| GET    | `/v1/platform/referral-codes/by-administrator` | `referral_code:manage` | —                | Uses and fees waived per administrator who made codes                                   |
| POST   | `/v1/platform/referral-codes`                  | `referral_code:manage` | `PAYMENT_TERMS`  | Make a referral code, typed or generated                                                |
| GET    | `/v1/platform/referral-codes/:id`              | `referral_code:manage` | —                | One code and the orders that used it (every event of its scope), 50 a page              |
| PATCH  | `/v1/platform/referral-codes/:id`              | `referral_code:manage` | `PAYMENT_TERMS`  | Change a code's scope, expiry, limit or label                                           |
| POST   | `/v1/platform/referral-codes/:id/switch-off`   | `referral_code:manage` | —                | Switch a code off                                                                       |
| POST   | `/v1/platform/referral-codes/:id/switch-on`    | `referral_code:manage` | `PAYMENT_TERMS`  | Switch it back on                                                                       |
| GET    | `/v1/platform/orders/:reference/fee`           | `platform_fee:refund`  | —                | One order's booking-fee figures, before refunding it by hand                            |
| POST   | `/v1/platform/orders/:reference/fee-refund`    | `platform_fee:refund`  | `FINANCE_ACTION` | Refund one order's booking fee by hand; 30 an hour per administrator                    |
| GET    | `/v1/events/:id/venue-payments`                | `finance:view`         | `FINANCE_VIEW`   | Payments taken at the door, bookings still unpaid, cancellations                        |
| GET    | `/v1/events/:id/venue-bookings`                | XU2's authority        | `FINANCE_VIEW`   | Bookings waiting to be paid at the door, with their tickets                             |
| POST   | `/v1/orders/:reference/venue-cancellations`    | XU2's authority        | `FINANCE_ACTION` | Cancel chosen unpaid tickets of a booking; 60 an hour per person; idempotent by content |

The three `paymentTerms.*` routes, `venuePayments.report` and
`venueBookings.unpaid` are on `events`; the seven `referralCodes.*` routes on
`referral-codes`; the two `platformFees.*` routes and `venueBookings.cancel` on
`orders`. "XU2's authority" is the organisation's owners and administrators
(`order:refund` on their own membership) and the platform's `venue_booking:cancel`
(ADMIN, SUPER_ADMIN); everybody else gets 404, and a step-up is asked for first,
with the same answer whatever the reference.

**Changed routes.** `orders.quote` and `orders.create` take `paymentMethod`
(`CARD` by default), `referralCode` and, for the order, `expectedVenueDueCents`;
the quote answers the fee's terms (never their source), the gross and waived
fee, what is due at the door, the tax applied, `referral: { applied, reason }`
(never the code) and whether paying at the venue is available. Naming a code or
paying at the venue needs a session (401 `SIGN_IN_REQUIRED`); wrong codes are
budgeted (429). `orders.get` and `orders.listMine` add the payment method, the
fee's parts and terms, `referralApplied`, the tax applied, `venuePayment` (what
is due, paid by the buyer and by others, passed on, cancelled, kept) and
`venueCancellations`; an order's event carries its `country` and `region`, and
handed-on rows of a pay-at-the-venue order carry `passedOn` (`OWES` with the
amount, `PAID`, `CANCELLED`, `RETURNED` or `NOTHING_DUE`). The wallet and ticket
routes add `venuePayment`, whose `cancelled` says when, by the organiser or the
Desi-Event team, and the reason given (never a name; added 2026-10-13, so a
holder a ticket was passed to reads why), and the wallet's `revokedReason` is
only an organiser's own words, never a marker the server wrote;
`tickets.startTransfer` refuses nothing for money due; the door routes take
and answer the payment (`docs/CHECK_IN.md`) and refuse `UNPAID_CANCELLED`;
`events.get` adds `venuePayment: { available }` (and
`paymentTerms` for insiders); listings price with each event's own terms;
`refunds.request` refuses an amount refund of a pay-at-the-venue order;
`refunds.summary` lines add `cancelledQuantity`; analytics counts and the CSV
add cancelled places; tier writes refuse a currency other than the event's own
fee's (409 `FEE_TERMS_CURRENCY`).

**Busy answers.** A bounded wait that runs out answers 503
`SERVICE_UNAVAILABLE` with `Retry-After` (the fee, the switch, cancelling unpaid
tickets, refunding a fee, editing or switching a referral code, revoking a
ticket, and the single and group door, which wait at most four seconds for a
lock: a steward is told within moments that nobody was let in and no payment
was recorded); the specifications called it `TRY_AGAIN`.
`TRY_AGAIN` is sent only by `referralCodes.create` (503, five generated codes
taken in a row) and by a retryable database conflict (409).

Full reasoning: ADRs 0016 and 0017.

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
