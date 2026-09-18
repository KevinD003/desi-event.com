/**
 * A dry run must be incapable of changing anything, and must say so in numbers.
 *
 * These tests hold three properties:
 *
 *   - **It cannot mutate.** Not "does not" — cannot. The module is asked to
 *     rehearse against a client that fails the test if anything other than a
 *     `count` is called on it.
 *   - **It carries its own approval status.** A duration that reaches an
 *     operator without `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW` attached is a
 *     duration somebody will eventually mistake for policy.
 *   - **It never reads a personal value.** The queries ask about timestamps and
 *     about whether a column is null. They never ask what is in one.
 *
 * @module worker/retention/classes.test
 */

import { describe, expect, it, vi } from 'vitest'

import {
  NOT_EVALUATED_CLASSES,
  RETENTION_APPROVAL,
  RETENTION_CLASSES,
  countCandidates,
  countHeld,
  cutOffFor,
  rehearseClass,
  retentionClassByName,
} from './classes.js'

/** A fixed instant, so cut-off arithmetic is checkable rather than approximate. */
const NOW = new Date('2026-09-18T00:00:00.000Z')

/**
 * A Prisma stand-in that answers counts and fails on anything else.
 *
 * The forbidden methods are not merely absent — they throw, so a future change
 * that reached for one fails loudly here rather than silently deleting rows in
 * whatever environment it first runs in.
 *
 * @param {number} [count] What every count returns.
 * @returns {object} The stub.
 */
function countingPrisma(count = 7) {
  const forbid = (name) => () => {
    throw new Error(`a dry run must not call ${name}`)
  }

  const model = () => ({
    count: vi.fn(async () => count),
    delete: forbid('delete'),
    deleteMany: forbid('deleteMany'),
    update: forbid('update'),
    updateMany: forbid('updateMany'),
    upsert: forbid('upsert'),
    create: forbid('create'),
  })

  return {
    loginAttempt: model(),
    session: model(),
    notificationOutbox: model(),
    privacyHold: model(),
    $executeRaw: forbid('$executeRaw'),
    $executeRawUnsafe: forbid('$executeRawUnsafe'),
  }
}

describe('a rehearsal cannot change anything', () => {
  it.each(RETENTION_CLASSES.map((definition) => [definition.retentionClass, definition]))(
    '%s reads only, never writes',
    async (_name, definition) => {
      const prisma = countingPrisma()

      await rehearseClass(prisma, definition, NOW)

      // The stub throws on every mutating method, so reaching this line at all
      // is the assertion. The explicit check guards against a future stub that
      // is more forgiving than this one.
      expect(prisma[definition.model].count).toHaveBeenCalled()
    },
  )

  it.each(RETENTION_CLASSES.map((definition) => [definition.retentionClass, definition]))(
    '%s reports affectedCount 0 and mode DRY_RUN explicitly',
    async (_name, definition) => {
      const row = await rehearseClass(countingPrisma(), definition, NOW)

      // `mode` has no database default, so a writer that omits it gets a
      // runtime error rather than a silent DRY_RUN. It is stated here.
      expect(row.mode).toBe('DRY_RUN')
      // What `retention_sweep_dry_run_changes_nothing` refuses to see non-zero.
      expect(row.affectedCount).toBe(0)
    },
  )

  it('exposes no function that deletes or updates', async () => {
    const module = await import('./classes.js')

    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== 'function') continue

      expect(name).not.toMatch(/delete|purge|remove|update|execute|apply/iu)
    }
  })
})

describe('every duration carries its approval status', () => {
  it.each(RETENTION_CLASSES.map((definition) => [definition.retentionClass, definition]))(
    '%s is labelled PROPOSED',
    (_name, definition) => {
      expect(definition.approval).toBe(RETENTION_APPROVAL)
      expect(definition.approval).toMatch(/REQUIRES LEGAL\/PRIVACY REVIEW/u)
    },
  )

  it('labels the not-evaluated classes too', () => {
    for (const entry of NOT_EVALUATED_CLASSES) {
      expect(entry.approval).toBe(RETENTION_APPROVAL)
    }
  })

  it('never claims a duration is approved, enforced or adopted', () => {
    const text = JSON.stringify([...RETENTION_CLASSES, ...NOT_EVALUATED_CLASSES])

    expect(text).not.toMatch(/\bapproved\b/iu)
    expect(text).not.toMatch(/\benforced\b/iu)
  })
})

