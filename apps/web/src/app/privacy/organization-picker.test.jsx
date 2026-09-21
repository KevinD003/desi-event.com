/**
 * The filter form, and the two defects that had no test.
 *
 * Both were shipped, both were invisible, and both were of the same kind: a
 * control that looks like it works, does something else, and never says so.
 *
 *   - **It submitted to the wrong page.** `action` was hard-coded to
 *     `/privacy`, so pressing **Apply** on the export register navigated the
 *     operator to the privacy request queue. The filter was not wrong, it was
 *     unreachable.
 *   - **It offered the wrong vocabulary.** The state list was hard-coded to
 *     `PRIVACY_REQUEST_STATES`, so the register offered `REQUESTED`,
 *     `QUEUED`, `PROCESSING` — states no export artefact can be in. Choosing
 *     one and applying it would have asked the API to filter on a value nothing
 *     could match.
 *
 * The third case below is about a defect the fix would otherwise have
 * introduced: with `action` corrected, Apply began submitting a query that did
 * not carry `kind`, so refining the state filter would silently clear the kind
 * filter. Fixing a control so that it works, and having it quietly discard part
 * of what the operator asked for, is the same failure with better manners.
 *
 * @module app/privacy/organization-picker.test
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EXPORT_ARTIFACT_STATES } from '@desi-event/schemas'

import { OrganizationPicker } from './organization-picker.jsx'

/** The organisation these tests act in. */
const ORGANIZATION = 'org00000000000000000001'

/** One organisation, so the picker renders its hidden-input branch. */
const ONE = [{ organizationId: ORGANIZATION, organizationName: 'Rangoli' }]

/**
 * Every hidden input in the form, as name/value pairs.
 *
 * @param {HTMLElement} container The rendered container.
 * @returns {Record<string, string>} What Apply would submit besides the selects.
 */
function hiddenInputs(container) {
  return Object.fromEntries(
    [...container.querySelectorAll('input[type="hidden"]')].map((input) => [
      input.getAttribute('name'),
      input.getAttribute('value'),
    ]),
  )
}

describe('the defaults, which the request queue relies on', () => {
  it('submits to the request queue and offers request states', () => {
    // This is what protects `/privacy` from the refactor that made the props
    // configurable. If a later change moved the defaults, the queue's own
    // filter would break in exactly the way the register's was broken.
    const { container } = render(
      <OrganizationPicker organizations={ONE} selectedId={ORGANIZATION} state="" />,
    )

    expect(container.querySelector('form').getAttribute('action')).toBe('/privacy')
    expect(screen.getByRole('option', { name: 'Awaiting confirmation' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Stopped safely' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Held' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Invalidated/u })).toBeNull()
  })
})

describe('the register, which it used to send to the wrong place', () => {
  it('submits back to the register rather than to the queue', () => {
    const { container } = render(
      <OrganizationPicker
        organizations={ONE}
        selectedId={ORGANIZATION}
        state=""
        action="/privacy/exports"
      />,
    )

    expect(container.querySelector('form').getAttribute('action')).toBe('/privacy/exports')
  })

  it('offers artefact states and not one privacy-request state', () => {
    render(
      <OrganizationPicker
        organizations={ONE}
        selectedId={ORGANIZATION}
        state=""
        action="/privacy/exports"
        states={EXPORT_ARTIFACT_STATES}
        stateLabel={(member) => member}
      />,
    )

    for (const member of EXPORT_ARTIFACT_STATES) {
      expect(screen.getByRole('option', { name: member })).toBeInTheDocument()
    }

    // The old vocabulary, which nothing in the register can ever be in.
    for (const wrong of ['REQUESTED', 'QUEUED', 'PROCESSING', 'FAILED_SAFE']) {
      expect(screen.queryByRole('option', { name: wrong })).toBeNull()
    }
  })

  it('takes the label as a function, so both callers pass the same shape', () => {
    render(
      <OrganizationPicker
        organizations={ONE}
        selectedId={ORGANIZATION}
        state=""
        states={['AVAILABLE']}
        stateLabel={(member) => (member === 'AVAILABLE' ? 'Recorded' : member)}
      />,
    )

    expect(screen.getByRole('option', { name: 'Recorded' })).toBeInTheDocument()
  })
})

describe('filters it has no control for', () => {
  it('carries them through, rather than clearing them on Apply', () => {
    const { container } = render(
      <OrganizationPicker
        organizations={ONE}
        selectedId={ORGANIZATION}
        state="AVAILABLE"
        action="/privacy/exports"
        extra={{ kind: 'finance' }}
      />,
    )

    expect(hiddenInputs(container)).toEqual({
      organizationId: ORGANIZATION,
      kind: 'finance',
    })
  })

  it('omits the ones that are not set, rather than submitting an empty value', () => {
    // A hidden `kind=""` would reach the query string and the reader would have
    // to know to ignore it. Absent is the honest encoding of absent.
    const { container } = render(
      <OrganizationPicker
        organizations={ONE}
        selectedId={ORGANIZATION}
        state=""
        action="/privacy/exports"
        extra={{ kind: undefined, page: '' }}
      />,
    )

    expect(hiddenInputs(container)).toEqual({ organizationId: ORGANIZATION })
  })
})
