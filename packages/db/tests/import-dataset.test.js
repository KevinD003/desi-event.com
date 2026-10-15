/**
 * The committed Sulekha dataset, `data/imports/sulekha-texas-2026.json`
 * (SPEC2-XI §5.I I-A).
 *
 * The user states that they own Sulekha.com and asked for these Texas events
 * and their photos to be imported onto The Desi Events; this file records that as
 * their statement. The dataset was curated once from the collected listings by
 * a script kept outside the repository, and these assertions are what makes it
 * trustworthy: the stated totals, the curation (three duplicate listings and
 * one wrong picture left out, one time zone corrected, lower-case venue names
 * title-cased), the category mapping, every curator's note word for word, the
 * two hosts the file may name, and no personal contact details anywhere.
 *
 * The second file, `data/imports/sulekha-north-america-2026.json`, is the
 * owner's own Sulekha export of 397 listings in the United States and Canada
 * ("Add all these events into our website"), curated on 15 October 2026 by a
 * script kept outside the repository (ADR 0015, addendum). It is held to the
 * same rules as the Texas file, plus what a second country brings: a time zone
 * for each venue with the right offset on its date, two-letter regions, and
 * Canadian prices in CAD with a note saying so.
 *
 * The API checks every uploaded file again at run time
 * (`apps/api/src/lib/import-dataset.js`); this test holds the committed ones.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { EVENT_CATEGORIES } from '@desi-event/schemas'
import { IMPORT_DATASET_FORMAT, importDatasetSchema } from '@desi-event/schemas/imports'

const FILE = new URL('../data/imports/sulekha-texas-2026.json', import.meta.url)
const text = readFileSync(FILE, 'utf8')
const dataset = JSON.parse(text)
const events = dataset.events
const byId = new Map(events.map((event) => [event.sourceId, event]))
const images = events.flatMap((event) => event.images)

/** The source category in words, as the category note names it. */
const SOURCE_CATEGORY_WORDS = {
  CLASSICAL: 'Classical',
  EXPO: 'Expo',
  KIDS: 'Kids',
  OTHER: 'Other',
  FOOD: 'Food',
}

/** The Desi Events' category in words, as its own category list shows it. */
const CATEGORY_WORDS = {
  MUSIC_CONCERT: 'Live Music',
  THEATRE: 'Theatre',
  NETWORKING: 'Networking',
  WORKSHOP: 'Workshops',
  CULTURAL_FESTIVAL: 'Melas & Festivals',
  FOOD_FESTIVAL: 'Food Festivals',
}

/** SPEC2-XI's mapping table, with its per-listing exceptions. */
const CATEGORY_MAP = {
  GARBA_DANDIYA: 'GARBA_DANDIYA',
  CONCERT: 'MUSIC_CONCERT',
  COMEDY: 'COMEDY',
  BOLLYWOOD: 'BOLLYWOOD_NIGHT',
  FESTIVAL: 'CULTURAL_FESTIVAL',
  FOOD: 'FOOD_FESTIVAL',
  CLASSICAL: 'MUSIC_CONCERT',
  EXPO: 'NETWORKING',
  KIDS: 'WORKSHOP',
}
const CATEGORY_EXCEPTIONS = {
  400744: 'THEATRE',
  401870: 'WORKSHOP',
  401869: 'CULTURAL_FESTIVAL',
  401997: 'THEATRE',
}

/** The ten listings whose Sulekha category The Desi Events does not have. */
const CATEGORY_NOTED = [
  '400744',
  '401719',
  '401721',
  '401819',
  '401820',
  '402108',
  '401870',
  '401869',
  '401997',
  '401110',
]

/**
 * The category note for a listing.
 *
 * @param {{sourceCategory: string, category: string}} event The listing.
 * @returns {string} The sentence.
 */
function categoryNote(event) {
  return `Sulekha lists this as ${SOURCE_CATEGORY_WORDS[event.sourceCategory]}; The Desi Events has no such category, so it is listed under ${CATEGORY_WORDS[event.category]}. If another fits better, change it in an editing session once the event is published.`
}

const CST_NOTE =
  'The page says CST, but the date falls in daylight saving time, so the time is imported as Central Daylight Time.'
const COMEDY_FEST_NOTE =
  'Sulekha says tickets are sold at DesiComedyFest.com; the link still goes to the Sulekha page.'

