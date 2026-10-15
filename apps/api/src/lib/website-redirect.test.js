/**
 * The website link's rules, without a server: what the public is shown, what
 * an insider reads, how an address change is folded in, the administrators'
 * list filters, and the decision run inside a caller's transaction.
 */

import { describe, expect, it, vi } from 'vitest'

import { EVENT_STATUSES } from '@desi-event/schemas'

import {
  DELETED_STATUS,
  FORMER_ADMINISTRATOR_NAME,
  WEBSITE_REVIEWABLE_STATUSES,
  auditableAddress,
  decideWebsiteRedirect,
  deletedStatusExists,
  isTransactionClient,
  likeLiteral,
  publicWebsiteLink,
  websiteColumnsFor,
  websiteLinkOrder,
  websiteLinkWhere,
  websiteRedirectState,
  websiteRedirectTarget,
  websiteViewFor,
} from './website-redirect.js'

const A = 'https://rangoli.example/'
const B = 'https://rangoli-nights.example/'
const NOW = new Date('2026-10-05T12:00:00.000Z')
const EARLIER = new Date('2026-10-01T12:00:00.000Z')

/** An event row, public and with the link on for A. */
const ON = Object.freeze({
  id: 'ckv9w1p0a0000qz0l7h2k3m4n',
  organizationId: 'ckv9w1p0a0001qz0l7h2k3m4n',
  status: 'ON_SALE',
  websiteUrl: A,
  websiteRedirectEnabled: true,
  websiteDecidedUrl: A,
  websiteDecisionPending: false,
  websiteSubmittedAt: null,
  websiteRedirectChangedAt: EARLIER,
  websiteRedirectChangedById: 'ckv9w1p0a0002qz0l7h2k3m4n',
  websiteRedirectReason: 'Checked.',
  websiteRedirectChangedBy: { displayName: 'Anil Administrator' },
})

describe('publicWebsiteLink', () => {
  it('gives the decided address’s host while on, valid and public', () => {
    expect(publicWebsiteLink(ON)).toEqual({ host: 'rangoli.example' })
    expect(websiteRedirectTarget(ON)).toBe(A)
    expect(
      publicWebsiteLink({ ...ON, websiteDecidedUrl: 'https://www.rangoli.example/x' }),
    ).toEqual({ host: 'rangoli.example' })
  })

  it('goes to the decided address, not a newer one waiting', () => {
    const waiting = { ...ON, websiteUrl: B, websiteDecisionPending: true }

    expect(publicWebsiteLink(waiting)).toEqual({ host: 'rangoli.example' })
    expect(websiteRedirectTarget(waiting)).toBe(A)

    const cleared = { ...ON, websiteUrl: null, websiteDecisionPending: true }

    expect(websiteRedirectTarget(cleared)).toBe(A)
  })

  it('gives nothing while off, for a page that is not public, or an address that fails', () => {
    expect(publicWebsiteLink({ ...ON, websiteRedirectEnabled: false })).toBeNull()
    expect(publicWebsiteLink(null)).toBeNull()

    for (const status of [
      'DRAFT',
      'REVIEW_PENDING',
      'APPROVED',
      'REJECTED',
      'ARCHIVED',
      'DELETED',
    ]) {
      expect(publicWebsiteLink({ ...ON, status }), status).toBeNull()
    }

    for (const decided of [null, 'https://rangoli.example/?token=x', 'http://rangoli.example/']) {
      expect(publicWebsiteLink({ ...ON, websiteDecidedUrl: decided }), decided).toBeNull()
      expect(websiteRedirectTarget({ ...ON, websiteDecidedUrl: decided }), decided).toBeNull()
    }
  })
})

describe('websiteRedirectState', () => {
  it('reads the switch, with the deciding administrator’s name', () => {
    expect(websiteRedirectState(ON)).toEqual({
      enabled: true,
      pending: false,
      decidedUrl: A,
      submittedAt: null,
      changedAt: EARLIER,
      reason: 'Checked.',
      changedByName: 'Anil Administrator',
      websiteProblem: null,
    })
  })

  it('names a former administrator, and nobody before any decision', () => {
    expect(websiteRedirectState({ ...ON, websiteRedirectChangedBy: null }).changedByName).toBe(
      FORMER_ADMINISTRATOR_NAME,
    )
    expect(
      websiteRedirectState({
        ...ON,
        websiteRedirectEnabled: false,
        websiteDecidedUrl: null,
        websiteRedirectChangedAt: null,
        websiteRedirectChangedBy: null,
      }).changedByName,
    ).toBeNull()
  })

  it('says why a legacy address cannot be turned on', () => {
    expect(
      websiteRedirectState({ ...ON, websiteUrl: 'https://rangoli.example/?token=x' })
        .websiteProblem,
    ).toMatch(/token/u)
    expect(websiteRedirectState({ ...ON, websiteUrl: null }).websiteProblem).toBeNull()
  })
})

