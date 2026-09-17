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

## 16. The run on `main` failed, and the first two diagnoses were wrong

`35175112378`, the `push` run on merge commit `2801184`, ended `failure`. Seven
of its eight jobs passed; `Browser — accessibility sweep` did not. It failed
again on `35176281573`. Recorded in full because the failure is less
interesting than how long it took to read correctly.

**It was never a content regression.** `2801184` and `29bcdc4` have the same
tree — `06eb57dca04b94f287614c33a5d8ebe98be41d89` both — so the code that failed
is byte-for-byte the code that had passed minutes earlier.

**The cause is an entrance animation.** The site animates through
`apps/web/src/components/motion.jsx`, which wraps content in Framer Motion
elements that begin at `opacity: 0` and fade to `1`. Axe reads
`getComputedStyle().color` and blends it through ancestor opacity, so a scan
landing mid-fade measures text at a fraction of its real colour. The
`<FadeIn className="mt-6">` at `apps/web/src/app/events/[slug]/page.jsx:255` is
the specific ancestor; a dump of the computed style chain shows it plainly:

```
H1        color=lab(15.1 21.2 -35.7)  opacity=1
DIV.mt-6  color=lab(7.79 1.82 -15.1)  opacity=0
ARTICLE   opacity=1
BODY      opacity=1
```

`RevealOnScroll` compounds it with `whileInView`: four sections at 852, 1266,
1496 and 1674 pixels stay at `opacity: 0` until scrolled to, which is why
`#schedule-heading` was among the reported nodes.

**Two fixes were pushed before this one and neither worked.** Run
`35157268740` was met by waiting for the `h1` to be visible, which fails because
an element is visible at `opacity: 0`. Run `35175112378` was met by waiting for
the theme custom properties to resolve on `:root`, which fails because the
stylesheet was never the problem: the tokens were present and correct
throughout, `indigo900` reading `lab(15.106% 21.1634 -35.6623)` with 63 rules
parsed and fonts loaded. That second attempt only added delay, which moved the
failure from the phone viewport to the tablet one and looked briefly like
progress.

**The evidence that should have settled it was in the first log.** Backgrounds
resolved correctly while foregrounds came out pale — `bg-marigold-100` at
`#fff5dc`, exactly right, with `text-marigold-900` at `#efdfc9`. An unapplied
text utility inherits the body's dark ink and produces _high_ contrast, not a
ratio of 1.2. Only blending can pull a foreground toward its background.

**Both wrong diagnoses trace to one bad command.** A search for `opacity` across
`apps/web/src` was run as
`grep -rnE "opacity|animate|..." --include=*.js --include=*.css`. Eighty-seven
of the files in that tree are `.jsx`. The search read no component at all,
returned nothing, and the empty result was treated as evidence that the
application contains no animations. It contains one on every page.

**Fixed** in `apps/web/e2e/accessibility-sweep.spec.js`: `scan()` awaits a
`settled()` gate that scrolls each unsettled `[data-motion]` element into view
and repeats until none remain, then returns to the top. A single sweep of the
page is not enough — the first pass runs before hydration has attached the
IntersectionObservers, so it triggers nothing, and once the page scrolls back
the sections below the fold never re-enter view. `viewport.once` means an
element that has animated stays animated, so the loop converges. `motion.jsx`
documents `data-motion` as load-bearing rather than decorative, so it is a
contract a test may rely on. **No rule is disabled, no test is skipped and no
threshold is moved**; the gate scans the resting state, which is the state a
reader actually reads.

**Verified by reproduction rather than by inference**, which is the difference
between this attempt and the two before it. PostgreSQL 16 and Redis were started
locally, migrations applied to a disposable database, and the suite run against
the real stack. The failure reproduced exactly — tablet, 12 passed, 1 failed —
and after the fix:

```
$ pnpm run test:e2e:sweep
  42 passed (49.7s)
```

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
