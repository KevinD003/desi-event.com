/**
 * What the website link's switch says, word for word (SPEC2 §4.W-A).
 */

import { describe, expect, it } from 'vitest'

import {
  ONLY_THE_TEAM,
  administratorSummary,
  formatDecisionInstant,
  organiserSummary,
} from './website-redirect.js'

const A = 'https://rangoli.example/'
const B = 'https://www.rangoli-nights.example/'
const WHEN = '2026-09-30T10:00:00.000Z'
const SUBMITTED = '2026-10-01T08:30:00.000Z'

/** A fixed formatter, so the sentences are the test. */
const formatInstant = (value) => (value ? `[${value}]` : '')

/** The switch, never decided. */
const NEVER = Object.freeze({
  enabled: false,
  pending: false,
  decidedUrl: null,
  submittedAt: null,
  changedAt: null,
  reason: null,
  changedByName: null,
  websiteProblem: null,
})

/** On for A, decided by Anil. */
const ON = Object.freeze({
  ...NEVER,
  enabled: true,
  decidedUrl: A,
  changedAt: WHEN,
  reason: 'Checked: their own site.',
  changedByName: 'Anil Administrator',
})

describe('organiserSummary', () => {
  it('no address, never decided', () => {
    expect(organiserSummary(NEVER, { formatInstant })).toEqual({
      label: 'Off',
      tone: 'neutral',
      pending: false,
      sentences: [
        'Off. Add your website’s address above and the team at The Desi Events can link to it from your event page.',
        'Only the team at The Desi Events can turn this link on or off.',
      ],
    })
  })

  it('an address waiting, never decided', () => {
    expect(
      organiserSummary(
        { ...NEVER, pending: true, submittedAt: SUBMITTED },
        { websiteUrl: A, formatInstant },
      ).sentences,
    ).toEqual([
      'Off. Your address is on the list of website links for the team at The Desi Events to look at. It is not shown on your event page until an administrator turns the link on.',
      ONLY_THE_TEAM,
    ])
  })

  it('on, nothing waiting, naming the administrator and the note', () => {
    const summary = organiserSummary(ON, { websiteUrl: A, formatInstant })

    expect(summary.label).toBe('On')
    expect(summary.tone).toBe('success')
    expect(summary.sentences).toEqual([
      `On since [${WHEN}]. Anil Administrator of the team at The Desi Events turned it on, with this note: “Checked: their own site.”. Your event page shows “Visit the organiser’s website”, which goes to rangoli.example. Visits through it are counted in your event’s analytics, apart from robots and some automated or blocked requests.`,
      ONLY_THE_TEAM,
    ])
  })

  it('on with no note leaves the note clause out', () => {
    expect(
      organiserSummary({ ...ON, reason: null }, { websiteUrl: A, formatInstant }).sentences[0],
    ).toMatch(
      /^On since \[[^\]]+\]\. Anil Administrator of the team at The Desi Events turned it on\. Your event page/u,
    )
  })

  it('on, with a new address waiting: the link keeps going to the approved one', () => {
    expect(
      organiserSummary(
        { ...ON, pending: true, submittedAt: SUBMITTED },
        { websiteUrl: B, formatInstant },
      ).sentences,
    ).toEqual([
      `On since [${WHEN}], going to rangoli.example. Your new address, rangoli-nights.example, is on the list for the team at The Desi Events to look at; until an administrator approves it, the link keeps going to rangoli.example. If the old address should stop being linked at once, ask the team at The Desi Events to turn the link off.`,
      ONLY_THE_TEAM,
    ])
  })

  it('on, with the address removed', () => {
    expect(
      organiserSummary(
        { ...ON, pending: true, submittedAt: SUBMITTED },
        { websiteUrl: null, formatInstant },
      ).sentences,
    ).toEqual([
      `On since [${WHEN}], going to rangoli.example. You removed your address; the link keeps going to rangoli.example until an administrator turns it off. Ask the team at The Desi Events if it should stop at once.`,
      ONLY_THE_TEAM,
    ])
  })

  it('off, decided, and then a new address waiting', () => {
    const off = { ...ON, enabled: false, reason: 'Not the organiser’s site.' }

    expect(organiserSummary(off, { websiteUrl: A, formatInstant }).sentences).toEqual([
      `Off since [${WHEN}]. Anil Administrator of the team at The Desi Events turned it off, with this note: “Not the organiser’s site.”. Your address is not shown on the event page.`,
      ONLY_THE_TEAM,
    ])
    expect(
      organiserSummary(
        { ...off, pending: true, submittedAt: SUBMITTED },
        { websiteUrl: B, formatInstant },
      ).sentences,
    ).toEqual([
      `Off since [${WHEN}]. Anil Administrator of the team at The Desi Events turned it off, with this note: “Not the organiser’s site.”. Your address is not shown on the event page.`,
      'Your new address is on the list for the team at The Desi Events to look at.',
      ONLY_THE_TEAM,
    ])
  })

  it('says why a legacy address cannot be considered', () => {
    const problem =
      'Take “token” out of the address. A public link never carries a password, key or code.'

    expect(
      organiserSummary(
        { ...NEVER, pending: true, websiteProblem: problem },
        { websiteUrl: 'https://rangoli.example/?token=x', formatInstant },
      ).sentences,
    ).toContain(
      `Your address does not pass the address rules: ${problem} Change it above to have the link considered.`,
    )
  })

  it('names "An administrator" when no name came', () => {
    expect(
      organiserSummary({ ...ON, changedByName: null }, { websiteUrl: A, formatInstant })
        .sentences[0],
    ).toContain('An administrator of the team at The Desi Events turned it on')
  })

  it('names a former administrator, already "at The Desi Events", without naming the company twice', () => {
    const former = 'An administrator at The Desi Events'
    const on = organiserSummary(
      { ...ON, reason: null, changedByName: former },
      { websiteUrl: A, formatInstant },
    ).sentences[0]
    const off = organiserSummary(
      { ...ON, enabled: false, reason: null, changedByName: former },
      { websiteUrl: A, formatInstant },
    ).sentences[0]

    expect(on).toMatch(
      /^On since \[[^\]]+\]\. An administrator at The Desi Events turned it on\. /u,
    )
    expect(off).toMatch(
      /^Off since \[[^\]]+\]\. An administrator at The Desi Events turned it off\. /u,
    )
    for (const sentence of [on, off]) expect(sentence.match(/The Desi Events/gu)).toHaveLength(1)
  })

  it('always ends with who can turn the link on or off, and never says soon, yet or planned', () => {
    const states = [
      [NEVER, null],
      [{ ...NEVER, pending: true }, A],
      [ON, A],
      [{ ...ON, pending: true }, B],
      [{ ...ON, pending: true }, null],
      [{ ...ON, enabled: false }, A],
      [{ ...ON, enabled: false, pending: true }, B],
      [null, null],
    ]

    for (const [state, websiteUrl] of states) {
      const { sentences } = organiserSummary(state, { websiteUrl })

      expect(sentences.at(-1)).toBe(
        'Only the team at The Desi Events can turn this link on or off.',
      )
      expect(sentences.join(' ')).not.toMatch(/\b(soon|yet|planned)\b/iu)
    }
  })
})

