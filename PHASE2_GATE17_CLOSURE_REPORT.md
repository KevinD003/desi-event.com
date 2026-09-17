# Gate 17 closure

**Gate 17 is `MET`.** Both halves. The enforcement half — the one that stayed
`PARTIAL` through two cycles because no identity available to this session could
apply it — was configured by the repository owner on 2026-09-17 and is verified
here against GitHub's own account of what it enforces.

**Phase 3 remains unstarted.** No Phase 3 work has begun, and none begins on the
strength of this document.

---

## 1. Repository and commit ground truth

Measured 2026-09-17T01:14Z.

| Fact                   | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Default branch         | **`main`**                                                       |
| `main` tip             | **`7f9c1c8`**, `protected: true`                                 |
| Merge that produced it | pull request #1, merged 2026-09-16T23:05:46Z by `KevinD003`      |
| Working tree           | clean                                                            |
| Branch for this report | `claude/desi-event-js-stack-gb4uqe`, two commits ahead of `main` |

## 2. Pull-request state

Pull request #1 is `closed` and `merged`. It carried 119 commits — the whole of
the Phase 2 work, both workflows, `scripts/apply-branch-protection.mjs` and
`docs/BRANCH_PROTECTION.md` — from a `main` that stood at `f5c4d6e "Initial
commit"` with no `.github/workflows` directory at all.

## 3. The workflow run on `main`

Run **`35160752451`**, event `push`, on `7f9c1c8`, conclusion **`success`**.

| Job                                        | Conclusion |
| ------------------------------------------ | ---------- |
| `Policy, lint, contract, tests, build`     | success    |
| `Browser — public catalogue`               | success    |
| `Browser — production build`               | success    |
| `Browser — organiser venue maps`           | success    |
| `Browser — event lifecycle`                | success    |
| `Browser — refusals`                       | success    |
| `Browser — accessibility sweep`            | success    |
| `Browser — commerce and operations detail` | success    |

**8 jobs, all `success`. 145 steps: 137 `success`, 8 `skipped`, 0 `failure`.**
The eight skipped steps are the `if: failure()` artefact uploads, one per job.
No required step was skipped.

## 4. CI invariant result

`node scripts/check-ci-invariants.mjs` → exit 0:

```
CI invariants hold: 2 workflow file(s) produce only uploadable artefact names,
and 2 test tasks order their own build.
```

## 5. Protection API responses

Nothing here is inferred from the ruleset list. `GET /rulesets` says what
_exists_; `GET /rules/branches/main` says what is _in force_, and only the
second can close this gate. The difference was not academic — see §9.

```
GET /repos/KevinD003/desi-event.com/rulesets
  200 — 1 ruleset
       id 23572317, name "Phase 2 required checks on main",
       target branch, enforcement active
       (this route returns id, name, target, source_type, source,
        enforcement, node_id, _links and timestamps — and no
        bypass_actors, which is why the single-ruleset route is read too)

GET /repos/KevinD003/desi-event.com/rules/branches/main
  200 — 4 rules in force:
       deletion
       non_fast_forward
       pull_request
       required_status_checks

GET /repos/KevinD003/desi-event.com/rulesets/23572317
  200 — bypass_actors [], current_user_can_bypass "never"

GET /repos/KevinD003/desi-event.com/branches/main
  200 — protection.enabled false,
       required_status_checks.enforcement_level "off", contexts []
```

The last two matter because without them the picture has two holes. A ruleset
with no bypass actors still grants no implicit override to a repository
administrator — `current_user_can_bypass: "never"` says so from GitHub rather
than from documentation. And the eight contexts are required by the ruleset
alone: legacy branch protection is off and contributes nothing, so nothing is
being enforced twice or from a second place.

No token, credential or authentication header appears in this document, and
none was printed in producing it.

## 6. Ruleset identifier

**Repository ruleset `23572317`**, `Phase 2 required checks on main`, target
`branch`, condition `ref_name.include: ["~DEFAULT_BRANCH"]`, `enforcement:
active`, `bypass_actors: []`.

## 7. The eight required check contexts

