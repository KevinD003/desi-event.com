/**
 * The organiser's website link, through the routes: the address an organiser
 * saves, the switch only a platform administrator turns, the administrators'
 * list, the lookup behind the tracked redirect, and what every event payload
 * says about it.
 *
 * What only PostgreSQL can show — the CHECKs, the trigger, the row lock under
 * real concurrency — is in `website-redirect-integration.test.js`.
 *
 * @module @desi-event/api/tests/website-redirect
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '@desi-event/logger'

import { resetTrafficMemory } from '../src/lib/traffic.js'
import { FORMER_ADMINISTRATOR_NAME, decideWebsiteRedirect } from '../src/lib/website-redirect.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { auditRows, seedOrder } from './helpers/authoring-world.js'
import { cuid } from './helpers/prisma-stub.js'
import { minutesFromNow } from './helpers/fixtures.js'

const OWNER = 'owner@rangoli.example'
const MANAGER = 'arun@rangoli.example'
const ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const MODERATOR = 'maya@desi-event.example'
const OUTSIDER = 'rival@dhol.example'

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const SITE_A = 'https://rangoli.example/'
const SITE_B = 'https://rangoli-nights.example/'

beforeEach(() => resetTrafficMemory())

/**
 * The event row in the stub's store.
 *
 * @param {object} prisma The stub.
 * @param {string} id The event.
 * @returns {object} The row, live.
 */
function row(prisma, id) {
  return prisma._store.event.find((event) => event.id === id)
}

/**
 * Put an event's website columns into a state, as a decision would leave them.
 *
 * @param {object} prisma The stub.
 * @param {string} id The event.
 * @param {object} columns The columns to set.
 * @returns {object} The row.
 */
function setWebsite(prisma, id, columns) {
  return Object.assign(row(prisma, id), columns)
}

/**
 * The switch on for an address, decided by an administrator.
 *
 * @param {object} prisma The stub.
 * @param {string} id The event.
 * @param {string} url The address.
 * @param {string} adminId Who decided.
 * @returns {object} The row.
 */
function switchedOn(prisma, id, url, adminId) {
  return setWebsite(prisma, id, {
    websiteUrl: url,
    websiteRedirectEnabled: true,
    websiteDecidedUrl: url,
    websiteDecisionPending: false,
    websiteSubmittedAt: null,
    websiteRedirectChangedAt: new Date('2026-09-30T10:00:00.000Z'),
    websiteRedirectChangedById: adminId,
    websiteRedirectReason: 'Checked: the organiser’s own site.',
  })
}

/**
 * Sign in with a fresh second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} Headers.
 */
async function steppedUp(app, email = ADMIN) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * PATCH an event with its current revision.
 *
 * @param {object} app The app.
 * @param {object} prisma The stub.
 * @param {string} id The event.
 * @param {object} headers Who.
 * @param {object} patch The change.
 * @returns {Promise<object>} The response.
 */
function patchEvent(app, prisma, id, headers, patch) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/events/${id}`,
    headers,
    payload: { revision: row(prisma, id).revision, ...patch },
  })
}

/**
 * Ask for a decision on an event's website link.
 *
 * @param {object} app The app.
 * @param {string} id The event.
 * @param {object} headers Who.
 * @param {object} body The decision.
 * @returns {Promise<object>} The response.
 */
function decide(app, id, headers, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/moderation/events/${id}/website-redirect`,
    headers,
    payload: body,
  })
}

/**
 * Look up where an event's website link goes, as the web tier does.
 *
 * @param {object} app The app.
 * @param {object} body The lookup.
 * @param {object} [options] Options.
 * @param {object} [options.headers] Extra headers.
 * @param {string} [options.url] The path, with any query.
 * @returns {Promise<object>} The response.
 */
function visit(app, body, { headers = {}, url = '/v1/traffic/website-visits' } = {}) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'user-agent': CHROME,
      'content-type': 'application/json',
      'x-desi-client-address': '203.0.113.9',
      ...headers,
    },
    payload: body,
  })
}

/** A decision body. */
const on = (websiteUrl, reason = 'Checked: the organiser’s own site.') => ({
  enabled: true,
  reason,
  websiteUrl,
})
const off = (websiteUrl, reason = 'Turned off for the check.') => ({
  enabled: false,
  reason,
  websiteUrl,
})

