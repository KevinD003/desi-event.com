/**
 * A small in-memory stand-in for the Prisma client.
 *
 * It is not a mock in the "assert it was called" sense. It stores rows, honours
 * the subset of the query language the API actually uses (`where` operators,
 * `include`, `orderBy`, `skip`/`take`, unique constraints) and — importantly —
 * implements `$transaction` with real snapshot rollback and real serialisation.
 * Without those two properties the oversell and payment-failure tests would be
 * asserting against a fiction.
 *
 * @module @desi-event/api/tests/helpers/prisma-stub
 */

/** Relations the API traverses, declared once so `include` can be generic. */
const RELATIONS = {
  event: {
    venue: { kind: 'one', model: 'venue', from: 'venueId', to: 'id' },
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    ticketTypes: { kind: 'many', model: 'ticketType', from: 'id', to: 'eventId' },
    // The lifecycle gates read the sessions and, through them, whether each
    // reserved session names a map version that has actually been published.
    sessions: { kind: 'many', model: 'eventSession', from: 'id', to: 'eventId' },
    moderationHistory: {
      kind: 'many',
      model: 'eventModerationAction',
      from: 'id',
      to: 'eventId',
    },
  },
  eventModerationAction: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
  },
  exportArtifact: {
    subjects: {
      kind: 'many',
      model: 'exportArtifactSubject',
      from: 'id',
      to: 'exportArtifactId',
    },
  },
  ticketType: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    holds: { kind: 'many', model: 'ticketHold', from: 'id', to: 'ticketTypeId' },
  },
  ticketHold: {
    ticketType: { kind: 'one', model: 'ticketType', from: 'ticketTypeId', to: 'id' },
  },
  order: {
    items: { kind: 'many', model: 'orderItem', from: 'id', to: 'orderId' },
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    // Nullable: a general-admission order names no session. Analytics groups
    // sales by session and has to tell "no session" from "session missing".
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
    payments: { kind: 'many', model: 'payment', from: 'id', to: 'orderId' },
  },
  orderItem: {
    tickets: { kind: 'many', model: 'ticket', from: 'id', to: 'orderItemId' },
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    ticketType: { kind: 'one', model: 'ticketType', from: 'ticketTypeId', to: 'id' },
  },
  ticket: {
    orderItem: { kind: 'one', model: 'orderItem', from: 'orderItemId', to: 'id' },
  },
  // "Is this person somebody this organisation holds data about?" is asked by
  // walking a waitlist entry to its event, which is how a subject who only ever
  // joined a queue is still in scope for a redaction.
  waitlistEntry: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
  },
  privacyRequest: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    subject: { kind: 'one', model: 'user', from: 'subjectUserId', to: 'id' },
  },
  privacyHold: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    subject: { kind: 'one', model: 'user', from: 'subjectUserId', to: 'id' },
  },
  ledgerBatch: {
    entries: { kind: 'many', model: 'ledgerEntry', from: 'id', to: 'batchId' },
  },
  ledgerEntry: {
    batch: { kind: 'one', model: 'ledgerBatch', from: 'batchId', to: 'id' },
    account: { kind: 'one', model: 'ledgerAccount', from: 'accountId', to: 'id' },
  },
  holdItem: {
    hold: { kind: 'one', model: 'ticketHold', from: 'holdId', to: 'id' },
    orderItem: { kind: 'one', model: 'orderItem', from: 'orderItemId', to: 'id' },
  },
  ticketTransfer: {
    ticket: { kind: 'one', model: 'ticket', from: 'ticketId', to: 'id' },
  },
  checkIn: {
    ticket: { kind: 'one', model: 'ticket', from: 'ticketId', to: 'id' },
  },
  refund: {
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    payment: { kind: 'one', model: 'payment', from: 'paymentId', to: 'id' },
    items: { kind: 'many', model: 'refundItem', from: 'id', to: 'refundId' },
  },
  refundItem: {
    refund: { kind: 'one', model: 'refund', from: 'refundId', to: 'id' },
    orderItem: { kind: 'one', model: 'orderItem', from: 'orderItemId', to: 'id' },
    ticket: { kind: 'one', model: 'ticket', from: 'ticketId', to: 'id' },
  },
  membership: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    scannerScopes: { kind: 'many', model: 'scannerScope', from: 'id', to: 'membershipId' },
  },
  session: {
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    device: { kind: 'one', model: 'device', from: 'deviceId', to: 'id' },
  },
  invitation: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    invitedBy: { kind: 'one', model: 'user', from: 'invitedById', to: 'id' },
  },
  eventSeat: {
    seat: { kind: 'one', model: 'seat', from: 'seatId', to: 'id' },
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
    hold: { kind: 'one', model: 'ticketHold', from: 'holdId', to: 'id' },
  },
  eventSession: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    eventSeats: { kind: 'many', model: 'eventSeat', from: 'id', to: 'eventSessionId' },
    // The publication gate reads this to refuse a reserved session whose map
    // version is still a draft.
    venueMapVersion: {
      kind: 'one',
      model: 'venueMapVersion',
      from: 'venueMapVersionId',
      to: 'id',
    },
  },
  seat: {
    section: { kind: 'one', model: 'section', from: 'sectionId', to: 'id' },
    row: { kind: 'one', model: 'seatRow', from: 'rowId', to: 'id' },
    // Also nullable: a seat outside every price zone is an ordinary state, and
    // the seat-inventory grouping labels it rather than dropping it.
    priceZone: { kind: 'one', model: 'priceZone', from: 'priceZoneId', to: 'id' },
  },
  payment: {
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    disputes: { kind: 'many', model: 'dispute', from: 'id', to: 'paymentId' },
  },
  dispute: {
    payment: { kind: 'one', model: 'payment', from: 'paymentId', to: 'id' },
  },
  payout: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
  },
  transfer: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
  },
  device: {
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    sessions: { kind: 'many', model: 'session', from: 'id', to: 'deviceId' },
  },
  mfaFactor: {
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
  },
  authToken: {
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
  },
}

