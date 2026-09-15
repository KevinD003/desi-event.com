/**
 * Shared ESLint flat configuration for the Desi-Event monorepo.
 *
 * The repository is JavaScript-only: there is no TypeScript parser, no
 * `@typescript-eslint` tooling and no type-aware linting. Static confidence
 * comes from ESLint correctness rules, JSDoc annotations and Zod schemas that
 * validate values at runtime. See `docs/language-policy.md`.
 *
 * @module @desi-event/config/eslint
 */

import js from '@eslint/js'
import globals from 'globals'
import jsdoc from 'eslint-plugin-jsdoc'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

/** Directories that never contain hand-written source. */
export const ignoredPaths = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/generated/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/*.min.js',
]

/**
 * Correctness rules applied to every JavaScript file in the repository.
 *
 * @type {Record<string, unknown>}
 */
const sharedRules = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  'no-var': 'error',
  'prefer-const': 'error',
  'object-shorthand': ['error', 'properties'],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-implicit-coercion': ['error', { boolean: false }],
  'no-return-await': 'error',
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',
  'require-atomic-updates': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: 'TSInterfaceDeclaration, TSTypeAliasDeclaration, TSEnumDeclaration',
      message:
        'TypeScript syntax is prohibited in this repository. Use JSDoc and Zod schemas instead.',
    },
  ],
}

/**
 * JSDoc rules. Structural mistakes are errors because a wrong annotation is
 * worse than none; missing annotations are warnings so that new code is nudged
 * rather than blocked.
 *
 * @type {Record<string, unknown>}
 */
const jsdocRules = {
  'jsdoc/check-alignment': 'error',
  'jsdoc/check-param-names': 'error',
  'jsdoc/check-property-names': 'error',
  'jsdoc/check-tag-names': ['error', { definedTags: ['satisfies'] }],
  'jsdoc/check-types': 'error',
  'jsdoc/no-bad-blocks': 'error',
  'jsdoc/no-undefined-types': 'off',
  'jsdoc/require-param-description': 'warn',
  'jsdoc/require-returns-description': 'warn',
  'jsdoc/valid-types': 'error',
  'jsdoc/require-jsdoc': [
    'warn',
    {
      publicOnly: true,
      require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: false },
    },
  ],
}

/**
 * Build the shared flat config array.
 *
 * @param {object} [options] Optional overrides.
 * @param {string[]} [options.ignores] Extra glob patterns to ignore.
 * @returns {object[]} An ESLint flat configuration array.
 */
export function createConfig(options = {}) {
  const { ignores = [] } = options

  return [
    { ignores: [...ignoredPaths, ...ignores] },

    js.configs.recommended,

    // Every JavaScript file in the repository.
    {
      files: ['**/*.{js,mjs,cjs,jsx}'],
      plugins: { jsdoc },
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        globals: { ...globals.node, ...globals.es2024 },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      settings: { jsdoc: { mode: 'jsdoc' } },
      rules: { ...sharedRules, ...jsdocRules },
    },

    // CommonJS files opt out of module syntax.
    {
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
    },

    // React components and hooks.
    {
      files: ['**/*.jsx'],
      plugins: { react, 'react-hooks': reactHooks },
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      settings: { react: { version: 'detect' } },
      rules: {
        ...react.configs.flat.recommended.rules,
        // The new JSX transform means React need not be in scope.
        'react/react-in-jsx-scope': 'off',
        'react/jsx-uses-react': 'off',
        // Prop validation is handled by Zod schemas and JSDoc, not PropTypes.
        'react/prop-types': 'off',
        'react/jsx-key': 'error',
        'react/no-unescaped-entities': 'off',
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },

    // Browser modules the web application ships that are not components. A
    // `.jsx` file gets browser globals from the block above; a plain `.js`
    // module under `apps/web/src` may equally run in the browser — the CSRF
    // helper reads `document.cookie` — and Next decides which by the `'use
    // client'` directive, not by the extension. Node globals stay in scope
    // because the same directory holds server modules.
    {
      files: ['apps/web/src/**/*.js'],
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
    },

    // The web application talks to the API over HTTP and has no business
    // importing the server's internals. Finding NF-15 is why this exists: the
    // platform's scrypt password hashing reached the production client bundle
    // through four hops of individually reasonable barrel imports, and nothing
    // in the repository failed.
    //
    // `apps/web/src/lib/browser-bundle.js` catches the same class of mistake by
    // walking the import graph, and it catches more — a transitive leak through
    // a package this list does not name. This rule is the fast half: it fails in
    // the editor, on the line, before a test run.
    {
      files: ['apps/web/**/*.{js,jsx,mjs}'],
      ignores: ['apps/web/**/*.test.{js,jsx}', 'apps/web/e2e/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            // `paths` matches a specifier exactly. `patterns` uses gitignore
            // semantics, where a bare package name also swallows every subpath
            // under it — which would block the one safe entry point along with
            // the barrel it exists to replace.
            paths: [
              {
                name: '@desi-event/inventory',
                message:
                  'The inventory barrel re-exports ownership.js, which uses node:crypto. The whole-layout validator is at @desi-event/inventory/layout and imports nothing — use that.',
              },
            ],
            patterns: [
              {
                group: ['@desi-event/auth', '@desi-event/auth/*'],
                message:
                  'Credential primitives are server-only. password.js calls promisify(node:crypto.scrypt) at module scope, which throws in a browser, and the rest of the package tells a reader how sessions, TOTP and lockout work. The web app authenticates by calling the API.',
              },
              {
                group: ['@desi-event/db', '@desi-event/db/*'],
                message:
                  'Prisma and the schema are server-only. The web app reads data through the API client.',
              },
              {
                group: ['@desi-event/providers', '@desi-event/providers/*'],
                message:
                  'Payment provider adapters handle secret keys. The browser talks to Stripe through the provider\u2019s own published client, never through ours.',
              },
              {
                group: ['@desi-event/ledger', '@desi-event/ledger/*'],
                message:
                  'Double-entry posting rules are server-side. Money is never counted in a browser.',
              },
              {
                group: ['@desi-event/schemas/env', '@desi-event/schemas/jobs'],
                message:
                  'Finding NF-16: these describe how the API and the worker are deployed \u2014 variable names, the JWT_SECRET floor, the placeholder-secret blocklist, queue names. None of it belongs in a client bundle.',
              },
            ],
          },
        ],
      },
    },

    // Tests may reach for globals and console freely.
    {
      files: [
        '**/*.test.{js,jsx}',
        '**/*.spec.{js,jsx}',
        '**/tests/**/*.{js,jsx}',
        '**/e2e/**/*.js',
      ],
      languageOptions: { globals: { ...globals.node, ...globals.browser } },
      rules: {
        'no-console': 'off',
        'jsdoc/require-jsdoc': 'off',
      },
    },

    // Operational Node scripts print to stdout by design.
    {
      files: ['scripts/**/*.{js,mjs}', '**/scripts/**/*.{js,mjs}'],
      rules: { 'no-console': 'off' },
    },
  ]
}

export default createConfig()