describe('the organiser saves the address', () => {
  it('stores it normalised and waiting, and never moves the switch', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await patchEvent(app, prisma, ids.draftEvent.id, headers, {
      websiteUrl: 'HTTPS://Rangoli.Example',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.websiteUrl).toBe(SITE_A)
    expect(response.json().data.websiteRedirect).toMatchObject({
      enabled: false,
      pending: true,
      decidedUrl: null,
      changedByName: null,
    })
    expect(row(prisma, ids.draftEvent.id)).toMatchObject({
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
    })
    expect(row(prisma, ids.draftEvent.id).websiteSubmittedAt).toBeInstanceOf(Date)

    // The audit row names the field, never the address.
    const [audit] = auditRows(prisma, 'event.updated')

    expect(audit.metadata.fields).toContain('websiteUrl')
    expect(JSON.stringify(audit.metadata)).not.toContain('rangoli.example')

    await app.close()
  })

  it('refuses an http address and every switch key, and strips the rest', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    for (const patch of [
      { websiteUrl: 'http://rangoli.example/' },
      { websiteUrl: 'https://user:pass@rangoli.example/' },
      { title: 'T', websiteRedirectEnabled: true },
      { title: 'T', websiteRedirect: { enabled: true } },
      { title: 'T', websiteDecidedUrl: SITE_A },
    ]) {
      const response = await patchEvent(app, prisma, ids.draftEvent.id, headers, patch)

      expect(response.statusCode, JSON.stringify(patch)).toBe(400)
    }

    expect(row(prisma, ids.draftEvent.id)).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
    })

    // Stripped, never written: the switch and its decision stay the team's.
    const stripped = await patchEvent(app, prisma, ids.draftEvent.id, headers, {
      websiteUrl: SITE_A,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedById: ids.owner.id,
      websiteRedirectReason: 'I approve myself.',
    })

    expect(stripped.statusCode).toBe(200)
    expect(row(prisma, ids.draftEvent.id)).toMatchObject({
      websiteDecisionPending: true,
      websiteRedirectChangedById: null,
      websiteRedirectReason: null,
    })

    await app.close()
  })

  it('creates an event with its address waiting and the link off', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: {
        organizationId: ids.organization.id,
        title: 'Sharad Purnima Garba',
        summary: 'Garba under the full moon.',
        description: 'A night of garba.',
        category: 'GARBA_DANDIYA',
        startsAt: minutesFromNow(60 * 24 * 40).toISOString(),
        endsAt: minutesFromNow(60 * 24 * 40 + 240).toISOString(),
        websiteUrl: 'https://Rangoli.example',
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toMatchObject({
      websiteUrl: SITE_A,
      websiteLink: null,
      websiteRedirect: { enabled: false, pending: true },
    })
    expect(row(prisma, response.json().data.id)).toMatchObject({
      websiteRedirectEnabled: false,
      websiteDecisionPending: true,
    })

    await app.close()
  })
})

