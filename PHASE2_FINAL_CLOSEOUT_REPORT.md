# Phase 2 final closeout report — an account of `66495c0`…`6eb6030`

**This is a cycle report, not a status record.** `PHASE2_STATUS.md` is the
authoritative current record of Phase 2, and where the two disagree that one is
right. Nothing in the earlier cycle reports has been rewritten; this is a new
account alongside them, and the two that needed a superseded marker have one.

---

## Executive result

**Phase 2 remains `PARTIAL`. Phase 3 has not been started and must not be.**

|                             |                                                                          |
| --------------------------- | ------------------------------------------------------------------------ |
| Gates `MET`                 | **19 of 20** — gates 13 and 14 closed in this cycle                      |
| Gates `PARTIAL`             | **1** — gate 17, _external configuration required_                       |
| Gates `NOT MET`             | **0**                                                                    |
| Code-owned work outstanding | **none for any gate**                                                    |
| What remains                | **one setting, on GitHub, that nobody inside this repository can apply** |

Everything the brief called code-owned is done, verified cold, and pushed. The
one gate still open is open for a reason that is not code: a real CI run exists
and all eight of its jobs pass, and **nothing on GitHub requires them before a
merge**. Configuring that needs write access to the repository's protection
settings, which this session's outbound proxy refuses — and refuses regardless
of the token, which reports `admin: true` on this repository.

Under the Phase 2 exit rule, that is where this stops. The external action is
specified precisely in `docs/BRANCH_PROTECTION.md`, down to the JSON and the
eight exact check-context names.

---

## 1. Repository state, at one commit

Measured at **`6eb6030`**, each value the output of the command beside it.

| Fact                        | Value                                                | Command                                |
| --------------------------- | ---------------------------------------------------- | -------------------------------------- |
| Branch                      | `claude/desi-event-js-stack-gb4uqe`                  | `git rev-parse --abbrev-ref HEAD`      |
| Local HEAD                  | `6eb6030b2895078ee64c720e1552a5420e7970b9`           | `git rev-parse HEAD`                   |
| Upstream ref                | `origin/claude/desi-event-js-stack-gb4uqe`           | `git rev-parse --abbrev-ref @{u}`      |
| Upstream HEAD               | `6eb6030b2895078ee64c720e1552a5420e7970b9`           | `git rev-parse @{u}` after `git fetch` |
| Local equals upstream       | **yes**                                              | the two hashes above                   |
| Working tree                | **clean** — `git status --porcelain` printed nothing | `git status --porcelain`               |
| Worktrees                   | one, the repository itself                           | `git worktree list`                    |
| Last executable-code commit | **`6eb6030`**                                        | it changes `.js` files                 |

**The final report commit is not `6eb6030`.** A file cannot contain the hash of
the commit that introduces it, so §12 records the property rather than the
number, and the final pushed HEAD is recorded there after this document's own
commit is pushed.

### The fourteen code commits

Newest first. All fourteen change executable code. The documentation commits —
the one that added this report, the one recording its hash, and the one adding
this revision — are separate.

| Commit    | What it changed                                                             |
| --------- | --------------------------------------------------------------------------- |
| `6eb6030` | The four refund and transfer commands a screen calls and no test did        |
| `c5e98da` | The four detail specs joined the public suite; the branch-protection record |
| `bdefff9` | Four behaviour suites, a zero-test guard, a seventh browser job             |
| `cd1544a` | Fourteen bundle needles and seven contract properties                       |
| `fc3f15a` | The sweep over five new surfaces, and the `dl` it found broken              |
| `33eeea9` | `tickets.get`, and the ticket, transfer and invitation screens              |
| `d48e18a` | The refund detail screen, and the organisation a refund names               |
| `aef9332` | The reconciliation detail screen and its five commands                      |
| `d7435a7` | Reconciliation evidence projected onto an allow list                        |
| `7ce0a72` | The organiser analytics screen and the five page states                     |
| `759e00a` | The money branch gated on capability **and** a fresh factor                 |
| `699715a` | The Prisma stub honours relation selects                                    |
| `d71d60f` | The `analytics` tag the new routes carry                                    |
| `66495c0` | Organiser analytics, and the five-second clock that was failing two gates   |

Every commit pushed as it was made; no history rewritten, squashed or
force-pushed.

---

## 2. What the baseline found before anything was built

The brief said to verify every reported fact before changing code. Almost all of
them held. Three did not, and all three are recorded rather than smoothed over.

**1. `pnpm run test` was not deterministic at `f24dee7`** — the commit reported
as passing all twenty-eight verification commands. It failed twice in a row, on
a _different_ test each time: `packages/db` round-tripping a row once,
`refund-concurrency` reserving an order the next. Both were 5,000 ms timeouts.
Both passed alone in about a second.

The cause was Vitest's default per-test budget against seventeen Turborepo
projects fanned out at once, several of them running deliberately contended
transactions. On four cores a test whose real work is 300 ms can queue past five
seconds. It was failing two gates rather than one: a timed-out file contributes
no coverage, so `apps/api` branch coverage slid from 75.09% to **73.25%**, under
its own 75% floor, with no line of code changing. GitHub's runners have two
cores, so CI would have been worse.

