# Phase 4 implementation report

Frontend, UI, UX and product-surface completion for Desi-Event, implemented in
four direct phases on `claude/phase4-frontend-ui-ux-completion`.

**This document is written as the work happens rather than after it.** Each
phase's evidence is recorded when that phase is pushed and its exact-SHA CI run
is terminal. Nothing below is projected, and no earlier entry is rewritten when
a later phase changes something — a correction is added beside the original,
dated, in keeping with the repository's house rule.

Status of this document: **IN PROGRESS.** Phase 1 is complete and fully
verified — its exact-SHA CI run is green, recorded below. Phases 2, 3 and 4 are
not yet implemented and are not described here as though they were.

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

|            |                                                                      |
| ---------- | -------------------------------------------------------------------- |
| Run ID     | `35744421565`                                                        |
| URL        | https://github.com/KevinD003/desi-event.com/actions/runs/35744421565 |
| Trigger    | `workflow_dispatch`                                                  |
| Attempt    | **1** — no job was rerun                                             |
| head_sha   | `209cba6c3eca9a682db7771783ae80f0325e3e40` on all 8 jobs             |
| Conclusion | **failure**                                                          |

| Job                                      | Conclusion  |
| ---------------------------------------- | ----------- |
| Policy, lint, contract, tests, build     | success     |
| Browser — production build               | success     |
| Browser — public catalogue               | success     |
| Browser — organiser venue maps           | success     |
| Browser — event lifecycle                | success     |
| Browser — refusals                       | success     |
| Browser — commerce and operations detail | success     |
| **Browser — accessibility sweep**        | **failure** |

Skipped steps, and why: `Upload failure artefacts` and `Upload Playwright
artefacts` are conditional on failure and report `skipped` on every job that
passed. A skip there means the suite passed. In the one job that failed, that
step ran and uploaded artefact `10701163599`. No other step was skipped.

**No failed job was rerun.** The run is attempt 1 throughout and the failure was
root-caused from its logs.

#### Root cause: a contrast failure I introduced

```text
color-contrast (serious): Elements must meet minimum color contrast ratio thresholds
  .border-accent-line
  foreground #b9560d, background #fff6e0, 14px normal
  contrast 4.43, expected 4.5:1
  <a class="inline-flex min-h-11..." href="/sign-in">
  at apps/web/e2e/accessibility-sweep.spec.js:413
```

That is the Sign in button added in this phase: `text-accent-strong` on
`bg-accent-soft`. `--color-accent-strong` was `oklch(0.567 0.148 48.6)`, which
is marigold-700, and against `--color-accent-soft` it measures 4.43:1 where AA
requires 4.5:1 for text under 18.66px. A real failure, not a flake: `1 failed,
53 did not run, 2 passed`, deterministic, and caused by this commit.

**Why local verification missed it.** Phase 1 ran `format:check`,
`policy:check`, `ci:check`, `secrets:scan`, `lint`, `contract:check`, `test`,
`check-skipped-tests`, `build` and `bundle:scan` — and none of the seven browser
configurations. The accessibility sweep is the only gate that measures rendered
contrast, and it was not run before pushing. That is a process failure, not an
environment one.

#### The fix, and two further failures it uncovered

A contrast model was written and checked against the figure axe actually
produced: at `L=0.567` it computes 4.447, reproducing axe's 4.43 to rounding.
Only then was it used to choose a replacement.

The first candidate, `L=0.52`, cleared the reported pairing at 5.42:1 **and
still failed the hover ground** — the same text on `bg-accent-line` — at 4.37:1.
axe never hovers, so that second failure would have shipped unseen. `L=0.47`
gives 6.71:1 and 5.40:1.

`packages/config/tests/token-contrast.test.js` reads the **real token source**
and cannot drift from it. It opens `packages/config/src/tailwind.css` with
`readFileSync` at run time and pulls every `--color-*: oklch(...)` declaration
out with a regular expression, so the values it checks are literally the values
the application ships. The alternative — a table of hex strings copied into the
test — passes happily while the palette it is meant to guard moves underneath
it, which is the failure mode that makes a colour test worthless.

Two further consequences of reading the source rather than the page. The
pairings are declared by hand, because only a person knows which token is put on
which ground, and that list is the record of what the design system claims is
legible; and a pairing that exists only on `:hover` is as checkable as a resting
one, which is the whole reason the `L=0.52` candidate was caught. It found two
more failures already in the tree from this phase:

| Pairing                                   | Was        | Now    |
| ----------------------------------------- | ---------- | ------ |
| `accent-strong` on `accent-soft`          | 4.43:1     | 6.71:1 |
| `accent-strong` on `accent-line` (hover)  | 4.37:1     | 5.40:1 |
| `ink-subtle` on `surface`                 | **3.86:1** | 5.31:1 |
| `status-pending` on `status-pending-soft` | **4.45:1** | 6.71:1 |

`ink-subtle` on `surface` is the nav sheet's group headings at 12px. The browser
sweep never caught it and never could: axe scans the page as rendered, and the
narrow-viewport disclosure is closed on every page it has ever scanned.

The test reproduces axe's own measurement as one of its cases — it computes
4.447 for `oklch(0.567 0.148 48.6)` on `accent-soft`, against the 4.43 axe
reported — so a model that drifts from the browser fails rather than quietly
reporting comfort. That case is the anchor: without it, the other twenty-two
would only be proving the test agrees with itself.

#### Local verification, `0c5267d`

Run on the branch at the fix commit, with PostgreSQL and Redis available, and
this time **including all seven browser configurations** — the omission that
let the Phase 1 failure reach CI.

