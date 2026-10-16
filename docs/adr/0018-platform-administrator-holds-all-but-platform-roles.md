# ADR 0018 — The platform administrator holds everything but platform roles

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes in part:** ADR 0007 (decision 1 and 5: `SUPER_ADMIN` as the only
  platform door role) and ADR 0010 (decision 1: the platform administrator's
  fourteen-capability allow-list, and the rejected alternative "a deny-list for
  ADMIN").
- **Related:** ADR 0019 (door access by invitation, decided the same day);
  `packages/permissions/src/capabilities.js`, `packages/permissions/src/admission.js`,
  `apps/api/src/routes/platform.js`, `apps/web/src/app/admin/users/`.

## Context

The owner's decision of 2026-10-16, verbatim:

> "Admin should be able to do all super admin has access. Only difference is
> that Super Admin can create, revoke the admin and all other."

with the hierarchy: super admin > admin > organizer > organizer manager >
organizer staff > user.

Until now the platform administrator (`ADMIN`) held an allow-list of fourteen
capabilities (ADR 0010): review, drafts, venues, organiser invitations,
reports without money, website links, every event's visits, editing and
deleting posted events, imports, booking fees, referral codes, booking-fee
refunds and cancelling unpaid pay-at-the-venue tickets. It did not hold
`platform:admin`, so it could not search accounts, grant memberships, merge
venues, make the organiser's lifecycle moves (`ORGANIZER_ONLY`), read an
organisation's money, or admit at a door (ADR 0007 kept the door to
`SUPER_ADMIN`). The one route that changes a platform role,
`platform.setUserRole`, was held by `platform:admin` too, so "everything but
platform roles" could not be expressed with the capabilities that existed.

## Decision

1. **A new capability, `platform:role_manage`.** Platform-only (in
   `PLATFORM_ONLY_CAPABILITIES`), held by `SUPER_ADMIN` alone through
   `ALL_CAPABILITIES`. `platform.setUserRole` — making, changing and revoking
   every platform role, `ADMIN` and `SUPER_ADMIN` included — requires it in the
   contract, keeping its `SECURITY_ROLE` step-up, its written reason, the
   in-transaction re-read that refuses anybody who is not an unsuspended
   `SUPER_ADMIN`, the last-super-administrator guard, the revocation of every
   session of the account, and its audit row.
2. **ADMIN holds every capability except a named super-admin-only list.**
   `SUPER_ADMIN_ONLY_CAPABILITIES = ['platform:role_manage']`, and
   `PLATFORM_ADMINISTRATOR_CAPABILITIES = ALL_CAPABILITIES −
SUPER_ADMIN_ONLY_CAPABILITIES`. `assertPlatformAdministratorBounds` stays an
   exact equality against that derivation, refuses a table that hands ADMIN any
   super-admin-only capability, and refuses one in which `SUPER_ADMIN` lost one.
   So ADMIN now holds `platform:admin`: it publishes, pauses, postpones,
   cancels and reschedules any organisation's event on platform authority
   (recorded `authority: 'PLATFORM'`, as a super administrator's move is), reads
   reports with their money, refunds, searches accounts and organisations,
   grants organisation memberships (`platform.grantMembership`) and merges
   venues.
3. **ADMIN admits at the door.** `PLATFORM_ADMISSION_ROLES = ['ADMIN',
'SUPER_ADMIN']`; `assertPlatformAdmissionPolicy` still requires every
   platform door role to hold `platform:admin`. The door list and every
   `ticket.admission_platform_authority` and `ticket.checked_in` row record the
   caller's own platform role, so an ADMIN is never recorded as a
   `SUPER_ADMIN`. `PLATFORM_ROLE` authority rests on ADMIN or SUPER_ADMIN in the
   response schema, and SUPER_ADMIN on nothing else. SUPPORT, MODERATOR and
   FINANCE_ADMIN are still refused and audited.
4. **A direct grant changes an organisation role, never a platform role, and
   an ADMIN may not use it on a SUPER_ADMIN's account.** The grant ends every
   session the account holds; a platform administrator, below a super
   administrator in the owner's hierarchy, may not sign one out that way.
5. **Nobody below a super administrator may redact one.** A privacy redaction
   that reaches account identity replaces the sign-in address and ends every
   session and token, which revokes the account in all but name. So raising
   and confirming a privacy request refuses with 403, recorded as
   `REFUSED_AUTHORIZATION` / `SUPER_ADMIN_SUBJECT`, when the subject's
   `User.role` is `SUPER_ADMIN` and the caller does not hold
   `platform:role_manage` — a platform administrator and an organiser alike.
   The role is read from the database when the request is raised and again,
   with the subject's row locked `FOR SHARE`, inside the redaction transaction
   before anything is written, so a promotion between the two is refused too
   and the request stays awaiting confirmation. A super administrator may
   still redact another.
6. **A direct grant decides from a locked read.** `platform.grantMembership`
   locks the account's `User` row `FOR SHARE` inside its transaction and
   re-reads the role and the suspension there, so a promotion to
   `SUPER_ADMIN` that commits between the handler's first read and the grant
   is still refused to a platform administrator.
7. **The web follows the capability, the API decides.** People and roles
   (`/admin/users`) opens to `platform:admin`; the platform-role control is drawn
   only for a session holding `platform:role_manage`, decided on the server and
   handed to the client as a boolean. `sessionCan` never lets `platform:admin`
   stand in for a super-admin-only capability. `platform:role_manage` is a
   forbidden client literal, in the source check and the built-bundle scan.

## Consequences

- The review gate (ADR 0010) still binds organisers. A platform administrator
  acting on platform authority is the team at The Desi Events, as a super
  administrator always was; reviewer independence (`CONFLICT_OF_INTEREST`,
  `SELF_REVIEW`) is unchanged.
- ADR 0010 rejected a deny-list for ADMIN because a capability added later would
  reach it silently. That is now the owner's intent: ADMIN does everything a
  super administrator does. A capability that should stay with `SUPER_ADMIN`
  must be added to `SUPER_ADMIN_ONLY_CAPABILITIES` on purpose, and the load-time
  equality makes forgetting the derivation impossible, not forgetting the list.
- The `ORGANIZER_ONLY` refusal and the platform-held sales sitting path are kept
  for a platform role that edits posted events without `platform:admin`; no
  shipped role is one today.
- Both roles keep the same session policy: short privileged sessions and a
  required second factor (`PRIVILEGED_PLATFORM_ROLES`).