Fixed in `66495c0` by setting `testTimeout` and `hookTimeout` to 30 s in the
shared preset. **No assertion was relaxed.** A concurrency test demanding
exactly one winner demands it just as strictly with more patience; what changed
is how long the runner waits before deciding nobody is coming.

**2. PostgreSQL and Redis were not running** when the cycle began — the
container had restarted. Environmental rather than a finding, and recorded
because a verification that began against a database that was not there would
have produced skips reported as passes.

**3. Gate 17's enforcement was blocked by two distinct walls**, not one, and the
distinction was not in the previous record. §8 sets both out.

---

## 3. Gate 13 — the four surfaces

| Surface                          | Route                                   | API cases | Behaviour cases | Swept |
| -------------------------------- | --------------------------------------- | --------: | --------------: | ----- |
| Organiser analytics              | `analytics.summary`, `analytics.export` |  15 + 10¹ |               7 | yes   |
| Reconciliation item              | existing `reconciliation.*`             |       40² |               6 | yes   |
| Refund                           | existing `refunds.*`                    |       22² |               6 | yes   |
| Ticket, transfers and invitation | `tickets.get` and existing `tickets.*`  |       38² |               7 | yes   |

¹ fifteen route cases against the stub, ten integration cases against real
PostgreSQL. ² the suite total for that area, including the cases added here.

### Organiser analytics

`apps/api/src/lib/analytics.js` and two routes under a new `analytics` tag.

**Money comes from the ledger** — the same `financeSummary` the finance screen
calls, so two surfaces cannot come to two different answers about what an
organisation is owed. Everything else is counted from the rows that are the
fact: `Ticket`, `EventSeat`, `CheckIn`, and the same `quantitySold` counter the
selling path guards. They are separate branches of the payload because "tickets
sold × face value" is not revenue, which is why the field is called
`lineValueCents`.

**The conversion funnel is not invented.** Nothing in this system records a page
view or an anonymous browsing session, so the step everybody means by
"conversion" does not exist as data. Three real counts are reported — holds
taken, orders created, orders paid — and `funnel.missing` names the step that
cannot be counted. A test asserts the naming, because an absent metric that
stops saying it is absent has become an invented one.

**Currencies are never added together.** A mixed-currency organisation reads two
rows rather than one wrong number. Every window and date bucket is UTC and the
payload says so.

**`organizationId` is required.** An optional organisation is how an
organisation capability quietly becomes a platform one.

**The export is an allow list** written out rather than derived from the
payload's keys: no buyer, no email, no address, no card, no provider reference.
Counts go in `quantity` and money in `amountCents`, never the same column, so no
spreadsheet sums two hundred tickets and two hundred rupees into four hundred of
something. Formula prefixes are escaped rather than stripped.

### The reconciliation detail screen

Both sides of the evidence side by side, each a table with a row header per
field so a screen reader announces `status — succeeded` against
`status — requires_payment` rather than leaving the listener to hold both.

Five commands: claim, re-query, resolve, escalate, note. **Not** edit a payment,
edit an order, set a status or change an amount. Every one ends in the domain
service asking the provider and deciding for itself; none takes a status from
the page. Resolving re-queries at the moment of resolving rather than trusting
what the last look found — a stored answer is a claim about the past, and the
gap is where a settled order gets settled twice. `UNKNOWN` and `CONFLICT` close
nothing, the screen says so beside the button, and when the server refuses it
repeats the provider's own sentence about the disagreement.

What is drawn depends on the item's state and on whether the account holds the
platform capability. **Neither is the authorisation:** an organiser's finance
user may _read_ their own organisation's item — "why has this not settled" is
their question — and a test issues all five commands as that person and asserts
each 403.

### The refund detail screen

What goes back, how it divides across face value, fee and tax, which lines it
came from, why, whether the tickets are revoked and the inventory returned, the
provider's reference, and how many attempts.

**The amount is not a field.** It was computed from the order's own lines when
the refund was requested, and the database will not accept a refund that takes
an order past what it was paid — a CHECK constraint and a conditional `UPDATE`,
not a validation the page performs. A test asserts the request body carries no
`amountCents`.

**No card number, no CVC, no expiry, no token, and nothing that asks for one.** A
browser case reads the whole rendered page and asserts none of those words
appear and that no input would accept a number. A refund screen with a card
field would be a phishing page with a legitimate URL.

### The ticket, transfer and invitation screens

One new route, `GET /v1/tickets/:id`, which branches its authorisation in the
handler because two different people arrive with two different questions.

**The payload never carries the pass, an invitation token, or a credential
digest**, and there is a test for each. A pass on a page is a pass in a
screenshot, and a screenshot of a QR code is a ticket.

**The invitation never enters a URL.** It is delivered out of band, pasted into
a password field, and sent in a request body; the accept route reads no query
parameter that could carry one. A link with the secret in it would leave that
secret in the browser's history, in the next request's `Referer`, in every proxy
log along the way, and in any screenshot of the address bar — and it would still
be there long after the invitation was spent.

**Every refusal of an invitation reads identically**, whether it expired, was
withdrawn, was already used or never existed. A loop asserts all three refusals
produce the same words.

---

## 4. Gate 14 — the sweep

`pnpm run test:e2e:sweep`: **42 cases**, all passing, WCAG 2.1 A and AA with
**no rule disabled**. The only selector exclusion is Next's development overlay,
which the framework injects and no deployment ships.