describe('an address change while the link is on', () => {
  it('keeps the link going to the approved address until an administrator decides', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    const owner = bearer(await signIn(app, MANAGER))

    const changed = await patchEvent(app, prisma, event.id, owner, { websiteUrl: SITE_B })

    expect(changed.statusCode, changed.body).toBe(200)
    // The organiser's edit moved nothing of the administrator's.
    expect(row(prisma, event.id)).toMatchObject({
      websiteUrl: SITE_B,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: true,
      websiteRedirectReason: 'Checked: the organiser’s own site.',
      websiteRedirectChangedById: ids.platformAdministrator.id,
    })
    expect(changed.json().data.websiteLink).toEqual({ host: 'rangoli.example' })
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(0)

    // The redirect still goes to the address an administrator looked at.
    const before = await visit(app, { slug: event.slug, counted: false })

    expect(before.json()).toEqual({ data: { url: SITE_A } })

    // Saving the same new address again keeps the moment it started waiting.
    const since = row(prisma, event.id).websiteSubmittedAt
    const again = await patchEvent(app, prisma, event.id, owner, { websiteUrl: SITE_B })

    expect(again.statusCode).toBe(200)
    expect(row(prisma, event.id).websiteSubmittedAt).toEqual(since)

    // Approving the new address switches the link to it.
    const admin = await steppedUp(app)
    const approved = await decide(app, event.id, admin, on(SITE_B))

    expect(approved.statusCode, approved.body).toBe(200)
    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_B,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
    })

    const after = await visit(app, { slug: event.slug, counted: false })

    expect(after.json()).toEqual({ data: { url: SITE_B } })

    await app.close()
  })

  it('keeps going to the approved address when the organiser removes theirs, until turned off', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    const owner = bearer(await signIn(app, MANAGER))

    const cleared = await patchEvent(app, prisma, event.id, owner, { websiteUrl: null })

    expect(cleared.statusCode, cleared.body).toBe(200)
    expect(row(prisma, event.id)).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: true,
    })
    expect((await visit(app, { slug: event.slug, counted: false })).json()).toEqual({
      data: { url: SITE_A },
    })

    // The administrator's screen shows no address; turning off decides that.
    const admin = await steppedUp(app)
    const turnedOff = await decide(app, event.id, admin, off(null))

    expect(turnedOff.statusCode, turnedOff.body).toBe(200)
    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
    })
    expect((await visit(app, { slug: event.slug, counted: false })).statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/moderation/events/:id/website-redirect', () => {
  it('is refused to anybody without website_redirect:manage, a moderator included', async () => {
    const { app, prisma, ids } = await createTestApp()

    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    const anonymous = await decide(app, ids.publishedEvent.id, {}, on(SITE_A))

    expect(anonymous.statusCode).toBe(401)

    for (const email of [OWNER, MANAGER, MODERATOR, OUTSIDER]) {
      const headers = bearer(await signIn(app, email))
      const response = await decide(app, ids.publishedEvent.id, headers, on(SITE_A))

      expect(response.statusCode, email).toBe(403)
      expect(response.json().error.code, email).not.toBe('STEP_UP_REQUIRED')
    }

    expect(row(prisma, ids.publishedEvent.id).websiteRedirectEnabled).toBe(false)
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(0)

    await app.close()
  })

  it('needs a second factor confirmed recently', async () => {
    const { app, prisma, ids } = await createTestApp()

    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    // Signing in with a second factor is a fresh confirmation; an hour on it is not.
    const stale = bearer(await signIn(app, ADMIN))

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const refused = await decide(app, ids.publishedEvent.id, stale, on(SITE_A))

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(row(prisma, ids.publishedEvent.id).websiteRedirectEnabled).toBe(false)

    await app.close()
  })

  it('refuses a privileged account with no second factor at all', async () => {
    const { app, prisma, ids } = await createTestApp()
    const admin = prisma._store.user.find((user) => user.email === ADMIN)

    // Remove the factor in place, so references held by the stub stay valid.
    for (let index = prisma._store.mfaFactor.length - 1; index >= 0; index -= 1) {
      if (prisma._store.mfaFactor[index].userId === admin.id) {
        prisma._store.mfaFactor.splice(index, 1)
      }
    }
    app.testEnrolledEmails.delete(ADMIN)

    const headers = bearer(await signIn(app, ADMIN))
    const response = await decide(app, ids.publishedEvent.id, headers, on(SITE_A))

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })

  it('turns the link on for the address seen, audited in full, without touching the revision', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date('2026-09-29T08:00:00.000Z'),
    })
    const revision = event.revision
    const headers = await steppedUp(app)

    const response = await decide(app, event.id, headers, on(SITE_A))

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, private')
    expect(response.json().data).toEqual({
      eventId: event.id,
      websiteUrl: SITE_A,
      websiteLink: { host: 'rangoli.example' },
      redirect: {
        enabled: true,
        pending: false,
        decidedUrl: SITE_A,
        submittedAt: null,
        changedAt: expect.any(String),
        reason: 'Checked: the organiser’s own site.',
        changedByName: 'Anil Administrator',
        websiteProblem: null,
      },
    })
    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedById: ids.platformAdministrator.id,
      revision,
    })

    const audits = auditRows(prisma, 'event.website_redirect_changed')

    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      entityType: 'Event',
      entityId: event.id,
      actorId: ids.platformAdministrator.id,
      metadata: {
        enabled: true,
        previousEnabled: false,
        previousPending: true,
        reason: 'Checked: the organiser’s own site.',
        websiteUrl: SITE_A,
        websiteHost: 'rangoli.example',
        previousDecidedUrl: null,
        platformRole: 'ADMIN',
        eventStatus: 'PUBLISHED',
      },
    })

    await app.close()
  })

  it('writes nothing for an address the organiser changed since the page was read', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_B,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })
    const headers = await steppedUp(app)

    for (const body of [on(SITE_A), off(SITE_A), off(null)]) {
      const response = await decide(app, event.id, headers, body)

      expect(response.statusCode, JSON.stringify(body)).toBe(409)
      expect(response.json().error.code).toBe('WEBSITE_CHANGED')
      // The address stored now, so the screen can say what it changed to.
      expect(response.json().error.details).toEqual({ currentWebsiteUrl: SITE_B })
    }

    // Turning on something that may not be turned on is a 422 first, as SPEC2
    // §4.W-A orders it, whatever address is stored now.
    const none = await decide(app, event.id, headers, on(null))

    expect(none.statusCode).toBe(422)
    expect(none.json().error.code).toBe('NO_WEBSITE')

    const failing = await decide(app, event.id, headers, on('https://rangoli.example/?token=abc'))

    expect(failing.statusCode).toBe(422)
    expect(failing.json().error.code).toBe('WEBSITE_NOT_ACCEPTABLE')

    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: true,
    })
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(0)

    await app.close()
  })

  it('says the address was removed when the organiser cleared it since the page was read', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    // The organiser clears the address; the link keeps going to SITE_A.
    setWebsite(prisma, event.id, {
      websiteUrl: null,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    const headers = await steppedUp(app)

    for (const body of [on(SITE_A), off(SITE_A)]) {
      const response = await decide(app, event.id, headers, body)

      expect(response.statusCode, JSON.stringify(body)).toBe(409)
      expect(response.json().error).toMatchObject({
        code: 'WEBSITE_CHANGED',
        details: { currentWebsiteUrl: null },
      })
    }

    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
    })
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(0)

    await app.close()
  })

  it('compares the exact stored string, so a legacy spelling is decided as it is stored', async () => {
    const { app, prisma, ids } = await createTestApp()
    // Carried by the migration with its path as written; normalising what the
    // administrator sends would make the compare-and-set never match.
    const legacy = 'https://rangoli.example/Nights/%7Eall'
    const event = setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: legacy,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })
    const headers = await steppedUp(app)

    const lowered = await decide(app, event.id, headers, on(legacy.toLowerCase()))

    expect(lowered.statusCode).toBe(409)
    expect(lowered.json().error.code).toBe('WEBSITE_CHANGED')

    const exact = await decide(app, event.id, headers, on(legacy))

    expect(exact.statusCode, exact.body).toBe(200)
    expect(row(prisma, event.id).websiteDecidedUrl).toBe(legacy)

    await app.close()
  })

  it('refuses to turn on with no address, or one that fails the rules (422)', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)

    const none = await decide(app, ids.publishedEvent.id, headers, on(null))

    expect(none.statusCode).toBe(422)
    expect(none.json().error.code).toBe('NO_WEBSITE')

    // A legacy row, carried by the migration with a key in it.
    const legacy = 'https://rangoli.example/?token=abc'

    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: legacy,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    const refused = await decide(app, ids.publishedEvent.id, headers, on(legacy))

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('WEBSITE_NOT_ACCEPTABLE')
    expect(refused.json().error.problems[0]).toMatch(/token/u)
    expect(row(prisma, ids.publishedEvent.id).websiteRedirectEnabled).toBe(false)

    // Deciding it off is allowed, and the audit row keeps no key.
    const decidedOff = await decide(app, ids.publishedEvent.id, headers, off(legacy))

    expect(decidedOff.statusCode, decidedOff.body).toBe(200)

    const [audit] = auditRows(prisma, 'event.website_redirect_changed')

    expect(audit.metadata.websiteUrl).toBe('https://rangoli.example/')
    expect(JSON.stringify(audit.metadata)).not.toContain('abc')

    await app.close()
  })

  it('answers a decision that changes nothing with 409 WEBSITE_REDIRECT_UNCHANGED', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    const headers = await steppedUp(app)

    const again = await decide(app, event.id, headers, on(SITE_A))

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('WEBSITE_REDIRECT_UNCHANGED')
    expect(again.json().error.details).toEqual({ enabled: true })

    const turnedOff = await decide(app, event.id, headers, off(SITE_A))

    expect(turnedOff.statusCode).toBe(200)
    expect(row(prisma, event.id)).toMatchObject({
      websiteRedirectEnabled: false,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: false,
    })

    const offAgain = await decide(app, event.id, headers, off(SITE_A))

    expect(offAgain.statusCode).toBe(409)
    expect(offAgain.json().error.code).toBe('WEBSITE_REDIRECT_UNCHANGED')
    expect(offAgain.json().error.details).toEqual({ enabled: false })
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(1)

    await app.close()
  })

  it('records a decided "off" for an address that was waiting', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })
    const headers = await steppedUp(app)

    const response = await decide(app, event.id, headers, off(SITE_A, 'Not the organiser’s site.'))

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.redirect).toMatchObject({
      enabled: false,
      pending: false,
      decidedUrl: SITE_A,
      reason: 'Not the organiser’s site.',
      changedByName: 'Anil Administrator',
    })

    const [audit] = auditRows(prisma, 'event.website_redirect_changed')

    expect(audit.metadata).toMatchObject({
      enabled: false,
      previousEnabled: false,
      previousPending: true,
    })

    await app.close()
  })

  it('refuses a body without a reason or the address seen, or with anything else', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)

    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    for (const body of [
      { enabled: true, websiteUrl: SITE_A },
      { enabled: true, reason: 'no', websiteUrl: SITE_A },
      { enabled: true, reason: 'x'.repeat(501), websiteUrl: SITE_A },
      { enabled: true, reason: 'Checked it.' },
      { ...on(SITE_A), organizationId: ids.organization.id },
      { reason: 'Checked it.', websiteUrl: SITE_A },
    ]) {
      const response = await decide(app, ids.publishedEvent.id, headers, body)

      expect(response.statusCode, JSON.stringify(body)).toBe(400)
    }

    expect(row(prisma, ids.publishedEvent.id).websiteRedirectEnabled).toBe(false)

    await app.close()
  })

  it('works in any state of the event, for a super administrator too, and 404s an unknown id', async () => {
    const { app, prisma, ids } = await createTestApp()
    const admin = await steppedUp(app)
    const superAdmin = await steppedUp(app, SUPER_ADMIN)

    for (const event of [
      ids.draftEvent,
      ids.reviewPendingEvent,
      ids.approvedEvent,
      ids.rejectedEvent,
    ]) {
      setWebsite(prisma, event.id, {
        websiteUrl: SITE_A,
        websiteDecisionPending: true,
        websiteSubmittedAt: new Date(),
      })

      const response = await decide(app, event.id, admin, on(SITE_A))

      expect(response.statusCode, event.status).toBe(200)
      // Turned on, but nothing published: the page is not public.
      expect(response.json().data.websiteLink, event.status).toBeNull()
    }

    row(prisma, ids.publishedEvent.id).status = 'CANCELLED'
    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    const bySuper = await decide(app, ids.publishedEvent.id, superAdmin, on(SITE_A))

    expect(bySuper.statusCode, bySuper.body).toBe(200)
    expect(bySuper.json().data.redirect.changedByName).toBe('Platform Ops')

    const unknown = await decide(app, cuid(), admin, on(SITE_A))

    expect(unknown.statusCode).toBe(404)

    await app.close()
  })

  it('runs inside a caller’s transaction without opening one of its own', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })
    const actor = { id: ids.platformAdministrator.id, role: 'ADMIN', memberships: [] }

    // The stub serialises transactions, so a nested one would never start:
    // finishing at all is the proof that none was opened.
    const decided = await prisma.$transaction((tx) =>
      decideWebsiteRedirect(tx, {
        eventId: event.id,
        enabled: true,
        reason: 'Tickets are sold on the organiser’s own page.',
        seenUrl: SITE_A,
        actor,
      }),
    )

    expect(decided.websiteRedirectEnabled).toBe(true)
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(1)

    // And it is undone with the caller's transaction.
    setWebsite(prisma, ids.draftEvent.id, {
      websiteUrl: SITE_B,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })

    await expect(
      prisma.$transaction(async (tx) => {
        await decideWebsiteRedirect(tx, {
          eventId: ids.draftEvent.id,
          enabled: true,
          reason: 'Checked.',
          seenUrl: SITE_B,
          actor,
        })

        throw new Error('the caller gives up')
      }),
    ).rejects.toThrow('the caller gives up')
    expect(row(prisma, ids.draftEvent.id).websiteRedirectEnabled).toBe(false)
    expect(auditRows(prisma, 'event.website_redirect_changed')).toHaveLength(1)

    await app.close()
  })

  it('refuses a deleted event, so a restore brings the switch back as it was', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    event.status = 'DELETED'

    const headers = await steppedUp(app)
    const response = await decide(app, event.id, headers, off(SITE_A))

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatchObject({
      code: 'NOT_EDITABLE',
      message: 'This event was deleted.',
    })
    expect(row(prisma, event.id).websiteRedirectEnabled).toBe(true)

    await app.close()
  })
})

