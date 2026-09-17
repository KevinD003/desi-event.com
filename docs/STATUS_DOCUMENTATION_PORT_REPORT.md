# Status documentation port — 2026-09-17

Documentation only. No application code, test, schema, migration, contract, UI,
payment, CI-workflow, branch-protection, deployment or GitHub setting was
changed by this task.

---

## 1. Starting point

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Starting `main`        | `510d75a2b00b476d807f0e324c1229e12d886277`                     |
| Its own direct CI      | Run `35279635031`, `main` / `push`, attempt 1 — `success`, 8/8 |
| Working tree at start  | clean                                                          |
| Branch created         | `claude/port-corrected-status-docs`, cut from `origin/main`    |
| Source branch assessed | `claude/docs-post-merge-status-reconciliation`, head `e6da134` |

The source branch was **read, never merged**. It remains on the remote,
unmerged and undeleted, exactly as the earlier assessment
(`docs/CI_RUN_35248621822_EVENT_LIFECYCLE_EVIDENCE.md` §9) left it.

---

## 2. Files compared

| File                                                  | On `main` before  | On source branch                           | Outcome                                          |
| ----------------------------------------------------- | ----------------- | ------------------------------------------ | ------------------------------------------------ |
| `PHASE2_STATUS.md`                                    | stale in 2 places | corrected                                  | **ported**, rewritten from current facts         |
| `docs/DATA_MODEL.md`                                  | stale             | corrected                                  | **ported**, and the source's own count corrected |
| `docs/PRIVACY_AND_RETENTION.md`                       | stale in 2 rows   | corrected                                  | **ported**, and extended                         |
| `docs/PHASE3_IMPLEMENTATION_REPORT.md`                | already correct   | contains a false claim                     | **not ported**; extended with current CI         |
| `docs/STATUS_READING_GUIDE.md`                        | absent            | present, 274 lines, contains a false claim | **rewritten**, not copied                        |
| `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md` | absent            | present, 329 lines                         | **deliberately not ported** — see §6             |

---

## 3. Corrections carried forward

### `PHASE2_STATUS.md`

Two labelled corrections. Neither touches the Phase 2 verdict itself.

- **Line 3** said `Phase 3 has not been started.` That was false on `main` until
  this change. It now carries a dated `Current-status update` recording that
  Phase 3's Phase 1 and Phase 2 are merged, that Phase 3's Phase 3 and Phase 4
  are not, and that this file governs Phase 2 only.
- **§12.3 "Phase 3 prerequisites"** now opens with
  `HISTORICAL STATUS — SUPERSEDED`, preserving the original list as the record
  of what was required at the time. Its CI run numbers are explicitly flagged as
  not-current.

### `docs/DATA_MODEL.md`

The Phase 3–Phase 1 bullets were one part wrong and one part undercount:

- **"There is no redaction command"** is no longer true. The engine exists and
  is tested against real PostgreSQL. What stays true is narrower and is now
  stated as such: no scheduled job deletes anything, and no real person has been
  redacted.
- **"Two read routes"** was an undercount. The surface is **nine operations**,
  now itemised by method and path.

### `docs/PRIVACY_AND_RETENTION.md`

§2's table carries a labelled `SUPERSEDED IN PART` banner naming the two rows
that are now wrong, the four that are still exactly true, and — added here
beyond what the source branch had — an explicit implemented/not-implemented
breakdown separating the redaction service from the absent UI, the absent export
governance, and the absent retention execution.

### `docs/PHASE3_IMPLEMENTATION_REPORT.md`

Its §3 index was **already correct** on `main`; nothing needed porting. Two
additive blocks were appended:

- **§3.0 "Current `main`, as of 2026-09-17"** — the three `main` commits and the
  direct `push` run behind each.
- **§3.0.1 "The phase map, as it now stands"**.

### `docs/STATUS_READING_GUIDE.md`

Rewritten rather than copied. Structure, the authority map, the historical-report
table and the open-decisions table come from the source branch. The CI section is
written from the run history rather than ported, and the guide now carries a
privacy-surface section and a Journey 14 section the original lacked.

---

### Two further defects, found by adversarial verification after the first pass

