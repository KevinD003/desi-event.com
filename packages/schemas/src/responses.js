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

import {
  centsSchema,
  countSchema,
  cuidSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  timestampSchema,
} from './primitives.js'
import { eventCategorySchema, logLevelSchema } from './enums.js'
import { PAYMENT_MODES } from './payments.js'
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

/** Response to a door scan. */
export const checkInResponseSchema = z.object({
  data: z.object({
    ticket: ticketSchema,
    alreadyCheckedIn: z.boolean().default(false),
    /** When it was first admitted, for a re-scan. */
    checkedInAt: timestampSchema.nullable(),
    /** Who it says on the ticket, so a door can match a face to a name. */
    attendeeName: z.string().nullable(),
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
  /** `p****a@example.com`. Enough to recognise, not enough to harvest. */
  toEmailMasked: z.string(),
  status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED']),
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  declinedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  resultTicketId: cuidSchema.nullable(),
  createdAt: timestampSchema,
})

/** `POST /tickets/:id/transfers`, and the responses to one. */
export const ticketTransferResponseSchema = z.object({
  data: ticketTransferSchema,
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
      startsAt: timestampSchema,
      timezone: z.string(),
      status: z.string(),
    }),
    organizationId: cuidSchema,
    /** Whether the caller is the person holding it, rather than the organiser. */
    holder: z.boolean(),
    /** Every transfer this ticket has been through, oldest first. */
    transfers: z.array(ticketTransferSchema),
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

/** `GET /tickets`. */
export const myTicketListResponseSchema = z.object({
  data: z.array(ticketSchema),
  pagination: paginationMetaSchema,
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
  venueMapVersionId: z.string().nullable(),
  capacity: z.number().nullable(),
  sortOrder: z.number(),
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

/** A ticket type, with the event's new revision. */
export const authorTicketTypeResponseSchema = z.object({
  data: ticketTypeSchema,
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
    notifications: z.array(z.object({ status: z.string(), count: z.number().int() })),
    exceptions: z.object({
      open: z.number().int(),
      escalated: z.number().int(),
      oldestOpenedAt: timestampSchema.nullable(),
      oldestAgeHours: z.number().int().nullable(),
    }),
    funnel: z.object({
      steps: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int() })),
      /** What this system does not record, named so nobody reads the funnel as complete. */
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