/** Columns the database fills in, mirrored so rows look like real rows. */
const DEFAULTS = {
  user: { locale: 'en-IN', role: 'ATTENDEE', emailVerified: false, phone: null },
  membership: { role: 'VIEWER' },
  organization: {
    verified: false,
    payoutCurrency: 'INR',
    description: null,
    websiteUrl: null,
    verificationStatus: 'UNVERIFIED',
    verificationNote: null,
    verificationUpdatedAt: null,
    legalName: null,
    timezone: 'Asia/Kolkata',
    refundPolicy: null,
    suspendedAt: null,
    suspendedReason: null,
  },
  venue: {
    country: 'IN',
    addressLine2: null,
    latitude: null,
    longitude: null,
    capacity: null,
    slug: null,
    description: null,
    timezone: 'Asia/Kolkata',
    directions: null,
    policies: null,
    accessibility: null,
    provenance: null,
    organizationId: null,
    mergedIntoVenueId: null,
  },
  event: {
    status: 'DRAFT',
    timezone: 'Asia/Kolkata',
    isOnline: false,
    languages: [],
    venueId: null,
    coverImageUrl: null,
    onlineUrl: null,
    publishedAt: null,
    // The authoring editor's optimistic-concurrency precondition. Absent here,
    // the sessions route serialised `meta.revision: undefined` and the response
    // contract refused it — which is the contract doing its job.
    revision: 0,
  },
  ticketType: {
    currency: 'INR',
    quantitySold: 0,
    minPerOrder: 1,
    maxPerOrder: 10,
    status: 'DRAFT',
    sortOrder: 0,
    description: null,
    salesStartAt: null,
    salesEndAt: null,
  },
  ticketHold: {
    status: 'ACTIVE',
    orderId: null,
    userId: null,
    guestTokenHash: null,
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
  },
  order: {
    status: 'PENDING',
    currency: 'INR',
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    promoCodeId: null,
    userId: null,
    expiresAt: null,
    paidAt: null,
    cancelledAt: null,
  },
  orderItem: {},
  ticket: {
    status: 'VALID',
    checkedInAt: null,
    attendeeName: null,
    credentialHash: null,
    credentialVersion: 1,
    credentialIssuedAt: null,
    ownerUserId: null,
    eventSeatId: null,
    revokedAt: null,
    revokedReason: null,
    supersedesTicketId: null,
  },
  ticketTransfer: {
    fromUserId: null,
    toUserId: null,
    status: 'PENDING',
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    resultTicketId: null,
  },
  checkIn: {
    eventSessionId: null,
    scannedByUserId: null,
    deviceId: null,
    method: 'QR_SCAN',
    gate: null,
  },
  payment: {
    status: 'INITIATED',
    providerRef: null,
    failureCode: null,
    currency: 'INR',
    idempotencyKey: null,
    attemptNumber: 1,
    reconciliationRequired: false,
    rawProviderStatus: null,
    settledAt: null,
  },
  auditLog: { actorId: null, metadata: null },
  // Phase 3. Every nullable column is listed, because a column the stub leaves
  // `undefined` is a column a response schema refuses and a test then blames on
  // the handler.
  privacyRequest: {
    state: 'REQUESTED',
    holdDecision: 'NOT_EVALUATED',
    confirmedAt: null,
    heldByHoldId: null,
    outcomeCode: null,
    scope: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    attempts: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    failureCode: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  },
  privacyHold: {
    state: 'ACTIVE',
    expectedUntil: null,
    releasedById: null,
    releasedAt: null,
    releaseReasonCode: null,
  },
  privacyAuditEvent: {
    actorId: null,
    privacyRequestId: null,
    idempotencyKeyHash: null,
    detail: null,
  },
  exportArtifact: {
    storageKey: null,
    ephemeral: true,
    requestedById: null,
    state: 'AVAILABLE',
    invalidatedAt: null,
    deletedAt: null,
    failureCode: null,
  },
  exportArtifactSubject: {},
  retentionSweep: {
    state: 'SCHEDULED',
    examinedCount: 0,
    affectedCount: 0,
    heldCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    startedAt: null,
    finishedAt: null,
    failureCode: null,
  },
  promoCode: {
    active: true,
    redemptionCount: 0,
    eventId: null,
    maxRedemptions: null,
    startsAt: null,
    endsAt: null,
  },
  waitlistEntry: { quantity: 1, notified: false, userId: null },
  session: {
    deviceId: null,
    userAgent: null,
    ipHash: null,
    revokedAt: null,
    revokedReason: null,
    mfaSatisfiedAt: null,
    rotatedAt: null,
  },
  device: { label: null, trustedAt: null, revokedAt: null },
  mfaFactor: {
    label: null,
    confirmedAt: null,
    lastUsedAt: null,
    usedAt: null,
    disabledAt: null,
  },
  authToken: { userId: null, subjectId: null, usedAt: null, revokedAt: null },
  loginAttempt: { succeeded: false },
  invitation: {
    status: 'PENDING',
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  },
  scannerScope: {},
  venueMap: { notes: null, archivedAt: null },
  venueMapVersion: { publishedAt: null, seatCount: 0, revision: 0 },
  section: { kind: 'SEATED', sortOrder: 0, standingCapacity: null },
  seatRow: { sortOrder: 0 },
  priceZone: { colourToken: 'zone-default', sortOrder: 0 },
  seat: {
    rowId: null,
    sortOrder: 0,
    priceZoneId: null,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
  },
  eventSession: {
    doorsOpenAt: null,
    timezone: 'Asia/Kolkata',
    salesStartAt: null,
    salesEndAt: null,
    status: 'SCHEDULED',
    venueMapVersionId: null,
    capacity: null,
    sortOrder: 0,
  },
  eventSeat: {
    ticketTypeId: null,
    status: 'AVAILABLE',
    holdId: null,
    orderItemId: null,
    priceCentsOverride: null,
    blockedReason: null,
  },
  holdItem: { quantity: 1, eventSeatId: null, orderItemId: null, unitPriceCents: null },
  webhookEvent: {
    accountContext: '',
    apiVersion: null,
    providerCreatedAt: null,
    payloadHash: null,
    orderId: null,
    paymentId: null,
    state: 'RECEIVED',
    attemptCount: 0,
    nextAttemptAt: null,
    processedAt: null,
    processingError: null,
  },
  reconciliationTask: {
    state: 'OPEN',
    paymentId: null,
    orderId: null,
    refundId: null,
    webhookEventId: null,
    providerRef: null,
    localState: null,
    providerState: null,
    attempts: 0,
    lastError: null,
    assignedToId: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    resolvedById: null,
    escalatedAt: null,
    escalationReason: null,
    organizationId: null,
    notes: null,
    transferId: null,
    payoutId: null,
    disputeId: null,
  },
  organizationVerificationEvent: { fromStatus: null, actorId: null, reason: null },
  // The lifecycle writes one of these per transition, so the delegate has to
  // exist even in suites that never read them back.
  eventModerationAction: {
    actorId: null,
    fromStatus: null,
    reason: null,
    requestedChanges: null,
  },
  notificationOutbox: {
    channel: 'EMAIL',
    userId: null,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 5,
    sentAt: null,
    lastError: null,
    suppressible: true,
    businessEvent: null,
    templateVersion: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastAttemptAt: null,
    failureCategory: null,
    providerMessageId: null,
    organizationId: null,
  },
  refund: {
    providerRefundId: null,
    reason: 'CUSTOMER_REQUEST',
    reasonNote: null,
    status: 'REQUESTED',
    allocation: null,
    platformFeeRefundedCents: 0,
    transferReversedCents: 0,
    requestedById: null,
    approvedById: null,
    ticketsRevoked: false,
    inventoryReturned: false,
    failureCode: null,
    rawProviderStatus: null,
    submittedAt: null,
    attempts: 0,
    settledAt: null,
  },
  dispute: {
    status: 'OPENED',
    reason: null,
    evidenceDueAt: null,
    rawProviderStatus: null,
    fundsWithheld: true,
    closedAt: null,
  },
  transfer: {
    connectedAccountId: null,
    orderId: null,
    providerTransferId: null,
    status: 'PENDING',
    reversedCents: 0,
    failureCode: null,
    rawProviderStatus: null,
    settledAt: null,
  },
  payout: {
    connectedAccountId: null,
    providerPayoutId: null,
    status: 'SCHEDULED',
    arrivalDate: null,
    failureCode: null,
    rawProviderStatus: null,
    reversedCents: 0,
    idempotencyKey: null,
    holdReason: null,
  },
  refundItem: { ticketId: null },
  ledgerAccount: { currency: null, active: true },
  ledgerBatch: {
    status: 'DRAFT',
    debitCents: 0,
    creditCents: 0,
    orderId: null,
    paymentId: null,
    refundId: null,
    disputeId: null,
    transferId: null,
    payoutId: null,
    compensatesBatchId: null,
    actorId: null,
    postedAt: null,
  },
  ledgerEntry: { memo: null, organizationId: null },
  connectedAccount: {
    providerMode: 'test',
    country: null,
    defaultCurrency: null,
    onboardingStatus: 'NOT_STARTED',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    disabledReason: null,
    requirementsDue: null,
    syncedAt: null,
  },
}

