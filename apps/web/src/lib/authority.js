/**
 * What platform-wide authority a session carries, in words, for the
 * workspace's bar.
 *
 * Two people can open the same organiser screen with very different reach: an
 * organiser sees their own organisation's events, a platform administrator can
 * act on every organisation's. The screen looks the same to both, so the bar
 * says which one you are, all the time, rather than leaving it to be
 * remembered: a "Platform administrator" badge, or the gold "Super
 * administrator" marker for the one role that can also change anybody's
 * platform role (ADR 0018).
 *
 * Read from the capabilities `GET /v1/auth/me` returns, the same list every
 * other offer in the navigation is read from: `platform:role_manage` is held
 * by super administrators alone (`SUPER_ADMIN_ONLY_CAPABILITIES`), and
 * `platform:admin` by platform administrators and super administrators.
 *
 * Like the rest of the navigation this decides nothing. The API authorises
 * every request, with a recent second factor for every change; the badge only
 * tells the person what the API will let them do.
 *
 * @module lib/authority
 */

/**
 * @typedef {object} Authority
 * @property {'super'|'admin'} level Which marker the bar draws.
 * @property {string} label The badge's words.
 * @property {string} line The sentence under the bar, said on every workspace page.
 */

/** The two platform roles that reach every organisation, in words. */
export const AUTHORITIES = Object.freeze({
  super: Object.freeze({
    level: 'super',
    label: 'Super administrator',
    line: 'You can act on every organisation on the platform and change anybody’s platform role. Each change is recorded against your account.',
  }),
  admin: Object.freeze({
    level: 'admin',
    label: 'Platform administrator',
    line: 'You can act on every organisation on the platform. Each change is recorded against your account.',
  }),
})

/**
 * The platform authority a session carries, if any.
 *
 * @param {object|null} session The session payload.
 * @returns {Authority|null} The authority, or null for anybody whose reach is their own organisations'.
 */
export function platformAuthority(session) {
  const capabilities = session?.capabilities ?? []

  if (capabilities.includes('platform:role_manage')) return AUTHORITIES.super
  if (capabilities.includes('platform:admin')) return AUTHORITIES.admin

  return null
}
