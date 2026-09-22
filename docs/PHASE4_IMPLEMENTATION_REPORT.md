# Phase 4 implementation report

Frontend, UI, UX and product-surface completion for Desi-Event, implemented in
four direct phases on `claude/phase4-frontend-ui-ux-completion`.

**This document is written as the work happens rather than after it.** Each
phase's evidence is recorded when that phase is pushed and its exact-SHA CI run
is terminal. Nothing below is projected, and no earlier entry is rewritten when
a later phase changes something — a correction is added beside the original,
dated, in keeping with the repository's house rule.

Status of this document: **IN PROGRESS.** Phases 2, 3 and 4 are not yet
implemented and are not described here as though they were.

---

## Starting repository state

|                              |                                                                     |
| ---------------------------- | ------------------------------------------------------------------- |
| Base commit                  | `ed172030e0e62ce5e776e859354c0b02d66dc672`                          |
| Which is                     | the merge of PR #13, Phase 3 final verification                     |
| Branch                       | `claude/phase4-frontend-ui-ux-completion`, created from that commit |
| Working tree at start        | clean, 0 commits ahead of `origin/main`                             |
| Payment mode                 | `MOCK`; production payments disabled                                |
| Real Stripe / Stripe Connect | `EXTERNAL VERIFICATION PENDING`                                     |

---

## Phase 1 — design foundation and navigation

**Commit `209cba6c3eca9a682db7771783ae80f0325e3e40`**, pushed to
`origin/claude/phase4-frontend-ui-ux-completion`. Verified on both local `HEAD`
and the remote ref; working tree clean at the time of the push.

### Files added and changed

| File                                           | Change                                         |
| ---------------------------------------------- | ---------------------------------------------- |
| `packages/config/src/tailwind.css`             | +84 — the semantic token layer                 |
| `apps/web/src/lib/navigation.js`               | new, 215 lines — what the navigation offers    |
| `apps/web/src/lib/navigation.test.js`          | new, 194 lines — 20 cases                      |
| `apps/web/src/lib/active-path.js`              | new, 35 lines — the pure active-path predicate |
| `apps/web/src/components/primary-nav.jsx`      | new, 205 lines — the client disclosure         |
| `apps/web/src/components/primary-nav.test.jsx` | new, 132 lines — 8 cases                       |
| `apps/web/src/components/site-header.jsx`      | rewritten as a server component                |

Seven files, 931 insertions, 30 deletions. No migration, no schema change, no
API or contract change, no dependency added.

### What the navigation defect was

The header carried four links: `/events` and three category filters. The ticket
wallet, organiser workspace, finance, privacy, retention, moderation and
analytics were reachable only by typing a URL — **27 of the 31 routes had no way
in**. The wallet in particular already existed at `/tickets`, `/tickets/[id]`
and `/tickets/accept`; nothing linked to it.

The navigation now derives what it offers from `GET /v1/auth/me`, per capability
rather than per role, because roles inherit (ADMIN and OWNER both reach
`connect:manage` through FINANCE) and a role test would have to restate the
inheritance graph and then drift from it.

An organisation capability is asked per membership and folded across them,
because holding `privacy:redact` in one organisation says nothing about another.
A platform capability is asked unscoped, and is deliberately **not** inferred
from `platform:admin` standing alone: `SUPER_ADMIN` is `[...ALL_CAPABILITIES]`
(`packages/permissions/src/capabilities.js:543`), so a real platform
administrator arrives with every capability spelled out, and an actor holding
only that one string is not one this system issues.

### This is not an authorisation mechanism

`lib/navigation.js` says so in its module docstring. The same-origin proxy at
`app/api/v1/[...path]/route.js` forwards any `/v1` path a browser asks for and
adds no authority, so hiding a link protects nothing — the API guard is the only
thing that refuses. What the module decides is whether somebody is _offered_ a
door, not whether it opens.

### The token layer

Additive. The marigold, indigo-night and henna ramps are untouched; 27 semantic
tokens sit on top of them, named for what they are _for_ rather than what they
_are_. Two registers share one vocabulary — `surface`/`accent` for the editorial
public surfaces, `canvas`/`line` for the quieter operations ones — and neither
introduces a hue.

`mock` is its own status rather than a shade of informational, because
conflating a simulated payout state with a real one is how a simulation starts
looking like a deployment. Motion is three durations and one easing between
120 ms and 250 ms, and nothing else.

### Finding: a client/server boundary leak, caught by the build

The first implementation put `isActivePath` in `lib/navigation.js`. The client
component imported it from there:

```text
apps/web/src/components/primary-nav.jsx   ('use client')
  -> apps/web/src/lib/navigation.js
     -> apps/web/src/lib/session.js
        -> next/headers            <- server-only, fails the build from a client component
```

