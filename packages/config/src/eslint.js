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
