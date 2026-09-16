# Phase 2 commerce cycle — an account of `cfb654c`…`910538b`

**This is a cycle report, not a status record.** It says what this cycle did and
what was true when it was written. The current status of Phase 2 is
`PHASE2_STATUS.md`, and where the two disagree that one is right.

> **HISTORICAL STATUS — SUPERSEDED where it reports gate status.** A later cycle
> (`66495c0`…`c5e98da`) closed gates 13 and 14, and produced the first CI runs.
> Every "seventeen met, three partial" and every "the workflow has never run" in
> this report was true at `910538b` and is not true now;
> `PHASE2_FINAL_CLOSEOUT_REPORT.md` is that cycle's account and
> `PHASE2_STATUS.md` is the current record. **Nothing below has been rewritten**
> — a report that quietly revises what it said last time is not a record.

Nothing in the earlier cycle reports has been rewritten. This is a new account
alongside them.

---

## What the cycle was asked to do

Complete the remaining code-owned Phase 2 work: the commerce services the
previous cycle listed as absent — refunds, reconciliation resolution, disputes,
transfers, payouts, ticket transfer and revocation, the notification worker, a
seated purchase end to end — plus the finance and operations surfaces, a load
suite, CI, the accessibility sweep, the fifteen named documents, and a full
verification.

It was also asked, explicitly, not to overstate any of it.

---

## Scale

| Measure       | Value            |
| ------------- | ---------------- |
| Commits       | 20               |
| Files changed | 164              |
| Files added   | 74               |
| Lines         | +42,106 / −3,323 |

---

## The twenty commits

| Commit    | What it did                                                                |
| --------- | -------------------------------------------------------------------------- |
| `cfb654c` | The lifecycle enums and constraints the commerce services stand on         |
| `54b13b6` | A reserved seat is priced by the seat, not by the tier                     |
| `a47e19d` | The notification outbox worker — the table stops being one nothing reads   |
| `e840102` | The four refusals, walked in a browser rather than asserted                |
| `38f839c` | A build that skips a test stops reading as a build that passed             |
| `192c694` | The accessibility scanner, and four contrast failures it found             |
| `e202ced` | Partial refunds in the mock provider, receipts stamped as a demonstration  |
| `cb735e6` | A handler may choose a status the contract does not declare                |
| `b53c8ad` | Refunds: four steps, five refusals, and the races                          |
| `351baae` | The reconciliation queue, and six things an operator may do to an item     |
| `97d6918` | Payouts, transfers and disputes, with a balance nobody can overdraw        |
| `962385e` | A ticket handed on, withdrawn, and admitted exactly once                   |
| `e1f19ae` | The finance view, the operations board, and an export nobody can weaponise |
| `b33682e` | The shell's capability check, and two WCAG failures the sweep found        |
| `9d95eea` | A repeatable load suite, and the three defects it found                    |
| `11b0c11` | CI asserts correctness under contention on every push                      |
| `8e84654` | NF-05, NF-11, NF-12 and NF-23 re-checked across every new surface          |
| `a02eb2f` | The fifteen named documents                                                |
| `7d73fd1` | The suppressibility list disagreed with every writer                       |
| `910538b` | One snapshot, because another suite was publishing mid-assertion           |

---

## Defects found, and where each came from

This is the part worth keeping. Every one is a failure that reached a real
person in a real situation, and none was found by reading the code.

### Found by the load suite

| Defect                                                       | What it cost                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| A check-in race became a **500 at the door**                 | 1.7% of scans at sixteen concurrent scanners                |
| A duplicate webhook delivery became a **500**                | Nine per ten-second window                                  |
| `CheckIn.deviceId` received a client-supplied scanner string | A guaranteed 500 at a door, on the first scan from a device |

The check-in one is the instructive case. The route caught Prisma's `P2002` and
not the trigger's `P0001`, which **Prisma nests**: the outer `error.code` is
`P2039` and the real code is at
`error.meta.driverAdapterError.cause.originalCode`. A trigger refusal — the
correct behaviour — became an uncaught 500.

### Found by writing the code

| Defect                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `admit` inserted the attendance row **after** moving the status, so the trigger refused the very check-in it had read for                       |
| `admit` **returned rather than threw** when the status moved underneath, committing an attendance row against a ticket that was by then revoked |
| `openReconciliation` accepted a `refundId` and dropped it                                                                                       |
| `defineRoute` overwrote a handler's chosen 200 with the contract's 201                                                                          |

### Found by the accessibility scanner

