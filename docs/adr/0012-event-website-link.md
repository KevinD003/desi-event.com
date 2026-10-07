# ADR 0012 — An event's website link, switched by administrators and counted on the way out

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing. It replaces the free `socialLinks.website` field an
  organiser could fill, which was never an ADR.
- **Related:** ADR 0010 (the platform administrator), ADR 0013 (visit
  counting), ADR 0015 (imported events link to their Sulekha page through this
  switch); `docs/SECURITY.md` ("Outbound links and the website redirect");
  SPEC2 §1 D6 and §4.W.

## Context

The owner asked for "redirect website option, it should activate or deactivate
by the admin or superadmin anytime", and for organisers to see "how many
redirected to the main website".

Before this, an organiser could type any address into `socialLinks.website` and
the event page linked to it at once. Nobody looked at it, nothing counted it,
and the API's contract forbids 3xx answers, so a counted redirect could not
live in the API.

## Decision

1. **One column for the address, one switch, and a record of the decision.**
   `Event.websiteUrl` is the organiser's current address, normalised;
   `websiteRedirectEnabled` is the switch; `websiteDecidedUrl` is the address
   the last administrator decision was about, and while the switch is on the
   link goes **there**. Who decided, when and why are stored beside it.
   `socialLinks.website` was folded into `websiteUrl` by the migration, keeping
   only values that pass the address rules, each waiting for a decision.
2. **Only administrators move the switch** (`website_redirect:manage`: ADMIN
   and SUPER_ADMIN), through `moderation.setWebsiteRedirect` with a reason and
   a MODERATION step-up. `lib/website-redirect.js` `decideWebsiteRedirect` is
   the only writer of the switch (a source scan); the importer calls it inside
   its own transaction (ADR 0015).
3. **An organiser's change never moves the switch.** A changed or cleared
   address waits for a decision (`websiteDecisionPending`, kept by the API and
   by trigger `desi_event_website_change`). While the switch is on, the link
   keeps going to the address an administrator approved until one approves the
   new address or turns the link off. The administrators' worklist shows what
   is waiting.
4. **The decision names what the administrator saw.** The request carries the
   address on the administrator's screen and the update is a compare-and-set on
   the exact stored string; a changed address is 409 `WEBSITE_CHANGED` with the
   current one.
5. **The redirect lives in the web tier.** `GET /events/[slug]/website` asks the
   API (`traffic.websiteVisit`, which the web proxy refuses to forward from a
   browser) where the link goes now and answers a 302 with `no-store`. It
   re-validates the address, answers prefetch and prerender requests 503
   without a lookup, serves only top-level navigations, answers `HEAD` 405, and
   gives the same 404 for every refusal. There is no open redirect: the
   destination is only ever the decided address of a publicly visible event.
6. **Counted from fetch metadata, not from a parameter.** A visit counts only
   for a same-origin or direct top-level navigation. `?count=no` (added for
   signed-in team members and staff) can only reduce counting. Nothing about
   the visitor is stored (ADR 0013).
7. **Organisers see who decided.** The organiser's panel shows the
   administrator's name, when the switch last changed and the reason. (Edits
   made by the Desi-Event team under ADR 0014 show "a Desi-Event
   administrator" instead; the two can be made to match.)

## Consequences

- **The site behind the link is not checked.** The address must be a
  well-formed https address with a public name and no credentials, port or key;
  nobody opens, scans or watches the site. The administrator's checkbox "I have
  opened this address and it is the organiser's own site" is a prompt, not a
  check.
- **One link only.** Links written into the description, sponsors' links and
  social accounts are reviewed with the listing and are not switched or
  counted; neither is an organisation's own website on its organiser page.
- **The organiser cannot turn the link off themselves**, as the owner asked.
  They ask the team.
- The limitations page states all of this as `website-link-checks`.

## Alternatives considered

- **Turning the link off whenever the organiser changes the address** (the
  first design): rejected for the owner's literal rule that only
  administrators turn it on or off. Instead the approved address stays linked
  until an administrator decides.
- **A redirect route in the API:** impossible without allowing 3xx in the
  contract, and the web proxy drops `Location`.