/** Unique constraints the API relies on the database to enforce. */
const UNIQUE_FIELDS = {
  user: ['email'],
  // Both matter, and for different reasons: `idempotencyKey` is what makes a
  // retried post a no-op, and `reference` is what makes two unrelated batches
  // refuse to share an identity. The service distinguishes them, so the stub
  // has to as well.
  ledgerBatch: ['idempotencyKey', 'reference'],
  ledgerAccount: ['code'],
  invitation: ['tokenHash'],
  event: ['slug'],
  // What makes cancelling twice write one notice and one refund request rather
  // than two. `skipDuplicates` relies on the stub honouring these.
  notificationOutbox: ['dedupeKey'],
  refund: ['idempotencyKey'],
  order: ['reference'],
  ticket: ['code', 'credentialHash', 'eventSeatId', 'supersedesTicketId'],
  session: ['tokenHash'],
  authToken: ['tokenHash'],
  // One ticket, one attendance. The database enforces it with a unique index on
  // CheckIn.ticketId, and two scanners racing is exactly the case the stub has
  // to reproduce for the check-in tests to mean anything.
  checkIn: ['ticketId'],
  ticketTransfer: ['tokenHash', 'resultTicketId'],
  payout: ['idempotencyKey'],
  transfer: ['idempotencyKey'],
}

