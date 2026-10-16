/**
 * The icon each navigation destination is drawn with, by its address.
 *
 * Pure and import-free, so the client rail can read it without pulling the
 * capability tables into the browser (`lib/browser-bundle.js`). The words
 * beside each icon are the link's name; the icon is decoration, there so a
 * collapsed rail can still be read at a glance and so the eye finds an entry
 * in a long list by shape. Every name here is a glyph `@desi-event/ui/icons`
 * draws; `nav-icons.test.js` holds both that and that every destination the
 * navigation offers has one.
 *
 * @module lib/nav-icons
 */

/**
 * Glyph names by destination.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const NAV_ICONS = Object.freeze({
  // The workspace.
  '/organizer': 'home',
  '/organizer/events': 'calendar',
  '/organizer/venues': 'venue',
  '/organizer/check-in': 'scan',
  '/organizer/organization': 'flag',
  '/organizer/team': 'users',
  '/organizer/promo-codes': 'ticket',
  '/analytics': 'chart',
  '/analytics/events': 'eye',
  '/finance': 'wallet',
  '/operations': 'inbox',
  '/operations/notifications': 'bell',
  '/moderation/events': 'shield',
  '/privacy': 'lock',
  '/retention': 'clock',
  '/moderation/organizations': 'verified',
  '/moderation/pictures': 'camera',
  '/moderation/websites': 'link',
  '/admin': 'settings',
  '/admin/organizer-invitations': 'mail',
  '/admin/events': 'globe',
  '/admin/referral-codes': 'spark',
  '/admin/fee-refunds': 'receipt',
  '/admin/imports': 'upload',
  '/admin/users': 'person',
  // The attendee's own pages.
  '/account': 'home',
  '/tickets': 'ticket',
  '/account/orders': 'receipt',
  '/account/transfers': 'arrow-up-right',
  '/account/security': 'shield',
  '/account/privacy': 'lock',
})

/** What a destination with no icon of its own is drawn with. */
export const FALLBACK_NAV_ICON = 'arrow-right'

/**
 * The glyph for a destination.
 *
 * @param {string} href The destination, as the navigation offers it.
 * @returns {string} A glyph name.
 */
export function navIcon(href) {
  return NAV_ICONS[href] ?? FALLBACK_NAV_ICON
}
