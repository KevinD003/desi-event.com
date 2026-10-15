/**
 * How to reach The Desi Events, as the browser suites check it.
 *
 * The footer on every page and the `/contact` page link to the company's own
 * public channels: one email address, one telephone number that is also its
 * WhatsApp number, and its Facebook and Instagram pages. They are public on
 * purpose — the owner publishes them on https://thedesievents.com — and none
 * of them belongs to an organiser, a buyer or an account.
 *
 * Written here as literals rather than imported from `src/lib/contact.js`, so
 * a change to the product's channels is a change these suites notice.
 *
 * @module e2e/support/company-contact
 */

/** The company's public email address. */
export const COMPANY_EMAIL = 'info@thedesievents.com'

/** The one `mailto:` link the site may carry: the company's own address. */
export const COMPANY_MAILTO = `mailto:${COMPANY_EMAIL}`

/**
 * Every `mailto:` link except the company's own.
 *
 * The guards that once refused any `mailto:` on a page — no invented address,
 * no organiser's account email, no way to write to anybody the site cannot
 * vouch for — use this instead. It allows exactly one href, the company's
 * public address above, because that address is published by the company
 * itself; every other `mailto:`, an organiser's included, is still refused.
 */
export const OTHER_MAILTO = `a[href^="mailto:"]:not([href="${COMPANY_MAILTO}"])`

/**
 * Each channel: what the footer's link is called and where it goes, and what
 * the contact page's link is called (its full address, or the footer's name
 * where that already holds the address).
 *
 * @type {ReadonlyArray<{kind: string, footerName: string, pageName: string, href: string}>}
 */
export const COMPANY_CHANNELS = Object.freeze([
  Object.freeze({
    kind: 'Email',
    footerName: `Email ${COMPANY_EMAIL}`,
    pageName: `Email ${COMPANY_EMAIL}`,
    href: COMPANY_MAILTO,
  }),
  Object.freeze({
    kind: 'Phone',
    footerName: 'Call +1 972 694 9043',
    pageName: 'Call +1 972 694 9043',
    href: 'tel:+19726949043',
  }),
  Object.freeze({
    kind: 'WhatsApp',
    footerName: 'WhatsApp +1 972 694 9043',
    pageName: 'WhatsApp +1 972 694 9043',
    href: 'https://wa.me/19726949043',
  }),
  Object.freeze({
    kind: 'Facebook',
    footerName: 'The Desi Events on Facebook',
    pageName: 'facebook.com/the.desievents',
    href: 'https://www.facebook.com/the.desievents',
  }),
  Object.freeze({
    kind: 'Instagram',
    footerName: 'The Desi Events on Instagram',
    pageName: 'instagram.com/the.desievents',
    href: 'https://www.instagram.com/the.desievents',
  }),
])
