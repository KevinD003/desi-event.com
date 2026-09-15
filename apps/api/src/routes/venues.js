/**
 * Venues: the places events happen.
 *
 * The authorisation model here is unusual in this codebase and worth stating,
 * because it is not simply "your organisation's rows are yours".
 *
 * A venue may be **shared** — `organizationId` is null — and a shared venue is
 * readable by everybody, editable only by platform staff. The alternative is
 * what ticketing sites actually end up with: eleven copies of the same hall,
 * each created by a different promoter, none of which carries the accessibility
 * note that took somebody a phone call to establish. So sharing is the default
 * a moderator can offer, an organisation can still keep its own record, and
 * `venues.merge` exists for when duplicates appear anyway.
 *
 * Merging never deletes. Events, orders and tickets point at a venue row, and
 * deleting one turns somebody's ticket into a booking with no address. The
 * duplicate is kept and marked, and reads follow the pointer.
 *
 * @module @desi-event/api/routes/venues
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { PUBLIC_EVENT_STATUSES } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import {
  assertEditable,
  createVersion,
  loadVersionChain,
  publishVersion,
  readLayout,
  versionInUse,
  writeLayout,
} from '../lib/venue-maps.js'
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { slugify, disambiguateSlug } from '../lib/identifiers.js'
import { defineRoute } from '../lib/register.js'

/** How many events the public venue page lists. */
export const PUBLIC_EVENT_LIMIT = 24

/** How far a merge chain is followed before we call it a loop. */
const MERGE_CHAIN_LIMIT = 8

/**
 * A venue as the API returns it.
 *
 * An allow-list rather than the row: `organizationId` becomes the boolean
 * `shared`, because a caller browsing venues has no business learning which
 * other organisation owns one — the only question their screen asks is whether
 * they may edit it.
 *
 * @param {object} venue A `Venue` row.
 * @returns {object} A payload satisfying `venueDetailSchema`.
 */
export function toVenue(venue) {
  return {
    id: venue.id,
    slug: venue.slug ?? null,
    name: venue.name,
    addressLine1: venue.addressLine1,
    addressLine2: venue.addressLine2 ?? null,
    city: venue.city,
    region: venue.region,
    postalCode: venue.postalCode,
    country: venue.country,
    latitude: venue.latitude ?? null,
    longitude: venue.longitude ?? null,
    capacity: venue.capacity ?? null,
    timezone: venue.timezone,
    shared: venue.organizationId === null || venue.organizationId === undefined,
    mergedIntoVenueId: venue.mergedIntoVenueId ?? null,
    accessibility: venue.accessibility ?? null,
    description: venue.description ?? null,
    directions: venue.directions ?? null,
    policies: venue.policies ?? null,
    provenance: venue.provenance ?? null,
  }
}

/**
 * The summary shape, which is the detail shape minus the prose.
 *
 * @param {object} venue A `Venue` row.
 * @returns {object} A payload satisfying `venueSummarySchema`.
 */
function toVenueSummary(venue) {
  const {
    description: _description,
    directions: _directions,
    policies: _policies,
    provenance: _provenance,
    ...summary
  } = toVenue(venue)

  return summary
}

/**
 * Refuse a caller who may not edit this venue.
 *
 * Two different rules, deliberately not collapsed: an owned venue needs
 * `venue:manage` **in the organisation that owns it**, and a shared venue needs
 * platform staff. Treating a shared venue as "everybody's to edit" would let any
 * organiser rewrite the address of a hall a hundred other events are listed at.
 *
 * @param {object} actor The request actor.
 * @param {object} venue The venue row.
 * @returns {void}
 * @throws {Error} A 403 when the caller may not edit it.
 */
function assertMayEdit(actor, venue) {
  if (venue.organizationId) {
    assertCan(actor, CAPABILITIES.VENUE_MANAGE, { organizationId: venue.organizationId })
    return
  }

  if (can(actor, CAPABILITIES.VENUE_MANAGE) || can(actor, CAPABILITIES.PLATFORM_ADMIN)) return

  throw forbidden(
    'This venue is shared between organisations, so only platform staff can change it. ' +
      'Create your own venue record instead, or ask a moderator to make the change.',
  )
}

