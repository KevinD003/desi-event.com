/**
 * The curated catalogue the site falls back to when the API cannot be reached.
 *
 * This is not filler. The API is a separate process that is routinely down
 * during `next build`, during unit tests and on a fresh clone, and a ticketing
 * site that renders an empty grid in those moments looks broken rather than
 * offline. So the web app ships a small, real-looking catalogue — ten events
 * across Mumbai, Ahmedabad, Toronto and London, priced in the minor units of
 * their own currency — and renders that instead of an error.
 *
 * Shapes here match `eventWithRelationsSchema` and `ticketTypeListResponseSchema`
 * from `@desi-event/schemas` so that a component cannot tell the difference
 * between a sample event and a live one.
 *
 * Dates are generated relative to process start rather than hard-coded, so the
 * fallback catalogue never rots into a listing of events that happened last
 * year. They are computed once at module load, which keeps a single server
 * render internally consistent.
 *
 * @module lib/sample-data
 */

/** Instant the relative dates below are measured from, fixed for the process. */
const BASE_TIME = Date.now()

/** Milliseconds in a day. */
const DAY_MS = 86_400_000

/**
 * Build an ISO-8601 timestamp a whole number of days from process start.
 *
 * @param {number} days Offset in days; may be negative for a past event.
 * @param {number} [utcHour] Hour of day in UTC.
 * @param {number} [utcMinute] Minute of the hour in UTC.
 * @returns {string} A UTC ISO-8601 timestamp.
 */
function daysFromNow(days, utcHour = 12, utcMinute = 0) {
  const date = new Date(BASE_TIME + days * DAY_MS)
  date.setUTCHours(utcHour, utcMinute, 0, 0)

  return date.toISOString()
}

/** Organisations that appear in the fallback catalogue. */
const ORGANIZATIONS = {
  rangmanch: {
    id: 'orgrangmanchmumbai',
    name: 'Rangmanch Collective',
    slug: 'rangmanch-collective',
    description: 'Independent promoters putting South Asian artists on Bombay stages since 2011.',
    contactEmail: 'hello@rangmanch.example',
    websiteUrl: 'https://rangmanch.example',
    verified: true,
    payoutCurrency: 'INR',
    verificationStatus: 'VERIFIED',
    timezone: 'Asia/Kolkata',
    refundPolicy:
      'Full refund up to seven days before the performance; no refunds after that, but tickets may be transferred.',
  },
  navrang: {
    id: 'orgnavrangutsav',
    name: 'Navrang Utsav Samiti',
    slug: 'navrang-utsav-samiti',
    description: 'The Ahmedabad garba committee behind nine nights of raas since 1987.',
    contactEmail: 'samiti@navrangutsav.example',
    websiteUrl: 'https://navrangutsav.example',
    verified: true,
    payoutCurrency: 'INR',
    verificationStatus: 'VERIFIED',
    timezone: 'Asia/Kolkata',
    refundPolicy:
      'Passes are non-refundable once the first night has begun. Before that, a full refund less the payment fee.',
  },
  desiBeats: {
    id: 'orgdesibeatsto',
    name: 'Desi Beats Toronto',
    slug: 'desi-beats-toronto',
    description: 'GTA nightlife for the diaspora — bhangra, Bollywood and everything in between.',
    contactEmail: 'crew@desibeats.example',
    websiteUrl: 'https://desibeats.example',
    verified: true,
    payoutCurrency: 'CAD',
    verificationStatus: 'VERIFIED',
    timezone: 'America/Toronto',
    refundPolicy:
      'Refunds up to 72 hours before doors. After that the ticket is yours to transfer.',
  },
  masala: {
    id: 'orgmasalaartsldn',
    name: 'Masala Arts London',
    slug: 'masala-arts-london',
    description: 'A Whitechapel arts charity programming South Asian theatre, comedy and film.',
    contactEmail: 'box.office@masalaarts.example',
    websiteUrl: 'https://masalaarts.example',
    verified: false,
    payoutCurrency: 'GBP',
    verificationStatus: 'UNVERIFIED',
    timezone: 'Europe/London',
    refundPolicy:
      'Refunds up to 24 hours before curtain, or an exchange into any other show in the season.',
  },
  swarSadhana: {
    id: 'orgswarsadhana',
    name: 'Swar Sadhana Trust',
    slug: 'swar-sadhana-trust',
    description:
      'Custodians of Hindustani and Carnatic repertoire, and of the artists who carry it.',
    contactEmail: 'trust@swarsadhana.example',
    websiteUrl: 'https://swarsadhana.example',
    verified: true,
    payoutCurrency: 'INR',
    verificationStatus: 'VERIFIED',
    timezone: 'Asia/Kolkata',
    refundPolicy:
      'A full refund at any point up to the interval of the first half, in keeping with a long-standing practice of the trust.',
  },
}

