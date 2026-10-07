/**
 * Response body schemas.
 *
 * The API validates outbound payloads with these, and
 * `@desi-event/api-contract` renders them to JSON Schema for the OpenAPI
 * document — which is why nothing in this file uses `.transform()`.
 *
 * @module @desi-event/schemas/responses
 */

import { z } from 'zod'

import { addressFree, addressStandInSchema } from './addresses.js'
import {
  centsSchema,
  countSchema,
  cuidSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  timestampSchema,
  urlSchema,
} from './primitives.js'
import {
  ADMISSION_EVENT_SCOPES,
  GROUP_PASS_MAX_TICKETS,
  admissionAuthoritySchema,
  admissionPreviewOutcomeSchema,
  admissionRefusalReasonSchema,
  admissionRoleSchema,
  checkInOutcomeSchema,
  connectOnboardingStatusSchema,
  eventCategorySchema,
  eventImportImageRoleSchema,
  eventImportImageStatusSchema,
  eventImportRunStatusSchema,
  eventImportSourceSchema,
  eventSessionStatusSchema,
  eventStatusSchema,
  mediaModerationStatusSchema,
  verificationStatusSchema,
  logLevelSchema,
  promoQuoteReasonSchema,
  promoStatusSchema,
  promoTypeSchema,
  recordedCheckInMethodSchema,
  ticketStatusSchema,
} from './enums.js'
import { invitationDeliverySchema } from './teams.js'
import { PAYMENT_MODES } from './payments.js'
import { utcDaySchema } from './traffic.js'
import { CARD_PLACEMENTS, TRAFFIC_SOURCES } from './traffic-vocabulary.js'
import { WEBSITE_LIMITS, publicWebsiteLinkSchema, websiteRedirectStateSchema } from './website.js'
import {
  eventChangeNoticeSchema,
  platformEventRowSchema,
  refundDriveSummarySchema,
} from './event-control.js'
import { mediaQueueItemSchema, publicMediaSchema } from './media.js'
import { IMPORT_LIMITS, IMPORT_PLAN_ACTIONS, importSourceIdSchema } from './imports.js'
import {
  eventSummarySchema,
  eventWithRelationsSchema,
  notificationSummarySchema,
  orderWithItemsSchema,
  organizationSchema,
  disputeSchema,
  organizerBalanceSchema,
  payoutSchema,
  publicUserSchema,
  reconciliationTaskSchema,
  transferSchema,
  refundSchema,
  sessionSummarySchema,
  ticketSchema,
  ticketTypeSchema,
} from './entities.js'

/** Page counters returned alongside every list payload. */
export const paginationMetaSchema = z.object({
  page: z.int().min(1),
  perPage: z.int().min(1),
  total: z.int().min(0),
  totalPages: z.int().min(0),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
})

/**
 * Build the pagination block for a list response.
 *
 * @param {object} args Counter inputs.
 * @param {number} args.page Current 1-based page number.
 * @param {number} args.perPage Page size actually used.
 * @param {number} args.total Total number of matching rows.
 * @returns {{page: number, perPage: number, total: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean}} Pagination metadata.
 */
export function buildPaginationMeta({ page, perPage, total }) {
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0

  return {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  }
}

/** A single validation issue as sent to a client. */
export const issueResponseSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})

/** The one error envelope every failing endpoint returns. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    statusCode: z.int().min(100).max(599),
    issues: z.array(issueResponseSchema).optional(),
    /**
     * Human-readable reasons a business rule refused, in the order they were
     * found.
     *
     * Distinct from `issues`, which are schema violations keyed to a field.
     * These are coherence failures a schema cannot express — "a reserved ticket
     * type needs a price zone", "the sales window closes before it opens" — and
     * they are plural because an organiser fixing one thing at a time and
     * resubmitting is a worse experience than a list.
     *
     * They were being collected and then dropped: the services built the array,
     * attached it to the error, and the serialiser forwarded only `issues`. So
     * a 422 said "that is not coherent" and nothing else.
     */
    problems: z.array(z.string()).optional(),
    /**
     * Why a business rule refused, as a code from the closed vocabulary the
     * route documents — `ADMISSION_REFUSAL_REASONS` at the door. Present only
     * on refusals that have one; a client branches on this, never on
     * `message`, which is written for people and may be reworded.
     */
    reason: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/u)
      .optional(),
    /**
     * The order a checkout answer is about, when one was placed and the buyer
     * has to be able to find it: a capture that timed out (502
     * `PAYMENT_TIMEOUT`), a capture the order could not be completed for (500
     * `ORDER_NOT_COMPLETED`), and a retry of an attempt whose payment is still
     * being checked (409 `ORDER_PENDING`). Its page says where the order
     * stands; paying again is what it exists to prevent.
     */
    orderReference: z
      .string()
      .regex(/^[A-Z0-9-]{4,32}$/u)
      .optional(),
    /**
     * What a few refusals name so the caller can act without reading the page
     * again, from a closed list: the address stored now, on 409
     * `WEBSITE_CHANGED` (null when the organiser removed it), and where the
     * website link's switch stands, on 409 `WEBSITE_REDIRECT_UNCHANGED`. No
     * other refusal carries it, and no other key exists.
     */
    details: z
      .object({
        currentWebsiteUrl: z.string().min(1).max(WEBSITE_LIMITS.url).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    requestId: z.string().min(1).max(64).optional(),
  }),
})

/** Successful sign-up or sign-in. */
export const authResponseSchema = z.object({
  token: z.string().min(1),
  tokenType: z.literal('Bearer').default('Bearer'),
  expiresIn: z.string().min(1).default('7d'),
  user: publicUserSchema,
})

/** `GET /events`. */
export const eventListResponseSchema = z.object({
  data: z.array(eventSummarySchema),
  pagination: paginationMetaSchema,
})

/** `GET /events/:slug`. */
export const eventDetailResponseSchema = z.object({
  data: eventWithRelationsSchema,
})

/** `GET /orders/:id` and the response to a successful checkout. */
export const orderResponseSchema = z.object({
  data: orderWithItemsSchema,
})

/** `GET /events/:id/ticket-types`, with live availability folded in. */
export const ticketTypeListResponseSchema = z.object({
  data: z.array(
    ticketTypeSchema.extend({
      availableQuantity: z.int().min(0).optional(),
      isSoldOut: z.boolean().optional(),
    }),
  ),
})

/** Response to a successful inventory hold. */
export const holdResponseSchema = z.object({
  data: z.object({
    id: cuidSchema,
    ticketTypeId: cuidSchema,
    quantity: z.int().min(1),
    expiresAt: timestampSchema,
    unitPriceCents: centsSchema.optional(),
    /**
     * Returned exactly once, when an anonymous caller takes a hold, and never
     * stored in plaintext. The caller must present it to release the hold.
     * Absent for holds owned by an authenticated user, whose identity comes
     * from their token instead.
     */
    guestToken: z.string().min(1).optional(),
  }),
})

/**
 * The event, as a door needs to see it: which one, and when.
 *
 * Not the event entity. A scanner has no business with an event's pricing,
 * description, moderation state or venue address, and a door screen that could
 * render them would be a screen that could leak them.
 */
export const admissionEventSchema = z.object({
  id: cuidSchema,
  title: z.string(),
  startsAt: timestampSchema,
  endsAt: timestampSchema.nullable(),
  timezone: z.string(),
})

/**
 * Which night a ticket is for, so a steward sees "Night 3 · Wed Oct 8". Null
 * for a ticket good for every night (or on an event of one night whose tier
 * names none). On an event of more than one night the door names the night it
 * is admitting to, and a ticket for another is refused `WRONG_NIGHT`.
 */
export const admissionSessionSchema = z
  .object({
    label: z.string().nullable(),
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    timezone: z.string(),
  })
  .nullable()

/** Where the ticket sits, for reserved seating. Null for general admission. */
export const admissionSeatSchema = z
  .object({
    section: z.string().nullable(),
    row: z.string().nullable(),
    label: z.string(),
  })
  .nullable()