describe('websiteViewFor', () => {
  const event = { organizationId: ON.organizationId }

  it('separates the deciders, the insiders and everybody else', () => {
    expect(websiteViewFor({ id: 'a', role: 'ADMIN', memberships: [] }, event)).toBe('administrator')
    expect(websiteViewFor({ id: 's', role: 'SUPER_ADMIN', memberships: [] }, event)).toBe(
      'administrator',
    )
    expect(websiteViewFor({ id: 'm', role: 'MODERATOR', memberships: [] }, event)).toBe('insider')
    expect(
      websiteViewFor(
        {
          id: 'o',
          role: 'ORGANIZER',
          memberships: [{ organizationId: ON.organizationId, role: 'VIEWER' }],
        },
        event,
      ),
    ).toBe('insider')
    expect(
      websiteViewFor(
        {
          id: 'x',
          role: 'ORGANIZER',
          memberships: [{ organizationId: 'ckv9w1p0a0009qz0l7h2k3m4n', role: 'OWNER' }],
        },
        event,
      ),
    ).toBe('public')
    expect(websiteViewFor(null, event)).toBe('public')
  })
})

describe('websiteColumnsFor', () => {
  it.each([
    ['a first address', null, A, { websiteDecisionPending: true, websiteSubmittedAt: NOW }],
    [
      'no address on a new event',
      null,
      null,
      { websiteDecisionPending: false, websiteSubmittedAt: null },
    ],
    [
      'the approved address again',
      { websiteRedirectEnabled: true, websiteDecidedUrl: A },
      A,
      { websiteDecisionPending: false, websiteSubmittedAt: null },
    ],
    [
      'a new address while on',
      { websiteRedirectEnabled: true, websiteDecidedUrl: A },
      B,
      { websiteDecisionPending: true, websiteSubmittedAt: NOW },
    ],
    [
      'the address removed while on',
      { websiteRedirectEnabled: true, websiteDecidedUrl: A },
      null,
      { websiteDecisionPending: true, websiteSubmittedAt: NOW },
    ],
    [
      'the address removed while off and decided',
      { websiteRedirectEnabled: false, websiteDecidedUrl: A },
      null,
      { websiteDecisionPending: false, websiteSubmittedAt: null },
    ],
    [
      'a new address after a decided off',
      { websiteRedirectEnabled: false, websiteDecidedUrl: A },
      B,
      { websiteDecisionPending: true, websiteSubmittedAt: NOW },
    ],
    [
      'a further change while already waiting keeps its time',
      {
        websiteRedirectEnabled: false,
        websiteDecidedUrl: null,
        websiteDecisionPending: true,
        websiteSubmittedAt: EARLIER,
      },
      B,
      { websiteDecisionPending: true, websiteSubmittedAt: EARLIER },
    ],
  ])('%s', (_name, current, nextUrl, expected) => {
    expect(websiteColumnsFor(current, nextUrl, NOW)).toEqual({ websiteUrl: nextUrl, ...expected })
  })

  it('never names the switch, the decided address or the reason', () => {
    const columns = websiteColumnsFor(
      { websiteRedirectEnabled: true, websiteDecidedUrl: A },
      B,
      NOW,
    )

    expect(Object.keys(columns).sort()).toEqual([
      'websiteDecisionPending',
      'websiteSubmittedAt',
      'websiteUrl',
    ])
  })
})

describe('auditableAddress', () => {
  it('keeps a passing address whole, and drops the query and fragment of one that fails', () => {
    expect(auditableAddress(A)).toBe(A)
    expect(auditableAddress('https://rangoli.example/a?ref=x#tickets')).toBe(
      'https://rangoli.example/a?ref=x#tickets',
    )
    expect(auditableAddress('https://rangoli.example/a?token=secret#k')).toBe(
      'https://rangoli.example/a',
    )
    expect(auditableAddress(null)).toBeNull()
  })
})

describe('likeLiteral', () => {
  it('escapes the LIKE wildcards and the escape character, and nothing else', () => {
    expect(likeLiteral('a_b%c\\d')).toBe('a\\_b\\%c\\\\d')
    expect(likeLiteral('garba-night 2026')).toBe('garba-night 2026')
  })

  it('is what the list search sends', () => {
    expect(JSON.stringify(websiteLinkWhere({ state: 'all', q: 'a_b' }))).toContain('a\\\\_b')
  })
})