/** Venues that appear in the fallback catalogue. */
const VENUES = {
  jioGarden: {
    id: 'vnujioworldmumbai',
    name: 'Jio World Garden',
    addressLine1: 'Bandra Kurla Complex',
    addressLine2: 'G Block, BKC',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400051',
    country: 'IN',
    latitude: 19.0653,
    longitude: 72.8676,
    capacity: 6000,
  },
  nehruCentre: {
    id: 'vnunehrucentremum',
    name: 'Nehru Centre Auditorium',
    addressLine1: 'Dr Annie Besant Road',
    addressLine2: 'Worli',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400018',
    country: 'IN',
    latitude: 18.9949,
    longitude: 72.8203,
    capacity: 1100,
  },
  gmdcGround: {
    id: 'vnugmdcahmedabad',
    name: 'GMDC Ground',
    addressLine1: 'University Road',
    addressLine2: 'Gujarat University Campus',
    city: 'Ahmedabad',
    region: 'Gujarat',
    postalCode: '380009',
    country: 'IN',
    latitude: 23.0367,
    longitude: 72.5455,
    capacity: 20000,
  },
  tagoreHall: {
    id: 'vnutagoreahmedabad',
    name: 'Tagore Hall',
    addressLine1: 'Sanskar Kendra Road',
    addressLine2: 'Paldi',
    city: 'Ahmedabad',
    region: 'Gujarat',
    postalCode: '380007',
    country: 'IN',
    latitude: 23.0159,
    longitude: 72.5652,
    capacity: 700,
  },
  meridianHall: {
    id: 'vnumeridiantoronto',
    name: 'Meridian Hall',
    addressLine1: '1 Front Street East',
    addressLine2: null,
    city: 'Toronto',
    region: 'Ontario',
    postalCode: 'M5E 1B2',
    country: 'CA',
    latitude: 43.6462,
    longitude: -79.3755,
    capacity: 3191,
  },
  celebrationSquare: {
    id: 'vnucelebrationsqto',
    name: 'Mississauga Celebration Square',
    addressLine1: '300 City Centre Drive',
    addressLine2: null,
    city: 'Toronto',
    region: 'Ontario',
    postalCode: 'L5B 3C1',
    country: 'CA',
    latitude: 43.5931,
    longitude: -79.6444,
    capacity: 12000,
  },
  troxy: {
    id: 'vnutroxylondon',
    name: 'Troxy',
    addressLine1: '490 Commercial Road',
    addressLine2: 'Limehouse',
    city: 'London',
    region: 'Greater London',
    postalCode: 'E1 0HX',
    country: 'GB',
    latitude: 51.5133,
    longitude: -0.0377,
    capacity: 3100,
  },
  southbank: {
    id: 'vnusouthbanklondon',
    name: 'Southbank Centre, Queen Elizabeth Hall',
    addressLine1: 'Belvedere Road',
    addressLine2: 'South Bank',
    city: 'London',
    region: 'Greater London',
    postalCode: 'SE1 8XX',
    country: 'GB',
    latitude: 51.5062,
    longitude: -0.1161,
    capacity: 900,
  },
}

