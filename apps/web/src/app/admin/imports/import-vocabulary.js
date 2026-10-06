/**
 * The words of the import pages (SPEC2-XI I-H): what a plan row will do,
 * where a run stands, how each picture's copying went, and what "Approve and
 * publish" did for each event.
 *
 * Pure, with no imports, so the server pages and the client actions read the
 * same sentences.
 *
 * `@file` rather than `@module`: `import` is a reserved token in a JSDoc
 * namepath.
 *
 * @file app/admin/imports/import-vocabulary
 */

/** What a session without `event:import` is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Events listed on other sites are imported by the Desi-Event team’s platform administrators. Nothing on this page can grant it.'

/** The path of the imports list. */
export const IMPORTS_PATH = '/admin/imports'

/**
 * A run's own page.
 *
 * @param {string} runId The run.
 * @returns {string} Its path.
 */
export function runPath(runId) {
  return `${IMPORTS_PATH}/${encodeURIComponent(runId)}`
}

/** Where a run stands, in words, with a badge tone. */
export const RUN_STATUSES = Object.freeze({
  PREVIEWED: { label: 'Planned, not applied', tone: 'info' },
  APPLIED: { label: 'Applied', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
})

/**
 * What applying a plan does to one listing: a short label and a sentence.
 *
 * Every action the API can plan has an entry.
 */
export const PLAN_ACTIONS = Object.freeze({
  CREATE: {
    label: 'New',
    tone: 'success',
    detail: 'Created as a draft and sent for review.',
  },
  UPDATE_DRAFT: {
    label: 'Update',
    tone: 'info',
    detail: 'Not published: updated from the listing and sent for review.',
  },
  UNCHANGED: {
    label: 'Unchanged',
    tone: 'neutral',
    detail: 'The listing has not changed since it was last imported.',
  },
  POSTED_KEPT: {
    label: 'Published, kept',
    tone: 'neutral',
    detail: 'Already published, so it is left as it is.',
  },
  UPDATE_POSTED: {
    label: 'Published, updated',
    tone: 'warning',
    detail: 'Already published: its public page is updated from the listing.',
  },
  SKIPPED_DECIDED: {
    label: 'Skipped',
    tone: 'neutral',
    detail:
      'A reviewer has decided this version. Approve and publish it, or delete it, before importing it again.',
  },
  SKIPPED_DELETED: {
    label: 'Skipped',
    tone: 'neutral',
    detail: 'It was imported and then deleted.',
  },
  SKIPPED_REASSIGNED: {
    label: 'Skipped',
    tone: 'neutral',
    detail:
      'It has been moved to an organiser’s own organisation, so the listing no longer updates it.',
  },
  SKIPPED_PAST: {
    label: 'Skipped',
    tone: 'neutral',
    detail: 'Its date has passed.',
  },
  INVALID: {
    label: 'Cannot be imported',
    tone: 'danger',
    detail: 'The listing cannot be imported as it is.',
  },
})

/** The actions that write an event when the plan is applied. */
const WRITING = new Set(['CREATE', 'UPDATE_DRAFT', 'UNCHANGED'])

/**
 * How a plan row reads.
 *
 * @param {object} row A run row.
 * @returns {{label: string, tone: string, detail: string}} The reading.
 */
export function planReading(row) {
  const reading = PLAN_ACTIONS[row?.action] ?? {
    label: row?.action ?? 'Unknown',
    tone: 'neutral',
    detail: 'This build does not recognise what the plan says for this listing.',
  }

  if (row?.action === 'INVALID' && row.problem) return { ...reading, detail: row.problem }
  if (row?.action === 'UNCHANGED' && row.resubmit) {
    return { ...reading, detail: `${reading.detail} It is sent for review again.` }
  }
  if (row?.action === 'POSTED_KEPT' && row.updatable) {
    return {
      ...reading,
      detail:
        'Already published, and its listing has changed. Tick “Update from Sulekha” to copy the changes onto its public page; otherwise it is left as it is.',
    }
  }

  return reading
}

/**
 * How many of a plan's rows applying it would write.
 *
 * @param {object[]} rows The run's rows.
 * @param {string[]} [updateFromSource] The posted rows ticked to update.
 * @returns {number} The count.
 */
export function writtenCount(rows, updateFromSource = []) {
  const ticked = new Set(updateFromSource)

  return (rows ?? []).filter(
    (row) => WRITING.has(row.action) || (row.updatable && ticked.has(row.sourceId)),
  ).length
}

/** A picture's copying, in words. */
export const PICTURE_STATUSES = Object.freeze({
  WAITING: { label: 'Waiting to be copied', tone: 'neutral' },
  STORED: { label: 'Copied', tone: 'success' },
  FAILED: { label: 'Not copied', tone: 'danger' },
})

/** A stored picture's approval, in words. */
export const MEDIA_STATUSES = Object.freeze({
  PENDING: 'waiting for approval',
  APPROVED: 'approved',
  REJECTED: 'refused',
})

/** Why a picture was not copied, by the API's code. */
const FAILURES = Object.freeze({
  HOST_NOT_ALLOWED: 'Its address is not on Sulekha’s picture host.',
  ADDRESS_NOT_PUBLIC: 'Its address does not lead to a public server.',
  NETWORK_UNAVAILABLE: 'Sulekha’s picture host could not be reached.',
  TIMEOUT: 'Sulekha’s picture host took too long to answer.',
  REDIRECT_OFF_LIST: 'It redirected to an address off Sulekha’s picture host.',
  TOO_MANY_REDIRECTS: 'It redirected too many times.',
  NOT_AN_IMAGE: 'What came back was not a picture.',
  TOO_LARGE: 'It is larger than 10 MiB.',
  GALLERY_FULL: 'The event’s gallery is full.',
  MEDIA_QUOTA_EXCEEDED: 'The organisation’s picture allowance is used up.',
  NOT_EDITABLE: 'The event has moved on since, so the picture was not added.',
  NOT_PLATFORM_HELD: 'The event has been moved to an organiser, so the picture was not added.',
})

/**
 * Why a picture was not copied, in a sentence.
 *
 * @param {string|null|undefined} code The API's failure code.
 * @returns {string|null} The sentence, or null for no code.
 */
export function failureReason(code) {
  if (!code) return null
  if (FAILURES[code]) return FAILURES[code]

  const http = /^HTTP_(\d{3})$/u.exec(code)

  if (http) return `Sulekha answered with status ${http[1]}.`
  if (code.startsWith('SANITISER_REFUSED:')) {
    return `The picture checks refused it (${code.slice('SANITISER_REFUSED:'.length)}).`
  }

  return `It was not copied (${code}).`
}

/**
 * What "Approve and publish" did for one event.
 *
 * @param {{outcome: string, picturesApproved?: number, message?: string|null}} result One result.
 * @param {string} title The event's title.
 * @returns {string} The sentence.
 */
export function approveSentence(result, title) {
  if (result.outcome === 'PUBLISHED') {
    return `${title}: approved and published, with its Sulekha ticket link on.`
  }
  if (result.outcome === 'PICTURES_APPROVED') {
    const count = result.picturesApproved ?? 0

    return `${title}: ${count} ${count === 1 ? 'picture' : 'pictures'} approved.`
  }

  return `${title}: not published. ${result.message ?? 'The API refused it.'}`
}
