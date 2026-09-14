import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { API_ERRORS, apiRoutes, routeById } from './routes.js'
import { assertContractValid, validateContract } from './validate.js'

const run = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../scripts/validate-contract.mjs', import.meta.url))

/**
 * Collect the issue codes a validation run produced.
 *
 * @param {{issues: Array<{code: string}>}} result A validation result.
 * @returns {string[]} The codes, in order.
 */
function codes(result) {
  return result.issues.map((issue) => issue.code)
}

describe('validateContract', () => {
  it('passes for the real contract', () => {
    const result = validateContract()

    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.routeCount).toBe(apiRoutes.length)
    expect(result.document.openapi).toBe('3.1.0')
  })

  it('rejects an empty table', () => {
    expect(codes(validateContract({ routes: [] }))).toContain('EMPTY_CONTRACT')
  })

  it('catches a missing required field', () => {
    const { summary: _summary, ...broken } = routeById('events.list')
    const result = validateContract({ routes: [broken] })

    expect(codes(result)).toContain('MISSING_FIELD')
    expect(result.ok).toBe(false)
  })

  it('catches an empty summary or description', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), summary: '  ' }] }))).toContain(
      'MISSING_SUMMARY',
    )
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), description: '' }] })),
    ).toContain('MISSING_DESCRIPTION')
  })

  it('catches a duplicated route id', () => {
    const route = routeById('events.list')
    const result = validateContract({ routes: [route, { ...route, path: '/v1/elsewhere' }] })

    expect(codes(result)).toContain('DUPLICATE_ID')
  })

  it('catches two routes colliding on method and path', () => {
    const route = routeById('events.list')
    const result = validateContract({ routes: [route, { ...route, id: 'events.other' }] })

    expect(codes(result)).toContain('DUPLICATE_ROUTE')
  })

  it('catches a collision that differs only in the parameter name', () => {
    const result = validateContract({
      routes: [
        routeById('events.get'),
        { ...routeById('events.get'), id: 'events.byId', path: '/v1/events/:id' },
      ],
    })

    expect(codes(result)).toContain('DUPLICATE_ROUTE')
  })

  it('catches an unsupported method and an unknown auth mode', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), method: 'TRACE' }] }))).toContain(
      'BAD_METHOD',
    )
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), auth: 'cookie' }] }))).toContain(
      'BAD_AUTH',
    )
  })

  it('catches a path that does not start with a slash', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), path: 'v1/events' }] }))).toContain(
      'BAD_PATH',
    )
  })

  it('catches an id that is not a dotted namespace pair', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), id: 'eventsList' }] }))).toContain(
      'BAD_ID',
    )
  })

  it('catches a schema slot holding something that is not a Zod schema', () => {
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), query: { shape: {} } }] })),
    ).toContain('BAD_SCHEMA')
  })

  it('catches a missing response schema', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), response: null }] }))).toContain(
      'MISSING_RESPONSE',
    )
  })

  it('catches a non-2xx success status', () => {
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), successStatus: 302 }] })),
    ).toContain('BAD_SUCCESS_STATUS')
  })

  it('catches a path parameter with no params schema', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.get'), params: null }] }))).toContain(
      'MISSING_PARAMS_SCHEMA',
    )
  })

  it('catches a params schema on a path with no parameters', () => {
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), params: z.object({ id: z.string() }) }] })),
    ).toContain('UNUSED_PARAMS_SCHEMA')
  })

  it('catches a body declared on a GET', () => {
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), body: z.object({ a: z.string() }) }] })),
    ).toContain('BODY_ON_BODYLESS_METHOD')
  })

  it('catches a malformed error catalogue entry', () => {
    expect(
      codes(validateContract({ routes: [{ ...routeById('events.list'), errors: [{ status: 400 }] }] })),
    ).toContain('BAD_ERROR_ENTRY')
  })

  it('catches the same error status documented twice', () => {
    expect(
      codes(
        validateContract({
          routes: [
            { ...routeById('events.list'), errors: [API_ERRORS.validation, { ...API_ERRORS.validation }] },
          ],
        }),
      ),
    ).toContain('DUPLICATE_ERROR_STATUS')
  })

  it('catches a route with no tags', () => {
    expect(codes(validateContract({ routes: [{ ...routeById('events.list'), tags: [] }] }))).toContain(
      'MISSING_TAGS',
    )
  })

  it('reports generation failure rather than letting it escape', () => {
    const result = validateContract({ routes: [{ ...routeById('events.list'), response: {} }] })

    expect(codes(result)).toContain('GENERATION_FAILED')
    expect(result.document).toBeNull()
  })

  it('handles a table entry that is not an object at all', () => {
    expect(codes(validateContract({ routes: [null] }))).toContain('NOT_AN_OBJECT')
  })
})

describe('assertContractValid', () => {
  it('returns the document for a valid contract', () => {
    expect(assertContractValid().openapi).toBe('3.1.0')
  })

  it('throws with every issue listed', () => {
    const route = routeById('events.list')

    expect(() => assertContractValid({ routes: [route, { ...route, id: 'events.other' }] })).toThrow(
      /Invalid API contract/,
    )
    expect(() => assertContractValid({ routes: [route, { ...route, id: 'events.other' }] })).toThrow(
      /DUPLICATE_ROUTE/,
    )
  })
})

describe('scripts/validate-contract.mjs', () => {
  it('exits 0 and reports the route count for the real contract', async () => {
    const { stdout } = await run(process.execPath, [SCRIPT])

    expect(stdout).toContain('API contract is valid')
    expect(stdout).toContain(`${apiRoutes.length} routes`)
  })

  it('emits machine-readable output with --json', async () => {
    const { stdout } = await run(process.execPath, [SCRIPT, '--json'])
    const parsed = JSON.parse(stdout)

    expect(parsed).toMatchObject({ ok: true, routeCount: apiRoutes.length, issues: [] })
  })

  it('writes the document when asked', async () => {
    const { readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const target = join(tmpdir(), `desi-openapi-${process.pid}.json`)

    try {
      await run(process.execPath, [SCRIPT, '--out', target])
      const written = JSON.parse(await readFile(target, 'utf8'))

      expect(written.openapi).toBe('3.1.0')
      expect(Object.keys(written.paths).length).toBeGreaterThan(0)
    } finally {
      await rm(target, { force: true })
    }
  })
})
