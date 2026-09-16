# Load, and what it does not tell you

## The short version

The load suite measures what this code does on one machine at a stated
concurrency, and whether it stays **correct** while doing it. It does not
measure capacity, and no figure from it may be quoted as one.

If somebody asks "how many users does this support?", the honest answer is that
nobody here knows, and this suite is not how you would find out. What it can
tell you is narrower and more useful: that sixteen concurrent buyers reaching
for six tickets produce six sales, that a duplicate webhook delivered a thousand
times changes nothing after the first, and that none of it takes longer than the
budget in `scripts/load/config.js`.

---

## Running it

```
pnpm run load                             # steady, every scenario
pnpm run load -- --profile spike
pnpm run load -- --scenario ga-hold-contention
LOAD_SCALE=6 pnpm run load -- --profile soak
```

`TEST_DATABASE_URL` must be set and must point at a database you are willing to
have written to. The suite refuses to touch `DATABASE_URL`: a run creates and
contends over real rows, and a suite that could do that to a working database is
a suite nobody would run twice.

Each run writes a JSON record to `load-results/`, which is not committed. The
record carries the machine, the service versions and every measurement, so a
number in a report can be traced to the run that produced it.

**Do not run it alongside `pnpm run test`.** Both use `TEST_DATABASE_URL` —
`apps/worker/src/outbox/dispatcher.test.js` in particular claims outbox rows
under a lease — and a load run writing thousands of rows into the same database
will make that suite fail in ways that look like a product bug and are not. It
happened once while this suite was being written; the failure was mysterious for
exactly as long as it took to notice the two were sharing a database.

---

## The four profiles

| Profile  | Workers | Window | What it is for                                                            |
| -------- | ------- | ------ | ------------------------------------------------------------------------- |
| `ramp`   | 1 → 16  | 10s    | Finding the point where something starts queueing, which a flat run hides |
| `steady` | 16      | 10s    | The ordinary case                                                         |
| `spike`  | 64      | 5s     | A listing going viral, and a cold connection pool meeting it              |
| `soak`   | 8       | 45s    | What leaks: a connection never returned, a queue that grows               |

`LOAD_SCALE` multiplies every window. A soak that takes an hour is a soak nobody
runs, so the default is short and the long one is available on demand.

### Why a spike has a different latency budget

Because queueing is what a spike _is_. Four times the concurrency on the same
cores will queue, and a queue is latency. Each profile therefore carries a
`latencyMultiplier`, and it multiplies **latency and nothing else** — the error
rate, the throughput floor, the event-loop lag limit and every correctness
invariant are identical in all four.

That distinction is load-bearing. A multiplier that also relaxed error rates
would be a knob for making failures disappear, which is the opposite of what a
threshold is for. A spike that is slow is a spike; a spike that oversells is a
failed spike.

---

## The ten scenarios

Named by what they ask rather than by what they call:

1. **Public event browsing** — does the catalogue stay fast when everybody arrives?
2. **Public search** — does a text search over the whole catalogue stay in budget?
3. **Hot-event inventory reads** — does one event everybody is watching serve availability without queueing?
4. **General-admission hold contention** — do concurrent buyers take at most the tickets that exist?
5. **Reserved-seat hold contention** — do buyers reaching for the same seats take each seat once?
6. **Checkout creation** — does creating an order stay in budget while inventory is contended?
7. **Duplicate webhook processing** — does the same delivery arriving many times change anything after the first?
8. **Check-in concurrency** — do two scanners on one pass produce one admission?
9. **Notification worker throughput** — does the outbox drain faster than it fills?
10. **Refund request contention** — do concurrent refund requests together stay inside what was paid?

An eleventh, **reconciliation queue processing**, checks that the operations
queue stays readable while everything else is busy.

### Why a refusal is a success

Five buyers reaching for one seat should produce one hold and four refusals. A
scenario that counted those four as errors would be a scenario that passes only
when the product oversells. So each scenario states which statuses are the
product working, and only a 5xx or a transport failure counts as an error.

---

## The invariants, which are the point

After every scenario the suite asks the **database** — not the application —
whether the run was correct:

- No tier sold more than it has.
- No seat carries two live tickets.
- No order line holds more tickets than it bought.
- No source event posted two ledger batches.
- No ticket was admitted twice.
- No order owes back more than it took.
- Every posted batch balances.

A broken invariant fails the run outright, whatever the latency did. It is not
one check among five: a run reported as "four of five checks passed" is a run
somebody will read the four of.

---

## What this suite found

Worth recording, because a suite that has never found anything is a suite nobody
should trust:

- **A check-in race became a 500 at the door.** Two scanners, both reading the
  ticket as valid, the second refused by `desi_check_in_ticket_admissible`.
  The route caught Prisma's `P2002` and not the trigger's `P0001` — which
  Prisma nests under `meta.driverAdapterError.cause.originalCode` while the
  outer code is its own. 1.7% of scans at sixteen concurrent scanners.
- **A duplicate webhook delivery became a 500.** The handler's idempotency was
  check-then-create, so two deliveries in flight at the same instant both found
  nothing and both inserted; the unique index refused the second and nobody
  caught it. The comment above the code claimed replay was "safe rather than
  merely unlikely", which it was not. Nine per ten-second window.
- **An attendance row could outlive its rollback.** Fixed before the suite ran,
  but found by writing it: `admit` returned rather than threw when the ticket
  moved underneath the insert, committing a `CheckIn` against a ticket that was
  by then revoked.

Each was a real failure at a real door or a real provider, and none of them
appears under any load a single-threaded test can produce.

---

## Why these numbers are not capacity

Four reasons, any one of which is sufficient:

**The harness calls the application in-process.** `app.inject` rather than a
socket, deliberately: the question is whether the application's own concurrency
is safe, and a local socket would add the kernel's queueing to every measurement
without adding information. The cost is that these figures exclude network time
entirely — TLS, DNS, the load balancer, the actual internet.

**One process, one machine.** No replica, no connection pooler, no CDN, no cache
in front of the catalogue. A production topology differs in every one of those,
and each changes the answer by more than the numbers here vary.

**The database is local and small.** A few hundred rows, in shared buffers,
with no competing traffic. Query plans change with cardinality; a plan that is a
sequential scan over two hundred rows is the right plan and the wrong one over
two million.

**Concurrency is not arrivals.** Sixteen workers looping as fast as they can is
not sixteen people, and it is not any number of people: real arrivals are
bursty, correlated, and interleaved with think time. The relationship between
the two is a queueing-theory question that needs the production arrival
distribution, which nobody here has.

### What would be needed for a capacity figure

Production-shaped hardware, a production-shaped dataset, an arrival model taken
from real traffic, and a target service level somebody has agreed. Until all
four exist, the honest statement is the one at the top of this document.

---

## Reading a result

```
PASS  General-admission hold contention — steady
      Do concurrent buyers take at most the tickets that exist?
      3412 call(s) in 10.1s · 337.8/s · p50 41.2ms · p95 62.9ms · p99 88.1ms
      loop lag p95 13.3ms · peak connections 10 · peak queue depth not observed
```

**Event-loop lag** is the measurement nobody takes and the one that predicts
failure: a process answering in 50ms with 400ms of lag is a process whose next
request will take 450ms, and no latency percentile shows that until it already
has.

**Peak connections** is sampled during the run rather than after it. A pool that
peaked at its limit and drained is invisible afterwards, and it is the peak that
caused the timeouts somebody is investigating.

**Peak queue depth** reads "not observed" when no Redis client was supplied. It
is never reported as zero: a depth nobody measured and a depth of nothing are
different facts, and only one of them is reassuring.
