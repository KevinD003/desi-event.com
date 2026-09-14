/**
 * Next.js configuration for the Desi-Event web application.
 *
 * The workspace packages ship untranspiled `.js`/`.jsx` sources rather than a
 * build output — there is no compiler in this repository — so Next has to run
 * them through its own transform. `transpilePackages` is what makes that
 * happen for code resolved outside this application's own `src` tree.
 */

/** Workspace packages whose sources Next must transform rather than treat as pre-built. */
const workspacePackages = [
  '@desi-event/ui',
  '@desi-event/api-contract',
  '@desi-event/schemas',
  '@desi-event/pricing',
]

const nextConfig = {
  reactStrictMode: true,
  // `next dev` binds to localhost and treats a request arriving as 127.0.0.1 as
  // a different origin, which blocks the dev-only HMR endpoint and leaves the
  // page server-rendered but never hydrated. The end-to-end suite drives the
  // app over the loopback address, so both spellings are allowed. Development
  // only — `next start` ignores this.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '[::1]'],
  transpilePackages: workspacePackages,
  // The monorepo root holds the lockfile; naming it explicitly stops Next from
  // guessing and picking the wrong workspace root in a pnpm workspace.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  poweredByHeader: false,
}

export default nextConfig
