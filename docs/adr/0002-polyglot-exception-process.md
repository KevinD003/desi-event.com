# ADR 0002 — When another language may enter the repository

- **Status:** Accepted
- **Date:** 2026-09-14
- **Supersedes:** nothing
- **Related:** ADR 0001

## Context

ADR 0001 commits the application to JavaScript. Taken literally and forever,
that would be a mistake: recommendation models, native mobile integrations and
certain compute-bound services have real homes outside Node.js, and pretending
otherwise leads to worse engineering than admitting the boundary.

The failure mode we actually want to prevent is not "a second language exists".
It is a second language arriving _by accident_ — a script someone found
convenient, with no owner, no deployment story, no security review, and no
documented interface, which becomes load-bearing before anyone notices.

## Decision

Other languages are permitted where they provide a justified technical benefit,
and prohibited where Node.js can safely and efficiently do the job. The
permitted set and their intended uses are listed in `docs/language-policy.md`
section 6: Python for data, ML and analytics; Kotlin or Java and Swift for
native mobile integration; Java, C#, Go or Rust for specialised backend
services with a documented architectural benefit.

Entry is gated on documentation, not on permission from a specific person.
Before any non-JavaScript source merges, an entry in
`docs/language-exceptions.json` must record its reason, owner, deployment
method, security boundary, operational cost, and integration contract. The
policy checker fails the build on unregistered sources and on incomplete
entries alike.

Every such component communicates through a documented REST API or an
asynchronous event contract. Shared database connections and undocumented
sockets are not integration.

## Consequences

Adding a language costs an afternoon of writing rather than a meeting. That is
deliberate: the documentation is the artifact that makes the component
operable, and a team unwilling to write it is a team that should not be running
the service.

Phase 1 ships with an empty registry, which is the intended state. The first
expected candidate is a Python recommendation service in a later phase.
