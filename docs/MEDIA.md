# Event pictures

An event has at most one cover and up to eight gallery pictures. An organiser
uploads them in the editor's Media step, a moderator reviews them with the
event, and a public page shows only the ones a moderator has approved on an
event anybody may see. Without a cover, every surface shows the event's
generated poster, as it always has.

This page describes what happens to a picture from the moment its bytes arrive
to the moment they leave, and what is deliberately not done.

---

## Upload

`POST /v1/events/:id/media?kind=EVENT_COVER|EVENT_GALLERY&altText=…&revision=N`

The body is the file itself, sent as `image/jpeg`, `image/png`, `image/webp`
or `application/octet-stream`. The description (alt text) travels in the query
because it is public page text, not a secret. The revision is the event's, as
for every other authoring write.

Everything that can refuse an upload without looking at it runs in an
`onRequest` gate, **before a single body byte is read**:

| Check                                                 | Refusal                    |
| ----------------------------------------------------- | -------------------------- |
| Twenty uploads per ten minutes per person or address  | 429                        |
| Signed in, with a second factor where one is required | 401 / 403                  |
| The event exists                                      | 404                        |
| `event:update` on the event's organisation            | 403                        |
| The event is a draft or has changes requested         | 409 `NOT_EDITABLE`         |
| The gallery has room (at most 8)                      | 409 `GALLERY_FULL`         |
| The organisation is under its 1 GiB storage quota     | 409 `MEDIA_QUOTA_EXCEEDED` |

The tests prove the order by counting the bytes a refused request had read
from its stream: zero, for an anonymous caller, a caller without the
capability and an event that is not editable.

Only then is the body read, into a buffer capped at 10 MiB (10,485,760 bytes).
One byte over is 413 `PAYLOAD_TOO_LARGE`; an empty body is 400 `EMPTY_UPLOAD`.
The query — kind, description, revision — is validated with the rest of the
request after that, as Fastify validates, so a malformed query is a 400 that
arrives after the body was read. The gallery, quota and revision checks run
again inside the write's transaction, because the gate's answer can be stale
by then.

## What the bytes are is decided by the bytes

The declared `Content-Type` decides nothing about the format. It must still be
one of the four the upload reads — `image/jpeg`, `image/png`, `image/webp` or
`application/octet-stream` — and any other, JSON and plain text included, is
415 `UNSUPPORTED_MEDIA_TYPE` from the last `onRequest` hook, before the body is
read. (The media routes' scope keeps the API's JSON parser for the arranging
writes; without that hook a JSON array would have been parsed and handed on.)

The first bytes are sniffed, and anything that is not a JPEG, PNG or WebP is
415 `UNSUPPORTED_MEDIA_TYPE` with a sentence naming what the file actually is:
an SVG drawing, a web page, a GIF, a HEIC or AVIF photo, a PDF. An SVG renamed
`cover.png` is still an SVG.

## Sanitising: rebuilt from an allow-list

Each format has its own pure-JavaScript sanitiser in
`apps/api/src/lib/media/`. None decodes pixels. Each walks the file's
structure, copies the parts on its allow-list into a new file, and refuses a
structure it does not understand rather than passing it through.

| Format | Kept                                                                                                                                                                                                                       | Removed                                                                                                                                                             | Refused (422)                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| JPEG   | The first JFIF header, rebuilt from its fixed fields with a 0 × 0 thumbnail, ICC profile, a short Adobe segment, quantisation and Huffman tables, restart interval, one baseline, extended or progressive frame, the scans | EXIF (GPS included), XMP, IPTC, MPF, comments, JFIF and JFXX thumbnails and anything else after the JFIF header, other APPn segments, anything after the end marker | Lossless, hierarchical and arithmetic-coded frames, a second frame or image, markers out of place |
| PNG    | `IHDR`, `PLTE`, `IDAT`, `IEND`, and the colour chunks `tRNS`, `gAMA`, `cHRM`, `sRGB`, `iCCP`, `sBIT`, `bKGD`, `cICP`, `mDCV`, `cLLI`                                                                                       | Text chunks, `eXIf`, timestamps, private chunks, anything after `IEND`; an animated PNG loses its animation chunks and keeps its default image as a still picture   | A bad CRC, `IHDR` not first or twice, an unknown critical chunk                                   |
| WebP   | The `VP8` or `VP8L` bitstream; for `VP8X`, the header rebuilt with its EXIF and XMP flags cleared, alpha and ICC kept                                                                                                      | `EXIF`, `XMP ` and unknown chunks                                                                                                                                   | An animated WebP (`ANIMATED_IMAGE`), a RIFF size that does not match                              |