Four contrast failures and two structural ones, all real, all fixed in the
components rather than by silencing a rule: white on the primary button
(3.12:1), a footer note (3.74:1), secondary text across sixteen files (4.43:1),
the editor's step numbers at 70% opacity (4.14:1); plus a definition list whose
hint sat outside its `<dd>` and a scrollable region that could not be reached by
keyboard.

### Found by the security regression suite

The finance and operations layouts asserted a capability with **no
organisation** — the NF-05 inversion, which silently refuses every organiser and
passes every platform admin. Caught on the day the layouts were written.

### Found by the coverage thresholds

And then by asking why nothing had been running them.

| Defect                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- |
| `UNSUPPRESSIBLE_TEMPLATES` disagreed with every call site that wrote a row                                    |
| `settleTransfer`, `reverseTransfer`, `openDispute` and `resolveDispute` had no test at all                    |
| `apps/api` branch coverage had slipped below its own floor                                                    |
| **Nothing ran `test:coverage`** — not `pnpm verify`, not CI. Every threshold in the repository was decorative |

### Found by the final verification run

`facets-integration.test.js` read the whole published catalogue twice and
differenced the counts, while `event-lifecycle-integration.test.js` published
events into the same database from another worker. About one contended round in
four. Diagnosed by reproducing it, not by re-running until it passed.

---

## Harness defects, kept separate from product defects

They are different things and this repository does not mix them.

| Harness defect                                                     | Fix                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| A pasted bcrypt hash did not match its password                    | Hash the password at run time                             |
| The load harness read `body.data.accessToken`; it is `body.token`  | Read what the route returns                               |
| Privileged accounts need MFA, and the harness signed in without it | Enrol a real factor and use a real code                   |
| Provider ids restarted at `pi_000001` between runs                 | A per-run id prefix                                       |
| The spike profile exceeded the steady latency budget               | A per-profile multiplier on **latency only**              |
| A worker test failed mysteriously                                  | It shared `TEST_DATABASE_URL` with a load run; documented |

---

## What this cycle did not build

Named here so it is not inferred from the list above:

- **Organiser analytics.** WI14 in the traceability matrix. Nothing.
- **A reconciliation detail screen, a refund screen, a ticket transfer screen.**
  Those surfaces are API-only, and the accessibility sweep says so rather than
  reporting a coverage it does not have.
- **Connect onboarding.** The adapter methods exist; no route calls them and no
  screen sends anybody to one.
- **Any Stripe API call.** EXTERNAL VERIFICATION PENDING throughout.
- **A CI run.** The workflow is written and complete. It has never executed, for
  the reason `PHASE2_STATUS.md` gate 17 gives.

---

## Verification at `910538b`

Twenty-eight commands, in order, nothing cached — `.turbo`, every package's
`.turbo`, `apps/web/.next` and `apps/web/test-results` were deleted first, so
`test`, `test:coverage` and `build` all report **0 cached**.

PostgreSQL 16.13 and Redis 7.0.15 on the same machine, both up throughout.
Node v22.22.2, pnpm 10.33.0.

| #   | Command                               | Exit | Seconds | Result                                                                   |
| --- | ------------------------------------- | ---: | ------: | ------------------------------------------------------------------------ |
| 1   | `policy:check`                        |    0 |     0.4 | 575 files scanned via git, no violations                                 |
| 2   | `secrets:scan`                        |    0 |     0.7 | 574 tracked files, nothing credential-shaped                             |
| 3   | `format:check`                        |    0 |     9.9 | every matched file Prettier-clean                                        |
| 4   | `lint`                                |    0 |     9.8 | no problems                                                              |
| 5   | contract validate                     |    0 |     0.6 | **115 routes, 115 OpenAPI operations, 103 paths**                        |
| 6   | `db:migrate:deploy` (test database)   |    0 |     2.0 | 12 migrations applied                                                    |
| 7   | `test`                                |    0 |    76.5 | **4,536 passed, 0 failed, 0 skipped**, 167 files, 17 tasks, **0 cached** |
| 8   | `check-skipped-tests`                 |    0 |     0.2 | no undeclared skip                                                       |
| 9   | `test:coverage`                       |    0 |    84.4 | every threshold met, 16 tasks, **0 cached**                              |
| 10  | `db:verify:fresh`                     |    0 |    13.7 | **81/81**, disposable database destroyed                                 |
| 11  | `db:verify:upgrade`                   |    0 |     4.1 | **23/23**, 20 triggers, 12 migrations, both destroyed                    |
| 12  | `build`                               |    0 |    12.0 | 3 tasks, **0 of 3 cached**                                               |
| 13  | `openapi:check`                       |    0 |     1.0 | artefact current with the route table                                    |
| 14  | `manifest:emit`                       |    0 |     0.9 | regenerated                                                              |
| 15  | manifest and OpenAPI drift            |    0 |     0.0 | no difference                                                            |
| 16  | `bundle:scan`                         |    0 |     0.5 | **240 browser-deliverable files**, nothing server-only                   |
| 17  | `pnpm audit --audit-level moderate`   |    0 |     0.6 | no known vulnerabilities                                                 |
| 18  | payment kill switch, on its own       |    0 |     2.6 | **12 passed**                                                            |
| 19  | `test:e2e`                            |    0 |    85.1 | **118 passed**                                                           |
| 20  | `test:e2e:events`                     |    0 |    53.0 | **20 passed**                                                            |
| 21  | `test:e2e:sweep`                      |    0 |    35.7 | **22 passed**                                                            |
| 22  | `test:e2e:organizer`                  |    0 |    29.6 | **13 passed**                                                            |
| 23  | `test:e2e:refusals`                   |    0 |    16.5 | **4 passed**                                                             |
| 24  | `test:e2e:prod`                       |    0 |     9.9 | **19 passed**                                                            |
| 25  | load — GA hold contention, ramp       |    0 |    12.1 | 1/1 scenario passed, every invariant held                                |
| 26  | load — reserved-seat contention, ramp |    0 |    12.1 | 1/1 scenario passed                                                      |
| 27  | load — check-in concurrency, ramp     |    0 |    13.4 | 1/1 scenario passed                                                      |
| 28  | load — every scenario, steady         |    0 |   125.9 | **11/11 scenarios passed**                                               |

