/**
 * Privacy redaction, holds and retention.
 *
 * These schemas describe what a browser may say about a redaction and what the
 * server says back. The asymmetry is the point: a request names a subject and a
 * reason and nothing else, while a response describes *scope* — how many rows in
 * which categories — and never a value.
 *
 * Two absences are deliberate and load-bearing.
 *
 * Nothing here accepts an organisation id. Organisation scope is resolved from
 * the caller's session on the server, and a caller-supplied organisation is a
 * caller-supplied authority. The one place an organisation appears in a request
 * is a path parameter, where the route's `capabilityScope` reads it and the
 * capability check refuses a caller who does not hold `privacy:redact` there.
 *
 * Nothing here accepts an idempotency key or a confirmation token as input to
 * the *raising* of a request. Both are minted by the server: a caller-chosen
 * idempotency key is a caller-chosen replay, and a caller-chosen confirmation is
 * not a confirmation.
 *
 * @module @desi-event/schemas/privacy
 */

import { z } from 'zod'

import {
  exportArtifactStateSchema,
  privacyAuditResultSchema,
  privacyHoldDecisionSchema,
  privacyHoldKindSchema,
  privacyHoldStateSchema,
  privacyRequestReasonSchema,
  privacyRequestStateSchema,
  retentionSweepModeSchema,
  retentionSweepStateSchema,
} from './enums.js'
import {
  cuidSchema,
  nonEmptyStringSchema,
  paginationQuerySchema,
  timestampSchema,
} from './primitives.js'
import { paginationMetaSchema } from './responses.js'

/**
 * The personal-data categories a redaction is expressed in.
 *
 * Categories rather than columns, because a category is what an operator can be
 * asked to confirm and a column list is a map of where the personal data is.
 * The mapping from category to column lives on the server.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRIVACY_DATA_CATEGORIES = Object.freeze([
  'ACCOUNT_IDENTITY',
  'BUYER_IDENTITY',
  'TICKET_HOLDER_IDENTITY',
  'NOTIFICATION_DELIVERY',
  'SECURITY_METADATA',
  'EXPORTS',
])

/** One personal-data category. */
export const privacyDataCategorySchema = z.enum(PRIVACY_DATA_CATEGORIES)

/**
 * How much there is to redact in one category.
 *
 * A count and a category name. Never a value, and never a column name: a
 * preview an operator reads must not become a map of where the personal data
 * is.
 */
export const privacyScopeEntrySchema = z.object({
  category: privacyDataCategorySchema,
  rows: z.int().min(0),
  /// Why the count is what it is. A count of zero cannot distinguish "there was
  /// nothing of this kind" from "this organisation may not touch it", and an
  /// operator confirming an irreversible action is owed the difference.
  status: z.enum(['REDACTED', 'NOTHING_TO_DO', 'ALREADY_REDACTED', 'OUT_OF_SCOPE', 'DEFERRED']),
})

/**
 * What a redaction request looks like to an authorised operator.
 *
 * `subjectId` is an opaque row id, which is what makes this payload safe: it
 * identifies the person to the system without naming them. There is no
 * `subjectEmail`, no `subjectName`, and no field carrying anything that was or
 * will be redacted.
 */
export const privacyRequestSchema = z.object({
  id: cuidSchema,
  subjectId: cuidSchema,
  state: privacyRequestStateSchema,
  reason: privacyRequestReasonSchema,
  holdDecision: privacyHoldDecisionSchema,
  /// The policy revision the request was evaluated against.
  policyVersion: nonEmptyStringSchema,
  /// Ties this request's audit events together. Server-minted, never a secret.
  correlationId: nonEmptyStringSchema,
  /// Category counts, when they have been established. Null before the preview.
  scope: z.array(privacyScopeEntrySchema).nullable(),
  /// A closed-vocabulary code once the request is terminal.
  outcomeCode: nonEmptyStringSchema.nullable(),
  requestedAt: timestampSchema,
  confirmedAt: timestampSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
})

/** `GET /v1/organizations/:id/privacy/requests`. */
export const privacyRequestListResponseSchema = z.object({
  data: z.array(privacyRequestSchema),
  pagination: paginationMetaSchema,
})

/** `GET /v1/organizations/:id/privacy/requests/:requestId`. */
export const privacyRequestResponseSchema = z.object({
  data: privacyRequestSchema,
})

