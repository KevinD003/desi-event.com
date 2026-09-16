# Branch protection

**Status: not verified from inside this repository.**

Branch protection is a setting on GitHub, not a file in the tree. Nothing here
can observe it, and this document does not claim it is enabled. It says what
should be configured and how to check, so that the claim — when somebody makes
it — is one they made after looking.

To see the current state:

```
gh api repos/:owner/:repo/branches/main/protection
```

A `404` means no protection rule exists. Anything else is the rule as it stands,
and it should match what follows.

---

## Measured state

Checked against the GitHub API on **2026-09-16**, from inside the session that
wrote this cycle, and recorded here because this document says the answer
belongs where it is checked.

| Thing                       | State                                   |
| --------------------------- | --------------------------------------- |
| Workflow registered         | **yes** — `CI`, workflow id `359635192` |
| Runs of it                  | **yes** — twelve, on pull request #1    |
| Branch protection on `main` | **none**                                |
| Repository rulesets         | **none** — `GET /rulesets` returns `[]` |

So the first half of gate 17 is now satisfied and the second half is not: the
workflow exists, has executed against real commits, and its jobs pass — and
nothing yet _requires_ them before a merge.

### Why it could not be configured from here, exactly

Two different refusals, and they are worth telling apart because only one of
them is about permissions.

**Reading classic protection** — the GitHub App installation token is not
granted `administration`:

```
GET /repos/KevinD003/desi-event.com/branches/main/protection
→ 403 {"message": "Resource not accessible by integration"}
```

**Writing anything** — refused before it reaches GitHub, by the proxy this
session's outbound traffic goes through:

```
PUT  /repos/KevinD003/desi-event.com/branches/main/protection
POST /repos/KevinD003/desi-event.com/rulesets
→ 403 {"message": "Write access to this GitHub API path is not permitted through this proxy."}
```

The repository token reports `{"admin": true, "maintain": true, "push": true}`
on this repository, so the second refusal is **not** a missing GitHub
permission and not a plan limitation. It is the execution environment declining
to let an agent change a repository's protection settings, which is a defensible
thing for it to decline. Either way the effect is the same and the honest
statement is the same: **gate 17 is `PARTIAL` — external configuration
required.**

---

## What the owner has to do, precisely

Either of the two forms below is sufficient. A ruleset is the newer mechanism
and the one GitHub is moving toward; classic protection is what the older
documentation describes. Do not apply both to the same branch.

### Option A — a repository ruleset (recommended)

Save this as `ruleset.json` and apply it with a token that can administer the
repository:

```bash
gh api --method POST /repos/KevinD003/desi-event.com/rulesets \
  --input ruleset.json
```

```json
{
  "name": "Phase 2 required checks on main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "automatic_copilot_code_review_enabled": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Policy, lint, contract, tests, build" },
          { "context": "Browser — public catalogue" },
          { "context": "Browser — production build" },
          { "context": "Browser — organiser venue maps" },
          { "context": "Browser — event lifecycle" },
          { "context": "Browser — refusals" },
          { "context": "Browser — accessibility sweep" },
          { "context": "Browser — commerce and operations detail" }
        ]
      }
    }
  ]
}
```

The eight context strings are the job names GitHub itself reported for run
**`35117010156`**, read back from `GET /actions/runs/<id>/jobs` rather than
guessed from the workflow file. That run **succeeded**, which matters: an
earlier revision of this line sourced the same eight names from run
`35106712692`, and that run failed. The strings were right — compared byte for
byte, the two runs' job-name sets are identical, em dashes included — but a
required check must be named from a run that passed, or the list is only as
trustworthy as the run it came from. The dash in the browser jobs is an em dash (U+2014),
because that is what the workflow's `name:` produces; a hyphen there silently
matches nothing and a required check that matches nothing blocks every merge
forever.

### Option B — classic branch protection

