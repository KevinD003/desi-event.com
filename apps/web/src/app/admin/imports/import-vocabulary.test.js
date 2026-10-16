import { IMPORT_PLAN_ACTIONS } from '@desi-event/schemas/imports'
import { describe, expect, it } from 'vitest'

import {
  PLAN_ACTIONS,
  RUN_STATUSES,
  approveSentence,
  failureReason,
  planReading,
  runPath,
  ticketTypesLine,
  writtenCount,
} from './import-vocabulary.js'

describe('the words of the import pages', () => {
  it('has words for every action the API can plan, and every run status', () => {
    expect(Object.keys(PLAN_ACTIONS).sort()).toEqual([...IMPORT_PLAN_ACTIONS].sort())
    expect(Object.keys(RUN_STATUSES).sort()).toEqual(['APPLIED', 'EXPIRED', 'PREVIEWED'])
  })

  it('says why a listing cannot be imported, in the API’s words', () => {
    expect(planReading({ action: 'INVALID', problem: 'Its ticket link is not https.' })).toEqual(
      expect.objectContaining({
        label: 'Cannot be imported',
        detail: 'Its ticket link is not https.',
      }),
    )
  })

  it('says a decided listing must be approved or deleted before importing it again', () => {
    expect(planReading({ action: 'SKIPPED_DECIDED' }).detail).toBe(
      'A reviewer has decided this version. Approve and publish it, or delete it, before importing it again.',
    )
  })

  it('offers "Update from the listing" in words for a published event whose listing changed', () => {
    expect(planReading({ action: 'POSTED_KEPT', updatable: true }).detail).toMatch(
      /Tick “Update from the listing”/u,
    )
    expect(planReading({ action: 'UNCHANGED', resubmit: true }).detail).toMatch(
      /sent for review again/u,
    )
  })

  it('counts what applying writes, with only the ticked published events', () => {
    const rows = [
      { sourceId: '1', action: 'CREATE' },
      { sourceId: '2', action: 'UPDATE_DRAFT' },
      { sourceId: '3', action: 'UNCHANGED' },
      { sourceId: '4', action: 'POSTED_KEPT', updatable: true },
      { sourceId: '5', action: 'SKIPPED_PAST' },
      { sourceId: '6', action: 'INVALID' },
    ]

    expect(writtenCount(rows)).toBe(3)
    expect(writtenCount(rows, ['4'])).toBe(4)
  })

  it('says why a picture was not copied', () => {
    expect(failureReason('TIMEOUT')).toBe('The picture host took too long to answer.')
    expect(failureReason('TRY_AGAIN')).toBe(
      'Another change to the event was being saved at the same moment. Copy it again.',
    )
    expect(failureReason('HTTP_404')).toBe('The picture host answered with status 404.')
    expect(failureReason('SANITISER_REFUSED:IMAGE_TOO_SMALL')).toBe(
      'The picture checks refused it (IMAGE_TOO_SMALL).',
    )
    expect(failureReason('SOMETHING_NEW')).toBe('It was not copied (SOMETHING_NEW).')
    expect(failureReason(null)).toBeNull()
  })

  it('reports each approval in a sentence', () => {
    expect(
      approveSentence(
        { outcome: 'PUBLISHED', status: 'ON_SALE', ticketTypesOnSale: 3 },
        'Raga Night',
      ),
    ).toBe('Raga Night: approved and published, with 3 ticket types on sale.')
    expect(
      approveSentence(
        { outcome: 'PUBLISHED', status: 'ON_SALE', ticketTypesOnSale: 1 },
        'Raga Night',
      ),
    ).toBe('Raga Night: approved and published, with 1 ticket type on sale.')
    // Published with nothing to put on sale (its listing gave no price): no sale is claimed.
    expect(
      approveSentence(
        { outcome: 'PUBLISHED', status: 'PUBLISHED', ticketTypesOnSale: 0 },
        'Raga Night',
      ),
    ).toBe('Raga Night: approved and published. It has no ticket type to put on sale.')
    expect(approveSentence({ outcome: 'PUBLISHED' }, 'Raga Night')).toBe(
      'Raga Night: approved and published.',
    )
    expect(
      approveSentence(
        { outcome: 'SALES_OPENED', status: 'ON_SALE', ticketTypesOnSale: 2 },
        'Raga Night',
      ),
    ).toBe('Raga Night: its tickets were put on sale (2 ticket types).')
    // No sentence speaks of a "Buy tickets" link any more.
    for (const outcome of ['PUBLISHED', 'SALES_OPENED']) {
      expect(approveSentence({ outcome, ticketTypesOnSale: 1 }, 'Raga Night')).not.toMatch(
        /Buy tickets|link/u,
      )
    }
    expect(
      approveSentence({ outcome: 'PICTURES_APPROVED', picturesApproved: 1 }, 'Raga Night'),
    ).toBe('Raga Night: 1 picture approved.')
    expect(
      approveSentence(
        { outcome: 'REFUSED', message: 'Somebody changed this event since you loaded it.' },
        'Raga Night',
      ),
    ).toBe('Raga Night: not published. Somebody changed this event since you loaded it.')
  })

  it('says what a row’s prices become: ticket types, and which are not on sale', () => {
    expect(ticketTypesLine({ priceCount: 3, soldOutCount: 1 })).toBe(
      '3 ticket types, 1 not on sale (sold out on the listing)',
    )
    expect(ticketTypesLine({ priceCount: 1, soldOutCount: 0 })).toBe('1 ticket type')
    expect(ticketTypesLine({ priceCount: 0, soldOutCount: 0 })).toBe(
      'No price listed, so no ticket type',
    )
    expect(ticketTypesLine({})).toBeNull()
  })

  it('encodes a run’s id into its path', () => {
    expect(runPath('r1/x')).toBe('/admin/imports/r1%2Fx')
  })
})