The build reported the error at `./apps/web/src/lib/session.js:17:1` with the
full client-component import trace. This is the repository's own guard working:
`session.js` is server-only because the session cookie read belongs on the
server, and pulling it toward the browser graph is exactly what
`scripts/scan-browser-bundle.mjs` exists to prevent.

The correction was to split the pure predicate into its own module,
`apps/web/src/lib/active-path.js`, which imports nothing. `lib/navigation.js`
re-exports it so there is still one implementation of the rule, and
`primary-nav.jsx` imports it directly.

**Bundle-scan counts, before and after:**

|                                 | Browser-deliverable files |
| ------------------------------- | ------------------------- |
| Before (on `main` at `ed17203`) | 355                       |
| After the split                 | **349**                   |

The count went _down_, which is the correct direction: `session.js` and its
transitive imports left the browser graph entirely.

### Finding: 215 service-dependent tests were skipping, and were restored

During Phase 1 verification the skipped-test gate failed:

```text
✗ 215 test(s) were skipped and not allow-listed:
  packages/db/tests/client.test.js > isDatabaseReachable > returns true against the live test database
  apps/worker/tests/redis-integration.test.js > worker against live Redis > ...
  apps/worker/tests/redis-retention.test.js > the retention rehearsal against live Redis > ...
  apps/worker/tests/retention-postgres.test.js > the retention rehearsal against real PostgreSQL > ...
  apps/worker/src/outbox/dispatcher.test.js > claiming > ...
```

Root cause: PostgreSQL and Redis had stopped in this container.
`pg_isready` reported `no response` and `redis-cli ping` reported
`Connection refused`. The gate was **not** waived and the tests were **not**
allow-listed. Both services were restarted:

```text
pg_ctlcluster 16 main start   -> /var/run/postgresql:5432 - accepting connections
redis-server --daemonize yes  -> PONG
```

A second failure followed and is worth recording because it would otherwise have
read as success: after restarting the services, `turbo` served **18 of 19** test
tasks from cache, so the stale `vitest-report.json` files written during the
services-down run were reused and the gate still failed. Forcing the run with
`--force` regenerated them. Final result:

```text
Skipped-test check: OK — 5401 case(s) ran across 16 report(s); 0 skipped, 0 allow-listed, 0 undeclared.
```

**5,401 cases, 0 skipped** — up from 5,373 on `main` at `ed17203`.

### Finding: the focus-restoration tests were falsified before being trusted

`primary-nav.test.jsx` pins the disclosure's focus contract. To prove the tests
were looking rather than passing by accident, `triggerRef.current?.focus()` was
temporarily removed from `close()` in `primary-nav.jsx`:

```text
× closes on Escape and returns focus to the trigger
× closes and restores focus when a destination is chosen
Tests  2 failed | 6 passed (8)
```

The behaviour was restored and the suite returned to `8 passed (8)`. The removal
was never committed.

One test was written and then deleted rather than kept: an assertion that every
workspace item had a string `description`. It passed against a hard-coded
constant without exercising anything, and a test that cannot fail is worse than
no test.

### Local verification, Phase 1

Run on the branch at `209cba6`, with PostgreSQL and Redis available.

| Gate                  | Result                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `format:check`        | pass                                                                |
| `policy:check`        | 708 files scanned, no violations                                    |
| `ci:check`            | 2 workflows, uploadable artefact names, tasks order their own build |
| `secrets:scan`        | 707 tracked files, nothing credential-shaped                        |
| `lint`                | pass                                                                |
| `contract:check`      | 131 routes, 131 operations, 117 paths; artefact current             |
| `test --force`        | 19/19 tasks                                                         |
| `check-skipped-tests` | **5,401 cases, 0 skipped, 0 allow-listed, 0 undeclared**            |
| `build --force`       | 3/3 tasks; every route `ƒ (Dynamic)`                                |
| `bundle:scan`         | **349** browser-deliverable files, nothing server-only              |

`apps/web` alone: 42 test files, 708 cases, up from 41 / 688.

### Exact-SHA CI, Phase 1

`push` in `.github/workflows/ci.yml` triggers only on `branches: [main]`, and
`pull_request` runs against a synthetic merge ref rather than the branch head.
Neither produces a run on the exact commit. `workflow_dispatch` does, so it was
used.

**To be completed when run `35744421565` is terminal.** Recording it before it
finishes would be projecting a result.

---

## Sections still to be written

Phases 2, 3 and 4, and the following report requirements, are not yet
answerable and are deliberately left unwritten rather than filled with
placeholders: final repository state; architecture and data-flow changes;
database migrations and constraints; API and response-schema changes;
authorization and tenant-isolation changes; ticket credential and QR threat
model; scanner preview and check-in flow; the full UI route and navigation
inventory; accessibility and responsive evidence; Playwright collection proof;
security regression results; known limitations; deferred owner decisions;
external verification pending items; and the per-requirement classification
table.
