# Contributing

How work gets into this repository.

## Before you start

```bash
nvm use            # Node 22.22.2, from .nvmrc
corepack enable    # pnpm 10.33.0, from packageManager
pnpm install
```

First-time setup is in the [README quickstart](README.md#quickstart);
day-to-day workflow is in [docs/development.md](docs/development.md).

## Branches

Never commit to `main`. Branch from it:

```
<type>/<short-kebab-description>
```

| Type        | For                                    |
| ----------- | -------------------------------------- |
| `feat/`     | New behaviour                          |
| `fix/`      | A defect                               |
| `refactor/` | Restructuring with no behaviour change |
| `docs/`     | Documentation only                     |
| `chore/`    | Tooling, dependencies, CI              |

Examples: `feat/waitlist-notifications`, `fix/hold-expiry-boundary`,
`chore/bump-playwright`.

One branch does one thing. A branch that renames a package _and_ fixes a
pricing bug cannot be reviewed properly or reverted cleanly.

## Commits

Plain, imperative subject lines — not Conventional Commits:

```
Prevent overselling when two holds race for the last ticket
```

- Imperative mood ("Add", "Fix", "Move"), capitalised, no trailing full stop.
- Subject under 72 characters.
- Blank line, then a body explaining **why**. The diff already says what
  changed; what a reader six months from now needs is the reasoning, the
  alternative you rejected, and any trade-off you accepted.
- Reference issues in the body, not the subject.

Keep commits individually coherent. A commit that leaves the tree failing
`pnpm verify` should be squashed into the one that fixes it before you push.

## The verify gate

Run this before you push. CI runs the same gates in the same order, plus the
API contract check and `prisma migrate deploy` against a real database:

```bash
pnpm verify
```

which is:

| Step | Command             | Why it is where it is                                                                            |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------ |
| 1    | `pnpm policy:check` | Cheapest gate, and the rule this repository exists to enforce. It needs no database and no build |
| 2    | `pnpm lint`         | ESLint across every workspace. **Zero errors.** Warnings are tolerated                           |
| 3    | `pnpm test`         | Vitest everywhere, with coverage thresholds on the pure-logic packages                           |
| 4    | `pnpm build`        | Prisma client, `openapi.json`, `next build`                                                      |

If you exported `.env` into your shell, run it as
`NODE_ENV=production pnpm verify`. The `.env` template sets
`NODE_ENV=development`, and `next build` — the last step — refuses a
non-standard `NODE_ENV` and dies prerendering the global error page. CI does
not set `NODE_ENV` at all, which is why it does not hit this.

Two things `pnpm verify` does not cover — run them when your change touches
either area:

```bash
pnpm contract:check   # after changing packages/api-contract
pnpm test:e2e         # after changing apps/web
```

Do not push with a failing verify and a note saying you will fix it. If
something is genuinely broken upstream of your change, say so in the pull
request.

## The language policy, briefly

**This is a JavaScript repository. TypeScript is prohibited.** No `.ts`,
`.tsx`, `.mts` or `.cts` files, no `tsconfig.json`, no hand-written `.d.ts`, no
`typescript`/`ts-node`/`tsx`/`tsup`/`typedoc`, no `@typescript-eslint/*`, no
hand-installed `@types/*`. Sources are `.js`, `.mjs`, `.cjs` and `.jsx`, ES
modules only.

Also prohibited: standalone hand-written `.html` application pages (the UI is
React components in JSX), and jQuery or any other
DOM-manipulation-as-architecture approach.

Because there is no compiler, five mechanisms carry that weight, and a gap in
any of them is a review defect: Zod schemas at every trust boundary, JSDoc on
every export, ESLint, tests with coverage thresholds, and an OpenAPI document
generated from the same schemas the server validates with.

`pnpm policy:check` enforces all of this mechanically and is the first step of
both `pnpm verify` and CI.

### Another language

The rule is: **do not introduce another language when Node.js can safely and
efficiently handle the requirement.** Familiarity or ecosystem preference are
not reasons.

Where one is genuinely warranted — Python for ML and analytics, Kotlin/Swift
for native integration React Native cannot reach, Go/Rust/Java/C# for a
specialised service with a documented architectural benefit — the exception
must be registered in `docs/language-exceptions.json` **before** the code
merges, with all ten required fields: `id`, `language`, `paths`, `reason`,
`owner`, `deployment`, `securityBoundary`, `operationalCost`,
`integrationContract`, `approvedOn`. A partially filled entry fails the policy
check, because an undocumented service is exactly what the process exists to
prevent. Any such service talks to the JavaScript application only through a
documented REST API or an asynchronous event contract — never a shared database
connection or an undocumented socket.

The full policy, its reasoning and the decision records behind it:
[docs/language-policy.md](docs/language-policy.md),
[docs/adr/0001-javascript-only-stack.md](docs/adr/0001-javascript-only-stack.md),
[docs/adr/0002-polyglot-exception-process.md](docs/adr/0002-polyglot-exception-process.md).

## Code style

ESLint is the enforcement; the rest is convention, and the existing files are
the reference. `packages/db/src/index.js` and `packages/inventory/src/` are
good ones to read first.

**Formatting.** Two-space indent, single quotes, no statement-terminating
semicolons, roughly 100 columns. `.editorconfig` covers indentation, charset
and line endings.

> `pnpm format` runs Prettier with **no configuration file**, so it applies
> Prettier's defaults — double quotes and semicolons — which contradict the
> style used throughout the repository. Until a `.prettierrc` matching the
> house style is committed, do not run it over existing files.

**JavaScript.**

- ES modules everywhere. Every package is `"type": "module"`.
- JSDoc on every exported function: `@param`, `@returns`, and `@throws` where
  it throws. `@typedef` for object shapes. This is how editors know the shapes,
  so an annotation that lies is worse than none.
- Small pure functions; keep I/O at the edges so the logic stays testable. The
  reason `pricing`, `permissions` and `inventory` depend on nothing is that
  their callers pass data in.
- Money is **integer cents**. Never floating point, anywhere, for any reason.
- Error classes carry a `statusCode` and a machine-readable `code`, like
  `PermissionError`, `InventoryError` and `PricingError` do.
- Validate anything crossing a trust boundary with a Zod schema from
  `@desi-event/schemas` — HTTP payloads, job payloads, environment variables,
  third-party responses.
- Comments explain **why**, not what. Do not narrate obvious code. A comment
  that records a rejected alternative or a subtle ordering constraint is worth
  ten that restate the line below them.

**React.**

- Components in `.jsx`, function components only.
- Accessible by construction: labels tied to inputs, `aria-*` where roles need
  it, focus management in anything that traps focus. Tests query by role and
  accessible name, so an inaccessible component fails its own test.
- Tailwind utility classes for styling; `cn()` from `@desi-event/ui` to compose
  them.
- Refs for DOM access where React genuinely needs it (focus, measurement).
  Never `document.querySelector` as architecture.

**Tests.**

- Vitest with explicit imports — the shared preset sets `globals: false`:
  `import { describe, it, expect } from 'vitest'`.
- Co-locate units as `src/<name>.test.js`; integration suites go in `tests/`.
- Test real behaviour and edge cases: rounding, boundaries, expiry, timezones,
  permission denial, validation rejection. A test that asserts a function is
  defined is worse than no test, because it makes the coverage number lie.
- A bug fix comes with the test that would have caught it.

## Definition of done

A change is ready to merge when all of this is true:

1. `pnpm verify` passes locally, with **zero** ESLint errors.
2. New and changed behaviour is covered by tests that would fail without the
   change. Coverage thresholds on the pure-logic packages still hold.
3. Every new exported function has JSDoc with `@param`, `@returns` and
   `@throws` where applicable.
4. Anything crossing a trust boundary is validated by a Zod schema.
5. A schema change ships with its Prisma migration in the same commit, and the
   seed still runs (`pnpm db:reset && pnpm db:seed`).
6. An API change is made in `packages/api-contract/src/routes.js` first;
   `pnpm contract:check` passes and `pnpm openapi:emit` has been run so the
   committed `apps/api/openapi.json` matches.
7. A new environment variable is in `.env.example`, in the relevant schema in
   `packages/schemas/src/env.js`, in the CI workflow if CI needs it, and in the
   table in [docs/development.md](docs/development.md).
8. Documentation that the change makes wrong has been updated — README,
   `docs/architecture.md`, `docs/api.md`, `docs/development.md`.
9. No TypeScript, no new `.html` page, no new dependency that the policy
   check rejects.
10. The commit message explains why.

## Pull requests

Say what changed and why, how you verified it, and what you deliberately left
out. If you made a trade-off, name it — a reviewer who can see the trade-off
can agree with it; one who has to guess will re-litigate it.

CI runs the verify steps plus the Playwright suite. Both jobs must be green.
The Playwright report is uploaded as an artifact when the e2e job fails.
