# Status Reconciliation Implementation Report

Date: 2026-09-17. Documentation only.

---

## 1. Purpose and non-goals

### Purpose

PR #5 merged Phase 3's Phase 1 and Phase 2 into `main`. Several documents that a
reviewer would open first still described the repository as it was before that
merge. This pass makes merged `main` navigable and accurate without rewriting
history.

### Non-goals, all observed

No application behaviour was changed. Specifically, this pass did **not**:

- implement Phase 3's Phase 3 or Phase 4;
- touch Stripe, Stripe Connect, retention workflows, privacy UI, exports,
  production payments or any product feature;
- change any schema, migration, workflow, CI configuration or security-runtime
  file;
- make any external call;
- resolve any owner or legal decision, or reword anything to imply one was
  resolved;
- claim legal, PCI or production readiness;
- amend, rebase, force-push, rewrite history, merge, open a pull request, or
  alter GitHub rulesets or branch protection.

---

## 2. Starting state

| Fact                                       | Value                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Starting branch                            | `claude/desi-event-js-stack-gb4uqe`                                         |
| Starting SHA                               | `723f7afe16766e975d64b070723160e418b789df`                                  |
| `origin/main` SHA                          | `09e66bde09b4c712c741c5cb87682b836af2608b`                                  |
| Working tree at start                      | **clean** — `git status --short` printed nothing                            |
| Did the starting tree match merged `main`? | **Yes, exactly.** Both trees are `8b53048d643b4c1ef7cdbd8810cb01a0b6041f95` |
| New branch                                 | `claude/docs-post-merge-status-reconciliation`, created from `origin/main`  |

The starting branch was not reused: it contains the merged Phase 3 commits, and
new work on it would stack on merged history. A fresh branch was cut from
`origin/main` before any file was read for editing.

---

## 3. Merge verification

Every fact below was re-derived from the repository and the GitHub API rather
than taken from the brief.

| Question                                        | Answer                                                       | How                                  |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Is `09e66bd` on `main`?                         | Yes, it **is** `origin/main`                                 | `git rev-parse origin/main`          |
| Its parents                                     | `d1e0dd2` and `723f7af`                                      | `git log -1 --format=%P 09e66bd`     |
| Who merged it                                   | `KWinOverAnything <kendavra@gmail.com>`, committer `GitHub`  | `git log -1 --format='%an <%ae>'`    |
| When                                            | `2026-09-17T11:46:06-05:00` = `16:46:06Z`                    | `git log -1 --format=%cI`            |
| Is `723f7af` an ancestor of the merge?          | Yes                                                          | `git merge-base --is-ancestor`       |
| Is `d1e0dd2` an ancestor of `723f7af`?          | Yes — so the merge is a content fast-forward                 | `git merge-base --is-ancestor`       |
| Commits `main` gained                           | 11                                                           | `git log --oneline d1e0dd2..09e66bd` |
| Does `09e66bd` contain the Phase 3–2 files?     | Yes — the branch tree is the merge tree                      | tree comparison below                |
| Does run `35244793473` correspond to `723f7af`? | Yes — `head_sha` is exactly `723f7af`                        | GitHub API                           |
| Did it succeed?                                 | `completed` / `success`, **attempt 2**                       | GitHub API                           |
| Did all eight jobs succeed?                     | Yes — 8 of 8 on the latest attempt                           | GitHub API, `filter=latest`          |
| Did the corrected skipped-test gate run?        | Yes — step 17 `Refuse an undeclared skipped test`: `success` | GitHub API job steps                 |

### 3.1 What is proven, and what is inferred

**Proven by measurement.** `git rev-parse 723f7af^{tree}` and
`git rev-parse 09e66bd^{tree}` both return
`8b53048d643b4c1ef7cdbd8810cb01a0b6041f95`, and `git diff 723f7af 09e66bd` is
empty in both directions. The merge changed no file.

**Therefore proven.** The content on `main` is byte-identical to the content that
ran green in `35244793473`.

**Not proven, and not claimed.** That CI executed with `09e66bd` as its head SHA.
It did not. No run has. The run was a `pull_request` event on `723f7af`.

