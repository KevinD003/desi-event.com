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

| Fact                   | Value                                                           |
| ---------------------- | --------------------------------------------------------------- |
| Default branch         | **`main`**                                                      |
| `main` tip             | **`7f9c1c8`**, `protected: true`                                |
| Merge that produced it | pull request #1, merged 2026-09-16T23:05:46Z by `KevinD003`     |
| Working tree           | clean                                                           |
| Branch for this report | `claude/desi-event-js-stack-gb4uqe`, one commit ahead of `main` |

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
       target branch, enforcement active, bypass_actors []

GET /repos/KevinD003/desi-event.com/rules/branches/main
  200 — 4 rules in force:
       deletion
       non_fast_forward
       pull_request
       required_status_checks
```

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
list alone would have shown a tick and been false. Resolved by restoring `main`
as the default branch.

**"Require branches to be up to date" was off.**
`strict_required_status_checks_policy` read `false` on first check, against a
document that requires it. Without it, two pull requests that each pass alone can
merge into a broken `main`, because each was tested against a state that no
longer exists by the time the second lands. Now `true`.

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

The commit carrying this report, and the run that tested it, are appended here
once they exist — a file cannot contain its own hash.

- Commit introducing this report: `<recorded in the follow-up commit>`
- Run on that commit: `<recorded in the follow-up commit>`