/**
 * What a door is told about a ticket before admitting it.
 *
 * ## What is here, and why each thing is
 *
 * The event and its time, so a steward notices a ticket for tomorrow. The tier
 * and seat, so they can point somebody to the right door. The attendee's name,
 * because checking it against an identity document is often the point. Whether
 * the ticket is already in, and when. A closed reason when it is refused.
 *
 * ## What is not, and never will be
 *
 * The credential or its digest. The buyer's or recipient's email. Anything
 * about payment: order totals, provider references, connected accounts. The
 * transfer token. Internal notes. Audit metadata. Any other attendee. None of
 * those helps a door decide, and every one of them is something a lost scanner
 * would otherwise be carrying.
 *
 * `previewReference` is present only when the outcome is `ADMISSIBLE`: there is
 * nothing to confirm otherwise. It is short-lived, bound to this scanner and
 * this presentation, and grants nothing by itself — confirmation re-checks
 * everything, and still needs the pass.
 */
export const admissionPreviewResponseSchema = z.object({
  data: z.object({
    outcome: admissionPreviewOutcomeSchema,
    refusal: admissionRefusalReasonSchema.nullable(),
    method: recordedCheckInMethodSchema,
    event: admissionEventSchema,
    tier: z.object({ name: z.string() }).nullable(),
    seat: admissionSeatSchema,
    session: admissionSessionSchema.optional(),
    // Never an address: the presenter replaces one, and this refuses one it missed.
    attendeeName: addressFree(z.string()).nullable(),
    checkedInAt: timestampSchema.nullable(),
    previewReference: z.string().nullable(),
    previewExpiresAt: timestampSchema.nullable(),
  }),
})

/**
 * What a confirmed admission did.
 *
 * `ADMITTED` means this request wrote the admission. `ALREADY_CHECKED_IN` means
 * somebody had — perhaps this scanner, on a request whose answer was lost — and
 * carries the original instant rather than now. A refusal is not a 200: it is a
 * 409 whose `details.reason` is one of `ADMISSION_REFUSAL_REASONS`.
 *
 * `method` is the method the admission was *recorded* with, which for a
 * duplicate is the original's, not this request's.
 */
export const checkInResponseSchema = z.object({
  data: z.object({
    outcome: checkInOutcomeSchema,
    /**
     * When the ticket was admitted. Null only for a ticket already marked
     * admitted with no recorded instant — rows the demo seed writes directly —
     * which is better reported as unknown than invented.
     */
    checkedInAt: timestampSchema.nullable(),
    method: recordedCheckInMethodSchema.nullable(),
    checkedInByYou: z.boolean(),
    event: admissionEventSchema,
    tier: z.object({ name: z.string() }).nullable(),
    seat: admissionSeatSchema,
    session: admissionSessionSchema.optional(),
    // Never an address: the presenter replaces one, and this refuses one it missed.
    attendeeName: addressFree(z.string()).nullable(),
  }),
})

/**
 * The events this account may admit to, and on what authority.
 *
 * Derived from memberships and scopes read at request time. A scanner is shown
 * the events its scopes name and nothing else, so the door screen cannot even
 * offer an event the server would refuse.
 *
 * A platform super administrator is shown every organisation's current door
 * events as well, on `PLATFORM_ROLE` authority — the only authority whose role
 * is a platform role, which the refinement pins so neither half can drift.
 * `meta.scope` says which kind of list this is; `meta.organizations` feeds the
 * organisation filter; `meta.truncated` says the list was cut at its limit.
 */
export const admissionEventsResponseSchema = z.object({
  data: z.array(
    z
      .object({
        event: admissionEventSchema.extend({ status: eventStatusSchema }),
        /**
         * The event's nights, soonest first, for the door to say which one it
         * is admitting to. With more than one, every lookup must name one.
         */
        sessions: z.array(
          z.object({
            id: cuidSchema,
            label: z.string().nullable(),
            startsAt: timestampSchema,
            endsAt: timestampSchema,
            timezone: z.string(),
            status: eventSessionStatusSchema,
          }),
        ),
        organization: z.object({ id: cuidSchema, name: z.string() }),
        authority: admissionAuthoritySchema,
        role: admissionRoleSchema,
      })
      .superRefine((entry, ctx) => {
        if ((entry.authority === 'PLATFORM_ROLE') !== (entry.role === 'SUPER_ADMIN')) {
          ctx.addIssue({
            code: 'custom',
            path: ['role'],
            message: 'Platform authority rests on SUPER_ADMIN, and only platform authority does',
          })
        }
      }),
  ),
  meta: z.object({
    scope: z.enum([...ADMISSION_EVENT_SCOPES]),
    organizations: z.array(z.object({ id: cuidSchema, name: z.string() })).max(500),
    truncated: z.boolean(),
  }),
})

/**
 * One ticket of a group, as the door is told about it before admitting.
 *
 * The same named fields as a single preview, per ticket, and the ticket's id so
 * the steward can say which of them are standing at the door.
 */
export const groupAdmissionTicketSchema = z.object({
  ticketId: cuidSchema,
  outcome: admissionPreviewOutcomeSchema,
  refusal: admissionRefusalReasonSchema.nullable(),
  tier: z.object({ name: z.string() }).nullable(),
  seat: admissionSeatSchema,
  // The night this ticket is for, as on a single ticket's preview.
  session: admissionSessionSchema,
  // Never an address: the presenter replaces one, and this refuses one it missed.
  attendeeName: addressFree(z.string()).nullable(),
  checkedInAt: timestampSchema.nullable(),
})

/**
 * What a door is told about a group pass before admitting anybody on it.
 *
 * Every ticket the buyer still holds on the order, with its own outcome;
 * counts of each; how many tickets from the order were handed to other people
 * (who carry their own passes); and a reference only when at least one ticket
 * can be admitted. Never the group credential, its code, or either digest.
 */
export const groupAdmissionPreviewResponseSchema = z.object({
  data: z.object({
    outcome: admissionPreviewOutcomeSchema,
    refusal: admissionRefusalReasonSchema.nullable(),
    method: recordedCheckInMethodSchema,
    event: admissionEventSchema,
    tickets: z.array(groupAdmissionTicketSchema).max(GROUP_PASS_MAX_TICKETS),
    counts: z.object({
      admissible: z.int().min(0).max(GROUP_PASS_MAX_TICKETS),
      alreadyIn: z.int().min(0).max(GROUP_PASS_MAX_TICKETS),
      refused: z.int().min(0).max(GROUP_PASS_MAX_TICKETS),
    }),
    handedOn: z.int().min(0),
    previewReference: z.string().nullable(),
    previewExpiresAt: timestampSchema.nullable(),
  }),
})

/**
 * What a group confirmation did, per ticket.
 *
 * `ADMITTED` when this request admitted at least one ticket; each ticket says
 * whether it was admitted now or was already in. A group whose tickets changed
 * since the lookup is not a 200: it is a 409 with `GROUP_CHANGED`, and nothing
 * was admitted.
 */
export const groupCheckInResponseSchema = z.object({
  data: z.object({
    outcome: checkInOutcomeSchema,
    admitted: z.int().min(0).max(GROUP_PASS_MAX_TICKETS),
    alreadyIn: z.int().min(0).max(GROUP_PASS_MAX_TICKETS),
    method: recordedCheckInMethodSchema,
    event: admissionEventSchema,
    tickets: z
      .array(
        z.object({
          ticketId: cuidSchema,
          outcome: checkInOutcomeSchema,
          checkedInAt: timestampSchema.nullable(),
          checkedInByYou: z.boolean(),
          tier: z.object({ name: z.string() }).nullable(),
          seat: admissionSeatSchema,
          session: admissionSessionSchema,
          attendeeName: addressFree(z.string()).nullable(),
        }),
      )
      .max(GROUP_PASS_MAX_TICKETS),
  }),
})

/**
 * `GET /orders/:reference/group-pass` — one QR for the buyer's party.
 *
 * Holder-only and `no-store`. `credential` is the group's QR content and
 * `groupCode` the code printed beside it; both are derived, never stored, and
 * both stop working when the pass is replaced. `tickets` are those the pass
 * admits now; `offered` marks one with a transfer offer outstanding, which
 * still admits until the offer is accepted.
 */
export const groupPassResponseSchema = z.object({
  data: z.object({
    orderReference: z.string(),
    credential: z.string().regex(/^G1\.[A-Za-z0-9_-]{43}$/u),
    groupCode: z.string().regex(/^DEG-[2-9A-HJ-NP-Z]{12}$/u),
    credentialVersion: z.int().min(1),
    issuedAt: timestampSchema.nullable(),
    // At least GROUP_PASS_MIN_TICKETS when a pass is first taken out; once
    // taken out it keeps showing for as long as one ticket on it still admits.
    admits: z.int().min(1).max(GROUP_PASS_MAX_TICKETS),
    tickets: z
      .array(
        z.object({
          id: cuidSchema,
          status: ticketStatusSchema,
          tier: z.object({ name: z.string() }).nullable(),
          seat: admissionSeatSchema,
          offered: z.boolean(),
        }),
      )
      .max(GROUP_PASS_MAX_TICKETS),
  }),
})

