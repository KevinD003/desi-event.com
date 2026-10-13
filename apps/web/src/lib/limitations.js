/**
 * The capabilities this build does not have, as the public limitations page
 * states them.
 *
 * `status` is the status the project records for each, word for word — the
 * Phase 4 brief's vocabulary, recorded for this build in the §Limitations
 * table of `docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md` (which carries on the
 * table of `docs/PHASE4_FEATURE_COMPLETION_REPORT.md`) — so the page and the
 * report cannot disagree about a word. `meaning` is for somebody using the
 * site: what they will find, and what happens instead.
 *
 * An entry leaves this list only in the change that builds what it names,
 * with that change's tests. Handing on a reserved-seat ticket left it that way
 * (ADR 0006): the seat now goes with the ticket. Adding pictures to a
 * published event left it the same way (ADR 0014): a new picture now appears
 * once somebody other than its uploader approves it.
 *
 * The booking fee, referral codes and paying at the venue (ADRs 0016 and
 * 0017, SPEC3 §15.1 and SPEC3-XI §15) added the entries from
 * `paying-at-the-venue` to `referral-rewards` and `payment-after-cancellation`,
 * and the sentences on them in `payments`, `group-booking`,
 * `live-changes-not-reviewed` and `deleted-events-kept`. The page's "Also"
 * list says what a referral code does and that tickets paid at the venue
 * carry no sales tax.
 *
 * @module lib/limitations
 */

/**
 * A link inside an entry's meaning: `text` is words the meaning already
 * says, word for word, and `href` is where they lead — another entry on the
 * same page, by its `id`.
 *
 * @typedef {object} LimitationLink
 * @property {string} text The words of the meaning that carry the link.
 * @property {string} href Where they lead, such as `#visit-counts`.
 */

/**
 * The recorded limitations, each with its status and what it means.
 *
 * `status` is the recorded status, word for word. `meaning` is for the person
 * using the site: what they will find, and what happens instead. It is plain
 * text, so a test can read it whole; `links` name words in it that lead to
 * another entry.
 *
 * @type {ReadonlyArray<{id: string, name: string, status: string, meaning: string, links?: ReadonlyArray<LimitationLink>}>}
 */
