/**
 * Prisma configuration.
 *
 * Prisma 7 reads connection details from this file rather than from
 * `schema.prisma`, which keeps secrets out of the schema. The file is plain
 * JavaScript — the repository does not use TypeScript configuration files.
 */

import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

const connectionString = process.env.DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node scripts/seed.mjs',
  },
  datasource: { url: connectionString },
  adapter: () => new PrismaPg({ connectionString }),
})
