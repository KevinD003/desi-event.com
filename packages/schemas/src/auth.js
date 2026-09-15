/**
 * Request and response shapes for the Phase 2 authentication surface.
 *
 * Kept in their own module rather than added to `requests.js` and `responses.js`
 * because there are twenty of them and they belong to one feature: sessions,
 * devices, email verification, password reset, and a second factor. The rest of
 * the API's shapes are about tickets and money.
 *
 * Two conventions run through all of them, and both are about what is *absent*:
 *
 *   - **No response carries a credential except the one that issues it.** A
 *     session list describes sessions; it does not include their tokens. A
 *     device list describes devices; it does not include their fingerprints. The
 *     TOTP secret appears exactly once, in the response to the enrolment request
 *     that generated it, and never again.
 *   - **No response says whether an account exists.** Registration, sign-in,
 *     "forgot password" and "resend verification" all answer the same way for a
 *     known and an unknown address. The one exception is registration's 409 for a
 *     duplicate, which is unavoidable if the form is to be usable — and which is
 *     rate-limited for exactly that reason.
 *
 * @module @desi-event/schemas/auth
 */

import { z } from 'zod'

import { mfaFactorTypeSchema } from './enums.js'
import {
  cuidSchema,
  emailSchema,
  localeSchema,
  nonEmptyStringSchema,
  passwordSchema,
  phoneSchema,
  timestampSchema,
} from './primitives.js'
import { publicUserSchema } from './entities.js'

/**
 * A short human-supplied label, trimmed and bounded.
 *
 * `nonEmptyStringSchema` cannot be narrowed with `.max()`: it is a
 * `z.preprocess` pipe, and normalisation has to stay in the preprocess step so
 * that `z.toJSONSchema` can render these schemas for the OpenAPI document. So
 * the bound is applied where the string is, inside the pipe.
 *
 * @param {number} max Longest accepted length.
 * @returns {object} The schema.
 */
function labelSchema(max) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().min(1).max(max),
  )
}

/**
 * A one-time password as typed.
 *
 * Length is not pinned to six here: a recovery code is also accepted where a
 * TOTP code is, and the two are told apart by shape rather than by asking the
 * person which one they are using.
 */
export const otpCodeSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value),
    z
      .string()
      .min(6)
      .max(24)
      .regex(/^[0-9A-Z]+$/, 'Expected a numeric code or a recovery code'),
  )
  .describe('A TOTP code or a recovery code. Spaces and hyphens are ignored.')

/** An opaque secret from a link or a cookie. Never logged. */
export const opaqueTokenSchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, 'Expected a url-safe token')

/** `POST /v1/auth/register`. */
export const registerAccountRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: nonEmptyStringSchema,
  phone: phoneSchema.optional(),
  locale: localeSchema.default('en-IN'),
  // Only these two are self-service. Every other role is granted out of band,
  // and a request naming one is refused by schema rather than by a handler
  // remembering to check.
  role: z.enum(['ATTENDEE', 'ORGANIZER']).default('ATTENDEE'),
})

/** `POST /v1/auth/login`. */
export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  // Supplied when the account has a second factor. Absent on the first attempt,
  // which is answered with `mfaRequired` rather than an error.
  code: otpCodeSchema.optional(),
  // A label the person gives this browser, shown in their device list.
  deviceLabel: labelSchema(120).optional(),
})

/** `POST /v1/auth/verify-email`. */
export const verifyEmailRequestSchema = z.object({ token: opaqueTokenSchema })

/** `POST /v1/auth/resend-verification`. */
export const resendVerificationRequestSchema = z.object({ email: emailSchema })

/** `POST /v1/auth/forgot-password`. */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema })

/** `POST /v1/auth/reset-password`. */
export const resetPasswordRequestSchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema,
})

/** `POST /v1/auth/change-password`. */
export const changePasswordRequestSchema = z.object({
  // Required even though the caller is already authenticated: a session is
  // evidence of who they were when they signed in, not evidence that the person
  // at the keyboard now knows the password.
  currentPassword: z.string().min(1).max(128),
  password: passwordSchema,
})

/** `POST /v1/auth/step-up`. */
export const stepUpRequestSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    code: otpCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.password ?? value.code), {
    message: 'Supply a password or a one-time code',
  })

/** `POST /v1/auth/mfa/totp` — begin enrolment. */
export const enrollTotpRequestSchema = z.object({
  label: labelSchema(120).optional(),
})

/** `POST /v1/auth/mfa/totp/confirm` — prove the authenticator was set up. */
export const confirmTotpRequestSchema = z.object({
  factorId: cuidSchema,
  code: otpCodeSchema,
})

/** `POST /v1/auth/mfa/:id/disable`. */
export const disableMfaRequestSchema = z.object({
  // Disabling a factor is a privilege change, so it is gated on knowing the
  // password rather than on holding the session that the factor protects.
  currentPassword: z.string().min(1).max(128),
})

/** `POST /v1/auth/logout`. */
export const signOutRequestSchema = z.object({
  everywhere: z.boolean().default(false),
})