Read from `GET /rules/branches/main` and compared byte for byte against the
payload in `docs/BRANCH_PROTECTION.md`. **Identical sets, nothing missing and
nothing extra.** The SHA-256 prefix of each string is given because the em dash
is the one character that cannot be verified by eye:

| Context                                    | Em dash | sha256 (first 12) |
| ------------------------------------------ | ------- | ----------------- |
| `Policy, lint, contract, tests, build`     | no      | `551cbb027f1c`    |
| `Browser — public catalogue`               | **yes** | `20fb2987a825`    |
| `Browser — production build`               | **yes** | `cbcb98747b84`    |
| `Browser — organiser venue maps`           | **yes** | `491bc4aac4be`    |
| `Browser — event lifecycle`                | **yes** | `1477fa7e4693`    |
| `Browser — refusals`                       | **yes** | `91e49bf4d4ef`    |
| `Browser — accessibility sweep`            | **yes** | `9c5b413a169d`    |
| `Browser — commerce and operations detail` | **yes** | `c9633abff35d`    |

U+2014 in all seven browser names, correctly absent from the first. A hyphen
there would match no check, and a required check that matches nothing blocks
every merge forever.

## 8. Effective controls

| Control                                  | In force | Source                                       |
| ---------------------------------------- | -------- | -------------------------------------------- |
| Pull request required before merging     | **yes**  | `pull_request` rule                          |
| — approvals required                     | **1**    | `required_approving_review_count`            |
| — stale approvals dismissed on new push  | **yes**  | `dismiss_stale_reviews_on_push`              |
| — conversation resolution required       | **yes**  | `required_review_thread_resolution`          |
| Required status checks                   | **yes**  | `required_status_checks` rule, 8 contexts    |
| Branch must be up to date before merging | **yes**  | `strict_required_status_checks_policy: true` |
| Force pushes blocked                     | **yes**  | `non_fast_forward` rule                      |
| Deletion blocked                         | **yes**  | `deletion` rule                              |
| Broad bypass that would defeat the rule  | **none** | `bypass_actors: []`                          |

Verified by the repository's own committed verifier, run against GitHub's live
response:

```
$ node scripts/apply-branch-protection.mjs --verify-only --rules-file effective-main.json
  yes  pull request required
  yes  required status checks
  yes  force pushes blocked
  yes  deletion blocked
Required contexts: 8
Enforcement complete: YES
exit=0
```

That verifier had already been shown to **fail** — against an empty rule set (8
missing), against seven of eight contexts (1 missing), against a set whose em
dashes were hyphens (7 missing), and against a set with no force-push or
deletion block. A verifier never seen to fail is not a verifier.

## 9. Two defects this verification caught

Recorded because both would have produced a green-looking answer that was wrong,
and neither is visible from `GET /rulesets`.

**The ruleset was protecting the wrong branch.** On first check the ruleset
existed, read `enforcement: active`, and enforced **nothing on `main`** —
`GET /rules/branches/main` returned `0` rules. The cause: the repository's
default branch had been changed to `claude/desi-event-js-stack-gb4uqe`, and the
ruleset targets `~DEFAULT_BRANCH`, so all four rules were in force on the feature
branch while `main` sat unprotected with `protected: false`. Reading the ruleset
list alone would have shown a tick and been false. **The repository owner
resolved it** by restoring `main` as the default branch; this session has never
held the access to do so.

**"Require branches to be up to date" was off.**
`strict_required_status_checks_policy` read `false` on first check, against a
document that requires it. Without it, two pull requests that each pass alone can
merge into a broken `main`, because each was tested against a state that no
longer exists by the time the second lands. **The repository owner set it**;
it now reads `true`.

Both remediations were the owner's, made through the GitHub UI. The ruleset's
own timestamps corroborate the sequence and are worth stating rather than
leaving to inference: `created_at 2026-09-17T01:02:05Z`,
`updated_at 2026-09-17T01:07:24Z`. The verification time this document quotes,
`01:07Z`, is therefore the same minute as the last modification — the reading
was taken immediately after the final change, not before it, and nothing has
modified the ruleset since.

## 10. Gate 17 verdict

