import { randomUUID } from 'node:crypto'

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
    // The cover and the gallery. Nested `where`/`orderBy`/`take` on an include
    // are not honoured here (see `hydrate`), so a presenter filters in JS too.
    media: { kind: 'many', model: 'mediaAsset', from: 'id', to: 'eventId' },
    // The administrator who last decided the website link, for the name an
    // insider is shown.
    websiteRedirectChangedBy: {
      kind: 'one',
      model: 'user',
      from: 'websiteRedirectChangedById',
      to: 'id',
    },
    trafficEvents: { kind: 'many', model: 'trafficEvent', from: 'id', to: 'eventId' },
    trafficDaily: { kind: 'many', model: 'trafficDaily', from: 'id', to: 'eventId' },
    // Full control of posted events (SPEC2-XI X): who deleted it, the
    // sittings of the team at The Desi Events on it, and what its ticket holders are told.
    deletedBy: { kind: 'one', model: 'user', from: 'deletedById', to: 'id' },
    platformEdits: { kind: 'many', model: 'eventPlatformEdit', from: 'id', to: 'eventId' },
    changeNotices: { kind: 'many', model: 'eventChangeNotice', from: 'id', to: 'eventId' },
    // Where it was imported from, when it was (SPEC2-XI I).
    importItem: { kind: 'one', model: 'eventImportItem', from: 'id', to: 'eventId' },
    // Booking fees and paying at the venue (SPEC3 §5): the current fee
    // decision, its history, the switch's history and who last changed it,
    // the referral codes naming it, and the payments taken at its door.
    feeSetting: { kind: 'one', model: 'eventFeeSetting', from: 'feeSettingId', to: 'id' },
    venuePaymentChangedBy: {
      kind: 'one',
      model: 'user',
      from: 'venuePaymentChangedById',
      to: 'id',
    },
    feeSettings: { kind: 'many', model: 'eventFeeSetting', from: 'id', to: 'eventId' },
    venuePaymentChanges: {
      kind: 'many',
      model: 'eventVenuePaymentChange',
      from: 'id',
      to: 'eventId',
    },
    referralScopes: { kind: 'many', model: 'referralCodeEvent', from: 'id', to: 'eventId' },
    venuePayments: { kind: 'many', model: 'venuePayment', from: 'id', to: 'eventId' },
    venueBookingCancellations: {
      kind: 'many',
      model: 'venueBookingCancellation',
      from: 'id',
      to: 'eventId',
    },
  },
  eventFeeSetting: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    setBy: { kind: 'one', model: 'user', from: 'setById', to: 'id' },
    current: { kind: 'one', model: 'event', from: 'id', to: 'feeSettingId' },
    orders: { kind: 'many', model: 'order', from: 'id', to: 'feeSettingId' },
  },
  eventVenuePaymentChange: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    changedBy: { kind: 'one', model: 'user', from: 'changedById', to: 'id' },
  },
  referralCode: {
    createdBy: { kind: 'one', model: 'user', from: 'createdById', to: 'id' },
    updatedBy: { kind: 'one', model: 'user', from: 'updatedById', to: 'id' },
    events: { kind: 'many', model: 'referralCodeEvent', from: 'id', to: 'referralCodeId' },
    orders: { kind: 'many', model: 'order', from: 'id', to: 'referralCodeId' },
  },
  referralCodeEvent: {
    referralCode: { kind: 'one', model: 'referralCode', from: 'referralCodeId', to: 'id' },
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
  },
  venuePayment: {
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
    recordedBy: { kind: 'one', model: 'user', from: 'recordedById', to: 'id' },
    tickets: { kind: 'many', model: 'ticket', from: 'id', to: 'venuePaymentId' },
  },
  // Unpaid pay-at-the-venue tickets cancelled, one row per cancellation
  // (SPEC3-XI XU): the order, the event, who cancelled, and its tickets.
  venueBookingCancellation: {
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    cancelledBy: { kind: 'one', model: 'user', from: 'cancelledById', to: 'id' },
    tickets: { kind: 'many', model: 'ticket', from: 'id', to: 'venueCancellationId' },
  },
  eventPlatformEdit: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    actor: { kind: 'one', model: 'user', from: 'actorId', to: 'id' },
    session: { kind: 'one', model: 'session', from: 'sessionId', to: 'id' },
  },
  eventChangeNotice: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
  },
  eventImportRun: {
    createdBy: { kind: 'one', model: 'user', from: 'createdById', to: 'id' },
    appliedBy: { kind: 'one', model: 'user', from: 'appliedById', to: 'id' },
    items: { kind: 'many', model: 'eventImportItem', from: 'id', to: 'lastRunId' },
  },
  eventImportItem: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    lastRun: { kind: 'one', model: 'eventImportRun', from: 'lastRunId', to: 'id' },
    importedBy: { kind: 'one', model: 'user', from: 'importedById', to: 'id' },
    approvedBy: { kind: 'one', model: 'user', from: 'approvedById', to: 'id' },
    reassignedBy: { kind: 'one', model: 'user', from: 'reassignedById', to: 'id' },
    reassignedFromOrganization: {
      kind: 'one',
      model: 'organization',
      from: 'reassignedFromOrganizationId',
      to: 'id',
    },
    reassignedToOrganization: {
      kind: 'one',
      model: 'organization',
      from: 'reassignedToOrganizationId',
      to: 'id',
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
    // The night a tier sells, which a ticket, an order line and the door name.
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
  },
  // A code is deleted only while no order names it, which is a to-many filter.
  promoCode: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    orders: { kind: 'many', model: 'order', from: 'id', to: 'promoCodeId' },
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
    // Created lazily on the holder's first retrieval, so usually absent.
    groupPass: { kind: 'one', model: 'groupPass', from: 'id', to: 'orderId' },
    // The fee decision and the referral code it was priced with, and the
    // payments taken at the door for its tickets (SPEC3 §5).
    feeSetting: { kind: 'one', model: 'eventFeeSetting', from: 'feeSettingId', to: 'id' },
    referralCode: { kind: 'one', model: 'referralCode', from: 'referralCodeId', to: 'id' },
    venuePayments: { kind: 'many', model: 'venuePayment', from: 'id', to: 'orderId' },
    // Its unpaid tickets cancelled, if any (SPEC3-XI XU).
    venueCancellations: {
      kind: 'many',
      model: 'venueBookingCancellation',
      from: 'id',
      to: 'orderId',
    },
  },
  orderItem: {
    tickets: { kind: 'many', model: 'ticket', from: 'id', to: 'orderItemId' },
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    ticketType: { kind: 'one', model: 'ticketType', from: 'ticketTypeId', to: 'id' },
  },
  ticket: {
    orderItem: { kind: 'one', model: 'orderItem', from: 'orderItemId', to: 'id' },
    // The wallet walks both of these: the seat, so a reserved ticket can say
    // which one, and the outstanding invitation, so a ticket that has been
    // offered to somebody says so without a second query per row.
    eventSeat: { kind: 'one', model: 'eventSeat', from: 'eventSeatId', to: 'id' },
    transfers: { kind: 'many', model: 'ticketTransfer', from: 'id', to: 'ticketId' },
    // The door reads the admissions back after writing one, to say when and
    // how: one for a ticket that admits once, one per night for a ticket good
    // for every night.
    checkIns: { kind: 'many', model: 'checkIn', from: 'id', to: 'ticketId' },
    // The payment taken at the door that paid it, once there is one.
    venuePayment: { kind: 'one', model: 'venuePayment', from: 'venuePaymentId', to: 'id' },
    // The cancellation that withdrew it unpaid, once there is one.
    venueCancellation: {
      kind: 'one',
      model: 'venueBookingCancellation',
      from: 'venueCancellationId',
      to: 'id',
    },
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
    groupPass: { kind: 'one', model: 'groupPass', from: 'groupPassId', to: 'id' },
  },
  groupPass: {
    order: { kind: 'one', model: 'order', from: 'orderId', to: 'id' },
    checkIns: { kind: 'many', model: 'checkIn', from: 'id', to: 'groupPassId' },
  },
  mediaAsset: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
    // Keyed by storage key, not id: the blob's primary key is the asset's
    // storage key, which is what lets a storage adapter find the bytes by the
    // one name it was given.
    blob: { kind: 'one', model: 'mediaBlob', from: 'storageKey', to: 'storageKey' },
    uploadedBy: { kind: 'one', model: 'user', from: 'uploadedById', to: 'id' },
    moderatedBy: { kind: 'one', model: 'user', from: 'moderatedById', to: 'id' },
    // A replacement cover waiting beside the cover it replaces, both ways.
    replaces: { kind: 'one', model: 'mediaAsset', from: 'replacesMediaId', to: 'id' },
    replacedBy: { kind: 'one', model: 'mediaAsset', from: 'id', to: 'replacesMediaId' },
  },
  mediaBlob: {
    asset: { kind: 'one', model: 'mediaAsset', from: 'storageKey', to: 'storageKey' },
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
    organizerInvitation: {
      kind: 'one',
      model: 'organizerInvitation',
      from: 'organizerInvitationId',
      to: 'id',
    },
  },
  organizerInvitation: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    invitedBy: { kind: 'one', model: 'user', from: 'invitedById', to: 'id' },
    acceptedBy: { kind: 'one', model: 'user', from: 'acceptedByUserId', to: 'id' },
    revokedBy: { kind: 'one', model: 'user', from: 'revokedById', to: 'id' },
    supersedes: { kind: 'one', model: 'organizerInvitation', from: 'supersedesId', to: 'id' },
    membership: { kind: 'one', model: 'membership', from: 'id', to: 'organizerInvitationId' },
  },
  trafficEvent: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
  },
  trafficDaily: {
    event: { kind: 'one', model: 'event', from: 'eventId', to: 'id' },
  },
  session: {
    user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    device: { kind: 'one', model: 'device', from: 'deviceId', to: 'id' },
    platformEdits: { kind: 'many', model: 'eventPlatformEdit', from: 'id', to: 'sessionId' },
  },
  invitation: {
    organization: { kind: 'one', model: 'organization', from: 'organizationId', to: 'id' },
    invitedBy: { kind: 'one', model: 'user', from: 'invitedById', to: 'id' },
  },
  organization: {
    // Provenance for a self-service organisation, and the per-account
    // creation cap. Never returned by a route.
    createdBy: { kind: 'one', model: 'user', from: 'createdById', to: 'id' },
    // The platform door list names the organisations with a door open now.
    events: { kind: 'many', model: 'event', from: 'id', to: 'organizationId' },
    // Imported events moved out of and into an organisation.
    importsMovedOut: {
      kind: 'many',
      model: 'eventImportItem',
      from: 'id',
      to: 'reassignedFromOrganizationId',
    },
    importsMovedIn: {
      kind: 'many',
      model: 'eventImportItem',
      from: 'id',
      to: 'reassignedToOrganizationId',
    },
  },
  eventSeat: {
    seat: { kind: 'one', model: 'seat', from: 'seatId', to: 'id' },
    eventSession: { kind: 'one', model: 'eventSession', from: 'eventSessionId', to: 'id' },
    hold: { kind: 'one', model: 'ticketHold', from: 'holdId', to: 'id' },
    // A list since ADR 0006: one live ticket per seat, and the rows it
    // superseded kept as the seat's history.
    tickets: { kind: 'many', model: 'ticket', from: 'id', to: 'eventSeatId' },
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
    changeNotices: {
      kind: 'many',
      model: 'eventChangeNotice',
      from: 'id',
      to: 'eventSessionId',
    },
    venuePayments: { kind: 'many', model: 'venuePayment', from: 'id', to: 'eventSessionId' },
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
  // A version's map, for the venue a night's new seating belongs to (a live
  // night may move to another map, SPEC2-XI X-4).
  venueMapVersion: {
    venueMap: { kind: 'one', model: 'venueMap', from: 'venueMapId', to: 'id' },
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

/**
 * The deletion columns of an event (SPEC2-XI X): null until it is deleted.
 *
 * @type {Readonly<Record<string, null>>}
 */
const EVENT_DELETION_COLUMNS = Object.freeze({
  deletedAt: null,
  deletedById: null,
  deletionReason: null,
  deletionOutcome: null,
  deletionAuthority: null,
  statusBeforeDeletion: null,
  deletedSlug: null,
})

/**
 * An event's booking fee and pay-at-the-venue columns (SPEC3 §5.2): the site
 * default, the switch off and no limit, as the migration leaves every event.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const EVENT_PAYMENT_TERMS_COLUMNS = Object.freeze({
  feeSource: 'SITE_DEFAULT',
  feePercentageBps: null,
  feeFlatCentsPerTicket: null,
  feeCurrency: null,
  feeSettingId: null,
  venuePaymentEnabled: false,
  venuePaymentLimit: null,
  venuePaymentChangedAt: null,
  venuePaymentChangedById: null,
  venuePaymentReason: null,
})

/**
 * An order's payment and booking-fee columns (SPEC3 §5.2, §5.3): a card order
 * at the site default with no waiver and nothing due at the door. A seeded
 * order without them gets `feeGrossCents` equal to its fee, as the migration's
 * backfill gives every order already there (see `seededOrderColumns`).
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const ORDER_PAYMENT_TERMS_COLUMNS = Object.freeze({
  paymentMethod: 'CARD',
  feeSource: 'SITE_DEFAULT',
  feeSettingId: null,
  feePercentageBps: null,
  feeFlatCentsPerTicket: null,
  feeGrossCents: 0,
  feeWaivedCents: 0,
  referralCodeId: null,
  venueDueCents: 0,
  // SPEC3-XI: no referral use given back, nothing cancelled unpaid, no fee kept.
  referralUseReturnedAt: null,
  referralUseReturnCause: null,
  venueCancelledBasisCents: 0,
  venueFeeKeptCents: 0,
})

/**
 * A ticket's door columns (SPEC3 §5.3, SPEC3-XI XU): nothing due, no payment,
 * not cancelled unpaid.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const TICKET_VENUE_COLUMNS = Object.freeze({
  venueDueCents: 0,
  venuePaymentId: null,
  venueCancellationId: null,
})

/**
 * An order line's door columns (SPEC3 §5.3, SPEC3-XI XU): nothing due at the
 * door, nothing cancelled unpaid.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const ORDER_ITEM_VENUE_COLUMNS = Object.freeze({ venueDueCents: 0, venueCancelledQuantity: 0 })

/**
 * A night's cancellation stamp and whether its end time was listed (SPEC2-XI X
 * and I): not cancelled, and listed, as every night before them.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const EVENT_SESSION_CONTROL_COLUMNS = Object.freeze({
  cancelledAt: null,
  cancellationReason: null,
  endTimeListed: true,
})

/**
 * Columns added over existing rows by the SPEC2-XI migrations, with the value
 * an `ADD COLUMN` gives every row already there.
 *
 * A seeded row bypasses {@link DEFAULTS}, so without this a fixture written
 * before these columns existed would carry `undefined` where the database has
 * null — and a query for "not deleted" (`deletedAt: null`) would miss every
 * seeded event. Filled into seeded rows only where the key is absent, which is
 * what the migration does to a populated table; nothing else about a seeded
 * row is changed.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, unknown>>>>}
 */
const SEEDED_COLUMN_DEFAULTS = Object.freeze({
  event: Object.freeze({ ...EVENT_DELETION_COLUMNS, ...EVENT_PAYMENT_TERMS_COLUMNS }),
  eventSession: EVENT_SESSION_CONTROL_COLUMNS,
  mediaAsset: Object.freeze({ replacesMediaId: null }),
  organization: Object.freeze({ platformHeldSource: null }),
  // SPEC3: every order, line and ticket already there is a card order at the
  // site default with nothing due at the door (and `feeGrossCents` follows the
  // order's own fee, as the backfill sets it).
  order: ORDER_PAYMENT_TERMS_COLUMNS,
  orderItem: ORDER_ITEM_VENUE_COLUMNS,
  ticket: TICKET_VENUE_COLUMNS,
})

/**
 * Seeded columns that the migration derives from the row itself rather than
 * filling with a constant: an order's gross booking fee is the fee it charged
 * (`UPDATE "Order" SET "feeGrossCents" = "feesCents"`, SPEC3 §5.2).
 *
 * @type {Readonly<Record<string, function(object): object>>}
 */
const SEEDED_DERIVED_COLUMNS = Object.freeze({
  order: (row) => ('feeGrossCents' in row ? {} : { feeGrossCents: row.feesCents ?? 0 }),
})

/** Columns the database fills in, mirrored so rows look like real rows. */
const DEFAULTS = {
  user: { locale: 'en-IN', role: 'ATTENDEE', emailVerified: false, phone: null },
  membership: { role: 'VIEWER', organizerInvitationId: null },
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
    createdById: null,
    platformHeldSource: null,
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
    onlineUrl: null,
    publishedAt: null,
    // The authoring editor's optimistic-concurrency precondition. Absent here,
    // the sessions route serialised `meta.revision: undefined` and the response
    // contract refused it — which is the contract doing its job.
    revision: 0,
    // The event page's public content. Every one is nullable in the schema.
    faq: null,
    performers: null,
    runningOrder: null,
    sponsors: null,
    socialLinks: null,
    dressCode: null,
    directions: null,
    publicContactEmail: null,
    publicContactPhone: null,
    // The organiser's website and the administrators' switch. The database's
    // trigger keeps `websiteDecisionPending` and `websiteSubmittedAt` in step;
    // the stub runs no triggers, so the API computes them itself.
    websiteUrl: null,
    websiteRedirectEnabled: false,
    websiteDecidedUrl: null,
    websiteDecisionPending: false,
    websiteSubmittedAt: null,
    websiteRedirectChangedAt: null,
    websiteRedirectChangedById: null,
    websiteRedirectReason: null,
    ...EVENT_DELETION_COLUMNS,
    ...EVENT_PAYMENT_TERMS_COLUMNS,
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
    visibility: 'PUBLIC',
    importKey: null,
    quantityIsAllowance: false,
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
    // `@default(0)` in the schema: an order made through the API starts with
    // nothing refunded and nothing reserved, as it does on PostgreSQL.
    refundedCents: 0,
    refundPendingCents: 0,
    ...ORDER_PAYMENT_TERMS_COLUMNS,
  },
  // Staged names for a general-admission line, cleared at settlement; nothing
  // refunded yet (`@default(0)`); nothing due at the door.
  orderItem: {
    attendeeNames: [],
    refundedQuantity: 0,
    refundedCents: 0,
    ...ORDER_ITEM_VENUE_COLUMNS,
  },
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
    ...TICKET_VENUE_COLUMNS,
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
    groupPassId: null,
  },
  groupPass: {
    credentialHash: null,
    codeHash: null,
    credentialVersion: 1,
    credentialIssuedAt: null,
    rotatedAt: null,
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
    currency: null,
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
    deliveryMode: null,
  },
  organizerInvitation: {
    status: 'PENDING',
    organizationDescription: null,
    organizationWebsiteUrl: null,
    note: null,
    organizationId: null,
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    revokedById: null,
    supersedesId: null,
  },
  // Visits. A counted moment's id is a random UUID (see UUID_IDS); the daily
  // totals and the salt are keyed by their natural columns (see NATURAL_KEYS).
  trafficEvent: { source: null, visitorHash: null, dedupeKey: null },
  trafficDaily: {
    views: 0,
    visitors: 0,
    anonymousViews: 0,
    viewsDirect: 0,
    viewsInternal: 0,
    viewsSearch: 0,
    viewsSocial: 0,
    viewsOther: 0,
    cardClicks: 0,
    cardClicksHome: 0,
    cardClicksListing: 0,
    cardClicksSearch: 0,
    ticketClicks: 0,
    seatClicks: 0,
    ticketClickVisitors: 0,
    websiteRedirects: 0,
    websiteRedirectVisitors: 0,
    demonstration: false,
  },
  trafficSalt: {},
  trafficRollupState: { leaseOwner: null, leaseExpiresAt: null, lastCompletedAt: null },
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
    label: null,
    ...EVENT_SESSION_CONTROL_COLUMNS,
  },
  eventSeat: {
    ticketTypeId: null,
    status: 'AVAILABLE',
    holdId: null,
    orderItemId: null,
    priceCentsOverride: null,
    blockedReason: null,
  },
  holdItem: {
    quantity: 1,
    eventSeatId: null,
    orderItemId: null,
    unitPriceCents: null,
    attendeeName: null,
  },
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
  mediaAsset: {
    eventId: null,
    width: null,
    height: null,
    checksum: null,
    sanitisedAt: null,
    moderationStatus: 'PENDING',
    scanStatus: 'PENDING',
    scanNote: null,
    uploadedById: null,
    altText: null,
    position: null,
    moderatedAt: null,
    moderatedById: null,
    moderationNote: null,
    replacesMediaId: null,
  },
  // The Postgres storage adapter's table. Keyed by `storageKey`, not `id`.
  mediaBlob: {},
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
  // Full control of posted events (SPEC2-XI X). `openedAt` is filled at create
  // time like a timestamp (see `create`).
  eventPlatformEdit: { actorId: null, sessionId: null, closedAt: null, endedBy: null },
  eventChangeNotice: {
    eventSessionId: null,
    fields: [],
    changed: [],
    before: null,
    after: null,
    reason: null,
    byPlatform: false,
    revision: null,
  },
  // Events imported from another site (SPEC2-XI I). `importedAt` and
  // `lastSyncedAt` are filled at create time (see `create`).
  eventImportRun: {
    status: 'PREVIEWED',
    createdById: null,
    appliedAt: null,
    appliedById: null,
    summary: null,
  },
  eventImportItem: {
    lastRunId: null,
    importedById: null,
    presentedBy: null,
    prices: [],
    priceText: null,
    importNotes: [],
    approvedById: null,
    approvedAt: null,
    reassignedAt: null,
    reassignedById: null,
    reassignedFromOrganizationId: null,
    reassignedToOrganizationId: null,
  },
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
  // Booking fees, referral codes and paying at the venue (SPEC3 §5).
  eventFeeSetting: { percentageBps: null, flatCentsPerTicket: null, currency: null, setById: null },
  eventVenuePaymentChange: { limit: null, changedById: null },
  referralCode: {
    label: null,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    active: true,
    switchedOffAt: null,
    createdById: null,
    updatedById: null,
  },
  referralCodeEvent: {},
  venuePayment: { eventSessionId: null, recordedById: null, gate: null },
  // Who cancelled, null once the account is gone (SPEC3-XI XU).
  venueBookingCancellation: { cancelledById: null },
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
  // `idempotencyKey` too: two checkouts with one key that both miss the
  // route's first read meet on it, and the route answers the second as a retry.
  order: ['reference', 'idempotencyKey'],
  // Not `eventSeatId`: since ADR 0006 that is unique only among live tickets,
  // which is a partial index — see PARTIAL_UNIQUE.
  ticket: ['code', 'credentialHash', 'supersedesTicketId'],
  session: ['tokenHash'],
  authToken: ['tokenHash'],
  // Not `ticketId`: since admission per night it is unique with the night,
  // and once more for a row with no night — see PARTIAL_UNIQUE.
  ticketTransfer: ['tokenHash', 'resultTicketId'],
  payout: ['idempotencyKey'],
  transfer: ['idempotencyKey'],
  // One connected account per organisation. The stub already models the
  // compound `(provider, providerAccountId)` key below but not this one, so
  // before it was added a test asserting "two concurrent first-starts collapse
  // to one row" passed against a stub that cheerfully stored two.
  connectedAccount: ['organizationId'],
  // One group pass per order, and a digest names one pass.
  groupPass: ['orderId', 'credentialHash', 'codeHash'],
  // One waiting replacement per cover.
  mediaAsset: ['storageKey', 'replacesMediaId'],
  mediaBlob: ['storageKey'],
  // A digest names one organiser invitation, and an invitation replaces at most
  // one other.
  organizerInvitation: ['tokenHash', 'supersedesId'],
  // One membership per organiser invitation: the organisation's founding owner.
  membership: ['organizerInvitationId'],
  // One counted moment per visitor per slot, and one salt per day.
  trafficEvent: ['dedupeKey'],
  trafficSalt: ['day'],
  // One platform-held organisation per import source; nulls are distinct, so
  // every ordinary organisation passes.
  organization: ['platformHeldSource'],
  // One import record per event.
  eventImportItem: ['eventId'],
  // A referral code's text is unique across the platform (SPEC3 DR4).
  referralCode: ['code'],
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
  // A code is unique within its organisation; two organisations may both
  // offer SAVE10.
  promoCode: [['organizationId', 'code']],
  // One row of totals per event per day: the roll-up's upsert key.
  trafficDaily: [['eventId', 'day']],
  // A re-import of the same listing updates rather than duplicates.
  eventImportItem: [['source', 'sourceId']],
  // One fee decision per sequence number per event: the booking fee's
  // compare-and-set. And a code names an event in its scope once.
  eventFeeSetting: [['eventId', 'sequence']],
  referralCodeEvent: [['referralCodeId', 'eventId']],
}

