# Retention runbook

This is how to run a retention rehearsal, how to read what it says, and what the
system will refuse to do no matter what is asked of it.

It is a runbook rather than a design document because the person reading it is
usually being asked a question by somebody from legal, and a design document is
not what they need then.

---

## The one rule

**Nothing deletes.** Not "should not" — cannot. There is no deletion path
anywhere in this repository. A retention sweep counts rows and writes down what
it counted. If you are here because somebody asked you to run the retention job
and clear out old data, the answer is that this system has no such job, and the
durations it would use are proposals nobody has approved.

Three independent things enforce that, and only the first depends on the code
being correct:

1. **`retention_sweep_dry_run_changes_nothing`** — a database CHECK constraint
   refusing any `DRY_RUN` row that claims a non-zero `affectedCount`. It holds
   whatever the application believes.
2. **There is no delete to call.** `apps/worker/src/retention/classes.js` issues
   `count` queries and nothing else. Its tests run it against a Prisma stub whose
   `delete`, `deleteMany`, `update`, `updateMany`, `$executeRaw` and
   `$executeRawUnsafe` all throw.
3. **`RETENTION_ENFORCEMENT_ACTIVATED`** defaults to false, and defaults to false
   again in `createProcessors`, so code that forgets to pass it gets the refusing
   worker rather than the counting one.

---

## Every number you will see is a proposal

`PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW` is attached to every class, every row
in the database, and every row on the screen. It is attached per row and not once
in a heading, so that a figure copied into a ticket carries its status with it.

Nobody has supplied a jurisdiction, a statutory minimum for financial records, or
a maximum for non-evidential personal data. Until somebody with the authority to
decide does, these numbers exist so that the sentence "if the proposal were
adopted, this many rows would be in scope" can be said with a number in it, and
for nothing else.

**Do not present a rehearsal as a compliance position.** It is a measurement of a
draft.

---

## What is evaluated

| Class                    | Proposed | What it counts                                         |
| ------------------------ | -------- | ------------------------------------------------------ |
| `login_attempt`          | 30 days  | Sign-in attempts older than the cut-off                |
| `session`                | 30 days  | Sessions that **expired** before the cut-off           |
| `session_metadata`       | 90 days  | Sessions still carrying a user agent or hashed address |
| `notification_recipient` | 30 days  | Delivered notifications, within an organisation        |

`session` is keyed on expiry rather than creation: a long-lived session that is
still valid is not stale, however old it is.

`notification_recipient` excludes rows whose `organizationId` is null. Those
predate the column and are unreachable by any organisation-scoped sweep.
Excluding them explicitly makes the gap a stated limitation rather than a silent
miss. **Whether to backfill them is an owner decision.**

### What is not evaluated, and why it is listed anyway

`export_artifact` is reported **NOT EVALUATED**. Nothing in this repository has
ever written an `ExportArtifact` row for stored bytes, so a count over it would
report an emptiness meaning "no writer exists" while looking exactly like
"nothing is old enough". Those are different findings and only one of them is
about retention.

It is listed rather than omitted because a class that quietly disappeared from
the table would read as one that was swept and found empty.

---

## Running a rehearsal

There is no button. The API exposes no route that starts a sweep, and that is the
design: the API holds no queue client, and adding one so that a browser could
trigger this would mean the one surface reachable from the internet had acquired
the ability to start a job whose durations nobody has approved.

A rehearsal is enqueued against the worker, by somebody with access to it:

```js
import { enqueueSweepRetention } from './apps/worker/src/queues.js'

// Every evaluated class:
await enqueueSweepRetention(queues)

// One class only:
await enqueueSweepRetention(queues, { retentionClass: 'login_attempt' })
```

Naming a class the worker does not evaluate — `export_artifact`, say — throws
rather than quietly sweeping everything. Reporting a full sweep as though a
narrowing had been honoured is worse than refusing.

**The payload cannot ask for execution.** `sweepRetentionJobSchema` has no `mode`
and no `execute`; an unknown key is stripped rather than honoured, and a test
asserts it. The processor hard-codes `DRY_RUN`.

**There is no schedule and there must not be one.** A retention sweep that runs
on a timer is the first step towards a retention sweep that deletes on a timer. A
test asserts that `scheduler.js` never mentions the job. If a schedule ever seems
warranted, the durations have to be approved first.

---

## Reading the result

`/retention` in the browser, or `GET /v1/operations/retention/sweeps`. Requires
`retention:view`, which no organisation role can carry.

### Three answers that all look like an empty table

This is the part most likely to send somebody to debug a worker that is working.

| What you see                 | What it means                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| No rows at all               | No rehearsal has ever run here. Nothing has been measured.                                       |
| Rows, all `SKIPPED_DISABLED` | It ran and **declined**. Enforcement is not activated in that environment. Nothing was examined. |
| Rows with counts             | It ran and counted. Nothing was changed.                                                         |

`SKIPPED_DISABLED` is a refusal, not a failure, and it is the expected state. It
is recorded rather than passed over silently precisely so that "we were told not
to" cannot be mistaken for "nothing happened". The row still carries the cut-off
it would have used, so the refusal can be reasoned about later rather than being
a blank.

### The columns

- **Counted** (`examinedCount`) — rows the proposal would reach.
- **Held back** (`heldCount`) — how many an active `PrivacyHold` protects. A
  sweep that ignored holds would delete what an erasure was forbidden from
  touching, reached by a different door. Counted, never resolved: the sweep
  reports how many it would leave alone and never which people they are.
- **Deleted** (`affectedCount`) — always 0. The database refuses to record
  anything else on a rehearsal.

### What the numbers cannot tell you

They are counts against a **draft** duration. Changing the proposal changes the
count, which is why each row records the cut-off it actually used: a later change
of proposal must not make an earlier run's behaviour unexplainable.

No row here contains a personal value, and that is structural. The queries ask
about timestamps and about whether a column is null; they never ask what is in
one. `session_metadata` asks only whether a user agent or a hashed address is
present, never what it says.

---

## If somebody asks you to activate enforcement

Do not, on your own authority. `RETENTION_ENFORCEMENT_ACTIVATED` gates whether a
rehearsal counts at all — **it does not enable deletion, because no deletion
exists** — but switching it on is still a statement that somebody has decided
these measurements should be taken in that environment.

Before it goes on anywhere that holds real people's data, the durations need a
legal or privacy decision, and that decision needs to be written down somewhere
other than a chat message.

---

## What this system still cannot do

Stated so that nobody discovers them during an incident.

- **Delete anything on a retention basis.** No path exists.
- **Recall a downloaded export.** The export register records that an export
  happened and can invalidate the record; the bytes left the building.
- **Reach `NotificationOutbox` rows written before `organizationId` existed.**
  They are null and therefore unreachable by an organisation-scoped sweep.
- **Redact historic `AuditLog` rows.** They are immutable by database trigger and
  may contain personal data in identifiers and free text. A data subject
  therefore cannot truthfully be told their erasure is complete while those rows
  stand. Owner and legal decision, recorded and unresolved.
- **Claim compliance with anything.** No GDPR, CCPA/CPRA, PCI DSS, HIPAA or SOC 2
  position is asserted by any of this.
