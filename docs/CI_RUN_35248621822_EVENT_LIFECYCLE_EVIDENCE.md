# CI run 35248621822 — event-lifecycle failure evidence

Written 2026-09-17, before any change was made in response to it.

This file separates what the run's own output **shows** from what it merely
**suggests**. Two theories held earlier in this investigation are disproven here,
including one of my own.

---

## 1. Run and job context

| Field          | Value                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| Workflow       | CI                                                                                       |
| Run            | `35248621822`, attempt 1                                                                 |
| Head SHA       | `09e66bde09b4c712c741c5cb87682b836af2608b` (merge commit)                                |
| Branch / event | `main` / `push`                                                                          |
| Job            | `Browser — event lifecycle`, id `105295079315`                                           |
| Failed step    | 10, `Run event lifecycle`                                                                |
| Job window     | `16:49:19Z` → `16:52:36Z`                                                                |
| Runner         | GitHub hosted, `ubuntu-24.04`, image `20260907.300.1`, runner `2.337.0`, Azure `westus3` |
| Services       | `postgres:16` (16.15), `redis:7` (7.4.11)                                                |
| Suite config   | `playwright.events.config.js` — serial, own ports (API 4410, web 3410)                   |

Node, pnpm, Playwright and Chromium versions are not printed by this job's log
and are **not recorded here rather than guessed**.

---

## 2. Artifact inventory

| Artifact                     | Id            | Size    | Retrieved? |
| ---------------------------- | ------------- | ------- | ---------- |
| `playwright-event lifecycle` | `10508771552` | 198,997 | **No**     |
| `verify-artefacts`           | `10508986461` | 883,974 | No         |

**Neither artifact could be downloaded.** They are served from
`productionresultssa*.blob.core.windows.net`, and this environment's egress proxy
refuses `CONNECT` to that host by organisation policy:

```
curl: (56) CONNECT tunnel failed, response 403
```

So the screenshots (`test-failed-1.png`, `test-failed-2.png`), the
`error-context.md` page snapshot, and any trace or video **were not examined**.
They exist and have not expired. Any conclusion that needs them is marked open
below rather than assumed. **This is the single largest gap in this evidence
base**, and the page snapshot is precisely what would settle the leading
candidate in §6.

---

## 3. The failure

```
1) e2e/event-lifecycle.spec.js:422 › an event, from a blank list to a
   cancellation › journey 14: the organiser resubmits and the moderator approves

   Test timeout of 90000ms exceeded.
   Error: locator.click: Target page, context or browser has been closed
   Call log:
     - waiting for getByRole('button', { name: 'Approve' })

     435 |     await moderator.goto(`/moderation/events/${eventId}`)
   > 436 |     await moderator.getByRole('button', { name: 'Approve' }).click()
```

13 passed, 1 failed, 6 did not run.

"Target page, context or browser has been closed" is the teardown after the
90-second budget expired, not the cause. **The reported location is line 436, the
click — so line 435, the `goto`, completed.** That fact carries most of §6.

---

## 4. Timeline — what the server actually saw

Per-journey completion, from the log's own timestamps:

| Journey | Completed at        | Δ           |
| ------- | ------------------- | ----------- |
| 1       | 16:50:40            | —           |
| 2–13    | 16:50:42 → 16:51:03 | 0–3 s each  |
| **14**  | **16:52:34**        | **+91 s**   |
| 15–20   | 16:52:34            | did not run |

Journeys 1–13 took **23 seconds in total**. Journey 14 consumed the whole 90-second
budget on its own.

Requests during journey 14, all HTTP 200:

