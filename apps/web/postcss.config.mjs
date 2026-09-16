/**
 * PostCSS configuration.
 *
 * Tailwind CSS v4 is configured entirely in CSS (see `src/app/globals.css` and
 * the shared theme in `@desi-event/config/tailwind`), so the only plugin here
 * is Tailwind's own PostCSS bridge. There is no `tailwind.config.js`.
 */

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