/**
 * Compound unique constraints, as `[fields]` per model.
 *
 * Separate from {@link UNIQUE_FIELDS} because a compound key is only violated
 * when *every* field matches, and the auth code depends on one:
 * `Device(userId, fingerprintHash)` is what makes two simultaneous sign-ins from
 * the same browser produce one device row rather than two.
 *
 * @type {Record<string, string[][]>}
 */
const COMPOUND_UNIQUE = {
  device: [['userId', 'fingerprintHash']],
  // The index that makes webhook replay a no-op. Carries the account context,
  // because the same provider event id for two connected accounts is two facts.
  webhookEvent: [['provider', 'accountContext', 'providerEventId']],
  connectedAccount: [['provider', 'providerAccountId']],
  dispute: [['provider', 'providerDisputeId']],
  payout: [['provider', 'providerPayoutId']],
  transfer: [['provider', 'providerTransferId']],
  holdItem: [['holdId', 'eventSeatId']],
  seat: [['venueMapVersionId', 'label']],
  eventSeat: [['eventSessionId', 'seatId']],
  venueMapVersion: [['venueMapId', 'version']],
  membership: [['userId', 'organizationId']],
  scannerScope: [['membershipId', 'eventId']],
  exportArtifactSubject: [['exportArtifactId', 'subjectUserId']],
}

/** Models that carry `createdAt`/`updatedAt`. */
const TIMESTAMPED = new Set([
  'user',
  'organization',
  'venue',
  'event',
  'ticketType',
  'ticketHold',
  'order',
  'ticket',
  'payment',
  'promoCode',
  'membership',
  'reconciliationTask',
  'connectedAccount',
  'notificationOutbox',
  'refund',
  'dispute',
  'transfer',
  'payout',
  'privacyRequest',
  'privacyHold',
  'exportArtifact',
  'retentionSweep',
])

/**
 * Models whose rows carry only `createdAt`.
 *
 * Sessions, devices and tokens have their own more specific timestamps and no
 * `updatedAt`; adding one would put a column on the stub's rows that the real
 * schema does not have, which is how a stub starts lying.
 *
 * @type {Set<string>}
 */
const CREATED_ONLY = new Set([
  'session',
  'device',
  'mfaFactor',
  'authToken',
  'loginAttempt',
  'invitation',
  'scannerScope',
  'venueMap',
  'venueMapVersion',
  'eventSession',
  'webhookEvent',
  'ledgerAccount',
  'ledgerBatch',
  'ledgerEntry',
  'organizationVerificationEvent',
  'eventModerationAction',
  'ticketTransfer',
  'checkIn',
  'refundItem',
  // An audit row with no timestamp is not an audit row. The column is
  // `@default(now())` in the schema and was missing here, so every test that
  // read one back saw `createdAt: undefined` and none of them looked.
  'auditLog',
  // Append-only at the database, so there is no `updatedAt` to carry: a row
  // that could be updated would not be evidence.
  'privacyAuditEvent',
  'exportArtifactSubject',
])

let idCounter = 0

/**
 * Generate an id shaped like a Prisma `cuid()`.
 *
 * @returns {string} A value that satisfies `cuidSchema`.
 */
export function cuid() {
  idCounter += 1
  const body = `${idCounter.toString(36)}${Math.random().toString(36).slice(2)}`.replace(
    /[^a-z0-9]/g,
    'x',
  )
  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * Compare a stored value against one `where` condition.
 *
 * @param {unknown} value The stored value.
 * @param {unknown} condition The condition: a literal, or an operator object.
 * @returns {boolean} Whether the value satisfies the condition.
 */
function matchesCondition(value, condition) {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
    if (value instanceof Date && condition instanceof Date) {
      return value.getTime() === condition.getTime()
    }
    return value === condition
  }

  if (Array.isArray(condition)) return condition.includes(value)

  const insensitive = condition.mode === 'insensitive'
  const fold = (input) => (insensitive && typeof input === 'string' ? input.toLowerCase() : input)

  for (const [operator, operand] of Object.entries(condition)) {
    if (operator === 'mode') continue

    switch (operator) {
      case 'equals':
        if (!matchesCondition(fold(value), fold(operand))) return false
        break
      case 'not':
        if (matchesCondition(fold(value), fold(operand))) return false
        break
      case 'in':
        if (!operand.map(fold).includes(fold(value))) return false
        break
      case 'notIn':
        if (operand.map(fold).includes(fold(value))) return false
        break
      case 'contains':
        if (typeof value !== 'string' || !fold(value).includes(fold(operand))) return false
        break
      case 'startsWith':
        if (typeof value !== 'string' || !fold(value).startsWith(fold(operand))) return false
        break
      case 'gt':
        if (!(toComparable(value) > toComparable(operand))) return false
        break
      case 'gte':
        if (!(toComparable(value) >= toComparable(operand))) return false
        break
      case 'lt':
        if (!(toComparable(value) < toComparable(operand))) return false
        break
      case 'lte':
        if (!(toComparable(value) <= toComparable(operand))) return false
        break
      default:
        throw new Error(`prisma-stub: unsupported operator "${operator}"`)
    }
  }

  return true
}

/**
 * Coerce a value into something the relational operators can compare.
 *
 * @param {unknown} value Value to coerce.
 * @returns {number|string} A comparable value.
 */