describe('the administrators’ list', () => {
  it('splits waiting from drafts by the event’s status', () => {
    expect([...WEBSITE_REVIEWABLE_STATUSES].sort()).toEqual(
      expect.arrayContaining(['REVIEW_PENDING', 'APPROVED', 'PUBLISHED', 'ON_SALE']),
    )
    expect(WEBSITE_REVIEWABLE_STATUSES.has('DRAFT')).toBe(false)

    const waiting = websiteLinkWhere({ state: 'waiting' })
    const drafts = websiteLinkWhere({ state: 'drafts' })

    expect(waiting.AND).toContainEqual({
      websiteDecisionPending: true,
      status: { in: expect.arrayContaining(['REVIEW_PENDING', 'ON_SALE']) },
    })
    expect(drafts.AND).toContainEqual({
      websiteDecisionPending: true,
      status: { notIn: expect.arrayContaining(['REVIEW_PENDING', 'ON_SALE']) },
    })
  })

  it('leaves deleted events out of every filter once the status exists', () => {
    const withDeleted = [...EVENT_STATUSES.filter((status) => status !== DELETED_STATUS), 'DELETED']
    const without = EVENT_STATUSES.filter((status) => status !== DELETED_STATUS)

    expect(deletedStatusExists(withDeleted)).toBe(true)
    expect(deletedStatusExists(without)).toBe(false)

    for (const state of ['waiting', 'drafts', 'on', 'off', 'all']) {
      expect(websiteLinkWhere({ state }, { statuses: withDeleted }).AND, state).toContainEqual({
        status: { not: 'DELETED' },
      })
      // Naming a status the database does not have would fail the query.
      expect(
        JSON.stringify(websiteLinkWhere({ state }, { statuses: without })),
        state,
      ).not.toContain('DELETED')
    }
  })

  it('orders waiting by how long it has waited, and decisions by the latest', () => {
    expect(websiteLinkOrder('waiting')).toEqual([{ websiteSubmittedAt: 'asc' }, { id: 'asc' }])
    expect(websiteLinkOrder('drafts')).toEqual([{ websiteSubmittedAt: 'asc' }, { id: 'asc' }])
    expect(websiteLinkOrder('on')).toEqual([{ websiteRedirectChangedAt: 'desc' }, { id: 'asc' }])
    expect(websiteLinkOrder('off')).toEqual([{ websiteRedirectChangedAt: 'desc' }, { id: 'asc' }])
    expect(websiteLinkOrder('all')).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }])
  })
})

describe('decideWebsiteRedirect inside a caller’s transaction', () => {
  it('runs in the transaction it is given and opens none of its own', async () => {
    const before = {
      ...ON,
      websiteUrl: B,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: true,
      websiteSubmittedAt: EARLIER,
      websiteRedirectChangedAt: null,
      websiteRedirectChangedBy: null,
    }
    const state = { event: { ...before }, audits: [] }
    const tx = {
      $queryRaw: vi.fn(async () => []),
      event: {
        findUnique: vi.fn(async () => ({ ...state.event })),
        updateMany: vi.fn(async ({ data }) => {
          Object.assign(state.event, data)

          return { count: 1 }
        }),
      },
      auditLog: {
        create: vi.fn(async ({ data }) => {
          state.audits.push(data)

          return data
        }),
      },
    }

    const decided = await decideWebsiteRedirect(tx, {
      eventId: ON.id,
      enabled: true,
      reason: 'Checked.',
      seenUrl: B,
      actor: { id: 'ckv9w1p0a0002qz0l7h2k3m4n', role: 'ADMIN' },
      now: NOW,
    })

    expect(isTransactionClient(tx)).toBe(true)
    // The row lock first, then the compare-and-set and the audit, in this client.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ON.id, websiteUrl: B }),
        data: expect.objectContaining({
          websiteRedirectEnabled: true,
          websiteDecidedUrl: B,
          websiteDecisionPending: false,
          websiteSubmittedAt: null,
          websiteRedirectChangedAt: NOW,
        }),
      }),
    )
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({
      action: 'event.website_redirect_changed',
      metadata: { enabled: true, previousPending: true, websiteUrl: B, platformRole: 'ADMIN' },
    })
    expect(decided.websiteRedirectEnabled).toBe(true)
  })

  it('opens its own transaction when given a client', async () => {
    const work = vi.fn()
    const client = {
      $disconnect: async () => {},
      $transaction: vi.fn(async (fn) => {
        work()

        return fn({
          $queryRaw: async () => [],
          event: {
            findUnique: async () => null,
          },
        })
      }),
    }

    await expect(
      decideWebsiteRedirect(client, {
        eventId: ON.id,
        enabled: false,
        reason: 'Checked.',
        seenUrl: null,
        actor: { id: 'a', role: 'ADMIN' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
