# Desi-Event language and technology policy

This document is the authoritative statement of what may be written, and in
what language, inside this repository. It is enforced mechanically by
`scripts/check-language-policy.mjs`, which runs in CI and as part of
`pnpm verify`. If the two ever disagree, the script is the tiebreaker for
whether a change lands, and this document is the tiebreaker for what the
script should say.

## 1. The short version

**Desi-Event is a JavaScript application.** Backend, frontend, mobile, workers,
migrations, seeds and tooling are all written in modern JavaScript with ES
modules. TypeScript is prohibited outright. Other programming languages are
available, but only for the narrow set of problems Node.js genuinely cannot
serve well, and only after the justification below is written down.

## 2. TypeScript is prohibited

The following must not appear anywhere in the repository:

| Prohibited | Use instead |
| --- | --- |
| `.ts`, `.tsx`, `.mts`, `.cts` source files | `.js`, `.mjs`, `.cjs`, `.jsx` |
| `tsconfig.json` and variants | No compiler configuration is needed |
| Hand-written `.d.ts` declarations | JSDoc `@typedef` blocks |
| `typescript`, `ts-node`, `tsx`, `tsup`, `ts-jest`, `typedoc` | Node.js runs the source directly |
| `@typescript-eslint/*` | `eslint` with the shared preset in `@desi-event/config` |
| Hand-installed `@types/*` packages | JSDoc and Zod |

This is a deliberate trade. The cost is that the compiler will not catch type
errors for us. The mitigation is Section 5, and it is not optional: correctness
that a compiler would have given us has to be bought somewhere else.

Third-party dependencies inside `node_modules` ship their own `.d.ts` files.
That is unavoidable and harmless — those files are never edited, never
committed, and no TypeScript toolchain reads them. The policy governs the
source we write, not the internals of packages we install.

## 3. Language of each surface

| Surface | Technology |
| --- | --- |
| Backend runtime | Node.js |
| Backend framework | Fastify |
| Frontend | React with Next.js App Router, JSX |
| Mobile (Phase 3) | React Native with Expo, JSX |
| Database | PostgreSQL |
| ORM | Prisma |
| Cache and queues | Redis with BullMQ |
| Package manager | pnpm |
| Monorepo | Turborepo |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| Validation | Zod |
| Testing | Vitest, React Testing Library, Playwright |
| API style | REST described by OpenAPI |
| Deployment runtime | Node.js |

The supported Node.js version is pinned in `.nvmrc` and in the `engines` field
of the root `package.json`. `.npmrc` sets `engine-strict=true`, so an
unsupported runtime fails at install rather than at runtime.

## 4. User interface rules

* Every page and every interface element is a React component written in JSX.
* Standalone hand-written `.html` application pages are prohibited. The policy
  checker fails the build if one appears.
* HTML produced by React, Next.js or Expo at render time is not only allowed
  but required — it is how the application is delivered, and it is what makes
  the product accessible and indexable. The rule is about authoring, not output.
* jQuery, `document.querySelector`-driven page logic and other
  DOM-manipulation-as-architecture approaches are prohibited. Reach for React
  state and effects. Direct DOM access inside a `ref` callback, for focus
  management or measurement, is normal React and is fine.
* Styling goes through Tailwind CSS or CSS Modules. No inline style sheets
  masquerading as a design system.
* Low-code and no-code platforms are not part of this architecture.

## 5. What replaces the compiler

Because there is no type checker, these five mechanisms carry the weight. Code
review should treat a gap in any of them as a defect:

1. **Zod schemas** (`@desi-event/schemas`) validate every value crossing a
   trust boundary: HTTP requests and responses, queue job payloads,
   environment variables, and third-party API responses. A value that has been
   parsed by Zod has a known shape at runtime, which is a stronger guarantee
   than a compile-time annotation on unvalidated input.
2. **JSDoc annotations** on exported functions document parameter and return
   shapes. Editors read them and give completion and inline errors without any
   build step.
3. **ESLint** with the shared preset catches the mistakes a compiler would
   otherwise surface: unused bindings, unreachable code, malformed JSDoc,
   misuse of React hooks.
4. **Automated tests** — Vitest for units, React Testing Library for
   components, Playwright for end-to-end flows. Pure-logic packages carry
   coverage thresholds.
5. **API contract validation** — the OpenAPI document is generated from the
   same Zod schemas the server validates with, so the contract cannot drift
   away from the implementation.

## 6. Introducing another programming language

Rule: **do not introduce another language when Node.js can safely and
efficiently handle the requirement.** Familiarity, taste, or a preference for a
particular ecosystem are not sufficient reasons.

Where another language is genuinely warranted:

* **Python** — data processing, recommendation models, machine learning,
  analytics pipelines, specialised automation.
* **Java or Kotlin** — Android-native integration that React Native cannot
  reach.
* **Swift** — iOS-native integration that React Native cannot reach.
* **Java, C#, Go or Rust** — a specialised backend service whose architectural
  benefit is documented and real.

### Required before any such code is merged

Add an entry to `docs/language-exceptions.json` containing all of:

| Field | Meaning |
| --- | --- |
| `id` | Short stable identifier for the exception |
| `language` | The language being introduced |
| `paths` | Repository path prefixes the exception covers |
| `reason` | Why Node.js cannot serve this requirement |
| `owner` | The team or person accountable for the component |
| `deployment` | How it is built, shipped and run |
| `securityBoundary` | Trust boundary, authentication, and the data it may touch |
| `operationalCost` | Runtime cost, on-call burden, and upgrade ownership |
| `integrationContract` | The documented REST API or asynchronous event contract it speaks |
| `approvedOn` | ISO date of approval |

The policy checker fails the build on any non-JavaScript source file that is
not covered by a complete entry. A partially filled entry fails too — an
undocumented service is exactly what this process exists to prevent.

### Integration rule

Any non-JavaScript service communicates **only** through a documented REST API
or an asynchronous event contract. It never shares a database connection, an
in-process module boundary, or an undocumented socket with the JavaScript
application.

## 7. Phase 1 scope

Phase 1 is implemented entirely in JavaScript. At the time of writing
`docs/language-exceptions.json` contains no entries, and that is the intended
state. The first genuine candidate is expected to be a Python recommendation
service in a later phase; until it exists, and until its entry is written, the
answer to "should this be a separate service in another language?" is no.

## 8. Running the check

```bash
pnpm policy:check          # human-readable report
node scripts/check-language-policy.mjs --json   # machine-readable
```

The check runs automatically in CI on every push and pull request, and as the
first step of `pnpm verify`.
