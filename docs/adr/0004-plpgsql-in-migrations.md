# ADR 0004 — Procedural SQL inside migrations

- **Status:** Accepted
- **Date:** 2026-09-15
- **Supersedes:** nothing
- **Related:** ADR 0001, ADR 0002

## Context

Phase 2 introduces invariants that application code cannot be trusted to keep:

- a posted ledger batch must balance, and its entries must never be updated or
  deleted;
- a published venue-map version, and every section, row, seat and price zone
  under it, must never change;
- an event session may not change the map it sells once anything is sold;
- an order line may not reference a ticket type belonging to a different event
  from its order's (finding NF-04).

Each of these is the kind of rule that is true only if it is true for _every_
writer: the API, a worker, a future admin tool, a migration, a support engineer
with a `psql` prompt. A service-layer check is a promise made by one of those
writers on behalf of all of them.

Prisma's schema language cannot express any of them. `CHECK` constraints reach
some — a positive amount, a coherent status — but not "the sum of this batch's
entries is zero at the moment it is posted" or "this row was frozen by an event
in another table". Those need a `BEFORE` trigger, and a trigger body in
PostgreSQL is written in plpgsql.

Phase 2 therefore introduces the first non-JavaScript _procedural_ source in
the repository: ten plpgsql functions, wired to twelve triggers, inside
`packages/db/prisma/migrations/`. (Ten rather than twelve because
`desi_map_version_frozen` serves the section, row and price-zone triggers
alike.) ADR 0001 commits this application to JavaScript, so that fact is
recorded here rather than left for a reader to notice.

## Decision

**Procedural SQL (plpgsql) is permitted inside Prisma migration files, and
nowhere else.**

This is not treated as a `docs/language-policy.md` section 6 polyglot exception,
because section 6 governs a _separate service_ in another language — it asks for
a deployment story, a security boundary, an on-call owner and an integration
contract, none of which a trigger has. PostgreSQL is already the sanctioned
datastore in section 3 of that policy; a trigger is a property of the schema, in
the same way a `CHECK` constraint or a unique index is, and it ships through the
same migration files by the same command.

The scope is deliberately narrow:

- plpgsql appears **only** in `packages/db/prisma/migrations/*/migration.sql`.
- It is used **only** to enforce an invariant, never to compute a business
  result, transform data on the way in, or replace application logic. A trigger
  in this repository raises an exception or does nothing.
- Application code never calls a stored function. There is no RPC surface in the
  database.
- The behaviour every trigger enforces is probed in
  `packages/db/scripts/phase2-probes.mjs` by a test that attempts the violation
  against a real database and asserts it is refused. A trigger with no probe is
  an unverified claim; writing this ADR found one — the hold-item session check
  had none — and it now has two.
- Trigger functions are named `desi_*` so they are distinguishable from anything
  PostgreSQL or Prisma creates.

## Why not the alternatives

**Enforce it in the service layer.** This is the option ADR 0001's spirit
points at, and it is the one we reject. It holds only while every writer goes
through that service, which is exactly the assumption that fails: a migration, a
backfill script, a support session and a future service all write to this
database. "Posted ledger entries are append-only" enforced by a JavaScript
function is a sentence about one process, not about the data.

**Express it with `CHECK` constraints alone.** Tried first, and it reaches
about half the list. A `CHECK` sees one row. Balance-at-posting is a statement
about a set of rows; map freezing is a statement about another table's column.
Neither fits.

**Move the invariants into a database-side language we already write, such as
plain SQL DDL.** There is no such thing for this purpose: a trigger needs a
function body, and a function body needs a procedural language.

**Use a different datastore with richer declarative constraints.** Replacing
PostgreSQL to avoid thirteen trigger functions is not a trade anyone should
take.

## Consequences

- Two invariant layers exist — declarative constraints and trigger functions —
  and a reader must know to look in the migration for both. `docs/DATA_MODEL.md`
  must list them when it is written.
- The triggers are exercised by `pnpm db:verify:fresh` and compared
  catalogue-for-catalogue by `pnpm db:verify:upgrade`, so a trigger silently lost
  during a migration is a failing check rather than a quiet regression.
- A future non-JavaScript _service_ still requires the full section 6 process.
  This ADR does not open that door; it documents a floorboard.

> **Addendum — 2026-09-22.** This ADR contradicts itself, and did so on the day
> it was accepted rather than by going stale. Its "Decision" section counts "ten
> plpgsql functions, wired to twelve triggers"; its "Consequences" section argues
> against "thirteen trigger functions". Ten and thirteen cannot both describe the
> same tree, and neither matches it now: the migrations hold **21 distinct
> trigger functions wired to 23 triggers**, counted from
> `packages/db/prisma/migrations/` and confirmed against `pg_proc`/`pg_trigger`
> in a fully migrated database.
>
> The body is left exactly as written. Its decision — that integrity rules which
> two writers could otherwise disagree about belong in the database — is
> unaffected by either number, and rewriting an accepted ADR to make its
> arithmetic agree would hide that it never did. What the numbers were for was
> scale, and the scale argument holds more strongly at 21 than it did at ten.
>
> Counting method, so the next reader need not guess: distinct functions are
> `grep -c 'CREATE OR REPLACE FUNCTION desi_'` across the migration directory
> deduplicated by name; triggers are `CREATE TRIGGER` occurrences. One function,
> `desi_map_version_frozen`, is wired to three triggers, which is why the two
> figures differ by more than the three privacy triggers added since this ADR.
