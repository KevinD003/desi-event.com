# Phase 2 post-closeout verification

**Evidence only.** Nothing in this cycle changed application behaviour. Every
statement below was produced by running the command or querying the API named
beside it, at the commit named beside it. Where a thing could not be proved, it
says so rather than rounding up.

**Phase 3 is unstarted. No Phase 3 work has begun, and none begins on the
strength of this document.**

---

## 1. Ground truth

| Fact                | Value                                                                        | How                                    |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| Branch              | `claude/desi-event-js-stack-gb4uqe`                                          | `git rev-parse --abbrev-ref HEAD`      |
| Local HEAD          | `354e66f13eb4d9e6599a0b580630b831209e9430`                                   | `git rev-parse HEAD`                   |
| Upstream HEAD       | `354e66f13eb4d9e6599a0b580630b831209e9430`                                   | `git rev-parse @{u}` after `git fetch` |
| Equal               | **yes**, `0 0` ahead/behind                                                  | `git rev-list --left-right --count`    |
| Working tree        | **clean**, no entries                                                        | `git status --porcelain=v1`            |
| Worktrees           | one                                                                          | `git worktree list`                    |
| Pull request        | **#1**, `open`, not draft, not merged, base `main`                           | `GET /repos/.../pulls/1`               |
| Mergeability        | `mergeable: true`, `mergeable_state: clean`                                  | same                                   |
| Review state        | 0 comments, 0 review comments                                                | same                                   |
| Run for this HEAD   | **`35127103320`**, and it is the **only** run for this sha                   | `GET /actions/runs?head_sha=354e66f…`  |
| Run conclusion      | **`success`**, `run_attempt: 1`, event `pull_request`                        | `GET /actions/runs/35127103320`        |
| Repository rulesets | **none** — `GET /rulesets` → `200 []`, `GET /rules/branches/main` → `200 []` | direct API                             |
| `main` protection   | **not readable** — `403 "Resource not accessible by integration"`            | `GET /branches/main/protection`        |

The commit the run tested is confirmed from the job rows, not inferred: every
one of the eight jobs reports `head_sha` `354e66f`.

### Every job and step

**8 jobs, every one `success`. 145 steps: 137 `success`, 8 `skipped`, 0
`failure`.**