Neither came from the source branch. Both were already on `main`, both were
missed by my own first reading, and both were found by an adversarial pass over
the drafts rather than by the pass that wrote them.

- **`docs/PHASE3_IMPLEMENTATION_REPORT.md`** described "seven privacy routes
  (two reads from Phase 1 plus five commands and two hold routes)". That
  undercounts twice: the surface is **nine** operations, and there are **three**
  hold routes. The two operations missing from the count are both reads,
  `privacy.listRequestEvents` and `privacy.listHolds`. "Seven" is probably the
  path count — `/privacy/requests` and `/privacy/holds` each carry a GET and a
  POST — which is how a plausible number came to stand for the wrong thing. A
  labelled correction was added; nothing about what was built changed.
- **`docs/DATA_MODEL.md`** said `DRY_RUN` "is the default posture" of
  `RetentionSweep`. It reads as a column default and is not one: `mode` carries
  no `@default` in the schema and no `DEFAULT` in the migration, while the
  adjacent `state` carries both. This is the same claim I had separately repeated
  in my own new text and corrected there — and then left standing three hundred
  lines below **in the same file**. Both instances are now corrected.

---

## 4. False statements deliberately excluded

None of the following was carried forward, in any wording:

| Excluded claim                                      | Why it is false                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "No CI run has ever had `09e66bd` as its head SHA." | Run `35248621822` had exactly that head SHA, on `main`, on `push`. Attempt 1 concluded `failure`. |
| "`main` is red."                                    | `main` is green at `510d75a` by run `35279635031`, 8/8, attempt 1.                                |
| "No later `main` CI run exists."                    | Two later runs exist: `35273492335` and `35279635031`.                                            |
| "Journey 14 is deterministic."                      | Withdrawn in the evidence file's §7A. One failure, four passes.                                   |
| "The branch repairs a broken `main`."               | `main` was not broken when this port began; it was green.                                         |

The guide names the first of these explicitly, so that a reader who encounters
the superseded branch recognises the claim rather than believing it.

Also **not** claimed anywhere in this port: that the App Router cache theory is
confirmed; that Journey 14 is fixed; that the original timeout was caused by the
`AuditLog` cleanup or by a slow runner.

### Two errors of my own, caught before publishing

An adversarial verification pass over my own drafts caught two statements I had
inherited from the source branch and repeated:

- **"`RetentionSweep` defaults to a dry run."** False. The `mode` column has no
  database or Prisma default — only `state` does — and the only
  `retentionSweep.create` in the tree is a negative probe in
  `packages/db/scripts/verify-fresh-database.mjs` that expects rejection. The
  accurate statement is that **nothing creates a `RetentionSweep` row at all**.
- **"The `PRIVACY_ERASURE` step-up policy applies"**, stated of all nine
  operations. It applies to the **five commands**; the four reads carry no
  `stepUp` in `packages/api-contract/src/routes.js`.

Both were corrected in all three affected documents before commit. A second
adversarial pass then found two more defects already on `main` that my first
reading had missed — see §3's closing subsection.

---

## 5. CI evidence used

Every row was read from the GitHub Actions API, not from another document.

| Head commit | Run           | Branch / event          | Result                                                       |
| ----------- | ------------- | ----------------------- | ------------------------------------------------------------ |
| `723f7af`   | `35244793473` | branch / `pull_request` | attempt 2 — `success`, 8/8                                   |
| `09e66bd`   | `35248621822` | `main` / `push`         | attempt 1 — **`failure`**, 2 of 8 red; attempt 2 — `success` |
| `7db5fec`   | `35273492335` | `main` / `push`         | `success`, 8/8, attempt 1                                    |
| `510d75a`   | `35279635031` | `main` / `push`         | `success`, 8/8, attempt 1                                    |

The two jobs red on `09e66bd` attempt 1 were `Policy, lint, contract, tests,
build` and `Browser — event lifecycle`.

---

## 6. What was deliberately not ported

`docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md` (329 lines) was **not**
carried over. It is the implementation record of a reconciliation pass that was
never merged, and this report supersedes it for that purpose. It contains no
false CI claim — its own §81 is careful and correct — but porting a record of
work that did not land would put two competing accounts of the same events in
the tree. The source branch keeps it.

