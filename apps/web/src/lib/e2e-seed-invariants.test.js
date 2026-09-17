/**
 * What an end-to-end seed may not do to the audit trail.
 *
 * `desi_audit_log_immutable` refuses every `UPDATE` and `DELETE` on `AuditLog`.
 * That is the guarantee Phase 3's Phase 1 added and the one a redaction rests
 * on: in this system a person is redacted, never deleted, and the record of what
 * was done to them is not editable by the thing that did it.
 *
 * A seed that tries to delete audit rows anyway does not defeat the trigger — it
 * cannot — but it is not harmless either. Two seeds carried such a delete from
 * the moment the trigger landed, and they behaved differently, which is the more
 * useful half of the story.
 *
 * In `seed-events.mjs` the delete matched rows every time, because that suite's
 * event really is submitted, approved, published and cancelled. Every run threw,
 * every throw was swallowed by the call's own `.catch(() => {})`, and every log
 * carried
 *
 * ```
 * Database error. Code: `23514`. Message: `audit rows are append-only; DELETE … is refused`
 * ```
 *
 * including the logs of runs that passed. On CI run `35248621822` that line sat
 * immediately above an unrelated Playwright timeout, and the first reading of
 * that failure blamed the audit trigger for it.
 *
 * In `seed-refusals.mjs` the identical statement was silent. The trigger is
 * `FOR EACH ROW`, and a DELETE matching nothing never fires it; those journeys
 * are about refusals, so their events accumulate no audit rows. A measured run
 * with the statement still in place produced zero `23514` errors.
 *
 * That difference is exactly why this is a source invariant and not a log check.
 * A rule that only caught the noisy copy would have left the quiet one in place
 * until the day those journeys started writing audit rows — and it would then
 * have failed as a mystery rather than as a lint.
 *
 * This is a source invariant rather than a runtime test because the failure it
 * prevents is a line somebody writes, not a state the database reaches — the
 * database is already correct, and provably so. It follows
 * `browser-bundle.test.js`, which checks the import graph for the same kind of
 * reason.
 *
 * Scope: every seed under `e2e/support`. `seed-events.mjs` was cleaned first, in
 * `1b77cc5`, when reaching `seed-refusals.mjs` was out of scope; the refusals
 * seed has since been cleaned too. The remaining seeds never carried the
 * statement, and `covers every seed` below exists so a new one cannot be added
 * without deciding the question.
 *
 * @module lib/e2e-seed-invariants.test
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const support = join(webRoot, 'e2e', 'support')

/**
 * The seeds this invariant governs.
 *
 * `cleanup` is the mutable teardown a seed must keep — the point is not "touch
 * nothing", because a seed that stopped cleaning up would leak fixtures between
 * runs. `idempotent` marks the seeds whose fixture users outlive a run and must
 * therefore be upserted. Both are omitted for seeds the audit rule alone covers.
 *
 * @type {ReadonlyArray<{file: string, cleanup?: ReadonlyArray<RegExp>, idempotent?: boolean, explains?: boolean}>}
 */
const SEEDS = Object.freeze([
  {
    file: 'seed-events.mjs',
    cleanup: Object.freeze([
      /ticketType\s*\.deleteMany/u,
      /eventSession\s*\.deleteMany/u,
      /event\s*\.delete\b/u,
    ]),
    idempotent: true,
    explains: true,
  },
  {
    file: 'seed-refusals.mjs',
    cleanup: Object.freeze([
      /ticketType\s*\.deleteMany/u,
      /eventSession\s*\.deleteMany/u,
      /event\s*\.delete\b/u,
      /venueMap\s*\.delete\b/u,
      /membership\s*\.deleteMany/u,
    ]),
    idempotent: true,
    explains: true,
  },
  { file: 'seed-organizer.mjs' },
  { file: 'seed-detail-screens.mjs' },
])

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

/**
 * Raw SQL that reaches the same table by another road.
 *
 * Both patterns are bounded, and that bound is the point. The first version of
 * this list opened with `/(DELETE|UPDATE|TRUNCATE)[^;]*"?AuditLog"?/i`, which
 * reads as "a mutation keyword, then this table, inside one statement" — except
 * that this codebase omits semicolons, so `[^;]*` never stops. It spanned whole
 * files, and it reported
 *
 *     never reaches AuditLog through raw SQL either
 *
 * for a seed that merely called `prisma.auditLog.findMany` somewhere after an
 * unrelated `deleteMany`. Reading the audit trail is allowed; only changing it
 * is not. A gate that fails correct code, under a message describing something
 * the code never did, gets suppressed rather than obeyed.
 *
 * Narrowing it takes nothing away: every Prisma-client mutation is already
 * covered verb by verb in `MUTATIONS`, and these two cover the raw road they
 * were always meant to cover. `the invariant itself` below tests both
 * directions — that a read passes, and that real raw SQL still fails.
 *
 * @type {ReadonlyArray<{road: string, pattern: RegExp}>}
 */
const RAW = Object.freeze([
  {
    road: 'a Prisma raw helper naming the table',
    pattern: /\$(?:execute|query)Raw(?:Unsafe)?[\s\S]{0,200}?"?AuditLog"?/iu,
  },
  {
    road: 'a SQL statement written inline',
    pattern: /(?:DELETE\s+FROM|UPDATE|TRUNCATE(?:\s+TABLE)?)\s+[^\n]{0,40}?"?AuditLog"?/iu,
  },
])