/**
 * Follow a merge pointer to the row that survived.
 *
 * Bounded, because a cycle is possible if two merges race and the loop would
 * otherwise be infinite. A chain that does not terminate is reported rather than
 * followed forever.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} venue The venue as read.
 * @returns {Promise<object>} The surviving venue, or the one given when it has not been merged.
 */
async function resolveMerge(prisma, venue) {
  let current = venue

  for (let hop = 0; hop < MERGE_CHAIN_LIMIT; hop += 1) {
    if (!current.mergedIntoVenueId) return current

    const next = await prisma.venue.findUnique({ where: { id: current.mergedIntoVenueId } })

    if (!next) return current

    current = next
  }

  throw conflict(
    'This venue has been merged into a chain that does not end. A moderator needs to look at it.',
  )
}

/**
 * A free slug for a venue, derived from its name.
 *
 * @param {object} prisma The Prisma client.
 * @param {string|null|undefined} requested What the caller asked for.
 * @param {string} name The venue name.
 * @returns {Promise<string>} A slug nothing else holds.
 * @throws {Error} A 409 when the requested slug is taken.
 */
async function resolveVenueSlug(prisma, requested, name) {
  if (requested) {
    const taken = await prisma.venue.findUnique({ where: { slug: requested } })

    if (taken) throw conflict(`The slug "${requested}" is already in use.`)

    return requested
  }

  const base = slugify(name)
  const taken = await prisma.venue.findUnique({ where: { slug: base } })

  return taken ? disambiguateSlug(base) : base
}

