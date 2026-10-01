/**
 * Probes for the invariants the invite-only organisers, the review gate, the
 * event website link and visit counting rest on (SPEC2), held by the database
 * on its own.
 *
 * The API refuses each of these before it writes, but the API is one writer
 * among several — a seed, a migration, an importer, an operator at a `psql`
 * prompt. These probes are the evidence that the rules hold without it:
 *
 *   - **The review gate.** `desi_event_status_requires_review` refuses a move
 *     into APPROVED except from REVIEW_PENDING, and a move into a public status
 *     except from APPROVED or another public status.
 *   - **Posting roles.** A waiting team invitation offers only FINANCE, STAFF,
 *     SCANNER or VIEWER (`invitation_pending_role_is_owner_grantable`).
 *   - **Organiser invitations.** One waiting invitation per address, addresses
 *     stored lower-cased, an https website, an organisation only once accepted,
 *     and one membership per invitation.
 *   - **The website switch.** An address has the stored shape; the switch is on
 *     only about a decided address; `socialLinks` carries no website; and an
 *     address changed under an ON switch waits for a decision while the link
 *     keeps going to the decided address (`desi_event_website_change`).
 *   - **Visits.** The shape CHECKs on counted moments, daily totals, the salt
 *     and the roll-up's single state row, and the cascade from an event.
 *
 * Every probe runs inside a transaction that is always rolled back, against a
 * disposable database `verify-fresh-database.mjs` created and will destroy. A
 * refusal counts only when it names the constraint, index or trigger being
 * probed, so a probe cannot pass on some other rule's error.
 *
 * @module @desi-event/db/scripts/platform-feature-probes
 */

import { createHash, randomUUID } from 'node:crypto'

/** A day in the future, so no probe event is in the past. */
const DAY_MS = 86_400_000

/**
 * A value no other probe row has.
 *
 * @param {string} label What the value is for.
 * @returns {string} A distinct, slug-safe string.
 */
function unique(label) {
  return `probe-${label}-${randomUUID().slice(0, 8)}`
}

/**
 * A SHA-256-shaped digest, distinct per call.
 *
 * @returns {string} 64 lower-case hex characters.
 */
function digest() {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

/**
 * A minimal event in one organisation, which a probe then moves or breaks.
 *
 * @param {object} tx A transaction client.
 * @param {string} organizationId The organisation.
 * @param {object} [overrides] Field overrides.
 * @returns {Promise<object>} The event row.
 */
function probeEvent(tx, organizationId, overrides = {}) {
  return tx.event.create({
    data: {
      organizationId,
      title: 'Probe event',
      slug: unique('event'),
      summary: 'A probe event.',
      description: 'A probe event, rolled back with its transaction.',
      category: 'COMEDY',
      startsAt: new Date(Date.now() + 10 * DAY_MS),
      endsAt: new Date(Date.now() + 10 * DAY_MS + 3_600_000),
      ...overrides,
    },
  })
}

/**
 * A waiting organiser invitation, which a probe then breaks in one way.
 *
 * @param {string} invitedById The inviting administrator.
 * @param {object} [overrides] Field overrides.
 * @returns {object} `OrganizerInvitation` create data.
 */
function organiserInvitation(invitedById, overrides = {}) {
  return {
    email: 'probe.organiser@example.test',
    organizationName: 'Probe Organisers',
    tokenHash: digest(),
    invitedById,
    deliveryMode: 'MANUAL',
    expiresAt: new Date(Date.now() + 14 * DAY_MS),
    ...overrides,
  }
}

/** A UTC calendar day, as the traffic tables store it. */
const TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)

/**
 * A counted page view, which a probe then breaks in one way.
 *
 * @param {string} eventId The event.
 * @param {object} [overrides] Field overrides.
 * @returns {object} `TrafficEvent` create data.
 */
function pageView(eventId, overrides = {}) {
  return {
    eventId,
    kind: 'PAGE_VIEW',
    placement: 'EVENT_PAGE',
    source: 'DIRECT',
    day: TODAY,
    visitorHash: 'a'.repeat(32),
    dedupeKey: digest(),
    ...overrides,
  }
}