/**
 * `POST /orders/:reference/group-pass/rotate` — the old QR and code stop
 * working. No secret comes back; the holder fetches the new pass.
 */
export const groupPassRotatedResponseSchema = z.object({
  data: z.object({
    credentialVersion: z.int().min(2),
    rotatedAt: timestampSchema,
  }),
})

/**
 * A ticket transfer, as the two parties see it.
 *
 * The token is never here. It goes in the invitation link once and the database
 * holds only its digest; a response that echoed it would put a bearer secret in
 * a browser cache, a proxy log and a screenshot.
 *
 * @type {object}
 */
export const ticketTransferSchema = z.object({
  id: cuidSchema,
  ticketId: cuidSchema,
  fromUserId: cuidSchema.nullable(),
  /**
   * `••••@example.com`, or `Hidden email` when there is no usable domain.
   *
   * The domain and nothing of the local part: its sender typed the address and
   * needs to tell their offers apart, and nobody reading this needs more.
   * Constrained rather than declared: the stand-in is one call in one
   * presenter, and a schema that accepted an address would notice nothing if
   * that call were ever dropped.
   */
  toEmailMasked: addressStandInSchema,
  status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED']),
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  declinedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  resultTicketId: cuidSchema.nullable(),
  createdAt: timestampSchema,
})

/** The responses to accepting, declining and withdrawing a transfer. */
export const ticketTransferResponseSchema = z.object({
  data: ticketTransferSchema,
})

/**
 * `POST /tickets/:id/transfers` — the offer, and how its code went out.
 *
 * The same `delivery` block as a team invitation. In `MANUAL` (the default)
 * the one-time `invitationCode` is here exactly once, sent `no-store`, and only
 * its digest is kept; the recipient must also be signed in at the offered
 * address to use it. In `EMAIL` (DELIVERY_MODE=EMAIL with an SMTP server) the
 * code went to the recipient and this carries `null`.
 */
export const startedTicketTransferResponseSchema = z.object({
  data: ticketTransferSchema.extend({ delivery: invitationDeliverySchema }),
})

/**
 * `GET /tickets/:id` — one ticket and everything that has happened to it.
 *
 * Read by two different people with two different questions. The holder asks
 * "can I still get in, and where has this been"; the organiser asks "should
 * this still admit anybody". The payload is the same for both, because a
 * payload that varied by role is a payload somebody eventually widens by
 * mistake — what differs is which commands the API will accept afterwards.
 *
 * `organizationId` is here so that the screen can ask an organisation
 * capability *with* an organisation. Asked without one, an organisation
 * capability becomes a platform check.
 *
 * The pass is not here. It is derived when a ticket is issued or accepted,
 * handed over once, and never stored; reading a ticket back returns everything
 * except that. Neither is any transfer token, for the same reason and one
 * more: a token in a response is a bearer secret in a browser cache, a proxy
 * log and a screenshot.
 *
 * @type {object}
 */
export const ticketDetailResponseSchema = z.object({
  data: z.object({
    ticket: ticketSchema,
    event: z.object({
      id: cuidSchema,
      slug: z.string(),
      title: z.string(),
      /** What kind of event, so the ticket shows the same poster as its page. */
      category: eventCategorySchema,
      startsAt: timestampSchema,
      timezone: z.string(),
      status: z.string(),
      /** The approved cover the event page shows, or null for the poster. */
      coverImage: publicMediaSchema.nullable(),
    }),
    organizationId: cuidSchema,
    /** Whether the caller is the person holding it, rather than the organiser. */
    holder: z.boolean(),
    /** Every transfer this ticket has been through, oldest first. */
    transfers: z.array(ticketTransferSchema),
    /** The night it is for: its seat's session, else its tier's; null for every night. */
    session: sessionSummarySchema.nullish(),
    /**
     * The online event's joining link, for the holder only and only while the
     * ticket admits (an admitted ticket still does, so people can rejoin).
     * Null for the organiser reading it and for a ticket that no longer admits.
     */
    onlineJoinUrl: urlSchema.nullish(),
    /**
     * What changed about the event since the ticket's order was placed and
     * touches this ticket: event-wide changes, its own night's, and every
     * night's for a ticket good for every night. Newest first.
     */
    eventChanges: z.array(eventChangeNoticeSchema).max(50).optional(),
  }),
})

/**
 * The accepted ticket, with its pass.
 *
 * `credential` appears exactly here and nowhere else: it is derived at the
 * moment of acceptance, handed over once, and never stored. Reading the ticket
 * back later returns everything except this field.
 *
 * @type {object}
 */
export const acceptedTicketResponseSchema = z.object({
  data: z.object({
    ticket: ticketSchema,
    credential: z.string(),
  }),
})

/**
 * How the caller came to hold a ticket.
 *
 * Two facts that the ticket row alone cannot distinguish, because a transfer
 * mints the recipient's ticket onto the *buyer's* order item. Without this, a
 * received ticket and a bought one are indistinguishable in a wallet, and the
 * order reference attached to a received ticket belongs to somebody else.
 *
 * `PURCHASED` — this account's order bought it.
 * `RECEIVED` — somebody handed it over; the order behind it is not this
 * account's, and nothing about that order is in the payload.
 *
 * @type {object}
 */
export const holderRelationshipSchema = z.enum(['PURCHASED', 'RECEIVED'])

/**
 * A row in somebody's ticket wallet.
 *
 * ## Why this exists rather than `ticketSchema`
 *
 * `ticketSchema` is the ticket's own columns: id, code, attendee name, status,
 * check-in time. A wallet built from that can say "VALID — ABC-123" and nothing
 * else — not which event, not when, not where, not which tier, not which seat.
 * `GET /tickets` returned exactly that, and the wallet screen showed exactly
 * that, which is why this schema exists.
 *
 * ## What is deliberately absent
 *
 * The admission credential and its digest: a list endpoint that carried a
 * bearer secret would put one in every cache between the server and the phone,
 * and `ticketSchema` does not declare `credentialHash`, so Zod strips it before
 * anything can leak it. The buyer's email, payment provider identifiers,
 * internal notes, audit metadata, guest tokens, and any other attendee on the
 * same order are all absent for the same reason: none of them is needed to show
 * somebody the ticket they hold.
 *
 * `orderReference` is present only for a ticket this account bought. For a
 * received one it is null, because the order it descends from belongs to
 * whoever handed the ticket over.
 *
 * @type {object}
 */
export const walletTicketSchema = ticketSchema.extend({
  /** Bought by this account, or handed to it. */
  holderRelationship: holderRelationshipSchema,
  /** Whether this ticket would open a door right now. */
  admits: z.boolean(),
  /**
   * Why it would not, in a sentence, or null when it would.
   *
   * The same sentence the door would give, from the same pure function, so a
   * wallet and a scanner cannot disagree about what a ticket is.
   */
  admissionRefusal: z.string().nullable(),
  /** The buyer's order, for a ticket this account bought. Null otherwise. */
  orderReference: orderReferenceSchema.nullable(),
  event: z.object({
    id: cuidSchema,
    slug: z.string(),
    title: z.string(),
    /** What kind of event, so the wallet shows the same poster as its page. */
    category: eventCategorySchema,
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    timezone: z.string(),
    status: z.string(),
    /** Set when the organiser cancelled it, so a wallet can say why. */
    cancelledAt: timestampSchema.nullable(),
    /** The approved cover the event page shows, or null for the poster. */
    coverImage: publicMediaSchema.nullable(),
  }),
  /** Where it is. Null for an online event, or a venue not yet chosen. */
  venue: z
    .object({
      name: z.string(),
      city: z.string(),
      region: z.string(),
      country: z.string(),
    })
    .nullable(),
  /** Whether it happens online rather than at the venue. */
  isOnline: z.boolean(),
  /** The tier bought, from the order line. */
  tier: z.object({ id: cuidSchema, name: z.string() }).nullable(),
  /** The reserved seat, for reserved seating. Null for general admission. */
  seat: z
    .object({
      section: z.string(),
      row: z.string().nullable(),
      label: z.string(),
      accessible: z.boolean(),
    })
    .nullable(),
  /**
   * The invitation standing against this ticket, if one is.
   *
   * Only an outstanding one, and never its token — the token went to the
   * recipient once and the database holds only its digest.
   */
  pendingTransfer: z
    .object({
      id: cuidSchema,
      /**
       * `••••@example.com`, and the schema insists rather than trusting the
       * presenter.
       *
       * `z.string()` would accept a fully spelled-out address just as happily,
       * so the one line that produces the stand-in would be the only thing
       * between a recipient list and somebody harvesting it. Requiring the
       * pattern puts a second, structural check behind that line: a presenter
       * that stopped masking would 500 rather than leak.
       */
      toEmailMasked: addressStandInSchema,
      expiresAt: timestampSchema,
    })
    .nullable(),
  /** When the organiser withdrew it, and why they said they did. */
  revokedAt: timestampSchema.nullable(),
  revokedReason: z.string().nullable(),
  /** The night it is for: its seat's session, else its tier's; null for every night. */
  session: sessionSummarySchema.nullish(),
  /**
   * The online event's joining link, while this ticket admits. Null for an
   * event at a venue, and for a ticket refunded, revoked or handed on.
   */
  onlineJoinUrl: urlSchema.nullish(),
})

