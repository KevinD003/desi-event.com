/**
 * The capabilities this build does not have, as the public limitations page
 * states them.
 *
 * `status` is the status the project records for each, word for word — the
 * Phase 4 brief's vocabulary, repeated in its report — so the page and the
 * report cannot disagree about a word. `meaning` is for somebody using the
 * site: what they will find, and what happens instead.
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
    id: 'seat-transfer',
    name: 'Handing on a reserved-seat ticket',
    status: 'BLOCKED — UNIQUE-SEAT TRANSFER DEFECT',
    meaning:
      'A ticket for a numbered seat cannot be handed to somebody else. Each seat can hold one ticket, and handing one on would briefly need two; until that is solved safely, the offer is refused. The ticket stays with its buyer and still admits them. General-admission tickets can be offered.',
  },
  {
    id: 'group-booking',
    name: 'Group booking',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Every order is paid for by one person. There is no way to split an order, have each guest pay their share, or collect each guest’s details.',
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
      'The pass and the door scanner have been tested in a simulated browser, not with real phones held up to real cameras. At the door, a steward can type the code printed on the ticket instead.',
  },
  {
    id: 'camera',
    name: 'Door scanning in Safari and Firefox',
    status: 'EXTERNAL DEVICE VERIFICATION PENDING',
    meaning:
      'Scanning with the camera has been checked in Chromium-based browsers only. Where the camera does not work, the door page takes the code typed in.',
  },
  {
    id: 'email',
    name: 'Email',
    status: 'NOT IMPLEMENTED',
    meaning:
      'This site sends no email: no receipts, no address confirmation, no password resets, no team invitations, and no invitation codes for a ticket that has been offered. A forgotten password cannot be reset from here. Orders and tickets are on your account pages instead.',
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