---

## 7. Current phase map

| Phase             | State                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| Phase 3 — Phase 1 | Implemented foundation; **`PARTIAL`** by documented scope and reporting convention |
| Phase 3 — Phase 2 | **`COMPLETE`** against its stated scope, and merged                                |
| Phase 3 — Phase 3 | **`NOT STARTED`** — privacy UI, exports, retention worker, operations              |
| Phase 3 — Phase 4 | **`NOT STARTED`** — Connect mock, sandbox readiness, adversarial verification      |

`NOT STARTED` is checkable rather than asserted:
`docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md` and
`docs/PHASE3_FINAL_VERIFICATION_REPORT.md` are both absent from the tree.

---

## 8. The privacy surface, as counted

Nine operations over seven paths, from
`packages/api-contract/src/route-manifest.js:243-313`:

| Method | Path                                    | Kind            | Step-up required |
| ------ | --------------------------------------- | --------------- | ---------------- |
| GET    | `…/privacy/requests`                    | read            | no               |
| GET    | `…/privacy/requests/:requestId`         | read            | no               |
| GET    | `…/privacy/requests/:requestId/events`  | read (audit)    | no               |
| GET    | `…/privacy/holds`                       | read            | no               |
| POST   | `…/privacy/requests`                    | command (raise) | yes              |
| POST   | `…/privacy/requests/:requestId/confirm` | command         | yes              |
| POST   | `…/privacy/requests/:requestId/cancel`  | command         | yes              |
| POST   | `…/privacy/holds`                       | command         | yes              |
| POST   | `…/privacy/holds/:holdId/release`       | command         | yes              |

All nine require `privacy:redact`, granted to `OWNER` alone. The source branch
said "nine" but itemised eight, having counted two hold routes where there are
three.

---

## 9. Open owner, legal and external decisions

Unchanged by this task. None was resolved here.

- Historic immutable `AuditLog` rows hold personal data and cannot be redacted —
  blocks a truthful "your erasure is complete" statement. Owner + legal.
- Retention durations remain `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`. Legal.
- Jurisdiction and the shape of a legal-hold record. Legal.
- `NotificationOutbox.organizationId` backfill on pre-fix rows. Owner.
- Platform-level erasure for a subject in more than one organisation. Owner.
- The `privacy_request_held_names_its_hold` constraint contradiction. Owner.
- Stripe account and credentials — every `EXTERNAL VERIFICATION PENDING` item.
  Owner, and by the owner's own instruction not before the project is otherwise
  complete.
- Merchant-of-record and negative-balance responsibility. Owner.
- Branch-protection automation has never completed a successful run. Owner.

---

## 10. Validation

| Command                   | Result             |
| ------------------------- | ------------------ |
| `pnpm run format:check`   | PASS               |
| `pnpm run policy:check`   | PASS               |
| `pnpm run secrets:scan`   | PASS               |
| `pnpm run lint`           | PASS               |
| `pnpm run contract:check` | PASS               |
| `pnpm run test`           | PASS — 19/19 tasks |
| `pnpm run build`          | PASS               |
| `pnpm run bundle:scan`    | PASS               |
| `git diff --check`        | clean              |
| `git diff --name-only`    | Markdown only      |

---

## 11. Scope statement

This task changed **Markdown only**. No `.js`, `.mjs`, `.jsx`, `.json`,
`.prisma`, `.sql`, `.yml` or configuration file was touched. No test was added,
removed, weakened or skipped. No database, migration, contract, authorization,
MFA, audit, rate-limit, coverage-threshold or CI control was altered.

---

## 12. Safety statement

No real Stripe, Stripe Connect, payment, webhook, production, legal-compliance,
branch-protection, deployment, pull-request or merge operation was performed or
claimed verified during this documentation-port task. No Stripe credential was
requested, created, read, printed or used. Payment mode remains `MOCK`,
production payment processing remains disabled, and real Stripe and Stripe
Connect remain `EXTERNAL VERIFICATION PENDING`.
