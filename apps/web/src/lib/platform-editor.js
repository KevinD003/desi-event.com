/**
 * Where the team at The Desi Events edits an organisation's event: its own editor at
 * `/admin/events/[id]`, never the organiser's at `/organizer/events/[id]`
 * (SPEC2-XI O9).
 *
 * The organiser's editor and its danger zone act as the organisation, through
 * membership. A platform administrator who is not a member of the event's
 * organisation would find every control there acting under an authority they
 * do not have; the platform editor opens an editing session with a reason
 * instead. So such a reader is sent there.
 *
 * Server-only: it names a platform capability, which no client module may.
 * None of this is authorisation; the API decides every request again.
 *
 * @module lib/platform-editor
 */

/** The platform capability that edits a posted event in a sitting. */
const PLATFORM_EDIT = 'event:platform_edit'

/**
 * The event id in an organiser editor's path, or null for any other path.
 *
 * @param {string|null|undefined} path A request path, with or without a query.
 * @returns {string|null} The id; null for `/organizer/events/new` and anything else.
 */
export function organizerEventIdFromPath(path) {
  if (typeof path !== 'string') return null

  const pathname = path.split(/[?#]/u)[0]
  const match = /^\/organizer\/events\/([^/]+)\/?$/u.exec(pathname)

  if (!match) return null

  let id

  try {
    id = decodeURIComponent(match[1])
  } catch {
    return null
  }

  return id && id !== 'new' ? id : null
}

/**
 * Whether this session edits events as the team at The Desi Events, through its
 * platform role.
 *
 * @param {object|null} session The session payload.
 * @returns {boolean} True for a platform administrator or super administrator.
 */
export function editsAsPlatform(session) {
  return (session?.capabilities ?? []).includes(PLATFORM_EDIT)
}

/**
 * Whether this session belongs to an organisation at all.
 *
 * @param {object|null} session The session payload.
 * @param {string} organizationId The organisation.
 * @returns {boolean} True when one of its memberships is there.
 */
export function belongsTo(session, organizationId) {
  return (session?.memberships ?? []).some(
    (membership) => membership.organizationId === organizationId,
  )
}

/**
 * Where a reader of an organiser's editor should be sent instead, if anywhere.
 *
 * @param {object|null} session The session payload.
 * @param {{id: string, organizationId: string}|null} event The event the path names.
 * @returns {string|null} `/admin/events/<id>` for a platform editor who is not a member; null otherwise.
 */
export function platformEditorRedirect(session, event) {
  if (!event?.id || !event.organizationId) return null
  if (!editsAsPlatform(session) || belongsTo(session, event.organizationId)) return null

  return `/admin/events/${encodeURIComponent(event.id)}`
}
