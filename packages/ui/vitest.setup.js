/**
 * Test environment setup for @desi-event/ui.
 *
 * Registers the jest-dom matchers (`toHaveFocus`, `toHaveAccessibleName`,
 * `toBeVisible`, …) and unmounts rendered trees between tests. Testing
 * Library's automatic cleanup only installs itself when a global `afterEach`
 * exists, and the shared preset runs Vitest with `globals: false`, so the hook
 * is registered explicitly here.
 */

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})
