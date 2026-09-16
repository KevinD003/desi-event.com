/**
 * Two invariants about how CI is wired, both learned from runs that failed.
 *
 * Neither is expressible as a unit test, because neither is about application
 * behaviour: one is a property of `.github/workflows/*.yml`, the other of the
 * Turborepo task graph. Both went wrong on this pull request, and in both cases
 * the failure was invisible on a green run — which is the argument for checking
 * them on every run rather than noticing again later.
 *
 * Run: `pnpm run ci:check`
 *
 * @module scripts/check-ci-invariants
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Characters `actions/upload-artifact` refuses in an artefact name.
 *
 * Taken from the action's own validation, which rejects the upload outright
 * rather than sanitising it. A colon is the one that bit: every end-to-end
 * suite is a pnpm task named `test:e2e:something`, so interpolating the script
 * name produced `playwright-test:e2e` and the step failed *after* the tests had
 * already failed, discarding the reports that would have explained them.
 */
const FORBIDDEN_IN_ARTEFACT_NAME = ['"', ':', '<', '>', '|', '*', '?', '\r', '\n', '\\', '/']

/** Task names whose commands run tests, and so import generated clients. */
const TEST_TASKS = ['test', 'test:coverage']

/**
 * Every problem found. Empty means the invariants hold.
 *
 * @type {string[]}
 */
const problems = []

/**
 * Report a failure.
 *
 * @param {string} where Which file the problem is in.
 * @param {string} what What is wrong, and why it matters.
 * @returns {void}
 */
function fail(where, what) {
  problems.push(`${where}: ${what}`)
}

/**
 * The literal values a matrix field takes, read from the workflow text.
 *
 * This is a deliberately small parser rather than a YAML dependency, and it is
 * written to **fail closed**: a construct it cannot read is reported as
 * unverifiable, never assumed to be fine. It handles the one shape this
 * repository uses — a `matrix:` block whose entries are `- field: value` lists.
 *
 * @param {string} source The workflow file's text.
 * @param {string} field The field name, e.g. `name` or `script`.
 * @returns {string[]} Every literal value found for that field inside a matrix.
 */
function matrixValues(source, field) {
  const lines = source.split('\n')
  const values = []
  let insideMatrix = false
  let matrixIndent = 0

  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length

    if (/^\s*matrix:\s*$/.test(line)) {
      insideMatrix = true
      matrixIndent = indent
      continue
    }

    // The matrix block ends at the first line indented no further than it.
    if (insideMatrix && indent <= matrixIndent && !/^\s*matrix:\s*$/.test(line)) {
      insideMatrix = false
    }

    if (!insideMatrix) continue

    const match = line.match(/^\s*(?:-\s+)?([A-Za-z_][\w-]*):\s*(.+?)\s*$/)
    if (match && match[1] === field) values.push(match[2].replace(/^['"]|['"]$/g, ''))
  }

  return values
}

/**
 * Check that every artefact name a workflow can produce is one GitHub accepts.
 *
 * @param {string} file The workflow file name.
 * @param {string} source Its text.
 * @returns {void}
 */
function checkArtefactNames(file, source) {
  const lines = source.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    // Match the directive, not the word. A comment that merely names the action
    // — such as the one this check exists because of — is prose, not a step.
    if (!/^\s*uses:\s*actions\/upload-artifact/.test(lines[index])) continue

    // The `name:` belonging to this step is the next one inside its `with:`.
    let name = null
    for (let look = index + 1; look < Math.min(index + 12, lines.length); look += 1) {
      const match = lines[look].match(/^\s*name:\s*(.+?)\s*$/)
      if (match) {
        name = match[1]
        break
      }
    }

    if (name === null) {
      fail(file, `an upload-artifact step near line ${index + 1} has no name this check could read`)
      continue
    }

    // Resolve every ${{ ... }} the name interpolates. Anything that is not a
    // matrix field this parser understands is reported rather than skipped.
    const expressions = [...name.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1])
    let candidates = [name]

    for (const expression of expressions) {
      const matrixField = expression.match(/^matrix\.[\w-]+\.([\w-]+)$/)
      if (!matrixField) {
        fail(
          file,
          `artefact name "${name}" interpolates \`${expression}\`, which this check cannot resolve — ` +
            `resolve it here or use a literal, because an unresolvable name cannot be proved uploadable`,
        )
        candidates = []
        break
      }

      const values = matrixValues(source, matrixField[1])
      if (values.length === 0) {
        fail(
          file,
          `artefact name "${name}" interpolates \`${expression}\` but no matrix values were found for it`,
        )
        candidates = []
        break
      }

      candidates = candidates.flatMap((candidate) =>
        values.map((value) => candidate.replace(`\${{ ${expression} }}`, value)),
      )
    }

    for (const candidate of candidates) {
      const bad = FORBIDDEN_IN_ARTEFACT_NAME.filter((character) => candidate.includes(character))
      if (bad.length > 0) {
        const shown = bad.map((character) => JSON.stringify(character)).join(', ')
        fail(
          file,
          `artefact name "${candidate}" contains ${shown}, which actions/upload-artifact rejects`,
        )
      }
    }
  }
}

/**
 * Check that a package's tests wait for that package's own build.
 *
 * `packages/db`'s build is `prisma generate`, and the client it generates lands
 * in shared `node_modules`, not in any directory Turborepo tracks as an output.
 * With `dependsOn: ["^build"]` alone, a package's tests are ordered against its
 * *dependencies'* builds but not its own — so `@desi-event/db#build` and
 * `@desi-event/db#test:coverage` were free to run at the same time. On run
 * `35103232838` they did: the generate landed 9s into a vitest run that was
 * importing the very client it was rewriting, and Node refused the half-written
 * `package.json` with "Invalid package config". The suite reported `(0 test)` —
 * its assertions did not run at all.
 *
 * @returns {void}
 */
function checkTaskOrdering() {
  const file = 'turbo.json'
  const config = JSON.parse(readFileSync(file, 'utf8'))

  for (const task of TEST_TASKS) {
    const definition = config.tasks?.[task]
    if (!definition) {
      fail(file, `task "${task}" is missing, so its ordering cannot be checked`)
      continue
    }

    const dependsOn = definition.dependsOn ?? []
    if (!dependsOn.includes('build')) {
      fail(
        file,
        `task "${task}" does not depend on "build", so a package's tests may run while its own ` +
          `generated client is being rewritten (see run 35103232838)`,
      )
    }
  }
}

const workflowDirectory = '.github/workflows'
const workflows = readdirSync(workflowDirectory).filter(
  (file) => file.endsWith('.yml') || file.endsWith('.yaml'),
)

if (workflows.length === 0) {
  fail(workflowDirectory, 'no workflow files found, so no artefact name could be checked')
}

for (const file of workflows) {
  checkArtefactNames(
    join(workflowDirectory, file),
    readFileSync(join(workflowDirectory, file), 'utf8'),
  )
}

checkTaskOrdering()

if (problems.length > 0) {
  console.error('CI invariants failed:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(
  `CI invariants hold: ${workflows.length} workflow file(s) produce only uploadable artefact names, ` +
    `and ${TEST_TASKS.length} test tasks order their own build.`,
)
