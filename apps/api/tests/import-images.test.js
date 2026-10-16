/**
 * The importer's picture copying is gone (2026-10-15).
 *
 * Until then `lib/import-images.js` fetched each listed picture from the
 * source's picture host, the API's one outbound caller, and "Retry pictures"
 * tried again. The owner, asked whether pictures could be copied once: "No
 * contact at all". So the fetcher, the route, the table of pictures and the
 * environment settings that pointed the fetcher at a directory are removed,
 * and these tests hold each of them gone. That the API makes no outbound
 * request at all, from any module, is held by `security-regression.test.js`
 * ("the API has no way out"); that an import makes none while it runs is held
 * by `import-no-outbound.test.js`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'
import { apiEnvSchema } from '@desi-event/schemas/env'
import * as imports from '@desi-event/schemas/imports'

import * as eventImport from '../src/lib/event-import.js'
import * as eventMedia from '../src/lib/event-media.js'
import * as importDataset from '../src/lib/import-dataset.js'
import { bearer, createTestApp, signIn, stepUp, testEnv } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

describe('copying imported pictures is gone', () => {
  it('has no fetcher module, and no picture step in the importer', () => {
    expect(existsSync(path.join(REPO, 'apps/api/src/lib/import-images.js'))).toBe(false)

    for (const name of ['fetchRunImages', 'retryRunImages', 'IMPORT_IMAGE_CONCURRENCY']) {
      expect(eventImport, name).not.toHaveProperty(name)
    }
    for (const name of ['storeImportedImage', 'approveImportedMedia']) {
      expect(eventMedia, name).not.toHaveProperty(name)
    }
    expect(importDataset).not.toHaveProperty('IMPORT_SOURCE_HOSTS')
    expect(importDataset).not.toHaveProperty('sourceUrlProblem')
  })

  it('has no route to copy pictures again, and no request body for one', () => {
    expect(apiRoutes.map((route) => route.id)).not.toContain('eventImports.retryImages')
    expect(imports).not.toHaveProperty('eventImportRetryRequestSchema')
  })

  it('has no setting that points a fetcher anywhere', () => {
    const parsed = apiEnvSchema.parse(
      testEnv({ IMPORT_IMAGE_SOURCE: 'fixtures', IMPORT_IMAGE_FIXTURE_DIR: '/tmp/pictures' }),
    )

    expect(Object.keys(parsed).filter((key) => key.startsWith('IMPORT_IMAGE'))).toEqual([])
  })

  it('has no table for copied pictures in the schema', () => {
    const schema = readFileSync(path.join(REPO, 'packages/db/prisma/schema.prisma'), 'utf8')

    expect(schema).not.toMatch(/\bmodel EventImportImage\b|\benum EventImportImage/u)
    expect(schema).not.toMatch(/\bsourceUrl\b/u)
  })

  it('answers the old copying route as any route that does not exist', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    for (const payload of [{}, { eventIds: [cuid()] }]) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/platform/imports/${cuid()}/images/retry`,
        headers,
        payload,
      })

      expect(response.statusCode).toBe(404)
    }

    await app.close()
  })
})