/** Every note SPEC2-XI lists, word for word, by listing. */
const LISTED_NOTES = {
  402059: [
    'Sulekha lists this event twice (402059 and 402060); only 402059 is imported.',
    "One gallery picture on the Sulekha page was another event's poster (Navratri Dandiya Night In Austin), so it was left out.",
  ],
  400972: [
    'Sulekha lists this event twice (400522 and 400972) with different street numbers (1401 and 1420 Toro Grande Blvd); 400972 and its address are imported.',
    'Its prices cover Friday and Saturday; the Saturday night is also listed on its own (400973).',
  ],
  401979: ['Sulekha lists this event twice (401979 and 401980); only 401979 is imported.'],
  401388: [
    'The Sulekha page gives 4:00 PM EDT for a Texas venue. It is imported as 3:00 PM Central, the same moment. Check the time with the organiser.',
  ],
  400744: [
    CST_NOTE,
    'The page has no poster, so the event has no cover; its only picture is a performer photo.',
  ],
  401110: [CST_NOTE],
  401728: ['The header says 7:00 PM and the description says 7:30 PM; 7:00 PM is imported.'],
  401885: [
    "The page's metadata says 25 October and the visible date is 23 October; 23 October is imported.",
  ],
  401963: [
    "Its Sulekha description was for a different event (in the Bay Area), so the description here is built from the page's other details.",
  ],
  401870: [
    "Sulekha gives no description, so the description here is built from the page's other details.",
  ],
  402109: ['A personal phone number was removed from the description.'],
  401684: ['The listing says Dallas; the venue is in Farmers Branch, which is used.'],
  401360: ["A '$0 General Admission' price could not be confirmed and was left out."],
  402012: [COMEDY_FEST_NOTE],
  402013: [COMEDY_FEST_NOTE],
}

/** What each listing's `importNotes` must be, exactly. */
function expectedNotes(event) {
  const notes = [...(LISTED_NOTES[event.sourceId] ?? [])]

  if (CATEGORY_NOTED.includes(event.sourceId)) notes.push(categoryNote(event))

  return notes
}