```
16:51:04.003  GET   /organizer/events/<id>                      200  192ms
16:51:05.837  PATCH /api/v1/events/<id>                         200   78ms   (autosave)
16:51:06.097  GET   /api/v1/events/<id>/readiness               200   18ms
16:51:06.101  GET   /api/v1/events/<id>/transitions             200   16ms
16:51:06.114  GET   /api/v1/events/<id>/readiness               200   11ms
16:51:06.119  GET   /api/v1/events/<id>/transitions             200   12ms
16:51:06.357  GET   /moderation/events/<id>                     200  168ms
16:51:06.421  POST  /api/v1/events/<id>/submit-review           200  246ms
16:51:06.484  GET   /api/v1/events/<id>/readiness               200   43ms
16:51:06.498  GET   /api/v1/events/<id>/transitions             200   58ms
16:51:06.708  GET   /organizer/events/<id>                      200  195ms
—— 87 seconds of complete server silence ——
16:52:34.052  prisma:error — auditLog.deleteMany refused (teardown)
16:52:34.111  ✘ journey 14
```

---

## 5. What the evidence shows

1. **The resubmission succeeded.** `PATCH /api/v1/events/<id>` 200 saved the
   description; `POST /api/v1/events/<id>/submit-review` returned **200**. The
   event reached review. No 4xx or 5xx appears anywhere in the job.
2. **Every request in the job returned 200.** No API error, no database error
   other than the teardown one in §7, no Redis error, no readiness or startup
   failure, no crash.
3. **Journeys 1–13 ran at full speed** — 0 to 3 seconds each, comparable to local.
4. **No `GET /moderation/events/<id>` appears after the submit.** The last is at
   `16:51:06.357`, whose 168 ms duration places its start at ≈`16:51:06.189` —
   _before_ `submit-review` completed at `06.421`. After the submit there is
   nothing.
5. **The 87-second silence is total.** Not a slow request, not a retry, not a
   redirect: no request at all.
6. Fixture seeding, organiser sign-in, moderator sign-in and step-up all
   completed — journeys 1 to 13 exercise every one of them and passed.

---

## 6. Candidate causes

### Disproven

| Theory                                                              | Why it is wrong                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `auditLog.deleteMany` in `seed-events.mjs` caused it.**       | The refusal is stamped `16:52:34.004` — the same second the test failed, i.e. **teardown, 88 seconds after the journey began**. It also carries `.catch(() => {})`, so it has thrown on every run since the trigger landed, including green ones. It cannot cause a failure that had already happened.                                                                                    |
| **A slow CI runner.** _(My own earlier claim, retracted here.)_     | Journeys 1–13 took 23 seconds in total, 0–3 seconds each. The runner was fast. Journey 14 alone hung. I reported the opposite in an earlier draft of `docs/POST_MERGE_CI_RELIABILITY_FIX_REPORT.md` by comparing the job's 2.1-minute wall time against a 45-second local suite — that comparison included container, install and web-server startup and was not a like-for-like measure. |
| **An optimistic UI let the test run ahead of the server.**          | `event-lifecycle-panel.jsx:281` sets the displayed status from `parsed.data.status` — the server's response — not from the local `DESTINATIONS` map, which exists only to match against the server's transition list. The panel is not optimistic, so "waiting for review" cannot appear before the server confirms.                                                                      |
| **A failed API call, lifecycle refusal, or authorization refusal.** | Every request returned 200, including `submit-review`. Nothing was refused.                                                                                                                                                                                                                                                                                                               |

### Leading candidate, not confirmed

**The `goto` was served from the App Router client-side router cache, rendering
the moderation page as journey 13 left it.**

It fits every fact in §5: `goto` completed (the failure is at line 436, not 435);
it produced no server request (item 4); the page would then show the event as
`CHANGES_REQUIRED`, which renders no **Approve** button; and nothing in a
client-cache hit triggers a re-fetch, which is exactly the 87 seconds of silence
in item 5. Playwright's auto-wait polls the DOM, not the network, so it would
wait out the full budget against a stale page without emitting a single request.

The moderator had already loaded that exact URL three times in the preceding
seven seconds (16:51:00.369, 16:51:03.327, 16:51:06.357), so a cache entry for it
certainly existed.

**What would confirm it:** the `error-context.md` snapshot or
`test-failed-1.png` from the artifact, showing whether the page displayed
`CHANGES_REQUIRED` (cache hit, confirmed) or `REVIEW_PENDING` with no Approve
button (a different defect entirely). **Both are unreachable from here — §2.**