/** Ticket states that still admit, or may again: the rows the seat index counts. */
const LIVE_TICKET_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'])

/**
 * Partial unique indexes, which Prisma's schema language cannot express and
 * the migrations create by hand.
 *
 * Separate from {@link UNIQUE_FIELDS} and {@link COMPOUND_UNIQUE} because a row
 * only counts while `when` holds: a handed-on ticket keeps its seat as history
 * without blocking the successor that now holds it. `key` gives the indexed
 * values, normalised the way the index normalises them (`lower("email")`); a
 * null or missing part means the row is not indexed, because PostgreSQL treats
 * nulls as distinct.
 *
 * Checked on create and on every update path, because the usual way into one
 * of these is an update — a ticket moved back to VALID, a second tier switched
 * to reserved — rather than an insert.
 *
 * @type {Record<string, Array<{name: string, key: function(object): unknown[], when: function(object): boolean}>>}
 */
const PARTIAL_UNIQUE = {
  // One attendance per ticket per night, and one with no night. Two scanners
  // racing is exactly the case the stub has to reproduce for the check-in
  // tests to mean anything. The first is a plain unique index in the database,
  // listed here because its nulls are distinct, which COMPOUND_UNIQUE does not
  // model; the second is the partial index that closes that gap.
  checkIn: [
    {
      name: 'CheckIn_ticketId_eventSessionId_key',
      key: (row) => [row.ticketId, row.eventSessionId],
      when: () => true,
    },
    {
      name: 'CheckIn_ticketId_no_night_key',
      key: (row) => [row.ticketId],
      when: (row) => row.eventSessionId === null || row.eventSessionId === undefined,
    },
  ],
  ticket: [
    {
      name: 'Ticket_eventSeatId_live_key',
      key: (row) => [row.eventSeatId],
      when: (row) => LIVE_TICKET_STATES.includes(row.status),
    },
  ],
  ticketType: [
    {
      name: 'TicketType_reserved_session_zone_key',
      key: (row) => [row.eventSessionId, row.priceZoneId],
      when: (row) => row.reserved === true,
    },
    // Not partial, but hand-written in a migration like the one above, and a
    // rename is an update: listed here because these are checked on update as
    // well as create, and COMPOUND_UNIQUE is checked on create only.
    {
      name: 'TicketType_eventId_name_key',
      key: (row) => [row.eventId, row.name],
      when: () => true,
    },
  ],
  invitation: [
    {
      name: 'Invitation_one_pending_per_address',
      key: (row) => [
        row.organizationId,
        typeof row.email === 'string' ? row.email.toLowerCase() : row.email,
      ],
      when: (row) => row.status === 'PENDING',
    },
  ],
  // One current cover per event; a replacement waiting for review (which
  // points at the cover it replaces) is the one other cover row an event may
  // have (`20260930150000_event_full_control`).
  mediaAsset: [
    {
      name: 'MediaAsset_one_current_cover_per_event_key',
      key: (row) => [row.eventId],
      when: (row) =>
        row.kind === 'EVENT_COVER' &&
        (row.replacesMediaId === null || row.replacesMediaId === undefined),
    },
  ],
  // One open sitting per administrator per event: a double click is decided
  // here, and the second open is answered with the first.
  eventPlatformEdit: [
    {
      name: 'EventPlatformEdit_one_open_per_actor_key',
      key: (row) => [row.eventId, row.actorId],
      when: (row) => row.closedAt === null || row.closedAt === undefined,
    },
  ],
  // One waiting organiser invitation per address, whatever its case.
  organizerInvitation: [
    {
      name: 'OrganizerInvitation_one_pending_per_address',
      key: (row) => [typeof row.email === 'string' ? row.email.toLowerCase() : row.email],
      when: (row) => row.status === 'PENDING',
    },
  ],
}