Thirty clean scans — ten screens at 320, 768 and 1280 CSS pixels — plus the four
new detail screens at 200% zoom, reduced motion on the refund screen, a
reconciliation item worked by keyboard, the invitation field typed into without
the code reaching the address bar, and the refund screen proven to mention no
card and hold no field that could take one.

**Every new screen is scanned with real rows behind it**: a paid order with two
tickets, a refund with lines and an allocation, a reconciliation item with both
sides of its evidence, and a ledger batch that balances.
`seed-detail-screens.mjs` writes them to the disposable test database. A screen
rendered from a static array proves that the markup compiles, which is a
different and much weaker claim.

### The defect it found, recorded before its fix

`definition-list`, **serious**, WCAG 2.1 A (1.3.1). The reconciliation screen's
"Where it stands" list wrapped each entry in a `div` holding `dt`, `dd` **and an
explanatory `p`**. A `div` inside a `dl` is allowed; a `p` as a third sibling is
not, and a screen reader walking the list gets three unassociated paragraphs
where it should get three definitions. Found at 320 px on the first run over the
new screens.

The same mistake had been made once before, on the `Figure` component, and
fixed there with a comment explaining it. Twice is a pattern rather than a slip,
so the comment now sits on both.

---

## 5. Unit and integration totals

**4,642 cases across 173 files.** Never added to the browser figure.

The cold sequence in §11 ran at **4,633**. The nine cases in §9A were added
afterwards, when the third CI failure was investigated. Both numbers appear in
this report, and neither quietly replaces the other: §11 records what that
sequence actually saw.

| Package                   | Tests | Files | Package                     |     Tests |   Files |
| ------------------------- | ----: | ----: | --------------------------- | --------: | ------: |
| `@desi-event/api`         |   998 |    50 | `@desi-event/api-contract`  |       191 |       8 |
| `@desi-event/schemas`     |   580 |    11 | `@desi-event/pricing`       |       116 |       5 |
| `@desi-event/permissions` |   570 |     3 | `@desi-event/db`            |       102 |       3 |
| `@desi-event/providers`   |   494 |    12 | `@desi-event/ui`            |        97 |      12 |
| `@desi-event/web`         |   471 |    31 | `@desi-event/logger`        |        63 |       4 |
| `@desi-event/auth`        |   353 |     7 | `@desi-event/notifications` |        56 |       2 |
| `@desi-event/inventory`   |   291 |     8 | `@desi-event/ledger`        |        33 |       1 |
| `@desi-event/worker`      |   216 |    15 | `@desi-event/config`        |        11 |       1 |
| **Total**                 |       |       |                             | **4,642** | **173** |

Turbo reports seventeen tasks and sixteen packages write a report; the
seventeenth produces no test output of its own. Recorded rather than smoothed.

**0 skipped, 0 allow-listed, 0 undeclared**, and the guard now says how many
cases ran — which is the number that was missing from the summary all along.

---

## 6. Browser totals

**242 cases across seven configurations.** Listed separately, never summed with
the figure above.

| Configuration                     | Command              | Cases | Result |
| --------------------------------- | -------------------- | ----: | ------ |
| `playwright.config.js`            | `test:e2e`           |   118 | passed |
| `playwright.sweep.config.js`      | `test:e2e:sweep`     |    42 | passed |
| `playwright.detail.config.js`     | `test:e2e:detail`    |    26 | passed |
| `playwright.events.config.js`     | `test:e2e:events`    |    20 | passed |
| `playwright.production.config.js` | `test:e2e:prod`      |    19 | passed |
| `playwright.organizer.config.js`  | `test:e2e:organizer` |    13 | passed |
| `playwright.refusals.config.js`   | `test:e2e:refusals`  |     4 | passed |

The detail configuration's four specs are separately runnable —
`test:e2e:analytics` (7), `test:e2e:reconciliation` (6), `test:e2e:refunds` (6),
`test:e2e:transfers` (7) — under one pair of servers, because four
configurations would be four API processes and four Next servers on a two-core
CI runner.

It seeds once and signs in once for the whole run. The first draft signed in
eight times inside a minute and the credential limiter refused the last of them,
**correctly**: `/auth/login` keeps a budget of ten requests a minute that a
deployment deliberately cannot widen, unlike the general one. The right answer
to being refused by a security control is to stop doing the thing.

---

## 7. Database verification

| Command                      | Result                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm run db:verify:fresh`   | **81/81**, disposable database destroyed                                                                 |
| `pnpm run db:verify:upgrade` | **23/23**; 1,278 catalogue entries agree between fresh and upgraded; both disposable databases destroyed |

The schema is unchanged this cycle: 49 models, 36 enums, 20 plpgsql triggers, 34
CHECK constraints, 12 migrations — re-measured, not restated.

---

## 8. The workflow run, and the one thing that is not code

### The run

| Fact          | Value                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Workflow      | `CI`, id `359635192`, `.github/workflows/ci.yml`                                                        |
| Run           | **`35115541656`**                                                                                       |
| URL           | `https://github.com/KevinD003/desi-event.com/actions/runs/35115541656`                                  |
| Trigger       | `pull_request`                                                                                          |
| Pull request  | **#1**, `https://github.com/KevinD003/desi-event.com/pull/1`, open against `main`                       |
| Commit tested | `6eb6030b2895078ee64c720e1552a5420e7970b9` — the commit §1 measures                                     |
| Jobs          | **8, every one `success`**                                                                              |
| Coverage step | `success` — the step that failed on `33eeea9`; §9A says why it was green here before anything was fixed |

