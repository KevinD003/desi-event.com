# ADR 0009 — Event pictures: bytes in PostgreSQL, rebuilt from an allow-list

- **Status:** Accepted; superseded in part by ADR 0014, 2026-10-06 (a published event takes new pictures)
- **Date:** 2026-09-29
- **Supersedes:** nothing. It replaces `Event.coverImageUrl`, a free-text image
  address that no ADR ever recorded.
- **Related:** ADR 0001, ADR 0004; `docs/MEDIA.md` (the pipeline, step by
  step) and "Uploaded pictures" in `docs/SECURITY.md` (the threat model)

## Context

An organiser asked to put their own poster and photographs on an event. Until
this work an event carried `coverImageUrl`, a string pointing anywhere. Nothing
fetched it, checked it or reviewed it; rendering it would have made every
event page load a third party's bytes, and fetching it server-side would have
been a request forgery primitive.

Taking uploads instead raises three questions this ADR settles:

- **Where do the bytes live?** The build runs in CI, on one instance and on
  several, with no shared disk and no object store provisioned.
- **What makes an uploaded file safe to serve?** A picture is the one place a
  stranger's file becomes part of a public page. SVG and HTML carry script;
  JPEG, PNG and WebP carry EXIF GPS coordinates, camera serials, XMP, comments,
  embedded thumbnails and trailing data that can turn a valid picture into a
  polyglot.
- **What does the build claim about it?** There is no antivirus engine, and
  none can be added here.

## Options

**Storage.** (a) A local directory: fails with two instances and in CI's
throwaway containers. (b) An object store: needs a provider, credentials, a
put before the transaction, a compensating delete when the transaction fails,
and a sweep for orphans a crash leaves. (c) PostgreSQL: one more table, bytes
committed in the same transaction as the row that names them.

**Sanitising.** (a) Delete known-bad parts: a blocklist, which is only as good
as the list. (b) Decode and re-encode every picture with an image library:
removes everything but adds a native decoder, run on hostile input, on the
server. (c) Parse each container and **rebuild** it from an allow-list of
structures, refusing what the parser does not understand, without decoding a
single pixel.

## Decision

**Storage (c): PostgreSQL.**

1. The bytes are in their own table, `MediaBlob` (`bytea`, `STORAGE EXTERNAL`
   because these formats are already compressed), one row per `MediaAsset`,
   joined by `storageKey` with `ON DELETE CASCADE`. A separate table rather
   than a column, so an ordinary read of `MediaAsset` — which event lists make
   — never pulls megabytes.
2. The write commits in the same transaction as the picture's row, the event's
   revision bump and the audit row, so there is never an asset without bytes or
   bytes without an asset.
3. Every access goes through the `MediaStorage` interface in
   `apps/api/src/lib/media-storage.js` (`put(tx, …)`, `read(key)`,
   `remove(tx, key)`). Moving to an object store means one adapter whose `put`
   runs before the transaction, a compensating `remove` on failure and an
   orphan sweep; nothing else in the API learns where the bytes are.
4. The storage key is `pg/` and a random UUID. It is in no wire schema, no
   audit row and no log line, and `scripts/scan-browser-bundle.mjs` forbids
   `storageKey` in browser code.
5. Each organisation may store 1 GiB, counted from the stored sizes.

**Sanitising (c): rebuild from an allow-list.**

1. The format is decided by the first bytes, never by the declared type or the
   file name. Only JPEG, PNG and WebP are accepted; an SVG, HTML page, GIF,
   HEIC, AVIF, PDF or archive is 415 whatever it is called. A body declared as
   anything but a picture type or `application/octet-stream` is 415 before it
   is read.
2. Each format has a small, bounds-checked, pure-JavaScript sanitiser in
   `apps/api/src/lib/media/` that walks the structure, copies the parts on its
   allow-list into a new file and refuses what it does not understand. EXIF,
   XMP, IPTC, comments, text chunks, embedded thumbnails (JFIF and JFXX
   included) and anything after the end marker are not copied. A JPEG's
   orientation is kept as a new EXIF segment holding that one tag. An animated
   PNG keeps its default image as a still; an animated WebP is refused.
3. Dimensions come from the file's own header and no pixel data is
   decompressed on the server, so a decompression bomb is refused by the limits
   (8,000 pixels a side, 40 megapixels) without being expanded. Bodies are
   capped at 10 MiB while they are read.
4. The rebuilt file is sniffed again and its SHA-256 taken. Unsanitised bytes
   are never stored. Each row records `scanStatus = CLEAN`, `sanitisedAt` and
   the note `structural-v1: parsed, rebuilt from allow-listed segments,
metadata removed; no antivirus engine` — the honest name of the check.
5. A moderator reviews every new picture with its event, and only an approved,
   sanitised picture of a publicly visible event is served publicly. New
   pictures can be added only while the event is a draft or has changes
   requested, so the moderator saw exactly the set that goes live.
6. Pictures are served with their exact sniffed type, `nosniff`,
   `Content-Security-Policy: default-src 'none'; sandbox` and
   `Cross-Origin-Resource-Policy: same-origin`, so even a picture opened
   directly is inert. The web image optimiser allows no remote host and no SVG.

**`coverImageUrl` is dropped.** The migration counts non-null values in a
notice and drops the column; there is no data migration, because fetching a
third party's bytes is exactly what this removes. A request that still sends
the key is refused with a 400 naming the upload route.

## Evidence

- `apps/api/src/lib/media/*.test.js`: each sanitiser, including a camera JPEG
  with GPS whose stored bytes carry none, a JFIF thumbnail, trailing data and a
  seeded fuzz test of 500 mutated files that accepts only a clean refusal or a
  valid output.
- `apps/api/tests/event-media.test.js`, `media-serving.test.js`,
  `media-moderation.test.js`: the refusal order before any body byte is read,
  the cache and header rules, the takedown and the stale-approval refusal.
- `apps/api/tests/event-media-integration.test.js` (real PostgreSQL) and
  `packages/db/scripts/media-probes.mjs` (run by `pnpm db:verify:fresh`): one
  cover per event, the gallery cap of eight under concurrent inserts, the blob
  cascade and the CHECK constraints.

## Consequences

- **No antivirus engine.** The check is structural. The limitations page lists
  "Virus scanning of uploaded pictures" as NOT IMPLEMENTED and says a moderator
  reviews each picture before it is public.
- **No pixel re-encoding.** A flaw in a viewer's image decoder triggered by
  valid pixel data is not prevented by rebuilding the container around it.
- **The database grows with pictures.** Backups carry them. The per-organisation
  quota bounds it; there is no archive tier.
- **A published event takes no new picture.** Its pictures can be described
  again, reordered or removed, but a new picture would go live unreviewed, so
  the limitations page lists "Adding pictures to a published event" as NOT
  IMPLEMENTED.

  > **Superseded in part by ADR 0014 (2026-10-06):** a published event takes new
  > pictures, each approved individually by somebody on the team at
  > The Desi Events other than its uploader; the old cover stays until a
  > replacement is approved. The limitation was removed.

- **The gallery-cap trigger locks the event row `FOR NO KEY UPDATE`.** That
  serialises two gallery inserts without blocking a checkout's foreign-key
  insert on the same event, and it does queue other authoring writes on that
  event until the upload commits, so the upload transaction is kept short.
- **A taken-down picture can stay in caches** that fetched it publicly for up to
  the 24 hours it was served with. There is no purge.
