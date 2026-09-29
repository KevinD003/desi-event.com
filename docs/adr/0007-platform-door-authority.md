# ADR 0007 — A platform super administrator may admit at any event

- **Status:** Accepted
- **Date:** 2026-09-29
- **Supersedes:** nothing. It reverses a rule that was never an ADR: "platform
  roles, including `SUPER_ADMIN`, admit nobody", stated in
  `packages/permissions/src/admission.js` and `docs/CHECK_IN.md` since the
  Phase 4 admission work.
- **Related:** ADR 0006; findings NF-05, NF-10 and NF-12 in `docs/SECURITY.md`

## Context

Door authority came only from a membership. OWNER and ADMIN admitted to every
event of their organisation, MANAGER, STAFF and SCANNER only to events a
`ScannerScope` named, and every platform role — `SUPER_ADMIN` included — was
refused and audited with `PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY`.

The owner asked for super-administrator scanning and verification at any
event. The argument the old rule rested on, "door authority comes from a
membership", was already weak for `SUPER_ADMIN`. Its platform capability set is
every capability there is — `ticket:check_in`, `team:role_manage` and
`organization:manage` included — and `can()` unions platform capabilities with
membership ones, so every organisation route already let it act anywhere. Only
the door's own policy asked for a membership. And `POST
/v1/platform/organizations/:id/members` lets it put any account it chooses into
any organisation with a door role (never its own account, which that route
refuses). Refusing it at the door was ceremony, not control — the same argument
that already exempts OWNER and ADMIN from event scopes, because they could
assign the scope to themselves.

What would make the change unsafe is a platform admission nobody can tell apart
from an organiser's, or door authority drifting onto another platform role.

## Decision

1. **A third authority, `PLATFORM_ROLE`.** `ADMISSION_AUTHORITIES` in
   `packages/permissions/src/admission.js` and in
   `packages/schemas/src/enums.js` is `ORGANIZATION_ROLE`, `EVENT_SCOPE` and
   `PLATFORM_ROLE`. `PLATFORM_ADMISSION_ROLES` is `['SUPER_ADMIN']`.
2. **Membership wins.** A super administrator who is also a member of the
   event's organisation, or holds a scope for it, is recorded on that
   authority. The platform authority is the fallback, never the first answer.
3. **Recorded distinctly.** Every platform lookup and every platform admission
   writes a `ticket.admission_platform_authority` audit row on the **Event**,
   so the organisation's own record shows that somebody outside it stood at its
   door. The `ticket.checked_in` audit row carries `authority: 'PLATFORM_ROLE'`,
   the role and the event's `organizationId`, for a single ticket and for each
   ticket of a group admission.
4. **Re-read inside the transaction.** The confirmation reads the caller's
   platform role and `suspendedAt` from the `User` row inside the admitting
   transaction, so a super administrator demoted or suspended since the preview
   is refused.
5. **Only `SUPER_ADMIN`, enforced at module load.** `SUPPORT`, `MODERATOR` and
   `FINANCE_ADMIN` hold capabilities but not `ticket:check_in`.
   `assertPlatformAdmissionPolicy` runs when the permissions package is
   imported and throws if any other platform role gains `ticket:check_in`, or
   if a door role stops holding `platform:admin`. `REFUSED_PLATFORM_ADMISSION_ROLES`
   is derived, so a platform role added later with any capability is refused by
   default. A refused platform role gets a 403 before any lookup, and the
   attempt is audited against the account with
   `PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY`.
6. **The event list is bounded.** `GET /v1/tickets/admission/events` gives a
   super administrator every organisation's current door events on
   `PLATFORM_ROLE` authority, filterable by `organizationId` and by `q` (event
   title or organisation name; control characters are refused), cut at the 100
   events that start soonest, with `meta.truncated` saying so. The door screen
   (`/organizer/check-in`) shows the filter, a notice naming the platform
   authority, and a notice when the list was cut.
7. **No step-up per scan.** A door works through a queue; a second factor per
   admission would stop it. The role is privileged, so the account cannot reach
   the door — or any guarded route — without a verified second factor (NF-12),
   and a role change ends its sessions (NF-10).

## Evidence

- `packages/permissions/src/admission.test.js`: SUPER_ADMIN admits on
  `PLATFORM_ROLE`; SUPPORT, MODERATOR and FINANCE_ADMIN do not; the module-load
  assertion refuses a table in which another platform role holds the
  capability.
- `apps/api/tests/admission.test.js`, `apps/api/tests/tickets.test.js`:
  preview and confirmation by a super administrator with no membership; the
  audit rows; refusal and audit for each other platform role.
- `apps/api/tests/admission-integration.test.js` (real PostgreSQL): a platform
  admission records `role: 'SUPER_ADMIN'` and the other organisation's id; a
  super administrator who is also OWNER is recorded as `OWNER` of the home
  organisation.
- `apps/web/src/lib/navigation.test.js`: **Check-in** is offered to
  `SUPER_ADMIN` and not to `MODERATOR` or `FINANCE_ADMIN`.

## Consequences

- One compromised super-administrator account can admit anybody holding a real
  ticket at any event. It could already put an account it controls into any
  organisation as OWNER and do the same; what changes is that it no longer
  needs a membership write first, so the audit trail is the platform-authority
  row on the event rather than a membership grant.
- A reviewer reads the authority from the audit row, never from the role name
  alone: an OWNER who happens to be a super administrator admits as OWNER.
- The door never trusts a role claimed by the browser. The navigation offering
  **Check-in** is a convenience; the API decides from the database.
