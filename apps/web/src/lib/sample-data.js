/**
 * The curated catalogue the site falls back to when the API cannot be reached.
 *
 * This is not filler. The API is a separate process that is routinely down
 * during `next build`, during unit tests and on a fresh clone, and a ticketing
 * site that renders an empty grid in those moments looks broken rather than
 * offline. So the web app ships a small, real-looking catalogue — twenty
 * Navratri-season events across eleven US cities, priced in US cents — and
 * renders that instead of an error.
 *
 * Every organiser, venue and address here is invented. The cities are real so
 * that the city filter means something; the street addresses, the venues and
 * the people running them are not, and every website is on `.example`. The
 * sample notice the pages already show says so to the visitor.
 *
 * Shapes here match `eventWithRelationsSchema` and `ticketTypeListResponseSchema`
 * from `@desi-event/schemas` so that a component cannot tell the difference
 * between a sample event and a live one. That includes the parts of the live
 * payload that are easy to forget: `feeTerms` on an event, `minTotalCents` and
 * `salesOpen` on a summary, and the rule that a listing only carries the
 * statuses the API lists.
 *
 * The catalogue is deliberately not all sunshine. Between them the events
 * exercise every state a page has to render honestly: a sold-out tier, a
 * sold-out event, a free event, a tier with only a few left, sales paused, a
 * postponement, a cancellation, a finished event, a seated tier this site does
 * not sell, and an organiser who is not verified.
 *
 * Dates are generated relative to process start rather than hard-coded, so the
 * fallback catalogue never rots into a listing of events that happened last
 * year. Each start is a local wall-clock time in the event's own zone,
 * converted to UTC for that zone's offset *on that date*, so a 7:30 PM start
 * stays 7:30 PM either side of a daylight-saving change. They are computed once
 * at module load, which keeps a single server render internally consistent.
 *
 * @module lib/sample-data
 */

import { BOOKABLE_STATUSES, INDEXABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { priceSelection } from './pricing.js'
import { fromLocalInputValue, toLocalInputValue } from './zoned-time.js'

/** Instant the relative dates below are measured from, fixed for the process. */
const BASE_TIME = Date.now()

/** Milliseconds in a day. */
const DAY_MS = 86_400_000

/** Milliseconds in an hour. */
const HOUR_MS = 3_600_000

/** US Eastern: New Jersey, New York, Pennsylvania, Georgia. */
const EASTERN = 'America/New_York'

/** US Central: Texas, Illinois. */
const CENTRAL = 'America/Chicago'

/** US Pacific: California, Washington. */
const PACIFIC = 'America/Los_Angeles'

/**
 * The fee terms the API publishes with each event when it runs on its default
 * configuration — `PLATFORM_FEE_BPS` 590 and `PLATFORM_FEE_FLAT_CENTS` 99 in
 * `@desi-event/schemas/env`. The fallback carries the same terms so that the
 * all-in price on a sample card is the price a live deployment on defaults
 * would quote, rather than a second, different estimate.
 */
const SAMPLE_FEE_TERMS = Object.freeze({ percentageBps: 590, flatCents: 99 })

/**
 * Two-digit, zero-padded.
 *
 * @param {number} value A whole number below 100.
 * @returns {string} The padded digits.
 */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * The calendar date, in a zone, a whole number of days from process start.
 *
 * @param {number} days Offset in days; may be negative for a past event.
 * @param {string} timeZone IANA zone the date is read in.
 * @returns {string} A `YYYY-MM-DD` date.
 */
function localDate(days, timeZone) {
  return toLocalInputValue(new Date(BASE_TIME + days * DAY_MS), timeZone).slice(0, 10)
}

/**
 * The instant a local wall-clock time happens, a number of days from now.
 *
 * Why not add a fixed UTC hour: an Eastern 7:30 PM is 23:30 UTC in October and
 * 00:30 UTC the next day in December, and a catalogue built on fixed UTC hours
 * drifts by an hour every time the clocks change.
 *
 * @param {number} days Offset in days; may be negative for a past event.
 * @param {string} timeZone IANA zone the wall-clock time is in.
 * @param {number} hour Local hour, 0–23.
 * @param {number} [minute] Local minute.
 * @returns {string} A UTC ISO-8601 timestamp.
 */
function localTime(days, timeZone, hour, minute = 0) {
  return fromLocalInputValue(`${localDate(days, timeZone)}T${pad(hour)}:${pad(minute)}`, timeZone)
}

/**
 * The first day, at or after an offset, that falls on a given weekday.
 *
 * Exists for the one event whose title names its day: "Peachtree Garba
 * Saturday" must be on a Saturday whatever day the process starts on.
 *
 * @param {number} days Earliest offset in days.
 * @param {number} weekday 0 for Sunday through 6 for Saturday.
 * @param {string} timeZone IANA zone the weekday is read in.
 * @returns {number} An offset in days, between `days` and `days + 6`.
 */
function onOrAfterWeekday(days, weekday, timeZone) {
  for (let offset = days; offset < days + 7; offset += 1) {
    const [year, month, day] = localDate(offset, timeZone).split('-').map(Number)
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === weekday) return offset
  }

  return days
}

/**
 * An instant some hours after another.
 *
 * @param {string} iso A UTC ISO-8601 timestamp.
 * @param {number} hours Hours to add; fractions allowed.
 * @returns {string} A UTC ISO-8601 timestamp.
 */
function hoursAfter(iso, hours) {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString()
}

/**
 * A start and an end, as a definition spreads them.
 *
 * @param {number} days Offset in days of the start.
 * @param {string} timeZone IANA zone of the event.
 * @param {number} hour Local start hour.
 * @param {number} minute Local start minute.
 * @param {number} hours Duration in hours.
 * @returns {{startsAt: string, endsAt: string, timezone: string}} The timing fields.
 */
function evening(days, timeZone, hour, minute, hours) {
  const startsAt = localTime(days, timeZone, hour, minute)

  return { startsAt, endsAt: hoursAfter(startsAt, hours), timezone: timeZone }
}

/** Refund wording an organiser might really publish, shared by several. */
const STANDARD_REFUNDS =
  'Full refund up to seven days before the event. After that, tickets cannot be refunded but may be transferred to someone else.'

