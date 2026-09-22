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

| Where                                          | Cases | What they are for                                                              |
| ---------------------------------------------- | ----: | ------------------------------------------------------------------------------ |
| `apps/api/tests/ticket-wallet.test.js`         |    60 | ownership regression, wallet shape, ten authorisation scenarios, pass security |
| `apps/api/tests/ticket-concurrency.test.js`    |    +3 | ownership across a real handover, two accepts racing, a decline                |
| `apps/api/tests/settlement-invariants.test.js` |    14 | the transfer-lineage settlement invariant — see the remediation section below  |
| `apps/web/src/lib/wallet.test.js`              |    27 | bucketing, ordering, timezone, seat and venue text                             |
| `apps/web/e2e/detail-ticket-wallet.spec.js`    |    19 | the rendered wallet, seven widths, 200% reflow, keyboard, reduced motion       |
| `apps/web/e2e/accessibility-sweep.spec.js`     |    +3 | the wallet under axe at phone, tablet and desktop                              |

**The regression was falsified twice.** Reverting `toOrder` to
`items.flatMap((item) => item.tickets ?? [])`:

- against the stub, `demonstrates the defect this replaced` returns
  `['tkt_old', 'tkt_theirs']` where it expects `['tkt_old']`;
- against real PostgreSQL, through the real `acceptTransfer`,
  `moves the ticket between wallets and keeps it off the wrong order` finds the
  recipient's minted row back on the sender's order.

A second, independent gate showed up in the same experiment: with the filter
reverted the checkout route answers **500** rather than leaking, because
`orderTicketSchema` requires `purchaserHolding` and the bare rows do not have it.
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

### Exact-SHA CI, Phase 2 — a real regression, and two corrections

**Run 35762869262, `0532905118c344342e29066a71a2a35d6ac19d91`, `workflow_dispatch`,
attempt 1: FAILURE.** This is a genuine Phase 2 regression and is recorded here
permanently. It was not a flake, not an environmental effect, and not something
a rerun would have cleared; it was deterministic, it was caused by this branch,
and it was root-caused from the logs rather than by dispatching the same SHA
again.

Seven of eight jobs were green, including all seven browser configurations. The
eighth, **Policy, lint, contract, tests, build**, failed at step 27,
_Reliability smoke test_:

```
✗ INVARIANT BROKEN — no duplicate settlement: 31 line(s) hold more tickets than they bought
```

#### The chronology, in order

| #   | What happened                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Phase 2 pushed as `0532905118c344342e29066a71a2a35d6ac19d91`.                                                                                                                                                     |
| 2   | Exact-SHA CI run **35762869262** dispatched on it. Seven of eight jobs green, all seven browser configurations among them — 300 collected, 300 run, 300 passed.                                                   |
| 3   | The eighth job failed at step 27, _Reliability smoke test_, on `no duplicate settlement`.                                                                                                                         |
| 4   | Root-caused from the job logs. The SHA was **not** re-dispatched to see whether it would pass.                                                                                                                    |
| 5   | Reproduced locally at the first attempt, which is what established it as deterministic rather than a race.                                                                                                        |
| 6   | Measured rather than assumed: 62 tickets across the 31 offending lines, of which **exactly 31** carry `supersedesTicketId` — one transfer-minted row per line, and no row any other story explains.               |
| 7   | First correction, `dbb5957c5a15e359b84b4677383ff78260da09d4`: count terminal members of a supersession chain instead of ticket rows.                                                                              |
| 8   | Falsified both ways — the scenario passes against a database holding 31 real chains, and fails the moment a planted non-superseding second ticket is inserted on a quantity-1 line. Probe deleted.                |
| 9   | Exact-SHA CI run **35772861864** on `dbb5957`: **all eight jobs green, attempt 1.**                                                                                                                               |
| 10  | The owner declined to accept that as sufficient and asked whether counting terminal members is the correct business invariant or merely a query that makes the current fixture pass.                              |
| 11  | Re-examination found **three holes in that correction**, set out below. They were found by mutating the query and watching which cases stayed green, not by reasoning about it.                                   |
| 12  | Second correction, `2e22e15b917d49134ecfbb94ce43db9c34b6b47c`: three checks rather than one, and failure messages that name the offending rows.                                                                   |
| 13  | A fourteen-case suite written against real PostgreSQL. Three defects in the **test harness** were found and fixed before it could be trusted — recorded below, because each would have read as a product failure. |
| 14  | Mutation testing across five mutations. One mutation survived the suite; case 8b was added to catch it, and only then did every clause have a case that isolates it.                                              |
| 15  | Exact-SHA CI run **35776856187** on `2e22e15`: **all eight jobs green, attempt 1**, step 27 included.                                                                                                             |