| Job                                        | Conclusion | Duration |
| ------------------------------------------ | ---------- | -------- |
| `Policy, lint, contract, tests, build`     | success    | 10m 16s  |
| `Browser — public catalogue`               | success    | 4m 08s   |
| `Browser — production build`               | success    | 1m 50s   |
| `Browser — organiser venue maps`           | success    | 2m 15s   |
| `Browser — event lifecycle`                | success    | 2m 43s   |
| `Browser — refusals`                       | success    | 1m 52s   |
| `Browser — accessibility sweep`            | success    | 2m 56s   |
| `Browser — commerce and operations detail` | success    | 3m 01s   |

**Skipped steps: one per job, each an `if: failure()` artefact upload.** No
required step was skipped. The job names above are read back from
`GET /actions/runs/<id>/jobs`, not transcribed from the workflow file. The
durations above were read from run `35108476624` on `c5e98da`; run
`35115541656` on `6eb6030` has the same eight jobs with the same conclusions.

### The three failures, and what was done about them

**As of run `35117010156`, twelve runs had happened on this pull request: seven
succeeded, three failed and two were cancelled** by the workflow's own
`concurrency` group when a later push superseded them — `fc3f15a` and `3966770`, both superseded within minutes and
both covered by a green run on the following commit. None of the three failures
was re-run until it passed.

A cancelled run is not a failed run, and the distinction is load-bearing here:
`GET /actions/runs/35104266352/jobs` and `.../35112134005/jobs` show no job in
either run concluding `failure` — six cancelled and one `success` in the first,
eight cancelled in the second. Neither hid anything.

This paragraph has now been wrong twice, and both errors are left on the record
rather than quietly replaced. The first revision said "nine runs, two failed":
written from the runs this session had watched while working, it missed the
failure that a later green commit had already superseded. The second said "ten
runs, three failed", which was true at the minute it was typed into `6eb6030`
and false fifteen seconds later, when pushing that very commit started run
eleven — while the same section had already been updated to name run
`35115541656`, so the section counted ten runs and cited the eleventh. The
lesson both times is the same one: a count of runs is a fact about a moment, and
writing it down inside the thing that creates the next run needs saying as
such.

| Run           | Commit    | What failed                                                                           | Root cause                                                                                                                                                                                                                | Fixed by  |
| ------------- | --------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `35097650069` | `66495c0` | `@desi-event/api-contract#test` — "tags every route with a tag the document declares" | The new `analytics` tag was on two routes and absent from `API_TAGS`                                                                                                                                                      | `d71d60f` |
| `35103232838` | `33eeea9` | **`Coverage thresholds`** — the `Test` step itself passed                             | **Not a coverage failure at all.** `@desi-event/db#test:coverage` crashed importing a Prisma client that `prisma generate` was rewriting underneath it. The step's name is the whole of the earlier misdiagnosis; see §9A | `79ff795` |
| `35106712692` | `bdefff9` | `Browser — public catalogue`                                                          | Four new `detail-*` specs joined the public suite, which runs with the API deliberately down                                                                                                                              | `c5e98da` |

The middle one is the one this record got wrong, and §9A sets out what it
actually was. Two details of the sentence that used to stand here were wrong
besides its cause: the next commit was not `cd1544a` but `fc3f15a`, whose run
was cancelled, and the step did not go green because anything had been fixed —
it went green because the race that broke it does not lose every time.

The third is worth its own sentence. `playwright.config.js` excludes other
configurations' specs by name, and its own comment calls that list "a
maintenance hazard and a deliberate one: a new spec joins the public suite
unless somebody says otherwise, and a public spec that is silently not run is
worse than one that fails loudly on its first day." It collected, loudly, on the
first day. The trade worked; the entry was owed.

### What CI now covers

Every job the brief named. PostgreSQL 16.15 and Redis 7.4.11 as service
containers; `REQUIRE_DATABASE: '1'` set at workflow level so an unreachable
database is a failure rather than a skip; no secret read, because payments run
in mock mode, which is the only mode this application has.

Two guards were added this cycle:

- **A seventh browser job** for the four detail suites.
- **A zero-test guard.** `check-skipped-tests.mjs` now refuses a report
  containing zero cases as well as an undeclared skip. A test command that
  matches no files prints a green summary and exits zero, and a required check
  that can pass by running nothing eventually will — a renamed directory, a
  pattern that stopped matching, a filter left on the command line. Proven by
  feeding it an empty report: exit 1.

### Enforcement: refused, and the two refusals are different

```
GET  /repos/KevinD003/desi-event.com/rulesets                  → 200 []
GET  /repos/KevinD003/desi-event.com/branches/main/protection  → 403 {"message": "Resource not accessible by integration"}
PUT  /repos/KevinD003/desi-event.com/branches/main/protection  → 403 {"message": "Write access to this GitHub API path is not permitted through this proxy."}
POST /repos/KevinD003/desi-event.com/rulesets                  → 403 {"message": "Write access to this GitHub API path is not permitted through this proxy."}
```

