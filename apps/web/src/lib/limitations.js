/**
 * The capabilities this build does not have, as the public limitations page
 * states them.
 *
 * `status` is the status the project records for each, word for word — the
 * Phase 4 brief's vocabulary, recorded for this build in the §Limitations
 * table of `docs/PHASE4_FEATURE_COMPLETION_REPORT.md` — so the page and the
 * report cannot disagree about a word. `meaning` is for somebody using the
 * site: what they will find, and what happens instead.
 *
 * An entry leaves this list only in the change that builds what it names,
 * with that change's tests. Handing on a reserved-seat ticket left it that way
 * (ADR 0006): the seat now goes with the ticket.
 *
 * @module lib/limitations
 */

/**
 * The recorded limitations, each with its status and what it means.
 *
 * `status` is the recorded status, word for word. `meaning` is for the person
 * using the site: what they will find, and what happens instead.
 *
 * @type {ReadonlyArray<{id: string, name: string, status: string, meaning: string}>}
 */
export const LIMITATIONS = Object.freeze([
  {
    id: 'payments',
    name: 'Real payments, Stripe and Connect payouts',
    status: 'EXTERNAL VERIFICATION PENDING',
    meaning:
      'Payments on this site are simulated. No card is asked for, nothing is charged, no refund returns money and no organiser is paid out. The connection to a real payment provider has not been verified against that provider, so this build runs on the simulation alone.',
  },
  {
    id: 'group-booking',
    name: 'Splitting payment for a group',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Every order is paid for by one person. There is no way to split an order, or for each guest to pay their own share, and a group gets no discount of its own: a lower price comes only from a promo code the organiser has made. The buyer can put each guest’s name on their ticket, and while they hold between two and fifty tickets on an order that still admit, they can show one group pass at the door for all of them.',
  },
  {
    id: 'offline-admission',
    name: 'Check-in without a connection',
    status: 'NOT IMPLEMENTED',
    meaning:
      'The door check-in asks this site about every ticket. A steward’s device without a connection cannot admit anybody, and nothing is stored on the device to decide entry later.',
  },
  {
    id: 'physical-qr',
    name: 'Ticket passes on real phones',
    status: 'EXTERNAL DEVICE VERIFICATION PENDING',
    meaning:
      'Neither a ticket’s pass nor the group pass has been tried with a real phone held up to a real camera. The pass and the door scanner have been tested in a simulated browser only. At the door, a steward can type the code printed on the ticket or on the group pass instead.',
  },
  {
    id: 'camera',
    name: 'Door scanning in Safari and Firefox',
    status: 'EXTERNAL DEVICE VERIFICATION PENDING',
    meaning:
      'Scanning with the camera has been checked in Chromium-based browsers only. Where the camera does not work, the door page takes the code typed in.',
  },
  {
    id: 'image-scanning',
    name: 'Virus scanning of uploaded pictures',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Pictures an organiser uploads are checked to be a real JPEG, PNG or WebP, rebuilt from their image data alone and stripped of camera, location and other hidden details before anyone sees them. They are not run through an antivirus engine; a moderator reviews each one before it appears on a public page.',
  },
  {
    id: 'pictures-after-publication',
    name: 'Adding pictures to a published event',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Once an event is published its pictures can be described again, reordered or removed, but a new picture cannot be added or swapped in, because every new picture is reviewed with the event.',
  },
  {
    id: 'email',
    name: 'Email',
    status: 'NOT IMPLEMENTED',
    meaning:
      'This site sends no email: no receipts, no address confirmation and no password resets. A forgotten password cannot be reset from here. When you invite somebody to your team or offer somebody a ticket, you are shown its invitation code once, and passing it on is up to you. When an event’s date, place or terms change, or it is postponed or cancelled, a notice is recorded against each order and not sent. Orders and tickets are on your account pages instead.',
  },
  {
    id: 'sms',
    name: 'Text messages',
    status: 'NOT IMPLEMENTED',
    meaning: 'This site sends no text messages.',
  },
  {
    id: 'retention',
    name: 'Automatic deletion after a set time',
    status: 'DISABLED',
    meaning:
      'Nothing is deleted automatically. The retention job counts what a policy would remove, and removes nothing.',
  },
])