| Gate                  | Result                                                  |
| --------------------- | ------------------------------------------------------- |
| Seven browser configs | 118 + 56 + 48 + 20 + 19 + 13 + 4 = **278**, all passing |
| — accessibility sweep | **56/56**                                               |
| `format:check`        | pass                                                    |
| `policy:check`        | 710 files scanned, no violations                        |
| `secrets:scan`        | 709 tracked files, nothing credential-shaped            |
| `lint`                | pass                                                    |
| `test --force`        | 19/19 tasks                                             |
| `check-skipped-tests` | **5,424 cases, 0 skipped**, up from 5,401               |
| `build --force`       | 3/3 tasks                                               |
| `bundle:scan`         | **349** browser-deliverable files                       |

#### Exact-SHA CI, Phase 1 — the remediation run

**Run `35744421565` on `209cba6` failed, and that is a permanent record of a
real Phase 1 defect.** It was not a flake, not an environmental failure and not
an infrastructure problem: a colour pairing this phase introduced measured
4.43:1 where WCAG 2 AA requires 4.5:1, deterministically, on a commit this phase
pushed. The result above, its root cause and its remediation stay in this
document unchanged. Nothing below replaces them.

What follows is the successor run on the remediation commit.

|            |                                                                      |
| ---------- | -------------------------------------------------------------------- |
| Run ID     | `35748439090`                                                        |
| URL        | https://github.com/KevinD003/desi-event.com/actions/runs/35748439090 |
| Trigger    | `workflow_dispatch`                                                  |
| Attempt    | **1** — no job was rerun                                             |
| head_sha   | `0c5267ded463e3b5a5d29988206882282d51a83b` on all 8 jobs             |
| Started    | 2026-09-22T15:35:35Z                                                 |
| Finished   | 2026-09-22T15:43:24Z                                                 |
| Conclusion | **success**                                                          |

| Job                                      | Conclusion  | Attempt |
| ---------------------------------------- | ----------- | ------- |
| Policy, lint, contract, tests, build     | **success** | 1       |
| Browser — production build               | **success** | 1       |
| Browser — public catalogue               | **success** | 1       |
| Browser — organiser venue maps           | **success** | 1       |
| Browser — event lifecycle                | **success** | 1       |
| Browser — refusals                       | **success** | 1       |
| Browser — commerce and operations detail | **success** | 1       |
| Browser — accessibility sweep            | **success** | 1       |

`head_sha` was read from every one of the eight job records and is
`0c5267ded463e3b5a5d29988206882282d51a83b` on each. The branch head is the same
commit, so the run measured what is on the branch and not a merge ref.

**Every named check that ran against the exact SHA.** Seventeen gates, all in
the `Policy, lint, contract, tests, build` job unless the job column says
otherwise, each reported `success`:

| #   | Step                                | Job               |
| --- | ----------------------------------- | ----------------- |
| 1   | Refuse a stale task cache           | Policy/lint/tests |
| 2   | Language policy                     | Policy/lint/tests |
| 3   | CI invariants                       | Policy/lint/tests |
| 4   | Secret scan                         | Policy/lint/tests |
| 5   | Format check                        | Policy/lint/tests |
| 6   | Lint                                | Policy/lint/tests |
| 7   | Validate API contract               | Policy/lint/tests |
| 8   | Test                                | Policy/lint/tests |
| 9   | Refuse an undeclared skipped test   | Policy/lint/tests |
| 10  | Coverage thresholds                 | Policy/lint/tests |
| 11  | Fresh-database verification         | Policy/lint/tests |
| 12  | Upgrade-database verification       | Policy/lint/tests |
| 13  | OpenAPI drift                       | Policy/lint/tests |
| 14  | Route-manifest drift                | Policy/lint/tests |
| 15  | Browser bundle scan                 | Policy/lint/tests |
| 16  | Dependency audit                    | Policy/lint/tests |
| 17  | Production payments are unreachable | Policy/lint/tests |

Also green in that job: `Build` and `Reliability smoke test`. The seven browser
jobs each ran `Install Chromium`, `Create the test database`, `Apply migrations`
and their one pinned Playwright configuration, all `success`.

**Every skipped step, and why.** Exactly one step name reports `skipped`
anywhere in the run: the failure-artefact upload — `Upload failure artefacts` in
the first job, `Upload Playwright artefacts` in each of the seven browser jobs.
Each is guarded by a failure condition, so a skip there is the positive signal
that the suite passed. Eight skipped steps, eight passing suites. **No gate, no
test step and no verification step was skipped.**

**No failed job was rerun.** `run_attempt` is 1 on the run and on all eight job
records. The green did not come from retrying anything; it came from a new
commit that fixed the defect.

#### The twelve closure conditions

Each was checked against this run rather than assumed.

