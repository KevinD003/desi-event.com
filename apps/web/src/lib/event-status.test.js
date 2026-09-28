import { describe, expect, it } from 'vitest'

import {
  EDITABLE_STATUSES,
  LIVE_STATUSES,
  MATERIAL_FIELDS as SERVER_MATERIAL_FIELDS,
  SESSION_MATERIAL_FIELDS as SERVER_SESSION_MATERIAL_FIELDS,
} from '@desi-event/schemas/lifecycle'

import {
  COMMANDS,
  EDITABLE,
  MATERIAL_FIELDS,
  MATERIAL_FIELD_LABELS,
  SESSION_MATERIAL_FIELDS,
  editMode,
  statusReading,
} from './event-status.js'

/** Every status the lifecycle has. */
const STATUSES = [
  'DRAFT',
  'REVIEW_PENDING',
  'CHANGES_REQUIRED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'POSTPONED',
  'CANCELLED',
  'COMPLETED',
  'ARCHIVED',
]

describe('the lists the web shares with the server', () => {
  it('names the same material fields as the lifecycle, for the event and for a session', () => {
    expect(MATERIAL_FIELDS).toEqual(SERVER_MATERIAL_FIELDS)
    expect(SESSION_MATERIAL_FIELDS).toEqual(SERVER_SESSION_MATERIAL_FIELDS)
  })

  it('has words for every material field', () => {
    for (const field of [...MATERIAL_FIELDS, ...SESSION_MATERIAL_FIELDS]) {
      expect(MATERIAL_FIELD_LABELS[field], field).toMatch(/^the |^whether /)
    }
  })

  it('draws as editable exactly the statuses the server lets a draft be edited in', () => {
    expect([...EDITABLE].sort()).toEqual([...EDITABLE_STATUSES].sort())
  })
})

describe('the editing mode of each status', () => {
  it.each(STATUSES)('%s', (status) => {
    const expected = EDITABLE_STATUSES.has(status)
      ? 'draft'
      : LIVE_STATUSES.has(status)
        ? 'live'
        : 'locked'

    expect(editMode(status)).toBe(expected)
  })

  it('edits a draft, keeps a public event editable, and locks review and the end states', () => {
    expect(editMode('DRAFT')).toBe('draft')
    expect(editMode('ON_SALE')).toBe('live')
    expect(editMode('POSTPONED')).toBe('live')
    expect(editMode('REVIEW_PENDING')).toBe('locked')
    expect(editMode('APPROVED')).toBe('locked')
    expect(editMode('REJECTED')).toBe('locked')
    expect(editMode('CANCELLED')).toBe('locked')
  })
})

describe('what the words promise', () => {
  const copy = [
    ...STATUSES.map((status) => statusReading(status).next),
    ...Object.values(COMMANDS).flatMap((command) => [command.label, command.confirm ?? '']),
  ].join('\n')

  it('never says people were told or emailed, because this build sends no email', () => {
    expect(copy).not.toMatch(/have been told|has been told|were told|is sent to|been emailed/i)
  })

  it('never promises something later', () => {
    expect(copy).not.toMatch(/\b(soon|yet|planned|coming)\b/i)
  })

  it('offers a rejected event a way back, and a postponed one a new date', () => {
    expect(statusReading('REJECTED').next).toMatch(/move it back to draft/)
    expect(statusReading('POSTPONED').next).toMatch(/Set a new date/)
    expect(COMMANDS.rework).toMatchObject({ path: 'rework', reason: 'none', tone: 'primary' })
    expect(COMMANDS.reschedule).toMatchObject({ path: 'reschedule', reason: 'required' })
  })
})
