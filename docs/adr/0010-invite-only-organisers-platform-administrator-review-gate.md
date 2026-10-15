# ADR 0010 — Invite-only organisers, the platform administrator and the review gate

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing. It ends the self-service organisation route that the
  feature-completion work added on 2026-09-29 (`organizations.create`), which
  was never an ADR.
- **Related:** ADR 0008 and ADR 0011 (how the code reaches the recipient),
  ADR 0014 (what a published event may change), ADR 0015 (the one exception to
  reviewer independence); `docs/SECURITY.md` ("Organiser invitations" and "The
  review gate"); the binding specification SPEC2 §1 (D1–D5) and §4.P.

## Context

The site's owner asked for three things at once (request A):

> "After the admin or super admin send the request to the email for the
> organizer to post the event on our platform. If the link or join or post
> event request has not been sent by admin or superadmin then they should not
> be able to post the event. Also add that once the event sent for review to
> admin or superadmin then and only it will be posted."

Before this change:

- anybody signed in could create an organisation (`organizations.create`),
  which started UNVERIFIED and could publish once a moderator verified it;
- an organisation's OWNER, ADMIN or MANAGER could invite anybody to any role,
  including the roles that create and publish events;
- events went through a moderation review, but nothing in the database stopped
  a code path from moving one straight to a public status;
- the platform had a super administrator and a moderator, and no role between
  them for "the team that runs the site day to day".

## Decision

### 1. A platform administrator role, bounded by an allow-list

A new platform role, `ADMIN` ("Platform administrator"), separate from an
organisation's "Administrator" membership role. Its capabilities are an
**allow-list**, and `assertPlatformAdministratorBounds` throws at load unless
ADMIN's set **equals** it — nothing missing, nothing extra:

`moderation:review`, `event:view_draft`, `venue:manage`, `organizer:invite`,
`report:view`, `website_redirect:manage`, `analytics:view_all`,
`event:platform_edit`, `event:platform_delete` and `event:import`.

The first seven come from this decision; the last three from ADRs 0014 and
0015, added in the same change as the test that pins the list. A test feeds the
check a doctored table giving ADMIN `platform:admin`, `event:publish`,
`attendee:export` or `promo:manage` and expects it to throw. ADMIN holds no
money capability: analytics show it counts, never ledger figures.

### 2. Organiser invitations: one kind, a new organisation

`OrganizerInvitation` has one kind: **start a new organisation as its OWNER**.

- An ADMIN or SUPER_ADMIN (`organizer:invite`) writes the address, the
  organisation's name and, optionally, its public description and website and a
  private note. The recipient chooses only the organisation's web address
  (`slug`) and time zone; everything else in the accept body is ignored. What
  the administrator wrote is what the organiser page shows, so writing it is the
  review.
- On acceptance the organisation is created **VERIFIED**, with the inviting
  administrator recorded as its verifier, a verification event and three audit
  rows, and the acceptor becomes OWNER (a privilege change: NF-10).
- The code is single-use, bound to the address (the acceptor must be signed in
  as it), and lasts fourteen days. It is shown once to the issuer (ADR 0008) or
  emailed (ADR 0011); only its SHA-256 digest is stored. It is never in a URL:
  the link opens the join page and the recipient types the code.
- Reissuing withdraws the old invitation and issues a new code in one
  transaction. One waiting invitation per address (a partial unique index).
- An address that belongs to a staff account is refused at issue (422
  `STAFF_ACCOUNT`) and at acceptance (403, the code not spent): staff are added
  to organisations by a super administrator directly.

An `EXISTING_ORGANIZATION` kind (an administrator putting somebody into an
organisation that already exists) was designed and **dropped**: it would let an
administrator put anybody, a second account of their own included, into any
organisation with attendee-export and promo powers, without the owner agreeing.
A poster joins an existing organisation only through a super administrator's
`platform.grantMembership`.

### 3. Self-service removed

`organizations.create` answers 403 `ORGANIZER_INVITATION_REQUIRED` to every
caller, without reading the body. Registration accepts only `ATTENDEE`
(`registerRequestSchema` included). Organisations created before this change
keep their state; an UNVERIFIED one still needs a moderator's verification to
publish.

### 4. Posting roles come from The Desi Events team, and move only down

The roles that create or publish events — EVENT_MANAGER, MANAGER, ADMIN and
OWNER — are "posting" roles, derived from `capabilities.js`, not listed by
hand.

- An organisation member may invite or move members only to FINANCE, STAFF,
  SCANNER and VIEWER.
- A posting role is granted only by an organiser invitation (the new
  organisation's OWNER) or by a SUPER_ADMIN's `platform.grantMembership` (any
  role, any organisation).
- Inside an organisation, a member who posts may be moved only **downwards**: to
  a role whose resolved capabilities are a subset of their current ones. An
  upward posting move is 403 `POSTING_ROLE_NEEDS_PLATFORM`.
- Ownership may be handed only to a member who already posts (422
  `HEIR_MUST_POST_EVENTS`); the old owner becomes ADMIN, a downward move.
- Team invitations already waiting that offered a posting role were withdrawn
  by the upgrade migration.

### 5. The review gate, in the database

- **A trigger, not a convention.** `desi_event_status_requires_review` refuses
  APPROVED except from REVIEW_PENDING, and refuses a move into a public status
  (PUBLISHED, ON_SALE, SALES_PAUSED, SOLD_OUT, COMPLETED, POSTPONED, CANCELLED)
  except from APPROVED or another public status — or, since ADR 0014, a
  platform restore to the restore target of the status the event had when it
  was deleted. The API maps the refusal to 409 `REVIEW_REQUIRED`. Three source
  scans pin every path to "public" in `apps/*/src`.
- **Approval names what was seen.** `moderation.decide` approve requires the
  `revision` the reviewer read (400 without it); a changed event is 409
  `STALE_REVISION` and nothing is decided.
- **Reviewer independence.** A reviewer who belongs to the event's organisation
  is refused 403 `CONFLICT_OF_INTEREST`, and the person who submitted it 403
  `SELF_REVIEW`. The same holds for pictures: an uploader never approves their
  own (ADR 0014). The one exception is an imported event of the platform-held
  organisation (ADR 0015).

### 6. What a published event can change without another review

Rewritten from the first plan's list (SPEC2 P-19) by the full-control decision
(ADR 0014, SPEC2-XI O4). This is the text the limitations page shows as
`live-changes-not-reviewed`, word for word:

> On a published, on-sale, paused, sold-out or postponed event, the organiser —
> or the team at The Desi Events, in an editing session opened with a reason —
> can change everything without another review, and the change is public when it
> saves. The date, time, time zone, place, joining link, age limit and entry,
> refund and conduct terms change only with a reason, and every ticket holder is
> shown the change on their order page; it is not emailed. Ticket types can be
> added, edited, re-priced (people who already bought keep what they paid),
> closed, hidden, or removed if unused. Nights can be added, moved, given
> another seating map while nothing at them is sold, removed if unused, or
> cancelled with their tickets refunded. The venue cannot be changed while a
> night uses a seating map. New pictures appear only after someone on the team
> at The Desi Events other than the person who uploaded them approves each one;
> the old cover stays until then. (Pictures copied by an import are the
> exception: the administrator who reviews the import approves them with the
> event.) A finished or cancelled event keeps its words and pictures editable.
> The organisation's venue records can be edited at any time, and every event
> there shows the new details without review. An event's website address can be
> changed at any time; a new address is not linked until an administrator
> approves it. Promo codes are never reviewed.

## Consequences

- **Nobody posts without an invitation.** The only roads to a posting role are
  an organiser invitation and a super administrator's grant; both are audited
  with who did it.
- **Email ownership is not verified.** Whoever registers the invited address
  first and obtains the code can accept it. The code is single-use, expires,
  can be withdrawn, and every acceptance is audited with its inviter.
- **Reviewer independence cannot see through an alias.** An administrator can
  invite a second address of their own, run an organisation from it and approve
  its events from the first account. A super administrator can list the
  organisations created from each administrator's invitations; nothing detects
  one person behind two accounts.
- **Moderators approve too.** The existing MODERATOR role keeps
  `moderation:review`, so "reviewed by an admin or super admin" in practice
  means "by the team at The Desi Events". This can be narrowed.
- **The optional rule "may not review organisers you invited" is off.**
- **Review is once.** A published event changes without another review (§6);
  the limitations page says so.

## Alternatives considered

- **A deny-list for ADMIN** (everything except named capabilities): rejected,
  because a capability added later would reach ADMIN silently. The allow-list
  makes every addition a visible change to the list and its test.
- **Keeping self-service organisations, unverified until checked**: rejected;
  the owner asked that nobody post without an invitation.
- **Admin-issued joins to existing organisations**: dropped (§2).