/** Phone numbers in the shapes a listing could carry: North American, international, or bare digits. */
const PHONE_PATTERNS = [
  /(?<![\w.-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/u,
  /\+\d[\d\s().-]{6,}\d/u,
  /\d{10,}/u,
]

/** An address with an `@` in it. */
const EMAIL_PATTERN = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/u

/**
 * The host of an address.
 *
 * @param {string} value An absolute URL.
 * @returns {string} Its host name.
 */
function host(value) {
  return new URL(value).hostname
}

describe('the Sulekha Texas dataset', () => {
  it('parses with importDatasetSchema', () => {
    const parsed = importDatasetSchema.safeParse(dataset)

    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 5))).toBe(true)
  })

  it('declares the file shape SPEC2-XI gives', () => {
    expect(Object.keys(dataset)).toEqual([
      'format',
      'source',
      'sourceName',
      'sourceSite',
      'collectedFrom',
      'collectedTo',
      'curatedOn',
      'imageHosts',
      'events',
    ])
    expect(dataset).toMatchObject({
      format: IMPORT_DATASET_FORMAT,
      source: 'SULEKHA',
      sourceName: 'Sulekha',
      sourceSite: 'https://events.sulekha.com/',
      collectedFrom: '2026-09-29T21:25:00Z',
      collectedTo: '2026-09-30T00:51:08Z',
      curatedOn: '2026-09-30',
      imageHosts: ['usimg.sulekha.io'],
    })
  })

  it('holds the stated totals', () => {
    const withPrices = events.filter((event) => event.prices.length > 0)

    expect(events).toHaveLength(45)
    expect(images).toHaveLength(86)
    expect(new Set(images.map((image) => image.url)).size).toBe(84)
    expect(images.filter((image) => image.role === 'cover')).toHaveLength(44)
    expect(images.filter((image) => image.role === 'gallery')).toHaveLength(42)
    expect(withPrices).toHaveLength(29)
    expect(withPrices.reduce((sum, event) => sum + event.prices.length, 0)).toBe(109)
    expect(events.filter((event) => event.prices.length === 0)).toHaveLength(16)
    expect(events.filter((event) => event.endsAt === null)).toHaveLength(43)
    expect(events.filter((event) => event.importNotes.length > 0)).toHaveLength(22)
  })

  it('leaves out the three duplicate listings and the wrong gallery picture', () => {
    for (const dropped of ['402060', '400522', '401980']) {
      expect(byId.has(dropped)).toBe(false)
      expect(text.includes(`_${dropped}"`)).toBe(false)
    }

    // The poster of 401885 stays on 401885 only, never on 402059.
    const poster = 'navratri-dandiya-night-in-texas_2026-09-16-05-14-47-542_12'

    expect(byId.get('402059').images.some((image) => image.url.includes(poster))).toBe(false)
    expect(
      events
        .filter((event) => event.images.some((image) => image.url.includes(poster)))
        .map((event) => event.sourceId),
    ).toEqual(['401885'])
    // The kept copy of each pair is the richer one.
    expect(byId.get('400972').prices).toHaveLength(5)
    expect(byId.get('400972').images).toHaveLength(2)
  })

  it('names only usimg.sulekha.io for pictures and events.sulekha.com for listings and tickets', () => {
    expect(images.every((image) => host(image.url) === 'usimg.sulekha.io')).toBe(true)
    expect(images.every((image) => new URL(image.url).protocol === 'https:')).toBe(true)
    expect(events.filter((event) => host(event.sourceUrl) === 'events.sulekha.com')).toHaveLength(
      45,
    )
    expect(events.filter((event) => host(event.ticketUrl) === 'events.sulekha.com')).toHaveLength(
      45,
    )
    // "the link still goes to the Sulekha page": every ticket link is the listing itself.
    expect(events.every((event) => event.ticketUrl === event.sourceUrl)).toBe(true)
    expect(events.every((event) => event.sourceUrl.endsWith(`_${event.sourceId}`))).toBe(true)
  })

  it('maps every category into the enum by the table, with its exceptions', () => {
    for (const event of events) {
      expect(EVENT_CATEGORIES).toContain(event.category)
      expect(event.category, event.sourceId).toBe(
        CATEGORY_EXCEPTIONS[event.sourceId] ?? CATEGORY_MAP[event.sourceCategory],
      )
    }

    expect(
      events
        .filter((event) =>
          ['CLASSICAL', 'EXPO', 'KIDS', 'OTHER', 'FOOD'].includes(event.sourceCategory),
        )
        .map((event) => event.sourceId)
        .sort(),
    ).toEqual([...CATEGORY_NOTED].sort())
  })

  it('starts every listing after the day it was curated', () => {
    const endOfCuration = Date.parse(`${dataset.curatedOn}T23:59:59.999Z`)

    for (const event of events) {
      expect(Date.parse(event.startsAt), event.sourceId).toBeGreaterThan(endOfCuration)
      expect(Date.parse(event.scrapedAt)).toBeGreaterThanOrEqual(Date.parse(dataset.collectedFrom))
      expect(Date.parse(event.scrapedAt)).toBeLessThanOrEqual(Date.parse(dataset.collectedTo))
    }
  })

  it('keeps every Texas listing in Central time, 401388 at the same moment as listed', () => {
    expect(events.every((event) => event.venue.region === 'TX')).toBe(true)
    expect(events.every((event) => event.timeZone === 'America/Chicago')).toBe(true)

    const leander = byId.get('401388')

    expect(leander.startsAt).toBe('2026-10-09T15:00:00-05:00')
    expect(Date.parse(leander.startsAt)).toBe(Date.parse('2026-10-09T16:00:00-04:00'))
  })

  it('title-cases venue names that were entirely lower case', () => {
    expect(byId.get('400132').venue.name).toBe('Frisco Flyers')
    expect(events.filter((event) => event.venue.name === event.venue.name.toLowerCase())).toEqual(
      [],
    )
  })

  it('carries no email address and no phone number anywhere', () => {
    expect(text.includes('@')).toBe(false)
    expect(EMAIL_PATTERN.test(text)).toBe(false)

    for (const pattern of PHONE_PATTERNS) {
      expect(text.match(pattern)?.[0] ?? null, String(pattern)).toBeNull()
    }
  })

  it('has phone and email patterns that would catch one, and spare the picture names', () => {
    for (const phone of [
      '(512) 555-0134',
      '512-555-0134',
      '512.555.0134',
      '+1 512 555 0134',
      '+91 98450 12345',
      '5125550134',
    ]) {
      expect(
        PHONE_PATTERNS.some((pattern) => pattern.test(`Call ${phone} today`)),
        phone,
      ).toBe(true)
    }
    expect(EMAIL_PATTERN.test('write to someone@example.com')).toBe(true)
    expect(
      PHONE_PATTERNS.some((pattern) =>
        pattern.test('/cdn/events/images/2026-07-27-04-23-38-088_92.webp?ver=0.333792'),
      ),
    ).toBe(false)
  })

  it('describes every picture in 1 to 300 characters, with at most one cover per listing', () => {
    for (const image of images) {
      expect(image.alt.trim().length).toBeGreaterThanOrEqual(1)
      expect(image.alt.length).toBeLessThanOrEqual(300)
    }

    expect(
      events.every((event) => event.images.filter((i) => i.role === 'cover').length <= 1),
    ).toBe(true)
    expect(byId.get('400744').images.map((image) => image.role)).toEqual(['gallery'])
  })

  it('carries every curator note word for word, and no other', () => {
    for (const event of events) {
      expect(event.importNotes, event.sourceId).toEqual(expectedNotes(event))
    }

    for (const sourceId of [...Object.keys(LISTED_NOTES), ...CATEGORY_NOTED]) {
      expect(byId.has(sourceId), sourceId).toBe(true)
    }
  })

  it('names who presents each listing and keeps the source attribution', () => {
    for (const event of events) {
      expect(event.presentedBy, event.sourceId).toEqual(expect.any(String))
      expect(event.sourceId).toMatch(/^[0-9]{1,12}$/u)
      expect(Number.isNaN(Date.parse(event.scrapedAt))).toBe(false)
    }
  })
})