### Still open

- Why it does not reproduce locally. The suite passes 20/20 in ~45 seconds, five
  consecutive times (§8 of the fix report), before and after the seed change.
- Whether any client-cache behaviour differs between the CI web server and the
  local one for this suite.
- Whether the same latent race could affect other journeys that revisit a page
  after a state change elsewhere.

---

## 7. The teardown error, for completeness

```
16:52:34.052  Invalid `prisma.auditLog.deleteMany()` invocation:
              Database error. Code: `23514`.
              Message: `audit rows are append-only; DELETE on cmu5rn8h1000byd425o3wqizx is refused`
```

`desi_audit_log_immutable` working exactly as designed. The call was removed on
the fix branch because it could never succeed and its error text, sitting one
line above the failure, invited the first wrong diagnosis. **Removing it is
cleanup, not a fix for journey 14**, and this document does not claim otherwise.

---

## 7A. The authorized re-run — 2026-09-17, and what it overturns

Run `35248621822` was re-run on the same commit `09e66bd`, same workflow, same
configuration, no code change. `rerun_failed_jobs` re-executed only the two
failed jobs; the other six carried over from attempt 1 and are not fresh
evidence.

| Job on attempt 2                       | Attempt 1   | Attempt 2   |
| -------------------------------------- | ----------- | ----------- |
| `Policy, lint, contract, tests, build` | **failure** | **success** |
| `Browser — event lifecycle`            | **failure** | **success** |
| Run conclusion                         | **failure** | **success** |

**Both failures are intermittent.** Neither reproduced on an identical commit.

### What this withdraws

**Journey 14 is not deterministic, and §8 below said it was.** That claim is
withdrawn. It rested on a single observation — 87 seconds of server silence,
which really is what a wedged navigation looks like — and a single observation
cannot distinguish "always" from "sometimes". The reasoning was sound; the
confidence was not.

**The leading candidate in §6 is neither confirmed nor refuted by this.** A
client-cache hit would be timing-sensitive, so an intermittent failure is
consistent with it — and equally consistent with several other races. It stays a
candidate, and the `error-context.md` that would settle it is still unreachable.

**The fresh-database failure was intermittent too**, which is the more surprising
half. Attempt 2 passed step 19 with the **unfixed** global-count assertion still
in place. That does not make the assertion sound: it counted rows belonging to
other suites and could never have detected a redaction touching this order's
money. It means only that the race it depended on does not fire every time. An
assertion that is both vacuous and occasionally red is worth fixing on the first
count alone.

### What this changes about `main`

**`main` is green.** Run `35248621822` attempt 2 is the latest run on `main` and
it concluded `success`, 8 of 8, on `09e66bd`. Every statement in this repository
that `main` is red was true when written and is now superseded.

## 7B. Third observation — post-merge `main` CI on 2026-09-17

Added after §7A, and additive to it. Nothing above this line has been rewritten.

PR #6 was merged by `KWinOverAnything` at `20:53:19Z`, producing merge commit

```text
7db5fecc919af8c53f6afefb7d59cf794cdce587
```

That push ran CI directly against the merge commit itself — not against a branch
head that happens to share its tree, which is the distinction §7A was written to
respect.

| Field          | Value                                      |
| -------------- | ------------------------------------------ |
| Run            | `35273492335`, attempt 1 — no re-runs      |
| Head SHA       | `7db5fecc919af8c53f6afefb7d59cf794cdce587` |
| Branch / event | `main` / `push`                            |
| Conclusion     | **success — 8 of 8 jobs**                  |
| Window         | `20:53:22Z` → `21:01:00Z`                  |

Every job, by name:

| Job                                        | Conclusion  | Duration |
| ------------------------------------------ | ----------- | -------- |
| `Policy, lint, contract, tests, build`     | **success** | 6m 25s   |
| `Browser — production build`               | **success** | 1m 34s   |
| `Browser — public catalogue`               | **success** | 3m 00s   |
| `Browser — organiser venue maps`           | **success** | 1m 42s   |
| `Browser — refusals`                       | **success** | 1m 32s   |
| `Browser — event lifecycle`                | **success** | 2m 26s   |
| `Browser — accessibility sweep`            | **success** | 2m 05s   |
| `Browser — commerce and operations detail` | **success** | 2m 04s   |

### What the event-lifecycle log says

From job `105378319859`, step 10, `Run event lifecycle`:

```text
✓  13  journey 13: the moderator asks for a specific change … (3.2s)   20:58:35.946
✓  14  journey 14: the organiser resubmits and the moderator approves (4.5s)   20:58:40.489
✓  15  journey 15: an approved event is still not public (711ms)
…
20 passed (50.3s)
```

```text
Journey 14 passed in 4.5 seconds.
20 tests passed.
Event lifecycle suite completed in 50.3 seconds.
```

Journey 14 consumed 4.5 seconds of a 90-second budget. On attempt 1 of run
`35248621822` the same journey consumed the whole budget and timed out, with 87
seconds of total server silence inside it (§4). Nothing between those two runs
changed journey 14, its spec, its selectors or its timeouts.

### What this does and does not establish

**It establishes** that this is the second successful direct-`main` observation
following the one original failure. The tally on `main`, on code that is
identical for every line journey 14 touches, is now **one failure and two
passes**: `09e66bd` attempt 1 failed, `09e66bd` attempt 2 passed, `7db5fec`
passed. That strengthens §7A's conclusion that the failure is **intermittent or
environment-dependent**.

**It does not identify the root cause, and it does not prove journey 14 is
fixed.** No change was made to journey 14. A test that passes twice after
failing once has told you about its distribution, not its mechanism. The status
remains:

```text
NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN
```

**The artifact is still unreachable.** Artifact `10508771552`, holding
`error-context.md` and the failure screenshots, was requested again through the
GitHub Actions artifact API. That call returns a valid signed URL, and the
download is then refused at this environment's egress gateway:

```json
{
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "productionresultssa14.blob.core.windows.net:443"
}
```

So the refusal is a standing network policy, not an expired link or a wrong URL.

**One thing did change about what is reachable.** Job **logs** can be read from
this environment through the GitHub MCP server, which proxies their content
rather than redirecting to blob storage — that is how the per-journey timings
above were obtained without a re-run. Failure **artifacts** cannot. Future CI
failures here can therefore be diagnosed to the log level, but not to the
screenshot or page-snapshot level.

### The §6 conclusions are unchanged by this

Recorded explicitly so that a passing run is not mistaken for a resolution:

| Theory                                   | Status after this observation                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The `auditLog.deleteMany` caused it      | **Still disproven**, by timing — the refusal is stamped in teardown, 88 s after the journey began. |
| A slow CI runner caused it               | **Still disproven**, by per-journey timing — journeys 1–13 took 23 s in total.                     |
| An optimistic UI ran ahead of the server | **Still disproven** — the panel sets status from the server's response, not a local map.           |
| The App Router client router cache       | **Still an unconfirmed candidate, and only that.** Nothing here confirms or refutes it.            |

The removal of the dead `auditLog.deleteMany` from the refusals seed, made
alongside this note, is the same cleanup `1b77cc5` made to the lifecycle seed.
**It is not a fix for journey 14**, and this document does not claim it is.

One correction to a claim made while doing it. The removal was first written up
as silencing the same `23514` error the lifecycle seed produced. It does not.
The trigger is `FOR EACH ROW`, so a `DELETE` matching no rows never fires it, and
the refusals journeys are about things being refused — their events accumulate no
audit rows for the statement to match. A measured run of the refusals suite with
the statement still in place produced **zero** `23514` errors, and the refusals
job on this very run, `105378319787`, carries none either. The lifecycle seed's
copy matched rows on every run and was genuinely noisy; the refusals copy was
dead and quiet. Both were worth removing, for different reasons, and only the
first one ever misled anybody.

