/**
 * How to reach the team at The Desi Events, as the footer, the contact page
 * and the home page's structured data all say it.
 *
 * These are the owner's own public channels, as published on
 * https://thedesievents.com: one email address, one telephone number that is
 * also the WhatsApp number, and the Facebook and Instagram pages. They are
 * public on purpose, so they are written here once rather than read from
 * anywhere: nothing about a visitor, an order or an account is in them.
 *
 * Nothing here promises how quickly anybody answers, and the site has no
 * contact form: it does not send contact email. Each channel is a plain link
 * that opens the visitor's own mail app, phone, WhatsApp or browser.
 *
 * @module lib/contact
 */

/** The company's name, as it is written everywhere: capital T, singular verb. */
export const BRAND_NAME = 'The Desi Events'

/** The company's own website. */
export const BRAND_URL = 'https://thedesievents.com'

/** The public email address. */
export const CONTACT_EMAIL = 'info@thedesievents.com'

/** The public telephone number, as people read it. */
export const CONTACT_PHONE = '+1 972 694 9043'

/** The same number in E.164, for `tel:` and structured data. */
export const CONTACT_PHONE_E164 = '+19726949043'

/** The WhatsApp chat for that number. */
export const WHATSAPP_URL = 'https://wa.me/19726949043'

/** The Facebook page. */
export const FACEBOOK_URL = 'https://www.facebook.com/the.desievents'

/** The Instagram profile. */
export const INSTAGRAM_URL = 'https://www.instagram.com/the.desievents'

/**
 * @typedef {object} ContactChannel
 * @property {string} id A stable key.
 * @property {string} kind What the channel is, as a word: "Email", "Phone"…
 * @property {string} text The footer link's visible text: short, for a narrow column.
 * @property {string} label The footer link's accessible name: where it goes.
 *   It always contains `text`, so a speech-input user can say what they see
 *   (WCAG 2.5.3).
 * @property {string} address The address or number in full, as the contact
 *   page shows it.
 * @property {string} href Where the link goes.
 */

/**
 * Every channel, in the order the footer and the contact page list them.
 *
 * @type {ReadonlyArray<ContactChannel>}
 */
export const CONTACT_CHANNELS = Object.freeze([
  Object.freeze({
    id: 'email',
    kind: 'Email',
    text: CONTACT_EMAIL,
    label: `Email ${CONTACT_EMAIL}`,
    address: CONTACT_EMAIL,
    href: `mailto:${CONTACT_EMAIL}`,
  }),
  Object.freeze({
    id: 'phone',
    kind: 'Phone',
    text: CONTACT_PHONE,
    label: `Call ${CONTACT_PHONE}`,
    address: CONTACT_PHONE,
    href: `tel:${CONTACT_PHONE_E164}`,
  }),
  Object.freeze({
    id: 'whatsapp',
    kind: 'WhatsApp',
    text: 'WhatsApp',
    label: `WhatsApp ${CONTACT_PHONE}`,
    address: CONTACT_PHONE,
    href: WHATSAPP_URL,
  }),
  Object.freeze({
    id: 'facebook',
    kind: 'Facebook',
    text: 'Facebook',
    label: `${BRAND_NAME} on Facebook`,
    address: 'facebook.com/the.desievents',
    href: FACEBOOK_URL,
  }),
  Object.freeze({
    id: 'instagram',
    kind: 'Instagram',
    text: 'Instagram',
    label: `${BRAND_NAME} on Instagram`,
    address: 'instagram.com/the.desievents',
    href: INSTAGRAM_URL,
  }),
])

/**
 * The accessible name a channel's link has on the contact page, where the
 * link's visible text is the full address: the footer's name when that holds
 * the address ("Call +1 972 694 9043"), and otherwise the address itself,
 * which already says where the link goes.
 *
 * @param {ContactChannel} channel A channel.
 * @returns {string|undefined} An `aria-label`, or undefined to use the text.
 */
export function pageLabel(channel) {
  return channel.label.includes(channel.address) ? channel.label : undefined
}

/**
 * The company as schema.org structured data, for the home page.
 *
 * Only what is published on the company's own site: its name, address on the
 * web, email, telephone and social profiles. No logo is named, because none
 * is published here to point at.
 *
 * @returns {object} An `Organization` for a JSON-LD block.
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: BRAND_URL,
    email: CONTACT_EMAIL,
    telephone: CONTACT_PHONE_E164,
    sameAs: [FACEBOOK_URL, INSTAGRAM_URL],
  }
}