const NA_FILE = new URL('../data/imports/sulekha-north-america-2026.json', import.meta.url)
const naText = readFileSync(NA_FILE, 'utf8')
const naDataset = JSON.parse(naText)
const naEvents = naDataset.events
const naById = new Map(naEvents.map((event) => [event.sourceId, event]))
const naImages = naEvents.flatMap((event) => event.images)
const naPrices = naEvents.flatMap((event) => event.prices)

/** The upload has no collection time, so the curation day at midnight UTC stands for it. */
const NA_SCRAPED_AT = '2026-10-15T00:00:00Z'

/**
 * The zone of each region, with the city exceptions the export needs (a
 * region spanning two zones). Every venue's zone must be this.
 */
const NA_ZONES = {
  'CA-AB': 'America/Edmonton',
  'CA-BC': 'America/Vancouver',
  'CA-ON': 'America/Toronto',
  'US-AZ': 'America/Phoenix',
  'US-CA': 'America/Los_Angeles',
  'US-CO': 'America/Denver',
  'US-CT': 'America/New_York',
  'US-DC': 'America/New_York',
  'US-FL': 'America/New_York',
  'US-GA': 'America/New_York',
  'US-IL': 'America/Chicago',
  'US-IN': 'America/Indiana/Indianapolis',
  'US-KY': 'America/New_York',
  'US-MA': 'America/New_York',
  'US-MD': 'America/New_York',
  'US-MI': 'America/Detroit',
  'US-MN': 'America/Chicago',
  'US-NC': 'America/New_York',
  'US-NJ': 'America/New_York',
  'US-NV': 'America/Los_Angeles',
  'US-NY': 'America/New_York',
  'US-OH': 'America/New_York',
  'US-PA': 'America/New_York',
  'US-TN': 'America/Chicago',
  'US-TX': 'America/Chicago',
  'US-VA': 'America/New_York',
  'US-WA': 'America/Los_Angeles',
}
const NA_ZONE_CITY_EXCEPTIONS = {
  'US-IN-Gary': 'America/Chicago',
  'US-KY-Louisville': 'America/Kentucky/Louisville',
}

/**
 * The curation's category table, in its priority order (ADR 0015 addendum):
 * the Sulekha category that decided, upper-cased, and where it is listed.
 */