/**
 * Run the probes.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @param {object} helpers The verifier's own helpers.
 * @param {Function} helpers.probe `probe(prisma, name, expected, write)`: runs `write` in a rolled-back transaction.
 * @param {Function} helpers.record `record(name, ok, detail)`: records one step.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
export async function runPlatformFeatureProbes(prisma, { probe, record }) {
  const [organization, user] = await Promise.all([
    prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }),
  ])

  if (!organization || !user) {
    return record('the platform feature probes have the seeded rows they need', false, {
      note: 'the seed did not produce an organisation and a user',
    })
  }

  const results = []
  const gate = /event_public_requires_review/

  // -------------------------------------------------------------------------
  // The review gate.
  // -------------------------------------------------------------------------

  results.push(
    await probe(prisma, 'a draft cannot become public without review', gate, async (tx) => {
      const event = await probeEvent(tx, organization.id)

      await tx.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } })
    }),
  )
  results.push(
    await probe(prisma, 'a draft cannot become approved without review', gate, async (tx) => {
      const event = await probeEvent(tx, organization.id)

      await tx.event.update({ where: { id: event.id }, data: { status: 'APPROVED' } })
    }),
  )
  results.push(
    await probe(prisma, 'a rejected event cannot become public', gate, async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'REJECTED' })

      await tx.event.update({ where: { id: event.id }, data: { status: 'ON_SALE' } })
    }),
  )
  results.push(
    await probe(
      prisma,
      'an event reviewed, approved and published moves on between public statuses',
      null,
      async (tx) => {
        const event = await probeEvent(tx, organization.id, { status: 'REVIEW_PENDING' })

        for (const status of ['APPROVED', 'PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'DRAFT']) {
          await tx.event.update({ where: { id: event.id }, data: { status } })
        }
      },
    ),
  )

  // -------------------------------------------------------------------------
  // Posting roles and organiser invitations.
  // -------------------------------------------------------------------------

  const teamInvitation = (role) => ({
    organizationId: organization.id,
    email: `${unique('invitee')}@example.test`,
    role,
    tokenHash: digest(),
    invitedById: user.id,
    deliveryMode: 'MANUAL',
    expiresAt: new Date(Date.now() + DAY_MS),
  })

  results.push(
    await probe(
      prisma,
      'a waiting team invitation cannot offer a role that posts events',
      /invitation_pending_role_is_owner_grantable/,
      (tx) => tx.invitation.create({ data: teamInvitation('ADMIN') }),
    ),
  )
  results.push(
    await probe(prisma, 'a waiting team invitation may offer FINANCE', null, (tx) =>
      tx.invitation.create({ data: teamInvitation('FINANCE') }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'two waiting organiser invitations to one address are refused',
      /OrganizerInvitation_one_pending_per_address/,
      async (tx) => {
        await tx.organizerInvitation.create({ data: organiserInvitation(user.id) })
        await tx.organizerInvitation.create({ data: organiserInvitation(user.id) })
      },
    ),
  )
  results.push(
    await probe(
      prisma,
      'two waiting organiser invitations to one address in different case are refused',
      /organizer_invitation_email_lower/,
      async (tx) => {
        await tx.organizerInvitation.create({ data: organiserInvitation(user.id) })
        await tx.organizerInvitation.create({
          data: organiserInvitation(user.id, { email: 'Probe.Organiser@example.test' }),
        })
      },
    ),
  )
  results.push(
    await probe(
      prisma,
      'an organiser invitation replaced by a new code frees the address',
      null,
      async (tx) => {
        const first = await tx.organizerInvitation.create({ data: organiserInvitation(user.id) })

        await tx.organizerInvitation.update({
          where: { id: first.id },
          data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
        })
        await tx.organizerInvitation.create({
          data: organiserInvitation(user.id, { supersedesId: first.id }),
        })
      },
    ),
  )
  results.push(
    await probe(
      prisma,
      "an organiser invitation's website must be https",
      /organizer_invitation_website_shape/,
      (tx) =>
        tx.organizerInvitation.create({
          data: organiserInvitation(user.id, { organizationWebsiteUrl: 'http://a.example/' }),
        }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'an organiser invitation names an organisation only once accepted',
      /organizer_invitation_org_only_when_accepted/,
      (tx) =>
        tx.organizerInvitation.create({
          data: organiserInvitation(user.id, { organizationId: organization.id }),
        }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'an accepted organiser invitation names the organisation it created',
      null,
      (tx) =>
        tx.organizerInvitation.create({
          data: organiserInvitation(user.id, {
            organizationId: organization.id,
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedByUserId: user.id,
          }),
        }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'a second membership with the same organiser invitation is refused',
      /Membership_organizerInvitationId_key/,
      async (tx) => {
        const invitation = await tx.organizerInvitation.create({
          data: organiserInvitation(user.id),
        })
        const others = await Promise.all(
          ['a', 'b'].map((suffix) =>
            tx.user.create({
              data: {
                email: `${unique(`member-${suffix}`)}@example.test`,
                passwordHash: 'probe',
                displayName: 'Probe member',
              },
            }),
          ),
        )

        for (const other of others) {
          await tx.membership.create({
            data: {
              userId: other.id,
              organizationId: organization.id,
              role: 'OWNER',
              organizerInvitationId: invitation.id,
            },
          })
        }
      },
    ),
  )

  // -------------------------------------------------------------------------
  // The event website link.
  // -------------------------------------------------------------------------

  const decided = (url) => ({
    websiteUrl: url,
    websiteDecidedUrl: url,
    websiteRedirectEnabled: true,
    websiteRedirectChangedAt: new Date(),
    websiteRedirectChangedById: user.id,
    websiteRedirectReason: 'Checked by the probe.',
  })

  results.push(
    await probe(prisma, 'an event website address must be https', /event_website_url_shape/, (tx) =>
      probeEvent(tx, organization.id, { websiteUrl: 'http://x.example/' }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'an event website address carries no sign-in',
      /event_website_url_shape/,
      (tx) => probeEvent(tx, organization.id, { websiteUrl: 'https://user@x.example/' }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'a decided website address has the stored shape too',
      /event_website_url_shape/,
      (tx) => probeEvent(tx, organization.id, decided('https://X.example/')),
    ),
  )
  results.push(
    await probe(
      prisma,
      'a website link cannot be on without a decided address',
      /event_website_redirect_consistency/,
      (tx) =>
        probeEvent(tx, organization.id, {
          ...decided('https://a.example/'),
          websiteDecidedUrl: null,
        }),
    ),
  )
  results.push(
    await probe(prisma, 'social links cannot carry a website', /event_social_links_shape/, (tx) =>
      probeEvent(tx, organization.id, { socialLinks: { website: 'https://a.example/' } }),
    ),
  )
  results.push(
    await probe(prisma, 'a new website address waits for a decision', null, async (tx) => {
      const event = await probeEvent(tx, organization.id, { websiteUrl: 'https://a.example/' })
      const row = await tx.event.findUnique({ where: { id: event.id } })

      if (!row.websiteDecisionPending || !row.websiteSubmittedAt || row.websiteRedirectEnabled) {
        throw new Error(
          `pending=${row.websiteDecisionPending} submittedAt=${row.websiteSubmittedAt} ` +
            `enabled=${row.websiteRedirectEnabled}`,
        )
      }
    }),
  )
  results.push(
    await probe(
      prisma,
      'an address changed while the link is on waits, and the link keeps its decided address',
      null,
      async (tx) => {
        const event = await probeEvent(tx, organization.id, decided('https://a.example/'))
        const before = await tx.event.findUnique({ where: { id: event.id } })

        if (before.websiteDecisionPending || before.websiteSubmittedAt !== null) {
          throw new Error('a decided address was left waiting')
        }

        // Raw SQL, as any writer other than the API would do it.
        await tx.$executeRaw`UPDATE "Event" SET "websiteUrl" = 'https://b.example/' WHERE "id" = ${event.id}`

        const after = await tx.event.findUnique({ where: { id: event.id } })
        const held =
          after.websiteRedirectEnabled === true &&
          after.websiteDecidedUrl === 'https://a.example/' &&
          after.websiteRedirectReason === 'Checked by the probe.' &&
          after.websiteDecisionPending === true &&
          after.websiteSubmittedAt !== null

        if (!held) {
          throw new Error(
            `enabled=${after.websiteRedirectEnabled} decided=${after.websiteDecidedUrl} ` +
              `pending=${after.websiteDecisionPending} submittedAt=${after.websiteSubmittedAt}`,
          )
        }

        // Clearing the address while the link is on is still something to decide.
        await tx.$executeRaw`UPDATE "Event" SET "websiteUrl" = NULL WHERE "id" = ${event.id}`

        const cleared = await tx.event.findUnique({ where: { id: event.id } })

        if (!cleared.websiteDecisionPending || !cleared.websiteRedirectEnabled) {
          throw new Error('an address cleared under an ON switch stopped waiting')
        }
      },
    ),
  )

  // -------------------------------------------------------------------------
  // Visits.
  // -------------------------------------------------------------------------

  /**
   * A visits probe on its own event.
   *
   * @param {string} name What the probe proves.
   * @param {RegExp|null} expected The refusal it must meet, or null.
   * @param {Function} write Receives the transaction and the event.
   * @returns {Promise<boolean>} Whether the database behaved as required.
   */
  const visits = (name, expected, write) =>
    probe(prisma, name, expected, async (tx) => {
      const event = await probeEvent(tx, organization.id, { status: 'REVIEW_PENDING' })

      await write(tx, event)
    })

  const daily = (eventId, overrides = {}) => ({
    eventId,
    day: TODAY,
    computedAt: new Date(),
    ...overrides,
  })

  results.push(
    await visits('a click carries no source', /traffic_event_source_only_on_views/, (tx, event) =>
      tx.trafficEvent.create({
        data: pageView(event.id, { kind: 'CARD_CLICK', placement: 'HOME', source: 'SEARCH' }),
      }),
    ),
  )
  results.push(
    await visits('a page view has a source', /traffic_event_source_only_on_views/, (tx, event) =>
      tx.trafficEvent.create({ data: pageView(event.id, { source: null }) }),
    ),
  )
  results.push(
    await visits(
      'a card click happens on a listing',
      /traffic_event_placement_fits_kind/,
      (tx, event) =>
        tx.trafficEvent.create({
          data: pageView(event.id, { kind: 'CARD_CLICK', placement: 'EVENT_PAGE', source: null }),
        }),
    ),
  )
  results.push(
    await visits('a visitor code is a digest', /traffic_event_visitor_hash_shape/, (tx, event) =>
      tx.trafficEvent.create({ data: pageView(event.id, { visitorHash: '203.0.113.9' }) }),
    ),
  )
  results.push(
    await visits(
      'a dedupe digest comes with a visitor code',
      /traffic_event_dedupe_key_shape/,
      (tx, event) => tx.trafficEvent.create({ data: pageView(event.id, { visitorHash: null }) }),
    ),
  )
  results.push(
    await visits(
      'a visit is counted once per visitor per slot',
      /TrafficEvent_dedupeKey_key|dedupeKey/,
      async (tx, event) => {
        const dedupeKey = digest()

        await tx.trafficEvent.create({ data: pageView(event.id, { dedupeKey }) })
        await tx.trafficEvent.create({ data: pageView(event.id, { dedupeKey }) })
      },
    ),
  )
  results.push(
    await visits('a counted visit of each kind is accepted', null, async (tx, event) => {
      await tx.trafficEvent.create({ data: pageView(event.id) })
      await tx.trafficEvent.create({
        data: pageView(event.id, { kind: 'CARD_CLICK', placement: 'SEARCH', source: null }),
      })
      await tx.trafficEvent.create({
        data: pageView(event.id, { kind: 'WEBSITE_REDIRECT', source: null }),
      })
      await tx.trafficEvent.create({
        data: pageView(event.id, { visitorHash: null, dedupeKey: null, source: 'SOCIAL' }),
      })
    }),
  )
  results.push(
    await visits(
      'daily sources add up to page views',
      /traffic_daily_sources_add_up/,
      (tx, event) =>
        tx.trafficDaily.create({ data: daily(event.id, { views: 3, viewsDirect: 1 }) }),
    ),
  )
  results.push(
    await visits(
      'daily card clicks add up to their three places',
      /traffic_daily_placements_add_up/,
      (tx, event) =>
        tx.trafficDaily.create({ data: daily(event.id, { cardClicks: 2, cardClicksHome: 1 }) }),
    ),
  )
  results.push(
    await visits(
      'daily visitors cannot exceed page views',
      /traffic_daily_visitors_within_views/,
      (tx, event) =>
        tx.trafficDaily.create({
          data: daily(event.id, { views: 1, viewsDirect: 1, visitors: 2 }),
        }),
    ),
  )
  results.push(
    await probe(prisma, 'a salt is 32 random bytes as hex', /traffic_salt_shape/, (tx) =>
      tx.trafficSalt.create({ data: { day: new Date('2001-01-01T00:00:00Z'), salt: 'abc' } }),
    ),
  )
  results.push(
    await probe(prisma, 'there is one roll-up state row', /traffic_rollup_state_singleton/, (tx) =>
      tx.trafficRollupState.create({ data: { id: 'other' } }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'a lease has an owner and an expiry together',
      /traffic_rollup_state_lease_pair/,
      (tx) =>
        tx.trafficRollupState.update({
          where: { id: 'traffic-rollup' },
          data: { leaseOwner: 'probe-worker', leaseExpiresAt: null },
        }),
    ),
  )
  results.push(
    await visits('deleting an event deletes its visits', null, async (tx, event) => {
      await tx.trafficEvent.create({ data: pageView(event.id) })
      await tx.trafficDaily.create({
        data: daily(event.id, { views: 1, viewsDirect: 1, visitors: 1 }),
      })
      await tx.event.delete({ where: { id: event.id } })

      const [raw, totals] = await Promise.all([
        tx.trafficEvent.count({ where: { eventId: event.id } }),
        tx.trafficDaily.count({ where: { eventId: event.id } }),
      ])

      if (raw !== 0 || totals !== 0) {
        throw new Error(`${raw} visit(s) and ${totals} daily row(s) outlived their event`)
      }
    }),
  )

  return results.every(Boolean)
}
