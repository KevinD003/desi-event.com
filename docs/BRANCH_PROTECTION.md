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

Checked against the GitHub API on **2026-09-16**, and recorded here because this
document says the answer belongs where it is checked.

| Branch                              | `protected` |
| ----------------------------------- | ----------- |
| `main`                              | **false**   |
| `claude/desi-event-js-stack-gb4uqe` | **false**   |

**Nothing below is configured.** Not one required check, not the review rule,
not the force-push rule. The list that follows is what to configure, not a
description of what is in place, and no document in this repository may cite it
as though it were.

The same check found **no workflow registered on the repository and no run of
one**: `.github/workflows/ci.yml` exists on the working branch, and GitHub
registers a workflow when it first runs. The workflow triggers on
`push` to `main` and on `pull_request`, and this branch has had neither, so it
has never executed. See `PHASE2_STATUS.md` gate 17.

---

## What to require on `main`

### Required status checks

Every check below is a job in `.github/workflows/ci.yml`. The names are the
`name:` values GitHub reports, not the job ids.

| Check                                  | What it refuses to let through                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Policy, lint, contract, tests, build` | TypeScript, a credential-shaped string, unformatted code, a lint error, a contract that does not validate, a failing test, an undeclared skipped test, a database that will not migrate from empty or from populated, a failing build, OpenAPI or route-manifest drift, a server-only name in the browser bundle, a vulnerable dependency, a reachable production payment path, a correctness invariant broken under contention |
| `Browser — public catalogue`           | A regression in the public site, including its no-JavaScript and reduced-motion behaviour                                                                                                                                                                                                                                                                                                                                       |
| `Browser — production build`           | A regression that only appears in a compiled build                                                                                                                                                                                                                                                                                                                                                                              |
| `Browser — organiser venue maps`       | A regression in venue-map authoring                                                                                                                                                                                                                                                                                                                                                                                             |
| `Browser — event lifecycle`            | A regression anywhere in an event's life, from a blank list to a cancellation                                                                                                                                                                                                                                                                                                                                                   |
| `Browser — refusals`                   | A regression in what the product declines to do, and to whom                                                                                                                                                                                                                                                                                                                                                                    |
| `Browser — accessibility sweep`        | A screen that stops reflowing, loses its focus ring, hides itself when motion is reduced, or fails a WCAG 2.1 AA rule                                                                                                                                                                                                                                                                                                           |

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