#### What the old invariant was for, and what it got wrong

The check was not gratuitous and its intention was right: it exists to catch
**duplicate settlement** — an order line paid for once that somehow issued
admission more than once. That is a real hazard and the check still guards it.

What it did was count ticket **rows** against `OrderItem.quantity`. That was a
correct implementation of the intention _before transfers existed_, when a line
held exactly the rows checkout issued. It became false when transfers shipped.
`acceptTransfer` mints the recipient's ticket onto the **buyer's** order item —
same `orderItemId`, new row, `supersedesTicketId` naming the row it replaces —
so that the lineage back to the original purchase stays unbroken and auditable.
A line for one ticket handed on once therefore holds two rows, and one handed on
and back holds three, every one of them legitimate.

So the defect is precise: the query **incorrectly treated historical transfer
rows as independent purchased admissions**. It did not have the wrong goal; it
had a measure that stopped tracking the goal the day the lineage model arrived.

It had been wrong since transfers shipped. What changed in Phase 2 is that it
finally had a deterministic accepted transfer in front of it: the pre-existing
concurrency tests only ever _raced_ an accept against a check-in or a refund, so
the accept frequently lost and minted nothing, while the Phase 2 tests assert
that exactly one accept succeeds. That is the difference between a database with
no accepted transfers in it and one with 31.

#### Vocabulary

Stated once, in `scripts/load/invariants.js` and used identically in the tests,
because an ambiguous word here becomes a settlement or admission defect later.

| Term                                       | Meaning                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **chain root**                             | The ticket issued by checkout. Its `supersedesTicketId` is null.                             |
| **predecessor**                            | A ticket that another ticket supersedes.                                                     |
| **successor**                              | The ticket minted to replace a predecessor; its `supersedesTicketId` names that predecessor. |
| **terminal member** (= **current member**) | A ticket with no successor. It is the row that represents the lineage now.                   |

**"Chain head" is deliberately not used.** Nothing else in this repository
defines the word, and it reads as the _root_ to as many people as it reads as
the terminal. The first correction's commit message used it, and that is exactly
the ambiguity the owner warned would cause a future settlement or admission
defect.

#### The safety property being asserted

> For each purchased order line, the number of independent current ticket chains
> — and therefore the greatest number of tickets that could carry current
> admission authority — must not exceed the quantity purchased.

#### The three holes in the first correction

**H-1 — the successor lookup was not scoped to the line.** A successor anywhere
in the table marked a ticket historical. A line holding three independent
tickets against two sold, one of which was reached across from another line,
therefore reported two current tickets and passed — while holding three ways in.
The lookup now requires predecessor and successor to sit on the **same order
item**.

**H-2 — a lineage cycle reported no current member and passed.**
`Ticket_supersedesTicketId_key` stops two successors sharing a predecessor and
`Ticket_supersedesTicketId_fkey` stops a dangling reference, but neither forbids
A superseding B while B supersedes A. Every member then has a successor, the
line reports **zero** terminal members, and zero is not greater than the
quantity. A paid line holding tickets and no current member is now a failure in
its own right, reported in its own sentence.

**H-3 — a place in a lineage is not what opens a door.** `findTicketForScan`
resolves a presented pass by `credentialHash`, so **any** row holding a digest
admits somebody. Two live digests inside one lineage is two admissions for one
purchase and exactly one terminal member, so the terminal count reports one and
passes. `no surplus admission authority` counts what can actually be scanned.

Cross-line supersession is additionally named as itself rather than left to
surface as an odd count, because "this line oversold" and "this lineage crossed
purchases" need different answers from whoever reads the failure.

#### The fifteen cases, and where each is proved

`apps/api/tests/settlement-invariants.test.js`, against real PostgreSQL —
`REQUIRE_DATABASE=1`, so an unreachable database fails rather than skips.