const NA_CATEGORY_MAP = {
  NAVRATRI_DANDIYA: 'GARBA_DANDIYA',
  DIWALI: 'CULTURAL_FESTIVAL',
  COMEDY: 'COMEDY',
  DRAMA: 'THEATRE',
  DRAMA_EVENTS: 'THEATRE',
  THEATER: 'THEATRE',
  POETRY: 'THEATRE',
  DEVOTIONAL: 'RELIGIOUS',
  RELIGIOUS: 'RELIGIOUS',
  SPIRITUAL: 'RELIGIOUS',
  CLASSICAL_MUSIC_CONCERTS: 'MUSIC_CONCERT',
  CLASSICAL: 'MUSIC_CONCERT',
  LIVE_CONCERT: 'MUSIC_CONCERT',
  LIVE_IN_CONCERT: 'MUSIC_CONCERT',
  BOLLYWOOD_PARTY: 'BOLLYWOOD_NIGHT',
  NIGHT_PARTY: 'BOLLYWOOD_NIGHT',
  BOLLYWOOD: 'BOLLYWOOD_NIGHT',
  MUSIC: 'MUSIC_CONCERT',
  SINGING: 'MUSIC_CONCERT',
  FOOD_DRINK: 'FOOD_FESTIVAL',
  CHRISTMAS: 'CULTURAL_FESTIVAL',
  NEW_YEAR_EVE: 'CULTURAL_FESTIVAL',
  EXHIBITION: 'CULTURAL_FESTIVAL',
  FASHION_SHOW: 'CULTURAL_FESTIVAL',
  MAGIC_SHOW: 'THEATRE',
  DANCE: 'CULTURAL_FESTIVAL',
  FUSION: 'CULTURAL_FESTIVAL',
  FUSION_SHOW_EVENTS: 'CULTURAL_FESTIVAL',
}
/** Listings the table would misfile, by what the listing itself says it is. */
const NA_CATEGORY_EXCEPTIONS = {
  401497: 'NETWORKING',
  402195: 'BOLLYWOOD_NIGHT',
  402162: 'BOLLYWOOD_NIGHT',
  400992: 'RELIGIOUS',
  401397: 'RELIGIOUS',
  401860: 'MUSIC_CONCERT',
}
/** What a Garba & Dandiya listing's own title or description must say (Sulekha tags pujas Navratri/Dandiya too). */
const GARBA_WORDS = /\b(?:garba|garbo|dandiya|raas|navr[aā]?tri|navar[aā]tri)/iu
/** Tagged Navratri/Dandiya, but nothing in the listing says garba: listed by the next rule, and noted. */
const NA_NOT_GARBA = {
  401255: 'RELIGIOUS',
  401398: 'MUSIC_CONCERT',
  401401: 'MUSIC_CONCERT',
  401582: 'MUSIC_CONCERT',
  401613: 'MUSIC_CONCERT',
  401614: 'MUSIC_CONCERT',
  402149: 'COMEDY',
}
/** Sulekha categories The Desi Events has no equivalent of. */
const NA_INEXACT = {
  POETRY: 'Poetry',
  CHRISTMAS: 'Christmas',
  NEW_YEAR_EVE: 'New Year Eve',
  EXHIBITION: 'Exhibition',
  FASHION_SHOW: 'Fashion Show',
  MAGIC_SHOW: 'Magic Show',
  DANCE: 'Dance',
  FUSION: 'Fusion',
  FUSION_SHOW_EVENTS: 'Fusion Show & Events',
}
const SITE_CATEGORY_WORDS = {
  ...CATEGORY_WORDS,
  BOLLYWOOD_NIGHT: 'Bollywood Nights',
  GARBA_DANDIYA: 'Garba & Dandiya',
  COMEDY: 'Comedy',
  RELIGIOUS: 'Religious & Devotional',
}

/** Listings the export marks Cancelled: never imported. */
const NA_CANCELLED = ['400151', '400963', '401314', '401541', '401564', '401719', '402053']

/** Listings also in the Texas file. The importer plans them as updates or leaves them unchanged. */
const NA_TEXAS_OVERLAP = [
  '400647',
  '400972',
  '400973',
  '401212',
  '401453',
  '401558',
  '401676',
  '401721',
  '401885',
  '402109',
]

/** A sales state or a call to hurry. Allowed in a curator's note only, never in public text. */
const URGENCY =
  /selling\s+fast|sold\s*-?\s*out|sell-?out|hurry|last\s+chance|few\s+left|final\s+call|almost\s+full|open\s+soon/iu

/** What `publicPriceName` would still take out of a price name (apps/api/src/lib/presenters.js). */
const SALES_NOTE_IN_NAME = new RegExp(
  [
    String.raw`\b(?:ends|ending|end\s+(?:on|by|at)|until|till|closes?|closing|expires?|expiring|deadline)\b`,
    String.raw`\b(?:final|last)\s+(?:call|chance|days?|hours?|few)\b`,
    String.raw`\b(?:sold\s+out|selling\s+fast|almost\s+(?:full|gone|sold\s+out)|few\s+left|\d+\s+left|limited|hurry)\b`,
    String.raw`\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b`,
  ].join('|'),
  'iu',
)

/**
 * The offset, as `±hh:mm`, and the wall-clock time a zone has at an instant.
 *
 * @param {string} timeZone An IANA zone.
 * @param {number} epoch Milliseconds since the epoch.
 * @returns {{offset: string, wall: string}} For example `-05:00` and `2026-10-16T19:00`.
 */
function zoneAt(timeZone, epoch) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(epoch))
      .map((part) => [part.type, part.value]),
  )
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.slice(3)

  return {
    offset,
    wall: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
  }
}

/**
 * Whether an ISO time is written with the offset its zone has at that moment,
 * and so reads as the same wall-clock time there.
 *
 * @param {string} iso `YYYY-MM-DDTHH:MM:SS±hh:mm`.
 * @param {string} timeZone An IANA zone.
 * @returns {boolean} True when offset and wall time agree with the zone.
 */
function offsetMatchesZone(iso, timeZone) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):\d{2}([+-]\d{2}:\d{2})$/u.exec(iso)

  if (!match) return false

  const at = zoneAt(timeZone, Date.parse(iso))

  return at.offset === match[2] && at.wall === match[1]
}