The **read** is refused by GitHub: the app installation lacks `administration`.
The **writes** are refused before they reach GitHub, by this session's outbound
proxy — and the same token reports `{"admin": true, "maintain": true, "push":
true, "triage": true, "pull": true}` on this repository. So the write refusal is
**not a missing GitHub permission and not a plan limitation**. It is the
execution environment declining to let an agent change a repository's protection
settings.

**Gate 17 is therefore `PARTIAL` — EXTERNAL CONFIGURATION REQUIRED**, and the
action is specified rather than described. `docs/BRANCH_PROTECTION.md` carries
the ruleset JSON, the classic-protection equivalent, the `gh api` invocations,
and the eight check-context names exactly as GitHub reports them — including the
em dash, because a hyphen there matches nothing and a required check that
matches nothing blocks every merge forever.

---

## 9. Security findings, and where each was fixed

Ten, of which seven were defects and three were tests or controls that could not
express their own property. Each was recorded before it was fixed.

| #      | What it was                                                                                                      | Fixed in  |
| ------ | ---------------------------------------------------------------------------------------------------------------- | --------- |
| C5-D1  | A route-level step-up gate made the analytics count tier unreachable for roles nothing compels to enrol a factor | `759e00a` |
| C5-D2  | Sales breakdowns carried money outside the branch that withheld the totals                                       | `759e00a` |
| C5-D3  | A test assertion that could fail by chance on a random identifier                                                | `759e00a` |
| C5-D4  | Reconciliation evidence was `z.unknown()`: a raw provider object would have shipped                              | `d7435a7` |
| C5-D5  | A bundle needle naming a published **request** enum, which fires on any screen issuing that command              | `aef9332` |
| C5-D6  | A refund payload that never said whose refund it was — NF-05 by the back door                                    | `d48e18a` |
| C5-D7  | A definition list that axe fails under WCAG 1.3.1                                                                | `fc3f15a` |
| C5-D8  | A second needle naming a published request field                                                                 | `cd1544a` |
| C5-D9  | Analytics substituting your own organisation for the one the URL named                                           | `bdefff9` |
| C5-D10 | The four new specs joining the public suite                                                                      | `c5e98da` |

### On the two needles

Both are recorded rather than quietly deleted, because deleting a needle to
obtain a green run is the move this repository has already written down as one
it does not make.

`SETTLED_FROM_PROVIDER` stood for "the reconciliation verdict vocabulary". It is
a member of `resolveReconciliationRequestSchema` — a **request** enum, published
in `openapi.json` — so a screen that closes an item has to name it, and naming
it proposes nothing, because the resolve route re-queries the provider and
refuses any closure the answer does not support. `toEmail` was the same shape.

Both were **retargeted** at names that appear in no schema:
`RESOLUTIONS_FOR_VERDICT`, `compareEvidence`, `maskRecipient` — the decision
procedure and the masking, which are what is genuinely server-only. The rule
that survives: a needle is removed only when it cannot express its property, and
only with a replacement that can.

### What was added

**Fourteen needles** for the new sensitive fields: the analytics derivations and
export allow list, the reconciliation evidence allow list and its projection, the
refund allocator and state table, and every name ticket credential material goes
by — `credentialHash`, `credentialVersion`, `mintTransferToken`, `tokenHash`.
Three paths joined the **required** list, because a build that dropped one would
pass every forbidden check by shipping screens whose buttons do nothing.

**Seven contract-level properties**, each reading the source rather than
restating it: every route added this cycle has a contract entry; both analytics
routes scope `report:view` to a required `organizationId`; `tickets.get`
declares no capability because it has two readers and documents `FORBIDDEN`;
the export's columns carry no email, name, buyer, address, card, provider, token
or payment field; counts and money occupy different columns; a Stripe-shaped
payload projected through `toEvidence` comes out as `{status}`; and a presented
refund names its organisation.

`security-regression.test.js` is now **20 cases**, all passing.

---

## 9A. The failure this report misdiagnosed, and the real coverage margin

This section was referenced five times before it existed. The references were
written; the section was not. What follows replaces the explanation they pointed
at, because that explanation was wrong.

### What run `35103232838` actually was

Job `104817695297`, step 17, `Coverage thresholds`, which runs
`pnpm run test:coverage`. The step name is the whole of the misdiagnosis. Nothing
breached a threshold:

- The string `threshold` does not appear anywhere in that job's **2,813-line
  log**.
- The task that failed is `@desi-event/db#test:coverage`, and `packages/db`
  enforces **no coverage thresholds at all** — `vitest.config.js` passes
  `coverageThresholds: {}` deliberately, with a comment saying why. The step
  named for thresholds was failed by the one package that has none.
- `@desi-event/api:test:coverage` printed only `cache miss, executing` before
  turbo aborted the run at `Tasks: 7 successful, 16 total`. **`apps/api`
  coverage never produced a number in that run**, so it cannot have been the
  thing that fell under a floor.

What failed was an import:

```
FAIL  tests/seed-data.test.js [ tests/seed-data.test.js ]
Error: Invalid package config .../node_modules/.prisma/client/package.json
 ❯ Object.<anonymous> .../@prisma/client/default.js:2:6
```

