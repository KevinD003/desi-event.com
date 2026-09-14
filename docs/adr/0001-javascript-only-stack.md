# ADR 0001 — JavaScript everywhere, TypeScript nowhere

* **Status:** Accepted
* **Date:** 2026-09-14
* **Applies to:** the whole repository

## Context

Desi-Event spans a REST API, a server-rendered web application, background
workers, and — from Phase 3 — a React Native mobile client. A platform this
shape can be written in one language or several. The default industry answer
for a JavaScript monorepo is TypeScript.

We are choosing differently, and the choice needs recording because it runs
against that default and will look like an oversight to anyone who joins later.

## Decision

The entire application is written in modern JavaScript with ES modules.
TypeScript is prohibited: no `.ts` or `.tsx` sources, no `tsconfig.json`, no
hand-written declarations, and no TypeScript-specific tooling such as
`@typescript-eslint`, `ts-node` or `tsup`.

One language spans every surface. The same engineer moves between a Fastify
route, a React component and a BullMQ processor without changing toolchain, and
shared packages — schemas, pricing, permissions, inventory — are consumed
directly as source by the API, the web app and, later, the mobile client. There
is no build step between writing a shared module and running it.

## Consequences

### What we give up

Compile-time type checking. A function called with the wrong argument shape
fails at runtime rather than in the editor, and refactoring across package
boundaries loses the safety net that "find all references" provides in a typed
codebase.

This is the real cost of the decision. We are not pretending otherwise.

### How we pay for it

Five mechanisms replace the compiler, described in full in
`docs/language-policy.md` section 5: Zod schemas at every trust boundary, JSDoc
on exported functions, ESLint correctness rules, automated tests with coverage
thresholds on pure-logic packages, and an OpenAPI contract generated from the
same Zod schemas the server validates with.

The Zod layer is worth singling out. A compile-time annotation describes what a
developer believes an inbound payload contains; a Zod parse establishes what it
actually contains. For data arriving over HTTP, off a queue, or from a payment
provider, runtime validation is the stronger guarantee — and it is one we would
need even in a TypeScript codebase.

### What we gain

No build step for shared code. No compiler version to keep aligned across
workspaces. No divergence between what is typed and what is validated, because
the schemas do both. A smaller dependency graph and faster installs.

### What would reverse this

Sustained defects traceable to missing static types, in categories the five
mechanisms above demonstrably fail to catch. That evidence would justify a new
ADR superseding this one. Discomfort with the decision would not.

## Enforcement

`scripts/check-language-policy.mjs` fails the build on any TypeScript source,
configuration, or tooling dependency. It runs in CI and in `pnpm verify`.