/** `GET /tickets`. */
export const myTicketListResponseSchema = z.object({
  data: z.array(walletTicketSchema),
  pagination: paginationMetaSchema,
})

/**
 * `GET /tickets/:id/pass` — the holder's admission credential.
 *
 * ## The one route that returns a bearer secret on demand
 *
 * Everywhere else a credential appears exactly once, at the moment it is
 * derived. That made a ticket unshowable on a second device, which is a real
 * problem for a real attendee: close the tab, lose the ticket.
 *
 * This is safe to repeat only because of how the credential is built. It is
 * `HMAC(HKDF(AUTH_SECRET, "ticket-pass-v1"), ticketId:version)` — derived, not
 * generated, so the server can recompute it without having stored it, and the
 * database still holds nothing but a SHA-256. Bumping `credentialVersion`
 * changes the credential and therefore the digest, which is why a transfer
 * kills the former holder's pass rather than merely marking it stale.
 *
 * The response carries no event, no attendee and no order. A pass is a secret,
 * and a payload that mixed a secret with the things a screen wants to show is a
 * payload something eventually caches.
 *
 * @type {object}
 */
export const ticketPassResponseSchema = z.object({
  data: z.object({
    ticketId: cuidSchema,
    /** The bearer credential. 43 base64url characters, 256 bits. */
    credential: z.string().min(1),
    /** Bumped on every rotation, so a stale pass is provably stale. */
    credentialVersion: z.int().min(1),
    /** When this version was first issued. */
    issuedAt: timestampSchema.nullable(),
  }),
})

/** `POST /tickets/:id/revoke`. */
export const ticketResponseSchema = z.object({ data: ticketSchema })

/** `GET /organizations/:id`. */
export const organizationResponseSchema = z.object({
  data: organizationSchema,
})

/** `GET /health` and `GET /ready`. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  uptimeSeconds: z.number().min(0).optional(),
  version: z.string().min(1).max(32).optional(),
  logLevel: logLevelSchema.optional(),
  timestamp: timestampSchema,
  checks: z
    .object({
      database: z.boolean(),
      redis: z.boolean(),
    })
    .partial()
    .optional(),
  /**
   * What this instance can do with money.
   *
   * There is one payment mode and it moves no money. Reporting it on the
   * liveness probe means an operator never has to read the source to find out
   * whether a deployment can charge a card: it cannot, and it says so.
   */
  payments: z
    .object({
      mode: z.enum([PAYMENT_MODES.MOCK, PAYMENT_MODES.STRIPE_TEST]),
      demo: z.literal(true),
      live: z.literal(false).optional(),
      label: z.string().min(1).max(16).optional(),
      message: z.string().min(1).max(200),
    })
    .optional(),
})

/** Envelope for endpoints that only confirm the write succeeded. */
export const okResponseSchema = z.object({
  ok: z.literal(true),
})

/**
 * Facet counts for the event catalogue.
 *
 * Computed over the whole eligible set, not over the page being displayed.
 * Paginating the results must not shrink the filter universe: a city whose
 * events all fall outside the current page still has to be selectable, or the
 * filters silently hide part of the catalogue.
 */
export const eventFacetsResponseSchema = z.object({
  data: z.object({
    /** The query scope these counts were computed over. */
    scope: z.object({
      status: z.string(),
      total: countSchema,
    }),
    categories: z.array(z.object({ value: eventCategorySchema, count: countSchema })),
    cities: z.array(z.object({ value: z.string(), count: countSchema })),
    languages: z.array(z.object({ value: z.string(), count: countSchema })),
    formats: z.array(z.object({ value: z.enum(['online', 'in_person']), count: countSchema })),
  }),
})

/**
 * One entry in an event's moderation history.
 *
 * `reason` is included because the organiser needs to read what was asked of
 * them. The public event payload never carries this shape at all — the history
 * of a negotiation is between the two parties to it.
 */
export const moderationActionSchema = z.object({
  id: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reason: z.string().nullable(),
  requestedChanges: z.record(z.string(), z.string()).nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
})

/** An event's moderation history, newest first. */
export const moderationHistoryResponseSchema = z.object({
  data: z.array(moderationActionSchema),
})

/**
 * What an actor may do to an event right now.
 *
 * `entitled` and `blockers` are separate on purpose: "you may not" and "not
 * yet" are different sentences, and a screen that conflates them tells an
 * organiser to ask for a permission they already have.
 */
export const availableTransitionSchema = z.object({
  to: z.string(),
  actor: z.string(),
  entitled: z.boolean(),
  blockers: z.array(z.string()),
})

/** The moves available out of an event's current status. */
export const eventTransitionsResponseSchema = z.object({
  data: z.object({
    status: z.string(),
    transitions: z.array(availableTransitionSchema),
  }),
})

/** One session of an event, as an organiser sees it. */
export const eventSessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  doorsOpenAt: z.string().nullable(),
  timezone: z.string(),
  salesStartAt: z.string().nullable(),
  salesEndAt: z.string().nullable(),
  status: z.string(),
  /** The organiser's short name for the night, or null when its date labels it. */
  label: z.string().nullable(),
  /** When the night was cancelled, and why; null for a night that was not. */
  cancelledAt: z.string().nullish(),
  cancellationReason: z.string().max(500).nullish(),
  venueMapVersionId: z.string().nullable(),
  capacity: z.number().nullable(),
  sortOrder: z.number(),
  /**
   * The price zones of this session's map version, so a reserved ticket type
   * can be pointed at one. Empty for general admission.
   */
  priceZones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      colourToken: z.string(),
      sortOrder: z.number(),
    }),
  ),
  /**
   * Tickets sold and held against this session: general-admission tiers bound
   * to it, and its seats. What a capacity cut is checked against.
   */
  usage: z.object({ sold: z.number().int(), held: z.number().int() }),
  /** Whether nothing depends on it yet, so it can be removed. */
  removable: z.boolean(),
  /**
   * False for an imported night whose listing gave no end time: `endsAt` is
   * then a planning estimate (start plus three hours) that no public page
   * shows, and the editor labels it "Not listed by Sulekha (estimate for
   * scheduling)". It turns true once an editor sets the end apart from it.
   */
  endTimeListed: z.boolean().default(true),
})

/** A session, with the event's new revision so the editor can keep editing. */
export const eventSessionResponseSchema = z.object({
  data: eventSessionSchema,
  meta: z.object({ revision: z.number() }),
})

/**
 * Every session of an event.
 *
 * `eventSession`, not `session`: `sessionListResponseSchema` already exists and
 * means a signed-in person's *authentication* sessions. Two things called a
 * session is the kind of collision that produces a route returning the wrong
 * shape and nobody noticing until it is in a browser.
 */
export const eventSessionListResponseSchema = z.object({
  data: z.array(eventSessionSchema),
  meta: z.object({ revision: z.number() }),
})

/**
 * A ticket type as its organisation sees it.
 *
 * Deliberately tolerant: plain strings and integers rather than the entity's
 * bounds. A row written before a limit tightened — a 900-character description,
 * 100 per order — must still be readable by the people who can fix it, and a
 * strict schema here turned exactly that row into a 500 on every read and every
 * save. The public payload is the strict one, and its presenter clamps.
 */
