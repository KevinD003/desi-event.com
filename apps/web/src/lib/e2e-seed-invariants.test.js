/**
 * What an end-to-end seed may not do to the audit trail.
 *
 * `desi_audit_log_immutable` refuses every `UPDATE` and `DELETE` on `AuditLog`.
 * That is the guarantee Phase 3's Phase 1 added and the one a redaction rests
 * on: in this system a person is redacted, never deleted, and the record of what
 * was done to them is not editable by the thing that did it.
 *
 * A seed that tries to delete audit rows anyway does not defeat the trigger — it
 * cannot — but it is not harmless either. `apps/web/e2e/support/seed-events.mjs`
 * carried such a delete from the moment the trigger landed. Every run threw,
 * every throw was swallowed by the call's own `.catch(() => {})`, and every log
 * carried
 *
 * ```
 * Database error. Code: `23514`. Message: `audit rows are append-only; DELETE … is refused`
 * ```
 *
 * including the logs of runs that passed. On CI run `35248621822` that line sat
 * immediately above an unrelated Playwright timeout, and the first reading of
 * that failure blamed the audit trigger for it. A guaranteed-failing statement
 * that logs an alarming error on every single run is a statement that will
 * eventually be blamed for something it did not do.
 *
 * This is a source invariant rather than a runtime test because the failure it
 * prevents is a line somebody writes, not a state the database reaches — the
 * database is already correct, and provably so. It follows
 * `browser-bundle.test.js`, which checks the import graph for the same kind of
 * reason.
 *
 * Scope: the event-lifecycle seed. `seed-refusals.mjs` carries the identical
 * dead statement and is deliberately left alone here — it belongs to another
 * suite, and widening this change to reach it was not authorised.
 *
 * @module lib/e2e-seed-invariants.test
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const seed = join(webRoot, 'e2e', 'support', 'seed-events.mjs')

/**
 * Every way a Prisma client could try to change an audit row.
 *
 * Written as a list rather than one pattern so a failure names the verb.
 *
 * @type {ReadonlyArray<{verb: string, pattern: RegExp}>}
 */
const MUTATIONS = Object.freeze([
  { verb: 'delete', pattern: /\bauditLog\s*\n?\s*\.\s*delete\b/u },
  { verb: 'deleteMany', pattern: /\bauditLog\s*\n?\s*\.\s*deleteMany\b/u },
  { verb: 'update', pattern: /\bauditLog\s*\n?\s*\.\s*update\b/u },
  { verb: 'updateMany', pattern: /\bauditLog\s*\n?\s*\.\s*updateMany\b/u },
  { verb: 'upsert', pattern: /\bauditLog\s*\n?\s*\.\s*upsert\b/u },
])

/** Raw SQL that reaches the same table by another road. */
const RAW = Object.freeze([
  /(DELETE|UPDATE|TRUNCATE)[^;]*"?AuditLog"?/iu,
  /\$executeRaw[^\n]*AuditLog/iu,
])

/**
 * The file with its comments removed.
 *
 * Scanning the raw text would police prose: the seed's own comment explains that
 * the database "refuses every DELETE on `AuditLog`", and the first version of
 * this suite failed on that sentence. An invariant that cannot tell an
 * explanation from an instruction teaches people to stop writing explanations.
 *
 * @param {string} text The file contents.
 * @returns {string} The same text with block and line comments blanked.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^\s*\/\/.*$/gmu, ' ')
}

describe('the event-lifecycle seed and the audit trail', () => {
  const raw = readFileSync(seed, 'utf8')
  const source = withoutComments(raw)

  it.each(MUTATIONS.map((m) => [m.verb, m.pattern]))(
    'never calls auditLog.%s',
    (_verb, pattern) => {
      expect(pattern.test(source)).toBe(false)
    },
  )

  it('never reaches AuditLog through raw SQL either', () => {
    for (const pattern of RAW) {
      expect(pattern.test(source)).toBe(false)
    }
  })

  it('still cleans up the mutable rows it created, so this is not a blanket ban', () => {
    // The point is not "touch nothing". A seed that stopped cleaning up would
    // leak fixtures between runs, which is its own defect. These are the deletes
    // that must survive.
    expect(source).toMatch(/ticketType\s*\.deleteMany/u)
    expect(source).toMatch(/eventSession\s*\.deleteMany/u)
    expect(source).toMatch(/event\s*\.delete\b/u)
  })

  it('says why the audit rows stay, so the next person does not re-add the delete', () => {
    // Asserted against the raw file, because the explanation lives in a comment
    // and `source` is exactly the file with its comments taken out.
    expect(raw).toMatch(/audit rows deliberately stay/iu)
    expect(raw).toMatch(/desi_audit_log_immutable/u)
  })
})