A JPEG's EXIF orientation is the one piece of metadata that changes how the
picture looks, so it is kept — as a new, minimal EXIF segment holding only that
tag, rebuilt rather than copied. Everything else in the original EXIF,
including GPS coordinates and the camera serial, is gone.

The rebuilt file is sniffed again, its dimensions are checked, and its SHA-256
is taken. What the organiser sees after an upload lists what was removed, in
words ("camera and location details (EXIF)", "animation (kept as a still
picture)").

### Limits

| Limit                         | Value                                       | Refusal                    |
| ----------------------------- | ------------------------------------------- | -------------------------- |
| Size                          | 10 MiB                                      | 413                        |
| Longest side                  | 8,000 pixels                                | 422 `IMAGE_TOO_LARGE`      |
| Area                          | 40 megapixels                               | 422 `IMAGE_TOO_LARGE`      |
| Cover, smallest               | 960 × 540, as displayed (after orientation) | 422 `IMAGE_TOO_SMALL`      |
| Gallery picture, shorter side | 320 pixels                                  | 422 `IMAGE_TOO_SMALL`      |
| Description                   | 1–300 characters, not a file name           | 400                        |
| Gallery                       | 8 pictures                                  | 409 `GALLERY_FULL`         |
| Storage per organisation      | 1 GiB, counted from the stored sizes        | 409 `MEDIA_QUOTA_EXCEEDED` |

The dimensions are read from the file's own header (the JPEG frame, `IHDR`,
the WebP header), and no pixel data is ever decompressed on the server, so a
decompression bomb — a small file declaring an enormous image — is refused by
the limits above without being expanded.

Unsanitised bytes are never stored. Each stored row records
`scanStatus = CLEAN`, `sanitisedAt`, and the note
`structural-v1: parsed, rebuilt from allow-listed segments, metadata removed; no antivirus engine`.
That note is the honest description of the check: structural, not a virus
scan.

## Storage

The bytes live in PostgreSQL, in `MediaBlob` (`bytea`, `STORAGE EXTERNAL`
because these formats are already compressed), one row per `MediaAsset`,
joined by `storageKey` with `ON DELETE CASCADE`. All access goes through the
`MediaStorage` interface in `apps/api/src/lib/media-storage.js`:
`put(tx, …)`, `read(key)`, `remove(tx, key)`. The write commits in the same
transaction as the picture's row, the event's revision bump and the audit row,
so a picture is never half-stored. The storage key (`pg/<uuid>`) never leaves
the API: it is in no wire schema, and the browser-bundle scan forbids it.

The upload transaction is kept short on purpose. The gallery-cap trigger locks
the event row `FOR NO KEY UPDATE`, which does not block a checkout's
foreign-key insert, but does queue other authoring writes on the same event
until the upload commits.

An S3-style adapter would put the bytes before the transaction, remove them as
compensation if the transaction fails, and need a sweep for orphans a crash
leaves behind. None of that is needed while the bytes share the row's
transaction.

## What may change when

_Rewritten 2026-10-06 (ADR 0014): a posted event now takes new pictures, each
approved individually. The table before that date refused uploads after
publication._

| Event status                                                                              | Upload or replace                | Describe again, reorder | Remove |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- | ------ |
| `DRAFT`, `CHANGES_REQUIRED`                                                               | yes, reviewed with the event     | yes                     | yes    |
| `REVIEW_PENDING`, `APPROVED`                                                              | no                               | no                      | no     |
| `PUBLISHED`, `ON_SALE`, `SALES_PAUSED`, `SOLD_OUT`, `POSTPONED`, `COMPLETED`, `CANCELLED` | yes, each one waits for approval | yes                     | yes    |
| `REJECTED`, `ARCHIVED`                                                                    | no                               | no                      | yes    |
| `DELETED`                                                                                 | no                               | no                      | no     |