| Half                         | Verdict                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| Workflow exists and is green | **MET** — run `35160752451` on `main`, 8/8 jobs `success`             |
| Enforcement on `main`        | **MET** — ruleset `23572317`, 4 rules in force, 8 contexts, no bypass |
| **Gate 17 overall**          | **MET**                                                               |

## 11. Phase 2 verdict

**All twenty gates are `MET`.** Gate 17 was the last outstanding one; gates 1–16
and 18–20 were `MET` before this cycle and are unchanged by it. Nothing in this
cycle altered application code.

The exit rule's remaining conditions are the self-referential pair: this
documentation must be pushed, and the run on the commit carrying it must pass.
Neither can be asserted by the file that creates them — the same property this
project has recorded before as "no file can contain its own commit hash." They
are recorded in §14 after the fact.

## 12. Phase 3

**UNSTARTED.** No Phase 3 work has begun. No product feature was added, and no
application code was changed, in the cycle that closed this gate.

## 13. Remaining limitations

These are unchanged by Gate 17 closing, and none of them is a gate.

1. **Stripe is mock-only.** No credentials have ever been supplied, none were
   requested as a blocker, and every real Stripe operation remains
   **EXTERNAL VERIFICATION PENDING**. Production payments refuse the boot.
2. **`apps/api` branch coverage sits `+0.83` points over its 75% floor** —
   75.83%, the thinnest margin in the repository. One new uncovered branch can
   turn CI red.
3. **`test:e2e` still declares `dependsOn: ["^build"]` only**, so the class of
   race fixed in `79ff795` for `test` and `test:coverage` is structurally
   possible there. No failure has been traced to it.
4. **`apps/web` and `packages/ui` do not use the shared coverage helper**, so
   their figures are reported but enforce nothing; `packages/db` reports no
   coverage deliberately.
5. **The `Apply branch protection` workflow has never succeeded.** Runs
   `35160860535`, `35160953245` and `35161239974` all failed at
   `Mint a short-lived App token` with `Invalid keyData` /
   `ERR_OSSL_ASN1_NOT_ENOUGH_DATA` — a malformed PEM in `APP_PRIVATE_KEY`, not a
   permission or proxy problem. The gate was closed through the GitHub UI
   instead. The workflow and its preflight are left in place as the
   reproducible route; the secret needs re-pasting before it will work.

6. **The live ruleset has drifted from the approved payload in two fields that
   are not contexts.** `docs/BRANCH_PROTECTION.md` carries
   `automatic_copilot_code_review_enabled: false`, which the live rule does not
   report; the live rule carries
   `require_extra_approval_for_unattributed_changes: true`, which the document
   does not contain. GitHub added the second platform-side and defaulted it on.
   The byte-for-byte comparison in §7 is of the **eight check contexts**, and
   that comparison holds exactly; it is not a claim that every field of the
   payload matches. Both drifted fields tighten rather than loosen, so neither
   is a weakening, but the document and the live rule are no longer identical
   and this record should not imply they are.

7. **No pull request can currently merge into `main`, including this one.** The
   ruleset requires one approving review; `bypass_actors` is empty and
   `current_user_can_bypass` is `"never"`; the repository has exactly one
   collaborator, `KevinD003`, `role_name: admin`; and this pull request's author
   is `KevinD003`. GitHub does not permit the author of a pull request to
   approve it, so the required approval cannot be supplied by anybody, and there
   is no override path. This is the protection working exactly as written — it
   is recorded here because a rule that its only participant cannot satisfy is a
   fact about the repository, not a defect in the rule, and whoever reads this
   later should not have to rediscover it. Resolving it is a repository-owner
   decision: a second collaborator with write access, or a deliberate and
   temporary change to the review requirement. **No such change was made by this
   session.**

8. **A second check suite sits on the head commit and has never reported.**
   `GET /commits/<head>/check-suites` returns two: the `github-actions` suite
   with the eight successful runs, and suite `95247531653` from app `1236702`
   ("Claude"), `status: queued`, `conclusion: null`, zero check runs, created
   `2026-09-17T01:16:26Z` and not updated since. It contributes no required
   context and so blocks nothing, but "eight checks on this commit" is true of
   check _runs_ and not of check _suites_.

