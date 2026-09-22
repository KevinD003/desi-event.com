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