This distinction is preserved wherever the result is quoted. "CI passed on
`main`" would be false. "CI passed on content identical to `main`" is true, and
is what the documents now say.

### 3.2 Attempt 1 of the same run

Attempt 1 started **no jobs at all**. All eight were refused by GitHub with "The
job was not started because recent account payments have failed or your spending
limit needs to be increased", each reporting zero steps and completing seconds
after starting. No code differed between attempts; the repository was made public
and the jobs then ran. Recorded because a reader seeing `run_attempt: 2` deserves
to know the first attempt failed for a reason that was never in the code.

### 3.3 Metrics, verified from the run's own log

Read from the verify job's log for run `35244793473`, job `105291625503`:

| Metric              | Value                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Skipped-test gate   | `4889 case(s) ran across 16 report(s); 0 skipped, 0 allow-listed, 0 undeclared` |
| Test summaries      | all 19 task summaries read `passed == total`                                    |
| `apps/api` coverage | statements 87.28, **branches 76.06**, functions 92.28, lines 89.98              |
| Fresh database      | `96/96 checks passed.`                                                          |
| Upgrade database    | `24/24 checks passed.`                                                          |
| Payment kill switch | step 26 `Production payments are unreachable`: `success`                        |

> **Correction.** The brief for this task stated `apps/api` branch coverage as
> **76.09**. The CI log for the run it cites reads **76.06**. 76.09 was a local
> full-battery measurement taken during development; 76.06 is what CI measured.
> Both clear the floor of 75. The CI figure is used throughout because it is the
> one that can be reproduced from the run cited.

---

## 4. Documents inventoried

Inventory taken with:

```bash
find . -maxdepth 3 -type f \
  \( -iname '*PHASE*.md' -o -iname '*STATUS*.md' -o -iname '*REPORT*.md' \
     -o -iname '*CLOSURE*.md' -o -iname '*VERIFICATION*.md' \
     -o -iname '*TRACEABILITY*.md' -o -iname '*IMPLEMENTATION*.md' \
     -o -iname '*PLAN*.md' \) \
  -not -path './node_modules/*' -not -path './.git/*' | sort
```

Thirty-five status-bearing documents were read in full across eight parallel
readers: thirteen root-level documents (twelve phase reports plus `README.md`),
four Phase 3 documents under `docs/`, and eighteen further reference and
operational documents under `docs/`.

Eight further files were **not** read as status sources because they are not
status documents: `docs/adr/0001`–`0004`, `docs/PROVIDERS.md`,
`docs/language-policy.md`, `docs/language-exceptions.json` and `CONTRIBUTING.md`.
This is stated so the coverage claim is not read as "every markdown file".

---

## 5. Authority hierarchy

Recorded in full in `docs/STATUS_READING_GUIDE.md` under **Authority map**. In
summary: `PHASE1_IMPLEMENTATION_REPORT.md` governs project Phase 1;
`PHASE2_STATUS.md` governs Phase 2 and says so itself; the two Phase 3 sub-phase
reports govern their own sub-phases; `docs/PHASE3_IMPLEMENTATION_REPORT.md` is
the index across them.

---

## 6. Contradictions found

| #   | Contradiction                                                                                                                                                    | Resolution                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3 table said Phase 2 `not started`; §3A of the same file said COMPLETE                                                   | Corrected the row; added §3.0                               |
| 2   | `PHASE2_STATUS.md` line 3 said "Phase 3 has not been started"                                                                                                    | Labelled current-status update                              |
| 3   | `PHASE2_STATUS.md` §12.3 presented Phase 3 prerequisites as pending                                                                                              | Labelled `HISTORICAL STATUS — SUPERSEDED`                   |
| 4   | `docs/PRIVACY_AND_RETENTION.md` §2 said the redaction engine is `NOT IMPLEMENTED`, while the same file's "Phase 2: what is now implemented" section describes it | Labelled superseded in part, with the still-true rows named |
| 5   | `docs/DATA_MODEL.md` said the privacy surface is "two read routes"                                                                                               | Updated to nine operations; still-true parts restated       |
| 6   | `PHASE2_STATUS.md` §5.1 and §6.2 say gate 14 is `PARTIAL`; its own §5 table says `MET`                                                                           | **Left unchanged** — see §9                                 |