No new pixels reach a public page without a review. On a draft every new
picture is reviewed with the event. On a posted event each new picture is
stored `PENDING` and is not shown until somebody on the Desi-Event team other
than its uploader approves it; a new cover waits beside the current one, which
stays public until the new one is approved. Removal stays open almost
everywhere, because an organiser must always be able to take down a picture of
somebody who asked; it is closed only while a moderator holds this version of
the event, and on a deleted event, whose pictures stay exactly as they were so a
restore brings it back whole. Removing a picture deletes its row and its bytes;
nothing is hidden and kept.

Every organiser write goes through `authorChange`: it takes the revision as a
precondition (409 `STALE_REVISION` otherwise), bumps it, and writes one audit
row — `event.media_added`, `event.media_described`, `event.media_reordered`,
`event.media_removed` — whose metadata never includes the description text.
A reorder names the full gallery; a set that no longer matches is 409
`GALLERY_CHANGED`.

## Review

A new picture is `PENDING`. On a draft, approving the event approves every
picture still waiting, in the same transaction, with one
`moderation.media_approved` audit row per picture.

_Since 2026-10-06 (ADR 0014)_ a picture added to a posted event is decided on
its own. The queue is `GET /v1/moderation/media` (web `/moderation/pictures`,
`moderation:review`), oldest first, with the event and whether the picture
replaces a cover. Approving one is `POST /v1/moderation/media/:id/decision`
with `{ "decision": "approve" }`; **its uploader may not** (403 `SELF_REVIEW`),
which covers an administrator who uploaded through a platform editing sitting.
Approving a replacement cover swaps it in under a lock, in one transaction: the
old cover and its bytes go, and the replacement becomes the cover. Rejecting it
leaves the old cover in place and shows the organiser the reason. Uploading
another replacement discards a waiting or rejected one first. Pictures copied
by an import are the one exception to the uploader rule: the administrator who
reviewed the import run approves them with their event (ADR 0015).

Uploads are refused while the event is under review, but that alone does not
pin the set: an organiser can withdraw the event, add a picture and resubmit
it while a moderator's page is open, and the event is `REVIEW_PENDING` again.
So the review page sends the event `revision` it showed with the decision.
Every organiser write — a picture added, removed, described or reordered, and
any other edit — bumps the revision, and `moderation.decide` answers 409
`STALE_REVISION` and decides nothing when it has moved, checked before the
transition and again inside its transaction. A caller that omits `revision`
approves whatever is waiting.

The review page never draws a failed read of the pictures as "no pictures":
it says they could not be shown and does not offer approval until they can.
The organiser's Media step does the same, and offers no upload over a list it
could not read.

The exception is one picture: `POST /v1/moderation/media/:id/decision`,
`{ "decision": "reject", "reason": "…" }` to take it down, or
`{ "decision": "approve" }` to put a taken-down picture back. It needs
`moderation:review` and a recent second factor. The decision is conditional on
the picture still being in the state the moderator saw; if another moderator
got there first it is 409 `MEDIA_CHANGED`. The reason is stored in
`MediaAsset.moderationNote` (a taken-down picture must have one — a CHECK says
so) and shown to the organiser as `rejectionReason`. It is never public.

A picture taken down stays down: approving the event again later does not
bring it back.

## Serving

`GET /v1/media/:id` (and `HEAD`).

A picture is **public** when it is approved, sanitised and clean, and its event
is in a status anybody may see (on sale, paused, sold out, published,
postponed, completed or cancelled). A public picture is served to anybody with
`Cache-Control: public, max-age=86400` — except to a reader who sent the
session cookie, who gets `private, max-age=86400`. The optional session guard
may rotate that session and put a fresh secret in `Set-Cookie` on the same
reply, and a shared cache must never store one. Visitors without a session and
the image optimiser, which sends no cookie, get `public`.

Any other picture is served only to its organisation's members who can see
drafts, and to moderators and platform administrators, with
`Cache-Control: private, no-store`. Everybody else gets 404 — the same answer
as a picture that does not exist, so the id says nothing.

Every picture served (200, or 304 on a matching `If-None-Match`) carries:

| Header                                                 | Why                                                       |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `ETag: "sha256-<checksum>"`                            | Revalidation; 304 on a match, decided after authorisation |
| `X-Content-Type-Options: nosniff`                      | The bytes are only ever the stored type                   |
| `Content-Security-Policy: default-src 'none'; sandbox` | Opened directly, the picture is inert                     |
| `Cross-Origin-Resource-Policy: same-origin`            | Another site cannot embed it                              |
| `Content-Disposition: inline`                          | Shown, not downloaded, with a neutral file name           |