export const authorTicketTypeSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
  quantityTotal: z.number().int(),
  quantitySold: z.number().int(),
  minPerOrder: z.number().int(),
  maxPerOrder: z.number().int(),
  salesStartAt: z.string().nullable(),
  salesEndAt: z.string().nullable(),
  status: z.string(),
  sortOrder: z.number().int(),
  eventSessionId: z.string().nullable(),
  priceZoneId: z.string().nullable(),
  reserved: z.boolean(),
  complimentary: z.boolean(),
  visibility: z.enum(['PUBLIC', 'HIDDEN']),
  /** Tickets in live holds right now: part of what a quantity cut must leave room for. */
  heldQuantity: z.number().int(),
  /** Whether any order has a line for it, paid or not. */
  hasOrders: z.boolean(),
  /** Whether nothing depends on it, so it can be removed rather than paused. */
  removable: z.boolean(),
})

/** A ticket type, with the event's new revision. */
export const authorTicketTypeResponseSchema = z.object({
  data: authorTicketTypeSchema,
  meta: z.object({ revision: z.number() }),
})

/** Every ticket type of an event, as its organisation sees them, with the revision. */
export const authorTicketTypeListResponseSchema = z.object({
  data: z.array(authorTicketTypeSchema),
  meta: z.object({ revision: z.number() }),
})

/**
 * What preparing inventory did.
 *
 * `created` and `prepared` are separate because the difference is the whole
 * point: a second run creates nothing and leaves `prepared` where it was, which
 * is how a caller can see the command was idempotent rather than being told so.
 */
export const inventoryPreparationResponseSchema = z.object({
  data: z.object({
    sessionId: z.string(),
    kind: z.enum(['reserved', 'general_admission']),
    expected: z.number(),
    prepared: z.number(),
    created: z.number(),
    /**
     * Seats newly assigned to the reserved ticket type pricing their zone.
     * A seat with no tier behind it cannot be sold, so this is the number that
     * says the session's seats are now for sale.
     */
    assigned: z.number(),
  }),
})

/**
 * Whether an event is ready to be published, and what is missing.
 *
 * Every blocker rather than the first, because an organiser fixing one thing at
 * a time and resubmitting is worse than a list — and a moderator reading the
 * same list knows what to expect.
 */
export const readinessResponseSchema = z.object({
  data: z.object({
    ready: z.boolean(),
    status: z.string(),
    publishable: z.array(z.string()),
    sellable: z.array(z.string()),
    inventory: z.array(z.string()),
    organizerVerified: z.boolean(),
  }),
})

/**
 * The all-in price of a ticket, as a buyer will be charged it.
 *
 * A face value that becomes something else at the last step of checkout is the
 * practice this makes hard to ship by accident.
 */
export const pricePreviewResponseSchema = z.object({
  data: z.array(
    z.object({
      ticketTypeId: z.string(),
      name: z.string(),
      currency: z.string(),
      quantity: z.number(),
      faceValueCents: z.number(),
      feesCents: z.number(),
      taxCents: z.number(),
      allInCents: z.number(),
    }),
  ),
})

/** `GET /operations/notifications`. */
export const notificationListResponseSchema = z.object({
  data: z.array(notificationSummarySchema),
  pagination: paginationMetaSchema,
})

/** `GET /operations/notifications/:id`, and the two actions on one. */
export const notificationDetailResponseSchema = z.object({
  data: notificationSummarySchema,
})

/** `GET /finance/balance`. */
export const balanceResponseSchema = z.object({ data: organizerBalanceSchema })

/**
 * `GET /finance/summary`.
 *
 * Every figure derived from the append-only ledger. `integrity` is above the
 * totals in the payload as well as on the screen, because a batch that does not
 * add up is a reason to stop reading the totals rather than a footnote to them.
 */
export const financeSummaryResponseSchema = z.object({
  data: z.object({
    organizationId: cuidSchema.nullable(),
    currency: z.string(),
    from: timestampSchema.nullable(),
    to: timestampSchema.nullable(),
    /** Which mode the money moved in. `MOCK` here means no money moved at all. */
    mode: z.string(),
    modeNotice: z.string(),
    integrity: z.object({
      examined: z.number().int(),
      truncated: z.boolean(),
      imbalances: z.array(
        z.object({
          batchId: cuidSchema,
          reference: z.string(),
          kind: z.string(),
          problem: z.enum(['NO_ENTRIES', 'ENTRIES_UNBALANCED', 'ENTRIES_DISAGREE_WITH_BATCH']),
          storedDebitCents: z.number().int(),
          storedCreditCents: z.number().int(),
          actualDebitCents: z.number().int(),
          actualCreditCents: z.number().int(),
        }),
      ),
    }),
    totals: z.object({
      grossCollectedCents: z.number().int(),
      faceValueCents: z.number().int(),
      discountCents: z.number().int(),
      taxPayableCents: z.number().int(),
      platformFeeRevenueCents: z.number().int(),
      organizerPayableCents: z.number().int(),
      processorFeeCents: z.number().int(),
    }),
    accounts: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        debitCents: z.number().int(),
        creditCents: z.number().int(),
        balanceCents: z.number().int(),
      }),
    ),
    activity: z.object({
      refundsRequested: z.object({ count: z.number().int(), amountCents: z.number().int() }),
      refundsSettled: z.object({ count: z.number().int(), amountCents: z.number().int() }),
      disputes: z.object({ count: z.number().int(), amountCents: z.number().int() }),
      transfers: z.object({ count: z.number().int(), amountCents: z.number().int() }),
      payouts: z.object({ count: z.number().int(), amountCents: z.number().int() }),
    }),
  }),
})

/**
 * One grouped row in a sales breakdown.
 *
 * `lineValueCents` rather than `revenueCents`, and the name is the point. This
 * is what the order lines were priced at; what the organisation keeps after
 * fees, tax and everything given back is in `money`, derived from the ledger.
 * Calling both "revenue" is how a screen ends up with two numbers that should
 * agree and never will.
 */
const salesGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  currency: z.string(),
  quantity: z.number().int(),
  /**
   * Null when money is withheld.
   *
   * A breakdown is the quiet way money escapes a permission check: the totals
   * are gated, the reader is told the money is not for them, and then a table
   * headed "sales by event" prints what each event took. Counts survive the
   * withholding; values do not.
   */
  lineValueCents: z.number().int().nullable(),
  refundedQuantity: z.number().int(),
  refundedCents: z.number().int().nullable(),
  startsAt: timestampSchema.nullable().optional(),
})

/** One seat grouping, by section or by price zone. */
const seatGroupSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  total: z.number().int(),
  available: z.number().int(),
  held: z.number().int(),
  sold: z.number().int(),
  blocked: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
})

/** A count of visits or clicks. */
const trafficCountSchema = z.int().min(0)

/** `POST /v1/traffic/beacons`: the same answer whether or not the visit was counted. */
export const trafficBeaconResponseSchema = z.object({
  data: z.object({ accepted: z.literal(true) }),
})

/**
 * Visit totals over a window.
 *
 * `ticketClicks` are presses of "Choose tickets" and `seatClicks` presses of
 * "Choose seats"; a screen that shows them together adds the two.
 */
export const trafficTotalsSchema = z.object({
  views: trafficCountSchema,
  visitors: trafficCountSchema,
  /** Page views with no visitor code: the browser asked not to be tracked. */
  anonymousViews: trafficCountSchema,
  cardClicks: trafficCountSchema,
  ticketClicks: trafficCountSchema,
  seatClicks: trafficCountSchema,
  /** Distinct visitors per event per day among the ticket and seat clicks. */
  ticketClickVisitors: trafficCountSchema,
  websiteRedirects: trafficCountSchema,
  websiteRedirectVisitors: trafficCountSchema,
})

/** One UTC day of visits, zero-filled. */
export const trafficDaySchema = z.object({
  day: utcDaySchema,
  views: trafficCountSchema,
  visitors: trafficCountSchema,
  cardClicks: trafficCountSchema,
  ticketClicks: trafficCountSchema,
  seatClicks: trafficCountSchema,
  websiteRedirects: trafficCountSchema,
  /** Orders paid on this day (`paidAt`), still paid; one refunded later is not counted. */
  ordersPaid: trafficCountSchema,
})