/**
 * Filters for the request list.
 *
 * `subjectId` is a cuid and never an address: searching by e-mail would make
 * this endpoint a way to confirm whether a given person is in the system, which
 * is exactly the question a redaction is supposed to stop answering.
 */
export const privacyRequestListQuerySchema = paginationQuerySchema.extend({
  state: privacyRequestStateSchema.optional(),
  subjectId: cuidSchema.optional(),
})

/**
 * Raising a redaction request.
 *
 * Two fields, and the shortness is the design. Everything else a redaction needs
 * — which organisation, whether the caller may act there, whether a hold blocks
 * it, which idempotency key, which policy revision, what the confirmation phrase
 * is — is decided on the server. A request body that could carry any of them
 * would be a request body that could lie about them.
 *
 * `subjectId` is a cuid rather than an address for the same reason the list
 * filter is: accepting an address would turn this route into a way to ask
 * whether a given person exists in the system.
 */
export const privacyRequestCreateSchema = z.object({
  subjectId: cuidSchema,
  reason: privacyRequestReasonSchema,
})

/**
 * The confirmation the server issues when a request is raised.
 *
 * Returned exactly once, in the creation response. Only its digest is stored, so
 * this is the only moment the phrase exists anywhere the operator can read it —
 * re-fetching the request will not produce it again.
 */
export const privacyConfirmationSchema = z.object({
  phrase: nonEmptyStringSchema,
  expiresAt: timestampSchema,
})

/** `POST /v1/organizations/:id/privacy/requests`. */
export const privacyRequestCreatedResponseSchema = z.object({
  data: privacyRequestSchema,
  confirmation: privacyConfirmationSchema,
})

/**
 * Confirming a redaction.
 *
 * The phrase the server issued, typed back. Note what is absent: no `confirmed`
 * boolean, no `force`, no `skipHolds`, no outcome. A redaction that could be
 * triggered by a client-supplied flag would be a redaction an accidental request
 * replay could perform.
 */
export const privacyRequestConfirmSchema = z.object({
  confirmationPhrase: nonEmptyStringSchema,
})

/** Withdrawing a request before it executes. */
export const privacyRequestCancelSchema = z.object({
  reasonCode: z.enum(['NO_LONGER_REQUIRED', 'RAISED_IN_ERROR', 'SUPERSEDED']),
})

/**
 * A hold, as an authorised operator sees it.
 *
 * `matterReference` points at the matter; it never describes it. An allegation,
 * a counterparty's name or a summary of an investigation would all be personal
 * data about somebody, recorded in the one place this subsystem exists to keep
 * clean.
 */
export const privacyHoldSchema = z.object({
  id: cuidSchema,
  subjectId: cuidSchema,
  kind: privacyHoldKindSchema,
  state: privacyHoldStateSchema,
  matterReference: nonEmptyStringSchema,
  placedAt: timestampSchema,
  expectedUntil: timestampSchema.nullable(),
  releasedAt: timestampSchema.nullable(),
  releaseReasonCode: nonEmptyStringSchema.nullable(),
})

/**
 * Placing a hold.
 *
 * `matterReference` is bounded and required. An unbounded field here would be
 * the obvious place for somebody to type the circumstances, and the
 * circumstances are personal data about the person whose erasure is being
 * blocked.
 */
export const privacyHoldCreateSchema = z.object({
  subjectId: cuidSchema,
  kind: privacyHoldKindSchema,
  matterReference: z.string().trim().min(3).max(120),
  expectedUntil: timestampSchema.nullable().optional(),
})

/** Lifting a hold. A code, never a sentence. */
export const privacyHoldReleaseSchema = z.object({
  releaseReasonCode: z.enum([
    'MATTER_CLOSED',
    'COUNSEL_INSTRUCTION',
    'INVESTIGATION_CLOSED',
    'PLACED_IN_ERROR',
  ]),
})

/** `GET /v1/organizations/:id/privacy/holds`. */
export const privacyHoldListResponseSchema = z.object({
  data: z.array(privacyHoldSchema),
  pagination: paginationMetaSchema,
})

/** `POST /v1/organizations/:id/privacy/holds` and the release action. */
export const privacyHoldResponseSchema = z.object({ data: privacyHoldSchema })

/** Filters for the hold list. */
export const privacyHoldListQuerySchema = paginationQuerySchema.extend({
  state: privacyHoldStateSchema.optional(),
  subjectId: cuidSchema.optional(),
})