describe('administratorSummary', () => {
  it('says who decided what, when and why, and how long an address has waited', () => {
    expect(administratorSummary(NEVER, { formatInstant }).sentences).toEqual([
      'Off. No administrator has decided on this address.',
    ])
    expect(
      administratorSummary(
        { ...NEVER, pending: true, submittedAt: SUBMITTED },
        {
          websiteUrl: A,
          formatInstant,
        },
      ).sentences,
    ).toEqual([
      'Off. No administrator has decided on this address.',
      `Waiting since [${SUBMITTED}].`,
    ])
    expect(administratorSummary(ON, { websiteUrl: A, formatInstant }).sentences).toEqual([
      `On since [${WHEN}], going to rangoli.example. Turned on by Anil Administrator.`,
      'Reason: Checked: their own site.',
    ])
    expect(
      administratorSummary(
        { ...ON, pending: true, submittedAt: SUBMITTED },
        {
          websiteUrl: B,
          formatInstant,
        },
      ).sentences.at(-1),
    ).toBe(
      `Waiting since [${SUBMITTED}]. The organiser changed the address to rangoli-nights.example; until it is approved, the link keeps going to rangoli.example.`,
    )
    expect(
      administratorSummary({ ...ON, enabled: false }, { websiteUrl: A, formatInstant }).sentences,
    ).toEqual([
      `Off since [${WHEN}]. Turned off by Anil Administrator.`,
      'Reason: Checked: their own site.',
    ])
  })
})

describe('formatDecisionInstant', () => {
  it('writes the instant in UTC, and nothing for none', () => {
    expect(formatDecisionInstant(WHEN)).toBe('Sep 30, 2026, 10:00 AM UTC')
    expect(formatDecisionInstant(null)).toBe('')
    expect(formatDecisionInstant('not a date')).toBe('')
  })
})
