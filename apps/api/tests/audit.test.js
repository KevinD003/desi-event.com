/**
 * The audit writer, and the vocabulary it writes.
 *
 * There was no test file for `recordAudit` until Phase 3, and the gap had a
 * cost: `AUDIT_ACTIONS.VERIFICATION_DECIDED` was read by the moderation
 * decision route and never defined, so that call site passed
 * `action: undefined` into a NOT NULL column. Against real PostgreSQL the whole
 * transaction would have rolled back at a moderator's desk. It survived two
 * phases because the Prisma test double applies no required-column checks and
 * no integration suite covers that route.
 *
 * So these tests are in two halves. The first is about the writer refusing an
 * action it cannot store. The second is a source scan: every `AUDIT_ACTIONS.X`
 * written anywhere in the API must resolve to a string, which is the check that
 * would have caught the original defect the day it was introduced.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CONNECT_AUDIT_ACTIONS } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../src/lib/audit.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = path.resolve(HERE, '..', 'src')

/**
 * Every `.js` file under a directory.
 *
 * @param {string} dir Where to start.
 * @returns {string[]} Absolute paths.
 */
function sourceFiles(dir) {
  const found = []

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)

    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full))
      continue
    }
    if (full.endsWith('.js')) found.push(full)
  }

  return found
}

describe('recordAudit', () => {
  it('writes the row inside the client it is given', async () => {
    const prisma = createPrismaStub({})
    const actor = cuid()
    const entity = cuid()

    const row = await recordAudit(prisma, {
      action: AUDIT_ACTIONS.HOLD_RELEASED,
      entityType: 'TicketHold',
      entityId: entity,
      actorId: actor,
      metadata: { reason: 'expired' },
    })

    expect(row).toMatchObject({
      action: 'hold.released',
      entityType: 'TicketHold',
      entityId: entity,
      actorId: actor,
    })
    expect(prisma._store.auditLog).toHaveLength(1)
  })

  it('keeps a null actor, which means the system acted rather than a person', async () => {
    const prisma = createPrismaStub({})

    const row = await recordAudit(prisma, {
      action: AUDIT_ACTIONS.PAYMENT_TIMEOUT,
      entityType: 'Payment',
      entityId: cuid(),
    })

    expect(row.actorId).toBeNull()
  })

  it('refuses an action that is not there at all', async () => {
    const prisma = createPrismaStub({})

    // The exact shape of the original defect: a constant that was never defined
    // resolves to `undefined`, and `AuditLog.action` is NOT NULL.
    await expect(
      recordAudit(prisma, {
        action: AUDIT_ACTIONS.NOT_A_REAL_CONSTANT,
        entityType: 'Organization',
        entityId: cuid(),
      }),
    ).rejects.toThrow(/needs an action/)
    expect(prisma._store.auditLog).toHaveLength(0)
  })

  it('refuses a blank action', async () => {
    const prisma = createPrismaStub({})

    await expect(
      recordAudit(prisma, { action: '   ', entityType: 'Organization', entityId: cuid() }),
    ).rejects.toThrow(/needs an action/)
  })

  it('names the caller in the refusal, so the fix is obvious', async () => {
    const prisma = createPrismaStub({})
    const entity = cuid()

    await expect(
      recordAudit(prisma, { action: undefined, entityType: 'Organization', entityId: entity }),
    ).rejects.toThrow(new RegExp(entity))
  })
})