/** `POST /v1/auth/sessions/:id/revoke` and `POST /v1/auth/devices/:id/revoke`. */
export const revokeRequestSchema = z.object({
  reason: labelSchema(200).optional(),
})

/**
 * What a session looks like to the person who owns it.
 *
 * Deliberately not a `Session` row: no token digest, no raw IP address. What is
 * left is enough for somebody to recognise a session as theirs or not — when it
 * started, what browser, roughly where — which is the only question this list
 * exists to answer.
 */
export const sessionSummarySchema = z.object({
  id: cuidSchema,
  current: z.boolean().describe('True for the session making this request.'),
  createdAt: timestampSchema,
  lastSeenAt: timestampSchema,
  expiresAt: timestampSchema,
  userAgent: z.string().max(400).nullish(),
  deviceId: cuidSchema.nullish(),
  deviceLabel: z.string().max(120).nullish(),
  mfaSatisfiedAt: timestampSchema.nullish(),
})

/** What a device looks like to the person who owns it. */
export const deviceSummarySchema = z.object({
  id: cuidSchema,
  label: z.string().max(120).nullish(),
  trusted: z.boolean(),
  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
  activeSessions: z.int().min(0),
})

/** What an enrolled factor looks like. Never the secret. */
export const mfaFactorSummarySchema = z.object({
  id: cuidSchema,
  type: mfaFactorTypeSchema,
  label: z.string().max(120).nullish(),
  confirmed: z.boolean(),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullish(),
})

/**
 * The response to a successful sign-in.
 *
 * `token` is retained for API clients that cannot hold a cookie, and is the same
 * secret the cookie carries — there is one session, reachable two ways, rather
 * than two credentials to revoke separately.
 *
 * `mfaRequired` is how a first attempt without a code is answered: 200 with no
 * session, rather than an error. An error would have to distinguish "wrong
 * password" from "right password, now show me a code", which tells an attacker
 * which passwords are correct.
 */
export const signInResponseSchema = z.object({
  token: z.string().min(1).nullish(),
  tokenType: z.literal('Bearer').default('Bearer'),
  expiresAt: timestampSchema.nullish(),
  csrfToken: z.string().min(1).nullish(),
  user: publicUserSchema.nullish(),
  mfaRequired: z.boolean().default(false),
  emailVerificationRequired: z.boolean().default(false),
  sessionId: cuidSchema.nullish(),
})

/** `GET /v1/auth/me`, extended with what the session itself can do. */
export const currentSessionResponseSchema = z.object({
  data: z.object({
    user: publicUserSchema,
    capabilities: z.array(z.string().min(1)),
    memberships: z.array(
      z.object({
        organizationId: cuidSchema,
        organizationName: nonEmptyStringSchema.nullish(),
        role: z.string().min(1),
        capabilities: z.array(z.string().min(1)),
      }),
    ),
    session: z.object({
      id: cuidSchema,
      expiresAt: timestampSchema,
      stepUpSatisfied: z.boolean(),
      mfaRequired: z.boolean(),
      mfaEnrolled: z.boolean(),
    }),
  }),
})

/** `GET /v1/auth/sessions`. */
export const sessionListResponseSchema = z.object({ data: z.array(sessionSummarySchema) })

/** `GET /v1/auth/devices`. */
export const deviceListResponseSchema = z.object({ data: z.array(deviceSummarySchema) })

/** `GET /v1/auth/mfa`. */
export const mfaFactorListResponseSchema = z.object({
  data: z.object({
    required: z.boolean().describe("Whether this account's roles require a second factor."),
    satisfied: z.boolean().describe('Whether a confirmed factor exists.'),
    factors: z.array(mfaFactorSummarySchema),
  }),
})

/**
 * The response to beginning TOTP enrolment.
 *
 * The only place a TOTP secret ever appears. It is shown once, over TLS, and the
 * factor is unusable until {@link confirmTotpRequestSchema} proves the
 * authenticator actually has it — so an abandoned enrolment leaves an
 * unconfirmed row rather than a second factor nobody can produce a code for.
 */
export const totpEnrollmentResponseSchema = z.object({
  data: z.object({
    factorId: cuidSchema,
    secret: z.string().min(16),
    uri: z.string().min(1),
    digits: z.int(),
    periodSeconds: z.int(),
    algorithm: z.string().min(1),
  }),
})

/**
 * The response to confirming TOTP enrolment.
 *
 * Recovery codes appear once, here. They are stored as digests, so there is no
 * later request that can return them: losing them means generating a new set.
 */
export const totpConfirmedResponseSchema = z.object({
  data: z.object({
    factorId: cuidSchema,
    recoveryCodes: z.array(z.string().min(8)),
  }),
})

/**
 * The uniform answer to every request that would otherwise reveal whether an
 * address has an account.
 *
 * One shape for "we sent a verification email", "we sent a reset link" and "we
 * did neither because nobody has that address". The caller cannot tell which,
 * which is the point.
 */
export const acceptedResponseSchema = z.object({
  data: z.object({
    accepted: z.literal(true),
    message: nonEmptyStringSchema,
  }),
})