| #   | Condition                                                     | Evidence                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `head_sha` equals the remediation SHA exactly                 | `0c5267ded463e3b5a5d29988206882282d51a83b` read from the run and from all eight job records                                                                                                                                                                                                                                   |
| 2   | Attempt 1                                                     | `run_attempt: 1` on the run and on every job                                                                                                                                                                                                                                                                                  |
| 3   | All eight required jobs succeed                               | the table above; eight of eight `success`                                                                                                                                                                                                                                                                                     |
| 4   | No job cancelled                                              | every job's conclusion is `success`; none is `cancelled`                                                                                                                                                                                                                                                                      |
| 5   | Every skipped step identified and explained                   | exactly one step name skips anywhere in the run — the failure-artefact upload, in all eight jobs                                                                                                                                                                                                                              |
| 6   | Failure-only uploads distinguished from skipped tests         | `Upload failure artefacts` / `Upload Playwright artefacts` are guarded by a failure condition, so a skip there _is_ the pass signal. **No test step, gate or verification step skipped.**                                                                                                                                     |
| 7   | Nothing silently fails to run                                 | the seventeen gates are enumerated above with the job each ran in; the seven browser configs each ran their pinned suite                                                                                                                                                                                                      |
| 8   | The accessibility sweep runs and passes                       | `Browser — accessibility sweep`, step `Run accessibility sweep`, `success` — the job that failed on `209cba6`                                                                                                                                                                                                                 |
| 9   | The production-build job builds fresh                         | `test:e2e:prod` is `pnpm run build && playwright test --config playwright.production.config.js`; the build runs inside the job, on a clean checkout, every time                                                                                                                                                               |
| 10  | The payment kill switch is enforced                           | `Production payments are unreachable` runs `payment-kill-switch.test.js`; `success`                                                                                                                                                                                                                                           |
| 11  | Database and real-service tests ran with PostgreSQL and Redis | both job groups declare `postgres:16` and `redis:7` service containers with health checks; `Create the test database` and `Apply migrations` succeeded in all eight jobs; `REQUIRE_DATABASE: '1'` is set workflow-wide, so a suite that skipped for want of a database would have **failed**                                  |
| 12  | The skipped-test detector reads fresh reports                 | `Refuse a stale task cache` runs `rm -rf .turbo */.turbo */*/.turbo` at step 7, **before** `Test` at step 16; `Refuse an undeclared skipped test` then consumes the `vitest-report.json` files that step 16 has just written. Fresh by construction, not by luck — this is the trap that caught the local run during Phase 1. |

Condition 12 is worth dwelling on, because the local equivalent failed during
this phase: turbo served eighteen of nineteen cached reports and the skip gate
read a stale picture in which 215 service tests appeared to pass. CI does not
have that failure mode, because it deletes the cache before the run rather than
after.

## Phase 1: **COMPLETE — VERIFIED ON REMEDIATION SHA**

`0c5267ded463e3b5a5d29988206882282d51a83b`, by run `35748439090`,
`workflow_dispatch`, attempt 1, eight of eight jobs green.

The failed run `35744421565` on `209cba6` remains recorded above as a real
Phase 1 defect. Phase 1 is complete because the defect was found, root-caused
from its logs, fixed on a new commit, and verified there — not because the
failure was reinterpreted.

---

## Phase 2 — the attendee ticket wallet, and who actually holds a ticket

Two commits, and the first one is the one that matters.

### The defect, stated plainly

Accepting a transfer mints the recipient's ticket onto the **buyer's order
item**. That is deliberate: `acceptTransfer` reuses `ticket.orderItemId` so the
chain from the original purchase stays unbroken, and `supersedesTicketId` links
the new row to the old.

`toOrder` did this:

```js
const tickets = items.flatMap((item) => item.tickets ?? [])
```

So "the tickets on this order" and "the tickets this buyer holds" had silently
stopped being the same set the moment transfers shipped. The buyer's own order
carried a stranger's ticket — its reference code, the name printed on it, its
status — and an organiser reading the same order saw a ticket attributed to the
wrong person.

Nothing in 1,257 tests caught it. Every ownership test asked about the wallet,
and the wallet filters by `ownerUserId`, which was always correct.

### Ownership rules, before and after

| Question                                           | Before                                       | After                                                      |
| -------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Which tickets appear on an order?                  | every ticket on every line, whoever holds it | only the buyer's own, by `heldByTheBuyer`                  |
| Is a handed-on ticket still on the buyer's order?  | yes, indistinguishable from a live one       | yes, and classified `purchaserHolding: 'TRANSFERRED_AWAY'` |
| Does the recipient's ticket appear there?          | **yes** — code, attendee name and status     | no, and not anywhere in the payload                        |
| Which tickets are in a wallet?                     | `ownerUserId = caller` — already correct     | unchanged                                                  |
| Can a wallet row say which event it is for?        | no                                           | yes, with venue, tier, seat, timings and timezone          |
| Can a wallet tell bought from received?            | no                                           | `holderRelationship`                                       |
| Whose order reference does a received ticket show? | n/a                                          | none — it is the sender's, and is withheld                 |

The rule is one exported comparison, used by both presenters so they cannot
drift:

```js
export function heldByTheBuyer(ticket, order) {
  return (ticket.ownerUserId ?? null) === (order?.userId ?? null)
}
```

**A looser rule was written first and was wrong.** "Both owners known and they
differ" reads stricter than it is: it treats an order with no buyer account as
matching anybody, so on a guest order a ticket transferred to somebody else
stays visible. The test fixtures were manufacturing exactly that state — they
claimed a guest purchase by moving `ownerUserId` and leaving `order.userId`
null, which is a state checkout never produces, because checkout sets
`ownerUserId: order.userId ?? null`. The fixtures now move both, through a
shared `claim` helper. A fixture rehearsing an impossible state is a fixture
that hides the rule it exists to exercise.

The buyer keeps their own handed-on ticket. It is their purchase history, and
dropping it would replace one untruth with another.

### The four concepts, now separated

| Concept             | Where it is answered                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Purchase history    | `GET /v1/orders/:reference` — the buyer's own tickets, `transferredAway` marking the ones handed on                |
| Current ownership   | `GET /v1/tickets` — `ownerUserId = caller`, with `holderRelationship`                                              |
| Transfer history    | `GET /v1/tickets/:id` — every transfer, oldest first, recipients masked                                            |
| Admission authority | `admits` and `admissionRefusal` on every wallet row, from `admissionRefusal`, the same pure function the door runs |