/**
 * One event's visits over a window.
 *
 * Deleted events are listed too, with `deleted` set, because they were seen
 * and sold before they were taken down.
 */
export const trafficEventSummaryRowSchema = z.object({
  eventId: cuidSchema,
  title: z.string(),
  slug: z.string(),
  status: z.string(),
  deleted: z.boolean(),
  startsAt: timestampSchema,
  views: trafficCountSchema,
  visitors: trafficCountSchema,
  cardClicks: trafficCountSchema,
  ticketClicks: trafficCountSchema,
  seatClicks: trafficCountSchema,
  websiteRedirects: trafficCountSchema,
  /** Whether a Desi-Event administrator has the event's website link turned on. */
  websiteLinkOn: z.boolean(),
  /** Orders paid in the window's days, still paid. */
  ordersPaid: trafficCountSchema,
})

/** A row of the platform list: the event's figures and whose it is. */
export const trafficPlatformRowSchema = trafficEventSummaryRowSchema.extend({
  organization: z.object({ id: cuidSchema, name: z.string(), slug: z.string() }),
})

/**
 * How fresh the figures are. Shared by the organiser branch and the platform
 * list, so the two cannot describe the same roll-up differently.
 */
const trafficFreshnessShape = {
  /** Always UTC: days are UTC days. */
  timeZone: z.literal('UTC'),
  /** First day counted; null when no `from` was given and nothing was recorded. */
  firstDay: utcDaySchema.nullable(),
  lastDay: utcDaySchema,
  /** When the daily totals were last brought up to date; null before the first roll-up. */
  updatedAt: timestampSchema.nullable(),
  /** The roll-up has not finished for over two hours, so later visits are missing. */
  stale: z.boolean(),
  /** Some summed rows were written by the development seed, not counted. */
  includesDemonstration: z.boolean(),
}

/**
 * The `traffic` branch of `GET /analytics/summary`: visits to one
 * organisation's event pages, or to one of them. Counts only — never a visitor
 * code, an address or a referring site.
 */
export const analyticsTrafficSchema = z.object({
  ...trafficFreshnessShape,
  totals: trafficTotalsSchema,
  sources: z
    .array(z.object({ source: z.enum([...TRAFFIC_SOURCES]), views: trafficCountSchema }))
    .length(TRAFFIC_SOURCES.length),
  cardPlacements: z
    .array(z.object({ placement: z.enum([...CARD_PLACEMENTS]), clicks: trafficCountSchema }))
    .length(CARD_PLACEMENTS.length),
  byDay: z.array(trafficDaySchema).max(366),
  /** Only the latest 366 days are in `byDay`; the totals cover the whole window. */
  seriesTruncated: z.boolean(),
  /** The organisation's events (latest 200 by start), with window sums. Empty when `eventId` narrowed. */
  byEvent: z.array(trafficEventSummaryRowSchema).max(200),
  conversion: z.object({
    visitors: trafficCountSchema,
    ticketClickVisitors: trafficCountSchema,
    ordersPaid: trafficCountSchema,
    /** Paid orders per hundred visitors over the same days; null with no visitors. */
    visitorToOrderPercent: z.number().min(0).nullable(),
  }),
  /** The narrowed-to event, when `eventId` named one of this organisation's. */
  event: z
    .object({
      id: cuidSchema,
      title: z.string(),
      slug: z.string(),
      status: z.string(),
      deleted: z.boolean(),
      startsAt: timestampSchema,
      websiteLinkOn: z.boolean(),
      /** The website switch as its own team and the Desi-Event team read it, when known. */
      websiteRedirect: websiteRedirectStateSchema.nullable(),
    })
    .nullable(),
})

/** `GET /v1/traffic/events`: every event's visits, for platform administrators. */
export const trafficEventListResponseSchema = z.object({
  data: z.object({
    ...trafficFreshnessShape,
    /** The ten most viewed events in the window, across the platform. */
    top: z.array(trafficPlatformRowSchema).max(10),
    events: z.array(trafficPlatformRowSchema),
  }),
  pagination: paginationMetaSchema,
})

/**
 * `POST /v1/traffic/website-visits`: where an event's website link goes.
 *
 * Answered to the web tier only, which re-validates the address before it
 * sends anybody there. Always the address an administrator approved, never one
 * the request named.
 */
export const websiteVisitResponseSchema = z.object({
  data: z.object({ url: z.string().min(1).max(WEBSITE_LIMITS.url) }).strict(),
})

/** One row of the administrators' list of website links. */
export const websiteLinkRowSchema = z
  .object({
    eventId: cuidSchema,
    slug: z.string(),
    title: z.string(),
    status: eventStatusSchema,
    organizationName: z.string().nullable(),
    organizationVerified: z.boolean(),
    /** The organiser's current address; null when they removed it while the link is on. */
    websiteUrl: z.string().max(WEBSITE_LIMITS.url).nullable(),
    /** The current address's host, as a person is shown it. */
    websiteHost: z.string().max(WEBSITE_LIMITS.host).nullable(),
    /** The address the last administrator decision was about; while on, the link goes here. */
    websiteDecidedUrl: z.string().max(WEBSITE_LIMITS.url).nullable(),
    /** When the current address started waiting for a decision. */
    websiteSubmittedAt: timestampSchema.nullable(),
    /** Whether the event's page is public, so the link would show while on. */
    pagePublic: z.boolean(),
    redirect: websiteRedirectStateSchema,
  })
  .strict()

/** `GET /v1/moderation/website-links`. */
export const websiteLinkListResponseSchema = z.object({
  data: z.array(websiteLinkRowSchema),
  pagination: paginationMetaSchema,
})

/** `POST /v1/moderation/events/:id/website-redirect`: the switch after the decision. */
export const websiteRedirectResponseSchema = z.object({
  data: z
    .object({
      eventId: cuidSchema,
      websiteUrl: z.string().max(WEBSITE_LIMITS.url).nullable(),
      /** What the public page shows now: null while the link is off or the page is not public. */
      websiteLink: publicWebsiteLinkSchema.nullable(),
      redirect: websiteRedirectStateSchema,
    })
    .strict(),
})

/**
 * `GET /analytics/summary`.
 *
 * Money and counts are deliberately separate branches of this payload, because
 * they come from different sources and must never be added together: `money` is
 * the ledger's, and everything else is counted from the rows that are the fact.
 */
export const analyticsSummaryResponseSchema = z.object({
  data: z.object({
    organizationId: cuidSchema,
    /** The organisation's name; null when no organisation has that reference. */
    organizationName: z.string().nullable(),
    currency: z.string(),
    eventId: cuidSchema.nullable(),
    eventSessionId: cuidSchema.nullable(),
    from: timestampSchema.nullable(),
    to: timestampSchema.nullable(),
    /** Always `UTC`. Said rather than assumed, so an export and a page agree. */
    timeZone: z.string(),
    mode: z.string(),
    modeNotice: z.string(),
    /**
     * Whether the caller may see money at all.
     *
     * `report:view` reaches every role from VIEWER upward, and a viewer who may
     * see how many tickets went should not thereby see what the organisation is
     * owed. So the money branch is gated on `finance:view` **in the payload**,
     * not in the markup: a screen that merely hid the figures would still have
     * sent them.
     */
    moneyVisible: z.boolean(),
    /**
     * Why the money is absent, when it is.
     *
     * `CAPABILITY` is a permanent answer — this account will never see these
     * figures and the screen should say so plainly rather than offer a button.
     * `STEP_UP` is a temporary one: the account holds `finance:view` but has not
     * confirmed a second factor recently enough, and confirming it again is a
     * thing the reader can actually do. Telling the two apart is the difference
     * between a useful prompt and a dead end.
     */
    moneyWithheld: z.enum(['CAPABILITY', 'STEP_UP']).nullable(),
    money: financeSummaryResponseSchema.shape.data
      .omit({
        organizationId: true,
        currency: true,
        from: true,
        to: true,
        mode: true,
        modeNotice: true,
      })
      .nullable(),
    tickets: z.object({
      live: z.number().int(),
      lost: z.number().int(),
      byLostState: z.array(
        z.object({ state: z.string(), label: z.string(), count: z.number().int() }),
      ),
    }),
    inventory: z.object({
      generalAdmission: z.array(
        z.object({
          ticketTypeId: cuidSchema,
          name: z.string(),
          currency: z.string(),
          priceCents: z.number().int(),
          status: z.string(),
          eventId: cuidSchema,
          eventSessionId: cuidSchema.nullable(),
          quantityTotal: z.number().int(),
          quantitySold: z.number().int(),
          quantityRemaining: z.number().int(),
          oversold: z.boolean(),
        }),
      ),
      reserved: z.object({
        bySection: z.array(seatGroupSchema),
        byPriceZone: z.array(seatGroupSchema),
        statuses: z.array(z.string()),
      }),
    }),
    sales: z.object({
      byEvent: z.array(salesGroupSchema),
      bySession: z.array(salesGroupSchema),
      byTicketType: z.array(salesGroupSchema),
      byDate: z.array(salesGroupSchema),
    }),
    checkIns: z.object({
      admitted: z.number().int(),
      live: z.number().int(),
      percent: z.number().nullable(),
    }),
    movement: z.object({
      transfers: z.array(z.object({ status: z.string(), count: z.number().int() })),
      revoked: z.number().int(),
    }),
    /** Visits to the organisation's event pages, in whole UTC days. */
    traffic: analyticsTrafficSchema,
    notifications: z.array(z.object({ status: z.string(), count: z.number().int() })),
    exceptions: z.object({
      open: z.number().int(),
      escalated: z.number().int(),
      oldestOpenedAt: timestampSchema.nullable(),
      oldestAgeHours: z.number().int().nullable(),
    }),
    funnel: z.object({
      steps: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int() })),
      /** What this system does not count, named so nobody reads the funnel as complete. */
      missing: z.array(z.string()),
    }),
    limits: z.object({ breakdownRows: z.number().int() }),
  }),
})