```bash
gh api --method PUT /repos/KevinD003/desi-event.com/branches/main/protection \
  --input classic-protection.json
```

with the same eight contexts under
`required_status_checks.contexts`, `"strict": true`, `"enforce_admins": true`,
`"required_conversation_resolution": true`, `"allow_force_pushes": false` and
`"allow_deletions": false`.

### Afterwards, verify it rather than assuming it

```bash
gh api /repos/KevinD003/desi-event.com/rulesets
gh api /repos/KevinD003/desi-event.com/branches/main/protection
```

and record what comes back in the table above. Until somebody does, this
document says protection is not configured, because it is not.

---

## What to require on `main`

### Required status checks

Every check below is a job in `.github/workflows/ci.yml`. The names are the
`name:` values GitHub reports, not the job ids.

| Check                                      | What it refuses to let through                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Policy, lint, contract, tests, build`     | TypeScript, a credential-shaped string, unformatted code, a lint error, a contract that does not validate, a failing test, an undeclared skipped test, a database that will not migrate from empty or from populated, a failing build, OpenAPI or route-manifest drift, a server-only name in the browser bundle, a vulnerable dependency, a reachable production payment path, a correctness invariant broken under contention |
| `Browser — public catalogue`               | A regression in the public site, including its no-JavaScript and reduced-motion behaviour                                                                                                                                                                                                                                                                                                                                       |
| `Browser — production build`               | A regression that only appears in a compiled build                                                                                                                                                                                                                                                                                                                                                                              |
| `Browser — organiser venue maps`           | A regression in venue-map authoring                                                                                                                                                                                                                                                                                                                                                                                             |
| `Browser — event lifecycle`                | A regression anywhere in an event's life, from a blank list to a cancellation                                                                                                                                                                                                                                                                                                                                                   |
| `Browser — refusals`                       | A regression in what the product declines to do, and to whom                                                                                                                                                                                                                                                                                                                                                                    |
| `Browser — accessibility sweep`            | A screen that stops reflowing, loses its focus ring, hides itself when motion is reduced, or fails a WCAG 2.1 AA rule                                                                                                                                                                                                                                                                                                           |
| `Browser — commerce and operations detail` | A regression in organiser analytics, the reconciliation and refund detail screens, or ticket transfer — including money shown to somebody who may not see it, a provider payload reaching a screen, or an invitation secret reaching a URL                                                                                                                                                                                      |

**Require branches to be up to date before merging.** Without it, two pull
requests that each pass alone can merge into a broken `main`; the checks ran
against a state that no longer exists by the time the second one lands.

### Reviews

- At least one approving review.
- Dismiss stale approvals when new commits are pushed. An approval is of a diff,
  not of a branch name.
- Require review from a code owner if `CODEOWNERS` is ever added. It is not
  currently.

### Everything else

- **No force pushes.** The commit history is the record of what was decided and
  when, and several documents in this repository cite commits by hash.
- **No deletions.**
- **Include administrators.** A protection rule that the people most likely to
  be in a hurry can bypass is a protection rule for everybody else.
- **Require conversation resolution before merging.** An unresolved review
  comment is a question somebody asked and nobody answered.

---

## What is deliberately not required

**Signed commits.** Worth having, and it needs key distribution to be agreed
first. Requiring it before that is arranged blocks every contributor for a
security property nobody is yet able to verify.

**A linear history.** Merge commits carry which branch a change came from, and
that is worth more here than a straight line: several of these documents refer
to work by the cycle that produced it.

---

## Why CI stops short of enforcing this itself

A workflow can call the GitHub API and assert that protection is configured.
Doing so needs a token with `administration: read`, which is a wider grant than
anything else in this repository holds, on a workflow that otherwise reads
nothing. The trade is not worth it: the check would protect against a setting
being turned off, and it would do so by holding a credential that could turn it
off.

So the state is checked by a person, with the command at the top of this file,
and the answer is recorded where it is checked rather than asserted here.
