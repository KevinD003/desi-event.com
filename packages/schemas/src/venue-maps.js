/**
 * Seating maps: their versions, and the whole-layout document that authors one.
 *
 * A map version is authored as **one document**. There is no endpoint that adds
 * a seat, because a seat is not a thing that can be added correctly on its own:
 * it points at a row, a section and a price zone, it may be the companion of an
 * accessible space, and every one of those references is checkable only against
 * the rest of the layout. Per-seat endpoints would let a caller build a draft
 * that is invalid between any two of five hundred calls, and there is no useful
 * answer to "what does this map mean right now" in the middle of that.
 *
 * References inside the document are by `key` — caller-supplied, stable only
 * within one request. Database ids are minted on write. A payload carrying
 * database ids would let a caller point a seat at a row in somebody else's map.
 *
 * @module @desi-event/schemas/venue-maps
 */

import { z } from 'zod'

import { cuidSchema, timestampSchema } from './primitives.js'

/**
 * A key: an author's handle on one entity, for the length of one request.
 *
 * Bounded and character-restricted so it can appear in an error path and in a
 * DOM id without escaping.
 */
export const layoutKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'A key may use letters, digits, hyphens and underscores.')

/** What a seat is, as authored. */
export const layoutSeatSchema = z.object({
  key: layoutKeySchema,
  label: z.string().trim().min(1).max(120),
  sortOrder: z.int().min(0).max(100_000).default(0),
  /** Optional cross-checks. The validator refuses one that disagrees with nesting. */
  sectionKey: layoutKeySchema.nullish(),
  rowKey: layoutKeySchema.nullish(),
  zoneKey: layoutKeySchema.nullish(),
  /** A wheelchair space or similar. Never inferred from the label. */
  accessible: z.boolean().default(false),
  /** The accessible space this seat accompanies. Held and released with it. */
  companionOfKey: layoutKeySchema.nullish(),
  obstructedView: z.boolean().default(false),
  restricted: z.boolean().default(false),
  restrictionNote: z.string().trim().max(500).nullish(),
})

/** A row of seats. */
export const layoutRowSchema = z.object({
  key: layoutKeySchema,
  label: z.string().trim().min(1).max(60),
  sortOrder: z.int().min(0).max(100_000).default(0),
  seats: z.array(layoutSeatSchema).max(5000).default([]),
})

/** A section: seated, standing, or tables. */
export const layoutSectionSchema = z.object({
  key: layoutKeySchema,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['SEATED', 'STANDING', 'TABLE']).default('SEATED'),
  sortOrder: z.int().min(0).max(100_000).default(0),
  /** Only for STANDING, where there are no seats to count. */
  standingCapacity: z.int().min(1).max(1_000_000).nullish(),
  rows: z.array(layoutRowSchema).max(500).default([]),
  /** Seats hanging directly off the section: tables and booths have no rows. */
  seats: z.array(layoutSeatSchema).max(5000).default([]),
})

/** A price band. */
export const layoutZoneSchema = z.object({
  key: layoutKeySchema,
  name: z.string().trim().min(1).max(120),
  /** A design-system token, never a colour literal: status is never colour alone. */
  colourToken: z.string().trim().max(60).default('zone-default'),
  sortOrder: z.int().min(0).max(100_000).default(0),
})

/**
 * `PUT /v1/venue-map-versions/:id/layout` — the whole draft, at once.
 *
 * `revision` is a precondition, not decoration. Two people editing one draft
 * would otherwise be last-write-wins with no way for the loser to find out.
 */
export const putLayoutRequestSchema = z.object({
  revision: z.int().min(0),
  zones: z.array(layoutZoneSchema).max(200).default([]),
  sections: z.array(layoutSectionSchema).min(1).max(200),
})

/** `POST /v1/venues/:id/maps`. */
export const createVenueMapRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).nullish(),
})

/**
 * `POST /v1/venue-maps/:id/versions`.
 *
 * With `cloneFromVersionId`, the new draft starts as a copy of that version.
 * That is how a published map is changed: it is never edited, it is cloned.
 */
export const createMapVersionRequestSchema = z.object({
  cloneFromVersionId: cuidSchema.nullish(),
})

/** One problem with a layout, as the API reports it. */
export const layoutIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string(),
  key: z.string().nullable(),
})

/** A map version, as returned. */
export const mapVersionSchema = z.object({
  id: cuidSchema,
  venueMapId: cuidSchema,
  version: z.int().min(1),
  revision: z.int().min(0),
  publishedAt: timestampSchema.nullable(),
  seatCount: z.int().min(0),
  /** Whether anything has been sold against it. A sold version is untouchable. */
  inUse: z.boolean(),
  createdAt: timestampSchema.optional(),
})

/** A map version with its layout. */
export const mapVersionDetailSchema = mapVersionSchema.extend({
  layout: z.object({
    zones: z.array(layoutZoneSchema),
    sections: z.array(layoutSectionSchema),
  }),
})

/** A map, with its versions newest first. */
export const venueMapSchema = z.object({
  id: cuidSchema,
  venueId: cuidSchema,
  name: z.string(),
  notes: z.string().nullable(),
  archivedAt: timestampSchema.nullable(),
  versions: z.array(mapVersionSchema).default([]),
})

/** Response envelopes. */
export const venueMapResponseSchema = z.object({ data: venueMapSchema })
export const venueMapListResponseSchema = z.object({ data: z.array(venueMapSchema) })
export const mapVersionResponseSchema = z.object({ data: mapVersionDetailSchema })