describe('POST /v1/traffic/website-visits', () => {
  it('answers one identical 404 for every case where the link does not show', async () => {
    const { app, prisma, ids } = await createTestApp()

    // A draft with the switch on.
    switchedOn(prisma, ids.draftEvent.id, SITE_A, ids.platformAdministrator.id)
    // A public event with the switch off but an address.
    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date(),
    })
    // A public event whose approved address no longer passes the rules.
    switchedOn(
      prisma,
      ids.onlineEvent.id,
      'https://rangoli.example/?token=x',
      ids.platformAdministrator.id,
    )

    const answers = []

    for (const slug of [
      'no-such-event',
      ids.draftEvent.slug,
      ids.publishedEvent.slug,
      ids.onlineEvent.slug,
      ids.approvedEvent.slug,
    ]) {
      const response = await visit(app, { slug, counted: true })

      expect(response.statusCode, slug).toBe(404)
      expect(response.headers['cache-control'], slug).toBe('no-store, private')
      expect(response.headers['x-robots-tag'], slug).toBe('noindex, nofollow')

      const { code, message, statusCode } = response.json().error

      answers.push({ code, message, statusCode })
    }

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1)
    expect(prisma._store.trafficEvent).toHaveLength(0)

    await app.close()
  })

  it('answers the approved address, never one from the request, and counts the visit', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    const response = await visit(
      app,
      { slug: event.slug, counted: true },
      { url: '/v1/traffic/website-visits?to=https://evil.example/' },
    )

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ data: { url: SITE_A } })
    expect(response.headers['cache-control']).toBe('no-store, private')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.headers['set-cookie']).toBeUndefined()

    expect(prisma._store.trafficEvent).toHaveLength(1)

    const [stored] = prisma._store.trafficEvent

    expect(stored).toMatchObject({
      eventId: event.id,
      kind: 'WEBSITE_REDIRECT',
      placement: 'EVENT_PAGE',
      source: null,
    })
    // Nothing about the visitor but the day's code.
    expect(Object.keys(stored).sort()).toEqual(
      [
        'createdAt',
        'day',
        'dedupeKey',
        'eventId',
        'id',
        'kind',
        'placement',
        'source',
        'visitorHash',
      ]
        .filter((key) => key in stored)
        .sort(),
    )
    expect(JSON.stringify(stored)).not.toContain('203.0.113.9')

    // A destination in the body is refused, never read.
    const forged = await visit(app, {
      slug: event.slug,
      counted: true,
      url: 'https://evil.example/',
    })

    expect(forged.statusCode).toBe(400)

    await app.close()
  })

  it('counts nothing when the web tier says not to, for a robot, or past the ceiling', async () => {
    const { app, prisma, ids } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        websiteVisit: { eventMax: 2 },
      },
    })
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    const notCounted = await visit(app, { slug: event.slug, counted: false })

    expect(notCounted.statusCode).toBe(200)
    expect(prisma._store.trafficEvent).toHaveLength(0)

    const robot = await visit(
      app,
      { slug: event.slug, counted: true },
      { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } },
    )

    expect(robot.statusCode).toBe(200)
    expect(prisma._store.trafficEvent).toHaveLength(0)

    for (let i = 1; i <= 4; i += 1) {
      const response = await visit(
        app,
        { slug: event.slug, counted: true },
        { headers: { 'x-desi-client-address': `198.51.100.${i}` } },
      )

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ data: { url: SITE_A } })
    }

    // Two of four counted: the per-event ceiling was two this minute.
    expect(prisma._store.trafficEvent).toHaveLength(2)

    await app.close()
  })

  it('spends the per-event ceiling only on visits it counts, never on repeats or failures', async () => {
    const chunks = []
    const logger = createLogger({
      name: 'api',
      level: 'info',
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    const { app, prisma, ids } = await createTestApp({
      logger,
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        websiteVisit: { eventMax: 3 },
      },
    })
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    const from = (address, headers = {}) =>
      visit(
        app,
        { slug: event.slug, counted: true },
        { headers: { 'x-desi-client-address': address, ...headers } },
      )

    // One minute throughout, so the ceiling cannot start again between visits.
    vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 60_000) * 60_000 + 5_000 })

    try {
      // One visitor, then the same visitor clicking again and again: repeats
      // the database refuses.
      for (let i = 0; i < 4; i += 1) {
        expect((await from('198.51.100.1')).statusCode).toBe(200)
      }

      // A visit the database could not store.
      const createMany = prisma.trafficEvent.createMany

      prisma.trafficEvent.createMany = async () => {
        throw Object.assign(new Error('connection reset'), { code: 'P1017' })
      }

      try {
        expect((await from('198.51.100.2')).statusCode).toBe(200)
      } finally {
        prisma.trafficEvent.createMany = createMany
      }

      // A visitor with a privacy signal, whose repeat is folded in memory.
      for (let i = 0; i < 2; i += 1) {
        expect((await from('198.51.100.3', { 'sec-gpc': '1' })).statusCode).toBe(200)
      }

      // Seven tried, two counted: a new visitor still has a place.
      expect(prisma._store.trafficEvent).toHaveLength(2)
      expect((await from('198.51.100.4')).statusCode).toBe(200)
      expect(prisma._store.trafficEvent).toHaveLength(3)

      // And the ceiling still holds once three are counted.
      expect((await from('198.51.100.5')).statusCode).toBe(200)
      expect(prisma._store.trafficEvent).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }

    const outcomes = chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => line.msg === 'website visit')
      .map((line) => line.outcome)

    expect(outcomes).toEqual([
      'RECORDED',
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
      'FAILED',
      'RECORDED',
      'DUPLICATE',
      'RECORDED',
      'CEILING',
    ])

    await app.close()
  })

  it('still answers when the visit cannot be stored, and logs neither the address nor the visitor', async () => {
    const chunks = []
    const logger = createLogger({
      name: 'api',
      level: 'debug',
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    const { app, prisma, ids } = await createTestApp({ logger })
    const event = switchedOn(
      prisma,
      ids.publishedEvent.id,
      'https://rangoli.example/distinctive-path',
      ids.platformAdministrator.id,
    )

    prisma.trafficEvent.createMany = async () => {
      throw Object.assign(new Error('connection reset'), { code: 'P1017' })
    }

    const response = await visit(
      app,
      { slug: event.slug, counted: true },
      { headers: { 'x-desi-client-address': '198.51.100.77' } },
    )

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { url: 'https://rangoli.example/distinctive-path' } })

    const lines = chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(lines.find((line) => line.msg === 'website visit not counted')).toMatchObject({
      eventId: event.id,
      code: 'P1017',
    })
    expect(lines.find((line) => line.msg === 'website visit')).toMatchObject({
      eventId: event.id,
      host: 'rangoli.example',
      outcome: 'FAILED',
    })

    const log = chunks.join('')

    for (const needle of ['distinctive-path', '198.51.100.77', 'Chrome/130']) {
      expect(log.includes(needle), needle).toBe(false)
    }

    await app.close()
  })

  it('has its own abuse ceiling per visitor, and refuses a foreign Origin', async () => {
    const { app, prisma, ids } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        websiteVisit: { max: 2, sharedMax: 3 },
      },
    })
    const event = switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    for (let i = 0; i < 2; i += 1) {
      expect((await visit(app, { slug: event.slug, counted: false })).statusCode).toBe(200)
    }

    const limited = await visit(app, { slug: event.slug, counted: false })

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('RATE_LIMITED')
    expect(limited.headers['retry-after']).toBeDefined()

    // Another visitor has a budget of their own.
    const other = await visit(
      app,
      { slug: event.slug, counted: false },
      { headers: { 'x-desi-client-address': '198.51.100.200' } },
    )

    expect(other.statusCode).toBe(200)

    const foreign = await visit(
      app,
      { slug: event.slug, counted: false },
      { headers: { origin: 'https://evil.example', 'x-desi-client-address': '198.51.100.201' } },
    )

    expect(foreign.statusCode).toBe(403)

    await app.close()
  })
})