---

## 8. Conclusion

**Root cause not confirmed, and the failure is intermittent** — see §7A, which
supersedes the characterisation below. The three theories on the table are
disproven, and the remaining candidate is supported by request-level evidence but
needs a page snapshot this environment cannot fetch.

No speculative change was made to journey 14, its spec, its selectors or its
timeouts on the strength of this document, and none has been made since. Raising
the timeout or adding a retry would still be wrong: journey 14 did not run
slowly, it did nothing at all for 87 seconds, and a longer budget cannot help
something that is not waiting on work.

> **Superseded in part — see §7A.** This paragraph originally called the failure
> "deterministic on CI". The authorized re-run passed on the identical commit, so
> it is intermittent. The rest of the paragraph stands.

---

## 9. The superseded documentation branch — assessed, and **retained**

Recorded here because the assessment was made alongside §7B, and because the
conclusion is the opposite of the one expected when the check was ordered.

Branch: `claude/docs-post-merge-status-reconciliation`, head `e6da134`, two
commits, cut from `09e66bd`.

Deletion was authorised **only if all five** of the conditions below held. Two do
not, so **the branch was not deleted**.

| #   | Condition                                                     | Verdict   | Basis                                                                        |
| --- | ------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| 1   | It is not `main`                                              | **True**  | `main` is `7db5fec`; this is `e6da134`, unprotected                          |
| 2   | It has no open pull request                                   | **True**  | No PR has ever referenced it; PRs #1–#6 all name other branches              |
| 3   | No commits or files that merged work on `main` has superseded | **FALSE** | Five files carry content that is not on `main` in any form                   |
| 4   | Its useful content was incorporated, or is now obsolete       | **FALSE** | Three of its corrections fix statements that are still wrong on `main` today |
| 5   | Its false CI claim is still present, so it must not be merged | **True**  | Present in two files — see below                                             |

### The blocker, exactly

`main` at `7db5fec` still says, in `PHASE2_STATUS.md` line 3:

```text
**Status: `COMPLETE`. All twenty gates are `MET`.** Phase 3 has not been started.
```

and again at line 1160. That is false: Phase 3's Phase 1 and Phase 2 are merged.
The branch corrects it. Nothing on `main` does.

Content on the branch and nowhere on `main`:

| File                                                  | Size    | What it does                                                              |
| ----------------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `PHASE2_STATUS.md`                                    | +17     | Corrects "Phase 3 has not been started"; marks §12.3 historical           |
| `docs/DATA_MODEL.md`                                  | +16     | Corrects a paragraph that understates the redaction engine                |
| `docs/PRIVACY_AND_RETENTION.md`                       | +17     | Marks the §2 table superseded in part, naming which three rows still hold |
| `docs/STATUS_READING_GUIDE.md`                        | 274 new | Map of which document governs what                                        |
| `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md` | 329 new | The reconciliation record                                                 |

Only `docs/PHASE3_IMPLEMENTATION_REPORT.md` is genuinely superseded: `main`
carries its own corrected version of the same file, merged in PR #6.

### Why it still must not be merged as it stands

The false claim is in **two** files on the branch:

- `docs/STATUS_READING_GUIDE.md`, line 193
- `docs/PHASE3_IMPLEMENTATION_REPORT.md`, §3.0

both asserting:

```text
No CI run has ever had `09e66bd` as its head SHA.
```

Run `35248621822` had `09e66bd` as its head SHA, on `main`, on a `push` event. It
failed on attempt 1 and succeeded on attempt 2. `main` already carries the
corrected text for the second file. `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md`
does **not** contain the claim; its §81 is careful and correct.

### Disposition

**Retained, untouched — not deleted, and not merged.** The branch holds real
corrections and one false sentence in two places. Deleting it would discard the
corrections; merging it would publish the falsehood. Resolving it means porting
the three still-needed corrections onto `main` without the two false statements,
which is a separate, authorised piece of work and was not done here.
