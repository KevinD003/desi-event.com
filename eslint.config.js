/**
 * Root ESLint flat configuration.
 *
 * Every workspace inherits this file; running `pnpm lint` at the repository
 * root lints all applications and packages in one pass.
 */

import { createConfig } from '@desi-event/config/eslint'

export default createConfig()