/**
 * Register the venue routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerVenueRoutes(app, { prisma }) {
  defineRoute(app, 'venues.list', {
    handler: async (request) => {
      const { q, city, region, country, organizationId, accessibility, page, perPage } =
        request.query

      /**
       * Which venues this caller may see at all.
       *
       * Shared venues, plus the ones belonging to organisations the caller is a
       * member of. An organiser's private venue record is not something a
       * competitor gets to browse, and filtering in the database rather than in
       * memory is what keeps it out of `pagination.total` as well as the page.
       */
      const memberships = (request.actor?.memberships ?? []).map((row) => row.organizationId)
      const visible = organizationId
        ? [{ organizationId }]
        : [
            { organizationId: null },
            ...(memberships.length > 0 ? [{ organizationId: { in: memberships } }] : []),
          ]

      if (organizationId && !memberships.includes(organizationId)) {
        // Asking for somebody else's venues by id is not an error worth
        // explaining; it is simply an empty list.
        return {
          data: [],
          pagination: { page, perPage, total: 0, hasNextPage: false },
        }
      }

      const where = {
        OR: visible,
        // A merged-away row is not a venue you can choose any more.
        mergedIntoVenueId: null,
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
        ...(region ? { region: { equals: region, mode: 'insensitive' } } : {}),
        ...(country ? { country } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.venue.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        prisma.venue.count({ where }),
      ])

      // The accessibility filter is applied after the query because the claims
      // live in a JSON column: matching "asserts all of these" inside Postgres
      // would need a containment operator Prisma does not expose portably. The
      // page is already bounded to `perPage`, so this is a filter over at most a
      // hundred rows rather than the table.
      const required = accessibility ?? []
      const data = rows
        .filter((venue) =>
          required.every((feature) => (venue.accessibility?.features ?? []).includes(feature)),
        )
        .map(toVenueSummary)

      return {
        data,
        pagination: { page, perPage, total, hasNextPage: page * perPage < total },
      }
    },
  })

  defineRoute(app, 'venues.get', {
    handler: async (request) => {
      const venue = await prisma.venue.findUnique({ where: { id: request.params.id } })

      if (!venue) throw notFound('No such venue.')

      // A venue belonging to an organisation the caller is not in is still
      // readable: an attendee holding a ticket needs the address. What is not
      // readable is the list of them, which is why `venues.list` scopes and this
      // does not.
      return { data: toVenue(await resolveMerge(prisma, venue)) }
    },
  })

  defineRoute(app, 'venues.create', {
    handler: async (request) => {
      const { organizationId, slug: requestedSlug, ...fields } = request.body

      if (organizationId) {
        assertCan(request.actor, CAPABILITIES.VENUE_MANAGE, { organizationId })
      } else if (
        !can(request.actor, CAPABILITIES.PLATFORM_ADMIN) &&
        !can(request.actor, CAPABILITIES.MODERATION_REVIEW)
      ) {
        throw forbidden(
          'A venue with no organisation is shared between all of them, so only platform staff ' +
            'can create one. Send organizationId to create a venue of your own.',
          'VENUE_SHARED_REQUIRES_STAFF',
        )
      }

      const venue = await prisma.venue.create({
        data: {
          ...fields,
          organizationId: organizationId ?? null,
          slug: await resolveVenueSlug(prisma, requestedSlug, fields.name),
          // Who told us about this place. Never "scraped": nothing in this
          // system imports a venue from somebody else's site.
          provenance: organizationId ? 'organizer' : 'moderator',
        },
      })

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_CREATED,
        entityType: 'Venue',
        entityId: venue.id,
        actorId: request.actor.id,
        metadata: { shared: !organizationId, city: venue.city },
      })

      request.log.info({ venueId: venue.id, actorId: request.actor.id }, 'venue created')

      return { data: toVenue(venue) }
    },
  })

  defineRoute(app, 'venues.update', {
    handler: async (request) => {
      const existing = await prisma.venue.findUnique({ where: { id: request.params.id } })

      if (!existing) throw notFound('No such venue.')

      assertMayEdit(request.actor, existing)

      if (existing.mergedIntoVenueId) {
        // The id is in the message rather than in `details`, which this codebase
        // keeps for the log: a caller who cannot see which venue survived has
        // been told to go somewhere without being told where.
        throw conflict(
          `This venue has been merged into ${existing.mergedIntoVenueId}. Edit that one instead.`,
        )
      }

      const venue = await prisma.venue.update({
        where: { id: existing.id },
        data: request.body,
      })

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_UPDATED,
        entityType: 'Venue',
        entityId: venue.id,
        actorId: request.actor.id,
        metadata: { fields: Object.keys(request.body) },
      })

      return { data: toVenue(venue) }
    },
  })

  defineRoute(app, 'venues.merge', {
    handler: async (request) => {
      const { intoVenueId, reason } = request.body

      if (intoVenueId === request.params.id) {
        throw unprocessable('A venue cannot be merged into itself.')
      }

      const merged = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.venue.findUnique({ where: { id: request.params.id } })
        const survivor = await tx.venue.findUnique({ where: { id: intoVenueId } })

        if (!duplicate) throw notFound('No such venue.')
        if (!survivor) throw unprocessable('The venue to merge into does not exist.')

        if (duplicate.mergedIntoVenueId) {
          throw conflict('That venue has already been merged.', {
            mergedIntoVenueId: duplicate.mergedIntoVenueId,
          })
        }

        if (survivor.mergedIntoVenueId) {
          throw unprocessable(
            'The venue to merge into has itself been merged away. Merge into the one that survived.',
          )
        }

        // Conditional on the state that was read, so two moderators merging the
        // same duplicate at once produce one merge rather than two.
        const { count } = await tx.venue.updateMany({
          where: { id: duplicate.id, mergedIntoVenueId: null },
          data: { mergedIntoVenueId: survivor.id },
        })

        if (count !== 1) {
          throw conflict(
            'That venue was merged while you were looking at it. Reload and try again.',
          )
        }

        // Future listings point at the survivor. Existing orders and tickets are
        // deliberately left alone: they recorded where somebody actually went,
        // and rewriting history to tidy a duplicate is not a tidy-up.
        await tx.event.updateMany({
          where: {
            venueId: duplicate.id,
            status: { in: ['DRAFT', 'REVIEW_PENDING', 'CHANGES_REQUIRED', 'APPROVED'] },
          },
          data: { venueId: survivor.id },
        })

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.VENUE_MERGED,
          entityType: 'Venue',
          entityId: duplicate.id,
          actorId: request.actor.id,
          metadata: { intoVenueId: survivor.id, reason },
        })

        return tx.venue.findUnique({ where: { id: survivor.id } })
      })

      request.log.info(
        { venueId: request.params.id, intoVenueId, actorId: request.actor.id },
        'venue merged',
      )

      return { data: toVenue(merged) }
    },
  })
}