/** Organisations that appear in the fallback catalogue. */
const ORGANIZATIONS = {
  mirrorwork: {
    id: 'orgmirrorworkevents',
    name: 'Mirrorwork Events',
    slug: 'mirrorwork-events',
    description:
      'Navratri nights, beginner garba classes and live-band concerts in central New Jersey.',
    contactEmail: 'hello@mirrorwork.example',
    websiteUrl: 'https://mirrorwork.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
  },
  chaniya: {
    id: 'orgchaniyacollective',
    name: 'Chaniya Collective',
    slug: 'chaniya-collective',
    description:
      'Houston dancers and volunteers running dandiya nights and free children’s classes.',
    contactEmail: 'team@chaniya.example',
    websiteUrl: 'https://chaniya.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy:
      'Refunds up to 72 hours before doors open. After that, tickets can be transferred but not refunded.',
  },
  lakeshore: {
    id: 'orglakeshoreraas',
    name: 'Lakeshore Raas',
    slug: 'lakeshore-raas',
    description: 'Navratri garba and raas in the northwest suburbs of Chicago.',
    contactEmail: 'raas@lakeshore.example',
    websiteUrl: 'https://lakeshore.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy: STANDARD_REFUNDS,
  },
  bayLights: {
    id: 'orgbaylightsgarba',
    name: 'Bay Lights Garba Co.',
    slug: 'bay-lights-garba-co',
    description: 'Garba and dandiya nights in the South Bay, with live bands every night.',
    contactEmail: 'tickets@baylightsgarba.example',
    websiteUrl: 'https://baylightsgarba.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy:
      'Full refund up to fourteen days before the event, half the face value up to seven days before, and transfers at any time.',
  },
  peachtree: {
    id: 'orgpeachtreeraasclub',
    name: 'Peachtree Raas Club',
    slug: 'peachtree-raas-club',
    description: 'A volunteer-run garba club in Atlanta, with family-friendly Navratri nights.',
    contactEmail: 'club@peachtreeraas.example',
    websiteUrl: 'https://peachtreeraas.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
  },
  libertyBell: {
    id: 'orglibertybellnavratri',
    name: 'Liberty Bell Navratri',
    slug: 'liberty-bell-navratri',
    description: 'Community evenings of aarti and garba in Philadelphia.',
    contactEmail: 'navratri@libertybell.example',
    websiteUrl: 'https://libertybell.example',
    verified: false,
    payoutCurrency: 'USD',
    verificationStatus: 'UNVERIFIED',
    timezone: EASTERN,
    refundPolicy:
      'Refunds up to 48 hours before the event. If an event is postponed, tickets stay valid for the new date or can be refunded in full.',
  },
  rainier: {
    id: 'orgrainierraas',
    name: 'Rainier Raas',
    slug: 'rainier-raas',
    description: 'Family garba evenings on the Eastside of Seattle.',
    contactEmail: 'hello@rainierraas.example',
    websiteUrl: 'https://rainierraas.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy: STANDARD_REFUNDS,
  },
  pacific: {
    id: 'orgpacificdandiya',
    name: 'Pacific Dandiya Society',
    slug: 'pacific-dandiya-society',
    description: 'Dandiya raas nights in Southern California, always to a live band.',
    contactEmail: 'society@pacificdandiya.example',
    websiteUrl: 'https://pacificdandiya.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: PACIFIC,
    refundPolicy:
      'Refunds up to ten days before the event. VIP Lounge tickets can be exchanged for general admission at any time.',
  },
  fiveBoroughs: {
    id: 'orgfiveboroughsgarba',
    name: 'Five Boroughs Garba',
    slug: 'five-boroughs-garba',
    description: 'Garba across New York City, from mela evenings to an all-night marathon.',
    contactEmail: 'info@fiveboroughsgarba.example',
    websiteUrl: 'https://fiveboroughsgarba.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: EASTERN,
    refundPolicy: STANDARD_REFUNDS,
  },
  loneStar: {
    id: 'orglonestarnavratri',
    name: 'Lone Star Navratri',
    slug: 'lone-star-navratri',
    description: 'Navratri, Sharad Poonam and student showcase nights in Dallas–Fort Worth.',
    contactEmail: 'contact@lonestarnavratri.example',
    websiteUrl: 'https://lonestarnavratri.example',
    verified: true,
    payoutCurrency: 'USD',
    verificationStatus: 'VERIFIED',
    timezone: CENTRAL,
    refundPolicy:
      'Full refund up to five days before the event. If an event is cancelled, every ticket is refunded in full.',
  },
}

/**
 * A venue record with the columns every sample venue shares filled in.
 *
 * Coordinates are left null on purpose: the addresses are invented, and a
 * latitude for an invented building would end up in the venue page's
 * structured data as a claim about a real place.
 *
 * @param {object} fields The venue's own fields.
 * @returns {object} A venue as the API returns one.
 */
function venue(fields) {
  return {
    addressLine2: null,
    country: 'US',
    latitude: null,
    longitude: null,
    directions: null,
    policies: null,
    description: null,
    provenance: 'moderator',
    organizationId: null,
    mergedIntoVenueId: null,
    ...fields,
  }
}

/** Venues that appear in the fallback catalogue. */
const VENUES = {
  lamplight: venue({
    id: 'vnulamplightexpohall',
    name: 'Lamplight Expo Hall',
    addressLine1: '450 Festival Plaza',
    city: 'Edison',
    region: 'NJ',
    postalCode: '08837',
    capacity: 5000,
    slug: 'lamplight-expo-hall',
    timezone: EASTERN,
    accessibility: {
      features: [
        'STEP_FREE_ENTRANCE',
        'ACCESSIBLE_TOILET',
        'ACCESSIBLE_PARKING',
        'WHEELCHAIR_SPACES',
      ],
      note: null,
    },
  }),
  hudson: venue({
    id: 'vnuhudsonriverside',
    name: 'Hudson Riverside Pavilion',
    addressLine1: '12 Harborview Walk',
    city: 'Jersey City',
    region: 'NJ',
    postalCode: '07310',
    capacity: 900,
    slug: 'hudson-riverside-pavilion',
    timezone: EASTERN,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS'],
      note: null,
    },
  }),
  lanternRow: venue({
    id: 'vnulanternrowhall',
    name: 'Lantern Row Event Hall',
    addressLine1: '8800 Lantern Row',
    city: 'Houston',
    region: 'TX',
    postalCode: '77036',
    capacity: 4000,
    slug: 'lantern-row-event-hall',
    timezone: CENTRAL,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING'],
      note: null,
    },
  }),
  trinity: venue({
    id: 'vnutrinityconvention',
    name: 'Trinity Convention Hall',
    addressLine1: '2100 Garland Commons',
    city: 'Irving',
    region: 'TX',
    postalCode: '75038',
    capacity: 3500,
    slug: 'trinity-convention-hall',
    timezone: CENTRAL,
    accessibility: {
      features: [
        'STEP_FREE_ENTRANCE',
        'ACCESSIBLE_TOILET',
        'WHEELCHAIR_SPACES',
        'ACCESSIBLE_PARKING',
      ],
      note: null,
    },
  }),
  lakeshore: venue({
    id: 'vnulakeshorepavilion',
    name: 'Lakeshore Pavilion',
    addressLine1: '1500 Meadow Circle',
    city: 'Schaumburg',
    region: 'IL',
    postalCode: '60173',
    capacity: 3000,
    slug: 'lakeshore-pavilion',
    timezone: CENTRAL,
    accessibility: { features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'], note: null },
  }),
  santaClara: venue({
    id: 'vnusantaclaraexpo',
    name: 'Santa Clara Valley Expo',
    addressLine1: '300 Orchard Commons',
    city: 'Santa Clara',
    region: 'CA',
    postalCode: '95054',
    capacity: 4500,
    slug: 'santa-clara-valley-expo',
    timezone: PACIFIC,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING', 'QUIET_SPACE'],
      note: null,
    },
  }),
  midtown: venue({
    id: 'vnumidtowngrandhall',
    name: 'Midtown Grand Hall',
    addressLine1: '77 Peach Blossom Ave',
    city: 'Atlanta',
    region: 'GA',
    postalCode: '30308',
    capacity: 2500,
    slug: 'midtown-grand-hall',
    timezone: EASTERN,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS'],
      note: null,
    },
  }),
  delaware: venue({
    id: 'vnudelawareriver',
    name: 'Delaware River Pavilion',
    addressLine1: '40 Wharf Street',
    city: 'Philadelphia',
    region: 'PA',
    postalCode: '19106',
    capacity: 1800,
    slug: 'delaware-river-pavilion',
    timezone: EASTERN,
    accessibility: { features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'], note: null },
  }),
  cedarLane: venue({
    id: 'vnucedarlanehall',
    name: 'Cedar Lane Hall',
    addressLine1: '600 Cedar Lane',
    city: 'Bellevue',
    region: 'WA',
    postalCode: '98004',
    capacity: 1200,
    slug: 'cedar-lane-hall',
    timezone: PACIFIC,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'STEP_FREE_TO_SEATING', 'ACCESSIBLE_TOILET', 'QUIET_SPACE'],
      note: null,
    },
  }),
  cerritos: venue({
    id: 'vnucerritosgarden',
    name: 'Cerritos Garden Pavilion',
    addressLine1: '18000 Lotus Court',
    city: 'Cerritos',
    region: 'CA',
    postalCode: '90703',
    capacity: 2200,
    slug: 'cerritos-garden-pavilion',
    timezone: PACIFIC,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'ACCESSIBLE_PARKING'],
      note: null,
    },
  }),
  queens: venue({
    id: 'vnuqueenscommunity',
    name: 'Queens Community Arena',
    addressLine1: '92-10 Utsav Plaza',
    city: 'Queens',
    region: 'NY',
    postalCode: '11355',
    capacity: 3000,
    slug: 'queens-community-arena',
    timezone: EASTERN,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'LIFT_ACCESS', 'WHEELCHAIR_SPACES'],
      note: null,
    },
  }),
}