| Job                                        | Conclusion | Steps | Skipped                           |
| ------------------------------------------ | ---------- | ----: | --------------------------------- |
| `Policy, lint, contract, tests, build`     | success    |    33 | 1 — `Upload failure artefacts`    |
| `Browser — public catalogue`               | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — production build`               | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — organiser venue maps`           | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — event lifecycle`                | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — refusals`                       | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — accessibility sweep`            | success    |    16 | 1 — `Upload Playwright artefacts` |
| `Browser — commerce and operations detail` | success    |    16 | 1 — `Upload Playwright artefacts` |

**Every skipped step is an `if: failure()` artefact upload — one per job, eight
in total. No required step was skipped.** That the uploads skipped is not a
defect; §5 explains why it is also not proof of anything.

Named steps in the verify job (`104898724136`):

| Step | Name                                | Conclusion  |
| ---: | ----------------------------------- | ----------- |
|    8 | `Language policy`                   | success     |
|    9 | **`CI invariants`**                 | **success** |
|   16 | `Test`                              | success     |
|   17 | `Refuse an undeclared skipped test` | success     |
|   18 | `Coverage thresholds`               | success     |
|   21 | `Build`                             | success     |
|   28 | `Upload failure artefacts`          | skipped     |

**The `CI invariants` step ran and succeeded**, at step 9, started
`2026-09-16T17:17:04Z`. It is a new required step; this was its first execution
in CI.

---

## 2. The historical tally, anchored

A run tally is a fact about a moment, so this one names its moment.

**As of run `35117010156`: twelve runs on pull request #1 — 7 succeeded, 3
failed, 2 cancelled.**

|   # | Run           | Commit    | Conclusion    |
| --: | ------------- | --------- | ------------- |
|   1 | `35097650069` | `66495c0` | **failure**   |
|   2 | `35100060805` | `7ce0a72` | success       |
|   3 | `35101523369` | `aef9332` | success       |
|   4 | `35103232838` | `33eeea9` | **failure**   |
|   5 | `35104266352` | `fc3f15a` | **cancelled** |
|   6 | `35104649920` | `cd1544a` | success       |
|   7 | `35106712692` | `bdefff9` | **failure**   |
|   8 | `35108476624` | `c5e98da` | success       |
|   9 | `35112134005` | `3966770` | **cancelled** |
|  10 | `35112183529` | `a18bad9` | success       |
|  11 | `35115541656` | `6eb6030` | success       |
|  12 | `35117010156` | `9c4371c` | success       |

Since that anchor the repository has one further run, `35127103320` on
`354e66f`, green — thirteen in total at the time of writing. The anchored figure
is left anchored rather than updated, which is the point of anchoring it.

### Cancelled is not failed

This distinction is load-bearing, because both appear as a non-green mark in a
commit list and in notification mail.

A **failed** run has at least one job whose `conclusion` is `failure`. A
**cancelled** run was stopped in flight. Both cancellations here were the
workflow's own `concurrency` group (`group: ${{ github.workflow }}-${{
github.ref }}`, `cancel-in-progress: true`) stopping a run that a later push had
superseded.

| Run           | Commit    | Job conclusions            | Any `failure`? | Superseded by           |
| ------------- | --------- | -------------------------- | -------------- | ----------------------- |
| `35104266352` | `fc3f15a` | 6 `cancelled`, 1 `success` | **no**         | `cd1544a`, 3m 34s later |
| `35112134005` | `3966770` | 8 `cancelled`              | **no**         | `a18bad9`, 27s later    |

Neither hid a failure, and neither left code untested: `git merge-base
--is-ancestor` confirms `fc3f15a` is an ancestor of `cd1544a` and `3966770` an
ancestor of `a18bad9`, so each superseded commit's tree was exercised by the
green run on the commit that replaced it.

Worth noting precisely, because it refutes a tempting shortcut: a cancelled run
is **not** uniformly cancelled at job level. `35104266352` contains one job that
finished `success` before the cancel landed. "Cancelled run" therefore means
neither "nothing ran" nor "everything ran"; only the job rows say.

---

## 3. The three genuine failures

| Run           | Commit    | Failing job / step                                     | Root cause                                                                                                                               | Fixed by             |
| ------------- | --------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `35097650069` | `66495c0` | `Test` → `@desi-event/api-contract#test`               | Two new routes carried `tags: ['analytics']`; `API_TAGS` never declared `analytics`, and a test asserts every route's tags are declared  | `d71d60f`            |
| `35103232838` | `33eeea9` | `Coverage thresholds` → `@desi-event/db#test:coverage` | **Not a coverage failure.** A `prisma generate` rewrote the client while db's own tests were importing it                                | `79ff795`            |
| `35106712692` | `bdefff9` | `Browser — public catalogue`, steps 10 **and 11**      | Four new `detail-*` specs joined the public suite (step 10); the artefact upload meant to capture the wreckage then failed too (step 11) | `c5e98da`, `79ff795` |

None was re-run until it passed.

---

## 4. The Prisma race, proved

### What the log says

Job `104817695297`, step 17, `Coverage thresholds`, which runs
`pnpm run test:coverage`:

```
FAIL  tests/seed-data.test.js [ tests/seed-data.test.js ]
Error: Invalid package config .../node_modules/.prisma/client/package.json
 ❯ Object.<anonymous> .../@prisma/client/default.js:2:6
 Test Files  1 failed | 2 passed (3)
      Tests  40 passed (40)
Failed:    @desi-event/db#test:coverage
```

Three facts that together rule out the coverage explanation this project
previously recorded:

1. **The string `threshold` does not appear anywhere in that job's 2,813-line
   log.**
2. The package that failed, `packages/db`, enforces **no coverage thresholds at
   all** — `vitest.config.js` passes `coverageThresholds: {}` deliberately, with
   a comment giving the reason. The step named for thresholds was failed by the
   one package that has none.
3. `@desi-event/api:test:coverage` printed only `cache miss, executing` before
   turbo aborted at `Tasks: 7 successful, 16 total`. **`apps/api` coverage never
   produced a number in that run**, so it cannot have breached a floor.

### The mechanism

`turbo.json` declared `dependsOn: ["^build"]` for `test` and `test:coverage` —
the _dependencies'_ builds, not the package's own. `@desi-event/db#build` is
`prisma generate`, and the client it writes lands in shared `node_modules`,
which no `outputs` glob tracks. So db's generate and db's own tests were
unordered, and turbo ran them together. The log timestamps show the overlap:

| Time           | Event                                                    |
| -------------- | -------------------------------------------------------- |
| `13:43:59`     | db's vitest run starts (`Start at 13:43:59`)             |
| `13:44:08.477` | `@desi-event/db:build` — `cache bypass, force executing` |
| `13:44:08.548` | `✔ Generated Prisma Client` — the client is rewritten    |
| `13:44:10.2`   | `tests/seed-data.test.js` fails to import it             |

### The 62-test impact

The import failed, so the file contributed `(0 test)` and vitest printed
**`Tests 40 passed (40)`**. Measured at this commit by running that file alone:

```
$ npx vitest run tests/seed-data.test.js        # in packages/db
 Test Files  1 passed (1)
      Tests  62 passed (62)
```

against a whole-package total of `102`. **Sixty-two assertions did not run, and
the summary line read like success.** Only the file-level `FAIL` gave it away,
and only because that particular import error was fatal.

### The fix, and its proof

`79ff795` adds `"build"` to the `dependsOn` of both test tasks. Verified three
ways at HEAD:

```
$ git show 354e66f:turbo.json | …
test -> ['^build', 'build'] | test:coverage -> ['^build', 'build']

$ npx turbo run test:coverage --filter=@desi-event/db --dry=json
dependencies: ['@desi-event/auth#build', '@desi-event/config#build',
               '@desi-event/db#build', '@desi-event/logger#build']
orders its own prisma generate: True
```

Before the fix that list held only `auth`, `config` and `logger`. A live run
with a cold task cache shows `@desi-event/db:build` executing `prisma generate`
to completion **before** `@desi-event/db:test` starts, and the suite passing
`Test Files 3 passed (3) / Tests 102 passed (102)` — all 62 included.

**Guard.** `scripts/check-ci-invariants.mjs` fails if the ordering is removed.
Proved by removing it in a scratch copy of the tree:

```
CI invariants failed:
  - turbo.json: task "test" does not depend on "build", …(see run 35103232838)
  - turbo.json: task "test:coverage" does not depend on "build", …
exit=1
```

---

## 5. The artefact-upload failure, and the limits of its repair

### The failure

Job `104829717332` (`Browser — public catalogue`, run `35106712692`) has **two**
failing steps, not one. The record previously named only the first.

| Step | Name                          | Conclusion  |
| ---: | ----------------------------- | ----------- |
|   10 | `Run public catalogue`        | **failure** |
|   11 | `Upload Playwright artefacts` | **failure** |

```
With the provided path, there will be 60 files uploaded
##[error]The artifact name is not valid: playwright-test:e2e.
Contains the following character:  Colon :
```

The name interpolated `matrix.suite.script`, and every script is a pnpm task of
the form `test:e2e:detail`. Sixty diagnostic files describing the failure were
discarded by the step whose job was to preserve them.

### Why no green run can prove the repair

The step is `if: failure()`. On a passing run it is **skipped** — and it was
skipped in all eight jobs of run `35127103320`, as §1 records. **A green run
therefore proves nothing whatever about artefact uploading.** Claiming otherwise
would be the same class of error as the coverage misdiagnosis: reading a
reassuring summary line as evidence about something it never touched.

### What is proved instead, statically

The repaired template interpolates `matrix.suite.name`. Both the template and
the matrix entries are read out of the committed workflow at `354e66f` and
combined, so **every name the workflow can emit** is checked without provoking a
failure in CI:

| Artefact name the workflow can produce      | Accepted by `upload-artifact`? |
| ------------------------------------------- | ------------------------------ |
| `verify-artefacts`                          | yes                            |
| `playwright-public catalogue`               | yes                            |
| `playwright-production build`               | yes                            |
| `playwright-organiser venue maps`           | yes                            |
| `playwright-event lifecycle`                | yes                            |
| `playwright-refusals`                       | yes                            |
| `playwright-accessibility sweep`            | yes                            |
| `playwright-commerce and operations detail` | yes                            |

Eight names — one literal and all seven matrix legs. **Names that
`actions/upload-artifact` would reject: 0.** Spaces are permitted; the rejected
set is `" : < > | * ? \r \n \ /`. Each name is unique within the run, as v4
requires.