/**
 * Models whose primary key is a named column rather than a generated `id`.
 *
 * The stub gives every other row an `id`; giving one to these would put a
 * column on the row that the real table does not have.
 *
 * @type {Record<string, string>}
 */
const NATURAL_KEYS = {
  mediaBlob: 'storageKey',
  referralCodeEvent: ['referralCodeId', 'eventId'],
  trafficDaily: ['eventId', 'day'],
  trafficSalt: 'day',
}

/**
 * Models whose generated id is a random UUID v4 rather than a cuid.
 *
 * A counted visit's id must not carry the time it was made, which a cuid does.
 *
 * @type {Set<string>}
 */
const UUID_IDS = new Set(['trafficEvent'])

/**
 * A generated id for a new row of one model.
 *
 * @param {string} model The model.
 * @returns {object} `{ id }`, or nothing for a model keyed by its own columns.
 */
function generatedId(model) {
  if (NATURAL_KEYS[model]) return {}

  return { id: UUID_IDS.has(model) ? randomUUID() : cuid() }
}

/**
 * Whether two stored values are the same key value.
 *
 * Dates compare by instant: two `Date` objects for one day are one key, as
 * they are in PostgreSQL, though they are different objects here.
 *
 * @param {unknown} left A stored value.
 * @param {unknown} right Another.
 * @returns {boolean} True when they collide.
 */