| #   | Case                                                    | Outcome required                       | Where                                                    |
| --- | ------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| 1   | One bought, never transferred                           | pass                                   | case 1                                                   |
| 2   | One bought, transferred once                            | pass                                   | case 2                                                   |
| 3   | One bought, transferred repeatedly                      | pass                                   | case 3                                                   |
| 4   | Quantity 2, each unit with its own valid chain          | pass                                   | case 4                                                   |
| 5   | Two independent current tickets against a quantity of 1 | **reject**                             | case 5                                                   |
| 6   | A branching successor                                   | **impossible**                         | case 6/7 — `Ticket_supersedesTicketId_key`               |
| 7   | Two successors sharing one predecessor                  | **impossible**                         | case 6/7 — the same unique index; one write, one refusal |
| 8   | A successor on another purchased line                   | **reject**                             | case 8 — `no cross-lineage supersession`                 |
| 8b  | A line's own over-issue concealed by a reach across     | **reject**                             | case 8b — the case that isolates the scoping             |
| 10  | A successor naming a ticket that does not exist         | **impossible**                         | case 10 — `Ticket_supersedesTicketId_fkey`               |
| 10b | Deleting a predecessor                                  | sets the reference null, never orphans | case 10b — the same key, `ON DELETE SET NULL`            |
| 11  | A lineage cycle                                         | **reject**                             | case 11, reported as a cycle and not as a surplus        |
| 12  | Two usable credentials inside one lineage               | **reject**                             | case 12 — `no surplus admission authority`               |
| 13  | A refunded lineage                                      | pass, and no usable pass left          | case 13                                                  |
| 14  | A reserved-seat lineage                                 | **unconstructable** — see below        | case 14                                                  |
| 15  | Concurrent transfer acceptance                          | one current chain, one usable pass     | `ticket-concurrency.test.js`, the raced accept           |

#### Schema constraints cited, and demonstrated rather than assumed

Three of the enumerated cases are not the invariant's job because the table does
not permit them. Each is proved by a regression test that makes the write and
asserts the exact constraint name, so a migration that dropped one would fail
here rather than silently widen what the invariant has to catch.

| Constraint                       | Declared in                                                                 | What it guarantees                                                                                                             | Proved by     |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `Ticket_supersedesTicketId_key`  | `20260915010000_phase2_commerce_and_operations/migration.sql`, unique index | At most one successor per predecessor. Cases 6 and 7 are the same write, and it is refused.                                    | case 6/7      |
| `Ticket_supersedesTicketId_fkey` | the same migration, `FOREIGN KEY … ON DELETE SET NULL`                      | A successor cannot name a ticket that does not exist, and deleting a predecessor nulls the reference rather than stranding it. | cases 10, 10b |
| `Ticket_eventSeatId_key`         | the same migration, unique index                                            | Two tickets cannot hold one seat — which is what makes a reserved-seat transfer impossible.                                    | case 14       |

Neither of the first two forbids a cross-item supersession or a cycle, which is
precisely why H-1 and H-2 are the invariant's work and not the schema's.

#### Case 14 does not conceal the reserved-seat defect

`acceptTransfer` mints the successor with `eventSeatId: ticket.eventSeatId`
while the predecessor still holds that seat, and nothing on the predecessor
clears it — the transition writes only `credentialHash` and `credentialVersion`.
Because `Ticket.eventSeatId` is unique, the create violates
`Ticket_eventSeatId_key` and the whole transfer transaction aborts. This is
finding S-1, and case 14 demonstrates it against real PostgreSQL rather than
asserting it from a reading of the code.

The consequence for the invariant has to be said plainly: **no seated lineage of
more than one member can exist in the table**, so the settlement checks never
meet one, and their passing on seated lines says nothing whatever about whether
reserved-seat transfer is correct. It is not coverage. A case that built a
seated chain by hand and watched the invariant accept it would read as though
this worked, which is the one thing case 14 must not do. When S-1 is fixed, case
14 fails — and that is the point: whoever fixes it is told that the invariant
now has a shape to check.

#### Mutation testing: does each clause earn its place?

A suite that passes proves nothing on its own. Each clause of the corrected
check was removed or reverted in turn and the suite re-run, to see which cases
go red. The good file was restored from a copy taken beforehand and verified by
checksum after each round, because `git checkout` would have discarded the
uncommitted work — a mistake already made once this session.

| Mutation                                             | Cases that fail                     | Reading                                                                                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** — count ticket rows, as before the remediation | 9 of 14, including cases 1–4 and 13 | Reproduces the original CI failure against this database. The acceptance cases fail because the check is database-wide and the shared database holds real transfer chains.                                |
| **B** — successor lookup unscoped                    | 8b only                             | Initially **nothing failed.** Case 8 passes either way, because the line reached across drops to no current member and the cycle clause catches it. Case 8b was written to isolate the scoping, and does. |
| **C** — no cycle clause                              | 11 only                             | H-2 is isolated.                                                                                                                                                                                          |
| **D** — admission-authority check disabled           | 12 only                             | H-3 is isolated.                                                                                                                                                                                          |
| **E** — cross-lineage check disabled                 | 8 only                              | The separate check is isolated.                                                                                                                                                                           |