/** `GET /finance/payouts`. */
export const payoutListResponseSchema = z.object({
  data: z.array(payoutSchema),
  pagination: paginationMetaSchema,
})

/** `GET /finance/payouts/:id`, and every action that returns one. */
export const payoutResponseSchema = z.object({ data: payoutSchema })

/** `GET /finance/transfers`. */
export const transferListResponseSchema = z.object({
  data: z.array(transferSchema),
  pagination: paginationMetaSchema,
})

/** `GET /finance/disputes`. */
export const disputeListResponseSchema = z.object({
  data: z.array(disputeSchema),
  pagination: paginationMetaSchema,
})

/** `GET /operations/reconciliation`. */
export const reconciliationListResponseSchema = z.object({
  data: z.array(reconciliationTaskSchema),
  pagination: paginationMetaSchema,
})

/** `GET /operations/reconciliation/:id`, and every action that returns one. */
export const reconciliationTaskResponseSchema = z.object({
  data: reconciliationTaskSchema,
})

/**
 * What the provider said when asked again, and what that means.
 *
 * The verdict is returned rather than a status: the caller is being told what
 * the evidence supports, not being handed a state to write back.
 */
export const reconciliationRequeryResponseSchema = z.object({
  data: z.object({
    task: reconciliationTaskSchema,
    observed: z.object({
      found: z.boolean(),
      status: z.string().nullable(),
      amountCents: z.number().int().nullable(),
      currency: z.string().nullable(),
      refundedAmountCents: z.number().int().nullable(),
      error: z.string().nullable(),
    }),
    verdict: z.enum(['SETTLE', 'RELEASE', 'ALREADY_DONE', 'CONFLICT', 'UNKNOWN']),
    why: z.string(),
  }),
})

/** `GET /refunds`. */
export const refundListResponseSchema = z.object({
  data: z.array(refundSchema),
  pagination: paginationMetaSchema,
})

/** `GET /refunds/:id`, and every action that returns one refund. */
export const refundResponseSchema = z.object({
  data: refundSchema,
})

/**
 * What an order has left to give back.
 *
 * Returned alongside the refund on a request, because "it worked" is not the
 * useful answer — "and there is this much left" is, and computing it on the
 * client from a list of refunds is how two screens end up disagreeing.
 */
export const refundableResponseSchema = z.object({
  data: z.object({
    orderId: cuidSchema,
    orderReference: orderReferenceSchema,
    currency: z.string(),
    totalCents: z.number().int(),
    refundedCents: z.number().int(),
    refundPendingCents: z.number().int(),
    refundableCents: z.number().int(),
    lines: z.array(
      z.object({
        orderItemId: cuidSchema,
        ticketTypeId: cuidSchema,
        ticketTypeName: z.string(),
        quantity: z.number().int(),
        unitPriceCents: z.number().int(),
        refundedQuantity: z.number().int(),
        pendingQuantity: z.number().int(),
        refundableQuantity: z.number().int(),
      }),
    ),
    refunds: z.array(refundSchema),
  }),
})

/**
 * The simulated connected-account status.
 *
 * Written out by hand, and the absences are the specification rather than an
 * oversight. The declared response schema is the only allow list on this
 * payload — Fastify serialises against it, so a field not named here cannot
 * leave — and what is deliberately unnamed is: `providerAccountId`, because a
 * provider-shaped identifier in a payload is one in a log and it names nothing
 * anyway; `provider` and `providerMode`, which describe how this deployment is
 * wired rather than anything an organiser can act on; `defaultCurrency`, which a
 * simulated row leaves null on purpose; `country` and `disabledReason`, both of
 * which would have to be fabricated.
 *
 * The two capability flags carry `simulated` in their names. They correspond to
 * real columns, but a payload field called `payoutsEnabled` is one copy-and-paste
 * away from a screen reading "Payouts enabled", which is a claim about a real
 * provider that nothing here is entitled to make.
 *
 * `requirementsDue` is a count and never a list: a list of outstanding
 * requirements is a list of things a real provider would want to know about a
 * real person.
 */
export const connectStatusSchema = z.object({
  /** Always true, set by the server. There is no branch that omits it. */
  simulated: z.literal(true),
  state: connectOnboardingStatusSchema,
  /** What this state does *not* mean, from the shared vocabulary. */
  stateDescription: z.string(),
  terminal: z.boolean(),
  accountExists: z.boolean(),
  simulatedChargesEnabled: z.boolean(),
  simulatedPayoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  requirementsDueCount: z.number().int().min(0),
  // `timestampSchema`, not `z.date()`. A Date has no JSON Schema
  // representation, which `index.test.js` catches — and the OpenAPI document is
  // the point of that check, not a formality.
  updatedAt: timestampSchema.nullable(),
})

/** `GET /organizations/:id/connect`, and the action that returns one status. */
export const connectStatusResponseSchema = z.object({
  data: connectStatusSchema,
})

/**
 * A promo code as its organisation manages it.
 *
 * `status` is computed from the row and the clock (see `PROMO_STATUSES`);
 * `ordersCount` is how many orders reference it, paid or not, which is what
 * decides whether it can still be deleted. Tolerant of legacy rows: a code
 * written before the current rules must still list, so the people who can
 * pause it can see it.
 */
export const organiserPromoCodeSchema = z.object({
  id: cuidSchema,
  organizationId: cuidSchema,
  eventId: cuidSchema.nullable(),
  code: z.string().min(1).max(64),
  type: promoTypeSchema,
  value: z.int().min(0),
  currency: z.string().length(3).nullable(),
  maxRedemptions: z.int().min(0).nullable(),
  redemptionCount: z.int().min(0),
  startsAt: timestampSchema.nullable(),
  endsAt: timestampSchema.nullable(),
  active: z.boolean(),
  createdAt: timestampSchema,
  status: promoStatusSchema,
  /** The one event the code is for, or null for every event of the organisation. */
  event: z.object({ id: cuidSchema, slug: z.string(), title: z.string() }).nullable(),
  ordersCount: z.int().min(0),
})

/** One promo code, after a write. */
export const promoCodeResponseSchema = z.object({ data: organiserPromoCodeSchema })

/** `GET /v1/organizations/:id/promo-codes`. */
export const promoCodeListResponseSchema = z.object({
  data: z.array(organiserPromoCodeSchema),
  pagination: paginationMetaSchema,
})

/**
 * `POST /v1/orders/quote`: what the server would charge for this basket now.
 *
 * Computed by the same function as the charge, so the two cannot disagree.
 * `promo` is null when no code was sent; otherwise `applied` says whether it
 * took, and `reason` why not. An unknown code is a reason here (`UNKNOWN`),
 * not an error, so a buyer can correct a typo.
 */