The last one is the one worth naming: a refunded ticket is owned, was bought,
and was never transferred — and admits nobody. It is not derivable from the
other three, and a browser that recomputed it from the status would disagree
with the scanner in front of a queue.

### API, schema and presenter changes

| Thing                                  | Change                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `walletTicketSchema`                   | new — `ticketSchema` plus event, venue, tier, seat, relationship, admissibility, pending transfer |
| `orderTicketSchema`                    | new — `ticketSchema` plus `purchaserHolding` and `supersededByLaterTicket`                        |
| `purchaserHoldingSchema`               | new — `HELD` \| `TRANSFERRED_AWAY`                                                                |
| `holderRelationshipSchema`             | new — `PURCHASED` \| `RECEIVED`                                                                   |
| `ticketPassResponseSchema`             | new — the one response that carries a credential on demand                                        |
| `myTicketListResponseSchema`           | `ticketSchema[]` → `walletTicketSchema[]`                                                         |
| `orderWithItemsSchema`                 | `tickets: ticketSchema[]` → `orderTicketSchema[]`                                                 |
| `toWalletTicket` + `WALLET_INCLUDE`    | new, and deliberately in the same module: the join is half of the presenter's contract            |
| `toOrder`                              | filters by `heldByTheBuyer`, projects through `toOrderTicket`                                     |
| `heldByTheBuyer`                       | new, exported, shared                                                                             |
| `GET /v1/tickets/:id/pass`             | new route, 132nd operation                                                                        |
| `AUDIT_ACTIONS.TICKET_PASS_ISSUED`     | new                                                                                               |
| `DEFAULT_PASS_LIMIT` / `passRateLimit` | new — 30 a minute                                                                                 |

No migration. No schema change. Everything the wallet now shows was already
reachable by relation and simply never read.

### Why the classification is an enum, and what it is _not_ derived from

The brief warned against assuming `ticket.ownerUserId !== order.userId` is
sufficient. It is not, and the reason is sharper than "there are edge cases":

**`Ticket.ownerUserId` is never mutated in place and `Order.userId` is never
updated after creation.** The two columns can therefore diverge through exactly
one operation — `acceptTransfer` minting a new row, owned by the recipient, onto
the buyer's order item. Every state in the matrix is a consequence of that single
divergence.

So the predicate is a **sound test of "whose row is this"** — which is what the
order presenter's filter needs, and it holds in all ten states including the
guest order where both columns are null. And it is a **useless test of "has this
ticket been handed on"**, because `acceptTransfer` leaves the sender's row owned
by the sender. In states 2, 6, 7 and 8 there is demonstrably a transfer and the
owner columns are _equal_.

`purchaserHolding` is therefore derived from `Ticket.status` and never from the
owner columns, and it is an enum rather than a Boolean because naming the values
forces the question to be asked out loud. A test asserts the falsification
directly: a handed-away ticket whose `ownerUserId` still equals the buyer's must
come back `TRANSFERRED_AWAY`.

`supersededByLaterTicket` exists because of state 6. Handing a ticket out and
getting it back leaves **three** rows against a quantity of one, two of them the
buyer's. Without the flag an order for one ticket appears to list two. It is
computed from the rows already loaded — a later ticket whose `supersedesTicketId`
names this one — so it costs no extra query.

### `heldByTheBuyer` now refuses a partial select

The audit found a real hole in the function this phase introduced. The
comparison normalises `undefined` to `null` on both sides, so a ticket fetched
with a `select` that omitted `ownerUserId` would read as a guest's and pass the
filter — reopening the exact leak the strict form closes, silently, because the
function takes plain objects and could assert nothing about them. `WALLET_INCLUDE`
already selects a narrow order, so this is a pattern the codebase has rather than
a hypothetical. It now throws on either missing column, and two tests pin it.

### Statuses the wallet will not name

`TicketStatus` declares nine values. An audit of every writer in `apps/api/src`,
`apps/worker/src` and `packages/*` found application code for six:

| Reachable          | Written by                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| `VALID`            | checkout issuance, the worker's bulk issuance, a minted transfer, a returned invitation |
| `TRANSFER_PENDING` | `startTransfer`                                                                         |
| `CHECKED_IN`       | `admit`                                                                                 |
| `TRANSFERRED`      | `acceptTransfer`                                                                        |
| `REVOKED`          | `revokeTicket`                                                                          |
| `REFUNDED`         | the refund service, by its own conditional update                                       |

**`VOID`, `SUPERSEDED` and `CANCELLED` have no writer at all.** `SUPERSEDED` and
`CANCELLED` are declared as legal targets in the transition table and never
used; `VOID` is not even a target. There is no reissue endpoint, and cancelling
an event raises refunds and notifications without touching a `Ticket` row. The
wallet named all nine and now names six; anything else renders as its raw value,
because the demo seed writes `VOID` directly and a demo database really can
contain one. Showing `VOID` unadorned is honest where "This ticket is void."
would imply the application can produce it.

### Secure pass: **COMPLETE at the API, DEFERRED in the browser**

The architecture already supported this and the Phase 4 plan had not noticed.
`Ticket.credentialHash` stores a SHA-256 and nothing else, and the credential
is _derived_ rather than generated:

```
credential = base64url(HMAC-SHA256(HKDF(AUTH_SECRET, "ticket-pass-v1"), ticketId + ":" + version))
```

So the server can recompute any holder's pass without ever having stored it,
and bumping `credentialVersion` changes both the credential and its digest —
which is why accepting a transfer kills the former holder's pass rather than
merely marking it stale.

Every guarantee the brief asked for, and where it is enforced:

| Requirement                                                                  | How                                                                                                                               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Holder only                                                                  | `assertHolds`, which answers **404** — identical to an invented id                                                                |
| High-entropy                                                                 | 256 bits of HMAC output, 43 base64url characters                                                                                  |
| Server-validated                                                             | derived, then `credentialMatches` against the stored digest; a mismatch is refused rather than handed over to fail at a turnstile |
| Private, never cached                                                        | `cache-control: no-store, private` and `pragma: no-cache`                                                                         |
| Not in a list response                                                       | `walletTicketSchema` declares no credential field; asserted directly                                                              |
| Not in a URL                                                                 | it is a response body; the path carries only the ticket id                                                                        |
| Not in logs                                                                  | nothing logs it; the error branch logs the id and the version                                                                     |
| Not in audit metadata                                                        | the audit row carries the version and the instant; asserted directly                                                              |
| Not in browser storage or server-rendered HTML                               | no browser surface calls it — see below                                                                                           |
| Refused for transferred away, revoked, refunded, cancelled, void, superseded | `admissionRefusal`, the door's own function                                                                                       |
| Refused for an unpaid order                                                  | same function                                                                                                                     |
| Invalidated on ownership change                                              | `acceptTransfer` clears the digest and increments the version                                                                     |
| Rotation and versioning                                                      | `credentialVersion`, already present                                                                                              |
| Rate-limited                                                                 | 30 a minute, per route                                                                                                            |
| Audited without the secret                                                   | `ticket.pass_issued`                                                                                                              |

**What is deferred, and exactly why.** The QR _image_. There is no QR encoder in
this repository, and there are two ways to get one — add a dependency, or write
one. Adding a runtime dependency to the browser bundle is a supply-chain
decision the owner has not been asked for. Writing one means Reed–Solomon over
GF(256), bit interleaving, matrix placement and mask selection, and **it cannot
be verified here**: there is no decoder to check it against and no trusted
vectors in the tree, so the honest outcome would be a pass that might not scan
at a door where nobody can fix it.

**What was deliberately not shipped instead.** Rendering the raw credential as
text in the wallet. It is the obvious substitute and it is a worse one: as
screenshot-able as a QR, useless at a turnstile, and squarely the "insecure
substitute" the owner decision rules out. The wallet therefore does not call
the pass endpoint at all, and the browser spec asserts the negative — no
credential, no digest, no derivation label anywhere in the markup.

The wallet also says nothing _about_ the pass — not even "your pass is ready".
That is a sentence somebody would reasonably expect to act on, and there is
nothing to act on yet. What is on the card is the human-readable reference code,
which admits nobody by itself and is what a steward asks for.

The consequence, stated rather than buried: **`GET /v1/tickets/:id/pass` has no
browser consumer in Phase 2.** It is proven, guarded and tested, and it is what
a QR renderer or the Phase 3 scanner will call. Unblocking it is one owner
decision: whether a QR encoder may be added as a dependency.

### Group booking

Untouched, per the owner decision. `OrderItem.quantity` remains a quantity, and
nothing in this phase presents it as a group-booking feature.
**BACKEND NOT IMPLEMENTED.**

### Payments

`PAYMENT_MODE=MOCK` throughout. Nothing in this phase touches payments, Stripe,
Connect, payouts, refunds settlement or provider credentials. No response added
here carries `connectedAccountId`, `providerPayoutId` or any provider field.
Every real Stripe and Stripe Connect operation remains
**EXTERNAL VERIFICATION PENDING**.

### The wallet screen

Three sections rather than four. Coming up, handed on, past and finished.

A ticket somebody gave you is also a ticket you are going to use, so it belongs
under "coming up" with a line saying where it came from — a fourth bucket for
transferred-in tickets would list it twice and tell somebody they hold more
tickets than they do. How many arrived that way is stated as a figure instead.
That is a deliberate reading of the brief's four groups, recorded here rather
than assumed.

"Handed on" is its own section and not part of "past", because the event has
not happened: what changed is who holds it, and filing it under the past would
tell somebody the night is over when they gave their ticket away.

`lib/wallet.js` holds the rules as pure functions so each one is testable
without a browser. The two worth naming:

- **Bucketing is on `endsAt`, not `startsAt`.** A ticket does not become a
  souvenir when the doors open; somebody arriving late still has to find it.
- **`admits` comes from the server and is never recomputed.** A browser deciding
  admissibility from the status is a browser that disagrees with the scanner in
  front of a queue. A case asserts this with a status the module has never heard
  of and `admits: false`.

Times render in the **event's** timezone, not the reader's. A browser in London
printing its own local time for a night in Pune sends somebody to the wrong
hour, and a test pins it.

### Transfer experience

Unchanged and already complete: initiate, accept, decline, cancel, view status,
each backed by a route that exists. No recipient-preview was added, because no
safe non-mutating backend route for one exists and the brief forbids inventing
the experience without it. The invitation token remains out of every URL, page
title, analytics call and browser store — it goes to the recipient once and the
database holds only its digest.

### Tests added

| Where                                       | Cases | What they are for                                                              |
| ------------------------------------------- | ----: | ------------------------------------------------------------------------------ |
| `apps/api/tests/ticket-wallet.test.js`      |    44 | ownership regression, wallet shape, ten authorisation scenarios, pass security |
| `apps/api/tests/ticket-concurrency.test.js` |    +3 | ownership across a real handover, two accepts racing, a decline                |
| `apps/web/src/lib/wallet.test.js`           |    20 | bucketing, ordering, timezone, seat and venue text                             |
| `apps/web/e2e/detail-ticket-wallet.spec.js` |    15 | the rendered wallet, seven widths, 200% reflow, keyboard, reduced motion       |
| `apps/web/e2e/accessibility-sweep.spec.js`  |    +4 | the wallet under axe at three viewports, and at 200% zoom                      |