Mutation B is the one worth keeping. It is exactly the failure mode the owner
was asking about: a suite that passes, a clause that looks justified, and no
case that actually depends on it. Had the mutation run not been done, case 8
would have stood in the report as evidence for a scoping rule it does not test.

#### Three defects in the test harness, found before the suite could be trusted

Each would have read as a product failure to anybody looking at the output.

**Colliding identifiers.** The id generator padded a variable stem out to 25
characters with zeroes, which made `…event1` and `…event10` the same string.
That is a duplicate-key failure two hundred rows into the run, reported against
`Event_pkey` and `OrderItem_pkey`, and it looks like anything but an identifier
bug. The counter now sits at the end at a fixed width.

**Twenty-five seconds per invariant run.** Every case timed out at the 30-second
limit. Timing each check individually showed `noOverselling` at **24.9 s** of a
25.0 s total — it walks every ticket type in the catalogue one aggregate at a
time, 12,907 of them in this database — against 130 ms for the settlement check,
35 ms for admission authority and 11 ms for cross-lineage. It already accepts a
scope, so the suite passes one; the settlement checks stay database-wide, which
is the question they exist to ask. The suite now runs in **2.8 s**. The N+1 is a
pre-existing property of a passing check and is recorded as a deferred task
rather than changed here.

**Order dependence.** The checks are database-wide and the rejection cases plant
violations on purpose, so a case that left its rows behind answered the next
case's question for it. Teardown is per case, not per file. That is stricter
than the sibling real-database suites, which leave everything because the test
database is disposable — and it is not optional here, because CI runs the same
checks again in the reliability step _after_ the suite, and a planted row left
behind would fail that step on a defect that does not exist. Verified: after a
full run of the API suite, zero rows carrying this suite's prefix remain, and
all nine invariants pass database-wide.

What teardown deliberately does **not** remove is case 14's seat layout. A
published `VenueMapVersion` is frozen by `desi_seat_frozen_and_coherent` and
cannot be unpublished by `desi_map_version_publish_once`, so its seats, rows,
sections and venue cannot be deleted — correctly, because people have bought
against that plan. No invariant reads any of it.

#### Local verification of the remediation

| Gate                                       | Result                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `settlement-invariants.test.js`            | **14 passed**, real PostgreSQL, 2.8 s                                                      |
| `ticket-concurrency.test.js`               | **14 passed**, including the raced accept's new lineage assertions                         |
| API suite                                  | **67 files, 1,335 cases, all passed**                                                      |
| `npx turbo run test --force`               | **19/19 tasks, 0 cached**                                                                  |
| skipped-test detection                     | **5,538 cases across 16 reports, 0 skipped, 0 allow-listed, 0 undeclared** — fresh reports |
| reliability, `ga-hold-contention`          | PASS — 3,017 calls, p95 60.5 ms                                                            |
| reliability, `seat-hold-contention`        | PASS — 4,428 calls, p95 39.3 ms                                                            |
| reliability, `check-in-concurrency`        | PASS — 3,691 calls, p95 45.9 ms                                                            |
| `format:check`                             | pass                                                                                       |
| `lint`                                     | pass                                                                                       |
| invariants, database-wide, after the suite | all **9** pass                                                                             |

5,538 is 5,524 plus the fourteen new settlement cases, exactly. Case 15 added
assertions to an existing case rather than a new one, so it moves no count — the
arithmetic is the check that the figure is this run's and not a cached one.

The reports were deleted before the run and regenerated with the reporter flags
CI uses, and their timestamps were read afterwards to confirm it. **No cached or
stale report is cited anywhere above.**

#### Why the seven browser configurations were not re-run locally

The owner's exemption applies, and its conditions are met. The diff from
`dbb5957` to `2e22e15` is **three files**:

```
apps/api/tests/settlement-invariants.test.js   (new, test)
apps/api/tests/ticket-concurrency.test.js      (test)
scripts/load/invariants.js                     (reliability script)
```

No file under `apps/web/src`, `apps/web/public`, `packages/ui` or
`packages/schemas`; no `apps/api/src`; no Prisma schema or migration; no OpenAPI
artefact; no `package.json`, no lockfile; no CSS, no JSX. Nothing generated was
altered. The 300/300 result on `0532905` stands as recorded, and the seven
browser jobs run in exact-SHA CI on this SHA regardless. **If CI reports any
discrepancy, it is investigated rather than dismissed on the strength of this
classification.**