---

## 7. Exact changes made

| File                                                  | Change                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PHASE3_IMPLEMENTATION_REPORT.md`                | Phase 2 row corrected to `0508da1` + `723f7af`, run `35244793473`, **COMPLETE**; new §3.0 recording the merge and what CI proves |
| `PHASE2_STATUS.md`                                    | Dated current-status update at the header; `HISTORICAL STATUS` marker on §12.3                                                   |
| `docs/PRIVACY_AND_RETENTION.md`                       | `HISTORICAL STATUS — SUPERSEDED IN PART` notice above §2, naming the three rows still true                                       |
| `docs/DATA_MODEL.md`                                  | Dated update correcting "two read routes" and restating what remains true                                                        |
| `docs/STATUS_READING_GUIDE.md`                        | **New.** Navigation only                                                                                                         |
| `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md` | **New.** This file                                                                                                               |

No table, verdict or figure in any historical report was deleted or rewritten.

---

## 8. Stale candidates left unchanged, and why

1. **`PHASE2_STATUS.md` gate 14 self-contradiction (§5.1/§6.2 vs §5).** Fixing it
   requires deciding whether gate 14 is `MET` or `PARTIAL`. That is a Phase 2
   judgement about accessibility coverage, not a navigation problem, and guessing
   would either overstate or understate a gate. Recorded here and in the reading
   guide instead.
2. **Pull request #5's body**, which names `62a71e9` as head and cites the
   pre-merge run. It is a merged external GitHub artefact and editing it was
   outside this task's authorisation.
3. **The migration comment** at
   `packages/db/prisma/migrations/20260917060000_…/migration.sql:555`. Editing a
   migration breaks `migrate deploy` checksums. Already recorded in
   `docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` §11.8.
4. **Reference documents** — `README.md`, `docs/architecture.md`, `docs/api.md`,
   `docs/development.md`, `docs/BRANCH_PROTECTION.md`. Each is stale in places,
   none presents itself as a phase status record, and the reading guide names
   them as reference-only rather than editing five files a reviewer should not be
   consulting for status anyway.
5. **Every superseded Phase 1 and Phase 2 cycle report.** They are evidence. The
   reading guide says which to skip and why; rewriting them would destroy the
   record this repository deliberately keeps.

---

## 9. Open decisions and prerequisites

Tabulated in `docs/STATUS_READING_GUIDE.md` under **Open decisions and external
prerequisites**, with a column for what each actually blocks. The distinctions
that matter:

- **Historic audit PII** blocks a truthful "erasure is complete" statement to a
  data subject. It does not block Phase 3–Phase 3 code.
- **Retention durations** block real deletion and the sweeper's design. They do
  not block privacy UI work.
- **Stripe credentials** block external verification. They do not block
  mock-mode documentation or code.
- **Merchant-of-record** blocks production Connect architecture, not preparatory
  mock work.
- **The `privacy_request_held_names_its_hold` mismatch** blocks changing that
  constraint. It does not block privacy UI.

Nothing merged in `09e66bd` resolved any of them, and nothing in this pass
implies otherwise.

---

## 10. Correction and supersession count

Measured, not estimated. Method:

```bash
grep -rnE '^(#{1,6} .*(Correction|HISTORICAL STATUS|SUPERSEDED|Current-status update))|^> \*\*(Correction|HISTORICAL STATUS|Current-status update)' \
  --include='*.md' . --exclude-dir=node_modules --exclude-dir=.git