/**
 * The file with its comments removed.
 *
 * Scanning the raw text would police prose: both seeds explain in a comment that
 * the database "refuses every DELETE on `AuditLog`", and the first version of
 * this suite failed on that sentence. An invariant that cannot tell an
 * explanation from an instruction teaches people to stop writing explanations.
 *
 * Stripping comments is the kind of fix that can quietly blind the thing it
 * fixes, so `the invariant itself` below tests both directions of it.
 *
 * @param {string} text The file contents.
 * @returns {string} The same text with block and line comments blanked.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^\s*\/\/.*$/gmu, ' ')
}

/**
 * Read a seed once, both as written and with its comments taken out.
 *
 * @param {string} file The seed's file name.
 * @returns {{raw: string, source: string}} The file, and its executable part.
 */
function readSeed(file) {
  const raw = readFileSync(join(support, file), 'utf8')

  return { raw, source: withoutComments(raw) }
}

describe('the seeds and the audit trail', () => {
  it('covers every seed in e2e/support, so a new one cannot slip the rule', () => {
    const onDisk = readdirSync(support)
      .filter((name) => name.startsWith('seed-') && name.endsWith('.mjs'))
      .sort()

    expect(onDisk).toEqual(SEEDS.map((s) => s.file).sort())
  })

  describe.each(SEEDS.map((s) => [s.file, s]))('%s', (file, seed) => {
    const { raw, source } = readSeed(file)

    it.each(MUTATIONS.map((m) => [m.verb, m.pattern]))(
      'never calls auditLog.%s',
      (_verb, pattern) => {
        expect(pattern.test(source)).toBe(false)
      },
    )

    it.each(RAW.map((r) => [r.road, r.pattern]))(
      'never reaches AuditLog through %s',
      (_road, pattern) => {
        expect(pattern.test(source)).toBe(false)
      },
    )

    if (seed.cleanup) {
      it('still cleans up the mutable rows it created, so this is not a blanket ban', () => {
        for (const pattern of seed.cleanup) expect(source).toMatch(pattern)
      })
    }

    if (seed.idempotent) {
      it('upserts its fixture users, because a run cannot delete them afterwards', () => {
        // A fixture user outlives cleanup: deleting one would `SET NULL` on their
        // audit rows, which is an UPDATE, which the trigger refuses. Playwright
        // re-runs `beforeAll` in a fresh worker after a failure, so a `create`
        // here would turn one failing test into a suite that cannot continue.
        expect(source).toMatch(/prisma\.user\.upsert\b/u)
        expect(source).not.toMatch(/prisma\.user\.create\b/u)
      })
    }

    if (seed.explains) {
      it('says why the audit rows stay, so the next person does not re-add the delete', () => {
        // Asserted against the raw file, because the explanation lives in a
        // comment and `source` is exactly the file with its comments taken out.
        expect(raw).toMatch(/audit rows deliberately stay/iu)
        expect(raw).toMatch(/desi_audit_log_immutable/u)
      })
    }
  })
})

describe('the invariant itself', () => {
  /** Prose that names the forbidden call without making it. */
  const prose = [
    '// The audit rows deliberately stay. The database refuses every DELETE on',
    '// `AuditLog`, so prisma.auditLog.deleteMany({}) could never succeed here.',
    '/* $executeRawUnsafe(`DELETE FROM "AuditLog"`) would be refused too. */',
    'await prisma.event.delete({ where: { id } })',
  ].join('\n')

  it('does not trip on a comment that merely describes the forbidden call', () => {
    const source = withoutComments(prose)

    for (const { pattern } of MUTATIONS) expect(pattern.test(source)).toBe(false)
    for (const { pattern } of RAW) expect(pattern.test(source)).toBe(false)
  })

  it('allows a seed to read the audit trail, because reading is not changing', () => {
    // The regression this pins: an unbounded `[^;]*` in the raw patterns spanned
    // the whole file in a codebase without semicolons, so an unrelated delete
    // anywhere above a legitimate read reported the read as raw SQL.
    const source = withoutComments(
      [
        'await prisma.ticketType.deleteMany({ where: { eventId: event.id } })',
        'await prisma.event.delete({ where: { id: event.id } })',
        '',
        'const rows = await prisma.auditLog.findMany({ where: { entityId: event.id } })',
      ].join('\n'),
    )

    for (const { pattern } of MUTATIONS) expect(pattern.test(source)).toBe(false)
    for (const { pattern } of RAW) expect(pattern.test(source)).toBe(false)
  })

  it('still catches the real statement, so stripping comments did not blind it', () => {
    const source = withoutComments(
      `${prose}\nawait prisma.auditLog.deleteMany({ where: { entityId: event.id } })`,
    )

    expect(MUTATIONS.find((m) => m.verb === 'deleteMany').pattern.test(source)).toBe(true)
  })

  it.each([
    ['a Prisma raw helper', 'await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)'],
    ['a bare SQL delete', 'const sql = `DELETE FROM "AuditLog" WHERE "entityId" = $1`'],
    ['a bare SQL update', 'const sql = `UPDATE "AuditLog" SET "metadata" = NULL`'],
    ['a truncate', 'const sql = `TRUNCATE TABLE "AuditLog"`'],
  ])('still catches raw SQL: %s', (_label, statement) => {
    const source = withoutComments(`${prose}\n${statement}`)

    expect(RAW.some(({ pattern }) => pattern.test(source))).toBe(true)
  })

  it('leaves the executable line count intact when it strips a comment', () => {
    // A `replace` that ate a newline would silently merge two statements and
    // could hide one from a line-anchored pattern.
    expect(withoutComments(prose).split('\n')).toHaveLength(prose.split('\n').length)
  })
})