/**
 * Register the seating-map authoring routes.
 *
 * Authorisation is checked on every one of them, from the venue that owns the
 * map rather than from anything the caller sent. A shared venue is the case
 * worth stating: an organiser may *select* it for an event and may not author
 * its maps, because a shared hall's layout is shared too — one organiser
 * renumbering the stalls would renumber them for everybody listed there.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerVenueMapRoutes(app, { prisma }) {
  /**
   * The venue behind a map route, with the caller's right to author it checked.
   *
   * @param {object} request The incoming request.
   * @param {object} venue The venue row.
   * @returns {void}
   * @throws {Error} A 403 when the caller may not author maps here.
   */
  function assertMayAuthor(request, venue) {
    assertMayEdit(request.actor, venue)
  }

  /**
   * A map version in response shape.
   *
   * @param {object} version The version row.
   * @param {boolean} inUse Whether a session points at it.
   * @returns {object} The payload.
   */
  const toVersion = (version, inUse) => ({
    id: version.id,
    venueMapId: version.venueMapId,
    version: version.version,
    revision: version.revision,
    publishedAt: version.publishedAt ?? null,
    seatCount: version.seatCount,
    inUse,
    createdAt: version.createdAt,
  })

  /**
   * A map with its versions, newest first.
   *
   * @param {object} db A Prisma client.
   * @param {object} map The map row.
   * @returns {Promise<object>} The payload.
   */
  async function toMap(db, map) {
    const versions = await db.venueMapVersion.findMany({
      where: { venueMapId: map.id },
      orderBy: { version: 'desc' },
    })

    const used = await Promise.all(versions.map((version) => versionInUse(db, version.id)))

    return {
      id: map.id,
      venueId: map.venueId,
      name: map.name,
      notes: map.notes ?? null,
      archivedAt: map.archivedAt ?? null,
      versions: versions.map((version, index) => toVersion(version, used[index])),
    }
  }

  defineRoute(app, 'venueMaps.list', {
    handler: async (request) => {
      const venue = await prisma.venue.findUnique({ where: { id: request.params.id } })

      if (!venue) throw notFound('No such venue.')

      assertMayAuthor(request, venue)

      const maps = await prisma.venueMap.findMany({
        where: { venueId: venue.id },
        orderBy: { name: 'asc' },
      })

      return { data: await Promise.all(maps.map((map) => toMap(prisma, map))) }
    },
  })

  defineRoute(app, 'venueMaps.create', {
    handler: async (request) => {
      const venue = await prisma.venue.findUnique({ where: { id: request.params.id } })

      if (!venue) throw notFound('No such venue.')

      assertMayAuthor(request, venue)

      const existing = await prisma.venueMap.findFirst({
        where: { venueId: venue.id, name: request.body.name },
      })

      if (existing) throw conflict(`This venue already has a map called "${request.body.name}".`)

      const map = await prisma.venueMap.create({
        data: { venueId: venue.id, name: request.body.name, notes: request.body.notes ?? null },
      })

      // A map with no version is not yet anything, so the first draft comes
      // with it rather than being a second call somebody can forget.
      await prisma.venueMapVersion.create({ data: { venueMapId: map.id, version: 1 } })

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_MAP_CREATED,
        entityType: 'VenueMap',
        entityId: map.id,
        actorId: request.actor.id,
        metadata: { venueId: venue.id, name: map.name },
      })

      return { data: await toMap(prisma, map) }
    },
  })

  defineRoute(app, 'venueMaps.createVersion', {
    handler: async (request) => {
      const map = await prisma.venueMap.findUnique({ where: { id: request.params.id } })

      if (!map) throw notFound('No such map.')

      const venue = await prisma.venue.findUnique({ where: { id: map.venueId } })

      if (!venue) throw notFound('No such map.')

      assertMayAuthor(request, venue)

      const version = await createVersion(prisma, {
        map,
        cloneFromVersionId: request.body.cloneFromVersionId ?? null,
      })

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_MAP_VERSION_CREATED,
        entityType: 'VenueMapVersion',
        entityId: version.id,
        actorId: request.actor.id,
        metadata: {
          venueMapId: map.id,
          version: version.version,
          clonedFrom: request.body.cloneFromVersionId ?? null,
        },
      })

      return {
        data: {
          ...toVersion(version, false),
          layout: await readLayout(prisma, version.id),
        },
      }
    },
  })

  defineRoute(app, 'venueMaps.getVersion', {
    handler: async (request) => {
      const { version, venue } = await loadVersionChain(prisma, request.params.id)

      assertMayAuthor(request, venue)

      return {
        data: {
          ...toVersion(version, await versionInUse(prisma, version.id)),
          layout: await readLayout(prisma, version.id),
        },
      }
    },
  })

  defineRoute(app, 'venueMaps.putLayout', {
    handler: async (request) => {
      const { version, venue } = await loadVersionChain(prisma, request.params.id)

      assertMayAuthor(request, venue)
      await assertEditable(prisma, version)

      const { revision, ...layout } = request.body
      const updated = await writeLayout(prisma, { version, layout, revision })

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_MAP_LAYOUT_WRITTEN,
        entityType: 'VenueMapVersion',
        entityId: version.id,
        actorId: request.actor.id,
        metadata: { revision: updated.revision, seatCount: updated.seatCount },
      })

      return {
        data: { ...toVersion(updated, false), layout: await readLayout(prisma, updated.id) },
      }
    },
  })

  defineRoute(app, 'venueMaps.publishVersion', {
    handler: async (request) => {
      const { version, venue } = await loadVersionChain(prisma, request.params.id)

      assertMayAuthor(request, venue)

      const published = await publishVersion(prisma, version)

      await recordAudit(prisma, {
        action: AUDIT_ACTIONS.VENUE_MAP_PUBLISHED,
        entityType: 'VenueMapVersion',
        entityId: version.id,
        actorId: request.actor.id,
        metadata: { version: published.version, seatCount: published.seatCount },
      })

      request.log.info(
        { versionId: version.id, actorId: request.actor.id, seatCount: published.seatCount },
        'map version published',
      )

      return {
        data: {
          ...toVersion(published, await versionInUse(prisma, published.id)),
          layout: await readLayout(prisma, published.id),
        },
      }
    },
  })
}