**Guard.** Restoring the colon form in a scratch copy fails the check, naming
every affected leg:

```
CI invariants failed:
  - artefact name "playwright-test:e2e" contains ":", which actions/upload-artifact rejects
  - … six more, one per suite
exit=1
```

**Stated limitation.** This proves the _name_ is valid. It does not prove an
upload of these paths succeeds end to end, because that requires a genuinely
failing browser job, and manufacturing one would mean breaking a test on
purpose. That remains unproven by execution and is recorded as such in §8.

---

## 6. Coverage, measured

Run cold at `79ff795`: `.turbo`, every `*/.turbo` and every previous `coverage/`
directory deleted first, then `pnpm run test:coverage` — `Tasks: 18 successful,
18 total`, exit `0`. `79ff795..354e66f` changes four Markdown files and no
executable code, so these figures describe the code at the current HEAD.

Floors, from `packages/config/src/vitest-node.js`: lines 80, functions 80,
**branches 75**, statements 80.

| Package                  | Lines  | Functions | Branches  | Statements | Floors                |
| ------------------------ | ------ | --------- | --------- | ---------- | --------------------- |
| `apps/api`               | 89.43  | 91.83     | **75.83** | 86.94      | strict                |
| `apps/worker`            | 97.53  | 98.24     | 84.34     | 96.68      | strict                |
| `packages/api-contract`  | 95.08  | 100.00    | 90.00     | 94.27      | strict                |
| `packages/auth`          | 99.60  | 100.00    | 95.61     | 99.65      | strict                |
| `packages/inventory`     | 92.23  | 89.79     | 84.79     | 91.96      | strict                |
| `packages/ledger`        | 100.00 | 100.00    | 91.17     | 100.00     | strict                |
| `packages/logger`        | 100.00 | 100.00    | 100.00    | 100.00     | strict                |
| `packages/notifications` | 100.00 | 100.00    | 100.00    | 100.00     | strict                |
| `packages/permissions`   | 96.36  | 95.83     | 90.47     | 95.71      | strict                |
| `packages/pricing`       | 94.17  | 92.30     | 90.17     | 93.97      | strict                |
| `packages/schemas`       | 95.80  | 83.87     | 79.24     | 95.57      | strict                |
| `packages/db`            | —      | —         | —         | —          | none, deliberately    |
| `apps/web`               | 47.63  | 41.59     | 42.99     | 47.87      | not the shared helper |
| `packages/ui`            | 99.42  | 100.00    | 93.89     | 97.58      | not the shared helper |

**Thinnest margins against an enforced floor:**

| Package            | Metric     | Value  | Floor | Margin    |
| ------------------ | ---------- | ------ | ----- | --------- |
| `apps/api`         | branches   | 75.83% | 75    | **+0.83** |
| `packages/schemas` | functions  | 83.87% | 80    | +3.87     |
| `packages/schemas` | branches   | 79.24% | 75    | +4.24     |
| `apps/api`         | statements | 86.94% | 80    | +6.94     |

`apps/api` branch coverage is genuinely close to its floor, and a single new
uncovered branch can turn the step red. That is a real standing risk — it simply
is not what caused run `35103232838`.

---

## 7. Branch protection: the API responses

Attempted at `354e66f`. The payload was **extracted from
`docs/BRANCH_PROTECTION.md` programmatically** rather than retyped, so what was
sent is exactly what that document specifies: ruleset `Phase 2 required checks
on main`, `enforcement: active`, with all eight required check contexts.

| Call                                    | Result                                                                            | Refused by    |
| --------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| `GET /repos/…/rulesets`                 | `200` `[]`                                                                        | —             |
| `GET /repos/…/rules/branches/main`      | `200` `[]`                                                                        | —             |
| `GET /repos/…/branches/main/protection` | `403 "Resource not accessible by integration"`                                    | **GitHub**    |
| `POST /repos/…/rulesets`                | `403 "Write access to this GitHub API path is not permitted through this proxy."` | **the proxy** |
| `PUT /repos/…/branches/main/protection` | `403 "Write access to this GitHub API path is not permitted through this proxy."` | **the proxy** |