**Twenty-eight of twenty-eight at exit 0.**

### Unit and integration totals, by package

**4,536 across 167 files.** Summed from what the run printed, not recalled:

| Package                   | Tests | Package                     |     Tests |
| ------------------------- | ----: | --------------------------- | --------: |
| `@desi-event/api`         |   940 | `@desi-event/worker`        |       216 |
| `@desi-event/schemas`     |   580 | `@desi-event/api-contract`  |       191 |
| `@desi-event/permissions` |   570 | `@desi-event/pricing`       |       116 |
| `@desi-event/providers`   |   494 | `@desi-event/db`            |       102 |
| `@desi-event/web`         |   423 | `@desi-event/ui`            |        97 |
| `@desi-event/auth`        |   353 | `@desi-event/logger`        |        63 |
| `@desi-event/inventory`   |   291 | `@desi-event/notifications` |        56 |
|                           |       | `@desi-event/ledger`        |        33 |
|                           |       | `@desi-event/config`        |        11 |
| **Total**                 |       |                             | **4,536** |

Turbo reports seventeen tasks and sixteen packages print a total; the
seventeenth produces no test output of its own. Recorded rather than smoothed.

### Browser cases, counted separately

**196 across six configurations**, and the six are disjoint — each config names
its own spec files, so no case is counted twice:

| Configuration | default | events | sweep | organizer | refusals | prod | **Total** |
| ------------- | ------: | -----: | ----: | --------: | -------: | ---: | --------: |
| Cases         |     118 |     20 |    22 |        13 |        4 |   19 |   **196** |

**These two totals are never added together**, and 196 browser cases is not the
same as passing the twenty _required_ journeys. `PHASE2_STATUS.md` §6 scores
those separately.

### Failures in earlier runs of this sequence, and what each was

The sequence was run three times. The first two each failed, and each failure
was diagnosed and fixed rather than re-run:

| Run | Command                   | Failure                                          | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Fixed in          |
| --- | ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | `test:coverage`           | `@desi-event/notifications` 75% functions vs 80% | Two exported functions nothing called, and they disagreed with every writer                                                                                                                                                                                                                                                                                                                                                                                                                 | `7d73fd1`         |
| 1   | `db:migrate:deploy` (dev) | P3009, a migration left unfinished               | **Local development database only.** An interrupted `migrate deploy` earlier in the container left `20260916000000_event_draft_revision` started and unfinished while its statements had run. Not a product defect: a fresh database applies all twelve migrations (`db:verify:fresh`, 81/81) and an upgrade from populated applies them too (`db:verify:upgrade`, 23/23). The command was dropped from the final sequence, which migrates the **test** database — the one every suite uses | not a code change |
| 2   | `test`                    | `facets-integration` expected 1186 to be 1185    | Two catalogue reads differenced across a concurrent publish from another suite                                                                                                                                                                                                                                                                                                                                                                                                              | `910538b`         |

The third run is the one recorded above. Nothing was retried to make it pass.