**The regression was falsified twice.** Reverting `toOrder` to
`items.flatMap((item) => item.tickets ?? [])`:

- against the stub, `demonstrates the defect this replaced` returns
  `['tkt_old', 'tkt_theirs']` where it expects `['tkt_old']`;
- against real PostgreSQL, through the real `acceptTransfer`,
  `moves the ticket between wallets and keeps it off the wrong order` finds the
  recipient's minted row back on the sender's order.

A second, independent gate showed up in the same experiment: with the filter
reverted the checkout route answers **500** rather than leaking, because
`orderTicketSchema` requires `transferredAway` and the bare rows do not have it.
Two gates, and the test asserts on the first.

The ten authorisation scenarios the brief named, and where each is proven:

| Scenario                                                           | Result                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| Current holder can list and view their ticket                      | 200                                                    |
| Original purchaser cannot retrieve pass information after transfer | 409 on their own row, 404 on the recipient's           |
| Transfer recipient receives the ticket after acceptance            | appears in their wallet, `RECEIVED`                    |
| Pending transfer does not create dual admission authority          | one row, sender still admits, recipient's wallet empty |
| Cancelled or declined transfer preserves the holder                | back to `VALID`, pass unrotated                        |
| User A cannot access User B's ticket                               | 404, byte-identical to an invented id                  |
| Organisation A cannot act on organisation B's ticket               | refused                                                |
| Anonymous access fails correctly                                   | 401 on list, detail and pass                           |
| Platform or organiser capability does not confer holding           | 404 on the pass, `holder: false` on the detail         |
| List totals do not leak outside the caller's scope                 | `pagination.total` counts only theirs                  |

### Collection proof

`detail-ticket-wallet.spec.js` is matched by `playwright.detail.config.js`
(`testMatch: '**/detail-*.spec.js'`), which is the config the required CI
context **Browser — commerce and operations detail** runs. `--list` against that
config reports its 15 cases. The accessibility additions live in the pinned
`accessibility-sweep.spec.js`, run by **Browser — accessibility sweep**.

No new Playwright configuration, no new CI job, no ninth required context. No
test in this phase is collected by nothing.

### Two mistakes this phase made, and how they surfaced

**A stale backup silently reverted a refactor.** Falsifying the ownership fix
meant reverting `presenters.js` and restoring it afterwards. The backup had been
taken before `WALLET_INCLUDE` was moved into that module, so restoring it
removed the export while the route still imported it — `include: undefined`,
every relation null, eight tests failing with `Cannot read properties of null`.
It was mistaken for an environment effect for one run because the failures
appeared under `REQUIRE_DATABASE=1`, and the flag had nothing to do with it. The
lesson is narrow and worth keeping: re-take the backup, or revert with `git`
rather than a copy.

**Two browser-test assertions were wrong, and the code was right both times.**
The first hard-coded an event title the seed generates per run. The second
asserted the substring `credential` was absent from the page — Next.js emits
`credentials:'same-origin'` in its own prefetch script, so it is present on
every page this application serves, leak or no leak. Both were corrected in the
test rather than worked around in the product, and the second is now the JSON
key form, which is how the value would actually appear.

### A third mistake, and the one most worth keeping

**The skipped-test gate read stale reports, and I reported its number as this
run's.** `pnpm test --force` genuinely ran all nineteen tasks, but the turbo
`test` task does not emit `vitest-report.json` — CI passes
`--reporter=json --outputFile.json=vitest-report.json` explicitly in its `Test`
step. So `check-skipped-tests.mjs` read files timestamped from the Phase 1 run
hours earlier and reported that run's figure. The tell was there and I walked
past it: the count was _identical_ to Phase 1's despite roughly eighty new
tests.

Nothing was concealed by it — every suite reported green directly, and the
per-package figures quoted elsewhere came from the suites rather than the
reports — but the gate itself was measuring nothing, and it was presented as
though it had measured this run.

This is a variant of the trap written up in the Phase 1 closure two sections
above. That one was turbo serving cached _task results_; this one is report
files that were never rewritten because nothing asked for them. CI does not have
either failure mode, for the reason condition 12 records. The local sequence now
deletes the reports before regenerating them with the reporter flags CI uses,
which is the only way the local gate and the CI gate are asking the same
question.

### Local verification, Phase 2

Every gate below was run against this tree, and the figures are read from this
run rather than from a cached report — see the mistake recorded above.

| Gate                           | Result                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `format:check`                 | pass                                                                     |
| `policy:check`                 | 714 files scanned, no violations                                         |
| `ci:check`                     | 2 workflows, uploadable artefact names, tasks order their own build      |
| `secrets:scan`                 | 713 tracked files, nothing credential-shaped                             |
| `lint`                         | pass                                                                     |
| `contract:check`               | 132 routes, 132 operations, 118 paths; artefact current                  |
| `test --force`                 | 19/19 tasks                                                              |
| skipped-test detection         | **5,524 cases, 0 skipped, 0 allow-listed, 0 undeclared** — fresh reports |
| `test:coverage`                | 18/18 tasks, no threshold lowered                                        |
| `db:verify:fresh` / `:upgrade` | run as part of the API suite with `REQUIRE_DATABASE=1`                   |
| payment kill switch            | `payment-kill-switch.test.js` green                                      |
| `build --force`                | 3/3 tasks                                                                |
| `bundle:scan`                  | **349** browser-deliverable files, nothing server-only                   |