function sameKey(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()

  return left === right
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
  'groupPass',
  'mediaAsset',
  'referralCode',
])

/**
 * Foreign keys declared ON DELETE SET NULL whose clearing a caller relies on,
 * keyed by the model whose row is deleted: the referencing model and column.
 *
 * The stub runs no other referential action. These are mirrored because code
 * written for PostgreSQL leans on them (SPEC2-XI §5.X-P, §6): deleting the
 * cover a replacement waits beside makes the replacement the current cover by
 * clearing its `replacesMediaId`. A sitting whose browser
 * session row is gone is one nothing can match.
 *
 * @type {Readonly<Record<string, ReadonlyArray<Readonly<{model: string, column: string}>>>>}
 */
const ON_DELETE_SET_NULL = Object.freeze({
  mediaAsset: Object.freeze([Object.freeze({ model: 'mediaAsset', column: 'replacesMediaId' })]),
  session: Object.freeze([Object.freeze({ model: 'eventPlatformEdit', column: 'sessionId' })]),
})

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
  'organizerInvitation',
  'trafficSalt',
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
  'mediaBlob',
  'eventChangeNotice',
  'eventImportRun',
  'eventFeeSetting',
  'eventVenuePaymentChange',
  // Append-only (trigger `venue_booking_cancellation_append_only`).
  'venueBookingCancellation',
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
 * Whether a value matches a `LIKE` pattern, as PostgreSQL reads one.
 *
 * Prisma runs `contains`, `startsWith` and `endsWith` as `LIKE` (`ILIKE` with
 * `mode: 'insensitive'`), and a case-insensitive `equals` as `ILIKE`, passing
 * the value through unescaped. So `%` is any run of characters, `_` is any one,
 * and `\` makes the character after it literal. The stub reads the operand the
 * same way, so a route that escapes a person's search (`likeLiteral`) finds
 * here exactly what it finds on PostgreSQL, and one that forgets over-matches
 * here too.
 *
 * @param {string} value The stored text.
 * @param {string} pattern The whole pattern, `%` around it already where the operator adds one.
 * @param {boolean} insensitive Compare ignoring case.
 * @returns {boolean} Whether the whole value matches.
 */
function likeMatches(value, pattern, insensitive) {
  const fold = (text) => (insensitive ? text.toLowerCase() : text)
  const literal = (character) => character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const characters = [...fold(pattern)]
  let source = ''

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]

    if (character === '\\' && index + 1 < characters.length) {
      index += 1
      source += literal(characters[index])
    } else if (character === '%') source += '[\\s\\S]*'
    else if (character === '_') source += '[\\s\\S]'
    else source += literal(character)
  }

  return new RegExp(`^${source}$`, 'u').test(fold(value))
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
        // Case-insensitive equality is `ILIKE` on PostgreSQL: a pattern.
        if (insensitive && typeof operand === 'string') {
          if (typeof value !== 'string' || !likeMatches(value, operand, true)) return false
        } else if (!matchesCondition(fold(value), fold(operand))) return false
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
        if (typeof value !== 'string' || !likeMatches(value, `%${operand}%`, insensitive)) {
          return false
        }
        break
      case 'startsWith':
        if (typeof value !== 'string' || !likeMatches(value, `${operand}%`, insensitive)) {
          return false
        }
        break
      case 'endsWith':
        if (typeof value !== 'string' || !likeMatches(value, `%${operand}`, insensitive)) {
          return false
        }
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
      // A scalar list's emptiness, as PostgreSQL's `cardinality(...) = 0`.
      case 'isEmpty':
        if ((Array.isArray(value) && value.length === 0) !== operand) return false
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
    const added = SEEDED_COLUMN_DEFAULTS[model] ?? {}

    tables[model] = rows.map((row) => {
      const copy = { ...row, ...(SEEDED_DERIVED_COLUMNS[model]?.(row) ?? {}) }

      for (const [column, value] of Object.entries(added)) {
        if (!(column in copy)) copy[column] = value
      }

      return copy
    })
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
          // Prisma's to-one filters `is` and `isNot`, null meaning "no related row".
          if ('is' in condition || 'isNot' in condition) {
            if ('is' in condition) {
              const clause = condition.is
              const hit =
                clause === null
                  ? !related
                  : Boolean(related) && matches(relation.model, related, clause)

              if (!hit) return false
            }

            if ('isNot' in condition) {
              const clause = condition.isNot
              const hit =
                clause === null
                  ? !related
                  : Boolean(related) && matches(relation.model, related, clause)

              if (hit) return false
            }

            continue
          }

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
   * Raise the error Prisma's driver adapter raises when a named index — here a
   * partial one — refuses a row.
   *
   * The adapter names the index rather than the fields, both in the message
   * and under `meta.driverAdapterError.cause.constraint`, which is where
   * `violatedFields` in the ledger looks for it.
   *
   * @param {string} model The model.
   * @param {string} index The index's name.
   * @returns {Error} A `P2002` error.
   */
  function partialUniqueViolation(model, index) {
    const error = new Error(`Unique constraint failed on the constraint: \`${index}\``)
    error.code = 'P2002'
    error.meta = {
      modelName: model,
      target: [index],
      driverAdapterError: { cause: { constraint: { index } } },
    }
    return error
  }

  /**
   * Clear the columns that point at deleted rows through a foreign key declared
   * ON DELETE SET NULL ({@link ON_DELETE_SET_NULL}), as PostgreSQL does in the
   * same statement.
   *
   * @param {string} model The model whose rows were deleted.
   * @param {object[]} removed The deleted rows.
   * @returns {void}
   */
  function clearReferencesTo(model, removed) {
    const ids = new Set(removed.map((row) => row.id).filter((id) => id !== undefined))

    if (ids.size === 0) return

    for (const { model: referencing, column } of ON_DELETE_SET_NULL[model] ?? []) {
      for (const row of tables[referencing] ?? []) {
        if (ids.has(row[column])) row[column] = null
      }
    }
  }

  /**
   * Refuse a row that a partial unique index would refuse.
   *
   * @param {string} model The model.
   * @param {object} row The row as it would be stored.
   * @returns {void}
   * @throws {Error} A `P2002` naming the index, when another indexed row has the same key.
   */
  function assertPartialUnique(model, row) {
    for (const index of PARTIAL_UNIQUE[model] ?? []) {
      if (!index.when(row)) continue

      const key = index.key(row)
      if (key.some((value) => value === null || value === undefined)) continue

      const clash = tables[model].some(
        (existing) =>
          existing !== row &&
          index.when(existing) &&
          index.key(existing).every((value, position) => value === key[position]),
      )

      if (clash) throw partialUniqueViolation(model, index.name)
    }
  }

  /**
   * Apply an update to rows in place, and put every one back if a partial
   * unique index refuses the result.
   *
   * PostgreSQL refuses the whole statement; a stub that left the rows it had
   * already changed would let a failed write outside a transaction look like a
   * half-successful one.
   *
   * @param {string} model The model.
   * @param {object[]} rows The rows being updated.
   * @param {object} data The Prisma data payload.
   * @returns {void}
   */
  function updateRows(model, rows, data) {
    const before = rows.map((row) => ({ ...row }))

    for (const row of rows) recordLock(tableNameOf(model), row.id, 'UPDATE', 'write')

    for (const row of rows) {
      applyData(row, data)
      if (TIMESTAMPED.has(model)) row.updatedAt = new Date()
    }

    try {
      for (const row of rows) assertPartialUnique(model, row)
    } catch (error) {
      rows.forEach((row, index) => {
        for (const field of Object.keys(row)) delete row[field]
        Object.assign(row, before[index])
      })
      throw error
    }
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
          ...generatedId(model),
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
          ...(model === 'eventPlatformEdit' ? { openedAt: now } : {}),
          ...(model === 'eventImportItem' ? { importedAt: now, lastSyncedAt: now } : {}),
          ...(model === 'referralCodeEvent' ? { addedAt: now } : {}),
          ...(model === 'venuePayment' ? { recordedAt: now } : {}),
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

          if (tables[model].some((existing) => sameKey(existing[field], row[field]))) {
            throw uniqueViolation(model, field)
          }
        }

        for (const fields of COMPOUND_UNIQUE[model] ?? []) {
          if (!fields.every((field) => present(row[field]))) continue

          const clash = tables[model].some((existing) =>
            fields.every((field) => sameKey(existing[field], row[field])),
          )

          if (clash) throw uniqueViolation(model, fields.join('_'))
        }

        assertPartialUnique(model, row)

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

        updateRows(model, [row], args.data)
        return hydrate(model, row, args.include, args.select)
      },
      updateMany: async (args) => {
        const rows = tables[model].filter((candidate) => matches(model, candidate, args.where))
        updateRows(model, rows, args.data)
        return { count: rows.length }
      },
      upsert: async (args) => {
        const row = tables[model].find((candidate) => matches(model, candidate, args.where))

        if (row) {
          updateRows(model, [row], args.update)
          return hydrate(model, row, args.include, args.select)
        }

        const now = new Date()
        const created = {
          ...generatedId(model),
          ...DEFAULTS[model],
          ...(TIMESTAMPED.has(model) ? { createdAt: now, updatedAt: now } : {}),
          ...(CREATED_ONLY.has(model) ? { createdAt: now } : {}),
          ...(model === 'eventPlatformEdit' ? { openedAt: now } : {}),
          ...(model === 'eventImportItem' ? { importedAt: now, lastSyncedAt: now } : {}),
          ...args.create,
        }

        assertPartialUnique(model, created)

        tables[model].push(created)
        return hydrate(model, created, args.include)
      },
      delete: async (args) => {
        const index = tables[model].findIndex((candidate) => matches(model, candidate, args.where))
        if (index < 0) throw new Error(`No ${model} found`)
        const [row] = tables[model].splice(index, 1)
        clearReferencesTo(model, [row])
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

        const removed = []

        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (!matches(model, rows[index], args.where)) continue
          removed.push(...rows.splice(index, 1))
          count += 1
        }

        clearReferencesTo(model, removed)

        return { count }
      },
      /**
       * `groupBy`, supporting the shapes the API uses: group by columns, then
       * count and sum, or nothing (the distinct combinations alone, as the
       * search asks which venues and organisers add an event); order by a
       * grouped column or by a sum; and page with `skip` and `take`. Enough for
       * the device list, the visit totals and the search, and deliberately not
       * a general implementation — a stub that pretends to support more of the
       * query language than it does is worse than one that throws.
       *
       * A sum over a group whose values are all null is null, as Prisma
       * returns it; callers write `?? 0`.
       *
       * @param {object} args Prisma `groupBy` arguments.
       * @returns {Promise<object[]>} One row per distinct combination.
       */
      groupBy: async (args = {}) => {
        const by = toArray(args.by)

        if (by.length === 0) throw new Error('groupBy needs at least one column')

        for (const key of Object.keys(args)) {
          if (['by', 'where', '_count', '_sum', 'orderBy', 'skip', 'take'].includes(key)) continue

          throw new Error(`prisma-stub: groupBy does not implement ${key}`)
        }

        const rows = (tables[model] ?? []).filter((row) => matches(model, row, args.where))
        const sumFields = Object.keys(args._sum ?? {})
        /** @type {Map<string, {row: object, members: object[]}>} */
        const groups = new Map()

        for (const row of rows) {
          const key = JSON.stringify(
            by.map((column) =>
              row[column] instanceof Date ? row[column].getTime() : (row[column] ?? null),
            ),
          )
          const existing = groups.get(key)

          if (existing) {
            existing.members.push(row)
            continue
          }

          groups.set(key, {
            row: Object.fromEntries(by.map((column) => [column, row[column] ?? null])),
            members: [row],
          })
        }

        const results = [...groups.values()].map(({ row, members }) => {
          const sums = Object.fromEntries(
            sumFields.map((field) => {
              const present = members.filter(
                (member) => member[field] !== null && member[field] !== undefined,
              )

              return [
                field,
                present.length === 0
                  ? null
                  : present.reduce((total, member) => total + member[field], 0),
              ]
            }),
          )

          return {
            ...row,
            ...(args._count ? { _count: { _all: members.length } } : {}),
            ...(args._sum ? { _sum: sums } : {}),
          }
        })

        if (args.orderBy) {
          const clauses = toArray(args.orderBy)

          results.sort((left, right) => {
            for (const clause of clauses) {
              const [field, direction] = Object.entries(clause)[0]
              let a
              let b

              if (field === '_sum') {
                const [sumField, sumDirection] = Object.entries(direction)[0]
                a = left._sum?.[sumField] ?? null
                b = right._sum?.[sumField] ?? null

                if (a === b) continue

                const order = a === null ? 1 : b === null ? -1 : a < b ? -1 : 1
                return sumDirection === 'desc' ? -order : order
              }

              if (!by.includes(field)) {
                throw new Error(`prisma-stub: groupBy orders only by a grouped column or a sum`)
              }

              a = toComparable(left[field])
              b = toComparable(right[field])

              if (a === b) continue

              const order = a < b ? -1 : 1
              return direction === 'desc' ? -order : order
            }

            return 0
          })
        }

        const start = args.skip ?? 0
        const end = args.take === undefined ? undefined : start + args.take

        return results.slice(start, end)
      },
    }
  }

  /** @type {Array<{sql: string, values: unknown[]}>} */
  const rawStatements = []

  /**
   * Every row lock a statement would take, in the order taken (SPEC3-XI
   * §5.6): the raw locks (`SELECT … FOR …`), the rows a raw `UPDATE` changes,
   * and the rows Prisma's `update`, `updateMany` and `upsert` change. Each
   * entry names the table as PostgreSQL does (`Order`, `ReferralCode`), the
   * row's id, the lock's mode, whether it was a lock or a write, and the
   * transaction it was taken in (a number counted from 1, or null outside
   * one), so a test can assert the lock law: the order rows before the codes,
   * and the codes in ascending id order, last.
   *
   * @type {Array<{table: string, id: unknown, mode: string, kind: 'lock'|'write', transaction: number|null}>}
   */
  const lockLog = []

  /** The transaction now running, counted from 1; null outside one. */
  let currentTransaction = null
  let transactionCount = 0

  /**
   * Record one row lock.
   *
   * @param {string} table The table, as PostgreSQL names it.
   * @param {unknown} id The row's id.
   * @param {string} mode The lock's mode (`UPDATE`, `KEY SHARE`, …).
   * @param {'lock'|'write'} kind A `SELECT … FOR …`, or a write.
   * @returns {void}
   */
  function recordLock(table, id, mode, kind) {
    lockLog.push({ table, id, mode, kind, transaction: currentTransaction })
  }

  /**
   * A model's table, as PostgreSQL names it: `order` → `Order`.
   *
   * @param {string} model The model.
   * @returns {string} The table.
   */
  function tableNameOf(model) {
    return model[0].toUpperCase() + model.slice(1)
  }

  /**
   * A table's rows here, from its PostgreSQL name: `Order` → `order`.
   *
   * @param {string} table The table.
   * @returns {object[]} Its rows (empty for a table the stub does not know).
   */
  function rowsOfTable(table) {
    return tables[table[0].toLowerCase() + table.slice(1)] ?? []
  }

  /**
   * A raw query's values with `Prisma.join(...)` lists spread out, as
   * PostgreSQL receives them.
   *
   * @param {unknown[]} values The template's values.
   * @returns {unknown[]} The flat values.
   */
  function flatValues(values) {
    return values.flatMap((value) =>
      value &&
      typeof value === 'object' &&
      Array.isArray(value.values) &&
      Array.isArray(value.strings)
        ? value.values
        : [value],
    )
  }

  /**
   * Whether an order ended without being used (SPEC3-XI XR2), from the stub's
   * own rows: the emulation of `orderEndedWithoutUse`'s one statement.
   *
   * @param {object} order The order row.
   * @returns {boolean} True when it ended.
   */
  function orderEnded(order) {
    if (['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(order.status)) return true
    if (order.status !== 'PAID') return false

    const lineIds = new Set(
      tables.orderItem.filter((line) => line.orderId === order.id).map((line) => line.id),
    )
    const tickets = tables.ticket.filter((ticket) => lineIds.has(ticket.orderItemId))
    const ticketIds = new Set(tickets.map((ticket) => ticket.id))
    const admitted = tables.checkIn.some((checkIn) => ticketIds.has(checkIn.ticketId))
    const standing = tickets.some((ticket) =>
      ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'].includes(ticket.status),
    )
    const event = tables.event.find((candidate) => candidate.id === order.eventId)
    const left =
      (order.totalCents ?? 0) - (order.refundedCents ?? 0) - (order.venueFeeKeptCents ?? 0)

    return (
      !admitted &&
      (order.refundPendingCents ?? 0) === 0 &&
      left <= 0 &&
      (!standing || event?.status === 'CANCELLED')
    )
  }

  /**
   * A CHECK refusal, shaped as the pg adapter reports one from a raw statement.
   *
   * @param {string} table The table.
   * @param {string} constraint The constraint's name.
   * @returns {Error} The error.
   */
  function rawCheckRefusal(table, constraint) {
    const message = `new row for relation "${table}" violates check constraint "${constraint}"`

    return Object.assign(new Error(`Raw query failed. Code: \`23514\`. Message: \`${message}\``), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '23514', originalMessage: message } },
      },
    })
  }

  /**
   * What a raw query answers here: a row-lock answers the row's id when the row
   * exists (as `SELECT "id" … FOR …` does), an advisory lock answers one row,
   * and the venue-booking count (SPEC3 §6.4) is computed from the stub's own
   * rows. Anything else answers no rows, as every raw query here used to.
   *
   * Referral returns (SPEC3-XI XR3) are emulated from the rows as well: the
   * statement marked `referral-order-ended` answers the ids among its values
   * whose order ended without being used (XR2); the order's conditional marker
   * `UPDATE "Order" SET "referralUseReturnedAt" … RETURNING "referralCodeId"`
   * sets it only when the order names a code and has no marker yet; and a
   * code's `SELECT "useCount" … FOR NO KEY UPDATE` answers its count. Every lock and
   * every row a raw `UPDATE` changes is written to {@link lockLog}.
   *
   * The count is recognised by the marker `venue-booking-count` anywhere in its
   * text (a SQL comment), and takes the event's id as its only value; it
   * answers `{ eventUnpaid }` as a number, so the statement should cast its sum
   * `::int`. It counts the event's pay-at-the-venue orders in PENDING or PAID:
   * a PENDING order by `min(quantity, venueDueCents)` per line, a PAID one by
   * its tickets that owe at the door, have no payment and still stand. Nothing
   * is counted per account (the owner's answer to open question 1: only the
   * event's own limit exists). No trigger is emulated.
   *
   * @param {string} sql The statement, its values replaced by `?`.
   * @param {unknown[]} values The values.
   * @returns {object[]} The rows.
   */
  function rawQueryResult(sql, values) {
    const text = sql.replace(/\s+/gu, ' ').trim()
    const lock =
      /^SELECT "?id"? FROM "([A-Za-z]+)" WHERE "?id"? = \? FOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)$/u.exec(
        text,
      )

    if (lock && values.length === 1) {
      const rows = rowsOfTable(lock[1])

      recordLock(lock[1], values[0], /FOR (.+)$/u.exec(text)[1], 'lock')

      return rows.some((row) => row.id === values[0]) ? [{ id: values[0] }] : []
    }

    const listLock =
      /^SELECT "?id"? FROM "([A-Za-z]+)" WHERE "?id"? IN \(\?\) ORDER BY "?id"? FOR (UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)$/u.exec(
        text,
      )

    if (listLock) {
      const ids = flatValues(values)
      const rows = rowsOfTable(listLock[1])
      const held = [...ids].sort().filter((id) => rows.some((row) => row.id === id))

      for (const id of [...ids].sort()) recordLock(listLock[1], id, listLock[2], 'lock')

      return held.map((id) => ({ id }))
    }

    const codeCount =
      /^SELECT "useCount" FROM "ReferralCode" WHERE "id" = \? FOR (UPDATE|NO KEY UPDATE)$/u.exec(
        text,
      )

    if (codeCount) {
      recordLock('ReferralCode', values[0], codeCount[1], 'lock')

      const code = tables.referralCode.find((row) => row.id === values[0])

      return code ? [{ useCount: code.useCount }] : []
    }

    if (text.includes('referral-order-ended')) {
      const ids = new Set(flatValues(values))

      return tables.order
        .filter((order) => ids.has(order.id) && orderEnded(order))
        .map((order) => order.id)
        .sort()
        .map((id) => ({ id }))
    }

    if (text.startsWith('UPDATE "Order" SET "referralUseReturnedAt" = ?')) {
      const [now, cause, orderId] = values

      recordLock('Order', orderId, 'UPDATE', 'write')

      const order = tables.order.find((row) => row.id === orderId)

      if (!order || order.referralCodeId === null || order.referralCodeId === undefined) return []
      if (order.referralUseReturnedAt !== null && order.referralUseReturnedAt !== undefined) {
        return []
      }

      order.referralUseReturnedAt = now
      order.referralUseReturnCause = cause

      return [{ referralCodeId: order.referralCodeId }]
    }

    if (text.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }]

    if (text.includes('venue-booking-count')) {
      const [eventId] = values
      const standing = new Set(['VALID', 'TRANSFER_PENDING'])
      const unpaidOf = (order) => {
        const lines = tables.orderItem.filter((line) => line.orderId === order.id)

        if (order.status === 'PENDING') {
          return lines.reduce(
            (sum, line) => sum + Math.min(line.quantity ?? 0, line.venueDueCents ?? 0),
            0,
          )
        }

        const lineIds = new Set(lines.map((line) => line.id))

        return tables.ticket.filter(
          (ticket) =>
            lineIds.has(ticket.orderItemId) &&
            (ticket.venueDueCents ?? 0) > 0 &&
            (ticket.venuePaymentId ?? null) === null &&
            standing.has(ticket.status),
        ).length
      }
      const counted = tables.order.filter(
        (order) =>
          order.eventId === eventId &&
          order.paymentMethod === 'AT_VENUE' &&
          (order.status === 'PENDING' || order.status === 'PAID'),
      )

      return [{ eventUnpaid: counted.reduce((sum, order) => sum + unpaidOf(order), 0) }]
    }

    return []
  }

  /**
   * What a raw statement does here: the referral code's use count is taken
   * (`lib/referral-uses.js`, SPEC3 §8.2), with the database's
   * `referral_code_use_within_limit` refusal, shaped as the pg adapter reports
   * it, for a count past the code's limit; and lowered by the uses a batch
   * gives back (SPEC3-XI XR3 step 5), with `referral_code_shape`'s refusal
   * below zero. Anything else changes nothing and reports no rows, as every
   * raw statement here used to.
   *
   * @param {string} sql The statement, its values replaced by `?`.
   * @param {unknown[]} values The values.
   * @returns {number} Rows affected.
   * @throws {Error} The CHECK refusal, for a use past the limit.
   */
  function rawStatementResult(sql, values) {
    const text = sql.replace(/\s+/gu, ' ').trim()

    if (text.startsWith('UPDATE "ReferralCode" SET "useCount" = "useCount" + 1 WHERE "id" = ?')) {
      recordLock('ReferralCode', values[0], 'UPDATE', 'write')

      const row = tables.referralCode.find((candidate) => candidate.id === values[0])

      if (!row) return 0

      if (row.maxUses !== null && row.maxUses !== undefined && row.useCount + 1 > row.maxUses) {
        const message =
          'new row for relation "ReferralCode" violates check constraint "referral_code_use_within_limit"'

        throw Object.assign(
          new Error(`Raw query failed. Code: \`23514\`. Message: \`${message}\``),
          {
            name: 'PrismaClientKnownRequestError',
            code: 'P2010',
            meta: {
              driverAdapterError: { cause: { originalCode: '23514', originalMessage: message } },
            },
          },
        )
      }

      row.useCount += 1

      return 1
    }

    if (text.startsWith('UPDATE "ReferralCode" SET "useCount" = "useCount" - ? WHERE "id" = ?')) {
      const [lowered, codeId] = values

      recordLock('ReferralCode', codeId, 'UPDATE', 'write')

      const row = tables.referralCode.find((candidate) => candidate.id === codeId)

      if (!row) return 0

      // CHECK `referral_code_shape`: never below zero.
      if (row.useCount - lowered < 0) throw rawCheckRefusal('ReferralCode', 'referral_code_shape')

      row.useCount -= lowered

      return 1
    }

    return 0
  }

  const client = {
    _store: tables,
    _rawQueries: rawQueries,
    _rawStatements: rawStatements,
    lockLog,

    /**
     * Record a raw query. Real PostgreSQL takes the row lock here.
     *
     * @param {TemplateStringsArray|string[]} strings Template literal chunks.
     * @param {...unknown} values Interpolated values.
     * @returns {Promise<object[]>} What {@link rawQueryResult} answers: usually nothing.
     */
    $queryRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('?')

      rawQueries.push({ sql, values })

      return rawQueryResult(sql, values)
    },

    /**
     * Record a raw statement, which changes nothing here except a referral
     * code's use count (see {@link rawStatementResult}).
     *
     * Kept apart from `$queryRaw`'s record, so a test can tell a statement that
     * would have written from a query that only locked.
     *
     * @param {TemplateStringsArray|string[]} strings Template literal chunks.
     * @param {...unknown} values Interpolated values.
     * @returns {Promise<number>} Rows affected: zero, but for a referral use.
     */
    $executeRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('?')

      rawStatements.push({ sql, values })

      return rawStatementResult(sql, values)
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
        transactionCount += 1
        currentTransaction = transactionCount

        const snapshot = {}
        for (const [model, rows] of Object.entries(tables)) {
          snapshot[model] = rows.map((row) => ({ ...row }))
        }

        try {
          return await body(transactionClient)
        } catch (error) {
          // Restored in place so that `_store.someModel` references held by a
          // test stay valid across a rollback.
          for (const [model, rows] of Object.entries(snapshot)) {
            tables[model].length = 0
            tables[model].push(...rows)
          }
          throw error
        } finally {
          currentTransaction = null
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

  /**
   * What a transaction body is handed: the client, read through live (so a
   * test that replaces a delegate mid-test is still seen), without the
   * connection methods Prisma's own transaction client lacks. Code that tells
   * a client from a transaction client by them (`decideWebsiteRedirect`) then
   * behaves here as it does against PostgreSQL.
   */
  const transactionClient = new Proxy(client, {
    get(target, property, receiver) {
      if (TRANSACTION_CLIENT_OMITS.has(property)) return undefined

      return Reflect.get(target, property, receiver)
    },
    has(target, property) {
      return !TRANSACTION_CLIENT_OMITS.has(property) && Reflect.has(target, property)
    },
  })

  return client
}

/** What Prisma's interactive transaction client does not have. */
const TRANSACTION_CLIENT_OMITS = new Set(['$connect', '$disconnect', '$on', '$extends'])