describe('the candidate queries read no personal value', () => {
  it.each(RETENTION_CLASSES.map((definition) => [definition.retentionClass, definition]))(
    '%s filters on timestamps and nullness only',
    (_name, definition) => {
      const clause = definition.where(NOW)
      const serialised = JSON.stringify(clause)

      // A clause that compared a column to a literal string would be a clause
      // that had been handed somebody's address to match against.
      expect(serialised).not.toMatch(/@/u)
      expect(serialised).not.toMatch(/contains|startsWith|endsWith|search/u)
    },
  )

  it('asks only whether session metadata is present, never what it says', () => {
    const definition = retentionClassByName('session_metadata')
    const clause = definition.where(NOW)

    expect(clause.OR).toEqual([{ userAgent: { not: null } }, { ipHash: { not: null } }])
  })

  it('excludes notification rows that predate organisation scoping', () => {
    // Those rows are unreachable by an organisation-scoped sweep. Excluding
    // them explicitly makes the gap a stated limitation rather than a silent
    // miss.
    const definition = retentionClassByName('notification_recipient')

    expect(definition.where(NOW).organizationId).toEqual({ not: null })
  })

  it('keys sessions on expiry rather than creation', () => {
    // A long-lived session that is still valid is not stale, however old.
    const definition = retentionClassByName('session')

    expect(definition.where(NOW)).toEqual({ expiresAt: { lt: NOW } })
  })

  it('counts against the class its own model, with its own clause', async () => {
    const prisma = countingPrisma(11)
    const definition = retentionClassByName('login_attempt')
    const olderThan = cutOffFor(definition, NOW)

    expect(await countCandidates(prisma, definition, olderThan)).toBe(11)
    expect(prisma.loginAttempt.count).toHaveBeenCalledWith({
      where: { createdAt: { lt: olderThan } },
    })
    // Counting one class must not reach into another's table.
    expect(prisma.session.count).not.toHaveBeenCalled()
    expect(prisma.notificationOutbox.count).not.toHaveBeenCalled()
  })
})

describe('cut-offs are computed from the proposal', () => {
  it.each([
    ['login_attempt', 30],
    ['session', 30],
    ['session_metadata', 90],
    ['notification_recipient', 30],
  ])('%s counts back %i days', (name, days) => {
    const definition = retentionClassByName(name)
    const cutOff = cutOffFor(definition, NOW)

    expect(definition.proposedDays).toBe(days)
    expect(NOW.getTime() - cutOff.getTime()).toBe(days * 24 * 60 * 60 * 1000)
  })

  it('records the cut-off it used on the sweep row', async () => {
    // So that a later change of proposal does not make an earlier run's
    // behaviour unexplainable.
    const definition = retentionClassByName('session_metadata')
    const row = await rehearseClass(countingPrisma(), definition, NOW)

    expect(row.olderThan).toEqual(cutOffFor(definition, NOW))
  })
})

describe('holds are counted, never resolved', () => {
  it('counts active holds for a subject-linked class', async () => {
    const prisma = countingPrisma(3)
    const definition = retentionClassByName('notification_recipient')

    expect(await countHeld(prisma, definition)).toBe(3)
    expect(prisma.privacyHold.count).toHaveBeenCalledWith({ where: { state: 'ACTIVE' } })
  })

  it('does not ask about holds for a class no hold can attach to', async () => {
    const prisma = countingPrisma()
    const definition = retentionClassByName('login_attempt')

    expect(await countHeld(prisma, definition)).toBe(0)
    expect(prisma.privacyHold.count).not.toHaveBeenCalled()
  })

  it('reports the held count on the sweep row', async () => {
    const row = await rehearseClass(
      countingPrisma(5),
      retentionClassByName('notification_recipient'),
      NOW,
    )

    expect(row.heldCount).toBe(5)
    expect(row.examinedCount).toBe(5)
  })
})

describe('what is not evaluated is said, not omitted', () => {
  it('reports export_artifact as not evaluated rather than sweeping it', () => {
    const names = RETENTION_CLASSES.map((definition) => definition.retentionClass)

    expect(names).not.toContain('export_artifact')
    expect(NOT_EVALUATED_CLASSES.map((entry) => entry.retentionClass)).toContain('export_artifact')
  })

  it('explains why, in terms of writers rather than emptiness', () => {
    // The distinction the reason has to carry: the table is empty because
    // nothing writes it, not because nothing in it is old enough. Those are
    // different findings and only one of them is about retention.
    const [entry] = NOT_EVALUATED_CLASSES

    expect(entry.reason).toMatch(/has ever written/iu)
    expect(entry.reason).toMatch(/no writer exists/iu)
  })
})

describe('the sweep row is shaped for the database that will refuse a bad one', () => {
  it('carries every column the constraints look at', async () => {
    const row = await rehearseClass(countingPrisma(), RETENTION_CLASSES[0], NOW)

    expect(Object.keys(row).sort()).toEqual(
      [
        'affectedCount',
        'examinedCount',
        'finishedAt',
        'heldCount',
        'mode',
        'olderThan',
        'retentionClass',
        'startedAt',
        'state',
      ].sort(),
    )
  })

  it('finishes in a terminal state', async () => {
    const row = await rehearseClass(countingPrisma(), RETENTION_CLASSES[0], NOW)

    expect(row.state).toBe('COMPLETED')
    expect(row.finishedAt).toBeInstanceOf(Date)
  })
})