PostgreSQL and Redis were up throughout; `REQUIRE_DATABASE=1` was set, so any
suite that skipped for want of a database would have failed rather than passed
quietly.

#### All seven browser configurations

Collected and run, not sampled. The collection counts come from
`playwright test --config <c> --list`.

| Configuration                     | Collected | Result         |
| --------------------------------- | --------: | -------------- |
| `playwright.detail.config.js`     |    **67** | 67 passed      |
| `playwright.sweep.config.js`      |        59 | 59 passed      |
| `playwright.events.config.js`     |        20 | 20 passed      |
| `playwright.organizer.config.js`  |        13 | 13 passed      |
| `playwright.refusals.config.js`   |         4 | 4 passed       |
| `playwright.config.js`            |       118 | 118 passed     |
| `playwright.production.config.js` |        19 | 19 passed      |
| **Total**                         |   **300** | **300 passed** |

Collected equals run in every row, which is the point of listing both: a spec
that no configuration matches reports nothing and looks exactly like a spec that
passed.

`detail-ticket-wallet.spec.js` accounts for 19 of the detail configuration's 67,
and the detail configuration is what the required CI context **Browser —
commerce and operations detail** runs. The accessibility additions are in the
pinned `accessibility-sweep.spec.js`, run by **Browser — accessibility sweep**.
No new Playwright configuration, no new CI job, no ninth required context.

#### A fourth mistake: ten background waiters that never finished

Worth recording because it wasted about an hour of wall-clock and was invisible
until somebody looked at the task list. Every wait I set up had the shape:

```sh
until ! pgrep -f "playwright test"; do sleep 10; done
```

`pgrep -f` matches whole command lines — **including the command line of the
shell running the loop**, which contains the string it is searching for. So each
waiter found itself, concluded the work was still running, and waited forever.
The browser matrix, chained behind one of them, never started at all; it was
reported as "running" on the strength of a process list that was showing the
waiter rather than the work. Ten of them accumulated before the failure was
noticed.

### Secure-pass threat assessment

Produced against the implemented endpoint and its credential design. Each of
the twelve areas the brief named, with the code that addresses it or a plain
statement that nothing does.

| #   | Area                          | Verdict                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Credential retrieval          | **Holder only.** `auth: 'session'` installs the guard as an `onRequest` hook, before the body is parsed; the handler then compares `ownerUserId` to the actor and answers **404** for every other case.                                                                                                                                                          |
| 2   | Replay                        | **Not defended here, and deliberately.** The credential is deterministic on `(ticketId, version)`, so it is byte-identical on every retrieval — that is what lets an attendee reopen their ticket. Replay is stopped one layer down: exactly one `CheckIn` row per ticket, enforced by a unique index and a trigger.                                             |
| 3   | Transfer invalidation         | **Effective.** `acceptTransfer` nulls `credentialHash` and increments `credentialVersion` in the same conditional update that moves the row to `TRANSFERRED`, so the sender's screenshot resolves to no row at all.                                                                                                                                              |
| 4   | Rotation and versioning       | **Partial — see the findings below.** The version is an HMAC input, so bumping it rotates the pass, but it is bumped only by transfer, revocation and (now) refund. There is no reissue endpoint.                                                                                                                                                                |
| 5   | Cache behaviour               | **`no-store, private` plus `pragma: no-cache`,** set on the reply. No `onSend` or `onResponse` hook anywhere can overwrite them, and the same-origin proxy forwards `cache-control`.                                                                                                                                                                             |
| 6   | Logs and telemetry            | **No logger call can reach it.** The success path logs nothing; the one `request.log.error` carries `{ ticketId, credentialVersion }`; the URL holds no secret. The shared redaction net had **no entry for it at all** — now fixed.                                                                                                                             |
| 7   | Screenshots and serialization | **Nothing renders it.** No first-party surface calls the endpoint; the browser spec asserts `"credential"`, `credentialHash`, `credentialVersion`, `credentialIssuedAt` and `ticket-pass-v1` appear nowhere in the markup at seven widths. Nothing can undo a leak once a person photographs their own screen; rotation is the only answer, and see finding S-4. |
| 8   | Rate limiting                 | **30 a minute per route — keyed on IP.** See finding S-6: that is the wrong key for this threat.                                                                                                                                                                                                                                                                 |
| 9   | Revocation and refund         | **Now symmetric.** Revocation always killed the credential; refund did not. Fixed this phase.                                                                                                                                                                                                                                                                    |
| 10  | Concurrent transfer/check-in  | **Confidentiality holds; see findings S-2 and S-3.** A pass read racing an accept can return a string that is already dead — harmless — and a deeper race in `acceptTransfer` itself is a real defect.                                                                                                                                                           |
| 11  | Cross-user access             | **404, with no capability escape hatch.** An organiser holding `ticket:revoke` over the same ticket, and a platform administrator holding every capability, both get 404. Tested.                                                                                                                                                                                |
| 12  | Cross-tenant access           | **No tenant dimension exists on this decision.** The check is ownership alone and consults no `organizationId`, so there is no scope to omit. Stricter than the sibling routes, which do scope by tenant.                                                                                                                                                        |

### Security findings

Four were fixed in this phase because they are the pass boundary itself or code
this phase wrote. The rest are recorded, not fixed: each needs a decision or a
slice of its own, and quietly widening Phase 2 to cover them would be the kind
of scope drift that makes a phase unreviewable.

#### Fixed here

**S-A — the pass endpoint was an existence oracle for guest tickets.**
`assertHolds` is written for the transfer routes, where a ticket bought without
an account deserves a distinct 403 telling somebody to claim it. On the pass
route that 403 meant a guest ticket's id answered differently from an id nobody
had ever used, so anybody could learn which identifiers named a real unclaimed
ticket — and the route's own comment claimed the opposite. The three cases now
collapse into one 404. Falsified: restoring `assertHolds` returns 403 where the
test demands 404.

