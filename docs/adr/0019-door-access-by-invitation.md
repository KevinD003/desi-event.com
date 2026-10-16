# ADR 0019 — Door access is given by invitation, for named events

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amends:** ADR 0015 (the platform-held organisation "has no members": it now
  holds door scanners, and nothing else). Builds on ADR 0007 and ADR 0018 (who
  admits on platform authority).
- **Related:** `packages/db/prisma/migrations/20261016130000_door_grants_by_invitation`,
  `apps/api/src/routes/teams.js`, `packages/schemas/src/teams.js`,
  `apps/web/src/app/organizer/team/`, `apps/web/src/app/account/invitations/`.

## Context

The owner's decision of 2026-10-16, verbatim:

> "Organizer of the event, organizer gives access to anyone to scan the
> tickets."

An organisation could invite any address as STAFF or SCANNER, but the events
sent with the invitation were only written to its audit row. The new member
started with no door scope, which admits nobody, until an owner or
administrator changed their role afterwards. A manager, who may invite, could
not scope anybody at all. Imported events belong to the platform-held
organisation "The Desi Events", which a trigger kept free of every member
(ADR 0015), so only a super administrator could admit at their doors.

## Decision

1. **An invitation carries its events.** `InvitationScope` (invitation, event;
   unique together; deleted with either) holds the events a door role invited
   by `teams.invite` will admit at. The trigger
   `desi_invitation_scope_same_organization` refuses an event of another
   organisation than the invitation's (`invitation_scope_same_organization`)
   and an invitation whose role does not admit by scope
   (`invitation_scope_door_role`).
2. **Who may name which events.** Each id must be one of the organisation's
   events (422), and events on an invitation for a role that does not work a
   door answer 422. An owner or administrator (`team:role_manage` through
   their membership) and a platform administrator (`platform:admin`) may name
   any of them. A manager, which invites but does not manage roles, may name
   only events its own membership is scoped to (403): the admission policy's
   rule that a scoped role never holds `team:role_manage` stands, and an
   invitation never opens a door its inviter cannot. A new code
   (`teams.reissueInvitation`) carries the same events and is bounded the same
   way.
3. **Accepting applies them.** `teams.accept` copies the invitation's events,
   those still the organisation's, into the new membership's `ScannerScope`
   rows with `setScannerScopes`, inside the transaction that creates the
   membership. An account that already belonged keeps its membership and its
   scopes. The invitation summaries and the acceptance carry the events by id
   and title, so the inviter and the invitee both see which events. The invitee
   may be any address; they create, or sign in to, an account with that address
   to accept, as before.
4. **The platform-held organisation holds door scanners.** The migration
   replaces `desi_platform_held_has_no_members()`: a SCANNER membership or
   team invitation is let in, every other role is refused with the same error
   (`platform_held_organization_has_no_members`, 409
   `PLATFORM_HELD_ORGANIZATION`), and the triggers now fire on a role change as
   well, so a scanner there cannot be moved to another role. A platform
   administrator (`platform:admin`: ADMIN, SUPER_ADMIN), who is not a member,
   may invite SCANNERs there for its events, change their events and remove
   them, and nothing else (`PLATFORM_HELD_SCANNERS_ONLY`). The team page offers
   it "The Desi Events" beside its own organisations.
5. **Imported events still have no editor.** A SCANNER holds `ticket:check_in`
   and nothing else, so nobody runs an imported event on The Desi Events but
   its team: "request changes" stays refused (`IMPORTED_EVENT_NO_EDITOR`),
   the importer's review exemption stands, and a door scanner's membership of
   the platform-held organisation is not a conflict of interest for a reviewer.

## Consequences

- The probes in `packages/db/scripts/event-control-probes.mjs` and the
  populated upgrade in `verify-populated-upgrade.mjs` check the new trigger
  bodies and the invitation scope trigger; `door-grants-integration.test.js`
  invites, accepts and admits against PostgreSQL.
- The invitation email does not list the events; the invitee sees them once
  they accept, and the inviter on the team page.
- Reverting needs the manual rollback written at the top of the migration,
  including deleting every SCANNER membership and invitation of the
  platform-held organisation before the old trigger is restored.