function toComparable(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return Date.parse(value)
  return /** @type {number|string} */ (value)
}

/**
 * Create the store and the delegate factory.
 *
 * @param {object} [seed] Initial rows, keyed by model name.
 * @returns {object} A Prisma-like client with a `_store` escape hatch for assertions.
 */
export function createPrismaStub(seed = {}) {
  /** @type {Record<string, object[]>} */
  const tables = {}
  for (const model of Object.keys(DEFAULTS)) tables[model] = []
  for (const [model, rows] of Object.entries(seed)) {
    tables[model] = rows.map((row) => ({ ...row }))
  }

  /** @type {string[]} */
  const rawQueries = []
  /** @type {Promise<unknown>} */
  let transactionChain = Promise.resolve()

  /**
   * Resolve a `where` fragment against a row, including relation conditions.
   *
   * @param {string} model The model being queried.
   * @param {object} row The candidate row.
   * @param {object} where The `where` fragment.
   * @returns {boolean} Whether the row matches.
   */
  function matches(model, row, where) {
    if (!where) return true

    for (const [key, condition] of Object.entries(where)) {
      if (key === 'AND') {
        if (!toArray(condition).every((clause) => matches(model, row, clause))) return false
        continue
      }
      if (key === 'OR') {
        if (!toArray(condition).some((clause) => matches(model, row, clause))) return false
        continue
      }
      if (key === 'NOT') {
        if (toArray(condition).some((clause) => matches(model, row, clause))) return false
        continue
      }

      // A compound unique key arrives as `{ eventId_email: { eventId, email } }`.
      // There is no such column on the row, so match each part instead.
      if (key.includes('_') && isCompoundKey(key, condition)) {
        if (!matches(model, row, condition)) return false
        continue
      }

      const relation = RELATIONS[model]?.[key]
      if (relation && condition && typeof condition === 'object') {
        const related = resolveRelation(model, row, key)
        if (relation.kind === 'one') {
          if (!related || !matches(relation.model, related, condition)) return false
          continue
        }

        // Prisma's to-many filters. Without these, `{ subjects: { some: {…} } }`
        // reached `matchesCondition` with `some` as an operator and threw —
        // which read as a broken stub rather than a missing feature. The bare
        // shape, `{ subjects: {…} }`, keeps meaning `some` as it did before.
        const quantifiers = ['some', 'none', 'every'].filter((name) => name in condition)

        if (quantifiers.length === 0) {
          if (!related.some((child) => matches(relation.model, child, condition))) return false
          continue
        }

        for (const quantifier of quantifiers) {
          const clause = condition[quantifier]
          const hit = (child) => matches(relation.model, child, clause)

          if (quantifier === 'some' && !related.some(hit)) return false
          if (quantifier === 'none' && related.some(hit)) return false
          if (quantifier === 'every' && !related.every(hit)) return false
        }

        continue
      }

      if (!matchesCondition(row[key], condition)) return false
    }

    return true
  }

  /**
   * Does this `where` key name a compound unique index?
   *
   * Prisma spells one as the field names joined by underscores, with an object
   * holding those same fields. Checking both halves avoids mistaking an
   * ordinary snake_case column for a compound key.
   *
   * @param {string} key The `where` key.
   * @param {unknown} condition The value under that key.
   * @returns {boolean} True when the key and value form a compound unique clause.
   */
  function isCompoundKey(key, condition) {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false

    const parts = key.split('_')
    const fields = Object.keys(condition)

    return fields.length > 1 && fields.every((field) => parts.includes(field))
  }

  /**
   * Normalise a clause that may be an object or an array of objects.
   *
   * @param {object|object[]} value The clause.
   * @returns {object[]} An array of clauses.
   */
  function toArray(value) {
    return Array.isArray(value) ? value : [value]
  }

  /**
   * Follow a declared relation from one row.
   *
   * @param {string} model The owning model.
   * @param {object} row The owning row.
   * @param {string} name The relation name.
   * @returns {object|object[]|null} The related row, rows, or `null`.
   */
  function resolveRelation(model, row, name) {
    const relation = RELATIONS[model][name]
    const rows = tables[relation.model] ?? []
    const key = row[relation.from]

    if (relation.kind === 'one') {
      return key == null ? null : (rows.find((child) => child[relation.to] === key) ?? null)
    }

    return rows.filter((child) => child[relation.to] === key)
  }

  /**
   * Shape a row the way `include` and `select` asked for.
   *
   * `include` widens: the whole row, plus the named relations. `select`
   * narrows: only the named fields, and a named field may itself be a relation
   * carrying its own `select`. Prisma allows both to nest arbitrarily, and a
   * query that uses `select` to reach two levels down — an order line's order's
   * event — is a perfectly ordinary query that this stub used to answer with
   * `undefined`.
   *
   * A relation asked for with a nested object (`{select: {…}}`) but absent from
   * {@link RELATIONS} throws rather than returning `undefined`, on the same
   * principle as `aggregate`: a stub that answers a question it has not
   * implemented is worse than one that refuses, because the wrong shape looks
   * exactly like the right one until an assertion far away fails. A key asked
   * for with `true` is taken as a scalar, which is what it almost always is.
   *
   * @param {string} model The model of the row.
   * @param {object} row The row.
   * @param {object|boolean|undefined} include The `include` argument.
   * @param {object|undefined} [selection] The `select` argument.
   * @returns {object} A detached copy, shaped as asked.
   */
  function hydrate(model, row, include, selection) {
    if (selection && typeof selection === 'object') {
      const projected = {}

      for (const [name, spec] of Object.entries(selection)) {
        if (!spec) continue

        const relation = RELATIONS[model]?.[name]
        const nested = typeof spec === 'object' ? spec : null

        if (!relation) {
          if (nested) throw new Error(`prisma-stub: unknown relation ${model}.${name}`)

          projected[name] = row[name]
          continue
        }

        const related = resolveRelation(model, row, name)

        projected[name] =
          relation.kind === 'one'
            ? related
              ? hydrate(relation.model, related, nested?.include, nested?.select)
              : null
            : /** @type {object[]} */ (related).map((child) =>
                hydrate(relation.model, child, nested?.include, nested?.select),
              )
      }

      return projected
    }

    const copy = { ...row }
    if (!include || typeof include !== 'object') return copy

    for (const [name, spec] of Object.entries(include)) {
      if (!spec) continue

      // `_count: { select: { subjects: true } }` — how many related rows there
      // are, without loading them. The export register asks this because how
      // many people an artefact contains is the answer, while which people they
      // are is not a question that surface asks.
      if (name === '_count') {
        const counts = {}

        for (const [relationName, wanted] of Object.entries(spec?.select ?? {})) {
          if (!wanted) continue

          const counted = RELATIONS[model]?.[relationName]

          if (!counted) throw new Error(`prisma-stub: unknown relation ${model}.${relationName}`)

          counts[relationName] = /** @type {object[]} */ (
            resolveRelation(model, row, relationName)
          ).length
        }

        copy._count = counts
        continue
      }

      const relation = RELATIONS[model]?.[name]
      if (!relation) throw new Error(`prisma-stub: unknown relation ${model}.${name}`)

      const nested = typeof spec === 'object' ? spec : null
      const related = resolveRelation(model, row, name)

      copy[name] =
        relation.kind === 'one'
          ? related
            ? hydrate(relation.model, related, nested?.include, nested?.select)
            : null
          : /** @type {object[]} */ (related).map((child) =>
              hydrate(relation.model, child, nested?.include, nested?.select),
            )
    }

    return copy
  }

  /**
   * Sort rows by a Prisma `orderBy` argument.
   *
   * @param {object[]} rows The rows to sort (sorted in place).
   * @param {object|object[]|undefined} orderBy The `orderBy` argument.
   * @returns {object[]} The sorted rows.
   */
  function sortRows(rows, orderBy) {
    if (!orderBy) return rows
    const clauses = toArray(orderBy)

    return rows.sort((left, right) => {
      for (const clause of clauses) {
        const [field, direction] = Object.entries(clause)[0]
        const a = toComparable(left[field])
        const b = toComparable(right[field])
        if (a === b) continue
        const order = a < b ? -1 : 1
        return direction === 'desc' ? -order : order
      }
      return 0
    })
  }

  /**
   * Raise the error Prisma raises for a unique-constraint violation.
   *
   * @param {string} model The model.
   * @param {string} field The offending field.
   * @returns {Error} A `P2002` error.
   */
  function uniqueViolation(model, field) {
    const error = new Error(`Unique constraint failed on the fields: (\`${field}\`)`)
    error.code = 'P2002'
    error.meta = { modelName: model, target: [field] }
    return error
  }

  /**
   * Build the delegate object for one model.
   *
   * @param {string} model The model name.
   * @returns {object} A Prisma-like delegate.
   */
  /**
   * Apply a Prisma `data` payload to a row.
   *
   * Prisma lets a field be an atomic operator object rather than a value —
   * `{ redemptionCount: { increment: 1 } }` — and production code uses that
   * form precisely because it is race-free. A stub that assigned the object
   * verbatim would store `{ increment: 1 }` as the column value and let a
   * broken write pass its tests.
   *
   * @param {object} row The row to mutate.
   * @param {object} data The Prisma data payload.
   * @returns {void}
   */
  function applyData(row, data) {
    for (const [field, value] of Object.entries(data ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        if ('increment' in value) {
          row[field] = (row[field] ?? 0) + value.increment
          continue
        }
        if ('decrement' in value) {
          row[field] = (row[field] ?? 0) - value.decrement
          continue
        }
        if ('multiply' in value) {
          row[field] = (row[field] ?? 0) * value.multiply
          continue
        }
        if ('set' in value) {
          row[field] = value.set
          continue
        }
      }

      row[field] = value
    }
  }

  function delegate(model) {
    /**
     * Rows matching an argument object.
     *
     * @param {object} args Prisma query arguments.
     * @returns {object[]} Matching rows, sorted and paged.
     */
    const select = (args = {}) => {
      const found = (tables[model] ?? []).filter((row) => matches(model, row, args.where))
      const sorted = sortRows([...found], args.orderBy)
      const start = args.skip ?? 0
      const end = args.take === undefined ? undefined : start + args.take
      return sorted.slice(start, end)
    }

    return {
      findMany: async (args = {}) =>
        select(args).map((row) => hydrate(model, row, args.include, args.select)),
      findFirst: async (args = {}) => {
        const [row] = select(args)
        return row ? hydrate(model, row, args.include, args.select) : null
      },
      findUnique: async (args = {}) => {
        const [row] = select({ where: args.where })
        return row ? hydrate(model, row, args.include, args.select) : null
      },
      count: async (args = {}) =>
        (tables[model] ?? []).filter((row) => matches(model, row, args.where)).length,
      /**
       * `_sum` and `_count` over matching rows.
       *
       * Only the two the application uses. `_avg`, `_min` and `_max` are
       * deliberately absent rather than approximated: a stub that answers a
       * question it has not implemented is worse than one that does not answer,
       * because the wrong number looks exactly like the right one.
       *
       * @param {object} args Prisma aggregate arguments.
       * @returns {Promise<object>} `{ _sum, _count }` over the matching rows.
       */
      aggregate: async (args = {}) => {
        const rows = (tables[model] ?? []).filter((row) => matches(model, row, args.where))

        for (const key of Object.keys(args)) {
          if (key === 'where' || key === '_sum' || key === '_count') continue

          throw new Error(`prisma-stub: aggregate does not implement ${key}`)
        }

        const sums = {}

        for (const field of Object.keys(args._sum ?? {})) {
          // Null rather than 0 for an empty set, which is what Prisma returns
          // and what every caller's `?? 0` is written against.
          sums[field] =
            rows.length === 0 ? null : rows.reduce((total, row) => total + (row[field] ?? 0), 0)
        }

        return {
          ...(args._sum ? { _sum: sums } : {}),
          ...(args._count ? { _count: rows.length } : {}),
        }
      },
      create: async (args) => {
        const now = new Date()

        // Nested writes, for the one shape the application uses: a parent with
        // `relation: { create: [...] }`. The ledger needs it — a batch and its
        // entries are written together or the batch is meaningless — and
        // supporting it here rather than rewriting the caller keeps the stub
        // shaped like the client it stands in for.
        const nestedCreates = []
        const scalarData = {}

        for (const [key, value] of Object.entries(args.data ?? {})) {
          const relation = RELATIONS[model]?.[key]

          if (relation && value && typeof value === 'object' && 'create' in value) {
            nestedCreates.push({ relation, rows: [value.create].flat() })
            continue
          }

          scalarData[key] = value
        }

        const row = {
          id: cuid(),
          ...DEFAULTS[model],
          ...(TIMESTAMPED.has(model) ? { createdAt: now, updatedAt: now } : {}),
          ...(CREATED_ONLY.has(model) ? { createdAt: now } : {}),
          ...(model === 'webhookEvent' ? { receivedAt: now } : {}),
          ...(model === 'session' ? { lastSeenAt: now } : {}),
          ...(model === 'device' ? { firstSeenAt: now, lastSeenAt: now } : {}),
          // `@default(now())` on a column that is not `createdAt`. Each of
          // these was missing, and a missing one is not harmless: the column
          // comes back `undefined`, the response schema refuses it, and the
          // handler gets blamed for a gap in the double.
          ...(model === 'privacyHold' ? { placedAt: now } : {}),
          ...(model === 'privacyAuditEvent' ? { occurredAt: now, recordedAt: now } : {}),
          ...(model === 'exportArtifact' ? { generatedAt: now } : {}),
          ...scalarData,
        }

        // Null is distinct from null, which is PostgreSQL's default and what
        // this schema relies on: `Payout.providerPayoutId` is nullable and
        // unique with `provider`, so two payouts nobody has sent yet must not
        // collide. A stub that treated two nulls as equal would refuse a row
        // the database accepts, and the failure reads like a product bug.
        const present = (value) => value !== null && value !== undefined

        for (const field of UNIQUE_FIELDS[model] ?? []) {
          if (!present(row[field])) continue

          if (tables[model].some((existing) => existing[field] === row[field])) {
            throw uniqueViolation(model, field)
          }
        }

        for (const fields of COMPOUND_UNIQUE[model] ?? []) {
          if (!fields.every((field) => present(row[field]))) continue

          const clash = tables[model].some((existing) =>
            fields.every((field) => existing[field] === row[field]),
          )

          if (clash) throw uniqueViolation(model, fields.join('_'))
        }

        tables[model].push(row)

        // After the parent exists, so the children can point at it. Written
        // through the same `create` so their defaults and timestamps are applied
        // the same way.
        for (const { relation, rows } of nestedCreates) {
          for (const child of rows) {
            await client[relation.model].create({
              data: { ...child, [relation.to]: row[relation.from] },
            })
          }
        }

        return hydrate(model, row, args.include, args.select)
      },
      /**
       * Write several rows, optionally skipping the ones a unique constraint
       * would refuse.
       *
       * Built on `create` rather than beside it, so the defaults, the
       * timestamps and both uniqueness checks are the ones a single write gets.
       * A second implementation is how a stub starts disagreeing with itself.
       *
       * `skipDuplicates` is the whole reason three call sites use this rather
       * than a loop: it is how the cancellation, material-change and inventory
       * paths are idempotent. A retry writes nothing and reports zero, which is
       * exactly what those callers count on to tell "created" from "already
       * there". Without it here they were untested — the stub had no
       * `createMany` at all, and the paths that call it were only ever reached
       * with an empty work list.
       *
       * @param {object} args Prisma `createMany` arguments.
       * @returns {Promise<{count: number}>} How many rows were actually written.
       */
      createMany: async (args = {}) => {
        const rows = Array.isArray(args.data) ? args.data : [args.data]
        let count = 0

        for (const data of rows) {
          try {
            await client[model].create({ data })
            count += 1
          } catch (error) {
            if (args.skipDuplicates && error?.code === 'P2002') continue
            throw error
          }
        }

        return { count }
      },
      update: async (args) => {
        const row = tables[model].find((candidate) => matches(model, candidate, args.where))
        if (!row) {
          const error = new Error(`No ${model} found`)
          error.code = 'P2025'
          throw error
        }

        applyData(row, args.data)
        if (TIMESTAMPED.has(model)) row.updatedAt = new Date()
        return hydrate(model, row, args.include, args.select)
      },
      updateMany: async (args) => {
        const rows = tables[model].filter((candidate) => matches(model, candidate, args.where))
        for (const row of rows) {
          applyData(row, args.data)
          if (TIMESTAMPED.has(model)) row.updatedAt = new Date()
        }
        return { count: rows.length }
      },
      upsert: async (args) => {
        const row = tables[model].find((candidate) => matches(model, candidate, args.where))

        if (row) {
          applyData(row, args.update)
          if (TIMESTAMPED.has(model)) row.updatedAt = new Date()
          return hydrate(model, row, args.include, args.select)
        }

        const now = new Date()
        const created = {
          id: cuid(),
          ...DEFAULTS[model],
          ...(TIMESTAMPED.has(model) ? { createdAt: now, updatedAt: now } : {}),
          ...(CREATED_ONLY.has(model) ? { createdAt: now } : {}),
          ...args.create,
        }

        tables[model].push(created)
        return hydrate(model, created, args.include)
      },
      delete: async (args) => {
        const index = tables[model].findIndex((candidate) => matches(model, candidate, args.where))
        if (index < 0) throw new Error(`No ${model} found`)
        const [row] = tables[model].splice(index, 1)
        return row
      },
      /**
       * Remove every matching row.
       *
       * Spliced in reverse so that removing one row does not shift the index of
       * the next one still to be removed.
       *
       * @param {object} args Prisma `deleteMany` arguments.
       * @returns {Promise<{count: number}>} How many rows went.
       */
      deleteMany: async (args = {}) => {
        const rows = tables[model] ?? []
        let count = 0

        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (!matches(model, rows[index], args.where)) continue
          rows.splice(index, 1)
          count += 1
        }

        return { count }
      },
      /**
       * `groupBy`, supporting the one shape the API uses: group by columns and
       * count. Enough to exercise the query the device list depends on, and
       * deliberately not a general implementation — a stub that pretends to
       * support more of the query language than it does is worse than one that
       * throws.
       *
       * @param {object} args Prisma `groupBy` arguments.
       * @returns {Promise<object[]>} One row per distinct combination.
       */
      groupBy: async (args = {}) => {
        const by = toArray(args.by)

        if (by.length === 0) throw new Error('groupBy needs at least one column')
        if (!args._count) throw new Error('the stub only implements groupBy with _count')

        const rows = (tables[model] ?? []).filter((row) => matches(model, row, args.where))
        /** @type {Map<string, {row: object, count: number}>} */
        const groups = new Map()

        for (const row of rows) {
          const key = JSON.stringify(by.map((column) => row[column] ?? null))
          const existing = groups.get(key)

          if (existing) {
            existing.count += 1
            continue
          }

          groups.set(key, {
            row: Object.fromEntries(by.map((column) => [column, row[column] ?? null])),
            count: 1,
          })
        }

        return [...groups.values()].map((group) => ({
          ...group.row,
          _count: { _all: group.count },
        }))
      },
    }
  }

  const client = {
    _store: tables,
    _rawQueries: rawQueries,

    /**
     * Record a raw query. Real PostgreSQL takes the row lock here.
     *
     * @param {TemplateStringsArray|string[]} strings Template literal chunks.
     * @param {...unknown} values Interpolated values.
     * @returns {Promise<object[]>} An empty result set.
     */
    $queryRaw: async (strings, ...values) => {
      rawQueries.push({ sql: Array.from(strings).join('?'), values })
      return []
    },

    /**
     * Run a function inside a transaction with snapshot rollback.
     *
     * Transactions are serialised, which is exactly what `SELECT ... FOR UPDATE`
     * achieves in PostgreSQL for the rows the checkout paths lock. A rejection
     * restores every table to its pre-transaction contents, so a failed payment
     * genuinely leaves nothing behind.
     *
     * Both of Prisma's forms are supported. The callback form is what the
     * checkout paths use. The array form — `$transaction([a, b])` — is what a
     * caller uses when the writes do not depend on each other; Prisma's client
     * builds those promises eagerly, so by the time this sees them they have
     * already been prepared, and awaiting them in order inside the snapshot is
     * the same all-or-nothing guarantee.
     *
     * @param {function(object): Promise<*>|Array<Promise<*>>} fn The transaction body, or an array of operations.
     * @returns {Promise<unknown>} Whatever the body resolved with.
     */
    $transaction: (fn) => {
      const body = Array.isArray(fn) ? async () => Promise.all(fn) : fn
      const run = async () => {
        const snapshot = {}
        for (const [model, rows] of Object.entries(tables)) {
          snapshot[model] = rows.map((row) => ({ ...row }))
        }

        try {
          return await body(client)
        } catch (error) {
          // Restored in place so that `_store.someModel` references held by a
          // test stay valid across a rollback.
          for (const [model, rows] of Object.entries(snapshot)) {
            tables[model].length = 0
            tables[model].push(...rows)
          }
          throw error
        }
      }

      const result = transactionChain.then(run, run)
      transactionChain = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },

    /**
     * Close the (nonexistent) connection pool.
     *
     * @returns {Promise<void>} Resolves immediately.
     */
    $disconnect: async () => {},
  }

  for (const model of Object.keys(DEFAULTS)) client[model] = delegate(model)

  return client
}