`test` and `test:coverage` declared `dependsOn: ["^build"]` — the
_dependencies'_ builds, not the package's own — so `@desi-event/db#build`, which
is `prisma generate`, was never ordered against `@desi-event/db#test:coverage`.
The log timestamps show them overlapping: the vitest run started at `13:43:59`
and the generate landed at `13:44:08.5`, rewriting the client the suite was in
the middle of importing.

### What the misdiagnosis cost

**Sixty-two assertions that nobody noticed had stopped running.** The import
failed, so `tests/seed-data.test.js` contributed `(0 test)` and vitest printed
`Tests 40 passed (40)`. That file holds 62 tests — measured by running it alone
at this commit: `Test Files 1 passed (1)`, `Tests 62 passed (62)`, against a
whole-package total of 102. The summary line looked like success. Only the
file-level `FAIL` gave it away, and only because the import error happened to be
fatal rather than merely empty.

The repository's own CI comment says an unreachable database must be "a failure
instead of a skip, and a skip reads exactly like success in a summary line".
This was that hazard, arriving through a door nobody had checked.

### The real margins, measured

Run cold at `79ff795` — `.turbo`, every `*/.turbo` and every previous `coverage/`
directory deleted first, then `pnpm run test:coverage`, `Tasks: 18 successful,
18 total`, exit 0. Floors are `packages/config/src/vitest-node.js`: lines 80,
functions 80, **branches 75**, statements 80.

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
| `packages/providers`     | 98.28  | 97.76     | 94.19     | 98.03      | strict                |
| `packages/schemas`       | 95.80  | 83.87     | 79.24     | 95.57      | strict                |
| `packages/db`            | —      | —         | —         | —          | none, deliberately    |
| `apps/web`               | 47.63  | 41.59     | 42.99     | 47.87      | not the shared helper |
| `packages/ui`            | 99.42  | 100.00    | 93.89     | 97.58      | not the shared helper |

**The thinnest margin in the repository is `apps/api` branch coverage: 75.83%
against a 75% floor, `+0.83` points.** The next thinnest is `packages/schemas`
functions at `+3.87`. So the floor genuinely is close, and a single new
uncovered branch in `apps/api` can turn the step red — which is a real standing
risk, just not the one that produced run `35103232838`.

### What stands and what does not

The nine cases `6eb6030` added to `apps/api` are real and are kept: `refunds.submit`
had no route tests at all and a screen calls it. The **75.58% → 75.83%** figures in
that commit message are genuine local measurements — `75.83%` is reproduced exactly
by the cold run above. What was false was the causal claim wrapped around them: that
those numbers explain run `35103232838`. They do not. The commits are left as they
were written; this section is the correction, not a rewrite of them.

The real defect is fixed at the root in `79ff795`: `"build"` added to the
`dependsOn` of both test tasks, so a package's tests wait for its own generate.
`turbo run test:coverage --filter=@desi-event/db --dry=json` now lists
`@desi-event/db#build` among the dependencies, where before it listed only
`auth`, `config` and `logger`. `scripts/check-ci-invariants.mjs` fails if that
ordering is ever removed, and was itself checked by removing it.

**Residual risk, stated rather than closed.** `test:e2e` still declares only
`["^build"]`. No failure has been traced to it, and it is left alone rather than
changed speculatively — recorded here so the next person reading a strange
import error in a browser job starts closer to the answer than this cycle did.

---

## 10. Stripe verification matrix

**No Stripe credentials have ever been supplied to this repository, and none
were requested as a blocker.** Payment mode is `MOCK`. Production payments
refuse the boot.

| Operation                    | Mock mode                  | Stripe sandbox                    |
| ---------------------------- | -------------------------- | --------------------------------- |
| Create and capture an intent | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |
| Partial and full refunds     | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |
| Refund decline and timeout   | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |
| Disputes                     | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |
| Transfers and payouts        | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |
| Connect onboarding           | adapter only, **no route** | **EXTERNAL VERIFICATION PENDING** |
| Webhook signature            | `AUTOMATICALLY TESTED`     | **EXTERNAL VERIFICATION PENDING** |

This repository contains no fabricated Stripe object identifier, no invented
webhook payload, no screenshot and no CLI transcript. Only
`packages/providers/src/stripe.js` imports the Stripe SDK, and a test asserts
the list has exactly one entry.

**Kill switch:** `payment-kill-switch.test.js`, **12 cases**, run as its own
named CI step and as command 18 of the cold sequence. Production mode refuses
the boot rather than being disabled, and no request field anywhere can name a
payment mode — asserted across every route in the contract.

---

## 11. The final cold verification

`.turbo`, every package's `.turbo`, `apps/web/.next`, `apps/web/test-results`
and every `vitest-report.json` deleted first. PostgreSQL 16.13 and Redis 7.0.15
running throughout. Run **sequentially**, one command at a time, nothing
concurrent. **Thirty-two commands, all exit 0, first run, nothing retried.**