/**
 * One entry in a request's evidence timeline.
 *
 * Every field is an opaque id, an enum, a closed-vocabulary code or a timestamp.
 * `detail` carries counts and category names and nothing else — there is no
 * before-value, no after-value, and no message. That is what makes the timeline
 * safe to show to somebody investigating an incident about a person who has
 * already been redacted.
 */
export const privacyAuditEventSchema = z.object({
  id: cuidSchema,
  action: nonEmptyStringSchema,
  actorId: cuidSchema.nullable(),
  targetId: cuidSchema,
  targetType: nonEmptyStringSchema,
  reasonCode: nonEmptyStringSchema,
  holdDecision: privacyHoldDecisionSchema,
  result: privacyAuditResultSchema,
  policyVersion: nonEmptyStringSchema,
  correlationId: nonEmptyStringSchema,
  detail: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: timestampSchema,
})

/** `GET /v1/organizations/:id/privacy/requests/:requestId/events`. */
export const privacyAuditEventListResponseSchema = z.object({
  data: z.array(privacyAuditEventSchema),
  pagination: paginationMetaSchema,
})

/**
 * One retention rehearsal, as an authorised reader sees it.
 *
 * Every field is a class name, an enum, a count or a timestamp. There is no
 * field here that could carry a person's data, and that is structural rather
 * than careful: the sweep that wrote the row never read a personal value in the
 * first place — its queries ask about timestamps and about whether a column is
 * null, never what is in one.
 *
 * `approval` is not stored. It is attached by the server on the way out,
 * because a duration that reaches a reader without
 * `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW` beside it is a duration somebody
 * will eventually mistake for policy. Carrying it in the payload means the
 * label travels with the number instead of living in a document beside it.
 *
 * `leaseOwner` is deliberately absent. It names a worker process, which is
 * infrastructure detail a reader cannot act on and an attacker would rather
 * have.
 */
export const retentionSweepSchema = z.object({
  id: cuidSchema,
  retentionClass: nonEmptyStringSchema,
  mode: retentionSweepModeSchema,
  state: retentionSweepStateSchema,
  /// The cut-off this run used, so a later change of proposal does not make an
  /// earlier run's behaviour unexplainable.
  olderThan: timestampSchema,
  examinedCount: z.number().int().min(0),
  /// Always 0 for a `DRY_RUN`, which a CHECK constraint enforces in the
  /// database rather than trusting any writer.
  affectedCount: z.number().int().min(0),
  heldCount: z.number().int().min(0),
  /// A closed-vocabulary code when the run failed. Never a driver message.
  failureCode: nonEmptyStringSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  /// Server-attached, never stored: the approval status of the duration behind
  /// this class.
  approval: nonEmptyStringSchema,
})

/**
 * A retention class the sweep names but does not evaluate, and why.
 *
 * Reported rather than omitted. A class that silently disappeared from the list
 * would read as a class that was swept and found empty, which is a different
 * claim entirely — and the wrong one.
 */
export const retentionNotEvaluatedSchema = z.object({
  retentionClass: nonEmptyStringSchema,
  proposedDays: z.number().int().min(0),
  approval: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
})

/**
 * Where one evaluated class stands, taken from its most recent run.
 *
 * ## What this is for
 *
 * The list is paginated and newest-first, so it answers "what happened
 * recently". It does not answer "is any class being missed", because a class
 * whose last rehearsal was four pages ago looks identical to a class that has
 * never been rehearsed at all — both are simply absent from the page in front
 * of you. A filter makes it worse: narrowing to `FAILED` produces a screen on
 * which every class appears broken.
 *
 * ## Why `latest` is nullable rather than omitted
 *
 * Because "no rehearsal has ever covered this class" is a finding, and the way
 * to report a finding is to say it. A class dropped from the array would be
 * indistinguishable from a class the rollup forgot.
 *
 * ## What is deliberately not here
 *
 * `proposedDays` and `basis`. They are compile-time constants in
 * `RETENTION_CLASS_PROPOSALS`, which the browser already imports from this
 * package — sending them over the wire would be paying for a round trip to
 * learn something the reader was built with, and would create a second copy
 * that could disagree with the first.
 */
export const retentionClassSummarySchema = z.object({
  retentionClass: nonEmptyStringSchema,
  /// The most recent run for this class, or null when none has ever run.
  latest: retentionSweepSchema.nullable(),
  /// How many runs this class has, so "once, months ago" is distinguishable
  /// from "every week".
  runCount: z.number().int().min(0),
})