/**
 * Expand a compact ticket tier definition into a full ticket type record.
 *
 * A seated tier (`reserved`) is sold seat by seat, so its quantity columns say
 * nothing about availability — the live API folds it in exactly like this,
 * with nothing available by quantity, and the pages say it is not sold here
 * rather than reading the zero as "sold out".
 *
 * @param {string} eventId Owning event id.
 * @param {string} currency ISO 4217 code every tier of the event is priced in.
 * @param {object} tier Compact tier definition.
 * @param {number} index Position of the tier, used for `sortOrder`.
 * @returns {object} A ticket type with live availability folded in, as the API returns it.
 */
function toTicketType(eventId, currency, tier, index) {
  const quantitySold = tier.quantitySold ?? 0
  const availableQuantity = Math.max(0, tier.quantityTotal - quantitySold)
  const declared = tier.status ?? 'ON_SALE'
  const status = availableQuantity === 0 && !tier.reserved ? 'SOLD_OUT' : declared
  const sellable = status === 'ON_SALE' && !tier.reserved

  return {
    id: tier.id,
    eventId,
    name: tier.name,
    description: tier.description ?? null,
    priceCents: tier.priceCents,
    currency,
    quantityTotal: tier.quantityTotal,
    quantitySold,
    minPerOrder: tier.minPerOrder ?? 1,
    maxPerOrder: tier.maxPerOrder ?? 8,
    salesStartAt: null,
    salesEndAt: null,
    status,
    sortOrder: index,
    ...(tier.reserved ? { reserved: true } : {}),
    availableQuantity: sellable ? availableQuantity : 0,
    isSoldOut: !sellable || availableQuantity === 0,
  }
}

/**
 * Whether a verification state earns the public badge.
 *
 * One state, mirroring `BADGED_STATES` on the server. Duplicated rather than
 * imported because this module is the *offline* catalogue and must not depend
 * on the API package it stands in for — but kept to one place here, so the
 * fallback cannot show a badge the live site would not.
 *
 * @param {object} organization A sample organisation.
 * @returns {boolean} True when the badge is earned.
 */
function isBadged(organization) {
  return organization.verificationStatus === 'VERIFIED'
}

/**
 * A sample organisation reduced to the shape the API publishes.
 *
 * Matches `publicOrganizerSummarySchema`: no contact address, no payout
 * currency. The point of the fallback is that a component cannot tell the
 * difference between it and a live payload, and finding NF-14 narrowed what
 * the live payload contains.
 *
 * @param {object} organization A sample organisation.
 * @returns {object} The public summary.
 */
function toPublicOrganizer(organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description,
    websiteUrl: organization.websiteUrl,
    verified: isBadged(organization),
  }
}

/**
 * Expand a compact event definition into the full relation-bearing shape the
 * detail page consumes.
 *
 * @param {object} definition Compact event definition.
 * @returns {object} An event matching `eventWithRelationsSchema`.
 */
function toEvent(definition) {
  const { organization, venue: place, currency, tiers, status, ...event } = definition

  return {
    ...event,
    organizationId: organization.id,
    venueId: place.id,
    status: status ?? 'ON_SALE',
    coverImageUrl: null,
    isOnline: false,
    onlineUrl: null,
    publishedAt: localTime(-42, place.timezone, 10, 0),
    // What the API writes when an event is postponed: the date it was going to
    // be on, until a new one is set. Null for everything else.
    previousStartsAt: definition.previousStartsAt ?? null,
    organization: toPublicOrganizer(organization),
    venue: place,
    ticketTypes: tiers.map((tier, index) => toTicketType(event.id, currency, tier, index)),
    feeTerms: [{ currency, ...SAMPLE_FEE_TERMS }],
  }
}

/** Offset of the Saturday Peachtree Raas Club's Saturday night falls on. */
const PEACHTREE_SATURDAY = onOrAfterWeekday(20, 6, EASTERN)

/** Timing of the postponed event, which also becomes its `previousStartsAt`. */
const GARBA_FOR_GOOD = evening(24, EASTERN, 19, 0, 5)