describe('AUDIT_ACTIONS', () => {
  it('resolves every constant the API actually writes', () => {
    const used = new Set()

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(file, 'utf8')

      // The lookbehind matters. Without it the pattern also matches the tail of
      // `CONNECT_AUDIT_ACTIONS.MOCK_STATE_ADVANCED`, and it then demands
      // `AUDIT_ACTIONS.MOCK_STATE_ADVANCED` — a name that was never meant to
      // exist. That is a scanner reporting a defect it invented, which costs
      // exactly as much attention as a real one. The companion test below
      // covers the other map by name rather than by accident.
      for (const match of source.matchAll(/(?<![A-Z0-9_])AUDIT_ACTIONS\.([A-Z][A-Z0-9_]*)/g)) {
        used.add(match[1])
      }
    }

    // Not a style check. A name in this set that is missing from the map is a
    // route that rolls its transaction back the first time somebody uses it.
    const missing = [...used].filter((name) => typeof AUDIT_ACTIONS[name] !== 'string').sort()

    expect(missing, `referenced but not defined: ${missing.join(', ')}`).toEqual([])
    expect(used.size).toBeGreaterThan(20)
  })

  it('resolves every CONNECT_AUDIT_ACTIONS constant the API writes', () => {
    // The same check for the shared connect vocabulary, which `audit.js` reads
    // to build its own `CONNECT_MOCK_*` entries. Sharpening the pattern above
    // would otherwise have left this map scanned by nothing.
    const used = new Set()

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(file, 'utf8')

      for (const match of source.matchAll(/CONNECT_AUDIT_ACTIONS\.([A-Z][A-Z0-9_]*)/g)) {
        used.add(match[1])
      }
    }

    const missing = [...used]
      .filter((name) => typeof CONNECT_AUDIT_ACTIONS[name] !== 'string')
      .sort()

    expect(missing, `referenced but not defined: ${missing.join(', ')}`).toEqual([])
    expect(used.size).toBeGreaterThan(0)
  })

  it('carries the simulated connected-account vocabulary, sourced from the shared module', () => {
    // Two maps, one set of strings. A literal spelled again in audit.js would
    // be a second thing to keep in step, and the first symptom of it drifting
    // would be an audit query that quietly matches nothing.
    expect(AUDIT_ACTIONS.CONNECT_MOCK_ACCOUNT_CREATED).toBe(
      CONNECT_AUDIT_ACTIONS.MOCK_ACCOUNT_CREATED,
    )
    expect(AUDIT_ACTIONS.CONNECT_MOCK_STATE_ADVANCED).toBe(
      CONNECT_AUDIT_ACTIONS.MOCK_STATE_ADVANCED,
    )
    expect(AUDIT_ACTIONS.CONNECT_MOCK_ACTION_REFUSED).toBe(
      CONNECT_AUDIT_ACTIONS.MOCK_ACTION_REFUSED,
    )
    expect(AUDIT_ACTIONS.CONNECT_MOCK_START_REPLAYED).toBe(
      CONNECT_AUDIT_ACTIONS.MOCK_START_REPLAYED,
    )
  })

  it('spells every action as a dotted subject and verb phrase', () => {
    for (const [name, value] of Object.entries(AUDIT_ACTIONS)) {
      expect(value, `${name} is not dotted`).toMatch(/^[a-z][A-Za-z0-9]*\.[a-z][a-z0-9_]*$/)
    }
  })

  it('has no two names sharing one action string', () => {
    const values = Object.values(AUDIT_ACTIONS)

    expect(new Set(values).size).toBe(values.length)
  })

  it('carries the privacy vocabulary Phase 3 writes', () => {
    // The redaction actions are also written to `PrivacyAuditEvent`, which is
    // immutable at the database and carries them as columns. These exist so the
    // audit surface an operator already reads does not go quiet about the most
    // consequential action the system can take.
    expect(AUDIT_ACTIONS.PRIVACY_REQUEST_RAISED).toBe('privacy.request_raised')
    expect(AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED).toBe('privacy.request_refused')
    expect(AUDIT_ACTIONS.PRIVACY_REDACTION_COMPLETED).toBe('privacy.redaction_completed')
    expect(AUDIT_ACTIONS.PRIVACY_REDACTION_FAILED_SAFE).toBe('privacy.redaction_failed_safe')
    expect(AUDIT_ACTIONS.PRIVACY_HOLD_PLACED).toBe('privacy.hold_placed')
  })

  it('defines the verification decision it was silently missing', () => {
    expect(AUDIT_ACTIONS.VERIFICATION_DECIDED).toBe('organization.verification_decided')
  })

  it('is frozen, so a caller cannot add one at runtime', () => {
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true)
    expect(() => {
      AUDIT_ACTIONS.INVENTED = 'made.up'
    }).toThrow(TypeError)
  })
})