| #   | Command                                 | Exit | Seconds | Result                                                        |
| --- | --------------------------------------- | ---: | ------: | ------------------------------------------------------------- |
| 1   | `pnpm run policy:check`                 |    0 |     0.6 | 606 files scanned via git, no violations                      |
| 2   | `pnpm run secrets:scan`                 |    0 |     1.1 | 605 tracked files, nothing credential-shaped                  |
| 3   | `pnpm run format:check`                 |    0 |    13.1 | every matched file Prettier-clean                             |
| 4   | `pnpm run lint`                         |    0 |    13.6 | no problems                                                   |
| 5   | contract validate                       |    0 |     0.8 | **118 routes, 118 operations, 106 paths**                     |
| 6   | `db:migrate:deploy` (test database)     |    0 |     2.8 | 12 migrations, none pending                                   |
| 7   | `pnpm run test`                         |    0 |   101.7 | **4,633 passed, 0 failed, 0 skipped**, 17 tasks, **0 cached** |
| 8   | `check-skipped-tests.mjs`               |    0 |     0.4 | 4,633 cases across 16 reports; 0 undeclared                   |
| 9   | `pnpm run test:coverage`                |    0 |   116.1 | every threshold met, 16 tasks, **0 cached**                   |
| 10  | `pnpm run db:verify:fresh`              |    0 |    18.5 | **81/81**, disposable database destroyed                      |
| 11  | `pnpm run db:verify:upgrade`            |    0 |     5.1 | **23/23**, both disposable databases destroyed                |
| 12  | `pnpm run build`                        |    0 |    16.6 | 3 tasks, **0 of 3 cached**                                    |
| 13  | `pnpm run openapi:check`                |    0 |     1.5 | artefact current with the route table                         |
| 14  | `pnpm run manifest:emit`                |    0 |     1.2 | 118 routes regenerated                                        |
| 15  | artefact drift (`git diff --exit-code`) |    0 |     0.0 | no difference                                                 |
| 16  | `pnpm run bundle:scan`                  |    0 |     0.7 | **297 browser-deliverable files**, nothing server-only        |
| 17  | `pnpm audit --audit-level moderate`     |    0 |     0.8 | no known vulnerabilities                                      |
| 18  | payment kill switch, on its own         |    0 |     3.5 | **12 passed**                                                 |
| 19  | `pnpm run test:e2e`                     |    0 |   105.9 | **118 passed**                                                |
| 20  | `pnpm run test:e2e:events`              |    0 |    62.0 | **20 passed**                                                 |
| 21  | `pnpm run test:e2e:sweep`               |    0 |    83.6 | **42 passed**                                                 |
| 22  | `pnpm run test:e2e:organizer`           |    0 |    39.1 | **13 passed**                                                 |
| 23  | `pnpm run test:e2e:refusals`            |    0 |    23.8 | **4 passed**                                                  |
| 24  | `pnpm run test:e2e:prod`                |    0 |    13.6 | **19 passed**                                                 |
| 25  | `pnpm run test:e2e:analytics`           |    0 |    30.1 | **7 passed**                                                  |
| 26  | `pnpm run test:e2e:reconciliation`      |    0 |    26.9 | **6 passed**                                                  |
| 27  | `pnpm run test:e2e:refunds`             |    0 |    26.5 | **6 passed**                                                  |
| 28  | `pnpm run test:e2e:transfers`           |    0 |    30.4 | **7 passed**                                                  |
| 29  | load — GA hold contention, ramp         |    0 |    12.6 | 1/1 scenario, every invariant held                            |
| 30  | load — reserved-seat contention, ramp   |    0 |    12.4 | 1/1 scenario                                                  |
| 31  | load — check-in concurrency, ramp       |    0 |    15.4 | 1/1 scenario                                                  |
| 32  | load — every scenario, steady           |    0 |   140.6 | **11/11 scenarios**                                           |

**No first-run failure.** Every failure this cycle produced happened while the
work was being done and is in §9 with its fixing commit; none survived to the
final sequence.

The sequence was run at `c5e98da`. The nine cases §9A added afterwards raise
`pnpm run test` to 4,642 and leave every other row unchanged; the table records
what that run actually saw rather than what a later one would.

### The load profile, and what it does not measure

Eleven scenarios, four profiles, seven database-side invariants checked after
every run. The ramp profile is used for the three contention scenarios because
what is being asserted is **correctness under contention**, and holding a
noisy-neighbour runner to a laptop's p95 produces a flaky gate people learn to
re-run.

`docs/LOAD_AND_CAPACITY.md` opens by saying what the suite does not measure and
gives four reasons its figures are not capacity. Nothing in this report treats
them as capacity.

---

## 12. Closing state

A file cannot contain the hash of the commit that introduces it, so what is
recorded here is the property rather than the number. After this document's own
commit is pushed:

```
$ git rev-parse HEAD && git rev-parse @{u}
(the two agree)

$ git status --porcelain
(no output)

$ git worktree list
/home/user/desi-event.com  <HEAD>  [claude/desi-event-js-stack-gb4uqe]
```

Branch `claude/desi-event-js-stack-gb4uqe`, upstream
`origin/claude/desi-event-js-stack-gb4uqe`, every commit of every cycle pushed,
no history rewritten, squashed or force-pushed, and one worktree.

**The last executable-code commit is `6eb6030`**, and it is named separately
from this report's own commit: a documentation commit is not a change to the
system. §11's thirty-two commands were run against `c5e98da`, one commit
earlier — §9A's nine cases came after them, and §11 records what that run saw
rather than what a later one would.