/**
 * Register the public venue page route.
 *
 * Separate from {@link registerVenueRoutes} because it is the only venue route
 * an anonymous caller reaches, and keeping it apart makes that visible rather
 * than something a reader has to infer from an `auth` field.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerPublicVenueRoutes(app, { prisma }) {
  defineRoute(app, 'venues.public', {
    handler: async (request) => {
      const found = await prisma.venue.findUnique({ where: { slug: request.params.slug } })

      if (!found) throw notFound('No such venue.')

      // A merged venue still resolves. Every link, every printed ticket and
      // every QR code made before the merge points at the old slug, and
      // answering 404 to all of them to tidy a duplicate is not a tidy-up.
      const venue = await resolveMerge(prisma, found)

      const now = new Date()
      const events = await prisma.event.findMany({
        where: {
          venueId: venue.id,
          status: { in: PUBLIC_EVENT_STATUSES },
          startsAt: { gte: now },
        },
        orderBy: { startsAt: 'asc' },
        take: PUBLIC_EVENT_LIMIT,
        include: { organization: true },
      })

      return {
        data: {
          ...toVenue(venue),
          // Null when this URL is already the canonical one, so a page can
          // decide between "this is the page" and "this is a redirect" without
          // comparing strings.
          canonicalSlug: venue.slug === request.params.slug ? null : venue.slug,
          upcomingEvents: events.map((event) => ({
            slug: event.slug,
            title: event.title,
            startsAt: event.startsAt,
            organizerName: event.organization?.name ?? null,
          })),
        },
      }
    },
  })
}