/**
 * Expand a compact ticket tier definition into a full ticket type record.
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
  const soldOutStatus = availableQuantity === 0 ? 'SOLD_OUT' : (tier.status ?? 'ON_SALE')

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
    status: soldOutStatus,
    sortOrder: index,
    availableQuantity: soldOutStatus === 'ON_SALE' ? availableQuantity : 0,
    isSoldOut: soldOutStatus !== 'ON_SALE',
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
  const { organization, venue, currency, tiers, ...event } = definition

  return {
    ...event,
    organizationId: organization.id,
    venueId: venue.id,
    status: 'PUBLISHED',
    coverImageUrl: null,
    isOnline: false,
    onlineUrl: null,
    publishedAt: daysFromNow(-42, 9, 0),
    organization: toPublicOrganizer(organization),
    venue,
    ticketTypes: tiers.map((tier, index) => toTicketType(event.id, currency, tier, index)),
  }
}

/** Compact definitions, expanded below. Ordered by start date. */
const EVENT_DEFINITIONS = [
  {
    id: 'evtnavratrirasgarba',
    title: 'Navratri Raas Garba — Nine Nights',
    slug: 'navratri-raas-garba-nine-nights',
    summary:
      'Nine nights of traditional raas and dandiya on the GMDC ground, with a live dhol ensemble and a sixty-piece orchestra.',
    description: [
      'Ahmedabad does not do Navratri by halves. From the first beat of the dhol at sundown to the last taali well past two in the morning, the GMDC ground turns into a single circle of colour that keeps widening as the night goes on.',
      'The Navrang Utsav Samiti has run these nights since 1987. The orchestra is live — no backing tracks, no DJ sets — and the repertoire moves from slow sanedo through do taali, teen taali and into the fast dodhiya that separates the serious players from the rest of us.',
      'Come in chaniya choli or kediyu if you have it, comfortable shoes if you do not. Water and chaas are free at the eastern gate. Garba lessons run each evening from 7 pm for anyone joining their first night.',
    ].join('\n\n'),
    category: 'GARBA_DANDIYA',
    startsAt: daysFromNow(27, 13, 30),
    endsAt: daysFromNow(27, 20, 30),
    timezone: 'Asia/Kolkata',
    languages: ['Gujarati', 'Hindi'],
    organization: ORGANIZATIONS.navrang,
    venue: VENUES.gmdcGround,
    currency: 'INR',
    tiers: [
      {
        id: 'ttngarbaseasonpass',
        name: 'Season Pass — All Nine Nights',
        description: 'One wristband, every night, plus priority entry at the west gate.',
        priceCents: 899_900,
        quantityTotal: 1200,
        quantitySold: 1147,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
      {
        id: 'ttngarbacouplenite',
        name: 'Couple Entry — Single Night',
        description: 'Admits two. Choose your night at the gate.',
        priceCents: 249_900,
        quantityTotal: 4000,
        quantitySold: 2610,
        minPerOrder: 1,
        maxPerOrder: 5,
      },
      {
        id: 'ttngarbasinglenite',
        name: 'Single Night Entry',
        description: 'General admission to the main circle.',
        priceCents: 149_900,
        quantityTotal: 9000,
        quantitySold: 5120,
        minPerOrder: 1,
        maxPerOrder: 10,
      },
    ],
  },
  {
    id: 'evtqawwalibanyan',
    title: 'Qawwali Under the Banyan',
    slug: 'qawwali-under-the-banyan',
    summary:
      'An open-air evening of Sufi qawwali in Bandra Kurla Complex, with the Nizami brothers closing on Chhaap Tilak.',
    description: [
      'A qawwali does not really start until the audience decides it has. This one begins at dusk in the Jio World Garden, on a low stage under the old banyan, with the harmonium finding its drone while the city traffic is still audible over the wall.',
      'Three ensembles share the night. The Warsi brothers open with Amir Khusrau in Braj and Persian; the Rizwan-Muazzam party take the middle set; and the Nizamis close, as they always do, with Chhaap Tilak — at which point nobody is sitting down.',
      'Floor cushions and low seating throughout. The chai stall by the north gate stays open until the last note.',
    ].join('\n\n'),
    category: 'MUSIC_CONCERT',
    startsAt: daysFromNow(12, 13, 0),
    endsAt: daysFromNow(12, 17, 30),
    timezone: 'Asia/Kolkata',
    languages: ['Urdu', 'Hindi', 'Punjabi'],
    organization: ORGANIZATIONS.rangmanch,
    venue: VENUES.jioGarden,
    currency: 'INR',
    tiers: [
      {
        id: 'ttqawwalimehfil',
        name: 'Mehfil Floor — Front Cushions',
        description: 'Cushioned floor seating within ten feet of the ensemble.',
        priceCents: 449_900,
        quantityTotal: 180,
        quantitySold: 180,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
      {
        id: 'ttqawwaligarden',
        name: 'Garden Seating',
        description: 'Reserved chairs on the lawn, with table service for chai.',
        priceCents: 249_900,
        quantityTotal: 900,
        quantitySold: 612,
        minPerOrder: 1,
        maxPerOrder: 6,
      },
      {
        id: 'ttqawwalilawn',
        name: 'Lawn Entry',
        description: 'Unreserved standing and picnic-rug space at the back of the garden.',
        priceCents: 99_900,
        quantityTotal: 2400,
        quantitySold: 1380,
        minPerOrder: 1,
        maxPerOrder: 10,
      },
    ],
  },
  {
    id: 'evtbollywoodretroto',
    title: 'Bollywood Nights: Retro Rewind',
    slug: 'bollywood-nights-retro-rewind',
    summary:
      'Four decades of filmi floor-fillers at Meridian Hall — RD Burman to Pritam, mixed live across two rooms.',
    description: [
      'Downtown Toronto, one room of disco-era RD Burman and Bappi Lahiri, one room of everything after Dil Chahta Hai, and a corridor between them that becomes its own dance floor by midnight.',
      'DJ Rekha Sandhu opens the retro room at nine. The bhangra room runs a live dhol player alongside the decks from eleven. Expect Jimmy Jimmy, expect Choli Ke Peeche, and expect the entire room to know every word of Kajra Re.',
      'Nineteen-plus with valid photo ID. Coat check is included in the ticket — it is November, and you will want it.',
    ].join('\n\n'),
    category: 'BOLLYWOOD_NIGHT',
    startsAt: daysFromNow(19, 1, 0),
    endsAt: daysFromNow(19, 7, 0),
    timezone: 'America/Toronto',
    languages: ['English', 'Hindi', 'Punjabi'],
    organization: ORGANIZATIONS.desiBeats,
    venue: VENUES.meridianHall,
    currency: 'CAD',
    tiers: [
      {
        id: 'ttbollyvipbooth',
        name: 'VIP Booth (seats 6)',
        description: 'Raised booth overlooking the retro floor, bottle service included.',
        priceCents: 60_000,
        quantityTotal: 24,
        quantitySold: 21,
        minPerOrder: 1,
        maxPerOrder: 2,
      },
      {
        id: 'ttbollyearlybird',
        name: 'Early Bird',
        description: 'Entry before 10 pm, coat check included.',
        priceCents: 3500,
        quantityTotal: 600,
        quantitySold: 600,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
      {
        id: 'ttbollygeneraladm',
        name: 'General Admission',
        description: 'Entry any time, both rooms, coat check included.',
        priceCents: 5500,
        quantityTotal: 1800,
        quantitySold: 940,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
    ],
  },
  {
    id: 'evtchaatchaifest',
    title: 'Chaat & Chai Street Food Festival',
    slug: 'chaat-and-chai-street-food-festival',
    summary:
      'Forty stalls along the Southbank serving everything from Amritsari kulcha to Sri Lankan kottu, plus a cutting-chai bar.',
    description: [
      'A weekend of South Asian street food on the Thames, from the Queen Elizabeth Hall terrace down to the skate park. Forty stalls, eleven regions, one very long queue for the Amritsari kulcha which is, we are told, worth it.',
      'The cutting-chai bar pours masala, Irani, Kashmiri noon chai and a Sri Lankan plain tea, and the stall holders will happily argue with you about which is best. Live dhol at noon and at four. The Bengali sweet stall sells out of nolen gur sandesh by two, every single day.',
      'Entry covers both days. Most stalls are cash-free. Vegetarian, vegan, halal and Jain options are labelled at every counter.',
    ].join('\n\n'),
    category: 'FOOD_FESTIVAL',
    startsAt: daysFromNow(34, 10, 0),
    endsAt: daysFromNow(35, 19, 0),
    timezone: 'Europe/London',
    languages: ['English', 'Bengali', 'Tamil'],
    organization: ORGANIZATIONS.masala,
    venue: VENUES.southbank,
    currency: 'GBP',
    tiers: [
      {
        id: 'ttchaatfeastpass',
        name: 'Feast Pass',
        description: 'Weekend entry plus eight tasting tokens and a festival thali plate.',
        priceCents: 4500,
        quantityTotal: 900,
        quantitySold: 407,
        minPerOrder: 1,
        maxPerOrder: 6,
      },
      {
        id: 'ttchaatweekendadm',
        name: 'Weekend Entry',
        description: 'Both days, pay as you go at the stalls.',
        priceCents: 1200,
        quantityTotal: 6000,
        quantitySold: 2211,
        minPerOrder: 1,
        maxPerOrder: 10,
      },
      {
        id: 'ttchaatunderfive',
        name: 'Under 12s',
        description: 'Free entry, still needs a ticket so we can count the queue.',
        priceCents: 0,
        quantityTotal: 2000,
        quantitySold: 640,
        minPerOrder: 1,
        maxPerOrder: 6,
      },
    ],
  },
  {
    id: 'evtmargambharatnat',
    title: 'Margam — An Evening of Bharatanatyam',
    slug: 'margam-an-evening-of-bharatanatyam',
    summary:
      'A full traditional margam performed by Meenakshi Sundaram at the Nehru Centre, with live mridangam and nattuvangam.',
    description: [
      'The margam is the complete arc of a Bharatanatyam recital: alarippu to open, then jatiswaram, shabdam, the long varnam at its centre, padams and javalis, and a tillana to close. Performed whole, it runs close to two hours and asks as much of the audience as of the dancer.',
      'Meenakshi Sundaram trained at Kalakshetra and has not performed in Bombay for four years. She is accompanied by live mridangam, violin, flute and nattuvangam — no recorded track at any point in the evening.',
      'A twenty-minute introduction to the form runs at 5.40 pm in the foyer for anyone new to it. Latecomers are seated only between items.',
    ].join('\n\n'),
    category: 'CLASSICAL_DANCE',
    startsAt: daysFromNow(9, 12, 30),
    endsAt: daysFromNow(9, 15, 0),
    timezone: 'Asia/Kolkata',
    languages: ['Tamil', 'English'],
    organization: ORGANIZATIONS.swarSadhana,
    venue: VENUES.nehruCentre,
    currency: 'INR',
    tiers: [
      {
        id: 'ttmargampatron',
        name: 'Patron Circle',
        description: 'First six rows, programme notes and a post-show reception with the artist.',
        priceCents: 350_000,
        quantityTotal: 120,
        quantitySold: 89,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
      {
        id: 'ttmargamstalls',
        name: 'Stalls',
        description: 'Reserved seating in the main auditorium.',
        priceCents: 150_000,
        quantityTotal: 620,
        quantitySold: 318,
        minPerOrder: 1,
        maxPerOrder: 6,
      },
      {
        id: 'ttmargamstudent',
        name: 'Student & Senior',
        description: 'Balcony seating. Bring ID to the door.',
        priceCents: 40_000,
        quantityTotal: 260,
        quantitySold: 204,
        minPerOrder: 1,
        maxPerOrder: 2,
      },
    ],
  },
  {
    id: 'evtdesicomedyldn',
    title: 'Desi Comedy Uncensored',
    slug: 'desi-comedy-uncensored',
    summary:
      'Five comics, one Limehouse stage, and absolutely no material about arranged marriage. Probably.',
    description: [
      'A stand-up night built around British-Asian comics who are tired of doing the same five jokes about their mothers. The rule for the bill is simple: no aunty material, no mispronunciation bits, no accents-for-laughs.',
      'Headlining is Aisha Rahman, fresh off a sold-out Edinburgh run, with support from four comics on the London circuit and one open spot chosen from submissions the week before.',
      'Strong language throughout and an unapologetic amount of material about the Home Office. Eighteen plus. Doors seven, show eight.',
    ].join('\n\n'),
    category: 'COMEDY',
    startsAt: daysFromNow(16, 19, 0),
    endsAt: daysFromNow(16, 22, 0),
    timezone: 'Europe/London',
    languages: ['English'],
    organization: ORGANIZATIONS.masala,
    venue: VENUES.troxy,
    currency: 'GBP',
    tiers: [
      {
        id: 'ttcomedyfronttable',
        name: 'Front Table (seats 4)',
        description: 'Close enough to be part of the show. You have been warned.',
        priceCents: 9600,
        quantityTotal: 30,
        quantitySold: 27,
        minPerOrder: 1,
        maxPerOrder: 2,
      },
      {
        id: 'ttcomedystandard',
        name: 'Standard Seated',
        description: 'Reserved seating in the stalls.',
        priceCents: 2800,
        quantityTotal: 800,
        quantitySold: 512,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
    ],
  },
  {
    id: 'evtdiwalimelato',
    title: 'Diwali Mela on the Square',
    slug: 'diwali-mela-on-the-square',
    summary:
      'A free-to-roam Diwali mela in Mississauga with a rangoli competition, a night bazaar and a drone light show at nine.',
    description: [
      'Celebration Square becomes a mela for one weekend: a night bazaar of forty vendors, a rangoli competition open to anyone who turns up with chalk, a kids’ diya-painting tent, and food trucks from Malton to Markham.',
      'The main stage runs continuously from two in the afternoon — bhangra teams, a garba hour, a Tamil isai set and a closing Bollywood medley. At nine the lights go down for a three-hundred-drone show over the square, which is the reason half the crowd comes.',
      'The square itself is free. A Mela Pass gets you a reserved seat at the main stage, early entry to the bazaar and a voucher book for the food trucks.',
    ].join('\n\n'),
    category: 'CULTURAL_FESTIVAL',
    startsAt: daysFromNow(44, 18, 0),
    endsAt: daysFromNow(45, 4, 0),
    timezone: 'America/Toronto',
    languages: ['English', 'Hindi', 'Punjabi', 'Tamil'],
    organization: ORGANIZATIONS.desiBeats,
    venue: VENUES.celebrationSquare,
    currency: 'CAD',
    tiers: [
      {
        id: 'ttdiwalimelapass',
        name: 'Mela Pass',
        description:
          'Reserved main-stage seating, early bazaar entry and a food-truck voucher book.',
        priceCents: 4000,
        quantityTotal: 1500,
        quantitySold: 388,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
      {
        id: 'ttdiwalifamilypass',
        name: 'Family Mela Pass (2 adults, 3 children)',
        description: 'Everything in the Mela Pass, for a household.',
        priceCents: 12_000,
        quantityTotal: 500,
        quantitySold: 141,
        minPerOrder: 1,
        maxPerOrder: 3,
      },
      {
        id: 'ttdiwalisquareentry',
        name: 'Square Entry',
        description: 'Free general admission. Ticketed so we can manage the gates.',
        priceCents: 0,
        quantityTotal: 9000,
        quantitySold: 4210,
        minPerOrder: 1,
        maxPerOrder: 10,
      },
    ],
  },
  {
    id: 'evtgarbabootcampmum',
    title: 'Garba Bootcamp — Learn It In a Weekend',
    slug: 'garba-bootcamp-learn-it-in-a-weekend',
    summary:
      'Two afternoons, four steps, zero prior experience assumed. Walk out able to hold your own in any circle.',
    description: [
      'Every year the same thing happens: you get dragged to a garba night, you spend forty minutes half a beat behind everybody else, and you go home having learned nothing. This is the fix.',
      'Two afternoons, capped at forty people. Saturday covers do taali and teen taali and how to read the circle so you are not the person going the wrong way. Sunday adds sanedo, hinch and the hand pattern for dodhiya, then runs the whole thing at speed with live dhol.',
      'No partner needed, no experience needed, no particular level of fitness needed. Wear something you can turn in.',
    ].join('\n\n'),
    category: 'WORKSHOP',
    startsAt: daysFromNow(6, 9, 30),
    endsAt: daysFromNow(7, 12, 30),
    timezone: 'Asia/Kolkata',
    languages: ['Gujarati', 'Hindi', 'English'],
    organization: ORGANIZATIONS.rangmanch,
    venue: VENUES.nehruCentre,
    currency: 'INR',
    tiers: [
      {
        id: 'ttbootcampboth',
        name: 'Both Afternoons',
        description: 'Saturday and Sunday, including the live-dhol run-through.',
        priceCents: 180_000,
        quantityTotal: 40,
        quantitySold: 31,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
      {
        id: 'ttbootcampsatonly',
        name: 'Saturday Only',
        description: 'The two taali patterns and circle etiquette.',
        priceCents: 110_000,
        quantityTotal: 15,
        quantitySold: 15,
        minPerOrder: 1,
        maxPerOrder: 2,
      },
    ],
  },
  {
    id: 'evtrayretroldn',
    title: 'Ray Retrospective — The Apu Trilogy',
    slug: 'ray-retrospective-the-apu-trilogy',
    summary:
      'All three Apu films in 4K restoration across one Saturday, with an introduction from film historian Nasreen Munni Kabir.',
    description: [
      'Pather Panchali, Aparajito and Apur Sansar, screened in order across a single day in new 4K restorations struck from the recovered negatives. Roughly six hours of film, two long breaks, and a Bengali lunch served between the first and second.',
      'Nasreen Munni Kabir introduces the day and returns between films to talk about Ravi Shankar’s score, Subrata Mitra’s bounce lighting, and what the trilogy did to Indian cinema after 1955.',
      'Bengali with English subtitles. Ticket includes lunch and unlimited cha. This one sells out; the last time we ran it, it went in four days.',
    ].join('\n\n'),
    category: 'FILM_SCREENING',
    startsAt: daysFromNow(23, 9, 0),
    endsAt: daysFromNow(23, 20, 0),
    timezone: 'Europe/London',
    languages: ['Bengali', 'English'],
    organization: ORGANIZATIONS.masala,
    venue: VENUES.southbank,
    currency: 'GBP',
    tiers: [
      {
        id: 'ttraytrilogyday',
        name: 'Full Day — All Three Films',
        description: 'All three screenings, the introductions, lunch and cha.',
        priceCents: 4200,
        quantityTotal: 380,
        quantitySold: 292,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
      {
        id: 'ttraysinglefilm',
        name: 'Single Film',
        description: 'One screening of your choice, chosen at the box office.',
        priceCents: 1800,
        quantityTotal: 200,
        quantitySold: 96,
        minPerOrder: 1,
        maxPerOrder: 4,
      },
    ],
  },
  {
    id: 'evtgujaratinatak',
    title: 'Ekla Cholo — A Gujarati Natak',
    slug: 'ekla-cholo-a-gujarati-natak',
    summary:
      'A new two-act play about a Kutchi family splitting an ancestral house, staged at Tagore Hall with English surtitles.',
    description: [
      'Three siblings come back to Bhuj to divide a house none of them has lived in for twenty years. What starts as an argument about a property deed turns into an argument about who stayed, who left, and what either of those was worth.',
      'Written by Hiral Mehta and directed by Paresh Doshi, Ekla Cholo ran for six months in Mumbai before this Ahmedabad transfer. The cast of four play eleven characters across forty years.',
      'Performed in Gujarati with English surtitles. Two acts, one interval, and — according to every review so far — a last ten minutes that nobody sees coming.',
    ].join('\n\n'),
    category: 'THEATRE',
    startsAt: daysFromNow(30, 13, 45),
    endsAt: daysFromNow(30, 16, 15),
    timezone: 'Asia/Kolkata',
    languages: ['Gujarati', 'English'],
    organization: ORGANIZATIONS.navrang,
    venue: VENUES.tagoreHall,
    currency: 'INR',
    tiers: [
      {
        id: 'tteklastallsfront',
        name: 'Stalls — Rows A to H',
        description: 'Best sightlines for the surtitle screen.',
        priceCents: 120_000,
        quantityTotal: 240,
        quantitySold: 166,
        minPerOrder: 1,
        maxPerOrder: 6,
      },
      {
        id: 'tteklastallsrear',
        name: 'Stalls — Rows J onward',
        description: 'Reserved seating towards the back of the hall.',
        priceCents: 70_000,
        quantityTotal: 300,
        quantitySold: 121,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
      {
        id: 'tteklabalcony',
        name: 'Balcony',
        description: 'Unreserved balcony seating.',
        priceCents: 35_000,
        quantityTotal: 160,
        quantitySold: 58,
        minPerOrder: 1,
        maxPerOrder: 8,
      },
    ],
  },
]

/**
 * The fallback catalogue: ten published events with venue, organiser and
 * ticket tiers attached.
 *
 * @type {ReadonlyArray<object>}
 */
export const SAMPLE_EVENTS = Object.freeze(EVENT_DEFINITIONS.map(toEvent))

/**
 * Reduce a full event to the lean summary shape a listing card needs.
 *
 * The denormalised fields (`city`, `venueName`, `minPriceCents`, `soldOut`) are
 * exactly the ones the live list endpoint computes server-side, so a card
 * written against this shape works unchanged against the API.
 *
 * @param {object} event An event with `venue`, `organization` and `ticketTypes` attached.
 * @returns {object} A summary matching `eventSummarySchema`.
 */
export function toEventSummary(event) {
  const tiers = event.ticketTypes ?? []
  const onSale = tiers.filter((tier) => !tier.isSoldOut && tier.status === 'ON_SALE')
  const priced = onSale.length > 0 ? onSale : tiers

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
    minPriceCents: priced.length > 0 ? Math.min(...priced.map((tier) => tier.priceCents)) : null,
    currency: priced[0]?.currency ?? null,
    soldOut: tiers.length > 0 && onSale.length === 0,
  }
}

/**
 * The fallback catalogue as listing summaries.
 *
 * @returns {object[]} One summary per sample event, in start-date order.
 */
export function sampleEventSummaries() {
  return SAMPLE_EVENTS.map(toEventSummary)
}

/**
 * Look a sample event up by its slug.
 *
 * @param {string} slug Event slug, e.g. `navratri-raas-garba-nine-nights`.
 * @returns {object|null} The matching event with relations, or `null`.
 */
export function findSampleEvent(slug) {
  if (typeof slug !== 'string') return null

  return SAMPLE_EVENTS.find((event) => event.slug === slug) ?? null
}

/**
 * Look a sample organiser up by slug, with their events split around now.
 *
 * Exists so that an organiser link on a fallback-rendered event page leads
 * somewhere. Without it, the site would be internally inconsistent exactly when
 * the API is down — which is when consistency is the only thing holding the
 * page together.
 *
 * @param {string} slug Organiser slug, e.g. `rangmanch-collective`.
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
      .filter((event) => Date.parse(event.startsAt) >= now)
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .map(entry),
    pastEvents: listed
      .filter((event) => Date.parse(event.startsAt) < now)
      .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))
      .map(entry),
  }
}

/**
 * Every city the fallback catalogue has an event in, alphabetically.
 *
 * @returns {string[]} Unique city names.
 */
export function sampleCities() {
  const cities = new Set(SAMPLE_EVENTS.map((event) => event.venue?.city).filter(Boolean))

  return [...cities].sort((a, b) => a.localeCompare(b))
}
