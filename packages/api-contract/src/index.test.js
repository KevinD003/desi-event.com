import { describe, expect, it } from 'vitest'

import * as contract from './index.js'
import * as client from './client.js'

describe('package surface', () => {
  it('exports the five names the cross-package contract promises', () => {
    expect(typeof contract.routeById).toBe('function')
    expect(typeof contract.buildOpenApiDocument).toBe('function')
    expect(typeof contract.createApiClient).toBe('function')
    expect(typeof contract.ApiClientError).toBe('function')
    expect(Array.isArray(contract.apiRoutes)).toBe(true)
  })

  it('exposes the same ApiClientError from the "./client" entry point', () => {
    expect(client.ApiClientError).toBe(contract.ApiClientError)
    expect(client.createApiClient).toBe(contract.createApiClient)
  })

  it('keeps the validator off the barrel, where a browser would find it', () => {
    // Finding NF-15. `validate.js` is the one module here that imports another
    // package, and that import put the platform's password hashing into the
    // browser bundle. It has its own entry point now, and reaching for it is a
    // decision rather than a side effect of importing the client.
    expect(contract.validateContract).toBeUndefined()
    expect(contract.assertContractValid).toBeUndefined()
  })

  it('serves the validator from "./validate" for the callers that need it', async () => {
    const validate = await import('./validate.js')

    expect(typeof validate.validateContract).toBe('function')
    expect(typeof validate.assertContractValid).toBe('function')
  })

  it('re-exports without name collisions between modules', () => {
    const names = Object.keys(contract)
    expect(new Set(names).size).toBe(names.length)
  })
})
