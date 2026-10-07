# ADR 0011 — SMTP delivery of show-once codes

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** ADR 0008's wording about `EMAIL` mode only ("an explicit
  `EMAIL` with no provider refuses to boot … this build sends no email"). ADR
  0008's `MANUAL` mode stands unchanged.
- **Related:** ADR 0008, ADR 0010; `docs/PROVIDERS.md` ("Email");
  `docs/SECURITY.md` ("Show-once codes" and "SMTP"); SPEC2 §1 D8 and §4.P-H,
  P-I, P-K, P-M.

## Context

ADR 0008 made every single-use code — a team invitation, a ticket transfer, and
now an organiser invitation (ADR 0010) — work without email: in `MANUAL` mode
the code is shown once to whoever issued it, who hands it over. It kept an
`EMAIL` mode for a provider the build did not have.

The owner asked that organiser invitations be "sent to the email". That needs a
way to send email that a deployment can switch on, without making the codes
less safe and without making any sentence on the site false in either mode.

## Decision

**An SMTP adapter in `@desi-event/providers`, used only for the three codes,
switched on only when a deployment asks for it.**

1. **Opt-in, never inferred.** `DELIVERY_MODE=EMAIL` with `SMTP_HOST` set
   selects `createSmtpEmailProvider` (nodemailer). SMTP settings with
   `DELIVERY_MODE` unset still mean `MANUAL`. `EMAIL` needs `SMTP_FROM` and an
   absolute `WEB_ORIGIN` (https in production), and `SMTP_USER` and
   `SMTP_PASSWORD` together or neither; any gap refuses to boot.
2. **Encrypted in production.** `SMTP_REQUIRE_TLS` defaults to true; in
   production a server that is neither `SMTP_SECURE` nor `SMTP_REQUIRE_TLS` is
   refused at boot. Certificate checks stay on.
3. **The body never leaves the adapter except to the server.** nodemailer's
   logger and debug output are off; every transport error is rebuilt carrying
   only the server's status, never the message. Credentials are redacted by the
   logger configuration. Timeouts are explicit (10 s to connect, 10 s for the
   greeting, 20 s of socket silence).
4. **A failed send withdraws what it issued.** The invitation or transfer is
   withdrawn and the answer is 503 `DELIVERY_FAILED`; there is never a live code
   nobody received. In `EMAIL` mode the response carries no code at all.
5. **Letters, not links.** UTF-8 `text/plain`, quoted-printable. The code sits
   alone on its own line; the link (`WEB_ORIGIN` plus the join page) never
   carries it, so a code is never in a URL, a referrer or a browser history.
   Sender-written text (an administrator's note, a transfer message) is quoted
   under a line and marked as written by the sender. A team invitation from an
   unverified organisation says so.
6. **Abuse limits, `EMAIL` mode only.** At most three codes a day to one address
   across team invitations and ticket transfers (429 `RECIPIENT_DAILY_LIMIT`),
   and at most five transfer emails an hour per sender. `MANUAL` is unchanged.
7. **The web learns the mode.** `auth.me` carries `deliveryMode`, and the pages
   whose words depend on how a code goes out read it. Copy that is true in
   both modes says what is never emailed; a guard test
   (`apps/web/src/lib/email-copy.test.js`) fails on any blanket "sends no
   email".

**What is never emailed, in any configuration:** receipts, address
confirmation, password resets (those links would carry a secret in a URL), and
change notices about an event, which are recorded against each order and shown
on its order page.

## Consequences

- **Proven only against a local test mail server.** The adapter and the API's
  email path are tested end to end against `smtp-server` on loopback; no real
  mail provider has been tried. The limitations page lists email as EXTERNAL
  VERIFICATION PENDING.
- **This environment has no mail server**, so it runs `MANUAL`: the organiser
  invitation shows its code once, with a ready-to-send message to paste into an
  ordinary email. Team-invitation and ticket-transfer codes are shown without a
  message.
- **The secret is the operator's.** `SMTP_PASSWORD` lives in the deployment's
  environment and nowhere in the repository.
- **Email ownership is still not verified** (ADR 0010): sending a code to an
  address proves only that whoever reads that inbox can read the code.

## Alternatives considered

- **An HTTP mail API (a provider SDK):** rejected for now — it would tie the
  build to one vendor's account, which this repository cannot create. SMTP
  reaches every provider.
- **Putting the code in the link:** rejected by the standing rule that no
  credential travels in a URL.
