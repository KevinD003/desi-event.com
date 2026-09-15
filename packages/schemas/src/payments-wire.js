/**
 * What a webhook endpoint answers with.
 *
 * Deliberately almost nothing. A webhook sender is a machine that needs to know
 * whether to retry, and telling it anything else — which payment, which order,
 * what changed — would put internal identifiers in a response to an
 * unauthenticated caller.
 *
 * `duplicate` is the one useful bit beyond the acknowledgement: it lets an
 * operator replaying a delivery by hand see that it had already been stored,
 * rather than wondering whether their replay did anything.
 *
 * @module @desi-event/schemas/payments-wire
 */

import { z } from 'zod'

/** `POST /v1/webhooks/stripe` and `POST /v1/webhooks/stripe/connect`. */
export const webhookAckResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean().default(false),
})
