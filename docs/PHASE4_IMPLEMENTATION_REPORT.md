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

_Status, 2026-09-22, at the Phase 3 closure. The sentence above is left as
written._ Still **IN PROGRESS**. Phase 1 is complete and verified. Phase 2 is
closed on ten separate outcomes, and Phase 3 on fourteen, each recorded below
with its own classification. Neither phase is described as complete as a
whole. Phase 4 is not yet implemented, and is not described here as though it
were.

_Status, 2026-09-23, after the Phase 3 closure audit. Both paragraphs above
are left as written._ Still **IN PROGRESS**. Phase 1 is complete and verified.
Phase 2 is closed on ten separate outcomes. Phase 3 is **COMPLETE — VERIFIED ON
REMEDIATION SHA `3fe58a7`**, on fourteen separate outcomes. That follows an
audit that found defects and gaps in the evidence, and fixed them ("Phase 3
closure audit", below). Its QR scanner is complete in Chromium simulation
only, and reserved-seat transfer is still blocked. None of this describes the
ticketing product as complete. Phase 4 is not yet implemented, and is not
described here as though it were.

_Status, 2026-09-23, at the Phase 4 closure. The three paragraphs above are
left as written._ Phase 4 is **COMPLETE — VERIFIED ON REMEDIATION SHA
`43a5fd4`** (exact-SHA CI `35885247288`, eight of eight jobs green), recorded
in "Phase 4 — the product's frontend, UI/UX, navigation and operational
surfaces", below, with twenty-seven separate classifications. The product is
still not described as complete: the blocked, unimplemented and
externally-pending items listed there remain.

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

## Phase 3 — organizer and admission operations

The door, end to end: an organiser's steward presents a ticket — a scanned QR
pass or a typed printed code — the server looks it up without changing
anything, the steward sees who it is, and only an explicit **Admit** records
one admission. The frontend decides none of it. Alongside it, four defects this
phase was asked to close and one it found: colleagues' addresses on the team
list, an operator retry that stole a worker's lease, reserved-seat transfer
that was "blocked" only in a report, an acceptance that could commit nothing,
and the per-address pass budget every browser shared.

Authorised starting state: `21af69a6065608cc592ef30b9db86999286e9d03` (Phase 2
closure), remediation `2e22e15b917d49134ecfbb94ce43db9c34b6b47c`, exact-SHA run
`35776856187`. Branch unchanged: `claude/phase4-frontend-ui-ux-completion`.
Nothing was moved, cherry-picked, rebased or duplicated onto any other branch.

### 0. The fresh-report command, first

`pnpm verify:tests:fresh` (`scripts/verify-tests-fresh.mjs`), committed in
`8ccbb81` before any Phase 3 feature work, as required. It is the only thing
that produces or judges test reports: CI's test step runs it and nothing else,
and `ci:check` refuses a workflow that writes `vitest-report.json` or runs the
skip checker any other way.

What it guarantees, each with a regression case in
`packages/config/tests/verify-tests-fresh.test.js` (31 cases):

| #   | Property                                                                                                                                                  | Case that fails without it                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Every existing report is deleted before anything runs                                                                                                     | "removes every existing report"                                                                           |
| 2   | The run's start is recorded; a report's modification time must be after it (2 s allowance for coarse filesystems, and no more)                            | "allows a modification time a coarse filesystem rounded down, and no more"                                |
| 3   | A report's own `startTime` must be after it — catches a cache restoring old contents with a fresh timestamp                                               | "refuses a report restored with a fresh timestamp and old contents"; "refuses a report with no startTime" |
| 4   | Turborepo runs with `--force`, before the `--`; Vitest gets only its own reporter flags after it                                                          | "gives Turborepo its own flags and Vitest its own"                                                        |
| 5   | A missing report is refused — what a cache hit leaves                                                                                                     | "refuses a missing report"; "refuses a cached result that leaves an old report unchanged"                 |
| 6   | An empty, malformed, or not-a-report file is refused                                                                                                      | three cases                                                                                               |
| 7   | The expected packages come from Turborepo's own dry-run plan; a package that should report and did not, or a report where none was expected, is refused   | two cases, plus the plan parser                                                                           |
| 8   | A skipped, pending or todo case is refused unless allow-listed with a reason                                                                              | three cases                                                                                               |
| 9   | A failed case is refused even if the run exited zero; a package, or one file, with no cases is refused; counters that disagree with the cases are refused | four cases                                                                                                |
| 10  | Totals are printed per package and overall                                                                                                                | "prints a table and an OK line"                                                                           |
| 11  | One child process, awaited on `close`; nothing polled                                                                                                     | "awaits one child process and polls nothing"                                                              |
| 12  | `REQUIRE_DATABASE` and `TEST_DATABASE_URL` are declared in `turbo.json`'s `globalEnv`, so they reach the suites                                           | "declares the variables the suites read" — see the correction below                                       |

The earlier incidents — the cached report read as fresh in Phase 1, `--force`
handed to Vitest, one report instead of sixteen, and the `pgrep -f` waiter
that waited on itself — are recorded in the Phase 1 and Phase 2 sections and
are not rewritten; this command is the permanent answer to all four.

### 1. Commits

| SHA       | What                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8ccbb81` | `pnpm verify:tests:fresh` — the permanent stale-report fix, first as required                                                                                                                                                          |
| `298a70a` | Event-scoped door authority, the non-mutating preview, the revalidating confirmation, the migration                                                                                                                                    |
| `29f9b7e` | Member-email protection; notification retry/cancel kept off a worker's lease                                                                                                                                                           |
| `485fe4b` | Reserved-seat transfer blocked for real; an acceptance that lost a race now rolls back (S-2)                                                                                                                                           |
| `739cc58` | QR pass for the holder, the camera scanner, the check-in workspace, browser and sweep coverage                                                                                                                                         |
| `821c167` | Found by running the verify job locally: the migration classified for the upgrade check, the new suites added to the fresh-database check, a test secret marked as fake                                                                |
| `48185a1` | Found by running the browser suites locally: the shared sign-in helper waits out the credential limiter instead of racing it. **The Phase 3 SHA** — full `48185a17c7b4fb23c8419ce33e781a09e80c4e07`. Its exact-SHA run failed; see §17 |
| `16357f3` | Found by that run: the door form lost a code typed before the page's script arrived. The workspace now takes up what is already in the field. **The remediation SHA** — full `16357f38e50b1f0aa556bb3708c94f0464d9a954`                |

### 2. Files and migrations

90 files changed across the first five commits: 29 added, 61 modified. The new
ones that carry the design:

| Area                    | Files                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Door policy             | `packages/permissions/src/admission.js` (+ test)                                                         |
| Door service            | `apps/api/src/lib/admission.js`                                                                          |
| Operator outbox actions | `apps/api/src/lib/notification-operations.js`                                                            |
| Migration               | `packages/db/prisma/migrations/20260922200000_admission_scope_and_method/migration.sql`                  |
| Decision record         | `docs/adr/0005-reserved-seat-transfer.md`                                                                |
| QR                      | `apps/web/src/lib/qr.js`, `qr-decode.js`, `pass-shape.js`                                                |
| Screens                 | `components/ticket-pass.jsx`, `door-camera.jsx`, `door-workspace.jsx`, `app/organizer/check-in/page.jsx` |
| Fresh reports           | `scripts/verify-tests-fresh.mjs`, `scripts/lib/vitest-reports.mjs`                                       |
| Real-PostgreSQL suites  | `admission-integration`, `notification-lease-integration`, `seat-transfer-block-integration`             |
| Browser                 | `e2e/detail-organizer-checkin.spec.js`, `e2e/support/seed-door.mjs`                                      |

**The migration**, one file, four changes, each with its rollback written
beside it in the SQL:

1. `ALTER TYPE "CheckInMethod" RENAME VALUE 'MANUAL_LOOKUP' TO 'MANUAL_CODE'` —
   in place, so every existing row keeps its meaning. Prisma's generated
   version dropped and recreated the enum inside its own `BEGIN`/`COMMIT`.
   Rollback: the reverse `RENAME VALUE`.
2. Scopes naming an event that no longer exists are deleted, then
   `ScannerScope.eventId` becomes a real foreign key with `ON DELETE CASCADE`.
   Before it, a scope could point at nothing. Rollback: drop the constraint;
   the deleted rows granted nothing, because nothing read them.
3. Scopes naming another organisation's event are deleted, and a trigger,
   `desi_scanner_scope_same_organization`, refuses one on insert or update
   with `check_violation`. Rollback: drop the trigger and function.
4. No data is rewritten beyond those two deletions.

Verified on a fresh database and an upgraded one (`db:verify:fresh`,
`db:verify:upgrade`, below), and by `prisma migrate diff` from the migrated
database to the schema: the only remaining lines are the two pre-existing
index drifts (`Event_languages_gin_idx`, `TicketType_eventId_name_key`), which
predate this phase and are not this migration's.

### 3. API contracts

134 operations across 120 paths (was 132 across 118).

| Route                                                    | Change                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/tickets/admission/events`                       | **New.** The events this account may admit to, each with `authority` (`ORGANIZATION_ROLE` / `EVENT_SCOPE`) and `role`. Read from the database per request. `private, no-store`.                                                                                                                                                                             |
| `POST /v1/tickets/admission/preview`                     | **New.** Strict body: exactly one of `credential` / `code`, optional `expectedEventId`. Writes no `CheckIn`, no status, no credential. Rate-limited per account. `private, no-store`.                                                                                                                                                                       |
| `POST /v1/tickets/check-in`                              | **Revised.** Strict body: the same presentation plus `previewReference`; optional `gate`, `deviceId`, `expectedEventId`. `method`, `checkedInAt`, `force`, `eventSessionId` are 400s. Response is a named presenter: `outcome`, `checkedInAt`, `method`, `checkedInByYou`, event, tier, seat, attendee name. Refusals are 409 with a closed `error.reason`. |
| every error body                                         | `error.reason` forwarded when a service attached a closed-vocabulary code (an upper-case identifier only).                                                                                                                                                                                                                                                  |
| `GET /v1/organizations/:id/members`                      | Discriminated on `emailVisibility`: `FULL` entries carry `email`; `MASKED` entries carry `emailMasked` and no `email`.                                                                                                                                                                                                                                      |
| `POST /v1/invitations/accept`                            | The forwarded-link refusal names the invited address masked.                                                                                                                                                                                                                                                                                                |
| `GET /v1/tickets/:id`                                    | Adds `transferBlockedReason` (`RESERVED_SEAT` or null).                                                                                                                                                                                                                                                                                                     |
| `POST /v1/tickets/:id/transfers`                         | 422 `RESERVED_SEAT` for a seated ticket.                                                                                                                                                                                                                                                                                                                    |
| `POST /v1/ticket-transfers/accept`                       | 409 `RESERVED_SEAT` for a seated invitation; 409 `TICKET_CHANGED` when the ticket changed underneath (rolled back).                                                                                                                                                                                                                                         |
| `POST /v1/operations/notifications/:id/retry` / `cancel` | Starting states explicit; 409 reasons `LEASED`, `NOT_RETRYABLE`, `NOT_CANCELLABLE`, `REDACTED`, `CHANGED`.                                                                                                                                                                                                                                                  |

`apps/api/openapi.json` and the route manifest are regenerated from the
contract; both drift gates pass.

### 4. ScannerScope policy

`packages/permissions/src/admission.js`, one function, `admissionAuthorityFor`,
used by the preview, inside the confirmation, and by the events list — so the
three cannot disagree.

| Caller                               | Admits to                          | Why                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OWNER, ADMIN                         | every event of their organisation  | They hold `team:role_manage` and can grant any scope themselves; requiring one would be ceremony.                                                                                            |
| MANAGER, STAFF, SCANNER              | only events a `ScannerScope` names | STAFF and MANAGER hold `ticket:check_in` only by inheriting SCANNER. The inherited capability used to be the whole check, so a STAFF member could admit to every event the organisation ran. |
| VIEWER, EVENT_MANAGER, FINANCE       | nothing, scope or not              | They do not hold `ticket:check_in`; a scope row does not give it to them.                                                                                                                    |
| Platform roles, SUPER_ADMIN included | nothing                            | Door authority comes from a membership. A platform attempt is refused 403 **and audited** (`PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY`). No cross-organisation bypass exists.                      |
| Removed membership, expired session  | nothing                            | The membership is read from the database on every preview and inside every confirmation; the session guard answers 401 before the door is reached.                                           |
| Deleted or revoked scope             | nothing, from the next request     | Read per request; inside the confirmation it is locked `FOR SHARE` until the admission commits.                                                                                              |

A module-load assertion (`assertAdmissionPolicy`) refuses a role table in
which any role holding `ticket:check_in` is not classified exactly once, in
which a wide role cannot grant scopes, or in which a scoped role can.

The team routes now keep scopes for all three scoped roles (only SCANNER's were
kept before, which would have left STAFF and MANAGER unable to admit anybody),
refuse a foreign event id with 422 instead of dropping it silently, and lock
the membership before touching its scopes.

The eleven required negatives, each against real PostgreSQL, each asserting
the refusal **and** that no `CheckIn` row exists
(`admission-integration.test.js`, "scanner authorisation"):

| #   | Negative                                                 | Answer                                                                                                                                         |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scoped to A, previews B                                  | uniform 404, byte-identical to a code that does not exist                                                                                      |
| 2   | Scoped to A, checks in B with a validly signed reference | 403                                                                                                                                            |
| 3   | Organisation A's owner, organisation B's ticket          | 404 on preview, 403 on a signed confirmation                                                                                                   |
| 4   | No scope                                                 | 404 / 403                                                                                                                                      |
| 5   | Membership removed, caller still holding the old actor   | 404 / 403                                                                                                                                      |
| 6   | Expired or revoked session                               | 401 (route test); an actor with no memberships is 403 before any read                                                                          |
| 7   | Missing capability, scope row present                    | 403                                                                                                                                            |
| 8   | Browser sends a conflicting event id                     | authority is the ticket's event: 404 when the browser's event is the only one scoped; `WRONG_EVENT` when the scanner is scoped to the real one |
| 9   | Scope added after the session began                      | the same actor object is admitted on the next request                                                                                          |
| 10  | Scope revoked before confirmation                        | 403                                                                                                                                            |
| 11  | Scope or role changed between preview and check-in       | 403 for a scope moved to another event, 403 for a demotion to VIEWER with the scope left behind                                                |

Reintroducing "trust the preview" in the confirmation (mutation M1) fails seven
of them.

### 5. Preview threat model

| Threat                                     | Answer                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The preview becomes an authorisation token | It is not one. The confirmation re-derives ticket, status, event, organisation, membership, scope and existing check-in inside its own transaction. A validly **signed** reference for a caller who has since lost authority admits nobody (negatives 2, 3, 10, 11).                                                                                                                           |
| Forged or replayed reference               | HMAC-SHA256 under `HKDF(AUTH_SECRET, "admission-preview-v1")`, compared in constant time before the body is trusted. Bound to ticket, event, organisation, the previewing account and the presentation method; two-minute expiry. Another scanner's reference, a tampered one, one confirmed with a different pass or method, or an expired one are each refused with their own closed reason. |
| Existence oracle                           | Resolve first, authorise second, uniform 404 for both "no such pass" and "not yours". Before this phase an unknown pass answered 404 and a real one 403 naming the owning organisation. A caller with no door authority anywhere is refused 403 before any lookup — a statement about the caller, identical for real and invented codes.                                                       |
| Timing side channel                        | Residual: a real code costs one more query than an invented one. Mitigated by the per-account budget (120 a minute, keyed on the account because every browser request arrives through the web proxy), and recorded under limitations.                                                                                                                                                         |
| Over-disclosure                            | Named presenters with listed fields; response schemas strip everything else, proved by hostile-payload tests (credential digest, buyer email, totals, provider ids, transfer token, internal note, metadata — none survive). No buyer, recipient or member email; no order, payment or totals; no other attendee.                                                                              |
| Caching                                    | `private, no-store` on all three door routes, and on the pass.                                                                                                                                                                                                                                                                                                                                 |
| Logging and audit                          | The credential, the code and the reference are never written to an audit row or a log line; `previewReference` joined `credential` in the logger's redaction keys. Previews and refusals are audited against the ticket.                                                                                                                                                                       |
| Mutation through a preview                 | Asserted directly: the ticket row is byte-identical before and after, and no `CheckIn` exists, against the stub and against PostgreSQL.                                                                                                                                                                                                                                                        |

### 6. Method derivation

`QR_SCAN` when the secure credential was presented, `MANUAL_CODE` when the
printed code was. The server cannot see whether a camera or a keyboard produced
a credential; it records which secret was presented, and the door screen's
manual mode sends only the printed code. `ASSISTED` exists in the enum and is
never written: nothing here implements an assisted or organiser override, and
none is exposed. A client-sent `method` is a 400; the reference is bound to the
method it was issued for, so a code preview cannot be confirmed as a QR scan.

### 7. Exactly-once evidence

Real PostgreSQL, `admission-integration.test.js`, "admission races". One
`CheckIn` row at most in every case, a truthful answer for the loser, and no
error that is not one of the door's own:

| #   | Race                                               | Result                                                                        |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Two simultaneous confirmations of one preview      | one `ADMITTED`, one `ALREADY_CHECKED_IN`, same instant, both `checkedInByYou` |
| 2   | Two stewards at once                               | one admits; the other is told `ALREADY_CHECKED_IN`, `checkedInByYou: false`   |
| 3   | QR scan racing a typed code                        | one row; its method is the winner's                                           |
| 4   | A preview overtaken by another steward's admission | `ALREADY_CHECKED_IN`                                                          |
| 5   | Scope withdrawal in flight                         | the confirmation waits on the membership lock, then sees the scope gone: 403  |
| 6   | Revocation in flight                               | the confirmation waits on the ticket lock, then refuses `REVOKED`             |
| 7   | Refunded after preview                             | `REFUNDED`, by pass and by code                                               |
| 8   | Transfer accepted after preview                    | old pass and old code refused `TRANSFERRED`; the recipient's new pass admits  |
| 9   | Same confirmation submitted three times            | one admission, two `ALREADY_CHECKED_IN` with the same instant                 |
| 10  | Network retry while the first is in flight         | four at once: one admission, all `checkedInByYou`, one instant                |
| +   | Confirmation against member removal, five rounds   | no deadlock; each round is one of the two outcomes                            |

There is no idempotency key on this route: the confirmation is idempotent on
the ticket itself, and a retry is answered with the original admission.

Cases 5 and 6 force the interleaving rather than hoping for it: one
transaction holds the lock, and the test waits until **PostgreSQL reports the
other blocked** (`pg_stat_activity.wait_event_type = 'Lock'`) before releasing
it. Removing the confirmation's row locks (mutation M2) fails both.

The browser proves the same from the other end: a double-pressed **Admit** on
a slow line sends one request; an admission whose answer is dropped after the
server committed is shown as uncertain, and the retry reports it as already
admitted by this steward — one row, read from PostgreSQL.

The load suite's check-in scenario now previews and confirms, alternating QR
and typed code for the same tickets, at sixteen workers; its database
invariants hold. (Before this phase it sent codes only, and never exercised a
credential.)

### 8. QR decision

A dependency was adopted only after each question the brief asks was answered.
The research was done against the npm registry on 2026-09-22; tarball
integrity was checked against `dist.integrity`, and trees were resolved in a
scratch directory before anything touched the repository.

|                        | Encoder: `uqr`                                                                                                                                         | Decoder: `jsqr`                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version                | **0.1.3**, pinned exactly                                                                                                                              | **1.4.0**, pinned exactly                                                                                                                                                                   |
| Licence                | MIT                                                                                                                                                    | Apache-2.0                                                                                                                                                                                  |
| Maintenance            | UnJS; two maintainers; last release 2026-04-03 after a ~2.5-year gap                                                                                   | two maintainers; **last release 2021-04-24**. Feature-complete port of ZXing's QR reader; the risk is recorded, not waved away                                                              |
| Transitive packages    | 0                                                                                                                                                      | 0                                                                                                                                                                                           |
| Install scripts        | none                                                                                                                                                   | none                                                                                                                                                                                        |
| Known advisories       | 0 (`npm audit`; `pnpm audit` after install: none)                                                                                                      | 0                                                                                                                                                                                           |
| Provenance attestation | none                                                                                                                                                   | none                                                                                                                                                                                        |
| Network calls          | none                                                                                                                                                   | none — no worker, no WebAssembly, no `eval`                                                                                                                                                 |
| Bundle effect          | about 19.9 KB minified, 7.2 KB gzip, on `/tickets/[id]` only (that route's chunk with the pass component: 33.3 KB / 11.1 KB); **not** on the door page | its own chunk, 130.0 KB minified / 45.8 KB gzip, in no route's manifest — loaded by dynamic `import()` only when a steward starts the camera. The door page's own chunk is 27.2 KB / 8.8 KB |
| JS-only policy         | ships `.d.ts` inside `node_modules`, which `docs/language-policy.md` permits; `policy:check` passes                                                    | same                                                                                                                                                                                        |

**Why not the platform, and why not the others.** `BarcodeDetector` does not
exist in Firefox, needs a flag in Safari, is absent from desktop Chrome on
Linux and Windows, and is absent from the Chromium this repository tests in —
so a scanner built on it would not work on most door devices and could not be
tested. `@zxing/library` ≥ 0.22 refuses to install on this repository's Node 22
under `engine-strict`; `zxing-wasm` and `barcode-detector` fetch WebAssembly
from a third-party CDN by default; `qr-scanner` depends on a `@types` package
at runtime and runs a `blob:` worker; `qrcode` pulls 28 packages for a command
line nobody uses. No existing dependency encodes or decodes QR.

**No homegrown encoder or decoder.** The encoder's output is verified by the
independent decoder (40 pass-shaped strings in the unit suite; the full
browser round trip below).

Two settings are not left to defaults: error correction `M` rather than `L`,
and a four-module quiet zone rather than one. The pass-shape check lives in its
own module so the door page never loads the encoder.

**One lockfile side effect**, recorded because it is not one of the two
packages: pnpm re-resolved `next` and `styled-jsx`'s optional `@babel/core`
peer to the `7.29.7` already in the lockfile. No package was added by it.

### 9. Credential handling

- **Holder side.** `/tickets/:id` offers **Show my entry pass** to the holder of
  a ticket that admits. The pass is fetched from the holder-only, `no-store`
  endpoint on request, encoded, and the string dropped: the component keeps
  the drawing, never the text. It is not in the markup, an attribute, a title,
  a label, storage or the address — asserted in the browser by decoding the
  drawing and searching the page, storage and URL for the result. It goes
  away on **Hide**, on leaving, when the page is hidden, and on `pagehide`. No
  animation. Next to it: whoever holds this code — on a screen, printed or as a
  screenshot — can use it once. Nothing claims screenshots can be prevented.
- **Not on lists.** The wallet list never calls the pass endpoint.
- **Door side.** The camera starts only on a press; frames go to one
  off-screen canvas, are decoded locally and overwritten; nothing is uploaded
  or kept; every track stops on **Stop**, on switching to typing, on leaving,
  on hide. A decode is a lookup; decoding pauses while the preview is up, so a
  pass held in front of the camera is looked up once (asserted: one preview
  request in a second of continuous frames). A non-pass QR is reported and
  never sent. The scanned credential is held in memory from lookup to
  admission or clearing — never in the page, the URL, the title, storage or a
  log.
- **Test artefacts.** The browser spec turns screenshots, traces and video
  off; the sweep's pass case closes its context in `finally` so no failure
  screenshot can capture a live pass.
- **Bundle.** `credentialVersion` is on the browser-bundle scan's forbidden
  list, so the pass component does not read it. The scan passes and now
  requires both door paths to ship.
- **Rate limit.** The pass budget is now keyed on the holder, not the address:
  behind the web proxy every holder shared the web server's thirty a minute.

### 10. Member-email matrix

Decided by the server (`emailVisibilityFor`, `teams.js`) and enforced by the
response schema — not by a stylesheet.

| Caller                                | `teams.list` | Entries carry                                              |
| ------------------------------------- | ------------ | ---------------------------------------------------------- |
| OWNER, ADMIN, MANAGER                 | `FULL`       | `email`                                                    |
| Platform SUPER_ADMIN                  | `FULL`       | `email` (unscoped capabilities; MFA required for the role) |
| VIEWER, STAFF, EVENT_MANAGER, FINANCE | `MASKED`     | `emailMasked` only — no `email` key                        |
| SCANNER                               | 403          | —                                                          |
| Another organisation's member         | 403          | —                                                          |

The masked shape has no `email` key, so an address a presenter leaves in is
stripped; `emailMasked` must contain `*`, so a full address in its place fails
serialization rather than leaking. Every masked case also searches the whole
response body for every member's and invitee's address. The forwarded-invitation
refusal names the address masked (it named it in full, and a test pinned
that). Door responses carry no address at all.

### 11. Notification retry lease

The defect: retry's transition check allowed `CLAIMED → QUEUED` and its update
was conditional on status alone, so pressing retry mid-send wiped a live lease
and let a second worker send the message again; the first worker's completion
then matched nothing and its provider id was lost. Cancel had the same gap on a
lapsed lease that a worker re-claimed between read and write.

Now, in `lib/notification-operations.js`: retry only from `DEAD_LETTER`,
`FAILED` or `RETRY_SCHEDULED`, never from `CLAIMED` (live or lapsed — a lapsed
lease is reclaimed by the worker on its own); cancel of a `CLAIMED` row only
once its lease has lapsed. **Every condition is in the `UPDATE`'s `WHERE`** —
status, no lease owner, not redacted; for a lapsed lease, the same owner and
expiry that were read — so a claim that commits first wins and the operator
gets a 409 with a closed reason. Redacted dead letters can no longer be
requeued. Routes stay platform-only (`reconciliation:manage`, OPERATIONS
step-up).

Real PostgreSQL, racing the dispatcher's own claim and completion:
ordinary failed retry; retry while leased (lease untouched, worker's completion
still lands); retry after lease expiry (refused, then reclaimed by a worker);
cancel while leased; cancel of a lapsed lease racing a re-claim; retry racing a
worker's claim; retry racing a worker's completion; two simultaneous retries
(one requeue, one audit row); redacted row; audit rows free of recipient,
payload and dedupe key. An organiser — even the owner of the message's
organisation — is refused (route test). Rows are scheduled around 2100, so the
worker suite's concurrent drain on the shared database cannot touch them.
Restoring the old code fails four cases.

### 12. Reserved-seat transfer decision

`docs/adr/0005-reserved-seat-transfer.md`. **Still BLOCKED — UNIQUE-SEAT
TRANSFER DEFECT.** The right fix is a partial unique index over live statuses,
but it is only safe together with serialising acceptance against refund on the
order line, changing analytics' definition of a live ticket, teaching the stub
predicate uniqueness and four new race proofs — not narrow.

What changed is that the block is now real. Before: the invitation was sent,
the ticket moved to `TRANSFER_PENDING`, the screen offered the transfer, and
every acceptance was a 500 until the sender withdrew it. Now: 422 at the start,
409 at acceptance for an invitation sent before the change (withdrawable), and
the ticket screen says reserved-seat tickets cannot be handed on yet instead of
offering it. Proved on PostgreSQL, including that the full unique index is
still there, so whoever fixes S-1 must change that case on purpose.

**S-2 is FIXED** (correcting its row in the Phase 2 findings table, which is
left as written): `acceptTransfer` returned when the ticket changed underneath
it, committing `ACCEPTED` with no successor; it now throws `TICKET_CHANGED` and
the whole acceptance rolls back. Restoring the `return` fails its case.

A latent defect on the same index is recorded in the ADR, found by reading and
not fixed: a `RESELL` refund frees the seat but leaves the pointer on the
refunded ticket, so reselling that seat would fail settlement after capture.

### 13. Accessibility evidence

In `accessibility-sweep.spec.js`, axe with WCAG 2.0/2.1 A and AA and no rule
disabled, plus sideways overflow ≤ 1 px:

- the check-in screen at **320, 375, 390, 768, 1024, 1280 and 1440**, idle and
  with a preview of a ticket carrying an 85-character name, focus asserted on
  the preview heading each time;
- the check-in screen at 200% zoom (640 px), added to the zoom loop;
- the check-in screen with the camera refused;
- the check-in screen with motion reduced: no running animation, nothing at
  opacity 0;
- the holder's drawn pass at 320 and 1440.

In `detail-organizer-checkin.spec.js`: keyboard only (type, Enter, focus on the
answer, Enter on Cancel, focus back on the field); high latency (1.5 s delayed
admission, three presses, one request); a slow page (every script held back
3 s, the code typed before it arrives, then looked up — added by the
remediation, §17); repeated scans (the camera sees the same pass continuously;
one lookup); camera denied, unavailable and absent; the long-name ticket.

Live regions: a polite status region for routine updates; `role="alert"` only
for outcomes a steward must act on — do not admit, already in, no answer.
Deterministic focus: each answer's heading, the result's heading, back to the
code field after clearing; the pass's **Hide** button after showing, the
**Show** button after hiding.

### 14. Local verification

Every step of the CI `verify` job, in its order, on this tree, by a script
that mirrors it (`rm -rf .turbo` first). Two steps failed the first time and
are the reason for commit `821c167`; both were fixed and re-run, and the
failures are recorded rather than dropped.

| Step                             | Result                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language policy                  | 744 files, no violations                                                                                                                                                                                                                                                  |
| CI invariants                    | 2 workflows; 2 test variables reach the suites; reports only from `verify:tests:fresh`                                                                                                                                                                                    |
| Secret scan                      | **failed first**: a test-only secret in `admission.test.js` did not say so. Marked; 743 files, clean                                                                                                                                                                      |
| Format, lint                     | pass                                                                                                                                                                                                                                                                      |
| API contract                     | 134 routes, 134 operations, 120 paths                                                                                                                                                                                                                                     |
| `verify:tests:fresh`             | **5,754 cases across 16 packages, 0 failed, 0 skipped, 0 undeclared**; 19/19 tasks, 0 cached; 16 reports deleted beforehand and all 16 proved fresh                                                                                                                       |
| Coverage thresholds              | 18/18 tasks, 0 cached, no threshold lowered                                                                                                                                                                                                                               |
| `db:verify:fresh`                | 99/99 checks; now also runs the three new real-PostgreSQL suites (11 API integration files, 168 cases)                                                                                                                                                                    |
| `db:verify:upgrade`              | **failed first**: the admission migration was unclassified and would have run before the schema it was written against. Classified: 26/26 checks, the migration applied over existing rows, the upgraded database identical to a fresh one across 1,488 catalogue entries |
| Build                            | 3/3                                                                                                                                                                                                                                                                       |
| OpenAPI and route-manifest drift | none                                                                                                                                                                                                                                                                      |
| Bundle scan                      | 362 browser-deliverable files, nothing server-only; both door paths present                                                                                                                                                                                               |
| Dependency audit                 | no known vulnerabilities                                                                                                                                                                                                                                                  |
| Payment kill switch              | 12/12                                                                                                                                                                                                                                                                     |
| Reliability smoke                | GA hold contention 2,888 calls, seat hold contention 4,125, check-in concurrency 1,841 (previewing and confirming); every database invariant held                                                                                                                         |

Per package, from the fresh reports: api 1,439 · api-contract 191 · auth 356 ·
config 72 · db 102 · inventory 291 · ledger 33 · logger 65 · notifications 56 ·
permissions 612 · pricing 116 · providers 494 · schemas 734 · ui 97 · web 790 ·
worker 306.

**Again at the remediation SHA** (`16357f3`), the whole mirror from a
clean `.turbo`: all 18 steps passed the first time. `verify:tests:fresh`
**5,756 cases across 16 packages, 0 failed, 0 skipped, 0 undeclared** — web
792, the two new component cases; every other package unchanged. Coverage
18/18 with 0 cached; the web build ran inside that run for this tree (a cache
miss) and the build step replayed it; bundle scan 362 files; db fresh and
upgrade, drift, audit, kill switch 12/12 and the three reliability scenarios
all passed.

`REQUIRE_DATABASE=1` reached every suite this time — see the correction below
for why that sentence could not honestly be written before `8ccbb81`.

Four checks were run against the code they guard by breaking it on purpose,
and each broke: trusting the preview in the confirmation (7 cases fail),
dropping the confirmation's row locks (2), restoring the lease-wiping retry
(4), and restoring the returning acceptance and the unblocked seated start
(2).

### 15. Playwright collection and results

Collected by `playwright test --config <c> --list`, then run.

| Configuration                     |       Collected | Result                                                                          |
| --------------------------------- | --------------: | ------------------------------------------------------------------------------- |
| `playwright.detail.config.js`     | **78** (was 67) | 78 passed on the second run; see below. **79** at the remediation SHA — see §17 |
| `playwright.sweep.config.js`      | **63** (was 59) | 63 passed                                                                       |
| `playwright.events.config.js`     |              20 | 20 passed                                                                       |
| `playwright.organizer.config.js`  |              13 | 13 passed                                                                       |
| `playwright.refusals.config.js`   |               4 | 4 passed                                                                        |
| `playwright.config.js`            |             118 | 118 passed                                                                      |
| `playwright.production.config.js` |              19 | 19 passed                                                                       |
| **Total**                         |         **315** | **315 passed** (316 at the remediation SHA)                                     |

`detail-organizer-checkin.spec.js` is 11 of the detail configuration's 78 (12
of 79 at the remediation SHA) and is collected by nothing else; the four new sweep cases are in the pinned
`accessibility-sweep.spec.js`. No new configuration, no new CI job.

**The first detail run failed one case**, `detail-connect.spec.js` › "the last
step warns that nothing moves out of it", on a sign-in that never left the
form. The API log showed `POST /api/v1/auth/login 429`. Root cause: the detail
world now signs six accounts in before the first spec (two through a second
factor, two requests each), and `detail-connect` signs the owner in twice more
inside the same minute — twelve credential requests against a limit of ten. The
limiter was right. The shared helper now recognises its refusal, waits the
`Retry in N seconds` the server states, and tries once (`48185a1`); on the
re-run the limiter refused once more and the helper waited it out, as
designed.

No waiter here used `pgrep -f`; every wait was on a file the run itself
wrote.

### 16. Exact-SHA CI

**Run `35793993188`**: `workflow_dispatch` on
`claude/phase4-frontend-ui-ux-completion`, attempt 1. Its `head_sha`, read
back from the run rather than assumed, is
`16357f38e50b1f0aa556bb3708c94f0464d9a954`, the remediation SHA and the
branch head when it was dispatched. It ran from 22:44:48 to 22:54:27 UTC.
Conclusion: **success**, with all eight jobs green.

| Job                                      | Job id         | Conclusion | Cases                                                                                |
| ---------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------ |
| Policy, lint, contract, tests, build     | `106968884970` | success    | every step succeeded; the failure-artefact upload was skipped because nothing failed |
| Browser — production build               | `106968885148` | success    | 19 passed                                                                            |
| Browser — public catalogue               | `106968885284` | success    | 118 passed                                                                           |
| Browser — event lifecycle                | `106968885314` | success    | 20 passed                                                                            |
| Browser — organiser venue maps           | `106968885333` | success    | 13 passed                                                                            |
| Browser — refusals                       | `106968885331` | success    | 4 passed                                                                             |
| Browser — accessibility sweep            | `106968885377` | success    | 63 passed                                                                            |
| Browser — commerce and operations detail | `106968885417` | success    | 79 passed, including all 12 door cases and the new slow-page case                    |

That is **316 browser cases passed in CI**, the same number collected locally.
Each browser job's summary line reads `N passed` and nothing else: nothing
failed, was skipped or was flaky, and no job re-ran.

The verify job's steps, in order, each **success**: refuse a stale task
cache; language policy; CI invariants; secret scan; format; lint; API
contract; create the test database; apply migrations; test with fresh reports
and no undeclared skip; coverage thresholds; fresh-database verification;
upgrade-database verification; build; OpenAPI drift; route-manifest drift;
browser bundle scan; dependency audit; production payments are unreachable;
reliability smoke test. That job's case counts are not quoted from CI. Its log
was read here by step conclusion only. The counts in §14 come from the same
command, run on the same tree.

**Runs on this phase's commits, all of them:** `35789914694` on `48185a1`,
failed (§17). `35793993188` on `16357f3`, success. No SHA was run twice.

### 17. Failed and remediated runs

**Run `35789914694` on `48185a1` failed. It is preserved and was not re-run.**
Six of the eight jobs passed: verify (every step), production build, event
lifecycle, refusals, organiser venue maps, public catalogue. Two failed. Every
failing case was on the check-in screen, and every one failed the same way:

| Job                                                       | Case                                                                                 | What the log shows                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser — accessibility sweep (`106955683187`)            | "the check-in screen does not move, and hides nothing, when motion is reduced"       | Code typed into the field; **Look up** resolved as `<button disabled>` for the whole 90 s test timeout. 61 passed, this one failed, and the pass case after it did not run (the file is serial) |
| Browser — commerce and operations detail (`106955683206`) | "sends one admission however often Admit is pressed on a slow line"                  | The same: **Look up** disabled for 90 s after the code was filled in                                                                                                                            |
| same                                                      | "reports an admission whose answer was lost as uncertain, and the retry admits once" | The same                                                                                                                                                                                        |
| same                                                      | "works from the keyboard alone, with focus where the next action is"                 | A lookup _was_ sent, and answered `404` — a code that matched nothing — so no preview appeared                                                                                                  |

**Root cause: a defect in the door form, not in the tests.** The code is React
state, and **Look up** is enabled from that state. A code typed into the
server-drawn field before React can take it stays in the browser but never
reaches the state. React replays an input event that arrives during hydration
only if it can hydrate that field at that moment, and drops it otherwise. Input
that arrives before React's root exists has nothing to receive it. The field
then shows the code while **Look up** stays disabled beside it, and stays that
way: React records the text already in the field as its starting point, so
nothing counts as a change until another key is pressed. The next render then
writes the empty state back into the field. That is how the keyboard case sent
only the end of its code and got a `404`.

A steward on a slow phone would meet this: type the code while the page is
still arriving, and **Look up** does not work.

**Reproduced here.** With every script held back three seconds and the code
typed before they arrived, the field held the full code and **Look up** stayed
disabled (`lookUpDisabled: true`), which is exactly the CI symptom. Two things
were _not_ reproduced, and the record says so. On this machine every script
arrives before the load event. And with the CPU throttled twenty-fold, React
still hydrated the field in time to replay the typing. So the CI runner's exact
path to the dropped input is inferred, not observed. The run's artefacts, which
would show the page at the moment of failure, could not be downloaded from here
(the proxy refuses the artefact store). What is established: the symptom, a
mechanism that produces exactly that symptom, and that the fix removes it.

**Fix, `16357f3`.** When it mounts, the workspace takes up whatever is
already in the code field and the event list (`door-workspace.jsx`). Evidence:

- two component cases hydrate server-rendered HTML that already holds a typed
  code or a chosen event. Each fails when its half of the fix is removed, and
  only that one;
- one browser case, "keeps a code typed before the page's script arrived, and
  looks it up". It holds every script back 3 s and types before they arrive.
  It checks that **Look up** is still disabled at that point, which is the
  premise seen as a steward sees it. Then it checks that the button becomes
  enabled and the lookup works. Without the fix it fails with the CI symptom
  (`toBeEnabled`);
- the keyboard case now waits for **Look up** to be enabled before it presses
  Enter. An Enter pressed before the page's script arrives submits nothing,
  because the server-drawn button is disabled. That is a precondition a
  keyboard user shares, not a relaxed assertion. Every assertion in that case
  is unchanged.

No timeout was raised, no retry was added, no assertion was weakened, and no
case was skipped. The four cases that failed are otherwise unchanged. The
other three forms that disable their submit while a field is empty
(moderation decision, lifecycle command, privacy confirmation) show that
field only after a press, so after hydration; they are not exposed.

Re-run locally: the detail configuration, 79 collected and 79 passed; the
sweep, 63 and 63; and the full `verify` mirror on the remediation tree,
recorded in §14. The commit was pushed while that mirror was still running,
because a push to this branch starts no CI. The exact-SHA run was dispatched
only after the mirror came back clean.

**Run `35793993188` on `16357f3` succeeded, with all eight jobs green (§16).**
The four cases that failed in `35789914694` passed: the sweep's
reduced-motion check of the door screen, and in the detail job "sends one
admission however often Admit is pressed on a slow line" (2.6 s), "reports
an admission whose answer was lost as uncertain…" (1.1 s) and "works from the
keyboard alone…" (789 ms). The new slow-page case passed in 3.8 s.

### 18. Limitations

- **Proxy-shared global rate limit.** The API's global limiter (300 a minute)
  is keyed by address, and every browser request arrives from the web server's
  address. The door and pass budgets were re-keyed on the account; the global
  one was not, because doing it safely means the proxy forwarding a client
  address the API trusts — a change to the trust boundary this phase was not
  asked to make. At a busy venue with several stewards the global budget could
  throttle the door.
- **Timing.** A real code costs one query more than an invented one in the
  preview; mitigated by the per-account budget, not removed.
- **Lease clocks.** Lease expiry is judged by each host's clock against an
  instant the worker computed on its own; the worker's completion does not
  check its lease is still live; `sentAt` is the claim instant; leases are not
  renewed during a send.
- **Invitation scopes.** An invitation's `eventIds` are recorded but not applied
  on acceptance; an invited door role starts with no scope (which admits
  nobody) and is scoped by a role change.
- **jsqr maintenance.** Last released 2021. Pinned, lazily loaded, and its
  output is only ever a lookup request the server validates.
- **Database trigger breadth.** `desi_ticket_status_transition` allows
  `CHECKED_IN → REFUNDED/CANCELLED`, which the application's table forbids.
  Recorded, not changed.
- **Seeds.** Some seeded `CHECKED_IN` tickets have no `CheckIn` row; the door
  answers them from the ticket's own `checkedInAt`, which is why that field is
  nullable in the confirmation response.
- **The CI failure's exact timing** (§17) was inferred from its symptom and
  a reproduction, not observed; the artefacts could not be fetched here.
- **Admission window.** No event carries an admission window, so none is
  enforced; the door refuses cancelled events and lists events from a day
  before they end.

### 19. Deferred work

Reserved-seat transfer (ADR 0005, option B, with the refund-path lock and the
resale collision); applying invitation scopes on acceptance; a trusted
client-address path through the web proxy; admission windows; group booking;
offline admission (explicitly not implemented).

### 20. External systems

`PAYMENT_MODE` was never set and resolves to `MOCK`, as `payment-kill-switch.test.js` asserts — 12 of 12 locally, and in the CI step named below.
No real Stripe or Stripe Connect operation, no production payment path, no
external provider credential, no external financial operation and no
destructive retention was enabled at any point in this phase.

### Corrections to earlier sections

**`REQUIRE_DATABASE` did not reach the suites that `turbo` ran — in CI
included — until `8ccbb81`.** Phase 1's closure condition 11 says "`REQUIRE_DATABASE:
'1'` is set workflow-wide, so a suite that skipped for want of a database would
have **failed**", and the Phase 2 local-verification sections and the fifteen
settlement cases say the same of their runs. The flag was set; it was not
delivered. Turborepo's strict environment mode passes a task only the variables
`turbo.json` declares, and neither `REQUIRE_DATABASE` nor `TEST_DATABASE_URL`
was declared, so every test process `pnpm run test` started saw neither. The
database suites still ran — the default connection string matched the CI
service and the local database, so they connected and executed, and the
recorded counts of tests that ran stand — but had the database been
unreachable they would have **skipped**, not failed. The guarantee those
sentences state did not exist. `8ccbb81` declares both in `globalEnv`, and
`ci:check` now refuses a `turbo.json` without them. Proved with a probe task
before and after. The sentences above are left as written, and this is the
correction to them.

**S-2 is fixed**, in `485fe4b` — its row in the Phase 2 findings table is left
as written.

**QR presentation is no longer deferred.** The Phase 2 classification
"DEFERRED — QR ENCODER DECISION REQUIRED" was accurate when written; the
decision is §8 above.

**The ticket page's "handed over once"** described a rule the API never had —
the pass is derived again for its holder on every request. Corrected in
`docs/CHECK_IN.md` and on the page itself.

## Phase 3: closure

Fourteen separate outcomes. As with Phase 2, "Phase 3" is not one thing, and
this closure does not describe the ticketing product as complete. "VERIFIED ON
`16357f3`" means that the evidence cited ran in exact-SHA run `35793993188`
and that all eight of its jobs were green.

| Requirement                        | Classification                            | On what evidence                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Event-scoped scanner authorisation | **COMPLETE — VERIFIED ON `16357f3`**      | One policy function used by the preview, the confirmation and the events list; a module-load assertion over the role table; the eleven required negatives against real PostgreSQL, each checking that no `CheckIn` row was written (§4). Mutation M1 fails seven of them.                                                                                                                                                                              |
| Non-mutating preview               | **COMPLETE — VERIFIED ON `16357f3`**      | Writes no `CheckIn`, status or credential: the ticket row is byte-identical before and after, on the stub and on PostgreSQL. `private, no-store`; uniform 404; rate-limited per account; strict Zod request and response schemas with a named presenter; hostile-payload tests (§3, §5).                                                                                                                                                               |
| Preview-to-check-in revalidation   | **COMPLETE — VERIFIED ON `16357f3`**      | The confirmation re-derives everything inside its own transaction, with locks taken in one order. A validly signed reference for a caller who has since lost authority admits nobody. The reference is HMAC-bound to ticket, event, organisation, account and method, and expires after two minutes (§5, negatives 2, 3, 10, 11).                                                                                                                      |
| Exactly-once check-in              | **COMPLETE — VERIFIED ON `16357f3`**      | Ten races and a deadlock check on real PostgreSQL. Two of them force the interleaving by waiting on `pg_stat_activity`. Mutation M2 fails both. In the browser, a double press sends one request and a lost answer retries without a second row (§7).                                                                                                                                                                                                  |
| Manual admission                   | **COMPLETE — VERIFIED ON `16357f3`**      | `MANUAL_CODE` is derived, never chosen by the client. The door screen covers typed lookup, preview, **Admit**, already-in, not-found, uncertain and retry, keyboard-only use, and a code typed before the page's script arrives (§6, §13, §17).                                                                                                                                                                                                        |
| QR attendee pass                   | **COMPLETE — VERIFIED ON `16357f3`**      | `uqr@0.1.3`, pinned. Shown to the holder only, on request, from a `no-store` endpoint. The component keeps the drawing, never the string. The pass is absent from markup, storage, URL, lists and test artefacts, and cleared on hide, `pagehide` and leaving. The page gives bearer guidance and does not claim screenshots can be prevented (§8, §9).                                                                                                |
| QR scanner                         | **COMPLETE — VERIFIED ON `16357f3`**      | `jsqr@1.4.0`, pinned and loaded only when the camera starts. The camera starts only on a press; decoding is local; nothing is uploaded or kept; tracks stop. The order is decode, then preview, then confirm. Denied, unavailable and absent cameras each have their own message. Proved by a real round trip in Chromium with a synthetic camera stream. Physical devices and other browsers were not tested. `BarcodeDetector` is not used (§8, §9). |
| Organiser check-in UI              | **COMPLETE — VERIFIED ON `16357f3`**      | `/organizer/check-in` for members whose role carries `ticket:check_in`. It is not the authorisation boundary: every decision above is the server's. The sweep covers seven widths, 200% zoom, reduced motion and a refused camera; the detail spec covers behaviour, with admissions read from PostgreSQL (§13, §15). No offline admission.                                                                                                            |
| Member-email protection            | **FIXED — VERIFIED ON `16357f3`**         | The server decides `FULL` or `MASKED` per caller, and a discriminated response schema enforces it. `emailMasked` must contain `*`. The matrix covers owner, admin, manager, staff, viewer, scanner and platform admin, with hostile-payload tests and whole-body address searches (§10).                                                                                                                                                               |
| Notification retry lease           | **FIXED — VERIFIED ON `16357f3`**         | Every condition is in the `UPDATE`'s `WHERE`. Eleven real-PostgreSQL cases race the dispatcher's own claim and completion. Routes stay platform-only; audit rows carry no body or recipient. Restoring the old code fails four cases (§11).                                                                                                                                                                                                            |
| Reserved-seat transfer             | **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT** | Not fixed, and not marked fixed. ADR 0005 records the decision. What changed is that the block is now enforced: 422 at the start, 409 at acceptance, and the ticket screen no longer advertises it. S-2, a neighbouring defect, is fixed (§12).                                                                                                                                                                                                        |
| Offline admission                  | **NOT IMPLEMENTED**                       | Deliberately, as the brief required. Offline, the door screen says there is no offline admission, and looks nothing up.                                                                                                                                                                                                                                                                                                                                |
| Group booking                      | **NOT IMPLEMENTED**                       | Unchanged from Phase 2: no group model, no lead booker, no per-attendee assignment.                                                                                                                                                                                                                                                                                                                                                                    |
| Real Stripe and Stripe Connect     | **EXTERNAL VERIFICATION PENDING**         | `PAYMENT_MODE` resolved to `MOCK` throughout. The payment kill-switch suite passed 12 of 12 locally and in the CI step "Production payments are unreachable". No real charge, payout, transfer, refund, webhook or provider credential was exercised (§20).                                                                                                                                                                                            |

### What this closure does not claim

The ticketing product is not complete, and this closure does not say it is.
Reserved-seat transfer is still blocked, and offline admission and group
booking do not exist. The limitations in §18 stand: the proxy-shared global
rate limit, the preview's timing residue, the lease clocks, invitation scopes
not being applied, `jsqr`'s maintenance, the trigger's breadth, the admission
window, and the CI failure's inferred timing. Every live-payment question is
still external.

`PAYMENT_MODE` stayed `MOCK`. No real Stripe or Stripe Connect operation, no
production payment path, no external provider credential, no external
financial operation and no destructive retention was enabled at any point.

---

## Phase 3 closure audit

_Added 2026-09-23, after Phase 3 was provisionally accepted on exact-SHA run
`35793993188`. Everything above is left as written. Where this audit found a
sentence above to be untrue, it says so here._

The owner asked for the evidence the closure message had left out, before any
Phase 4 work. The audit had three stages:

1. **Gather.** Fourteen agents gathered the evidence from the CI API, the CI
   logs and the code, then verified it adversarially. Each claim was re-checked
   by an agent told to refute it.
2. **Critique.** A completeness critic compared the result with the owner's
   checklist. 64 of 88 lines were evidenced. The other 24 held two real
   defects, two tests that passed for the wrong reason, and a set of gaps in
   the evidence.
3. **Remediate.** Everything found was fixed in five commits. Each fix was
   reviewed adversarially, with a mutation check for every new test, and
   verified through a new exact-SHA run (§A11).

### A1. Commits

| Role                                                                            | Full SHA                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| Original Phase 3 implementation (its exact-SHA run failed)                      | `48185a17c7b4fb23c8419ce33e781a09e80c4e07` |
| Phase 3 remediation (hydration)                                                 | `16357f38e50b1f0aa556bb3708c94f0464d9a954` |
| Documentation-only report closure                                               | `95fc3effc945375cecd8b9725053e8ffcd40cf4c` |
| Audit: door camera, test artefacts                                              | `43173f8f7b6a5c4d8876f050beec2de8a96cccb1` |
| Audit: method, printed code                                                     | `06cd70daa2e4badcf79237d3391f1072bd539c68` |
| Audit: admission evidence on PostgreSQL                                         | `2448476b7ba3347a432cd24aac6b8d0bd68584bf` |
| Audit: notification queue evidence                                              | `ef39795a124d35ed500a899cc6a8087caa7d3235` |
| Audit: fresh-report hardening, CI evidence tail — **the audit remediation SHA** | `3fe58a7fdb0c9c811c51d73f96926029362063f4` |

### A2. Run `35793993188`, item by item

Sources: the Actions API for run and job metadata; the job logs, read through
the connector, which returns at most the last 5,000 lines of a log. The verify
job's log is 7,832 lines, so its first 2,832 lines could not be read here. The
logs archive could not be downloaded either: the egress proxy refused the
connection.

| #     | Item                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Head SHA                         | `16357f38e50b1f0aa556bb3708c94f0464d9a954`, read back from the run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2     | Trigger, attempt                 | `workflow_dispatch`, attempt 1, run number 71                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3     | Timestamps                       | created and started 2026-09-22T22:44:48Z; completed (last update) 22:54:27Z. Jobs ran from 22:44:52Z to 22:54:26Z                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4     | Jobs                             | All eight **success**: verify `106968884970`; production build `106968885148`; public catalogue `106968885284`; event lifecycle `106968885314`; organiser venue maps `106968885333`; refusals `106968885331`; accessibility sweep `106968885377`; commerce and operations detail `106968885417`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5     | Skipped steps                    | Eight, one per job, each skipped because nothing failed. Verify step 27 "Upload failure artefacts" is `if: failure()` (ci.yml:208). Step 11 "Upload Playwright artefacts" in each browser job is `if: failure()` (ci.yml:337). No other step in any job was skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6     | Cancelled or rerun               | None. The `all` and `latest` job listings are the same eight ids, every one attempt 1, every conclusion success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7     | Fresh non-browser total          | **Not observable in CI for this run.** Step 16's own table falls in the unreadable 2,832 lines. The step concluded success, and the command exits nonzero on any refusal, so zero failed and zero skipped follows from the code; it was not seen. The Coverage step is a second run of the same test files, and it is visible: 15 packages, 222 files, **5,684 cases, all passed**, no skip marker. `@desi-event/config` has no coverage script, so its 72 cases are the difference from the local total of 5,756 for the same tree. From §A11 on, the verify job's last step prints the command's table again, inside the readable tail                                                                                                                                                                |
| 8     | Coverage                         | The step succeeded: 18 tasks, 0 cached. No threshold changed in Phase 3 (`git diff 21af69a..16357f3` over every vitest config, turbo.json and package.json has no coverage line). Thresholds are 80/80/75/80 (lines, functions, branches, statements) in api, worker, api-contract, auth, inventory, ledger, logger, notifications, permissions, pricing, providers and schemas. `db`, `web` and `ui` have none. `config` resolves to the default but has no coverage script, so it is not enforced                                                                                                                                                                                                                                                                                                     |
| 9     | Fresh and upgrade database       | Fresh: **99/99 checks**. The db package ran 3 files and 102 cases against it, and the API's database suites ran 11 files and 168 cases, including admission-integration 28, notification-lease-integration 11 and seat-transfer-block-integration 4. Upgrade: **26/26 checks**. Every migration was applied over existing rows, the admission migration `20260922200000_admission_scope_and_method` among them, and the upgraded database matched a fresh one on 1,488 catalogue entries. Both disposable databases were destroyed                                                                                                                                                                                                                                                                      |
| 10    | Reliability smoke                | Three scenarios, all PASS. General-admission hold contention: 4,728 calls. Reserved-seat hold contention: 6,558 calls. Check-in concurrency: 3,328 calls. The runner prints an invariant only when it breaks, and no invariant line appeared; that, plus the PASS verdicts, is the evidence that they held                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 11    | Payment kill switch              | 1 file, **12/12** (`payment-kill-switch.test.js`). `PAYMENT_MODE` appears nowhere in the workflow, so it resolves to `MOCK`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 12    | Dependency audit                 | `pnpm audit --audit-level moderate`: no known vulnerabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 13    | Build, bundle scan               | Build: 3 tasks. The api and web builds were replays of cache misses executed earlier in the same job. Bundle scan: OK, **362** browser-deliverable files, nothing server-only, **no service workers**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 14    | Contract, OpenAPI, manifest      | Validate API contract: step success. Its output is in the unreadable part of the log. OpenAPI drift: `openapi.json` up to date. Route manifest: 134 routes written, and `git diff --exit-code` printed nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15–16 | Browser collection and execution | Each job's own "Running N tests" line against its summary: public catalogue **118 / 118 passed**; production build **19 / 19**; event lifecycle **20 / 20**; organiser venue maps **13 / 13**; refusals **4 / 4**; accessibility sweep **63 / 63**; detail **79 / 79**. In every job, collected equals executed: no failure, flake, skip, did-not-run or retry marker. Locally, `playwright test --list` on the same tree gives the same seven numbers, 316 in all                                                                                                                                                                                                                                                                                                                                      |
| 17    | Accessibility sweep              | 63 / 63, including the door cases at seven widths, 200% zoom, reduced motion and a refused camera                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 18    | PostgreSQL and Redis ran         | CI sets `REQUIRE_DATABASE=1` workflow-wide, and the command forces it on its child. The PostgreSQL helper then turns an unreachable database into a failure rather than a skip. The two worker Redis suites skip when Redis is unreachable, but the fresh-report command refuses any skip not on the allow-list, and the allow-list is empty. In the Coverage step's visible output, every database and Redis suite shows as run and passed with its case count: admission-integration 28, notification-lease-integration 11, seat-transfer-block-integration 4, ticket-concurrency 14, refund-concurrency 13, reserved-seat-concurrency 15, settlement-invariants 14, redis-integration 6, redis-retention 4, retention-postgres 7, and others. There is no skip marker anywhere in the visible window |

**Failed run `35789914694` stays a product defect.** It failed on
`48185a1`: sweep job `106955683187` and detail job `106955683206`. Four door
cases failed the same way: a printed code typed before the page's script took
hold was on screen while **Look up** stayed disabled, or only its tail was
sent. §17 above gives the mechanism, reproduced deterministically, and its fix
in `16357f3`. It was not flaky timing and is not recorded as such.

### A3. The fresh-report command

It was implemented in `8ccbb81`, before any Phase 3 feature work, and hardened
by this audit in `3fe58a7`.

- **Script:** `"verify:tests:fresh": "node scripts/verify-tests-fresh.mjs"` in
  the root `package.json`. It also sits in the local gate: `pnpm verify` ran
  a cacheable `pnpm run test` until `3fe58a7`, and now runs this command.
- **Implementation:** `scripts/verify-tests-fresh.mjs`, with
  `scripts/lib/vitest-reports.mjs`. The allow-list is
  `scripts/skipped-tests-allowlist.json`, currently `[]`. Every entry needs a
  pattern and a reason of at least ten characters.
- **Expected manifest:** the packages that must report are read from
  Turborepo's own plan (`turbo run test --dry=json`): every `test` task with a
  real command. The expected report is `<package>/vitest-report.json`. An
  expected report that is absent is refused. A report anywhere else is
  refused. An empty plan exits 2.
- **Deleting old reports:** the whole tree is walked for `vitest-report.json`,
  skipping node_modules, .git, .next, .turbo, coverage and dist. Every report
  found is deleted first, before the run's clock starts. Since `3fe58a7`:
  - a report that is a symbolic link is deleted (the link itself);
  - a directory link the walk cannot follow refuses the run;
  - a deletion error other than ENOENT refuses the run before it starts,
    naming the file.
- **Start time and identity:** `runStartedAt` is taken after deletion and
  before the child is spawned. A report is accepted only if both hold:
  - its modification time is no more than 2 s before that instant;
  - the `startTime` Vitest writes inside it is at or after that instant, with
    no allowance.

  Since `3fe58a7`, a `startTime` later than the moment of judgement plus 2 s
  is refused too. Identity is time-based. Vitest's JSON reporter carries no
  run id to bind to, so a concurrent Vitest write on the same machine inside
  the window could not be told apart. That limitation is recorded rather than
  papered over.

- **What is refused, and where it is tested**
  (`packages/config/tests/verify-tests-fresh.test.js`):

| Report                      | Tested by                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing                     | "refuses a missing report — what a Turborepo cache hit leaves behind"; "refuses a package expected to run that produced no report"                                                                                                                                                                 |
| Malformed                   | "refuses a malformed report", and since `3fe58a7` "refuses %s as malformed instead of crashing on it" for a null entry, a case with no status and cases that are not a list                                                                                                                        |
| Empty                       | "refuses an empty report"                                                                                                                                                                                                                                                                          |
| Not a report                | "refuses valid JSON that is not a report" (a structural check)                                                                                                                                                                                                                                     |
| Stale by mtime              | "refuses a cached result that leaves an old report unchanged on disk"; the boundary: "allows a modification time a coarse filesystem rounded down, and no more"                                                                                                                                    |
| Stale contents, fresh mtime | "refuses a report restored with a fresh timestamp and old contents"; "refuses a report with no startTime…"                                                                                                                                                                                         |
| Future-stamped              | "refuses a report stamped a year in the future"; "judges the future from when the report is read, not from when the run began" (since `3fe58a7`)                                                                                                                                                   |
| Symbolic link               | "deletes a report that is a symbolic link — the link, not what it points at"; "refuses a report that is a symbolic link, even to a report this run wrote"; "refuses the run, before it starts, when a directory link hides what is behind it" (since `3fe58a7`)                                    |
| Skipped                     | "refuses a report containing skipped tests"                                                                                                                                                                                                                                                        |
| Todo, pending               | "refuses `todo` and Jest's `pending` too"                                                                                                                                                                                                                                                          |
| Zero-test package           | "refuses a package that ran no tests at all"                                                                                                                                                                                                                                                       |
| Zero-test file              | "refuses one test file with no tests inside a package that ran plenty"                                                                                                                                                                                                                             |
| Failed with exit 0          | "refuses a failed test even when the run itself exited zero"                                                                                                                                                                                                                                       |
| Unknown status              | "refuses a case whose status it does not know, rather than counting it as nothing" (since `3fe58a7`; no allow-list escape)                                                                                                                                                                         |
| Failure outside any case    | "refuses a test file that failed outside its cases, though every case passed"; "refuses a report that says the run did not succeed, even with nothing marked failed" (since `3fe58a7`)                                                                                                             |
| Counters that disagree      | "refuses a report whose counters disagree with the cases it lists" (pending and todo), and since `3fe58a7` "refuses a report whose %s disagrees with the cases it lists" for `numTotalTests`, `numPassedTests` and `numFailedTests`. Checked first against real Vitest 5 reports, where they agree |

- **Turbo cache:** Turborepo runs as `run test --force`, placed before the
  `--`. Vitest's own flags go after it (pinned by a test). CI also deletes
  `.turbo` first. `vitest-report.json` is not a cached output of the test
  task, so a cache hit can only leave a report unwritten, and a missing report
  is refused.
- **Local run matches CI:** CI runs exactly `pnpm run verify:tests:fresh`
  (ci.yml, step "Test, with fresh reports and no undeclared skip"). The
  command forces `REQUIRE_DATABASE=1` itself. `turbo.json` declares
  `REQUIRE_DATABASE` and `TEST_DATABASE_URL` in `globalEnv`. `ci:check`
  refuses:
  - a workflow that writes or judges reports any other way;
  - a `turbo.json` without those variables;
  - since `3fe58a7`, a verify job that does not end by printing the
    command's table from `test-results/verify-tests-fresh.txt` with no
    condition and no `continue-on-error`.
- **Regression tests:** the file had 26 cases at `8ccbb81`. At `3fe58a7` the
  config package runs 103, all passing. Every new rejection fails with its
  check removed (mutation checks recorded in the commit). The deletion refusal
  is proved for EACCES, EPERM and EBUSY.
- **CI line:** `run: pnpm run verify:tests:fresh`, plus, since `3fe58a7`, a
  last step `run: cat test-results/verify-tests-fresh.txt`.

**Classification: IMPLEMENTED.** The approved requirement is met. The audit's
hardening goes beyond it.

### A4. QR evidence

- **Packages:**

| Role    | Package | Pin          | Licence    | Transitive dependencies |
| ------- | ------- | ------------ | ---------- | ----------------------- |
| Encoder | `uqr`   | 0.1.3, exact | MIT        | 0                       |
| Decoder | `jsqr`  | 1.4.0, exact | Apache-2.0 | 0                       |

They are the only two direct dependencies Phase 3 added to `apps/web`.
`pnpm audit` reports no known vulnerabilities.

- **Bundle effect**, measured from production builds of `21af69a` and
  `16357f3` in throwaway worktrees, gzip level 9:
  - `/tickets/[id]` grows by 13,723 B raw / **5,004 B gzip**, all of it in
    that route's page chunk, which holds uqr's `encode`, `lib/qr.js` and the
    pass component. uqr's own share is about 3.7 KB gzip.
  - `/organizer/check-in` loads 151,301 B gzip on first load, and none of it
    is jsqr.
  - jsqr is a single chunk of 129,980 B raw / **46,372 B gzip**. It is named
    only by a 215 B loader stub and fetched only by the dynamic import when
    decoding starts.
  - No other route's first load contains either package.
- **No network calls:** every shipped file of both packages was scanned for
  `fetch(`, XMLHttpRequest, WebSocket, EventSource, sendBeacon, importScripts,
  `new Worker`, `import(`, http requires, `eval(` and `new Function`. There
  were no hits. The only `http` strings are an SVG namespace and licence
  URLs.
- **No TypeScript copied:** `git ls-files '*.ts' '*.tsx' '*.mts' '*.cts'` is
  empty. No `.d.ts`, licence header or identifier from either package is in a
  tracked file. The packages' own `.d.ts` stay inside `node_modules`, which
  the language policy permits.
- **The QR holds the secure credential:** `/tickets/:id/pass` mints the HMAC
  credential, checks it against the stored digest and returns
  `{ticketId, credential, credentialVersion, issuedAt}`, with no printed code.
  The component encodes `data.credential` and keeps only the drawing. The
  browser test decodes the drawing, gets a 43-character credential, and the
  admission it causes is recorded as `QR_SCAN` in PostgreSQL. One consequence
  of the shape rule is worth noting: printed codes are pass-shaped. A QR that
  encoded a printed code would be sent as a credential and refused with a 404.
  It fails closed and is not an admission path.
- **Where the credential never goes:**
  - URLs: the path carries the ticket id only, and the door sends the
    credential in a POST body.
  - Browser storage: the holder page is tested since Phase 3; the door page
    (storage, cookies, IndexedDB, address) since `43173f8`.
  - Logs: redaction keys cover `credential` and `previewReference`. Since
    `2448476`, a capture test asserts that no log line carries the credential,
    its digest, a printed code or a reference.
  - Analytics: there is no analytics code in the web app.
  - Snapshots: no snapshot assertions exist.
  - Screenshots: the detail spec turns screenshots, traces and video off.
    Since `43173f8` the sweep never draws a real pass, and a guard refuses any
    spec that could. **Correction:** until then the sweep could have kept a
    screenshot of a live pass on failure. §9 and the closure table above say
    otherwise; they were wrong.
  - Service-worker caches: there is no service worker (the bundle scan
    counts 0).
  - Audit metadata: no admission audit write carries the credential, code or
    reference. Since `2448476` this is asserted on PostgreSQL over every row
    the admission suite causes, refusals included. Since `06cd70d` the
    revocation audit row and the transfer-invitation outbox payload no longer
    carry the printed code.
- **Camera:**
  - Frames are drawn to an off-screen canvas and decoded on the device. There
    is no upload path.
  - **Correction:** "nothing is kept; tracks stop" (§9 and the closure table)
    was not true in one race. A camera granted after the steward had stopped,
    switched to typing or left kept running. Fixed in `43173f8`: a stream that
    arrives after a stop is stopped at once and never shown.
  - Stop now demonstrably forgets the last pass and frame.
- **Decode leads to preview only:** a decode calls the preview endpoint.
  `/check-in` is called only from **Admit**, and only with a reference.
- **Both steps enforce scope and admissibility:** preview and confirmation
  each read membership, scope and ticket state from the database. The
  confirmation re-derives all of it under lock (§A5).
- **QR scanning was verified in Chromium using a simulated camera.** The
  camera was a canvas stream painting the holder's QR. **Physical-device and
  non-Chromium camera verification: EXTERNAL DEVICE VERIFICATION PENDING.**
  Those environments are not classified as verified.

### A5. Authorisation evidence

"PG" means real PostgreSQL (`admission-integration.test.js` unless another file
is named); "stub" means the Prisma stub.

| Scenario                                           | Test                                                                                                                                                                                                                  | DB  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Scanner on event A previews event B                | "1. a scanner scoped to event A cannot preview a ticket for event B" — 404, identical to an invented code                                                                                                             | PG  |
| Scanner on event A checks in event B               | "2. … cannot check in a ticket for event B, even with a signed reference" — 403, no row                                                                                                                               | PG  |
| Scanner of organisation A, organisation B's ticket | Since `2448476`: a SCANNER of the rival organisation, scoped to its own event — preview by code and by credential 404, confirmation with a signed reference 403, no row. Also "3. an owner of organisation A cannot…" | PG  |
| No ScannerScope                                    | "4. a scanner with no scope admits nobody"                                                                                                                                                                            | PG  |
| Scope revoked between preview and confirmation     | "10. a scope withdrawn between preview and confirmation…"; "5. a scope withdrawal in flight…" (forced interleaving); since `2448476` also by credential                                                               | PG  |
| Membership removed                                 | "5. a removed membership admits nobody, even to a caller still holding the old actor"                                                                                                                                 | PG  |
| Missing capability                                 | "7. a role without ticket:check_in is refused, even with a scope row"; since `2448476` a demotion after a credential preview                                                                                          | PG  |
| Browser event id conflicts                         | Preview: "8. the event id a browser sends never decides authority". Confirmation: since `2448476`, 409 `WRONG_EVENT` by code and by credential, no row                                                                | PG  |
| Transferred after preview                          | "8. a transfer accepted after the preview leaves the old pass admitting nobody" (real transfer services)                                                                                                              | PG  |
| Revoked after preview                              | "6. a revocation in flight…" (real revoke, forced interleaving)                                                                                                                                                       | PG  |
| Refunded after preview                             | "7. a ticket refunded after its preview is refused, by pass and by code". Since `2448476` it drives the real refund service, not a copy of its writes                                                                 | PG  |
| Another scanner admits after preview               | "4. a preview overtaken by another steward's admission confirms as already in"                                                                                                                                        | PG  |
| Two simultaneous confirmations                     | "1. two simultaneous confirmations of one preview admit once"; "2. two stewards…"; "10. a network retry…"                                                                                                             | PG  |
| QR and manual racing                               | "3. a QR scan and a typed code racing for one ticket admit once, recording the winner's method"                                                                                                                       | PG  |

- **A successful preview grants nothing.** The confirmation runs the door
  authority check again and verifies the reference's MAC and expiry. It then
  uses the reference only as a binding: same account, same method, same
  ticket, event and organisation. Inside its transaction it locks the ticket
  and re-reads membership, scope and ticket state. Negatives 2, 3, 4, 7, 10
  and 11 confirm with a validly signed reference and are refused.
- **The event and organisation come from the ticket's own rows.** The chain
  is ticket → order item → order → event → organisation. A browser-sent
  `expectedEventId` is only compared against it and never grants anything.
- **Correction:** the forced-interleaving helper used to wait for any lock
  waiter in the whole database, so the interleaving was attempted, not
  verified. Since `2448476` it waits for a session blocked by the holding
  transaction itself (`pg_blocking_pids`). It was shown to catch a mutant
  that the old helper passed.

### A6. Method

- **How the server decides:** `QR_SCAN` is recorded when the secure credential
  was presented, and `MANUAL_CODE` when the printed code was. The server
  cannot know whether a camera produced the credential. The door screen sends
  a credential only from its camera path, but that is a property of the
  client. **Stated limitation:** `QR_SCAN` means "the credential was
  presented", nothing more. The schema comment claimed a camera and was
  corrected in `06cd70d`.
- **No override method:** there is no `ORGANIZER_OVERRIDE`. `ASSISTED`
  exists in the enum and is written by nothing. No override endpoint exists.
- **The browser cannot choose the method:**
  - both request schemas are strict, so a body naming `method` is a 400
    (route test);
  - the preview reference is MAC-bound to the method, so a code preview
    cannot be confirmed as a scan (`PREVIEW_MISMATCH`, route test);
  - since `06cd70d`, `admit()` has no default method and refuses anything but
    the two it records (PostgreSQL test).

### A7. Member email and the notification queue

**The email matrix.** The server decides, in `emailVisibilityFor`: a caller
who can invite gets full addresses, everyone else gets masked ones. A
discriminated response schema then enforces the decision; a masked entry has
no `email` key, and `emailMasked` must contain `*`. CSS plays no part.

| Caller                                               | Team list                             |
| ---------------------------------------------------- | ------------------------------------- |
| Owner                                                | full email                            |
| Administrator                                        | full email                            |
| Manager                                              | full email                            |
| Staff                                                | masked email                          |
| Viewer                                               | masked email                          |
| Event manager, finance                               | masked email                          |
| Scanner                                              | no email (403; no member list at all) |
| Platform administrator (SUPER_ADMIN)                 | full email                            |
| Other platform roles, member of another organisation | no email (403)                        |

Two conditions on the matrix:

- **Second factor:** the full-address roles are privileged. They see anything
  only once their second factor is confirmed; before that the answer is 403.
- **What the mask reveals:** the first and last characters of the local
  part, its length, and the domain, next to the member's display name. The
  owner has since recommended a generic form that reveals less (§A10). It is
  not implemented here: this closure is documentation-only, and the same
  masker serves the transfer screens.

The "whole-body" door test was searching an empty list. It is fixed in
`2448476`.

**Retry lease tests** (PG = `notification-lease-integration.test.js`):

| Case                           | Test                                                                                                                                                                                                                                                      | DB                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Ordinary failed-message retry  | Dead letter; since `ef39795` also FAILED and RETRY_SCHEDULED, each reset and audited                                                                                                                                                                      | PG                       |
| Retry while leased             | "refuses a message a worker is sending, and leaves the lease exactly as it was"                                                                                                                                                                           | PG                       |
| Retry after lease expiry       | Refused by design (the worker reclaims): "refuses a message whose lease has lapsed…"                                                                                                                                                                      | PG                       |
| Retry racing worker completion | "cannot undo a worker's completion that lands while the operator is looking"                                                                                                                                                                              | PG                       |
| Two simultaneous retries       | "turns two operators pressing retry at once into one requeue and one audit row"                                                                                                                                                                           | PG                       |
| Cross-organisation denial      | The routes are platform-only (`reconciliation:manage`). The message organisation's own owner, a manager, and since `ef39795` a member of another organisation are all refused with `FORBIDDEN` asserted. So is every platform role without the capability | stub (a capability gate) |
| Audit without leakage          | The audit metadata holds status, template, attempts and reason. The tests assert recipient, payload and dedupe key are absent                                                                                                                             | PG                       |

### A8. The hydration remediation

- **Mechanism:** one mount effect in `door-workspace.jsx` with an empty
  dependency list. It reads the event select's and the code field's DOM
  values through refs and adopts each one that is non-empty. Both inputs stay
  controlled with string values. After mount, React state is the only source.
- **No warning:**
  - Every hydration case, and since `43173f8` every case in the file, fails
    on any React complaint on the console.
  - Every hydration goes through `onRecoverableError`, and a recovered
    mismatch fails the case.
  - Both traps were proved: a forced switch from controlled to uncontrolled
    input fails 4 cases, and a forced render mismatch fails 5.
  - In Chromium, the slow-page cases assert no console error or warning.
- **Cannot overwrite valid input:** values are adopted only when non-empty,
  and only once, on mount (Strict Mode runs the effect again against the same
  DOM). Typing after hydration updates state directly, and a unit case shows
  it is never overwritten.
- **Coverage of the five value kinds:**

| Case                           | Unit test                  | Chromium                                                      |
| ------------------------------ | -------------------------- | ------------------------------------------------------------- |
| Empty                          | yes                        | probe                                                         |
| Partially typed, then finished | yes                        | test, since `43173f8`                                         |
| Pasted                         | yes                        | probe, using the real clipboard                               |
| Autofilled                     | yes                        | probe                                                         |
| Preselected event              | yes, including Strict Mode | not exercised: no seeded door account has more than one event |

"Autofilled" means a value set with input and change events, which is what
autofill does at the DOM level. Chromium's own autofill needs profile data
and was not driven.

- **Regression test:** it holds every script back 3 s, types first, and
  checks that **Look up** is still disabled. It then checks that the button
  becomes enabled and the lookup works. Without the fix it fails with the CI
  symptom.
- **Mutations:**
  - Removing the code half fails exactly the code-adoption cases, 5 in all.
  - Removing the event half fails exactly the 2 event cases.
  - Removing the camera guard fails exactly the race cases.
- **The keyboard test** still types the code and submits with Enter, never a
  click, and asserts the preview heading is focused. The only added line
  waits for **Look up** to be enabled. The diff removes no assertion and
  raises no timeout; the Playwright configurations are unchanged since
  `21af69a`.

### A9. What the audit found and fixed

| Found                                                                                                                                                                                                                                                     | Fixed in             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A camera granted after a stop kept running; a stop during `play()` left the panel saying the camera was on                                                                                                                                                | `43173f8`            |
| The sweep drew a live pass under screenshot-on-failure; closing the context in `finally` does not prevent the capture                                                                                                                                     | `43173f8`            |
| `admit()` defaulted the method to `QR_SCAN`; the schema comment claimed a camera                                                                                                                                                                          | `06cd70d`            |
| The printed code was in the revocation audit row and the invitation outbox payload                                                                                                                                                                        | `06cd70d`            |
| Two tests passed for the wrong reason: the door email search ran on an empty list, and a refunded-ticket check-in refusal passed on a Prisma validation error. Three more refusal matchers were loose                                                     | `2448476`, `06cd70d` |
| No real-PostgreSQL case for a cross-organisation SCANNER, a confirmation-time event mismatch, or scope and role withdrawal after a QR preview; refunds were simulated; audit absence was asserted only on the stub; the interleaving helper was too loose | `2448476`            |
| No log-capture evidence                                                                                                                                                                                                                                   | `2448476`            |
| Only the dead-letter retry was proved; organiser refusals were not asserted by code                                                                                                                                                                       | `ef39795`            |
| Fresh-report gaps: symbolic links, undeletable reports, future timestamps, unknown statuses, failures outside any case, counters; `pnpm verify` bypassed the command; the CI table was unreadable from the log tail                                       | `3fe58a7`            |

Also corrected in the documentation commit: `docs/SECURITY.md` said "No
screen renders a pass". A dated correction now stands beside it.

### A10. Still open, and not claimed

- **Test-only, by the owner's own limitation:** physical camera devices and
  non-Chromium browsers.
- **Owner recommendation, recorded 2026-09-23 and not yet implemented:**
  lower-privilege roles should see a stable, generic form that keeps neither
  the local part's length nor its last character, such as `Hidden email` or
  `k•••@example.com`. Owners and authorised membership administrators keep
  full addresses, after required step-up authentication. This is a code
  change, and it needs its own exact-SHA run, so it is not part of this
  documentation-only closure. It will have to settle three things:
  - `maskRecipient` also masks the recipient on the transfer screens and in
    the operations outbox. The change covers the team list alone or all
    three, and that has to be decided explicitly.
  - The team response schema requires `emailMasked` to contain `*`. A generic
    form without one needs the schema to change with it.
  - Today, full addresses need `team:invite` (OWNER, ADMIN, MANAGER, or a
    platform SUPER_ADMIN) and an enrolled second factor, which each of those
    roles must have. The team list declares no step-up window, so "after
    required step-up" is new work. So is deciding whether MANAGER counts as
    an authorised membership administrator.
- **Seen in run `35814340442`, not traced:** the detail job's server output
  carries one Node `DeprecationWarning` from `pg` 8.23.0: "Calling
  client.query() when the client is already executing a query is deprecated
  and will be removed in pg@9.0". Node prints a warning like this once per
  process. So it shows only that some path issues two queries at once on one
  connection. It fails nothing today, and it is recorded here for the pg 9
  upgrade.
- **Unchanged from §18:** the proxy-shared global rate limit, the preview's
  timing residue, lease clocks, invitation scopes not being applied, `jsqr`'s
  maintenance, the trigger's breadth, and admission windows.
- **Not implemented:** reserved-seat transfer, offline admission, group
  booking.
- **External:** every real Stripe and Connect operation.

### A11. Exact-SHA CI for the audit remediation

Run `35814340442`, run number 72, `workflow_dispatch`, attempt 1. The sources
are the same as in §A2. This time everything the owner asked to see falls
inside the last 5,000 lines of each log.

| Condition the owner set                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact head SHA                           | `3fe58a7fdb0c9c811c51d73f96926029362063f4`, read back from the run. It is the audit remediation SHA (§A1) and is still the head of the branch                                                                                                                                                                                                                                                                                      |
| Timestamps                               | Created and started 2026-09-23T03:26:37Z; completed (last update) 03:35:54Z                                                                                                                                                                                                                                                                                                                                                        |
| All eight jobs successful                | Each **success**, each attempt 1: verify `107032536354`; commerce and operations detail `107032536443`; accessibility sweep `107032536459`; public catalogue `107032536473`; production build `107032536477`; refusals `107032536524`; organiser venue maps `107032536547`; event lifecycle `107032536649`. The `all` job listing holds exactly these eight                                                                        |
| Only failure-conditional uploads skipped | Eight skipped steps, one per job. In verify it is step 28, "Upload failure artefacts" (`if: failure()`, ci.yml:217). In each browser job it is step 11, "Upload Playwright artefacts" (`if: failure()`, ci.yml:346). Every other step in every job succeeded                                                                                                                                                                       |
| No rerun                                 | The run and all eight jobs are attempt 1. It is the only run on `3fe58a7`. The run before it, `35793993188`, was on `16357f3`                                                                                                                                                                                                                                                                                                      |
| Fresh-report summary visible in CI       | Verify step 27, "Fresh-report summary", printed the table below at 03:34:21Z. It ends about 970 lines before the end of the 8,354-line log. Everything after it is post-job cleanup and the service containers' own logs                                                                                                                                                                                                           |
| Database                                 | Fresh: **99/99 checks passed**. Its API database suite ran 11 files and 177 cases, against 168 in §A2, and the disposable database was destroyed. Upgrade: **26/26 checks passed**. Every migration applied over existing rows, the admission migration `20260922200000_admission_scope_and_method` among them, and the upgraded database matched a fresh one on 1,488 catalogue entries. Both disposable databases were destroyed |
| PostgreSQL and Redis ran                 | `REQUIRE_DATABASE: 1` is in every step's environment, so an unreachable database fails the run instead of skipping. The fresh-report table shows 0 skipped across 5,860 cases, and a Redis suite that skipped would have been refused                                                                                                                                                                                              |
| Coverage                                 | `Tasks: 18 successful, 18 total` and `Cached: 0 cached, 18 total`. A missed threshold fails its task, and none failed. The narrowest margin visible is api's branch coverage, 77.52% against 75%. No threshold changed in the audit: across `16357f3..3fe58a7`, the only change to a vitest config, `turbo.json` or a `package.json` is the root `verify` script                                                                   |
| Reliability                              | Three scenarios, `ga-hold-contention`, `seat-hold-contention` and `check-in-concurrency`, each `1/1 scenario(s) passed`                                                                                                                                                                                                                                                                                                            |
| Payment kill switch                      | `tests/payment-kill-switch.test.js`: 1 file, **12 passed (12)**. `PAYMENT_MODE` appears nowhere in the workflow, so it resolves to `MOCK`                                                                                                                                                                                                                                                                                          |
| Dependency audit                         | `No known vulnerabilities found`                                                                                                                                                                                                                                                                                                                                                                                                   |
| Bundle scan                              | `Browser bundle scan: OK — 362 browser-deliverable files, nothing server-only present.`                                                                                                                                                                                                                                                                                                                                            |
| Contract                                 | Validate API contract: step success. As in §A2, its output is above the readable window. OpenAPI drift: `openapi.json is up to date with the route contract`. Route-manifest drift: step success                                                                                                                                                                                                                                   |
| Browser jobs                             | All seven successful, and collected equals executed in each (table below)                                                                                                                                                                                                                                                                                                                                                          |
| Accessibility sweep                      | **63 / 63**. Since `43173f8`, its holder's-pass case draws a synthetic credential, not a real pass                                                                                                                                                                                                                                                                                                                                 |

The fresh-report table, as the log printed it (timestamps removed):

```text
package                     files   tests  passed  failed skipped  verdict
@desi-event/api                73    1464    1464       0       0  ok
@desi-event/api-contract        8     191     191       0       0  ok
@desi-event/auth                7     356     356       0       0  ok
@desi-event/config              5     103     103       0       0  ok
@desi-event/db                  3     102     102       0       0  ok
@desi-event/inventory           8     291     291       0       0  ok
@desi-event/ledger              1      33      33       0       0  ok
@desi-event/logger              4      66      66       0       0  ok
@desi-event/notifications       2      56      56       0       0  ok
@desi-event/permissions         4     612     612       0       0  ok
@desi-event/pricing             5     116     116       0       0  ok
@desi-event/providers          12     494     494       0       0  ok
@desi-event/schemas            15     734     734       0       0  ok
@desi-event/ui                 12      97      97       0       0  ok
@desi-event/web                49     839     839       0       0  ok
@desi-event/worker             21     306     306       0       0  ok
total                         229    5860    5860       0       0  16 package(s)

Run started 2026-09-23T03:27:55.759Z; 0 report(s) deleted beforehand.
Fresh-report verification: OK — 5860 case(s) ran across 16 fresh report(s); 0 failed, 0 skipped, 0 undeclared.
```

- **5,860 cases, 0 failed, 0 skipped.** The same total as the local run of
  the same command on this tree.
- **0 reports deleted.** That is what a fresh checkout should show: reports
  are git-ignored and none is tracked.
- **16 packages.** That is every `test` task in Turborepo's plan. The run's
  other three tasks are the `build` tasks of api, db and web, which the tests
  depend on.

The browser jobs, from each job's own `Running N tests` line and its summary:

| Configuration                                      | Job            | Collected | Executed       | Time    |
| -------------------------------------------------- | -------------- | --------- | -------------- | ------- |
| public catalogue (`test:e2e`)                      | `107032536473` | 118       | **118 passed** | 1.9 min |
| production build (`test:e2e:prod`)                 | `107032536477` | 19        | **19 passed**  | 7.2 s   |
| event lifecycle (`test:e2e:events`)                | `107032536649` | 20        | **20 passed**  | 55.5 s  |
| organiser venue maps (`test:e2e:organizer`)        | `107032536547` | 13        | **13 passed**  | 21.9 s  |
| refusals (`test:e2e:refusals`)                     | `107032536524` | 4         | **4 passed**   | 21.0 s  |
| accessibility sweep (`test:e2e:sweep`)             | `107032536459` | 63        | **63 passed**  | 1.3 min |
| commerce and operations detail (`test:e2e:detail`) | `107032536443` | 80        | **80 passed**  | 2.3 min |
| **All seven**                                      |                | **317**   | **317**        |         |

- **Per-test lines counted too.** Each job ran on one worker. Its per-test
  lines were counted as well as its summary read: indices 1 to N, each once,
  every one ✓, none with a retry suffix. No job printed a skipped, flaky,
  failed, did-not-run or interrupted line.
- **Detail is 80, not §A2's 79.** The difference is the half-typed slow-page
  case added in `43173f8`. The local run of this tree gave the same seven
  numbers.
- **One server line in the detail job.**
  `[WebServer] ⨯ Error: The destination stream closed early.` It came 0.4 s
  after case 59 passed and before case 60 started. React's server renderer
  prints this when a response's `close` event arrives before a streamed
  render finishes (`react-dom-server`): the client went away mid-stream. The
  line names no request. A browser context closing at the end of case 59
  would produce it, but that is an inference. No case failed or retried, and
  nothing more is claimed from it.

**Correction.** The commit message of `3fe58a7` says the new step makes the
table end the log. The step comment in `ci.yml` says the same. It ends the
job's steps. After it, the runner's post-job cleanup prints the service
containers' logs, about 970 lines here. The table sits well inside the 5,000
lines the connector returns, and that was the step's purpose. The workflow
comment will be corrected with the next code change, not in this
documentation-only commit.

### A12. Phase 3 classification

Run `35814340442` meets every condition the owner set for it (§A11). This
section is the documentation-only closure, committed after that result.

Phase 3 is therefore **COMPLETE — VERIFIED ON REMEDIATION SHA `3fe58a7`**.

As before, that means fourteen separate outcomes. It does not mean the
ticketing product is complete. The closure table above is left as written.
Where the two tables differ, this one stands: the QR scanner is complete in
Chromium simulation only, and the corrections in §A4 and §A5 apply.

| Requirement                        | Classification                                                            | Evidence in this audit                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event-scoped scanner authorisation | **COMPLETE**                                                              | §A5: fourteen scenarios on PostgreSQL, including a SCANNER from a rival organisation                                                                                            |
| Non-mutating admission preview     | **COMPLETE**                                                              | §5 above: the ticket row is byte-identical before and after, on PostgreSQL. §A5: a preview grants nothing                                                                       |
| Final authorisation revalidation   | **COMPLETE**                                                              | §A5: the confirmation locks the ticket and re-reads membership, scope and ticket state. Negatives 2, 3, 4, 7, 10 and 11 confirm with a validly signed reference and are refused |
| Exactly-once check-in              | **COMPLETE**                                                              | §A5: the races on PostgreSQL. Since `2448476`, `pg_blocking_pids` proves the interleaving happened                                                                              |
| Manual admission                   | **COMPLETE**                                                              | §A6: `MANUAL_CODE` follows from what was presented. §A8: a code typed before the page's script arrives is kept                                                                  |
| Attendee secure QR pass            | **COMPLETE**                                                              | §A4: the QR holds the HMAC credential, never the printed code. The credential stays out of URLs, storage, logs, audit rows and test artefacts                                   |
| QR scanner                         | **COMPLETE IN CHROMIUM SIMULATION; EXTERNAL DEVICE VERIFICATION PENDING** | §A4: verified in Chromium, with a canvas stream standing in for the camera. Physical devices and non-Chromium browsers are not verified                                         |
| Organiser check-in UI              | **COMPLETE**                                                              | §A8. In §A11, the sweep and detail jobs (63 and 80 cases)                                                                                                                       |
| Member-email exposure              | **FIXED**                                                                 | §A7. The shape of the mask is an owner recommendation, recorded in §A10 and not yet implemented                                                                                 |
| Notification retry lease           | **FIXED**                                                                 | §A7: every retryable state, on PostgreSQL                                                                                                                                       |
| Reserved-seat transfer             | **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**                                 | Unchanged: ADR 0005, §12                                                                                                                                                        |
| Offline admission                  | **NOT IMPLEMENTED**                                                       | Unchanged                                                                                                                                                                       |
| Group booking                      | **NOT IMPLEMENTED**                                                       | Unchanged                                                                                                                                                                       |
| Real Stripe and Stripe Connect     | **EXTERNAL VERIFICATION PENDING**                                         | `PAYMENT_MODE` resolved to `MOCK`. Kill switch 12 of 12 in §A11                                                                                                                 |

The fresh-report command is not one of the fourteen. It decided whether this
classification could be COMPLETE rather than PARTIAL. It is **IMPLEMENTED**
(§A3).

Phase 4 has not begun. This audit wrote no Phase 4 code, and Phase 4 waits on
the owner's authorisation. `PAYMENT_MODE` stayed `MOCK`. Destructive retention
stayed disabled.

---

## Phase 4 — the product's frontend, UI/UX, navigation and operational surfaces

Authorised on 2026-09-23 after Phase 3 was accepted as **COMPLETE — VERIFIED ON
REMEDIATION SHA** (`3fe58a7fdb0c9c811c51d73f96926029362063f4`, CI
`35814340442`, documentation-only closure `33b906b8d9fa0433738f72495ee15987059db380`).
The goal: finish the frontend, UI/UX, navigation, responsive, accessibility and
operational-surface work across the product, without claiming a backend
capability that does not exist. Nothing in this phase moved, rebased, squashed,
cherry-picked or rewrote the branch's history.

What this phase is not: real Stripe, Stripe Connect or payouts; destructive
retention; group booking; offline admission; reserved-seat transfer. None of
them was built, and every screen that touches one says so in the words of the
limitations register (§P4-17).

Where the brief's twenty-four report items are answered: 1–5 (starting,
masking, implementation, remediation and closure SHAs) §P4-1; 6 design system
§P4-2; 7 navigation §P4-3; 8 pages and components §P4-4; 9 API contract §P4-5;
10 privacy and authorisation §P4-6; 11 responsive §P4-7; 12 accessibility
§P4-8; 13 browser collection and execution §P4-9; 14 fresh-test totals §P4-10;
15 database and reliability §P4-11; 16 coverage §P4-12; 17 dependencies and
bundle §P4-13; 18 exact-SHA CI §P4-14; 19 failures and root causes §P4-15;
20 external verification §P4-16; 21 blocked and not implemented §P4-17;
22 `PAYMENT_MODE` §P4-18; 23 retention §P4-19; 24 screens not built §P4-20.
The requirements-to-evidence matrix is §P4-22 and the twenty-seven
classifications §P4-23.

### P4-1. Commits and SHAs

| Item                     | SHA                                        | Evidence                                                       |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| Starting state           | `33b906b8d9fa0433738f72495ee15987059db380` | Phase 3's documentation-only closure                           |
| Email-masking correction | `bf13cb3b09120065aaf4469768118d4732efb01b` | CI `35819310106`: 8 of 8 jobs `success`                        |
| Implementation           | `f1f12cfd668e06e877df6a37f4a45e4b2566c28f` | CI `35878840028`: 7 `success`, 1 `failure`, preserved (§P4-15) |
| Remediation              | `43a5fd47d9e92aa16b4e69fe5b133006b1754192` | CI `35885247288`: 8 of 8 jobs `success` (§P4-14)               |
| Documentation closure    | the commit that adds this section          | documentation only; no code, test or config                    |

The masking correction came first, on its own, as the brief required, and its
CI run was green before any other Phase 4 work was pushed. Its eight jobs, read
from the run on 2026-09-23: Policy, lint, contract, tests, build; Browser —
public catalogue; production build; organiser venue maps; event lifecycle;
refusals; accessibility sweep; commerce and operations detail. Each
`completed / success` on head `bf13cb3`.

The implementation, in the order committed:

| Commit    | Subject                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `bf13cb3` | fix(privacy): show no part of an address to anybody not entitled to it                                                      |
| `2b91ae9` | feat(design): one semantic token vocabulary, two registers, and nothing literal                                             |
| `e025564` | feat(navigation): three navigation layers from auth.me, one admission rule per area, and a way to sign out                  |
| `7620031` | feat(states): one refusal vocabulary, and a way forward from every refused read                                             |
| `3669ad8` | fix(sales): an event whose sales are open can be bought, listed and counted                                                 |
| `198b714` | fix(pricing): quote the price checkout charges, on the card, the event page and the organiser's preview                     |
| `f6fba2d` | feat(checkout): finish a purchase with the simulated payment, and stop calling seated tiers sold out                        |
| `36fc625` | fix(claims): say only what this build does, let people make an account, and name what it cannot do                          |
| `b3cb5e2` | fix(queues): put the refunds, reconciliation items and messages somebody has to act on first                                |
| `23ea791` | feat(account): orders, transfers, security and privacy pages for the person who bought the ticket                           |
| `85529d3` | feat(directories): categories, venues and organisers, each a way back into the listing                                      |
| `ccca7a3` | feat(workspace): team, refund, reconciliation and outbox lists, reachable from the rail and the board                       |
| `8c405e8` | feat(a11y): only the door interrupts, nothing moves for longer than 250 ms, and the site can be installed                   |
| `1f07d59` | test(e2e): a platform reader and a signed-out window for the detail suites, and a scanner-clean TOTP fixture                |
| `5d11baf` | test(e2e): wait for a page to arrive, not for it to load, now that the areas stream                                         |
| `30a46a5` | style: format the account-security and venue/organiser page files                                                           |
| `5ba42cc` | fix(bundle-scan): require the paths a buyer's browser must carry, not the route table it no longer ships                    |
| `d549b25` | fix(load): renew the operator's step-up before each scenario, so the tenth one measures refunds rather than a lapsed window |
| `b5b2a5f` | fix(auth,wallet): keep the bearer secret out of page JavaScript, and stop counting a used ticket as one that admits         |
| `c8d4aaa` | fix(copy): say what the build does — simulated payments, no fixed hold length, a settled refund moved no money              |
| `c433cb6` | fix(seed,footer): give demo venues slugs and list only cities the catalogue has                                             |
| `bf24498` | fix(api): give each API process its own simulated-payment id space, so a restart cannot break checkout                      |
| `148cbec` | fix(sitemap): ask for a page size the API accepts, so the sitemap lists events again                                        |
| `b1d0800` | test(e2e): API-backed journeys for the Phase 4 surfaces, and a sweep of every new page at every width                       |
| `08946c2` | test(a11y): scan against WCAG 2.2's rules as well as 2.0's and 2.1's                                                        |
| `a2773eb` | fix(operations): stop the notification queue's failure filter widening the page at 320 px                                   |
| `f1f12cf` | test(e2e): name the checkout buyer's password the way the scanner recognises a test value                                   |
| `43a5fd4` | test(e2e): wait for the resubmission to be answered before the moderator looks                                              |

Twenty-eight commits: the masking correction, twenty-five of implementation and fixes up to `f1f12cf`, and the remediation `43a5fd4`. None was amended, rebased or squashed.

### P4-2. Design system

One semantic token vocabulary in `packages/config/src/tailwind.css`, two
registers. Public pages are drawn in **Editorial Marigold**; signed-in areas in
**Quiet Courtyard**, which redefines nine tokens under
`[data-register='courtyard']`. Tailwind 4 compiles every utility to
`var(--color-…)`, so a component asks for a token by what it is for (page,
raised and subtle surfaces, the inverse band, three text levels, lines, focus,
primary/secondary/danger actions, eight statuses, ticket availability, four seat
states, the operations rail) and never asks which register it is in. The
register is chosen per request from the path (`lib/register.js`) and set on
`<body>`; `proxy.js` copies the path onto the request and always overwrites any
value a browser sent. It decides nothing about access.

Availability has three tokens — open, limited, closed — and no "selling fast":
no data could honestly drive one.

- **Migration.** 1,292 literal classes in 72 web files, and every primitive in
  `packages/ui`, moved onto tokens by a codemod whose diff was checked to
  change nothing but class names (915 lines out, 915 in).
- **Defects the literals hid.** The focus ring on most controls was 2.29:1 on
  white, under WCAG 1.4.11's 3:1; the global outline 2.89:1 on the warm page;
  `text-marigold-700` links 4.45:1; an `indigo-night-800` hover named a colour
  the theme never declared. One focus token now clears 3:1 on every ground.
- **Checks.** `token-contrast.test.js` reads both registers separately (the old
  parser let the last declaration win) and pins 169 pairings: text 4.5:1,
  focus and control boundaries 3:1, resting and hovered. A deliberately broken
  courtyard value fails six of them and nothing else.
  `semantic-classes.test.js` refuses a literal palette class, a hex or an
  `oklch()` in any component, with documented exceptions (camera letterbox,
  the QR code's black on white, `global-error.jsx`, the chrome colour, poster
  artwork, the manifest and icon — each held to a token's exact value).
- **Components.** `Alert` draws a status glyph beside a status-coloured title;
  `StatusIcon` gives every tone its own shape, so no two statuses differ by
  colour alone. `secondary` is now the outlined action.
- **Motion.** 120, 180 and 250 ms (`DURATION` in `motion.jsx`, held to the CSS
  tokens by a test). The 450 and 500 ms entrances and the unbounded card spring
  are gone. Reduced motion renders the final state with no movement. No
  confetti, no animated QR, no parallax, no pulsing urgency.

### P4-3. Navigation

Three layers, each derived from `GET /v1/auth/me` and nothing else.
Navigation visibility is not authorisation, and the modules say so; every
destination stays guarded by the API.

| Layer      | What it offers                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public     | Discover events, Categories, Venues, Organisers; one account control. Signed out, "Sign in" carrying the current path as `next`. Signed in, a disclosure (not an ARIA menu) with Overview, My tickets, Accept a ticket, Workspace when there is one, Sign out. The display name, never the address. |
| Attendee   | Overview, My tickets, Orders, Transfers, Security, Privacy; sign out in the rail.                                                                                                                                                                                                                   |
| Operations | A rail grouped as Events and venues, Money, and Trust and safety; Team offered from a membership holding `organization:view_members`; Notifications only on `reconciliation:manage`; Finance and Operations tabs for their lists.                                                                   |

The rail must not offer a door its own layout will then refuse, so
`lib/areas.js` holds each area's admission predicate and refusal text, and both
the layouts (through `lib/area-gate.js`) and the rail ask it. Check-in is
offered only from a membership holding `ticket:check_in`, because the API
refuses a platform role at the door.

- **Open redirect closed.** The old `safeNext` accepted `/\evil.example`, which
  browsers read as `//evil.example`. `lib/next-path.js` resolves against a
  placeholder origin and accepts only a same-origin path with no control
  characters or backslashes, and never `/sign-in` itself (29 cases).
- **Landing and signing out.** Default landing after sign-in is `/account`, not
  the organiser's event list. Sign out exists (it did not, anywhere), including
  "everywhere"; a 401 counts as done, any other failure says the person is
  still signed in.
- **Reachability.** Every legitimate page is reachable without typing its URL:
  the header, the rails, the tabs, the operations board's per-queue links, and
  detail pages' breadcrumbs back to their lists. A detail page (an order, a
  refund, a message) is reached from its list rather than from the rail, and
  `/tickets/accept` from the account control; §P4-20 says why that last one is
  of little use in this build.

### P4-4. Page and component inventory

49 pages, 17 of them new in this phase.

| Area       | Pages (new in bold)                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public     | `/`, `/events`, `/events/[slug]`, `/events/[slug]/checkout`, **`/categories`**, **`/venues`**, `/venues/[slug]`, **`/organizers`**, `/organizers/[slug]`, **`/limitations`**, **`/register`**, `/sign-in`                                                                                        |
| Attendee   | **`/account`**, **`/account/orders`**, **`/account/orders/[reference]`**, **`/account/transfers`**, **`/account/security`**, **`/account/privacy`**, `/tickets`, `/tickets/[id]`, `/tickets/accept`                                                                                              |
| Organiser  | **`/organizer`**, `/organizer/events`, `/organizer/events/new`, `/organizer/events/[id]`, `/organizer/check-in`, **`/organizer/team`**, `/organizer/venues`, `/organizer/venues/new`, `/organizer/venues/[id]/edit`, `/organizer/venues/[id]/maps`, `/organizer/map-versions/[id]`, `/analytics` |
| Money      | `/finance`, `/finance/connect`, **`/finance/refunds`**, `/finance/refunds/[id]`                                                                                                                                                                                                                  |
| Operations | `/operations`, **`/operations/notifications`**, **`/operations/notifications/[id]`**, **`/operations/reconciliation`**, `/operations/reconciliation/[id]`                                                                                                                                        |
| Trust      | `/moderation/events`, `/moderation/events/[id]`, `/privacy`, `/privacy/exports`, `/privacy/holds`, `/privacy/requests/[requestId]`, `/retention`                                                                                                                                                 |

Shared pieces added or reworked: `lib/refusal.js` and
`components/read-refusal.jsx` (eleven refusal states, §P4-6), `loading.jsx` for
the nine signed-in areas, `components/payment-mode-notice.jsx`,
`components/checkout-basket.jsx` (reserve → simulated pay → booked),
`components/site-footer.jsx`, `lib/wallet.js` (one copy of the ticket-status
words), `lib/directory.js`, `lib/area-tabs.js`, `lib/account-api.js`,
`lib/workspace-api.js`, `app/manifest.js` and `app/icon.svg`.

Every page names itself in its `<title>`, and a test walks them. Pages about a
ticket, an order or a transfer use a fixed word — "Ticket", "Order", "Accept a
ticket" — so no reference or code reaches history, bookmarks or a tab strip.

### P4-5. API and contract changes

No migration. One new route was not needed and none was added; every screen
calls a route that already existed. The contract validates (134 routes), and
the OpenAPI and route-manifest artefacts were regenerated where the contract's
descriptions changed.

| Change                                                  | Why                                                                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOKABLE_STATUSES` (ON_SALE, PUBLISHED)                | Holds, seat holds and orders compared the status with the literal `'PUBLISHED'`; pressing "Open sales" made an event unbuyable and removed it from discovery. Facets now count the listed statuses (`LISTED`). |
| Event detail `feeTerms`                                 | The event page and checkout priced with package defaults (2.5% + ₹5.00) while orders charged the deployment's terms (5.9% + ₹0.99). Public, because the booking fee is part of the price.                      |
| Summary `minTotalCents`, `salesOpen`                    | Cards quoted a face value as "From"; now the all-in price of one ticket of the cheapest tier, computed as `orders.create` computes it, and availability in words.                                              |
| Tier `reserved`                                         | A seated tier's quantity is zero by design and every surface called it sold out. It now says which tiers are seated; the site has no seat picker and says so.                                                  |
| Ranked queue reads (`readRankedPage`)                   | PostgreSQL sorts enums by declaration order, which put open refunds, escalated reconciliation items and dead letters behind the settled history. Open work is read first, with exact pagination across tiers.  |
| Team `emailVisibility` FULL / STEP_UP_REQUIRED / HIDDEN | The masking correction (commit `bf13cb3`).                                                                                                                                                                     |
| Wallet `admits`                                         | False for a checked-in ticket, which carries no refusal sentence and was being filed under "Coming up".                                                                                                        |
| Orders list presenter call                              | Mapped through a wrapper, so the array index is not passed as the presenter's options.                                                                                                                         |
| API process provider id space                           | A restarted API reused `pi_000001` and refused its first simulated checkout on the unique provider reference (§P4-15).                                                                                         |

The same-origin proxy now drops the top-level `token` from JSON answers on the
auth routes (§P4-6).

### P4-6. Privacy and authorisation effects

- **Email.** No part of an address reaches anybody not entitled to it: the
  team list's three server-decided shapes, `••••@domain` to a transfer's
  parties, `Hidden email` to an organiser, no recipient in any form in the
  outbox, no buyer address in an organisation's order read, no address in
  transfer audit rows, payment metadata or log lines (commit `bf13cb3`, twenty
  mutations each failing its test).
- **Bearer secret.** Sign-in, second-factor and registration answers carried
  the session's bearer secret in the JSON body, the same secret the HttpOnly
  cookie carries, and the proxy passed it to page JavaScript. It is now removed
  at the proxy; six tests.
- **Refusals.** `lib/refusal.js` reads a refusal from its status, code and
  `Retry-After`, never its wording, into one of eleven states (network,
  auth-required, mfa-enrolment, step-up, permission-denied, not-found, stale,
  expired, validation, rate-limited, server-error). A 403 and a 404 read
  identically where the API makes them identical; no sentence names an
  endpoint, address or phone number (tested). A lapsed step-up is offered in
  place rather than called "Not for you".
- **Live regions.** Only the door interrupts: `Alert` is polite unless marked
  `urgent`, and `urgent` is used only for the door's outcomes. A source check
  fails on any `role="alert"` or `aria-live="assertive"` elsewhere.
- **URLs and storage.** No credential, reference or code in a URL, query, page
  title, local or session storage, IndexedDB or service-worker cache: there is
  no service worker, deliberately, because a cache would hold ticket passes.
  The sign-in and change-password forms declare `method="post"`, so a submit
  before the script arrives cannot put a password in a URL.
- **Scoping.** "Your events" asked the public listing and showed every
  organisation's events as the organiser's own; it now asks per organisation
  the caller can see drafts in. Refund and reconciliation lists are scoped to
  the caller's organisation unless they hold `reconciliation:manage`, and show
  no provider reference or internal id.
- **Not exposed anywhere:** admission credentials, provider or connected-account
  ids, worker leases, queue internals, raw webhook payloads, raw audit streams,
  export storage references, secrets or recovery material. The bundle scan
  requires none of them and forbids the known markers (§P4-13).

### P4-7. Responsive evidence

All in Chromium, through Playwright, against the real API and database.

- **Every Phase 4 surface at every size.** The sweep's Phase 4 block opens
  sixteen surfaces — the three directories, the limitations, registration and
  sign-in pages, checkout signed out, order history and an order, transfers,
  account security and privacy, the team screen, and the refund,
  reconciliation and notification lists — at 320, 375, 390, 768, 1024, 1280
  and 1440 px and at 200% zoom. 200% zoom is taken as the window the layout
  actually has: a 1280 × 900 window at 200% lays out at 640 × 450 CSS pixels,
  so that is the viewport, not a 1280-wide one with a CSS transform. At each
  size the document may not scroll sideways and the surface's own landmark
  content must be visible.
- **The header at 320.** The four ways into the catalogue are reached, opened
  and walked by keyboard alone at 320 px.
- **Earlier surfaces.** The Phase 1–3 cases still run: every Phase 2 screen at
  phone, tablet and desktop; the door screen at the seven door widths, idle and
  with a long name; the event editor and the new detail screens at 200% zoom.

Physical phones were not used. Nothing here stands for one.

### P4-8. Accessibility evidence

- **Automated scan.** axe-core 4.13 with the WCAG 2.0, 2.1 and 2.2 A and AA
  tags. The 2.2 tags were added in this phase; in axe 4.13 they add one rule,
  `target-size` (2.5.8), to every scan. Phase 4 surfaces are scanned at four
  of their eight sizes (320, 768, 1280 and the zoomed window), each with zero
  violations; every earlier surface keeps its own scans.
- **What a scan cannot see**, asserted directly: keyboard-only operation of the
  header, the event editor and a reconciliation item; a visible focus indicator
  on every focusable control; touch targets of at least 24 × 24 CSS pixels on
  the payout-setup screen at 320 px; nothing hidden or left mid-animation with motion
  reduced; an invitation code never placed in the address bar; the refund
  screen never asking for a card.
- **Live regions.** Polite everywhere except the door's four urgent outcomes,
  enforced on the source (§P4-6).
- **Contrast.** 169 token pairings in both registers (§P4-2).
- **Titles and headings.** Every page has a title of its own
  (`page-titles.test.js`); the public pages each have exactly one `<h1>`
  (`accessibility.spec.js`), and every page the detail suites open is waited
  for by the `<h1>` inside its `<main>`.

**Not done:** a manual audit with a screen reader, voice control or switch
access. The classification says "verified by automated checks" for that
reason and no more.

Sweep on this tree: 81 collected, 81 passed, none skipped.

### P4-9. Browser collection and execution

Every configuration run on the remediation SHA `43a5fd4`, each on a freshly
created and migrated database with CI's environment, as the CI browser job
runs them. The same seven gave the same counts on the implementation SHA
`f1f12cf` before it. Collected is Playwright's `--list` total; the rest is its JSON
reporter's statistics for the run.

| Configuration (CI job)                    | Collected | Passed  | Failed | Flaky | Skipped |
| ----------------------------------------- | --------- | ------- | ------ | ----- | ------- |
| `playwright.config.js` (public catalogue) | 118       | 118     | 0      | 0     | 0       |
| `playwright.production.config.js`         | 19        | 19      | 0      | 0     | 0       |
| `playwright.organizer.config.js`          | 13        | 13      | 0      | 0     | 0       |
| `playwright.events.config.js`             | 20        | 20      | 0      | 0     | 0       |
| `playwright.refusals.config.js`           | 4         | 4       | 0      | 0     | 0       |
| `playwright.sweep.config.js`              | 81        | 81      | 0      | 0     | 0       |
| `playwright.detail.config.js`             | 132       | 132     | 0      | 0     | 0       |
| **Total**                                 | **387**   | **387** | **0**  | **0** | **0**   |

At the masking commit the same seven collected 317. The 70 added: 52 in the
four new detail suites (account 14, checkout 9, directories 10, workspace 19)
and 18 in the sweep's Phase 4 block. Every new case is collected by a CI job:
the detail suites by `test:e2e:detail` (`**/detail-*.spec.js`), the sweep's by
`test:e2e:sweep`. No configuration collects zero, and none collected a case
it did not run.

### P4-10. Fresh-test totals

`pnpm run verify:tests:fresh`, inside `pnpm verify`, on `43a5fd4` (identical
table on `f1f12cf`): every
earlier report deleted first, every test task run with Turborepo's cache
refused, each report proved to be this run's.

| Package                     | Files   | Cases     | Passed    | Failed | Skipped |
| --------------------------- | ------- | --------- | --------- | ------ | ------- |
| `@desi-event/api`           | 78      | 1,529     | 1,529     | 0      | 0       |
| `@desi-event/api-contract`  | 8       | 191       | 191       | 0      | 0       |
| `@desi-event/auth`          | 7       | 357       | 357       | 0      | 0       |
| `@desi-event/config`        | 6       | 255       | 255       | 0      | 0       |
| `@desi-event/db`            | 3       | 103       | 103       | 0      | 0       |
| `@desi-event/inventory`     | 8       | 291       | 291       | 0      | 0       |
| `@desi-event/ledger`        | 1       | 33        | 33        | 0      | 0       |
| `@desi-event/logger`        | 4       | 67        | 67        | 0      | 0       |
| `@desi-event/notifications` | 2       | 56        | 56        | 0      | 0       |
| `@desi-event/permissions`   | 4       | 612       | 612       | 0      | 0       |
| `@desi-event/pricing`       | 5       | 116       | 116       | 0      | 0       |
| `@desi-event/providers`     | 12      | 494       | 494       | 0      | 0       |
| `@desi-event/schemas`       | 16      | 779       | 779       | 0      | 0       |
| `@desi-event/ui`            | 13      | 108       | 108       | 0      | 0       |
| `@desi-event/web`           | 95      | 1,514     | 1,514     | 0      | 0       |
| `@desi-event/worker`        | 21      | 306       | 306       | 0      | 0       |
| **Total**                   | **283** | **6,811** | **6,811** | **0**  | **0**   |

"6811 case(s) ran across 16 fresh report(s); 0 failed, 0 skipped, 0
undeclared." The skipped-test check over the same sixteen reports: 0 skipped,
0 allow-listed, 0 undeclared. At the masking commit: 233 files, 5,942 cases.

### P4-11. Database and reliability

All on `43a5fd4`, each also passing on `f1f12cf`.

- **Fresh database** (`db:verify:fresh`): 99 of 99 checks — a disposable
  database created, every migration applied from nothing, and the API's
  twelve database suites run against it (193 cases), plus the db package's 103. The new `ranked-page-integration.test.js` is not among the twelve; it
  runs in the API suite under `verify:tests:fresh`, with `REQUIRE_DATABASE=1`,
  against the migrated test database, locally and in CI.
- **Upgrade** (`db:verify:upgrade`): 26 of 26 — a populated database at the
  previous schema, upgraded in place.
- **No migration** was added in this phase; `prisma/` is unchanged.
- **Reliability**, CI's smoke step (ramp profile): GA hold, seat hold and
  check-in contention, 3 of 3, each checking its invariants in the database
  afterwards.
- **Reliability**, every scenario (steady profile): 11 of 11 — public
  browsing, public search, hot-event inventory reads, GA hold contention,
  reserved-seat hold contention, checkout creation, duplicate webhooks,
  check-in concurrency, notification throughput, refund contention and
  reconciliation processing; 46,793 calls on `43a5fd4` (42,662 on
  `f1f12cf`; the count is whatever each ten-second window completes). The first full run of this phase
  failed refund contention on a lapsed step-up in the harness itself; §P4-15.

### P4-12. Coverage

`pnpm run test:coverage` on `43a5fd4`, figure for figure the same as on
`f1f12cf`: 18 of 18 tasks. The two cached were
the API and web builds, reused from the verify step in the same run, exactly
as in CI; every coverage task ran.

Thresholds are unchanged. They live in two files, neither touched since
`33b906b`: `packages/config/src/vitest-node.js` (80% lines, functions and
statements, 75% branches, for the twelve packages using it) and
`vitest-react.js` (no threshold, for web and ui). `db` sets none, by its own
recorded reasoning.

| Package         | Statements | Branches | Functions | Lines | Gated |
| --------------- | ---------- | -------- | --------- | ----- | ----- |
| `api`           | 88.51      | 77.88    | 93.48     | 91.02 | yes   |
| `api-contract`  | 94.29      | 90.00    | 100       | 95.11 | yes   |
| `auth`          | 99.65      | 95.61    | 100       | 99.60 | yes   |
| `inventory`     | 91.96      | 84.79    | 89.79     | 92.23 | yes   |
| `ledger`        | 100        | 91.17    | 100       | 100   | yes   |
| `logger`        | 100        | 100      | 100       | 100   | yes   |
| `notifications` | 100        | 100      | 100       | 100   | yes   |
| `permissions`   | 95.85      | 91.27    | 96.66     | 97.03 | yes   |
| `pricing`       | 93.97      | 90.17    | 92.30     | 94.17 | yes   |
| `providers`     | 98.03      | 94.19    | 97.76     | 98.28 | yes   |
| `schemas`       | 96.48      | 82.30    | 87.65     | 96.65 | yes   |
| `worker`        | 95.86      | 83.72    | 97.85     | 97.40 | yes   |
| `ui`            | 97.61      | 94.02    | 100       | 99.43 | no    |
| `web`           | 69.06      | 62.93    | 61.19     | 69.41 | no    |
| `db`            | 0          | 0        | 0         | 0     | no    |

The narrowest margin is the API's branches, 2.88 points above 75%. The web
app's coverage is ungated, as it was before this phase; it is recorded here
rather than described as meeting a threshold it does not have.

### P4-13. Dependencies and bundle

**Dependencies.** One change: `@desi-event/permissions` became a
devDependency of the web app, so the navigation tests check the real
role-to-capability tables rather than a copy. It is a workspace package and
ships nothing new to a browser. pnpm 10.33.0 regenerated the lockfile and
dropped an optional `@babel/core` peer suffix from the `next` and `styled-jsx`
entries. No third-party package was added, removed or upgraded.
`pnpm audit --audit-level moderate`: no known vulnerabilities.

**Browser bundle.** Both measured as production builds with CI's public
environment, summing every `.js` file under `.next/static`:

| Tree                   | JS files | Bytes     |
| ---------------------- | -------- | --------- |
| `33b906b` (start)      | 36       | 1,685,404 |
| `43a5fd4` (this phase) | 42       | 1,688,347 |

+2,943 bytes for seventeen new pages, a working checkout and three navigation
layers. Near-flat because the checkout basket stopped importing the contract
client, which had pulled the whole generated route table — every path the
API serves — into the browser; the basket now posts through the same-origin
proxy. The bundle scan read 533 browser-deliverable files on this tree (362
at the masking commit) and found nothing server-only; its required list now
names the checkout's hold and order paths and account creation (commit
`5ba42cc`).

### P4-14. Exact-SHA CI

Two exact-SHA runs, both dispatched on `claude/phase4-frontend-ui-ux-completion`
with `workflow_dispatch` and read back from the Actions API on 2026-09-23.

| Job                                      | Run `35878840028` on `f1f12cf` | Run `35885247288` on `43a5fd4` |
| ---------------------------------------- | ------------------------------ | ------------------------------ |
| Policy, lint, contract, tests, build     | success                        | success                        |
| Browser — public catalogue               | success                        | success                        |
| Browser — production build               | success                        | success                        |
| Browser — organiser venue maps           | success                        | success                        |
| Browser — event lifecycle                | **failure** (§P4-15)           | success                        |
| Browser — refusals                       | success                        | success                        |
| Browser — accessibility sweep            | success                        | success                        |
| Browser — commerce and operations detail | success                        | success                        |

Run `35878840028` is left as it failed: it was not re-run, and its failure is
root-caused in §P4-15. Run `35885247288`, on the remediation SHA that differs
from `f1f12cf` by the one test fix, has all eight jobs `completed / success`,
every step of the verify job included (fresh reports, coverage thresholds,
fresh and upgrade databases, build, OpenAPI and route-manifest drift, bundle
scan, dependency audit, the production-payments kill switch and the
reliability smoke test).

### P4-15. Failures found, and their root causes

Every failure the gate and the suites raised in this phase, in the order
found, with its cause. Each was fixed on a new commit; none was re-run in the
hope of a different answer, and no assertion, threshold or timeout was
loosened to pass.

**Product defects the tests found.**

1. **The simulated checkout broke after any API restart.** The in-memory
   provider numbered intents from `pi_000001` in every process, and the
   database, which outlives the process, holds `Payment(provider,
providerRef)` unique. The second run of the purchase journey against one
   database got a 500 on "Pay". Fixed in `bf24498`: a random id space per
   process, with a test showing the old wiring's repeat.
2. **The sitemap listed no events at all.** It asked for 200 events a page;
   the listing caps at 100 and answers more with a 400, which the sitemap
   swallowed. This dates from `a8baf43` (2026-09-14), before this phase. Its
   unit test's stub accepted any page size. Fixed in `148cbec`; the stub now
   parses queries with the API's own schema, and eight of fourteen cases fail
   with the old value.
3. **The notification queue scrolled sideways at 320 px** by 54 px: a
   `<select>` is as wide as its longest option. Found by the sweep's new
   Phase 4 block (seven widths and 200% zoom per surface). Fixed in `a2773eb`.
4. **Six defects found while writing the new suites, before their first
   run**: the sign-in answer's bearer secret reaching page JavaScript, a used
   ticket counted as one that admits, the order list passing an array index
   to its presenter (`b5b2a5f`); the payment notice's "production payments
   disabled" and "marked DEMO", a promised ten-minute hold, a settled refund
   not saying no money moved, a raw UTC time beside a zone name, a
   change-password form without `method="post"` (`c8d4aaa`); demo venues
   without slugs and a footer city with no venues (`c433cb6`).

**Harness and test-design failures.**

5. **Reliability, refund contention, 100% refused** on the first full run:
   the operator's five-minute FINANCE_ACTION step-up lapsed before the tenth
   scenario. The harness now renews it before each scenario (`d549b25`). CI
   runs three scenarios and never reached it.
6. **Three detail cases read "Loading…"**: the signed-in areas gained
   streaming boundaries, and React reveals the page after the `load` event.
   The fixtures now wait for the page's `<h1>` (`5d11baf`).
7. **The new directory suites failed against the local test database**,
   which holds 20,285 events (3,067 upcoming and listed) left by the API and
   concurrency suites: walking Live Music reached page 320 and timed out, and
   the organiser directory, which reads the first 500 upcoming events and
   says so, did not reach this run's organisation. CI's browser jobs each
   start from a freshly migrated database; the local runs were moved to the
   same, and the organiser cases now assert the directory read the whole
   listing first, so the precondition fails by name.
8. **Bundle scan: two required strings absent**, `/v1/organizers` and the
   finance export path. Both had been present only because the checkout
   basket shipped the whole route table; requiring them would require it
   back. The list now names what the browser must carry (`5ba42cc`).
9. **Secret scan**: the checkout spec's buyer password did not announce
   itself as a test value. Renamed to the seeds' convention (`f1f12cf`).
10. **Format check**: eight files not run through Prettier (`30a46a5`).

**Evidence runs that were superseded, and why.** The first detail run of the
new suites was stopped at 63 of 132 once items 1 and 7 were understood, and
the first six-configuration run was stopped in its sweep when the WCAG 2.2
tags were added, so that no reported run mixes two versions of a file. The
first gate attempt stopped at the secret scan (item 9). The last complete
local run, on `f1f12cf`, is the one reported above.

**The failed CI run, preserved.** Run `35878840028` on the implementation
SHA `f1f12cf`: seven jobs `success`, **Browser — event lifecycle `failure`**
(13 passed, journey 14 failed, 6 not run in serial mode). It was not re-run.

- _What failed._ Journey 14 waited 90 s for the moderator's **Approve** button,
  which never appeared.
- _Root cause, from the job log._ The moderator's page request completed at
  15:09:27.180 after 263 ms, so it began at about 26.917; the organiser's
  `POST submit-review` began at about 26.902 and completed at 27.042. The
  moderator's page read the event before the resubmission committed, still in
  CHANGES_REQUIRED, which offers no Approve. The test meant to wait for the
  resubmission and did not: it waited for any "waiting for review" on the
  organiser's screen, and the panel's history has read "Draft → Waiting for
  review" since journey 11's first submission, so the assertion passed before
  the second was sent. The history labels date from `1b5e9b9` (2026-09-15);
  this phase changed only the heading's colour token. The race is older than
  Phase 4, and earlier runs passed while the POST happened to commit first.
- _Reproduced before fixing._ The `submit-review` response was held back
  1.5 s by a temporary route in the spec: the old wait failed exactly as CI
  did (13 passed, journey 14 waiting for Approve, 6 not run).
- _Fix_ (`43a5fd4`, the remediation SHA). Journey 14 now waits for the
  panel's announcement, "Waiting for review. A moderator has it…", which the
  panel sets only after the server answers — the same wait journey 11 already
  used. With the same 1.5 s delay it passed 20 of 20; the delay is not in the
  commit. Journeys 16–18 wait on sentences the history never carries and
  were checked, not changed.

### P4-16. External verification pending

| Item                           | Status                                   |
| ------------------------------ | ---------------------------------------- |
| Physical-device QR             | **EXTERNAL DEVICE VERIFICATION PENDING** |
| Non-Chromium camera scanning   | **EXTERNAL DEVICE VERIFICATION PENDING** |
| Real Stripe and Stripe Connect | **EXTERNAL VERIFICATION PENDING**        |

Every QR and camera result in this report is Chromium simulation. None of it is
represented as a physical device, a phone camera, Safari or Firefox.

### P4-17. Blocked and not implemented

| Capability             | Status                                    | What the site does instead                                                                                              |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Reserved-seat transfer | **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT** | The transfer screen refuses a seated ticket and links the limitations page.                                             |
| Group booking          | **NOT IMPLEMENTED**                       | No screen offers it.                                                                                                    |
| Offline admission      | **NOT IMPLEMENTED**                       | Offline, the door screen says nobody can be admitted until the device is back online; no service worker, no local list. |
| Email delivery         | **NOT IMPLEMENTED**                       | Offering a ticket says the invitation is recorded and nothing has been sent; team invitations are not offered.          |
| SMS delivery           | **NOT IMPLEMENTED**                       | No screen offers it.                                                                                                    |
| Destructive retention  | **DISABLED**                              | The retention screen rehearses (DRY_RUN) and says nothing was deleted.                                                  |

`/limitations` lists each of these, and the three in §P4-16, word for word,
with what each means for the person using the site and no promise of when it
might change. The footer links it. Nothing in the site says "coming soon".

### P4-18. PAYMENT_MODE

`PAYMENT_MODE` is **MOCK**. It is unset in `.env.example` (which says "Leave
unset for mock") and in CI, and unset resolves to MOCK, which the provider
tests pin; no environment this phase ran set it to anything else. The kill switch is unchanged and its suite passed
(12 of 12, `tests/payment-kill-switch.test.js`). Checkout completes a purchase against the in-memory provider:
no card is asked for, no money moves, and the button, the held notice, the
confirmation, the order page and a settled refund each say so. No provider
credential was added.

### P4-19. Destructive retention

Disabled. The retention worker runs DRY_RUN only; no code path in this phase
touches it, and the retention screen says nothing was deleted.

### P4-20. Screens intentionally not built

- A seat picker. Seated tiers show "Seated — not sold on this site".
- Guest checkout. Buying needs an account: tickets live in it, the build sends
  no email, and no route lets a guest claim a purchase later.
- Inviting a team member. The API can record an invitation; nothing delivers it.
- Password reset and address confirmation. Neither exists in the API; the
  registration page says so before an account is made.
- Self-service data export and account deletion for an attendee. The account
  privacy page names both as missing: there is no self-service export, and
  deletion is redaction carried out by an organisation's privacy team, which
  the person asks for through the organiser; the site cannot pass the request
  on.
- Organisation self-service sign-up.
- An offline door, a group booking flow, an SMS channel, reserved-seat transfer
  (§P4-17).
- **`/tickets/accept` is reachable but not useful in practice**: it needs the
  code from an invitation, and this build delivers none. The page and the
  transfer screens say so; the route is kept because the API flow behind it is
  real.

### P4-21. Findings recorded, not fixed

Found during this phase, judged outside its scope or not safely fixable in
it, and left as they are. None is hidden behind a passing test.

| Finding                                                                                                  | Effect                                                                                                                               | Why not fixed here                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| The organiser directory reads at most 500 upcoming events                                                | On a larger catalogue it lists organisers from the first 500 only                                                                    | It says so on the page; a complete directory needs an organiser listing route the API does not have               |
| A simulated capture made by an earlier API process cannot be refunded by a later one                     | The in-memory provider's intents do not survive a restart; the provider answers `INTENT_NOT_FOUND` and the refund is recorded FAILED | Inherent to an in-memory stand-in; a real provider keeps its records                                              |
| `orders.create` is described as answering PENDING; in MOCK it answers PAID                               | A reader of the contract could expect a second step that MOCK never needs                                                            | A contract wording change across payment modes; recorded for the payments owner                                   |
| `ticket-tiers` docstring says holds are subtracted; the event page counts `quantityTotal − quantitySold` | The page may show a few more "left" than can be held at that instant                                                                 | The number is not shown as a count to buyers (availability is in words), so nothing false is displayed            |
| The sitemap lists an organisation-owned venue's page                                                     | Such a page resolves for anybody with the link, by design, but is now also advertised                                                | Deciding whether owned venues are public is a product decision                                                    |
| The reconciliation detail crumb returns to the unscoped list                                             | A scoped reader lands on a list the API scopes for them anyway                                                                       | Cosmetic; the API decides what the list holds                                                                     |
| Detail specs seed some rows for the beta organisation themselves                                         | A spec's world is not wholly built by global setup                                                                                   | Each spec cleans up what it writes; moving them is test refactoring                                               |
| Existing detail specs rely on the 15-minute FINANCE_VIEW window                                          | A very slow run could see a lapsed step-up                                                                                           | Measured runs finish well inside it; the load harness, which does run long, renews its step-up (commit `d549b25`) |
| Accepting a transfer depends on an invitation nobody delivers                                            | `/tickets/accept` works but nobody receives a code                                                                                   | Email is NOT IMPLEMENTED (§P4-17)                                                                                 |
| No route sets `Organization.suspendedAt`                                                                 | A suspended organisation would still be listed                                                                                       | No suspension flow exists to honour                                                                               |
| Registration answers 409 for an address that already has an account                                      | Whether an address is registered can be learnt                                                                                       | The API's existing behaviour; changing it needs a decision about sign-in help                                     |
| `Invitation.email` survives a person's erasure                                                           | An invitation row can keep an address                                                                                                | Retention and redaction policy for invitations is the privacy owner's                                             |
| The ticket page shows the human-readable code twice                                                      | Redundant, not a credential (the admission credential is the pass)                                                                   | Cosmetic                                                                                                          |
| The primary navigation sheet uses `h2` group headings                                                    | Intentional and tested; listed because an audit might query it                                                                       | Not a defect                                                                                                      |

### P4-22. Requirements to evidence

A page rendering is not evidence that a feature works. Each row names what
proves it.

| Requirement                                                 | What proves it (not merely that a page renders)                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No part of an address to anybody not entitled               | `apps/api/tests/team-email-integration.test.js` (15 cases on PostgreSQL through the real app, each searching the whole body for every address, local part and `@`); `address-privacy.test.js`; schema tests; twenty mutations each failing (commit `bf13cb3`) |
| One token vocabulary; contrast                              | `packages/config/tests/token-contrast.test.js` (169 pairings, both registers); `semantic-classes.test.js` (no literal colour outside documented exceptions)                                                                                                   |
| Navigation derived from `auth.me`, not a role list          | `apps/web/src/lib/navigation.test.js` against the real permission tables; `detail-directories` "the header"; `detail-account` "the account rail"; `detail-workspace` rail and crumb cases                                                                     |
| Same-origin `next`, no open redirect                        | `apps/web/src/lib/next-path.test.js` (29 cases, including `/\evil.example`)                                                                                                                                                                                   |
| Every page reachable without typing a URL                   | the rail, tab and crumb cases in `detail-account` and `detail-workspace`; `lib/area-tabs.test.js`                                                                                                                                                             |
| Real refusal vocabulary, no endpoint in a sentence          | `apps/web/src/lib/refusal.test.js`; the refusals browser suite (identical wording for another organisation's draft and an unused id)                                                                                                                          |
| No indefinite spinner; no 200 for a missing page            | `loading-boundaries.test.js` (no `notFound()`/`redirect()` under a streaming boundary); reads bounded by a five-second timeout                                                                                                                                |
| Discovery counts agree with the listing                     | `detail-directories` category case: the directory's count equals the listing's stated total, and its pages hold exactly that many distinct events                                                                                                             |
| Cards: all-in price, availability, no invented urgency      | `detail-directories` "event cards" (every card on the walk checked for urgency words, availability vocabulary and the all-in qualifier); the API test holding `minTotalCents` to a one-ticket order's total                                                   |
| Event page quotes what checkout charges                     | `feeTerms` test pricing an order to the paisa; `detail-checkout` (basket total equals the event page's)                                                                                                                                                       |
| A purchase completes, simulated                             | `detail-checkout` (reserve → pay → booked, reference in the API's pattern, "no money moved"); `checkout-basket.test.jsx` (one booking per attempt key, retry reuses it, lapsed hold)                                                                          |
| A restart cannot break checkout                             | `apps/api/tests/process-providers.test.js` (shows the default wiring's repeat; proves distinct ids across processes)                                                                                                                                          |
| Wallet says what admits                                     | `apps/api/tests/ticket-wallet.test.js` (a checked-in ticket does not admit); `detail-ticket-wallet`                                                                                                                                                           |
| Bearer secret stays out of page JavaScript                  | `apps/web/src/app/api/v1/[...path]/route.test.js` (6 cases)                                                                                                                                                                                                   |
| Open work first in the queues                               | `apps/api/tests/ranked-page-integration.test.js` on PostgreSQL: the old column sort misorders real rows; the ranked read does not, including a page straddling the tiers                                                                                      |
| Team, refund, reconciliation, outbox lists scoped and paged | `detail-workspace` (19 cases)                                                                                                                                                                                                                                 |
| Sitemap lists the live catalogue                            | `sitemap.test.js` (stub now refuses what the API refuses; 8 of 14 fail with the old page size); `detail-directories` sitemap case against the real API                                                                                                        |
| Only the door interrupts                                    | `components/live-region-policy.test.js` (source check; the door keeps at least four urgent outcomes)                                                                                                                                                          |
| Motion 120–250 ms; reduced motion                           | `motion.test.jsx` (durations equal the CSS tokens); the sweep's reduced-motion cases                                                                                                                                                                          |
| Responsive, 320–1440 px and 200% zoom                       | the sweep's Phase 4 block: sixteen surfaces × eight sizes, no horizontal overflow, scanned at four                                                                                                                                                            |
| WCAG 2.2 AA (automated)                                     | the sweep: axe with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`; keyboard, focus-visibility and touch-target cases                                                                                                                      |
| Titles leak nothing                                         | `app/page-titles.test.js` walks every page                                                                                                                                                                                                                    |
| Installable, no service worker                              | `app/manifest.test.js`; `detail-directories` manifest case; no service worker exists: nothing in `apps/web/src` registers one, and the app has no `public/` directory to serve one from                                                                       |
| Honest limitations                                          | `detail-account` "the limitations page shows every recorded status word exactly"                                                                                                                                                                              |
| `PAYMENT_MODE` MOCK and the kill switch                     | the kill-switch suite (12 of 12, `tests/payment-kill-switch.test.js`); `packages/providers/src/payment-mode.test.js`                                                                                                                                          |

### P4-23. Phase 4 classification

"Verified" below means proved by the tests named in §P4-22, run locally and in
CI run `35885247288` on the remediation SHA `43a5fd4`. Browser results are
Chromium only.

| #   | Requirement                    | Classification                                                                                                                                                                                                        |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Email privacy                  | **COMPLETE — VERIFIED** (masking SHA `bf13cb3`, CI `35819310106`)                                                                                                                                                     |
| 2   | Semantic design system         | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 3   | Public navigation              | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 4   | Attendee navigation            | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 5   | Operations navigation          | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 6   | Public discovery               | **COMPLETE — VERIFIED**; the organiser directory reads at most 500 upcoming events and says so when it stops short (§P4-21)                                                                                           |
| 7   | Event detail                   | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 8   | Ticket wallet                  | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 9   | Secure attendee pass           | **COMPLETE IN CHROMIUM SIMULATION**; on a physical device **EXTERNAL DEVICE VERIFICATION PENDING**                                                                                                                    |
| 10  | Transfer experience            | **PARTIAL** — offer, withdraw and decline work for general-admission tickets; accepting needs the invitation code, and delivering it is **NOT IMPLEMENTED**; seated tickets **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT** |
| 11  | Organizer workspace            | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 12  | Check-in workspace             | **COMPLETE IN CHROMIUM SIMULATION**; other browsers' cameras **EXTERNAL DEVICE VERIFICATION PENDING**                                                                                                                 |
| 13  | Venue management               | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 14  | Team management                | **COMPLETE — VERIFIED** for roles, removal and door scope; inviting is not offered, because invitations cannot be delivered (**NOT IMPLEMENTED**)                                                                     |
| 15  | Finance mock surfaces          | **COMPLETE — VERIFIED, MOCK ONLY**                                                                                                                                                                                    |
| 16  | Notification operations        | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 17  | Privacy operations             | **COMPLETE — VERIFIED** for the organisation's privacy team; attendee self-service export and deletion **NOT IMPLEMENTED**                                                                                            |
| 18  | Moderation                     | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 19  | Responsive behavior            | **COMPLETE — VERIFIED IN CHROMIUM** at 320–1440 px and 200% zoom                                                                                                                                                      |
| 20  | Accessibility                  | **VERIFIED BY AUTOMATED CHECKS** (axe WCAG 2.2 A/AA rules, keyboard, reflow, focus, live-region policy); no manual screen-reader audit was performed                                                                  |
| 21  | Motion and reduced motion      | **COMPLETE — VERIFIED**                                                                                                                                                                                               |
| 22  | Reserved-seat transfer         | **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**                                                                                                                                                                             |
| 23  | Group booking                  | **NOT IMPLEMENTED**                                                                                                                                                                                                   |
| 24  | Offline admission              | **NOT IMPLEMENTED**                                                                                                                                                                                                   |
| 25  | Physical-device QR             | **EXTERNAL DEVICE VERIFICATION PENDING**                                                                                                                                                                              |
| 26  | Real Stripe and Stripe Connect | **EXTERNAL VERIFICATION PENDING**                                                                                                                                                                                     |
| 27  | Destructive retention          | **DISABLED**                                                                                                                                                                                                          |

### What this phase does not claim

- That any payment, refund or payout moved money. `PAYMENT_MODE` is MOCK;
  every figure on the finance screens is simulated and says so.
- That Stripe or Stripe Connect works. Neither was exercised: **EXTERNAL
  VERIFICATION PENDING**.
- That a pass scans on a real phone, or that the door camera works outside
  Chromium: **EXTERNAL DEVICE VERIFICATION PENDING**.
- That the site is accessible to every person using assistive technology.
  Automated WCAG 2.2 A/AA rules and the direct checks listed pass; nobody has
  used it with a screen reader, voice control or a switch.
- That it is responsive on physical devices. Every width here is a Chromium
  viewport.
- That a transfer can be completed by two real people without help: the
  recipient needs a code this build does not deliver.
- That reserved-seat transfer, group booking, offline admission, SMS or email
  exist. They do not.
- That destructive retention runs. It is disabled.
- That the product is complete. Phase 4 finishes the frontend, UI/UX,
  navigation and operational surfaces over the backend that exists; the
  items in §P4-16, §P4-17 and §P4-21 remain.

---

## Phase 4: **COMPLETE — VERIFIED ON REMEDIATION SHA `43a5fd4`**

Implementation SHA `f1f12cfd668e06e877df6a37f4a45e4b2566c28f`; its exact-SHA
CI run `35878840028` failed one job and is preserved (§P4-15). Remediation SHA
`43a5fd47d9e92aa16b4e69fe5b133006b1754192`; exact-SHA CI run `35885247288`,
eight of eight jobs `success` (§P4-14). This section is committed separately,
as documentation only.

"Complete" is the phase's verdict, not every item's. The twenty-seven
classifications in §P4-23 stand as written: the transfer experience is
PARTIAL; reserved-seat transfer is **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**;
group booking and offline admission are **NOT IMPLEMENTED**; physical-device
QR and non-Chromium cameras are **EXTERNAL DEVICE VERIFICATION PENDING**; real
Stripe and Connect are **EXTERNAL VERIFICATION PENDING**; destructive
retention is **DISABLED**. `PAYMENT_MODE` stayed MOCK throughout, and no
provider credential was added.

A redesign of the site for a USA-only catalogue was asked for after this run
went green. It is new work, recorded separately, and nothing in it is claimed
here.

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

_Update, 2026-09-22, at the Phase 3 closure. The paragraph above is left as
written._ For the admission path, Phase 3's section now answers the migrations
and constraints, the API and response-schema changes, the authorisation
changes, the credential and QR threat model, the scanner's preview and
check-in flow, and the accessibility, Playwright-collection, limitation,
deferred-work, external-verification and classification items. Phase 4, and
every one of those items for the product as a whole, is still unwritten.

_Update, 2026-09-23, at the Phase 4 closure. Both paragraphs above are left as
written._ Phase 4's section now answers, for the product's frontend and
operational surfaces, the route and navigation inventory, the accessibility
and responsive evidence, the Playwright collection proof, the known
limitations, the external-verification items and the per-requirement
classification. What no phase has written is a whole-product closing report:
final repository state, architecture and data flow, and a security regression
summary across all four phases.