A refusal carries none of these. It is `Cache-Control: no-store`, with no
entity tag, set before anything can refuse — including an asset whose stored
bytes are missing, an integrity fault logged by id and answered as a 404 — so a
cache can neither keep the 404 nor later revalidate it to a 304.

Reads are limited to 1,200 a minute per person or address.

### The same-origin proxy

The browser reaches the API through `apps/web/src/app/api/v1/[...path]`. For
pictures it forwards `If-None-Match` upstream, and passes back `ETag`,
`Content-Length`, `Last-Modified`, `Content-Disposition` and the CSP, and
always sets `nosniff`. It buffers at most one picture's worth of request body
(10 MiB + 64 KiB) and answers 413 itself, before contacting the API, when a
body is larger.

### The image optimiser

`next/image` may fetch only `/api/v1/media/**` with no query string: no remote
host, no SVG. The optimiser's own fetch carries no cookie, so it can only ever
see — and cache — a picture the API serves to anybody. A moderator's and an
organiser's previews of pictures that are not public use a plain `<img>`
through the proxy, with their session.

### How long a taken-down picture can linger

Taking a picture down stops the API serving it immediately. A copy that was
already fetched publicly can survive in a browser cache, a shared cache, or
the image optimiser's cache for up to 24 hours from that fetch, because that is
the `max-age` it was served with. There is no purge. A picture that must not be
seen at all should be taken down before the event is approved.

## Social previews and structured data

`app/events/[slug]/opengraph-image.js` and `twitter-image.js` draw a 1200 × 630
PNG for a public event, cacheable for a day. The card shows the approved cover
when the renderer can draw it faithfully, and the event's poster otherwise:

- a WebP cover: the renderer does not decode WebP;
- a JPEG stored turned on its side (EXIF orientation other than 1): the
  renderer ignores orientation, so it would appear sideways;
- a cover over 12 megapixels, to bound the renderer's memory;
- a cover whose bytes could not be fetched anonymously, or are not the type
  the payload said.

The editor's help text says so beside the cover upload. The card's id names
what it shows (`cover-<asset id>` or `poster-<category>`), so replacing the
cover changes its address and no cache keeps serving the old one under it.

The event page's JSON-LD `image` lists the cover and the first two gallery
pictures as absolute URLs on this site, or the poster card's address when
there are none.

## Deleted events — 2026-10-06

A deleted event's pictures stop being served at once (`media.get` answers the
public the 404 an unknown picture gets; the organisation and the Desi-Event
team can still open them), though a copy
already in somebody's browser can stay there for up to a day, the time it was
served with. The rows and bytes are kept so a restore brings the event back
whole, and they do not count toward the organisation's storage quota while it
is deleted. Nothing purges them; whether a purge window is wanted is an open
question for review.

## Imported pictures — 2026-10-06

Pictures of imported events (ADR 0015) are copied by `lib/import-images.js`
from `usimg.sulekha.io` only, through the same sanitiser as an upload, and
stored `PENDING` with an `EventImportImage` row naming where they came from.
Public pages never carry the Sulekha address. The administrator who reviews the
import run approves them together with their event, after seeing them; a
picture stored after that page was loaded changes the event's revision, so the
approval fails rather than publishing a picture nobody looked at.

## Not done

- **No antivirus engine.** The check is structural (above). A moderator
  reviews every picture before it is public.
- **No re-encoding of pixels.** The sanitisers rebuild files from allow-listed
  structure; they do not decode and re-encode image data. A flaw in a
  browser's decoder that is triggered by valid pixel data is not prevented
  here.
- **No signed URLs.** Access is decided per request by authorisation instead.
- **No transcoding at upload.** `next/image` sizes and re-encodes on delivery.
- ~~**No pictures added after publication.**~~ Done 2026-10-06 (ADR 0014): a
  posted event takes new pictures, each approved by somebody other than its
  uploader.
- **Not covered by subject redaction.** Pictures can show identifiable people,
  and the privacy redaction pipeline does not reach them; the organiser can
  delete a picture and a moderator can take one down.