```

| Measurement               | Markers | Files |
| ------------------------- | ------- | ----- |
| Baseline on `origin/main` | 11      | 11    |
| After this pass           | 15      | 12    |

**At least 11 explicit correction or supersession markers existed on merged
`main` before this pass, across 11 files, identified by the documented search
method above. This is not a claim that 11 is the total number of inconsistencies
ever recorded in this repository.** The method counts structural markers —
headings and blockquote notices in the established house style. It does not count
a correction written as ordinary prose, and a full-content read of the same
documents surfaces substantially more corrected claims than 11. That larger
figure is not stated here because it is not reproducible by a command.

This pass added four markers.

---

## 11. Validation

All commands run on branch `claude/docs-post-merge-status-reconciliation` with
PostgreSQL and Redis running.

| Command                           | Result                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| `git diff --check`                | **clean**                                                           |
| `pnpm run format:check`           | **PASS**                                                            |
| `pnpm run policy:check`           | **PASS**                                                            |
| `pnpm run secrets:scan`           | **PASS**                                                            |
| `pnpm run lint`                   | **PASS**                                                            |
| `pnpm run contract:check`         | **PASS**                                                            |
| `pnpm run test`                   | **PASS** — 19 of 19 tasks                                           |
| `scripts/check-skipped-tests.mjs` | **PASS** — `4889 case(s) … 0 skipped, 0 allow-listed, 0 undeclared` |
| `pnpm run build`                  | **PASS** — 3 of 3 tasks                                             |

Scope guard:

```bash
git status --short | grep -vE '\.md$'   # printed nothing — markdown only
```

No product, provider, payment, schema, migration, CI or security-runtime file
changed.

---

## 12. Limitations

- No application code changed.
- No database migration changed.
- No real payment operation occurred.
- No Stripe or Stripe Connect call occurred.
- No production system was accessed or verified.
- No legal or compliance conclusion is made or implied.
- Repository evidence and the accessible GitHub API are the boundary of this
  report. Account billing state could not be read — that endpoint is not
  available to this session — so §3.2 records what the job annotations said, not
  what the billing page shows.
- This report describes a documentation pass. It does not supersede any phase
  implementation report and is not evidence for any phase's completion.

---

## 13. Final requirement matrix

| Requirement                                           | Status      | Evidence                                                               |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| Start from merged `origin/main`                       | **MET**     | Branch cut from `09e66bd`; §2                                          |
| Do not reuse the merged feature branch                | **MET**     | New branch `claude/docs-post-merge-status-reconciliation`              |
| Record starting state                                 | **MET**     | §2                                                                     |
| Verify the merge rather than assume it                | **MET**     | §3, every row derived from a command                                   |
| Distinguish CI-on-branch from proof about `main`      | **MET**     | §3.1; `docs/PHASE3_IMPLEMENTATION_REPORT.md` §3.0                      |
| Inventory status-bearing documents                    | **MET**     | §4 — 35 read, 8 excluded and named                                     |
| Build an authority hierarchy                          | **MET**     | `docs/STATUS_READING_GUIDE.md` **Authority map**                       |
| Correct the cross-phase index                         | **MET**     | §7 row 1                                                               |
| Preserve history; label rather than rewrite           | **MET**     | §7 — no verdict, table or figure deleted                               |
| Separate open decisions by what each blocks           | **MET**     | §9 and the reading guide                                               |
| Measure the correction count rather than assert it    | **MET**     | §10, with the method and its limits stated                             |
| Do not start Phase 3–Phase 3 or Phase 4               | **MET**     | §1 non-goals; scope guard in §11                                       |
| Documentation-only change                             | **MET**     | §11 scope guard — markdown only                                        |
| Validation run and reported honestly                  | **MET**     | §11 — all nine checks passed                                           |
| `docs/STATUS_READING_GUIDE.md` created                | **MET**     | §7                                                                     |
| `docs/STATUS_RECONCILIATION_IMPLEMENTATION_REPORT.md` | **MET**     | this file                                                              |
| Gate 14 contradiction resolved                        | **NOT MET** | Deliberately — §8 item 1. It needs a Phase 2 judgement, not navigation |
| PR #5 body corrected                                  | **NOT MET** | Deliberately — §8 item 2. Outside this task's authorisation            |

---

## 14. Safety statement

No real Stripe, Stripe Connect, payment, webhook, production, legal-compliance,
branch-protection, or deployment operation was performed or claimed verified by
this documentation-only change.