## 14. Reproducible verification

Every figure above comes from one of these. Nothing is transcribed from memory.

```bash
# What exists, and what is actually in force. They are different questions.
gh api /repos/KevinD003/desi-event.com/rulesets
gh api /repos/KevinD003/desi-event.com/rules/branches/main
gh api /repos/KevinD003/desi-event.com/rulesets/23572317

# The branch the ruleset actually protects depends on this.
gh api /repos/KevinD003/desi-event.com --jq .default_branch

# The run on main, and its job conclusions.
gh api /repos/KevinD003/desi-event.com/actions/runs/35160752451
gh api /repos/KevinD003/desi-event.com/actions/runs/35160752451/jobs

# The committed verifier, against GitHub's live response.
gh api /repos/KevinD003/desi-event.com/rules/branches/main > effective-main.json
node scripts/apply-branch-protection.mjs --verify-only --rules-file effective-main.json

# The workflow invariants.
node scripts/check-ci-invariants.mjs
```

### Recorded after the fact

A file cannot contain its own hash, so these are written by the commit after
the one they describe.

| Fact                              | Value                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Commit introducing this report    | `1432b8b`                                                       |
| Run on it                         | `35169936261` — 8 jobs, all `success`                           |
| Commit correcting it under review | `29bcdc4` — see §15                                             |
| Run on it                         | `35173475877` — 8 jobs, all `success`                           |
| Merged to `main` as               | `2801184`, pull request #2, 2026-09-17T02:37:16Z by `KevinD003` |
| Run on the merge commit           | `35175112378` — **`failure`**, 7 of 8 jobs `success`; see §16   |

**How it merged, recorded because the protection blocked it.** Limitation 7 in
§13 is not hypothetical. Pull request #2 could not be approved by anybody, so
the repository owner set the ruleset's `required_approving_review_count` from
`1` to `0` at `02:30:43Z`, merged at `02:37:16Z`, and restored it to `1` at
`02:41:29Z` — a window of about eleven minutes.

The live ruleset was read before the change and after the restoration and the
two were compared field by field. The only difference is `updated_at`, which
GitHub sets itself; `enforcement`, `bypass_actors`, `strict`, all eight
contexts, dismiss-stale and conversation-resolution are byte-identical. The
`required_status_checks` rule stayed in force for the whole window, so the merge
was still gated on eight green checks — what was relaxed was the review
requirement alone, and only that.

## 16. The run on `main` failed, and what that proved

`35175112378`, the `push` run on merge commit `2801184`, ended `failure`. Seven
of its eight jobs passed; `Browser — accessibility sweep` did not.

**It is not a content regression.** `2801184` and `29bcdc4` have the same tree —
`06eb57dca04b94f287614c33a5d8ebe98be41d89` both — so the code that failed here
is byte-for-byte the code that passed as `35173475877` minutes earlier.

**It is not a flake either, and calling it one would have been wrong.** The
failing case is `the public event page is clean at phone`, and axe reported four
`color-contrast` violations with foreground colours of `#ebd9c2`, `#dfd5cc` and
`#e0dbcb` — pale creams, on elements whose classes are `text-marigold-900`,
`text-indigo-night-900` and `text-slate-700`. A badge marked
`bg-indigo-night-100` measured its background as `#fbf3e4`; that token is
`oklch(0.924 0.035 286.5)`, a pale blue, and cannot be a cream. Axe was reading
a page whose utilities had not been applied, and falling through to the nearest
painted ancestor for a background.

This exact failure had happened once before, on run `35157268740`, and the fix
then — waiting for the `h1` to be visible — was the wrong wait. An element
renders and paints before the stylesheet that colours it arrives; visibility
says nothing about whether its utilities have been parsed. Tailwind v4 emits the
`@theme` custom properties and the utilities built from them into one
stylesheet, and on a cold Turbopack compile that file can land after the markup.

