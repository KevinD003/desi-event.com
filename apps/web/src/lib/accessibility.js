/**
 * How each accessibility claim reads to a person.
 *
 * Written as statements of fact rather than as labels, so the list reads as a
 * set of promises a venue or an organiser is making and can be held to:
 * "step-free entrance" is checkable, "accessible" is an opinion.
 *
 * This lives here rather than beside one page because two pages show the same
 * claims — a venue's, and an event's layered over them — and two copies of a
 * label map is how one of them ends up rendering `WHEELCHAIR_SPACES` at a
 * wheelchair user.
 *
 * The keys mirror `ACCESSIBILITY_FEATURES` in `@desi-event/schemas/venues`.
 * They are listed rather than derived because the vocabulary is the contract
 * and the prose is a translation of it: a new claim should fail to render a
 * friendly label until somebody writes one.
 *
 * @module lib/accessibility
 */

/** @type {Readonly<Record<string, string>>} */
export const ACCESSIBILITY_LABELS = Object.freeze({
  STEP_FREE_ENTRANCE: 'Step-free entrance',
  STEP_FREE_TO_SEATING: 'Step-free route to the seating',
  ACCESSIBLE_TOILET: 'Accessible toilet',
  ACCESSIBLE_PARKING: 'Accessible parking',
  WHEELCHAIR_SPACES: 'Wheelchair spaces',
  COMPANION_SEATING: 'Companion seating',
  HEARING_LOOP: 'Hearing loop',
  AUDIO_DESCRIPTION: 'Audio description',
  SIGN_LANGUAGE: 'Sign language interpretation',
  CAPTIONING: 'Captioning',
  QUIET_SPACE: 'Quiet space',
  ASSISTANCE_DOGS_WELCOME: 'Assistance dogs welcome',
  LIFT_ACCESS: 'Lift access',
  SEATED_ONLY: 'Seated only',
  STANDING_ONLY: 'Standing only',
})

/**
 * The readable form of one accessibility claim.
 *
 * Falls back to the code itself rather than dropping the claim: an unfamiliar
 * code shown verbatim is ugly, and silently omitting it would hide a fact
 * somebody is relying on.
 *
 * @param {string} code A value from `ACCESSIBILITY_FEATURES`.
 * @returns {string} The sentence to show.
 */
export function accessibilityLabel(code) {
  return ACCESSIBILITY_LABELS[code] ?? code
}

/**
 * Merge an event's accessibility claims with its venue's.
 *
 * The event's are *additional*, not a replacement: a venue with a hearing loop
 * still has one when the organiser adds captioning. Both notes are kept and
 * attributed, because "ring the bell at Gate 3" and "this performance is
 * captioned" answer different questions and neither substitutes for the other.
 *
 * @param {object|null} [event] The public event payload.
 * @returns {{features: string[], notes: Array<{source: string, text: string}>}} The merged claims.
 */
export function mergedAccessibility(event) {
  const venueFeatures = event?.venue?.accessibility?.features ?? []
  const eventFeatures = event?.accessibility?.features ?? []

  /** @type {Array<{source: string, text: string}>} */
  const notes = []
  const venueNote = event?.venue?.accessibility?.note
  const eventNote = event?.accessibility?.note

  if (venueNote) notes.push({ source: 'At the venue', text: venueNote })
  if (eventNote) notes.push({ source: 'For this event', text: eventNote })

  return { features: [...new Set([...venueFeatures, ...eventFeatures])], notes }
}
