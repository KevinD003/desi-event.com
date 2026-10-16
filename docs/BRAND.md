# The Desi Events brand files

The site's logo, icons and link-preview picture come from the owner's brand kit,
_The Desi Events Brand Kit_. The kit itself — the full-resolution masters, the
social profile pictures, covers and post templates — stays with the owner and is
**not** in this repository. What is committed here is only what the website
serves, each file derived from one kit file and sized for where it is drawn.

## The brand, as the kit states it

- **Official symbol:** the illustrated capital D — a dancer, the Dallas skyline
  and a concert crowd.
- **Tagline:** "EVERY MOMENT, ONE PLACE." The site writes it in sentence case,
  "Every moment, one place.", where it is text (`lib/brand.js`).
- **Colours (from the kit's README):** Gold `#D4A529`, Magenta `#B0004A`,
  Royal Purple `#32105E`, Celebration Orange `#F47A1F`, White `#FFFFFF`. Since
  the Poster House+ redesign these **are** the anchors of the site's colour
  tokens: each is declared, converted to oklch, as the named step of a ramp in
  `packages/config/src/tailwind.css` (`brand-magenta-600`, `brand-purple-900`,
  `brand-gold-500`, `brand-orange-500`), and the semantic tokens are built
  around them — the purple plate is the kit purple exactly, the primary action
  is the kit magenta, the foil is the gold, "tonight" is the orange, and the
  page is white. `token-contrast.test.js` pins the four anchors. Components
  still draw only in the semantic tokens, never in the ramps; the roles are in
  `docs/DESIGN.md`.

## What is derived from what

Every derived file was made with `sharp` 0.35.5 from the kit file named, by a
script kept outside the repository. "Trimmed" means cropped to the bounding box
of pixels with alpha above 8 (out of 255), plus a 2px margin: the kit's
1200 × 400 header logos carry wide transparent padding, and a faint haze of
alpha 1–4 well outside the artwork that would otherwise defeat a plain trim.
WebP files are lossy with a full-quality alpha channel (`quality: 90`,
`alphaQuality: 100`, `effort: 6`), resized with Lanczos-3.

| Served file                        | Size (px)  | Bytes   | From (kit path)                                   | How                                                                                                                                  |
| ---------------------------------- | ---------- | ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `public/brand/logo-light-1x.webp`  | 162 × 40   | 6,314   | `02_Website/header_logo_light_1200x400.png`       | Trimmed to 926 × 229, resized to 40px tall. Header (always a white surface).                                                         |
| `public/brand/logo-light-2x.webp`  | 323 × 80   | 15,890  | same                                              | Same trim, 80px tall: the 2x copy.                                                                                                   |
| `public/brand/logo-dark-1x.webp`   | 186 × 56   | 8,274   | `02_Website/header_logo_dark_1200x400.png`        | Trimmed to 848 × 256, resized to 56px tall. Footer (the purple plate).                                                               |
| `public/brand/logo-dark-2x.webp`   | 371 × 112  | 22,524  | same                                              | Same trim, 112px tall: the 2x copy.                                                                                                  |
| `public/brand/d-icon-1x.webp`      | 42 × 40    | 2,262   | `01_Master_Logos/official_D_icon_transparent.png` | Trimmed to 1007 × 956, resized to 40px tall. The decorative D on the sign-in and register card.                                      |
| `public/brand/d-icon-2x.webp`      | 84 × 80    | 5,488   | same                                              | Same trim, 80px tall: the 2x copy.                                                                                                   |
| `public/brand/logo-square-512.png` | 512 × 512  | 39,973  | `02_Website/primary_logo_1200x1200.png`           | Resized to 512 × 512 (not trimmed: the kit's square framing is kept). 8-bit palette PNG with alpha. The `Organization` JSON-LD logo. |
| `public/brand/og-default.jpg`      | 1200 × 630 | 160,035 | `01_Master_Logos/brand_cover_master.jpg`          | See below. The Open Graph and Twitter card picture.                                                                                  |
| `src/app/favicon.ico`              | 16–256     | 91,834  | `02_Website/favicons/favicon.ico`                 | As delivered: six sizes, 16, 32, 48, 64, 128 and 256.                                                                                |
| `src/app/icon.png`                 | 512 × 512  | 184,214 | `02_Website/favicons/favicon_512x512.png`         | As delivered.                                                                                                                        |
| `src/app/apple-icon.png`           | 180 × 180  | 31,595  | `02_Website/favicons/favicon_180x180.png`         | As delivered.                                                                                                                        |
| `public/icons/icon-192.png`        | 192 × 192  | 34,874  | `02_Website/favicons/favicon_192x192.png`         | As delivered. Web app manifest.                                                                                                      |
| `public/icons/icon-512.png`        | 512 × 512  | 184,214 | `02_Website/favicons/favicon_512x512.png`         | As delivered. Web app manifest.                                                                                                      |

**The link-preview picture.** The kit's cover is named `.jpg` but is really a
2056 × 765 PNG: a dark purple stage with the logo and the tagline. It was scaled
to 1200 wide (1200 × 446) and centred, unchanged, on a 1200 × 630 canvas filled
with `#280329`, the median colour of the cover's top and bottom rows of pixels —
so nothing of the artwork or the tagline is cropped, and the bands above and
below continue the cover's own edge. Saved as JPEG, quality 85 (mozjpeg, 4:4:4
chroma). Its alternative text is "The Desi Events — Every moment, one place.",
the words drawn in it.

## Where each file is used

- **Header** (`components/site-header.jsx`): the light logo, fetched first
  (`fetchpriority="high"`), drawn 40px tall from 640px and smaller on a phone so
  the row stays one 64px line; the module comment records the measurements.
- **Footer** (`components/site-footer.jsx`): the dark logo, 56px tall, on the
  purple plate.
- **Sign-in and register card** (`components/auth-frame.jsx`): the D alone,
  40px tall, `alt=""` — the header's logo link already names the brand.
- **Icons**: `favicon.ico`, `icon.png` and `apple-icon.png` in `src/app/` are
  linked by Next.js's file conventions; the manifest (`src/app/manifest.js`)
  lists the 192 and 512 PNGs in `public/icons/` with purpose `any`.
- **Metadata** (`src/app/layout.jsx`): `openGraph.images` and `twitter.images`
  name `/brand/og-default.jpg`, made absolute by `metadataBase`
  (`NEXT_PUBLIC_SITE_URL`).
- **Structured data** (`lib/contact.js`): the home page's `Organization` names
  the square logo as an absolute address on the deployment's own origin.

Every logo picture has the accessible name "The Desi Events" once per link, or
is `alt=""` where it is decorative (`components/brand-logo.jsx`).
`lib/brand.test.js` reads each file and holds it to the pixel size the markup
and metadata declare, and the header and footer logo files to under 60 KB.

## Not in the repository

The masters in `01_Master_Logos/` (1–2 MB each), the kit's 1200-pixel website
files, and everything in `03_Social_Profile_Images/`, `04_Social_Covers/` and
`05_Post_Story_Templates/` are for the owner's own use and social accounts.
They live in the owner's brand kit. To change a logo, change it in the kit and
derive the web files again as described above.