The repository reports `permissions: {"admin": true, "maintain": true, "push":
true, "triage": true, "pull": true}` for this identity — and the protection read
is still refused by GitHub as _not accessible by integration_, which is how a
GitHub App installation lacking the `administration` permission answers.

**So the identity does not have repository-administration access, and the
document was therefore not applied.** No protection rule was weakened, bypassed
or removed; the two write attempts were for the documented, _stronger_
configuration and both were refused before reaching GitHub. State re-queried
afterwards: `GET /rulesets` still `200 []`. Nothing changed.

The two refusals are different and the difference matters: the **read** is
GitHub declining a permission the installation does not hold; the **writes** are
this execution environment declining to let an agent alter repository protection
at all. Neither is a plan limitation, and no retry, payload or endpoint changes
either.

### What the owner must do

Apply `docs/BRANCH_PROTECTION.md` with an identity holding repository
administration. Then verify rather than assume:

```
gh api /repos/KevinD003/desi-event.com/rulesets
gh api /repos/KevinD003/desi-event.com/branches/main/protection
```

and confirm all eight contexts are required, **with the em dash (U+2014)**
exactly as GitHub reports the job names. A hyphen matches no check, and a
required check that matches nothing blocks every merge forever. The eight names
are read from run `35117010156`, which **succeeded** — an earlier revision of
that document sourced them from run `35106712692`, which failed; the strings
were byte-identical between the two runs, but a required-check list should be
read from a run that passed.

---

## 8. Remaining limitations

1. **Branch protection is not applied.** Gate 17's enforcement half is blocked
   on an external action. This is the only item keeping Phase 2 from
   `COMPLETE`.
2. **Artefact upload is proven by name, not by execution.** §5 explains why, and
   declines to claim more.
3. **`apps/api` branch coverage sits `+0.83` points over its floor.** One new
   uncovered branch can turn CI red.
4. **`test:e2e` still declares `dependsOn: ["^build"]` only.** No failure has
   been traced to it, and it was left alone rather than changed speculatively.
   The same class of race is structurally possible there.
5. **`apps/web` and `packages/ui` do not use the shared coverage helper**, so
   their figures are reported but enforce nothing.
6. **`packages/db` reports no coverage**, deliberately — its meaningful
   assertions need a live database.
7. **No Stripe verification has occurred.** Payment mode is `MOCK`. No
   credentials were supplied, none were requested as a blocker, and every real
   Stripe operation remains `EXTERNAL VERIFICATION PENDING`.
8. **The PR is not merged**, and this cycle does not merge it.

---

## 9. Verdicts

| Item                   | Verdict                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Gate 17**            | **`PARTIAL` — EXTERNAL CONFIGURATION REQUIRED**                                             |
| Gate 17, workflow half | **MET** — a real run, `35127103320`, 8/8 jobs green on the current HEAD, API-confirmed      |
| Gate 17, enforcement   | **NOT MET** — no ruleset, no branch protection; writes refused by the execution environment |
| Gates 1–16, 18–20      | **MET**, unchanged by this cycle                                                            |
| **Phase 2**            | **`PARTIAL`.** The exit rule requires all twenty gates                                      |
| **Phase 3**            | **UNSTARTED.** No Phase 3 work has begun, and none will on this evidence                    |

The pull request is **not merged**, and merging is not this cycle's to do.

---

## 10. Provenance

Every figure above came from one of:

- `git fetch`, `git rev-parse`, `git status --porcelain=v1`, `git worktree
list`, `git merge-base --is-ancestor`, `git show <sha>:<path>`, `git diff
--name-only`
- `GET /repos/KevinD003/desi-event.com/{pulls/1, actions/runs, actions/runs/<id>,
actions/runs/<id>/jobs, actions/jobs/<id>, rulesets, rules/branches/main,
branches/main/protection}`
- `mcp__github__get_job_logs` for job logs — raw `/actions/jobs/<id>/logs`
  downloads redirect to Azure blob storage and are refused by this environment's
  proxy, so logs were read server-side instead
- `npx turbo run … --dry=json`, `pnpm run test:coverage`, `npx vitest run`,
  `node scripts/check-ci-invariants.mjs`

The guard's two negative proofs were run against a **scratch copy** of
`turbo.json` and `.github/workflows/ci.yml`, never against the working tree,
which was confirmed clean immediately afterwards.

No secret, token or credential value is printed in this document, and none was
printed in producing it.