/** Compact definitions, expanded below. Ordered by start date. */
const EVENT_DEFINITIONS = [
  {
    id: 'evtgarbawarmupatl',
    title: 'Garba Warm-Up Night',
    slug: 'garba-warm-up-night-atlanta',
    summary:
      'A relaxed warm-up garba at Midtown Grand Hall before Navratri, for anyone who has not danced since last year.',
    description: [
      'Before Navratri begins, Peachtree Raas Club holds a warm-up night at Midtown Grand Hall for everyone who has not danced since last season. The music is recorded, the pace is gentle, and the evening opens with a teaching round for anyone who has forgotten which foot goes first.',
      'It is also the easiest way to meet the volunteers who run the club’s Navratri nights, ask them anything, and pick up a pair of dandiya sticks before the season starts in earnest.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'COMPLETED',
    ...evening(-9, EASTERN, 19, 30, 4),
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.peachtree,
    venue: VENUES.midtown,
    currency: 'USD',
    tiers: [
      {
        id: 'ttwarmupgeneral',
        name: 'General Admission',
        description: 'Entry for the evening, teaching round included.',
        priceCents: 1500,
        quantityTotal: 800,
        quantitySold: 612,
        status: 'CLOSED',
      },
    ],
  },
  {
    id: 'evtbeginnerworkshopjc',
    title: 'Beginner Garba Workshop: Two-Taali, Three-Taali and Dodhiyu',
    slug: 'beginner-garba-workshop-jersey-city',
    summary:
      'A two-hour class in Jersey City for complete beginners, covering the three steps you will meet most over Navratri.',
    description: [
      'If you have ever stood at the edge of a garba circle trying to work out when to clap, this class is for you. In two hours at Hudson Riverside Pavilion, a Mirrorwork Events teacher takes a small group through the three steps you will see most over the nine nights.',
      'Two-taali comes first, then three-taali, then dodhiyu — the travelling step with the turn that catches most people out. Each one is taught slowly, then to music, then in a practice circle where getting it wrong is the point.',
      'No partner and no experience needed. Wear comfortable shoes and clothes you can turn in; the floor is sprung wood and the room is step-free.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    ...evening(10, EASTERN, 19, 0, 2),
    languages: ['English', 'Gujarati'],
    organization: ORGANIZATIONS.mirrorwork,
    venue: VENUES.hudson,
    currency: 'USD',
    tiers: [
      {
        id: 'ttbeginnerclass',
        name: 'Class Ticket',
        description: 'One place in the two-hour class.',
        priceCents: 2000,
        quantityTotal: 60,
        quantitySold: 22,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtdandiyakidshou',
    title: 'Dandiya Kids’ Hour',
    slug: 'dandiya-kids-hour-houston',
    summary:
      'A free hour of dandiya for children at Lantern Row Event Hall, with soft practice sticks and patient teachers.',
    description: [
      'Dandiya Kids’ Hour is Chaniya Collective’s way of making sure the youngest dancers arrive at Navratri knowing what to do with their sticks. For one hour the side hall at Lantern Row Event Hall belongs to children and the grown-ups who brought them.',
      'Teachers start with rhythm games and clapping patterns, then hand out soft foam practice sticks for the first raas lines. The hour ends with one short raas for the whole room, parents included.',
      'Entry is free, but each child needs a ticket so the teachers know how many to plan for. Best for ages four to eleven, and an adult stays with every child.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    ...evening(12, CENTRAL, 19, 0, 1),
    languages: ['English', 'Gujarati', 'Hindi'],
    organization: ORGANIZATIONS.chaniya,
    venue: VENUES.lanternRow,
    currency: 'USD',
    tiers: [
      {
        id: 'ttkidshourfree',
        name: 'Child Place (free)',
        description: 'Free. One ticket per child; accompanying adults do not need one.',
        priceCents: 0,
        quantityTotal: 80,
        quantitySold: 41,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtnavratrinightone',
    title: 'Navratri Night One: Garba Under the Lights',
    slug: 'navratri-night-one-edison',
    summary:
      'The first night of Navratri at Lamplight Expo Hall: a live band, a lit garbo at the centre of the floor, and room for every circle.',
    description: [
      'Navratri opens the way it should — an aarti at the garbo, a moment of quiet, and then the first beat of the dhol. Mirrorwork Events lays out the Lamplight Expo Hall floor as one great ring around a lit garbo, with room for slow circles at the edge and fast ones towards the middle.',
      'The music is live all night: a Gujarati folk band with dhol, shehnai and two singers, moving from slow garba through two-taali and three-taali, then into dandiya raas after the break. Sticks are sold at the door if you forget yours.',
      'Couple Entry admits two. VIP Circle holders have a reserved area beside the band and a separate entrance. Traditional dress is welcome and never required; comfortable shoes are strongly advised.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(18, EASTERN, 19, 30, 5),
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.mirrorwork,
    venue: VENUES.lamplight,
    currency: 'USD',
    tiers: [
      {
        id: 'ttnightonegeneral',
        name: 'General Admission',
        description: 'Entry to the main floor for the night.',
        priceCents: 3500,
        quantityTotal: 3000,
        quantitySold: 1210,
      },
      {
        id: 'ttnightonecouple',
        name: 'Couple Entry',
        description: 'Admits two to the main floor.',
        priceCents: 6000,
        quantityTotal: 600,
        quantitySold: 244,
        maxPerOrder: 4,
      },
      {
        id: 'ttnightonevipcircle',
        name: 'VIP Circle',
        description: 'A reserved area beside the band, and a separate entrance.',
        priceCents: 8500,
        quantityTotal: 150,
        quantitySold: 138,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtninenightspass',
    title: 'Mirrorwork Navratri: Nine Nights Season Pass',
    slug: 'mirrorwork-nine-nights-pass',
    summary:
      'One pass for all nine nights of Mirrorwork’s Navratri at Lamplight Expo Hall, from the opening aarti to the last raas.',
    description: [
      'If you already know you will be back every night, this is the pass for it. One wristband covers all nine nights of Mirrorwork Events’ Navratri at Lamplight Expo Hall, from the opening aarti to the final dandiya raas.',
      'Each night keeps the same shape: aarti at the garbo, garba until the break, dandiya after it, all to a live band. The wristband is collected once, on your first night, with photo ID matching the name on the order.',
      'The Family Pass covers four people from one household for all nine nights. Wristbands are not swapped between people on different nights; each one stays with the person wearing it.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    startsAt: localTime(18, EASTERN, 19, 30),
    endsAt: hoursAfter(localTime(26, EASTERN, 19, 30), 5),
    timezone: EASTERN,
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.mirrorwork,
    venue: VENUES.lamplight,
    currency: 'USD',
    tiers: [
      {
        id: 'ttninenightsseason',
        name: 'Season Pass — All Nine Nights',
        description: 'One wristband, every night.',
        priceCents: 22_000,
        quantityTotal: 300,
        quantitySold: 281,
        maxPerOrder: 4,
      },
      {
        id: 'ttninenightsfamily',
        name: 'Family Pass (4 people)',
        description: 'Four wristbands for one household, every night.',
        priceCents: 64_000,
        quantityTotal: 80,
        quantitySold: 31,
        maxPerOrder: 2,
      },
    ],
  },
  {
    id: 'evtlakeshoreopening',
    title: 'Lakeshore Raas: Opening Night',
    slug: 'lakeshore-raas-opening-night',
    summary:
      'The first night of Lakeshore Raas’s Navratri season at Lakeshore Pavilion in Schaumburg, with a live band and an aarti at the garbo.',
    description: [
      'Opening night at Lakeshore Pavilion is the start of Lakeshore Raas’s Navratri season: an aarti at the garbo, a live band on the stage, and a floor laid out as one wide circle so that nobody dances with their back to the lamp.',
      'The band plays traditional garba for the first half and moves into dandiya after the break. The pavilion is heated, the floor is sprung, and there is a coat check by the main doors — useful in a Chicago October.',
      'VIP tickets include a reserved table at the edge of the floor and priority entry. Traditional dress is welcome and never required.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(18, CENTRAL, 19, 30, 4.5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.lakeshore,
    venue: VENUES.lakeshore,
    currency: 'USD',
    tiers: [
      {
        id: 'ttlakeshoregeneral',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 3200,
        quantityTotal: 2200,
        quantitySold: 640,
      },
      {
        id: 'ttlakeshorevip',
        name: 'VIP',
        description: 'A reserved table at the edge of the floor, and priority entry.',
        priceCents: 7500,
        quantityTotal: 100,
        quantitySold: 58,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtbaylightsopening',
    title: 'Bay Lights Garba: Opening Night',
    slug: 'bay-lights-garba-opening',
    summary:
      'Bay Lights Garba Co. opens Navratri at Santa Clara Valley Expo with a live band, a lit garbo and dandiya after the break.',
    description: [
      'Bay Lights Garba Co. opens its Navratri at Santa Clara Valley Expo with everything a first night needs: an aarti at the garbo, a live band, and a floor wide enough for the slow circles and the fast ones at the same time.',
      'The first half is garba, from the gentle opening rounds to three-taali at full speed. After the break the lights come up a little for dandiya raas. Sticks are available at the merchandise table if you would rather not bring your own.',
      'The Early Bird allocation has gone; General Admission and VIP remain. VIP includes a reserved lounge with seating, a separate entrance and water all evening.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(18, PACIFIC, 19, 30, 4.5),
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.bayLights,
    venue: VENUES.santaClara,
    currency: 'USD',
    tiers: [
      {
        id: 'ttbaylightsearly',
        name: 'Early Bird',
        description: 'General admission at the early price.',
        priceCents: 2800,
        quantityTotal: 400,
        quantitySold: 400,
      },
      {
        id: 'ttbaylightsgeneral',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 4000,
        quantityTotal: 3200,
        quantitySold: 1105,
      },
      {
        id: 'ttbaylightsvip',
        name: 'VIP',
        description: 'Reserved lounge with seating, a separate entrance and water all evening.',
        priceCents: 9500,
        quantityTotal: 150,
        quantitySold: 90,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtdandiyadholhou',
    title: 'Dandiya Raas with a Live Dhol Ensemble',
    slug: 'dandiya-dhol-houston',
    summary:
      'Chaniya Collective brings a full dhol ensemble to Lantern Row Event Hall for a night that is all dandiya, all live.',
    description: [
      'Some nights are garba nights. This one is for dandiya. Chaniya Collective clears the Lantern Row Event Hall floor for raas lines, and a live dhol ensemble keeps the tempo climbing from the first pair of sticks to the last.',
      'The evening opens with a short aarti and a slow warm-up round so newcomers can find the pattern before the pace picks up. Volunteers in the Collective’s green sashes will happily partner anyone who arrives without one.',
      'Student tickets need a current student ID at the door. VIP includes seating off the floor for when your arms give out, and bottled water all night.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(19, CENTRAL, 19, 30, 5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.chaniya,
    venue: VENUES.lanternRow,
    currency: 'USD',
    tiers: [
      {
        id: 'ttdholgeneral',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 3000,
        quantityTotal: 2500,
        quantitySold: 880,
      },
      {
        id: 'ttdholstudent',
        name: 'Student',
        description: 'General admission with a current student ID, checked at the door.',
        priceCents: 1800,
        quantityTotal: 400,
        quantitySold: 172,
        maxPerOrder: 2,
      },
      {
        id: 'ttdholvip',
        name: 'VIP',
        description: 'Seating off the floor and bottled water all night.',
        priceCents: 7000,
        quantityTotal: 120,
        quantitySold: 47,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtpeachtreesaturday',
    title: 'Peachtree Garba Saturday',
    slug: 'peachtree-garba-saturday',
    summary:
      'A Saturday of garba at Midtown Grand Hall in Atlanta, with a live band, a kids’ circle and a food court from local caterers.',
    description: [
      'Peachtree Raas Club gives Navratri a proper Saturday night at Midtown Grand Hall: a live band, an aarti at the garbo, and a circle that starts slow and gets a little faster with every round.',
      'Families are the point of this one. A separate kids’ circle at the side of the hall has its own volunteer leads, so younger dancers can learn the steps without being swept into the fast rounds.',
      'Kids tickets are for ages five to twelve. Local caterers run a food court in the lobby with Gujarati snacks, chaat and chai, paid for separately.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(PEACHTREE_SATURDAY, EASTERN, 19, 30, 4.5),
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.peachtree,
    venue: VENUES.midtown,
    currency: 'USD',
    tiers: [
      {
        id: 'ttpeachtreegeneral',
        name: 'General Admission',
        description: 'Entry for the evening.',
        priceCents: 2500,
        quantityTotal: 1800,
        quantitySold: 520,
      },
      {
        id: 'ttpeachtreekids',
        name: 'Kids 5–12',
        description: 'Entry for a child aged five to twelve, with an adult.',
        priceCents: 1000,
        quantityTotal: 400,
        quantitySold: 96,
        maxPerOrder: 6,
      },
    ],
  },
  {
    id: 'evtgarbaaartidelaware',
    title: 'Garba & Aarti on the Delaware',
    slug: 'garba-and-aarti-on-the-delaware',
    summary:
      'An unhurried evening of aarti and garba at Delaware River Pavilion in Philadelphia, gentle on beginners and open to all.',
    description: [
      'Liberty Bell Navratri keeps its evening simple: a full aarti at the start, then garba in the round at Delaware River Pavilion, with the river outside the windows and a pace that suits people who have never joined a circle before.',
      'The music is recorded rather than live, and the first few rounds are slowed down on purpose so that everyone can find the steps. Experienced dancers are asked to form an outer ring once the tempo picks up.',
      'Prasad is shared after the closing aarti.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(21, EASTERN, 19, 0, 4),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.libertyBell,
    venue: VENUES.delaware,
    currency: 'USD',
    tiers: [
      {
        id: 'ttdelawaregeneral',
        name: 'General Admission',
        description: 'Entry for the evening, aarti included.',
        priceCents: 2000,
        quantityTotal: 1200,
        quantitySold: 310,
      },
    ],
  },
  {
    id: 'evtrainierfamily',
    title: 'Rainier Raas: Family Garba Evening',
    slug: 'rainier-family-garba',
    summary:
      'An easy-going garba evening in Bellevue for families, with a teaching round at the start and a finish that suits younger dancers.',
    description: [
      'Rainier Raas built this evening for families who want Navratri without a one-in-the-morning finish. Cedar Lane Hall opens with a teaching round in which a volunteer walks everyone through the basic steps, and the music stays at a pace small feet can follow.',
      'After the first hour the circles split: a gentle one for children and grandparents near the stage, a faster one for everyone else. The evening closes with an aarti at the garbo.',
      'Child tickets are for ages three to twelve. There is a quiet room off the lobby for anyone who needs a break from the music, and the hall is step-free throughout.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(22, PACIFIC, 19, 0, 3.5),
    languages: ['English', 'Gujarati'],
    organization: ORGANIZATIONS.rainier,
    venue: VENUES.cedarLane,
    currency: 'USD',
    tiers: [
      {
        id: 'ttrainieradult',
        name: 'Adult',
        description: 'Entry for one adult.',
        priceCents: 2200,
        quantityTotal: 900,
        quantitySold: 260,
      },
      {
        id: 'ttrainierchild',
        name: 'Child (3–12)',
        description: 'Entry for a child aged three to twelve, with an adult.',
        priceCents: 800,
        quantityTotal: 300,
        quantitySold: 88,
        maxPerOrder: 6,
      },
    ],
  },
  {
    id: 'evtliveband',
    title: 'Live Garba Band Night with the Mirrorwork Ensemble',
    slug: 'mirrorwork-live-band-night',
    summary:
      'The Mirrorwork Ensemble plays a concert of garba and Gujarati folk songs at Lamplight Expo Hall, with a standing floor and a seated balcony.',
    description: [
      'The band behind Mirrorwork Events’ Navratri nights takes the stage for a concert of its own. The Mirrorwork Ensemble — dhol, tabla, harmonium, shehnai and three singers — plays the garba and folk songs of the season, arranged for listening as well as for dancing.',
      'The floor at Lamplight Expo Hall is standing and open to anyone who wants to dance. The balcony is seated, for anyone who would rather listen.',
      'The concert runs in two halves with an interval. Food and drink are served in the lobby and stay off the dance floor.',
    ].join('\n\n'),
    category: 'MUSIC_CONCERT',
    ...evening(22, EASTERN, 19, 30, 4),
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.mirrorwork,
    venue: VENUES.lamplight,
    currency: 'USD',
    tiers: [
      {
        id: 'ttlivebandfloor',
        name: 'General Admission — Standing Floor',
        description: 'Standing entry to the dance floor.',
        priceCents: 4500,
        quantityTotal: 1500,
        quantitySold: 420,
      },
      {
        id: 'ttlivebandbalcony',
        name: 'Balcony — Reserved Seating',
        description: 'A numbered seat in the balcony.',
        priceCents: 6500,
        quantityTotal: 0,
        quantitySold: 0,
        reserved: true,
      },
    ],
  },
  {
    id: 'evtpacificdandiya',
    title: 'Pacific Dandiya Night',
    slug: 'pacific-dandiya-night',
    summary:
      'A late dandiya night at Cerritos Garden Pavilion with a live band, a garden terrace for breathers and a VIP lounge above the floor.',
    description: [
      'Pacific Dandiya Society’s dandiya night at Cerritos Garden Pavilion starts late and runs later: a live band, long raas lines, and a garden terrace outside for when you need air between rounds.',
      'The first set is garba to warm up. After that it is dandiya until close, with the band calling the changes in pattern so that nobody is left clacking sticks at the wrong moment.',
      'The VIP Lounge overlooks the floor, with seating, its own entrance and chai all night.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(23, PACIFIC, 20, 0, 5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.pacific,
    venue: VENUES.cerritos,
    currency: 'USD',
    tiers: [
      {
        id: 'ttpacificgeneral',
        name: 'General Admission',
        description: 'Entry to the floor and the garden terrace.',
        priceCents: 3800,
        quantityTotal: 1800,
        quantitySold: 610,
      },
      {
        id: 'ttpacificviplounge',
        name: 'VIP Lounge',
        description: 'Lounge seating above the floor, its own entrance and chai all night.',
        priceCents: 11_000,
        quantityTotal: 80,
        quantitySold: 26,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtfiveboroughsmarathon',
    title: 'Five Boroughs Garba Marathon',
    slug: 'five-boroughs-garba-marathon',
    summary:
      'Six hours of garba at Queens Community Arena, with two live bands trading sets so the music never stops.',
    description: [
      'Five Boroughs Garba runs this one as a marathon: six hours at Queens Community Arena, two live bands trading sets so that the music does not stop between them, and a circle that keeps turning from the first aarti to the last.',
      'There are water stations on every side of the floor and a rest area with seating on the upper concourse. Pace yourself; the fastest three-taali rounds are saved for the final hour.',
      'Doors open an hour before the first set, and the wristband you are given at the door lets you out and back in.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'SOLD_OUT',
    ...evening(24, EASTERN, 19, 0, 6),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.fiveBoroughs,
    venue: VENUES.queens,
    currency: 'USD',
    tiers: [
      {
        id: 'ttmarathongeneral',
        name: 'General Admission',
        description: 'Entry for the whole marathon, with re-entry.',
        priceCents: 3000,
        quantityTotal: 2800,
        quantitySold: 2800,
      },
    ],
  },
  {
    id: 'evtgarbaforgood',
    title: 'Garba for Good: Charity Navratri Night',
    slug: 'garba-for-good-philadelphia',
    summary:
      'A Navratri garba night at Delaware River Pavilion raising money for a neighbourhood food pantry, with a live band and a raffle.',
    description: [
      'Garba for Good is Liberty Bell Navratri’s charity night: the same garba and aarti as any other evening at Delaware River Pavilion, with the organiser pledging the evening’s proceeds to a neighbourhood food pantry in Philadelphia.',
      'A live band plays garba and dandiya, volunteers run a snack stall, and a raffle of donated prizes is drawn before the final raas.',
      'Everyone is welcome, whatever their experience; the first round is taught.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    status: 'POSTPONED',
    ...GARBA_FOR_GOOD,
    previousStartsAt: GARBA_FOR_GOOD.startsAt,
    languages: ['English', 'Gujarati'],
    organization: ORGANIZATIONS.libertyBell,
    venue: VENUES.delaware,
    currency: 'USD',
    tiers: [
      {
        id: 'ttgarbaforgoodgeneral',
        name: 'General Admission',
        description: 'Entry for the evening, raffle ticket included.',
        priceCents: 2500,
        quantityTotal: 1000,
        quantitySold: 180,
      },
    ],
  },
  {
    id: 'evtglownightsc',
    title: 'Garba Glow Night (All-White Dress Code)',
    slug: 'garba-glow-night-santa-clara',
    summary:
      'Garba under ultraviolet light at Santa Clara Valley Expo, with an all-white dress code and a live band.',
    description: [
      'For one night Bay Lights Garba Co. turns the lights down and the ultraviolet up at Santa Clara Valley Expo. Come dressed in white and the whole circle glows, from the dandiya sticks to the mirrorwork on your dupatta.',
      'The band plays a full set of garba and dandiya, and the lighting crew changes the colour of the room between rounds. Glow sticks and white dandiya sticks are sold at the merchandise table.',
      'The dress code is a request, not a rule at the door: white or pale clothes glow best, and anything with mirrorwork catches the light.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    status: 'SALES_PAUSED',
    ...evening(25, PACIFIC, 20, 0, 4.5),
    languages: ['English', 'Gujarati'],
    organization: ORGANIZATIONS.bayLights,
    venue: VENUES.santaClara,
    currency: 'USD',
    tiers: [
      {
        id: 'ttglownightgeneral',
        name: 'General Admission',
        description: 'Entry to the floor for the night.',
        priceCents: 4500,
        quantityTotal: 2000,
        quantitySold: 700,
      },
    ],
  },
  {
    id: 'evtnavratrimelaqueens',
    title: 'Navratri Mela & Garba',
    slug: 'navratri-mela-queens',
    summary:
      'A Navratri mela at Queens Community Arena — food stalls, crafts and henna — followed by live garba on the arena floor.',
    description: [
      'The Navratri Mela fills the Queens Community Arena concourse with stalls: Gujarati snacks and chaat, chaniya choli and jewellery sellers, henna artists, and a stall for dandiya sticks. The arena floor opens for garba later in the evening.',
      'Mela Entry covers the stalls and the performances on the concourse stage, including a children’s dance showcase. Mela + Garba adds the arena floor for the live garba that follows.',
      'Stalls are run by independent sellers, who take their own payments.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    ...evening(26, EASTERN, 19, 0, 5.5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.fiveBoroughs,
    venue: VENUES.queens,
    currency: 'USD',
    tiers: [
      {
        id: 'ttmelaentry',
        name: 'Mela Entry',
        description: 'The stalls and the concourse stage.',
        priceCents: 1000,
        quantityTotal: 2000,
        quantitySold: 450,
      },
      {
        id: 'ttmelaandgarba',
        name: 'Mela + Garba',
        description: 'The stalls, the concourse stage and the garba on the arena floor.',
        priceCents: 2800,
        quantityTotal: 2500,
        quantitySold: 830,
      },
    ],
  },
  {
    id: 'evtdussehrafinale',
    title: 'Dussehra Raas Finale',
    slug: 'dussehra-raas-finale-schaumburg',
    summary:
      'Lakeshore Raas closes its Navratri season on Dussehra at Lakeshore Pavilion, with a live band and one last long raas.',
    description: [
      'Dussehra follows Navratri’s ninth night, and Lakeshore Raas uses it to close the season properly: one more evening at Lakeshore Pavilion, one more aarti at the garbo, and a live band playing until the last circle breaks up.',
      'Expect the fast rounds to be very fast. By this point in the season most of the room knows every step, and the band plays like it.',
      'General admission only. The coat check by the main doors is included with every ticket.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(27, CENTRAL, 19, 30, 4.5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.lakeshore,
    venue: VENUES.lakeshore,
    currency: 'USD',
    tiers: [
      {
        id: 'ttdussehrageneral',
        name: 'General Admission',
        description: 'Entry for the night, coat check included.',
        priceCents: 3500,
        quantityTotal: 2600,
        quantitySold: 390,
      },
    ],
  },
  {
    id: 'evtcollegiateshowcase',
    title: 'Raas-Garba Collegiate Showcase',
    slug: 'collegiate-raas-showcase-irving',
    summary:
      'College raas and garba teams from across Texas perform their competition sets at Trinity Convention Hall.',
    description: [
      'Collegiate raas-garba is its own world: student teams, costumes made by hand, and eight-minute sets choreographed to the second. Lone Star Navratri’s showcase brings college teams from across Texas to the Trinity Convention Hall stage.',
      'It is a showcase rather than a competition — no judges and no trophies, just each team’s set performed for an audience that knows what it is watching. Spectator tickets are unreserved seating.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    status: 'CANCELLED',
    ...evening(30, CENTRAL, 19, 0, 3.5),
    languages: ['English', 'Gujarati'],
    organization: ORGANIZATIONS.loneStar,
    venue: VENUES.trinity,
    currency: 'USD',
    tiers: [
      {
        id: 'ttcollegiatespectator',
        name: 'Spectator',
        description: 'Unreserved seating for the showcase.',
        priceCents: 2200,
        quantityTotal: 2000,
        quantitySold: 540,
      },
    ],
  },
  {
    id: 'evtsharadpoonamgarba',
    title: 'Lone Star Navratri: Sharad Poonam Garba',
    slug: 'lone-star-sharad-poonam-garba',
    summary:
      'Garba on the night of the Sharad Poonam full moon at Trinity Convention Hall in Irving, closing with doodh-pauva for everyone.',
    description: [
      'Sharad Poonam, the full moon that follows Navratri, is traditionally a night for one more garba. Lone Star Navratri marks it at Trinity Convention Hall with a live band and the courtyard doors open, so that the moon is part of the evening.',
      'The music leans traditional — slow garba, two-taali and three-taali, and a long raas to finish. Near midnight the organisers serve doodh-pauva, the sweetened milk and flattened rice eaten on Sharad Poonam, to everyone in the hall.',
      'One ticket type, general admission, for the whole evening.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    ...evening(33, CENTRAL, 19, 30, 4.5),
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.loneStar,
    venue: VENUES.trinity,
    currency: 'USD',
    tiers: [
      {
        id: 'ttsharadpoonamgeneral',
        name: 'General Admission',
        description: 'Entry for the evening, doodh-pauva included.',
        priceCents: 2800,
        quantityTotal: 3000,
        quantitySold: 410,
      },
    ],
  },
]

/**
 * The fallback catalogue: twenty events with venue, organiser and ticket tiers
 * attached, in start-date order.
 *
 * Every one of them resolves at its own URL, as a postponed, cancelled or
 * finished event does on the live site. Not every one of them is *listed*: see
 * {@link sampleEventSummaries}.
 *
 * @type {ReadonlyArray<object>}
 */
export const SAMPLE_EVENTS = Object.freeze(
  EVENT_DEFINITIONS.map(toEvent).sort(
    (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
  ),
)

/**
 * What one ticket of the cheapest tier costs all in, as the live summary
 * computes it: face value, the platform fee and the tax of the venue's
 * jurisdiction, from the same pricing package checkout charges with.
 *
 * @param {object} event An event carrying `venue` and `feeTerms`.
 * @param {object|null} cheapest The tier the "from" price is taken from.
 * @returns {number|null} Integer cents, or null when nothing is priced.
 */
function minimumTotal(event, cheapest) {
  if (!cheapest) return null

  return priceSelection({
    lines: [
      {
        ticketTypeId: cheapest.id,
        name: cheapest.name,
        quantity: 1,
        unitPriceCents: cheapest.priceCents,
      },
    ],
    currency: cheapest.currency,
    place: { country: event.venue?.country, region: event.venue?.region },
    feeTerms: event.feeTerms ?? null,
  }).totalCents
}

/**
 * Reduce a full event to the lean summary shape a listing card needs.
 *
 * The denormalised fields (`city`, `venueName`, `minPriceCents`, `soldOut`,
 * `salesOpen`, `minTotalCents`) are exactly the ones the live list endpoint
 * computes server-side, so a card written against this shape works unchanged
 * against the API. Seated tiers are left out of the stock questions, as they
 * are on the server: their stock is their seats, which a listing does not load.
 *
 * @param {object} event An event with `venue`, `organization` and `ticketTypes` attached.
 * @returns {object} A summary matching `eventSummarySchema`.
 */
export function toEventSummary(event) {
  const tiers = event.ticketTypes ?? []
  const counted = tiers.filter((tier) => !tier.reserved)
  const onSale = counted.filter((tier) => !tier.isSoldOut && tier.status === 'ON_SALE')
  const priced = onSale.length > 0 ? onSale : tiers
  const minPriceCents =
    priced.length > 0 ? Math.min(...priced.map((tier) => tier.priceCents)) : null
  const cheapest = priced.find((tier) => tier.priceCents === minPriceCents) ?? null

  return {
    id: event.id,
    organizationId: event.organizationId,
    title: event.title,
    slug: event.slug,
    summary: event.summary,
    category: event.category,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    coverImageUrl: event.coverImageUrl ?? null,
    isOnline: event.isOnline ?? false,
    city: event.venue?.city ?? null,
    venueName: event.venue?.name ?? null,
    organizationName: event.organization?.name ?? null,
    organizationSlug: event.organization?.slug ?? null,
    venueSlug: event.venue?.slug ?? null,
    minPriceCents,
    // Only with published fee terms, as on the server: a summary built without
    // the deployment's terms carries the face value alone and says so.
    ...(event.feeTerms && cheapest ? { minTotalCents: minimumTotal(event, cheapest) } : {}),
    currency: priced[0]?.currency ?? null,
    soldOut: counted.length > 0 && onSale.length === 0,
    // What the live summary computes from the status and the sales windows.
    // The sample tiers have no windows, so a bookable event with a tier on
    // sale and seats left is on sale; a paused, postponed or cancelled one is
    // not, whatever its tiers say.
    ...(counted.length > 0
      ? { salesOpen: BOOKABLE_STATUSES.has(event.status) && onSale.length > 0 }
      : {}),
  }
}

/**
 * Whether the API would list an event: its status is one the public listing
 * carries. A postponed, cancelled or finished event still has a page, and is
 * still on its organiser's page, but is not in "what is on".
 *
 * @param {object} event A sample event.
 * @returns {boolean} True when a listing shows it.
 */
function isListed(event) {
  return INDEXABLE_STATUSES.has(event.status)
}

/**
 * The fallback catalogue as listing summaries: the events the API would list.
 *
 * @returns {object[]} One summary per listed sample event, in start-date order.
 */
export function sampleEventSummaries() {
  return SAMPLE_EVENTS.filter(isListed).map(toEventSummary)
}

/**
 * Look a sample event up by its slug.
 *
 * Any status resolves, as it does on the live site: somebody holding a ticket
 * for a cancelled night needs its page to say so.
 *
 * @param {string} slug Event slug, e.g. `navratri-night-one-edison`.
 * @returns {object|null} The matching event with relations, or `null`.
 */
export function findSampleEvent(slug) {
  if (typeof slug !== 'string') return null

  return SAMPLE_EVENTS.find((event) => event.slug === slug) ?? null
}

/**
 * Look a sample venue up by slug, with what is on there.
 *
 * Exists for the same reason `findSampleOrganizer` does: a venue link on a
 * fallback-rendered event page has to lead somewhere, and the site being
 * internally consistent matters most exactly when the API is down. Lists what
 * the live venue page lists — upcoming events in a listed status.
 *
 * @param {string} slug Venue slug, e.g. `lamplight-expo-hall`.
 * @returns {object|null} A payload matching `publicVenueSchema`, or `null`.
 */
export function findSampleVenue(slug) {
  if (typeof slug !== 'string') return null

  const found = Object.values(VENUES).find((candidate) => candidate.slug === slug)

  if (!found) return null

  const now = Date.now()

  return {
    id: found.id,
    slug: found.slug,
    name: found.name,
    addressLine1: found.addressLine1,
    addressLine2: found.addressLine2 ?? null,
    city: found.city,
    region: found.region,
    postalCode: found.postalCode,
    country: found.country,
    latitude: found.latitude ?? null,
    longitude: found.longitude ?? null,
    capacity: found.capacity ?? null,
    timezone: found.timezone,
    shared: true,
    mergedIntoVenueId: null,
    canonicalSlug: null,
    accessibility: found.accessibility ?? null,
    description: found.description ?? null,
    directions: found.directions ?? null,
    policies: found.policies ?? null,
    provenance: found.provenance ?? null,
    upcomingEvents: SAMPLE_EVENTS.filter(
      (event) => event.venueId === found.id && isListed(event) && Date.parse(event.startsAt) >= now,
    )
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .map((event) => ({
        slug: event.slug,
        title: event.title,
        startsAt: event.startsAt,
        organizerName: event.organization?.name ?? null,
      })),
  }
}

/**
 * Look a sample organiser up by slug, with their events split around now.
 *
 * Exists so that an organiser link on a fallback-rendered event page leads
 * somewhere. Without it, the site would be internally inconsistent exactly when
 * the API is down — which is when consistency is the only thing holding the
 * page together.
 *
 * The split mirrors the live organiser page: upcoming events in a listed
 * status, and past events in a listed status or finished — a track record is
 * the reason somebody reads an organiser's page.
 *
 * @param {string} slug Organiser slug, e.g. `mirrorwork-events`.
 * @returns {object|null} A payload matching `publicOrganizerSchema`, or `null`.
 */
export function findSampleOrganizer(slug) {
  if (typeof slug !== 'string') return null

  const organization = Object.values(ORGANIZATIONS).find((candidate) => candidate.slug === slug)

  if (!organization) return null

  const listed = SAMPLE_EVENTS.filter((event) => event.organizationId === organization.id)
  const now = Date.now()

  /**
   * One event as the organiser page lists it.
   *
   * @param {object} event A sample event.
   * @returns {object} The listing entry.
   */
  const entry = (event) => ({
    slug: event.slug,
    title: event.title,
    startsAt: event.startsAt,
    venueName: event.venue?.name ?? null,
  })

  return {
    slug: organization.slug,
    name: organization.name,
    description: organization.description ?? null,
    websiteUrl: organization.websiteUrl ?? null,
    verified: isBadged(organization),
    refundPolicy: organization.refundPolicy ?? null,
    timezone: organization.timezone,
    upcomingEvents: listed
      .filter((event) => isListed(event) && Date.parse(event.startsAt) >= now)
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .map(entry),
    pastEvents: listed
      .filter(
        (event) =>
          (isListed(event) || event.status === 'COMPLETED') && Date.parse(event.startsAt) < now,
      )
      .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))
      .map(entry),
  }
}

/**
 * Every city the fallback catalogue lists an event in, alphabetically.
 *
 * @returns {string[]} Unique city names.
 */
export function sampleCities() {
  const cities = new Set(
    sampleEventSummaries()
      .map((event) => event.city)
      .filter(Boolean),
  )

  return [...cities].sort((a, b) => a.localeCompare(b))
}
