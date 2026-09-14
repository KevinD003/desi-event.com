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

  it('exports the validator so the API server can self-check at boot', () => {
    expect(typeof contract.validateContract).toBe('function')
    expect(typeof contract.assertContractValid).toBe('function')
  })

  it('re-exports without name collisions between modules', () => {
    const names = Object.keys(contract)
    expect(new Set(names).size).toBe(names.length)
  })
})
