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
 * The API checks every uploaded file again at run time
 * (`apps/api/src/lib/import-dataset.js`); this test holds the committed one.
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
