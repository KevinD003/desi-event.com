/**
 * Locating the Chromium that ships with the image.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` already points the driver at this directory, so
 * normally nothing needs to be said. But if the preinstalled build's revision
 * does not match the one this Playwright expects, the driver looks for a
 * directory that is not there and fails; pointing `executablePath` straight at
 * the binary sidesteps the revision check entirely.
 *
 * @module e2e/support/chromium
 */

import { existsSync } from 'node:fs'

/**
 * An absolute path to a usable Chromium binary.
 *
 * @returns {string|undefined} The path, or `undefined` to let Playwright resolve it.
 */
export function preinstalledChromium() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return process.env.CHROMIUM_EXECUTABLE_PATH

  const candidates = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ]

  return candidates.find((candidate) => existsSync(candidate))
}