#### Two reliability tasks deferred to Phase 4, with acceptance criteria

Both are real. Neither is done here, because each materially expands a
remediation the owner asked to keep narrow, and each needs its own evidence.

**R-1 — a single fresh-report verification command.** Today the local sequence
is `rm` the reports, then `npx turbo run test --force -- --reporter=default
--reporter=json --outputFile.json=vitest-report.json`, then run
`check-skipped-tests.mjs` over what that wrote. It works, and it is three
commands and a piece of folklore about which `--force` reaches which tool. A
`pnpm verify:tests:fresh` should exist. Accepted only when it guarantees, and is
shown to guarantee:

1. every test task runs, with no task served from the turbo cache;
2. every `vitest-report.json` is deleted before the run and rewritten by it;
3. the reporter flags are the ones CI's `Test` step passes, not a local variant;
4. the skipped-test gate reads only reports written by that run;
5. it fails, loudly, if any report is older than the run;
6. it fails if the report count does not match the number of reporting tasks;
7. a CI-parity test asserts the command's flags equal the workflow's, so the two
   cannot drift.

Falsification required: a deliberately stale report must make it fail, and a
deliberately cached task must make it fail.

**R-2 — `noOverselling` is an N+1 over the whole catalogue.** One `findMany`
over `TicketType` followed by one `aggregate` per type: 12,907 queries and 24.9 s
against this database, growing with the catalogue, paid three times per CI
reliability step. The check passes and has always passed; this is cost and
scaling, not correctness. Accepted when it is a single grouped query, returns
byte-identical results on a database holding a known oversell and one without,
completes in under a second here, and keeps the `scope.eventId` behaviour.

#### Exact-SHA CI, the first correction

**Run 35772861864, `dbb5957c5a15e359b84b4677383ff78260da09d4`,
`workflow_dispatch`, attempt 1: SUCCESS.** All eight jobs green. Recorded even
though `2e22e15` supersedes it, because it is what the owner provisionally
accepted and because a superseded green run is still evidence about what the
first correction did.

| Job                                      | Result  |
| ---------------------------------------- | ------- |
| Policy, lint, contract, tests, build     | success |
| Browser — public catalogue               | success |
| Browser — production build               | success |
| Browser — event lifecycle                | success |
| Browser — organiser venue maps           | success |
| Browser — refusals                       | success |
| Browser — accessibility sweep            | success |
| Browser — commerce and operations detail | success |

Every one of the main job's 27 substantive steps reported `success`, step 27
_Reliability smoke test_ among them — the step that failed on `0532905` — from
19:24:33 to 19:25:08. The only steps with conclusion `skipped` are _Upload
failure artefacts_ and the seven _Upload Playwright artefacts_, which are
`if: failure()` uploads. **Nothing was silently unrun:** a skipped upload is an
upload that had nothing to upload, and is not a skipped test.

#### Exact-SHA CI, the second correction

**Run 35776856187, `2e22e15b917d49134ecfbb94ce43db9c34b6b47c`,
`workflow_dispatch`, attempt 1: SUCCESS.** All eight jobs green, 8m 07s.

| Job                                      | Result  | The step that matters                                               |
| ---------------------------------------- | ------- | ------------------------------------------------------------------- |
| Policy, lint, contract, tests, build     | success | step 27 _Reliability smoke test_ — **success**, 20:00:54 → 20:01:29 |
| Browser — public catalogue               | success |                                                                     |
| Browser — production build               | success |                                                                     |
| Browser — event lifecycle                | success |                                                                     |
| Browser — organiser venue maps           | success |                                                                     |
| Browser — refusals                       | success |                                                                     |
| Browser — accessibility sweep            | success |                                                                     |
| Browser — commerce and operations detail | success |                                                                     |

All 27 substantive steps of the main job reported `success`, in order, with no
cancellation and no step left unrun. Step 16 _Test_ passed; step 17 _Refuse an
undeclared skipped test_ passed against the reports that step wrote; step 18
_Coverage thresholds_ passed; step 26 _Production payments are unreachable_
passed; and step 27, the step that failed on `0532905`, passed.

The only steps whose conclusion is `skipped` are step 28 _Upload failure
artefacts_ and the seven per-job _Upload Playwright artefacts_. Every one is an
`if: failure()` upload, so a skip means there was nothing to upload. **No test,
suite or check was skipped, and nothing was silently unrun.**