describe('the Sulekha North America dataset', () => {
  it('parses with importDatasetSchema', () => {
    const parsed = importDatasetSchema.safeParse(naDataset)

    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 5))).toBe(true)
  })

  it('declares the same file shape as the Texas file, collected on the day it was curated', () => {
    expect(Object.keys(naDataset)).toEqual(Object.keys(dataset))
    expect(naDataset).toMatchObject({
      format: IMPORT_DATASET_FORMAT,
      source: 'SULEKHA',
      sourceName: 'Sulekha',
      sourceSite: 'https://events.sulekha.com/',
      collectedFrom: NA_SCRAPED_AT,
      collectedTo: NA_SCRAPED_AT,
      curatedOn: '2026-10-15',
      imageHosts: ['usimg.sulekha.io'],
    })
    expect(Buffer.byteLength(naText)).toBeLessThan(2 * 1024 * 1024)
  })

  it('holds the stated totals', () => {
    const withPrices = naEvents.filter((event) => event.prices.length > 0)

    expect(naEvents).toHaveLength(294)
    expect(naImages).toHaveLength(497)
    expect(new Set(naImages.map((image) => image.url)).size).toBe(497)
    expect(naImages.filter((image) => image.role === 'cover')).toHaveLength(286)
    expect(naImages.filter((image) => image.role === 'gallery')).toHaveLength(211)
    expect(withPrices).toHaveLength(273)
    expect(naPrices).toHaveLength(1008)
    expect(naEvents.filter((event) => event.prices.length === 0)).toHaveLength(21)
    expect(naEvents.filter((event) => event.endsAt === null)).toHaveLength(94)
    expect(naEvents.filter((event) => event.importNotes.length > 0)).toHaveLength(197)
    expect(naEvents.filter((event) => event.venue.country === 'US')).toHaveLength(264)
    expect(naEvents.filter((event) => event.venue.country === 'CA')).toHaveLength(30)
  })

  it('names each listing once, in order of start', () => {
    expect(new Set(naEvents.map((event) => event.sourceId)).size).toBe(naEvents.length)

    for (let i = 1; i < naEvents.length; i += 1) {
      const before = naEvents[i - 1]
      const after = naEvents[i]
      const order =
        Date.parse(before.startsAt) - Date.parse(after.startsAt) ||
        Number(before.sourceId) - Number(after.sourceId)

      expect(order, `${before.sourceId} before ${after.sourceId}`).toBeLessThan(0)
    }
  })

  it('leaves out the cancelled listings', () => {
    for (const dropped of NA_CANCELLED) {
      expect(naById.has(dropped), dropped).toBe(false)
      expect(naText.includes(`_${dropped}"`)).toBe(false)
    }
  })

  it('names only usimg.sulekha.io for pictures and events.sulekha.com for listings and tickets', () => {
    expect(naImages.every((image) => host(image.url) === 'usimg.sulekha.io')).toBe(true)
    expect(naImages.every((image) => new URL(image.url).protocol === 'https:')).toBe(true)
    expect(naImages.some((image) => image.url.includes('/images/organizer/'))).toBe(false)
    expect(naEvents.every((event) => host(event.sourceUrl) === 'events.sulekha.com')).toBe(true)
    expect(naEvents.every((event) => new URL(event.sourceUrl).protocol === 'https:')).toBe(true)
    expect(naEvents.every((event) => event.ticketUrl === event.sourceUrl)).toBe(true)
    expect(naEvents.every((event) => event.sourceUrl.endsWith(`_${event.sourceId}`))).toBe(true)
  })

  it('maps every category by the priority table, with its exceptions and notes', () => {
    for (const event of naEvents) {
      expect(EVENT_CATEGORIES).toContain(event.category)
      expect(event.category, event.sourceId).toBe(
        NA_CATEGORY_EXCEPTIONS[event.sourceId] ?? NA_CATEGORY_MAP[event.sourceCategory],
      )

      const inexact = NA_INEXACT[event.sourceCategory]

      if (inexact && !NA_CATEGORY_EXCEPTIONS[event.sourceId]) {
        expect(event.importNotes, event.sourceId).toContain(
          `Sulekha lists this as ${inexact}; The Desi Events has no such category, so it is listed under ${SITE_CATEGORY_WORDS[event.category]}. If another fits better, change it in an editing session once the event is published.`,
        )
      }
    }

    for (const sourceId of Object.keys(NA_CATEGORY_EXCEPTIONS)) {
      expect(
        naById
          .get(sourceId)
          .importNotes.some((note) => note.startsWith('Sulekha lists this under')),
        sourceId,
      ).toBe(true)
    }
  })

  it('lists under Garba & Dandiya only what says garba, dandiya, raas or Navratri, noting the rest', () => {
    for (const event of naEvents.filter((e) => e.category === 'GARBA_DANDIYA')) {
      expect(GARBA_WORDS.test(`${event.title}\n${event.description}`), event.sourceId).toBe(true)
    }

    for (const [sourceId, category] of Object.entries(NA_NOT_GARBA)) {
      const event = naById.get(sourceId)

      expect(event.category, sourceId).toBe(category)
      expect(GARBA_WORDS.test(`${event.title}\n${event.description}`), sourceId).toBe(false)
      expect(
        event.importNotes.some(
          (note) =>
            note.startsWith('Sulekha lists this under') &&
            note.includes(
              'nothing in its title or description mentions garba, dandiya, raas or Navratri',
            ) &&
            note.includes(`under ${SITE_CATEGORY_WORDS[category]}, not under Garba & Dandiya.`),
        ),
        sourceId,
      ).toBe(true)
    }

    expect(naEvents.filter((event) => event.category === 'GARBA_DANDIYA')).toHaveLength(73)
  })

  it('reads times with time-zone data that knows British Columbia and Alberta keep one offset', () => {
    // tzdata 2026b: BC stays at -07:00 from 2026; 2026c: Alberta at -06:00. Ontario still falls back.
    const lateNovember = Date.parse('2026-11-28T20:00:00Z')

    expect(zoneAt('America/Vancouver', lateNovember).offset).toBe('-07:00')
    expect(zoneAt('America/Edmonton', lateNovember).offset).toBe('-06:00')
    expect(zoneAt('America/Toronto', lateNovember).offset).toBe('-05:00')
    expect(zoneAt('America/Los_Angeles', lateNovember).offset).toBe('-08:00')

    const bc = naEvents.filter((event) => event.timeZone === 'America/Vancouver')

    expect(bc).toHaveLength(6)
    expect(bc.every((event) => event.startsAt.endsWith('-07:00'))).toBe(true)
    expect(naById.get('401431').startsAt).toBe('2026-11-28T19:00:00-07:00')
    expect(naById.get('401431').endsAt).toBe('2026-11-28T20:15:00-07:00')
    expect(
      bc.flatMap((event) => event.importNotes).filter((note) => note.includes('Standard Time')),
    ).toEqual([])
    expect(naById.get('401895').importNotes).toContain(
      'The page says PST (UTC-08:00), but America/Vancouver no longer changes its clocks and is at UTC-07:00 on this date, so the time is imported as the same clock time at UTC-07:00.',
    )
  })

  it('keeps the day a pass covers in its price name, so no two prices of 402111 read the same', () => {
    const event = naById.get('402111')
    const names = event.prices.map((price) => price.name)

    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Family (2 adults and 2 children) - Saturday and Sunday')
    expect(names).toContain('Couple (2 adults) - Durga Puja Saturday')
    expect(names).toContain('Individual - Durga Puja Sunday')
    expect(event.importNotes.some((note) => note.startsWith('A sales date'))).toBe(false)
    expect(event.importNotes).toContain(
      'Those price names include passes for Saturday 17 October 2026, but this listing is imported for Sunday 18 October 2026 only. Check the dates with the organiser before approving it.',
    )
  })

  it('writes every time with the offset its venue’s zone has on that date', () => {
    for (const event of naEvents) {
      const { country, region, city } = event.venue

      expect(event.timeZone, event.sourceId).toBe(
        NA_ZONE_CITY_EXCEPTIONS[`${country}-${region}-${city}`] ?? NA_ZONES[`${country}-${region}`],
      )
      expect(offsetMatchesZone(event.startsAt, event.timeZone), event.startsAt).toBe(true)

      if (event.endsAt !== null) {
        expect(offsetMatchesZone(event.endsAt, event.timeZone), event.endsAt).toBe(true)
        expect(Date.parse(event.endsAt)).toBeGreaterThan(Date.parse(event.startsAt))
        expect(Date.parse(event.endsAt) - Date.parse(event.startsAt)).toBeLessThanOrEqual(
          24 * 3_600_000,
        )
      }
    }

    // Daylight saving: Eastern time is -04:00 before 1 November 2026 and -05:00 after.
    const offsets = new Set(
      naEvents
        .filter((event) => event.timeZone === 'America/New_York')
        .map((e) => e.startsAt.slice(-6)),
    )

    expect([...offsets].sort()).toEqual(['-04:00', '-05:00'])
    expect(
      naEvents
        .filter((event) => event.timeZone === 'America/Phoenix')
        .every((event) => event.startsAt.endsWith('-07:00')),
    ).toBe(true)
  })

  it('starts every listing on or after the day it was curated, and after it was collected', () => {
    for (const event of naEvents) {
      expect(event.startsAt.slice(0, 10) >= naDataset.curatedOn, event.sourceId).toBe(true)
      expect(Date.parse(event.startsAt)).toBeGreaterThan(Date.parse(NA_SCRAPED_AT))
      expect(event.scrapedAt).toBe(NA_SCRAPED_AT)
    }
  })

  it('gives every venue a two-letter region and its country’s currency, noting Canadian dollars', () => {
    for (const event of naEvents) {
      expect(['US', 'CA']).toContain(event.venue.country)
      expect(event.venue.region).toMatch(/^[A-Z]{2}$/u)

      const currency = event.venue.country === 'CA' ? 'CAD' : 'USD'

      expect(
        event.prices.every((price) => price.currency === currency),
        event.sourceId,
      ).toBe(true)

      if (event.venue.country === 'CA') {
        expect(event.venue.postalCode).toMatch(/^[A-Z]\d[A-Z] \d[A-Z]\d$/u)

        if (event.prices.length > 0) {
          expect(
            event.importNotes.some((note) => note.includes('Canadian dollars')),
            event.sourceId,
          ).toBe(true)
          expect(event.priceText.startsWith('CA$') || event.priceText === 'Free').toBe(true)
        }
      } else {
        expect(event.venue.postalCode).toMatch(/^\d{5}$/u)
      }
    }

    expect(naPrices.filter((price) => price.currency === 'CAD')).toHaveLength(50)
    expect(naText.includes('"Ontario"')).toBe(false)
  })

  it('keeps sales states and calls to hurry out of everything public', () => {
    for (const event of naEvents) {
      const shown = [
        event.title,
        event.summary,
        event.description,
        event.priceText ?? '',
        event.ageRestriction ?? '',
        ...event.prices.map((price) => price.name),
        ...event.faq.flatMap((entry) => [entry.q, entry.a]),
        ...event.images.map((image) => image.alt),
      ].join('\n')

      expect(shown.match(URGENCY)?.[0] ?? null, event.sourceId).toBeNull()

      for (const price of event.prices) {
        expect(price.name.match(SALES_NOTE_IN_NAME)?.[0] ?? null, price.name).toBeNull()
        expect([null, 'Sold Out']).toContain(price.note)
      }
    }

    // The status Sulekha showed reaches the administrator only.
    expect(
      naEvents.filter((event) =>
        event.importNotes.some((note) => note.startsWith("Sulekha's export (curated 2026-10-15)")),
      ),
    ).toHaveLength(43)
  })

  it('carries no email address and no phone number anywhere', () => {
    expect(naText.includes('@')).toBe(false)
    expect(EMAIL_PATTERN.test(naText)).toBe(false)

    for (const pattern of PHONE_PATTERNS) {
      expect(naText.match(pattern)?.[0] ?? null, String(pattern)).toBeNull()
    }
  })

  it('describes every picture in 1 to 300 characters, with one cover first wherever there is a picture', () => {
    for (const image of naImages) {
      expect(image.alt.trim().length).toBeGreaterThanOrEqual(1)
      expect(image.alt.length).toBeLessThanOrEqual(300)
    }

    for (const event of naEvents) {
      if (event.images.length === 0) continue

      expect(event.images.map((image) => image.role).filter((role) => role === 'cover')).toEqual([
        'cover',
      ])
      expect(event.images[0].role, event.sourceId).toBe('cover')
    }

    expect(
      naEvents
        .filter((event) => event.images.length === 0)
        .map((event) => event.sourceId)
        .sort(),
    ).toEqual(['401779', '401834', '401966', '401970', '402195', '402252', '402260', '402309'])
  })

  it('asks only the refund question, and names who presents each listing', () => {
    for (const event of naEvents) {
      expect(
        event.faq.every((entry) => entry.q === 'What is the refund policy?'),
        event.sourceId,
      ).toBe(true)
      expect(event.faq.length).toBeLessThanOrEqual(1)
      expect(event.presentedBy, event.sourceId).toEqual(expect.any(String))
      expect(event.sourceId).toMatch(/^[0-9]{1,12}$/u)
      expect(event.performers.every((performer) => performer.role === null)).toBe(true)
    }
  })

  it('keeps the listings also in the Texas file, each noting how this export differs', () => {
    const overlap = naEvents.filter((event) => byId.has(event.sourceId)).map((e) => e.sourceId)

    expect(overlap.sort()).toEqual(NA_TEXAS_OVERLAP)

    for (const sourceId of NA_TEXAS_OVERLAP) {
      const event = naById.get(sourceId)

      expect(event.sourceUrl).toBe(byId.get(sourceId).sourceUrl)
      expect(
        event.importNotes.some((note) =>
          note.startsWith('This listing is also in sulekha-texas-2026.json'),
        ),
        sourceId,
      ).toBe(true)
    }
  })
})