**S-B — the shared redaction net had no entry for the credential.**
`packages/logger` exists so that credentials never reach a log sink even when a
handler logs a whole row by accident. Its key lists covered `password`, `token`,
`secret`, `otp`, `cvv` and more — and nothing pass-shaped. `credential` and
`credentialHash` are now in both the field list and the wildcard list; the
wildcard matters because `req.body.credential` is exactly the shape the check-in
route produces.

**S-C — a refunded ticket kept a live credential.** `revokeTicket` has always
nulled the digest and bumped the version; the refund path wrote only the status,
so a refunded ticket's QR still resolved to its row. Every gate refused it, so
this was an asymmetry rather than an open door — and it sat where a reader would
assume symmetry. It matters most for a ticket transferred away before the
refund: the allocator selects by order item and status and never reads
ownership, so the row refunded can be the _recipient's_. Fixed, and falsified
against real PostgreSQL.

**S-D — two refusals advised a remedy that does not exist.** Both said "Ask the
organiser to reissue it." There is no reissue endpoint anywhere in the contract.

**S-E — the transfer history did not link to the ticket a transfer became.**
`tickets.get` has always returned `resultTicketId` on an accepted transfer, and
the page ignored it. For an organiser that meant the one row they can actually
revoke — the recipient's — was reachable by reading the JSON and not by
clicking. One link closes it, and it exposes nothing new: the id was already in
the payload, and the route already refuses everybody who is neither the holder
nor an actor with `ticket:revoke`.

#### Recorded, not fixed

| Id   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why not now                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | **A reserved-seat ticket cannot be transferred at all.** `acceptTransfer` copies `eventSeatId` onto the new row while the old row still holds it, and the column is `@unique`. The insert raises `P2002` and the whole accept rolls back. Every transfer test uses general admission, so nothing caught it.                                                                                                                                                                                                                                                                                                                             | Fixing it needs seat-inventory reasoning — does the seat stay `SOLD`, does `EventSeat.orderItemId` move — and deserves its own slice with its own races. |
| S-2  | **An accept racing a check-in can commit a transfer that hands over nothing.** The transfer row is flipped to `ACCEPTED` before the ticket is transitioned; if a check-in lands between, the transition fails, no ticket is minted, and the recipient can never retry.                                                                                                                                                                                                                                                                                                                                                                  | A transaction-ordering change in the middle of the admission path. Needs its own concurrency proof.                                                      |
| S-3  | A pass read racing an accept can return a credential that is already dead. Confidentiality is intact — the string opens nothing — but the endpoint's promise that it never hands over a pass the door would reject is broken for one instant.                                                                                                                                                                                                                                                                                                                                                                                           | A read-inside-transaction change; low value next to S-2, same code.                                                                                      |
| S-4  | **Rotating `AUTH_SECRET` is backwards.** The stored digest is of the _old_ credential, so after a rotation every legitimate holder is refused while an attacker's existing screenshot still resolves at the door.                                                                                                                                                                                                                                                                                                                                                                                                                       | A credential-design decision, and the brief's own `BLOCKED — REQUIRES DEDICATED CREDENTIAL-DESIGN WORK` category fits it exactly.                        |
| S-5  | **There is no reissue endpoint**, so a holder whose pass has leaked has no way to rotate it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Same slice as S-4.                                                                                                                                       |
| S-6  | **The pass rate limit is keyed on IP** with `trustProxy: false`, so behind any ingress the whole deployment shares one 30/minute budget while a session thief on a different address gets their own.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Changing the key generator affects every rate-limited route, including the credential endpoints. Needs its own change and its own evidence.              |
| S-7  | **Revoking a ticket leaves its PENDING transfer and live token in place.** The recipient is stopped only by the route's status guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Transfer-lifecycle work; pairs naturally with S-8.                                                                                                       |
| S-8  | **Transfer expiry is dead code.** Nothing writes `EXPIRED` and no worker sweeps lapsed invitations, so a lapsed invitation stays `PENDING` forever and the holder's only exit is to withdraw it.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Needs a worker job, which is a Phase 3/4 concern.                                                                                                        |
| S-9  | **A refund of a transferred-away ticket silently refunds the recipient's row** and notifies nobody.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Needs a notification and a policy decision about who is entitled to what.                                                                                |
| S-10 | **There is no guest claim endpoint,** although `assertHolds` tells guests to claim their ticket. An unclaimed guest ticket is permanently untransferable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A new flow, not a fix.                                                                                                                                   |
| S-11 | ~~An organiser reading a buyer's order cannot reach the recipient's ticket id to revoke it.~~ **Withdrawn — this was wrong, and adversarial verification caught it.** The order carries the sender's ticket id; `tickets.get` accepts it from any actor holding `ticket:revoke`; and its `transfers[]` carries the ACCEPTED transfer whose `resultTicketId` _is_ the recipient's ticket. The path existed over the API the whole time. The real gap was narrower: the detail page did not render `resultTicketId`, so the hop was not clickable. **Fixed this phase** — the transfer history now links to the ticket a transfer became. |
| S-12 | `buyerEmail` is a declared field of `orderSchema` and is returned on the order response to the buyer and to any holder of `order:view`. By design, and out of the wallet's scope — the wallet response does not carry it, and the Prisma select does not even fetch it.                                                                                                                                                                                                                                                                                                                                                                 | Changing a long-standing declared contract field needs owner authorization.                                                                              |

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