/**
 * `GET /v1/operations/retention/sweeps`.
 *
 * There is deliberately no `enforcementActivated` field. Activation is a
 * *worker* setting, and the API is a different process that cannot see it —
 * a flag answered from the API's own environment would be a guess presented as
 * a fact, and the two could disagree without either noticing.
 *
 * The rows carry the answer honestly instead: a `SKIPPED_DISABLED` sweep is the
 * worker stating, at a recorded instant, that it was told not to run. An empty
 * list means no rehearsal has ever run here, which is a third thing again and
 * worth being able to tell apart from the other two.
 */
export const retentionSweepListResponseSchema = z.object({
  data: z.array(retentionSweepSchema),
  pagination: paginationMetaSchema,
  /**
   * Classes named by the policy that no rehearsal evaluates, and why.
   *
   * Sent with the list rather than left to the reader to notice as an absence,
   * because a class that is simply missing reads as a class that was swept and
   * found empty.
   */
  notEvaluated: z.array(retentionNotEvaluatedSchema),
  /**
   * Where each evaluated class stands, independent of the page being read.
   *
   * Optional, and that is a deliberate contract decision rather than laziness.
   * This is a live response schema; making a new field required is a breaking
   * change to it, and Fastify serialises against this schema, so a required
   * field the handler failed to supply would be rejected on the way *out* — the
   * API refusing its own payload. Optional means a reader that predates the
   * field still validates, and a reader that expects it has to handle its
   * absence, which is the honest posture for a rollup that is a convenience
   * rather than the evidence itself.
   */
  summary: z.array(retentionClassSummarySchema).optional(),
})

/** Filters for the sweep list. */
export const retentionSweepListQuerySchema = paginationQuerySchema.extend({
  retentionClass: nonEmptyStringSchema.optional(),
  state: retentionSweepStateSchema.optional(),
})

/**
 * The kinds of export this system produces.
 *
 * A closed vocabulary rather than a free string, so the register cannot grow a
 * category nobody reviewed. Both entries are aggregate exports: neither
 * contains a name, an address, an e-mail or any other personal value, which is
 * why neither links a subject.
 *
 * @type {ReadonlyArray<string>}
 */
export const EXPORT_KINDS = Object.freeze(['analytics', 'finance'])

/** One export kind. */
export const exportKindSchema = z.enum([...EXPORT_KINDS])

/**
 * One entry in the export register.
 *
 * What it records is that an export *happened* — its kind, who asked, when,
 * and whether anything was stored. What it does not record is a single row of
 * what was exported. That asymmetry is the design: an export register that
 * held the export would be a second copy of the data, kept longer, under
 * weaker scrutiny.
 *
 * `subjectCount` is how many people the artefact is *known* to contain, via
 * `ExportArtifactSubject`. It is 0 for every export this system currently
 * produces, and that is a fact about the exports rather than a gap in the
 * register: both CSV routes emit aggregate figures under explicit column allow
 * lists that exclude every personal field.
 */
export const exportArtifactSchema = z.object({
  id: cuidSchema,
  kind: nonEmptyStringSchema,
  state: exportArtifactStateSchema,
  /// True when the bytes were streamed to the caller and nothing was kept,
  /// which is how every export in this system works today.
  ephemeral: z.boolean(),
  /// Whether bytes are stored anywhere. A boolean rather than the key itself:
  /// a storage key in a payload is a storage key in a log.
  stored: z.boolean(),
  /// Who asked. An opaque id, never a name.
  requestedById: cuidSchema.nullable(),
  subjectCount: z.number().int().min(0),
  generatedAt: timestampSchema,
  invalidatedAt: timestampSchema.nullable(),
  deletedAt: timestampSchema.nullable(),
  /// A closed-vocabulary code when a deletion did not succeed.
  failureCode: nonEmptyStringSchema.nullable(),
})

/** `GET /v1/organizations/:id/privacy/exports`. */
export const exportArtifactListResponseSchema = z.object({
  data: z.array(exportArtifactSchema),
  pagination: paginationMetaSchema,
})

/** Filters for the export register. */
export const exportArtifactListQuerySchema = paginationQuerySchema.extend({
  kind: exportKindSchema.optional(),
  state: exportArtifactStateSchema.optional(),
})