export const orderQuoteResponseSchema = z.object({
  data: z.object({
    currency: z.string().length(3),
    subtotalCents: centsSchema,
    discountCents: centsSchema,
    feesCents: centsSchema,
    taxCents: centsSchema,
    totalCents: centsSchema,
    lines: z.array(
      z.object({
        ticketTypeId: cuidSchema,
        name: z.string(),
        sessionId: cuidSchema.nullable(),
        quantity: z.int().min(1),
        unitPriceCents: centsSchema,
        subtotalCents: centsSchema,
        discountCents: centsSchema,
      }),
    ),
    promo: z
      .object({
        code: z.string(),
        applied: z.boolean(),
        reason: promoQuoteReasonSchema.nullable(),
        type: promoTypeSchema.nullable(),
        percentBps: z.int().min(0).max(10_000).nullable(),
        amountCents: centsSchema.nullable(),
      })
      .nullable(),
    pricedAt: timestampSchema,
  }),
})

/**
 * `POST /v1/events/:id/delete`: the event as its team now reads it (with its
 * `deletion` record) and, when deleting it cancelled it, what the first pass of
 * the refund driver did. `refunds` is null for an outcome that refunds nobody.
 */
export const eventDeletionResponseSchema = z.object({
  data: z.object({
    event: eventWithRelationsSchema,
    refunds: refundDriveSummarySchema.nullable(),
  }),
})

/**
 * `POST /v1/events/:id/sessions/:sessionId/cancel`: the night as it now is,
 * and what the first pass of the refund driver did for its orders.
 */
export const cancelSessionResponseSchema = z.object({
  data: z.object({
    session: eventSessionSchema,
    refunds: refundDriveSummarySchema,
  }),
})

/** `GET /v1/platform/events`: a page of every organisation's events. */
export const platformEventListResponseSchema = z.object({
  data: z.array(platformEventRowSchema),
  pagination: paginationMetaSchema,
})

/** `GET /v1/moderation/media`: a page of pictures waiting, oldest first. */
export const mediaQueueResponseSchema = z.object({
  data: z.array(mediaQueueItemSchema),
  pagination: paginationMetaSchema,
})

// --- Importing listed events (SPEC2-XI area I) ---------------------------------
//
// Administrators' reads only: each names the source's own addresses (the
// listing and its pictures), which no public payload carries.

// The public projection of an import lives beside the event shapes it is part
// of; it is exported from here as well, where the import responses are.
export { importedFromSchema } from './entities.js'

/** One picture a listing names, and what copying it came to. */
export const eventImportPictureSchema = z.object({
  id: cuidSchema,
  /** The source's own address for it. Administrators only; never public. */
  url: z.string().max(IMPORT_LIMITS.url),
  role: eventImportImageRoleSchema,
  alt: z.string().max(IMPORT_LIMITS.alt),
  position: z.int().min(0),
  status: eventImportImageStatusSchema,
  /** Why the last attempt failed (`HOST_NOT_ALLOWED`, `TIMEOUT`, …), or null. */
  failureCode: z.string().max(100).nullable(),
  attempts: z.int().min(0),
  lastTriedAt: timestampSchema.nullable(),
  /** The stored picture, once copied, and where its approval stands. */
  mediaId: cuidSchema.nullable(),
  mediaStatus: mediaModerationStatusSchema.nullable(),
  /** "Too small for a cover" when a cover was stored in the gallery instead, or null. */
  note: z.string().max(200).nullable(),
})

/** The event an import row wrote, as the run page reads it. */
export const eventImportRowEventSchema = z.object({
  id: cuidSchema,
  title: nonEmptyStringSchema,
  slug: z.string().max(200),
  status: eventStatusSchema,
  /** What an approval must name: every stored picture moves it. */
  revision: z.int().min(0),
  /** Whether this run last wrote it, so this run's page may approve it. */
  inThisRun: z.boolean(),
  /** Whether it has since been moved to an organiser's own organisation. */
  reassigned: z.boolean(),
  organizationName: z.string().max(200).nullable(),
  importedByName: z.string().max(200).nullable(),
  approvedAt: timestampSchema.nullable(),
  approvedByName: z.string().max(200).nullable(),
})

/** One listing of a run: what the plan says, and, once applied, what it wrote. */
export const eventImportRowSchema = z.object({
  sourceId: importSourceIdSchema,
  title: nonEmptyStringSchema,
  startsAt: timestampSchema,
  city: z.string().max(100).nullable(),
  action: z.enum(IMPORT_PLAN_ACTIONS),
  /** Why an INVALID row cannot be imported, or null. */
  problem: z.string().max(1000).nullable(),
  /** What the curator noted, for administrators only. */
  importNotes: z.array(z.string().max(500)).max(IMPORT_LIMITS.importNotes),
  imageCount: z.int().min(0),
  priceCount: z.int().min(0),
  /** False when the listing gives no end time. */
  endTimeListed: z.boolean(),
  /** A posted event whose listing changed: "Update from Sulekha" may be ticked for it. */
  updatable: z.boolean(),
  /** An unchanged draft that applying sends for review again. */
  resubmit: z.boolean(),
  eventStatusAtPlan: eventStatusSchema.nullable(),
  event: eventImportRowEventSchema.nullable(),
  pictures: z.array(eventImportPictureSchema).max(IMPORT_LIMITS.images),
})

/** How a run's pictures stand. */
export const eventImportPictureCountsSchema = z.object({
  total: countSchema,
  stored: countSchema,
  failed: countSchema,
  waiting: countSchema,
})

/** A run, as its list row shows it. */
export const eventImportRunSummarySchema = z.object({
  id: cuidSchema,
  source: eventImportSourceSchema,
  /** PREVIEWED, APPLIED, or EXPIRED (a plan not applied within its hour). */
  status: eventImportRunStatusSchema,
  fileName: z.string().max(IMPORT_LIMITS.fileName),
  eventCount: z.int().min(0),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  appliedAt: timestampSchema.nullable(),
  createdByName: z.string().max(200).nullable(),
  appliedByName: z.string().max(200).nullable(),
  /** What applying it did, by action; null until it is applied. */
  summary: z.record(z.string(), countSchema).nullable(),
})

/** A run in full: its plan, row by row, and what each row wrote. */
export const eventImportRunSchema = eventImportRunSummarySchema.extend({
  /** The digest of the plan as shown, which applying it must name. */
  planDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  rows: z.array(eventImportRowSchema).max(IMPORT_LIMITS.events),
  pictures: eventImportPictureCountsSchema,
})

/**
 * `POST /v1/platform/imports`, `GET /v1/platform/imports/:runId`, and apply
 * and retry. `meta.picturesWaiting` says how many pictures were not tried in
 * the request's time and wait for "Retry pictures".
 */
export const eventImportRunResponseSchema = z.object({
  data: eventImportRunSchema,
  meta: z.object({ picturesWaiting: countSchema }).optional(),
})

/** `GET /v1/platform/imports`: a page of runs, newest first. */
export const eventImportRunListResponseSchema = z.object({
  data: z.array(eventImportRunSummarySchema),
  pagination: paginationMetaSchema,
})

/** What "Approve and publish" did for one event. */
export const eventImportApproveResultSchema = z.object({
  eventId: cuidSchema,
  /**
   * `PUBLISHED`: approved (unless a moderator already had) and published,
   * with the Sulekha link on. `PICTURES_APPROVED`: a posted event whose
   * waiting pictures were approved. `REFUSED`: nothing was written for it.
   */
  outcome: z.enum(['PUBLISHED', 'PICTURES_APPROVED', 'REFUSED']),
  /** The event's status after this, or null when it was refused. */
  status: eventStatusSchema.nullable(),
  revision: z.int().min(0).nullable(),
  picturesApproved: countSchema,
  /** For a refusal: the API's code and sentence. */
  code: z.string().max(100).nullable(),
  message: z.string().max(1000).nullable(),
})

/** `POST /v1/platform/imports/:runId/approve`: one result per event, in the order asked. */
export const eventImportApproveResponseSchema = z.object({
  data: z.object({
    results: z.array(eventImportApproveResultSchema).max(IMPORT_LIMITS.approveItems),
  }),
})

/** `GET /v1/platform/import-targets`: organisations an imported event may move to. */
export const importTargetListResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: cuidSchema,
        name: nonEmptyStringSchema,
        slug: z.string().max(200),
        verificationStatus: verificationStatusSchema,
      }),
    )
    .max(20),
})