All seven browser configurations ran and passed on this SHA, which is the
condition the browser-config exemption was granted against. **CI reported no
discrepancy**, so there was nothing to investigate beyond the classification.

---

## Phase 2: closure

Ten separate outcomes, because "Phase 2" is not one thing and a single verdict
over it would hide both the parts that are finished and the parts that are not.

| Requirement                          | Classification                              | On what evidence                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallet response and UI               | **COMPLETE**                                | `GET /v1/tickets` carries event, venue, tier, seat, holder relationship and admissibility; the page renders four disjoint sections. 60 API cases, 19 browser cases at seven widths, `wallet.test.js` for the bucketing.                                |
| Current-holder filtering             | **COMPLETE**                                | The ten-state ownership matrix, including the guest order where both columns are null. `heldByTheBuyer` throws rather than guessing when a column was not selected.                                                                                    |
| Purchase-history representation      | **COMPLETE**                                | `purchaserHolding` is an enum derived from status, not from `ownerUserId !== order.userId`; `supersededByLaterTicket` stops a hand-out-and-back reading as two tickets against a quantity of one.                                                      |
| Cross-holder data leak               | **FIXED**                                   | A recipient's wallet row carries no `orderReference` and no buyer identity; asserted positively and by absence of the order reference anywhere in the serialized response.                                                                             |
| Secure-pass API                      | **COMPLETE**                                | Holder-only, uniform 404, `no-store, private`, credential absent from every log sink and from the redaction net's newly added keys. Twelve threat areas assessed above.                                                                                |
| QR presentation                      | **DEFERRED — QR ENCODER DECISION REQUIRED** | No encoder is present and the human-readable ticket code is **not** rendered as an admission credential. Per owner decision 2, the feature is stopped rather than substituted; the blocker is named and nothing insecure ships.                        |
| Reliability transfer-chain invariant | **FIXED**                                   | Three checks, fourteen real-PostgreSQL cases, five mutations, each clause isolated by exactly one case. The failing run is preserved above as a real regression.                                                                                       |
| Reserved-seat transfer               | **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**   | Finding S-1, now demonstrated rather than asserted: case 14 makes the write and shows `Ticket_eventSeatId_key` refusing it. Fixing it needs seat-inventory reasoning and its own concurrency proof.                                                    |
| Group booking                        | **NOT IMPLEMENTED**                         | Per owner decision 6, `OrderItem.quantity` is not dressed up as a group-booking system. There is no group model, no lead booker, no per-attendee assignment. Backend not implemented, and not claimed.                                                 |
| Production Stripe and Stripe Connect | **EXTERNAL VERIFICATION PENDING**           | `PAYMENT_MODE=MOCK` throughout. No real charge, payout, transfer, refund, webhook or provider credential was exercised, and the kill-switch suite asserts the production path stays unreachable. Nothing here is evidence about live Stripe behaviour. |

### What this closure does not claim

Phase 2 is **not** marked complete as a whole, and the four preconditions the
owner set are what this section is answering, not a formality. The two
correctness defects that remain open in this area — S-1 (reserved-seat transfer)
and S-2 (an accept racing a check-in) — are recorded in the findings table
above, are not fixed, and are not diminished by the invariant work: the
invariant measures what the database holds, and cannot make a transfer path
correct.

`PAYMENT_MODE` was never set, and `packages/providers/src/payment-mode.js`
resolves an unset value to `MOCK` — `const mode = requested ?? PAYMENT_MODES.MOCK`.
So mock mode was in force for every run cited in this report, by default rather
than by assertion, and `payment-kill-switch.test.js` checks it directly:
**12 cases, all passing**, including that `app.payments.mode` is `MOCK` and that
the production path stays unreachable. No real Stripe or Stripe Connect
operation, no production payment path, no external provider credential and no
destructive retention was enabled at any point.

---

## Sections still to be written

Phases 3 and 4, and the following report requirements, are not yet
answerable and are deliberately left unwritten rather than filled with
placeholders: final repository state; architecture and data-flow changes;
database migrations and constraints; API and response-schema changes;
authorization and tenant-isolation changes; ticket credential and QR threat
model; scanner preview and check-in flow; the full UI route and navigation
inventory; accessibility and responsive evidence; Playwright collection proof;
security regression results; known limitations; deferred owner decisions;
external verification pending items; and the per-requirement classification
table.
