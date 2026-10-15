# ADR 0008 — Invitation and transfer codes are shown once to whoever issues them

- **Status:** Accepted; its `EMAIL`-mode wording superseded by ADR 0011, 2026-10-06
- **Date:** 2026-09-29
- **Supersedes:** nothing. It reverses a rule that was never an ADR: "the
  one-time token is delivered out of band and never appears in a response",
  stated in `docs/api.md`, `docs/CHECK_IN.md` and the ticket screens since
  Phase 2.
- **Related:** ADR 0007; finding NF-10 and "Credentials and tokens" in
  `docs/SECURITY.md`

## Context

Two things in this system are handed from one person to another with a
single-use secret: an invitation to join an organisation's team, and an offer
of a ticket. Both were designed to be _delivered_ — a provider would send the
code to the recipient's address — and both routes handed the code only to a
`deliver` hook.

This build wires no delivery provider (`apps/api/src/server.js` calls
`buildApp` without one). So every team invitation and every ticket offer minted
a code that nobody could ever receive: the invitation was unusable, the offer
could never be accepted, and nothing told the person who made it. The
limitations page said so ("no team invitations, and no invitation codes for a
ticket that has been offered"), which was honest and left both features dead.

Wiring an email provider is outside what this build may do: it sends no email
at all.

## Decision

**A delivery mode, decided once at boot, and in `MANUAL` mode the code is shown
once to whoever issued it.**

1. **`DELIVERY_MODE` is `MANUAL` or `EMAIL`.** `resolveDeliveryMode` in
   `apps/api/src/lib/delivery.js`: unset with no provider is `MANUAL`; unset
   with a provider is `EMAIL`; an explicit `MANUAL` is `MANUAL`; an explicit
   `EMAIL` with no provider **refuses to boot**, because an invitation silently
   dropped is worse than a deployment that will not start. `buildApp`
   decorates the result as `app.deliveryMode`; the team and ticket routes both
   read it. This build runs `MANUAL`.
2. **One response shape for every code-issuing route.** `teams.invite`,
   `teams.reissueInvitation` and `tickets.startTransfer` answer 201 with
   `data.delivery = { mode, invitationCode }`. In `MANUAL`, `invitationCode` is
   the code — 32 random bytes in base64url, 43 characters, pinned by
   `invitationCodeSchema` so no other shape (a digest, say) can travel under
   that name. In `EMAIL` it is `null`, and the discriminated union refuses a
   code on that branch, so a presenter mistake fails the contract rather than
   leaking.
3. **Once, in that response only.** Sent with `cache-control: no-store,
private` and `pragma: no-cache` (the web proxy forwards both). The database
   keeps only the SHA-256 digest (`Invitation.tokenHash`,
   `TicketTransfer.tokenHash`), so nobody — the issuer included — can be shown
   the code again. A lost team code is replaced with `teams.reissueInvitation`,
   which withdraws the old invitation and issues a new code in one
   transaction; a lost transfer code means withdrawing the offer and making a
   new one.
4. **Never written down.** Not in a log line (`invitationCode` is on both
   logger redaction lists), not in an audit row (`deliveryMode` is recorded,
   never the code or its digest), not in the notification outbox, not in a URL.
   `Invitation.deliveryMode` records how each invitation's code went out.
5. **The recipient must be signed in at the invited address.** A code passed to
   somebody else does not work for them, which is what stops an invitation
   becoming a transferable key. Codes are single-use, enforced by a conditional
   update. Team invitations lapse after 14 days, ticket offers after 72 hours,
   and both can be withdrawn.
6. **One panel draws it.** `apps/web/src/components/one-time-code-panel.jsx`,
   shared by the team screen and the ticket screen. The code lives in React
   state only — never `localStorage`, `sessionStorage`, a URL or a link — with
   a copy button, the place the recipient types it in, and "I have handed it
   over", which drops it. The recipient types it into a password field on
   `/account/invitations` or `/tickets/accept`, which sends it in a request
   body and reads no query parameter.

## Evidence

- `apps/api/src/lib/delivery.test.js`: every row of the mode table, including
  the refusal to boot.
- `apps/api/tests/teams.test.js`: an owner's invitation returns the code once,
  its digest matches the stored `tokenHash`, the response is `no-store`, and
  the member list never carries it; reissue withdraws the old code.
- `apps/api/tests/ticket-lifecycle.test.js`: the transfer's 201 carries
  `delivery.invitationCode`, never `token` or `tokenHash`, and the outbox
  payload carries no code.
- `apps/api/tests/team-invitation-integration.test.js` (real PostgreSQL): one
  live invitation per address, concurrent invitations and acceptances.
- `packages/logger/src/redaction.test.js`: `invitationCode` is redacted.
- `apps/web/src/lib/e2e-code-hygiene.test.js`: an end-to-end spec that reaches
  a team invitation code must turn screenshots, traces and video off for the
  whole file.

## Consequences

- **Both features work without email.** A team can be built by inviting
  people, and a ticket can be handed on, including a reserved seat (ADR 0006).
- **The issuer becomes a holder of the secret.** That is the price of having
  no provider, and it is stated on the screen: shown once, pass it on
  privately, treat it like a password.
- **This build cannot confirm that anybody owns an address.** It sends no
  email, so a registration is not proof of the address it names. Somebody who
  obtains a code and registers the invited address before its owner does can
  accept it. What bounds that: the code is single-use and expires, a reissue
  or withdrawal kills it, every acceptance is audited, and an owner can remove
  a member who should not be there. The limitations page says the site sends
  no email and that passing the code on is up to the person shown it.
- **`EMAIL` mode is a contract, not a feature.** It exists so a deployment that
  wires a provider gets the old behaviour without a code change. No provider
  exists in this build, and nothing claims one does.