describe('what every event payload says about the website link', () => {
  it('gives a stranger the host only, while on and public, and never the switch', async () => {
    const { app, prisma, ids } = await createTestApp()

    switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    const read = await app.inject({ method: 'GET', url: `/v1/events/${ids.publishedEvent.slug}` })
    const data = read.json().data

    expect(data.websiteLink).toEqual({ host: 'rangoli.example' })
    expect(data).not.toHaveProperty('websiteUrl')
    expect(data).not.toHaveProperty('websiteRedirect')
    expect(read.body).not.toContain('Anil Administrator')
    expect(read.body).not.toContain(SITE_A)

    // Off: no link at all.
    row(prisma, ids.publishedEvent.id).websiteRedirectEnabled = false
    row(prisma, ids.publishedEvent.id).websiteDecidedUrl = SITE_A

    const offRead = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.slug}`,
    })

    expect(offRead.json().data.websiteLink).toBeNull()

    await app.close()
  })

  it('gives the event’s own team, moderators and administrators the switch with the name', async () => {
    const { app, prisma, ids } = await createTestApp()

    switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)

    for (const email of [OWNER, MANAGER, MODERATOR, ADMIN, SUPER_ADMIN]) {
      const headers = bearer(await signIn(app, email))
      const read = await app.inject({
        method: 'GET',
        url: `/v1/events/${ids.publishedEvent.id}`,
        headers,
      })
      const data = read.json().data

      expect(data.websiteUrl, email).toBe(SITE_A)
      expect(data.websiteRedirect, email).toMatchObject({
        enabled: true,
        pending: false,
        decidedUrl: SITE_A,
        reason: 'Checked: the organiser’s own site.',
        changedByName: 'Anil Administrator',
      })
    }

    // An outsider is a stranger.
    const outsider = bearer(await signIn(app, OUTSIDER))
    const strange = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers: outsider,
    })

    expect(strange.json().data).not.toHaveProperty('websiteRedirect')

    await app.close()
  })

  it('names "An administrator at The Desi Events" once the deciding account is gone', async () => {
    const { app, prisma, ids } = await createTestApp()

    switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    // What ON DELETE SET NULL leaves behind.
    row(prisma, ids.publishedEvent.id).websiteRedirectChangedById = null

    const headers = bearer(await signIn(app, MANAGER))
    const read = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers,
    })

    expect(read.json().data.websiteRedirect.changedByName).toBe(FORMER_ADMINISTRATOR_NAME)
    expect(FORMER_ADMINISTRATOR_NAME).toBe('An administrator at The Desi Events')

    await app.close()
  })

  it('carries the insider view on every route that answers with the event detail', async () => {
    const { app, prisma, ids } = await createTestApp()

    for (const event of [ids.publishedEvent, ids.reviewPendingEvent, ids.draftEvent]) {
      setWebsite(prisma, event.id, {
        websiteUrl: SITE_A,
        websiteDecisionPending: true,
        websiteSubmittedAt: new Date(),
      })
    }

    const manager = bearer(await signIn(app, MANAGER))
    /** @type {Array<Array<*>>} Each route's id and its answer. */
    const answers = []

    answers.push([
      'events.get',
      await app.inject({ method: 'GET', url: `/v1/events/${ids.draftEvent.id}`, headers: manager }),
    ])
    answers.push([
      'events.update',
      await patchEvent(app, prisma, ids.draftEvent.id, manager, { title: 'Renamed' }),
    ])
    answers.push([
      'events.create',
      await app.inject({
        method: 'POST',
        url: '/v1/events',
        headers: manager,
        payload: {
          organizationId: ids.organization.id,
          title: 'A new night',
          summary: 'A night.',
          description: 'A night of garba.',
          category: 'GARBA_DANDIYA',
          startsAt: minutesFromNow(60 * 24 * 50).toISOString(),
          endsAt: minutesFromNow(60 * 24 * 50 + 240).toISOString(),
          websiteUrl: SITE_A,
        },
      }),
    ])
    answers.push([
      'events.withdrawReview (a lifecycle command)',
      await app.inject({
        method: 'POST',
        url: `/v1/events/${ids.reviewPendingEvent.id}/withdraw-review`,
        headers: manager,
        payload: {},
      }),
    ])

    // A moderator's decision answers with the event too.
    row(prisma, ids.reviewPendingEvent.id).status = 'REVIEW_PENDING'

    const moderator = bearer(await signIn(app, MODERATOR))

    answers.push([
      'moderation.decide',
      await app.inject({
        method: 'POST',
        url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
        headers: moderator,
        payload: {
          decision: 'reject',
          reason: 'Not a fit for the listing.',
          revision: row(prisma, ids.reviewPendingEvent.id).revision,
        },
      }),
    ])

    // And the reschedule of a postponed event, by its owner with a fresh factor.
    const owner = prisma._store.user.find((user) => user.email === OWNER)
    const template = prisma._store.mfaFactor.find((factor) => factor.type === 'TOTP')

    prisma._store.mfaFactor.push({ ...template, id: cuid(), userId: owner.id, lastUsedAt: null })
    app.testEnrolledEmails.add(OWNER)

    const postponed = row(prisma, ids.publishedEvent.id)

    postponed.status = 'POSTPONED'
    postponed.previousStartsAt = postponed.startsAt
    seedOrder(prisma, { eventId: postponed.id, ticketTypeId: ids.generalAdmission.id })

    const night = prisma._store.eventSession.find((session) => session.eventId === postponed.id)
    const ownerHeaders = await steppedUp(app, OWNER)
    const startsAt = minutesFromNow(60 * 24 * 90).toISOString()
    const endsAt = minutesFromNow(60 * 24 * 90 + 300).toISOString()

    answers.push([
      'events.reschedule',
      await app.inject({
        method: 'POST',
        url: `/v1/events/${postponed.id}/reschedule`,
        headers: ownerHeaders,
        payload: {
          revision: postponed.revision,
          startsAt,
          endsAt,
          sessions: [{ id: night.id, startsAt, endsAt }],
          resume: 'ON_SALE',
          confirm: true,
          reason: 'The venue is ready again.',
        },
      }),
    ])

    for (const [name, response] of answers) {
      expect(response.statusCode, `${name}: ${response.body}`).toBeLessThan(300)
      expect(response.json().data.websiteUrl, name).toBe(SITE_A)
      expect(response.json().data.websiteRedirect, name).toMatchObject({ pending: true })
    }

    await app.close()
  })
})

describe('GET /v1/moderation/website-links', () => {
  /**
   * The world with one event in each state.
   *
   * @returns {Promise<object>} The harness.
   */
  async function listWorld() {
    const harness = await createTestApp()
    const { prisma, ids } = harness
    const adminId = ids.platformAdministrator.id

    // Waiting: public, since longest; and under review, since later.
    setWebsite(prisma, ids.publishedEvent.id, {
      websiteUrl: SITE_A,
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    setWebsite(prisma, ids.reviewPendingEvent.id, {
      websiteUrl: 'https://awaiting.example/',
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date('2026-09-05T00:00:00.000Z'),
    })
    // A draft waiting: listed under drafts, not waiting.
    setWebsite(prisma, ids.draftEvent.id, {
      websiteUrl: 'https://secret-bollywood.example/',
      websiteDecisionPending: true,
      websiteSubmittedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    // On.
    switchedOn(prisma, ids.onlineEvent.id, 'https://masterclass.example/', adminId)
    // Decided off.
    setWebsite(prisma, ids.approvedEvent.id, {
      websiteUrl: 'https://approved.example/',
      websiteDecidedUrl: 'https://approved.example/',
      websiteRedirectChangedAt: new Date('2026-09-10T00:00:00.000Z'),
      websiteRedirectChangedById: adminId,
      websiteRedirectReason: 'Not the organiser’s site.',
    })

    return { ...harness, headers: await steppedUp(harness.app) }
  }

  /**
   * Read the list.
   *
   * @param {object} app The app.
   * @param {object} headers Who.
   * @param {string} [query] The query string.
   * @returns {Promise<object>} The response.
   */
  const list = (app, headers, query = '') =>
    app.inject({ method: 'GET', url: `/v1/moderation/website-links${query}`, headers })

  it('is refused to a moderator, an organiser and a stranger', async () => {
    const { app } = await listWorld()

    expect((await list(app, {})).statusCode).toBe(401)

    for (const email of [MODERATOR, OWNER]) {
      const response = await list(app, bearer(await signIn(app, email)))

      expect(response.statusCode, email).toBe(403)
    }

    await app.close()
  })

  it('lists each state, longest waiting first, with every address in full', async () => {
    const { app, ids, headers } = await listWorld()

    const waiting = await list(app, headers)

    expect(waiting.statusCode, waiting.body).toBe(200)
    expect(waiting.headers['cache-control']).toBe('no-store, private')
    expect(waiting.json().data.map((entry) => entry.eventId)).toEqual([
      ids.publishedEvent.id,
      ids.reviewPendingEvent.id,
    ])
    expect(waiting.json().data[0]).toMatchObject({
      slug: ids.publishedEvent.slug,
      title: ids.publishedEvent.title,
      status: 'PUBLISHED',
      organizationName: ids.organization.name,
      websiteUrl: SITE_A,
      websiteHost: 'rangoli.example',
      websiteDecidedUrl: null,
      pagePublic: true,
      redirect: { enabled: false, pending: true },
    })

    const ids_ = async (state) =>
      (await list(app, headers, `?state=${state}`)).json().data.map((entry) => entry.eventId)

    expect(await ids_('drafts')).toEqual([ids.draftEvent.id])
    expect(await ids_('on')).toEqual([ids.onlineEvent.id])
    expect(await ids_('off')).toEqual([ids.approvedEvent.id])
    expect((await ids_('all')).sort()).toEqual(
      [
        ids.publishedEvent.id,
        ids.reviewPendingEvent.id,
        ids.draftEvent.id,
        ids.onlineEvent.id,
        ids.approvedEvent.id,
      ].sort(),
    )

    const onRow = (await list(app, headers, '?state=on')).json().data[0]

    expect(onRow.redirect).toMatchObject({
      enabled: true,
      decidedUrl: 'https://masterclass.example/',
      changedByName: 'Anil Administrator',
    })

    await app.close()
  })

  it('searches the title, the web address and the website, and pages', async () => {
    const { app, ids, headers } = await listWorld()

    const byTitle = await list(app, headers, '?state=all&q=navratri')
    const bySlug = await list(app, headers, '?state=all&q=awaiting-a')
    const bySite = await list(app, headers, '?state=all&q=MASTERCLASS.example')

    expect(byTitle.json().data.map((entry) => entry.eventId)).toEqual([ids.publishedEvent.id])
    expect(bySlug.json().data.map((entry) => entry.eventId)).toEqual([ids.reviewPendingEvent.id])
    expect(bySite.json().data.map((entry) => entry.eventId)).toEqual([ids.onlineEvent.id])

    const paged = await list(app, headers, '?state=all&perPage=2&page=2')

    expect(paged.json().data).toHaveLength(2)
    expect(paged.json().pagination).toMatchObject({ page: 2, perPage: 2, total: 5 })

    for (const query of ['?q=a', '?q=ga%00rba', '?state=pending']) {
      expect((await list(app, headers, query)).statusCode, query).toBe(400)
    }

    await app.close()
  })
})

describe('the narrowed event in an organisation’s analytics', () => {
  it('carries the switch as the event’s team reads it, with the administrator’s name', async () => {
    const { app, prisma, ids } = await createTestApp()

    switchedOn(prisma, ids.publishedEvent.id, SITE_A, ids.platformAdministrator.id)
    row(prisma, ids.publishedEvent.id).websiteUrl = SITE_B
    row(prisma, ids.publishedEvent.id).websiteDecisionPending = true
    row(prisma, ids.publishedEvent.id).websiteSubmittedAt = new Date('2026-10-01T00:00:00.000Z')

    for (const email of [OWNER, ADMIN]) {
      const headers = bearer(await signIn(app, email))
      const response = await app.inject({
        method: 'GET',
        url: `/v1/analytics/summary?organizationId=${ids.organization.id}&eventId=${ids.publishedEvent.id}`,
        headers,
      })

      expect(response.statusCode, response.body).toBe(200)
      expect(response.json().data.traffic.event, email).toMatchObject({
        websiteLinkOn: true,
        websiteRedirect: {
          enabled: true,
          pending: true,
          decidedUrl: SITE_A,
          submittedAt: '2026-10-01T00:00:00.000Z',
          reason: 'Checked: the organiser’s own site.',
          changedByName: 'Anil Administrator',
          websiteProblem: null,
        },
      })
    }

    await app.close()
  })
})