export const LIMITATIONS = Object.freeze([
  {
    id: 'payments',
    name: 'Real payments, Stripe and Connect payouts',
    status: 'EXTERNAL VERIFICATION PENDING',
    meaning:
      'Payments on this site are simulated. No card is asked for, nothing is charged, no refund returns money and no organiser is paid out. The booking fee paid online for tickets paid at the venue is simulated too. The connection to a real payment provider has not been verified against that provider, so this build runs on the simulation alone.',
  },
  {
    id: 'paying-at-the-venue',
    name: 'Refunding money paid at the venue',
    status: 'NOT IMPLEMENTED',
    meaning:
      'When a ticket is paid for at the door, the organiser keeps that money. Desi-Event records the amount but does not hold it and cannot refund it: if the order is refunded, the event is cancelled or a night is called off, only the booking fee paid online is refunded (simulated), and money paid at the door has to be returned by the organiser. A ticket that is not paid for stays booked until the organiser or the Desi-Event team cancels it; its place is then freed and sells again whenever its sales are open, and Desi-Event keeps the booking fee paid online for it. Nothing is cancelled automatically, and a buyer who does not come gets no refund of the booking fee.',
  },
  {
    id: 'tax-on-venue-tickets',
    name: 'Sales tax on tickets paid at the venue',
    status: 'NOT IMPLEMENTED',
    meaning:
      'No sales tax is added to tickets paid at the venue, or to the booking fee paid online for them, and this site does not work out or report sales tax on them. The organiser may still owe sales tax on those sales.',
  },
  {
    id: 'unpaid-bookings',
    name: 'Cancelling your own unpaid booking',
    status: 'NOT IMPLEMENTED',
    meaning:
      'A buyer cannot cancel a booking they have not paid for at the door, and neither can anyone they passed a ticket to: only the organiser or the Desi-Event team can cancel its unpaid tickets, until the ticket’s night (or, for an event with no nights listed, the event) is over. Anybody signed in can book tickets to pay at the door without paying the ticket price, and with a referral code without paying anything online, up to the most unpaid tickets the Desi-Event team allows for that event; that limit, and cancelling, are what stop a booking holding places nobody pays for. The booking fee Desi-Event keeps when unpaid tickets are cancelled is not refunded afterwards, not even by the Desi-Event team.',
  },
  {
    id: 'general-admission-refunds',
    name: 'Putting refunded general-admission places back on sale',
    status: 'NOT IMPLEMENTED',
    meaning:
      'When an order is refunded, its reserved seats go back on sale (except in the 24 hours before the event, when a refunded seat is held back), but its general-admission places do not, so the event can sell that many fewer. Cancelling unpaid tickets booked to pay at the door is the one action that frees general-admission places for someone else.',
  },
  {
    id: 'booking-fee-default',
    name: 'Changing the standard booking fee on a screen',
    status: 'NOT IMPLEMENTED',
    meaning:
      'The booking fee buyers pay is Desi-Event’s charge, not the organiser’s. The Desi-Event team can give an event a booking fee of its own; every other event uses the standard booking fee, in this build 5.90% of the ticket price after any promo discount plus $0.99 a ticket, which is a setting on the server that no screen changes. A change to an event’s booking fee applies to orders placed after it: orders already placed keep the fee they were charged.',
  },
  {
    id: 'referral-rewards',
    name: 'Rewards for referral codes',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Each referral code records the Desi-Event administrator who made it and every order that used it, but nobody is paid for referrals: there are no payouts to administrators.',
  },
  {
    id: 'group-booking',
    name: 'Splitting payment for a group',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Every order is paid for by one person. There is no way to split an order, or for each guest to pay their own share, and a group gets no discount of its own: a lower price comes only from a promo code the organiser has made, or from a referral code from the Desi-Event team, which removes the booking fee. The buyer can put each guest’s name on their ticket, and while they hold between two and fifty tickets on an order that still admit, they can show one group pass at the door for all of them.',
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
    id: 'organiser-sign-up',
    name: 'Asking to become an organiser',
    status: 'NOT IMPLEMENTED',
    meaning:
      'There is no form on this site for asking to become an organiser. The Desi-Event team invites organisers it has agreed to work with, and each invitation carries a code that works once.',
  },
  {
    id: 'live-changes-not-reviewed',
    name: 'Reviewing changes to a published event',
    status: 'NOT IMPLEMENTED',
    meaning:
      'On a published, on-sale, paused, sold-out or postponed event, the organiser — or the Desi-Event team, in an editing session opened with a reason — can change everything without another review, and the change is public when it saves. The date, time, time zone, place, joining link, age limit and entry, refund and conduct terms change only with a reason, and every ticket holder is shown the change on their order page; it is not emailed. Ticket types can be added, edited, re-priced (people who already bought keep what they paid), closed, hidden, or removed if unused. Nights can be added, moved, given another seating map while nothing at them is sold, removed if unused, or cancelled with their tickets refunded. The venue cannot be changed while a night uses a seating map. New pictures appear only after someone on the Desi-Event team other than the person who uploaded them approves each one; the old cover stays until then. (Pictures copied by an import are the exception: the administrator who reviews the import approves them with the event.) A finished or cancelled event keeps its words and pictures editable. The organisation’s venue records can be edited at any time, and every event there shows the new details without review. An event’s website address can be changed at any time; a new address is not linked until an administrator approves it. Promo codes are never reviewed. The Desi-Event team can change an event’s booking fee, and whether it can be paid for at the venue, at any time; people who already booked keep what they paid.',
  },
  {
    id: 'night-cancellation-passes',
    name: 'Refunding part of an every-night ticket',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Cancelling one night refunds the tickets bought for that night. A ticket valid for every night is not refunded in part: its holder keeps it for the other nights and is shown a notice, and the organiser can refund those orders one at a time.',
  },
  {
    id: 'event-refunds-batch',
    name: 'Refunding a large cancelled event in the background',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Refunds caused by deleting an event or cancelling a night are sent while the page waits: up to 500 at a time with simulated payments and 25 at a time with a payment provider. Any left over are sent with “Finish refunds” on the event, or by the organisation’s finance team. An order whose payment is disputed is left to the finance team rather than refunded, so it is not paid back twice.',
  },
  {
    id: 'payment-after-cancellation',
    name: 'Refunding a payment completed after its event was cancelled',
    status: 'NOT IMPLEMENTED',
    meaning:
      'If a card payment is still going through when its event is cancelled, and is completed only afterwards, the order stays paid and is not refunded automatically: the organisation’s finance team can refund it, and deleting the event refunds it too (simulated here).',
  },
  {
    id: 'deleted-events-kept',
    name: 'Erasing a deleted event',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Deleting an event takes it off the site straight away, but its record, pictures, orders and history are kept so the Desi-Event team can restore it and so money stays accounted for. Nothing on this site erases a deleted event; removing somebody’s personal data goes through the privacy process. The reasons people type when deleting, restoring, cancelling a night, editing as the Desi-Event team, changing a booking fee or the pay-at-the-venue setting, refunding a booking fee by hand, switching a referral code off or cancelling unpaid tickets, and referral codes’ labels, are kept as written, and the privacy process does not rewrite them. A deleted event’s pictures stop being served at once, but a copy already in someone’s browser can stay there for up to a day.',
  },
  {
    id: 'imported-events',
    name: 'Keeping imported events up to date',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Some events were copied from their listings on Sulekha.com on 29–30 September 2026 and are shown under “Sulekha Events”, each naming the organiser who presents it. They are not updated automatically: a change made on Sulekha afterwards shows here only when a Desi-Event administrator imports a newer listing. Tickets for them are sold on Sulekha, not here, and their prices are shown as Sulekha listed them on that date. Where Sulekha gave no end time, only the start is shown. Their pictures were copied when they were imported; an event whose pictures could not be copied shows a generated poster. Only events in Texas were copied.',
  },
  {
    id: 'website-link-checks',
    name: 'Checking the organiser’s website itself',
    status: 'NOT IMPLEMENTED',
    meaning:
      'An event’s “Visit the organiser’s website” link appears only after a Desi-Event administrator turns it on for the address the organiser gave. If the organiser changes the address, the link keeps going to the address the administrator approved until an administrator decides on the new one or turns the link off; only administrators turn it on or off. This site checks only that an address is a well-formed https address with a public site name and no sign-in, port or key in it; it does not open, scan or keep watching the site behind it. The switch covers that one link: links written into an event’s description, sponsors’ websites and social accounts are reviewed with the listing before it is published, and changes after publication are not reviewed again; none of them is switched or counted. An organisation’s own website on its organiser page is not switched or counted either. A visit through the link is counted without recording your address, browser or account, and a visit that could not be counted still reaches the site.',
    links: Object.freeze([
      Object.freeze({
        text: 'changes after publication are not reviewed again',
        href: '#live-changes-not-reviewed',
      }),
    ]),
  },
  {
    id: 'email',
    name: 'Email',
    status: 'EXTERNAL VERIFICATION PENDING',
    meaning:
      'This site can email organiser-invitation, team-invitation and ticket-transfer codes, but only when its operator has configured an SMTP mail server; that has been tested only against a local test mail server. Without one, each code is shown once to whoever issues it, and passing it on is up to them; only an organiser-invitation code comes with a ready-to-send message. Receipts, address confirmation and password resets are not emailed in any configuration, so a forgotten password cannot be reset from here. When an event’s date, place or terms change, a night is cancelled, or the event is postponed, cancelled or deleted, a notice is recorded against each order and shown on its order page; it is not emailed. Orders and tickets are on your account pages instead.',
  },
  {
    id: 'sms',
    name: 'Text messages',
    status: 'NOT IMPLEMENTED',
    meaning: 'This site sends no text messages.',
  },
  {
    id: 'retention',
    name: 'Automatic deletion of personal records after a set time',
    status: 'DISABLED',
    meaning:
      'Nothing about a person, an order or a ticket is deleted automatically. The retention job counts what a policy would remove, and removes nothing. The one thing removed on a timer is the raw record of visits to event pages, which holds no address, browser description or account: it is deleted two days after the day it was made, once it has been added up into daily totals.',
    links: Object.freeze([
      Object.freeze({ text: 'the raw record of visits to event pages', href: '#visit-counts' }),
    ]),
  },
  {
    id: 'visit-counts',
    name: 'Counting the same visitor across days, and exact visitor numbers',
    status: 'NOT IMPLEMENTED',
    meaning:
      'Visits to event pages are counted on this site without cookies and without keeping anybody’s address or browser description. A visitor is recognised for one day and one event only, by a code made from their connection and browser with a secret that is deleted from the live database when the day ends. Backups taken during the day keep that secret for as long as the backups are kept. So somebody who comes back another day, or looks at two events, is counted again. Robots, and organisers’ teams and Desi-Event staff while signed in, are not counted at all; people whose browser asks not to be tracked are counted as page views only, never as visitors. A browser that runs no JavaScript is not counted, and neither are some blocked visits. The record of each visit is deleted two days after the day it happened, by the job that adds visits up, once it has been added up. Only the daily totals are kept. Figures are brought up to date by that background job, so the newest visits appear later, and each analytics screen says when its figures run to. Days are UTC days. Somebody determined to can make visits look like more people than they are, so the figures are a guide, not an audit.',
  },
])

/**
 * An entry's meaning cut into runs of plain text and links, in order, so the
 * page can render the links its `links` name.
 *
 * A link whose words the meaning does not contain is an error in the list, not
 * something to drop quietly: the test of this module holds every link to its
 * meaning.
 *
 * @param {{meaning: string, links?: ReadonlyArray<LimitationLink>}} limitation One entry.
 * @returns {Array<{text: string, href?: string}>} The runs; a run with `href` is a link.
 */
export function meaningParts(limitation) {
  const runs = []
  let rest = limitation.meaning

  for (const link of limitation.links ?? []) {
    const at = rest.indexOf(link.text)

    if (at === -1) {
      throw new Error(`The meaning does not contain the link text “${link.text}”.`)
    }
    if (at > 0) runs.push({ text: rest.slice(0, at) })
    runs.push({ text: link.text, href: link.href })
    rest = rest.slice(at + link.text.length)
  }
  if (rest !== '') runs.push({ text: rest })

  return runs
}