### Recorded after the fact

This section is the only part of the report written in a later commit, because
it is the only part that could not be written in its own.

| Fact                               | Value                                        |
| ---------------------------------- | -------------------------------------------- |
| Commit that introduced this report | `3966770e047675c6ac89dd03ed0d89c6485fc233`   |
| Pushed to                          | `origin/claude/desi-event-js-stack-gb4uqe`   |
| Verified after `git fetch`         | local and upstream agree; working tree clean |

The commit adding _this_ table is not in this table either, for the same reason.
That is the end of the regress: the property — everything committed, everything
pushed, local equal to upstream, clean tree, one worktree — is what can be
stated inside a file, and it is stated above.

---

## 13. The documentation matrix

| Document                              | What changed this cycle                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PHASE2_STATUS.md`                    | Gates 13 and 14 to `MET`; gate 17 to `PARTIAL — external configuration`; §1 re-measured; §5.2 added |
| `PHASE2_REQUIREMENTS_TRACEABILITY.md` | WI14 rewritten from `NOT IMPLEMENTED` to delivered; WI21's CI rows; the verification table          |
| `PHASE2_FINAL_VERIFICATION_REPORT.md` | A superseded marker on its gate status. Nothing rewritten                                           |
| `PHASE2_COMMERCE_CYCLE_REPORT.md`     | A superseded marker on its gate status. Nothing rewritten                                           |
| `PHASE2_FINAL_CLOSEOUT_REPORT.md`     | **This file** — new                                                                                 |
| `docs/ADVERSARIAL_REVIEW_FINDINGS.md` | Ten new findings, with the two needle retargetings and why they are not deletions                   |
| `README.md`                           | Current test figures; a "where the project stands" index                                            |
| `docs/architecture.md`                | Why analytics calls `financeSummary` rather than deriving money again                               |
| `docs/api.md`                         | 118 operations, 18 tags; the analytics section; `tickets.get`                                       |
| `docs/SECURITY.md`                    | The step-up branch and why a gate was the wrong shape; the evidence allow list; the two needles     |
| `docs/UX.md`                          | Five new surfaces; 42 sweep cases; seven configurations; the `dl` defect                            |
| `docs/PAYMENTS.md`                    | The analytics export's mode rows                                                                    |
| `docs/FINANCIAL_LEDGER.md`            | One derivation, two screens                                                                         |
| `docs/REFUNDS_DISPUTES.md`            | The refund screen, and why it has no amount field                                                   |
| `docs/RECONCILIATION_RUNBOOK.md`      | Where an operator now starts, and what the screen will not draw                                     |
| `docs/CHECK_IN.md`                    | The ticket screens; why the invitation is pasted rather than linked                                 |
| `docs/PHASE2_THREAT_MODEL.md`         | T10's qualification about retargeting; four new findings                                            |
| `docs/BRANCH_PROTECTION.md`           | The run, the eight exact check names, both refusals verbatim, the JSON to apply                     |
| `docs/DECISIONS.md`                   | Five decisions that live in code; two reversals                                                     |
| `docs/LOAD_AND_CAPACITY.md`           | Unchanged — the suite and its limits are unchanged                                                  |
| `docs/adr/`                           | Unchanged — no architectural decision was taken this cycle                                          |

---

## 14. Remaining external dependencies, exactly

1. **Branch protection or a repository ruleset on `main`**, requiring the eight
   checks named in §8. Needs somebody who can write the repository's protection
   settings from outside this execution environment.
   `docs/BRANCH_PROTECTION.md` has the JSON, the commands and the exact check
   names. **This is the only thing standing between Phase 2 and `COMPLETE`.**
2. **Stripe test-mode credentials**, if anybody wants the sandbox matrix in §10
   filled in. Not required by any gate.

Neither is code-owned. Nothing in this repository can do either.

---

## 15. Phase 3 readiness

**Not ready. Do not begin Phase 3.**

The Phase 2 exit rule requires all twenty gates `MET`. Nineteen are. The
twentieth is `PARTIAL` for a reason no amount of further work in this repository
will change, and the brief's instruction for exactly this case is to state the
external action required and stop.

| Condition                                     | State                                                  |
| --------------------------------------------- | ------------------------------------------------------ |
| Every gate `MET`                              | ❌ 19 of 20                                            |
| A CI run exists                               | ✅ `35115541656`, 8 jobs, all green, on `6eb6030`      |
| Branch protection configured                  | ❌ **the remaining item**                              |
| The four missing screens exist and are swept  | ✅ all four, plus the invitation screen                |
| Nothing claims a Stripe operation happened    | ✅ every such claim is `EXTERNAL VERIFICATION PENDING` |
| Production payments unreachable, and asserted | ✅ 12 cases, its own CI step                           |
| All code-owned verification commands pass     | ✅ 32 of 32, cold, first run                           |
| Every commit pushed; HEAD equals upstream     | ✅                                                     |
| Clean tree, one worktree                      | ✅                                                     |

When somebody applies the ruleset in `docs/BRANCH_PROTECTION.md` and records
what GitHub returns, gate 17 becomes `MET` and Phase 2 becomes `COMPLETE`. Until
then it is `PARTIAL`, and this report does not say otherwise.