Fixed at the root in `apps/web/e2e/accessibility-sweep.spec.js`: `scan()` now
awaits a `styled()` gate that waits for the theme custom properties to resolve
on `:root` before axe runs, so all thirteen scans in the file are ordered
against the stylesheet rather than each remembering to be. **No rule is
disabled, no test is skipped, and no threshold is moved.** The gate cannot mask
a violation — it waits for the stylesheet and then scans the finished page, and
a stylesheet that never applies now fails as a timeout rather than as a contrast
defect that does not exist.

The gate was verified in a real Chromium against the predicate text extracted
from the spec file itself: it blocks on an unstyled page, blocks on a partially
applied theme, and resolves 1009 ms after a late stylesheet is injected. The
full sweep needs PostgreSQL, Redis and a Next server and could not be run here;
CI is the first place the whole case runs.

### What the failure proved

Every green run skips the eight `if: failure()` artefact uploads, so no green
run has ever exercised them. This report and its predecessors therefore refused
to claim that artefact uploading works end to end. **This failure ran that path,
and it succeeded:**

```
Artifact playwright-accessibility sweep has been successfully uploaded!
Final size is 118109 bytes. Artifact ID is 10478283065
```

That also settles the artefact-name defect fixed earlier in this cycle. The name
resolved to `playwright-accessibility sweep` — from `matrix.suite.name` — which
contains a space and no colon. The earlier `matrix.suite.script` would have
produced `playwright-test:e2e:sweep`, and `actions/upload-artifact` rejects a
colon outright, discarding the very report that explains the failure. The upload
path is now proven by execution rather than by reading, on the first occasion it
has ever been reached.

## 15. Defects this review caught in the record itself

Found by review of this pull request, before it merged, and fixed in it. None
is a defect in the protection; all four are defects in the account of it, which
is the thing this document exists to be trusted on.

**The two modified documents asserted gate 17 both ways at once.** Two kinds of
defect are tangled here and the difference is worth keeping. What this pull
request _created_: it flipped the headline, the gate table and the traceability
rows to `MET` and `CONFIGURED`, and left the prose explaining the opposite
untouched — so a `**CONFIGURED**` row now sat directly above the sentence "What
keeps gate 17 `PARTIAL` is ... nothing on GitHub _requires_ those checks". What
it _inherited_: some of the contradicting prose was already on `main` at
`7f9c1c8` and is untouched by this diff, including the traceability preamble
below. Inherited or created, a reader cannot tell which sentence to believe, so
both are fixed here. `PHASE2_STATUS.md` still carried "Nineteen met, one
partial", a section headed "Why gate 17 is `PARTIAL` and not `MET`", the
response `GET /rulesets → 200 []`, and a table row reading "Externally verified
absent: no ruleset, no classic protection" — all in the present tense, eight
lines below a row citing the ruleset that disproves them.
`PHASE2_REQUIREMENTS_TRACEABILITY.md` opened its CI section with "The workflow
exists and has never run" above nine rows citing the runs that tested them.

That is worse than an omission. `PHASE2_STATUS.md` says of itself that where it
disagrees with any other file in this repository it is right and the other is
historical, so a file that disagrees with itself has no readable answer at all.

Fixed by marking both sections `HISTORICAL STATUS — SUPERSEDED` — the
convention the file already states for itself — with a dated note saying which
quoted API responses no longer hold. **Nothing was deleted and no tally was
rewritten**: the superseded text stands exactly as written, and the gate tally
now records every prior count rather than replacing them.

**Branch protection sat in a "Still not built" table.** Removed, with a line
recording when and why it left.

**A protection fact was filed under a commit it is not a fact about.** The
traceability verification table is headed "Result at `910538b`"; the branch
protection row is a reading taken on 2026-09-17. This is a looseness the table
already had — the row it replaced said "**still absent**", which was equally a
repository-state fact rather than a command result — so it is a tightening
rather than a fresh defect. The column is now "Result", and the two rows that
are not commands at `910538b` carry their own provenance.

**This report misdescribed its own branch.** §1 said "one commit ahead of
`main`", measured at 01:14Z when `fd1c3de` was the tip. At the commit that
carries the file the branch is two ahead. Corrected.
