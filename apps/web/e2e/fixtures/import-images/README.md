# Pictures for the import journeys

The pictures `detail-event-import.spec.js` and the import cases of
`accessibility-sweep.spec.js` copy from "Sulekha". The API in those runs reads
pictures from a directory instead of the network (`IMPORT_IMAGE_SOURCE=fixtures`,
SPEC2-XI §5.I-D): each listed address's file name is looked up in
`IMPORT_IMAGE_FIXTURE_DIR`, and nothing is fetched.

That directory is never this one. `e2e/support/seed-import.mjs` empties a
temporary directory and copies these files into it on every run, leaving out the
late picture; journey I5 copies the late picture in before "Retry pictures". So
nothing here is written during a run, and a second run starts from the same
state.

Each file is one colour, eight-bit RGB, with no text chunk, made with
`solidPng` from `e2e/support/images.mjs`:

| File                            | Size       | Colour (RGB) | Listed as                                   |
| ------------------------------- | ---------- | ------------ | ------------------------------------------- |
| `garba-night-cover.png`         | 1200 × 630 | 214, 88, 43  | the garba night's cover                     |
| `garba-night-circle.png`        | 800 × 600  | 43, 120, 214 | the garba night's gallery picture           |
| `bollywood-evening-cover.png`   | 1200 × 630 | 160, 40, 120 | the Bollywood evening's cover               |
| `classical-concert-cover.png`   | 1200 × 630 | 32, 110, 80  | the concert's cover                         |
| `classical-concert-tanpura.png` | 800 × 600  | 190, 150, 40 | the concert's gallery picture: the late one |

A cover is at least 960 × 540 and a gallery picture at least 320 on its shorter
side, as the upload sanitiser requires (`MEDIA_LIMITS`).
