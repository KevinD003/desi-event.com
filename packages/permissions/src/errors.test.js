import { describe, it, expect } from 'vitest'

import { PermissionError } from './errors.js'

describe('PermissionError', () => {
  it('defaults to a 403 FORBIDDEN with null details', () => {
    const error = new PermissionError('nope')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PermissionError')
    expect(error.message).toBe('nope')
    expect(error.statusCode).toBe(403)
    expect(error.code).toBe('FORBIDDEN')
    expect(error.capability).toBe(null)
    expect(error.organizationId).toBe(null)
    expect(error.actorId).toBe(null)
    expect(error.reason).toBe('missing_capability')
  })

  it('records supplied details', () => {
    const error = new PermissionError('denied', {
      capability: 'order:refund',
      organizationId: 'org_1',
      actorId: 'usr_1',
      reason: 'unauthenticated',
    })

    expect(error.capability).toBe('order:refund')
    expect(error.organizationId).toBe('org_1')
    expect(error.actorId).toBe('usr_1')
    expect(error.reason).toBe('unauthenticated')
  })

  it('serialises to a client-safe payload without the actor id', () => {
    const error = new PermissionError('denied', {
      capability: 'order:refund',
      organizationId: 'org_1',
      actorId: 'usr_secret',
    })

    expect(error.toJSON()).toEqual({
      error: 'FORBIDDEN',
      message: 'denied',
      statusCode: 403,
      capability: 'order:refund',
    })
    expect(JSON.stringify(error)).not.toContain('usr_secret')
  })

  it('captures a stack trace that excludes the constructor', () => {
    const error = new PermissionError('denied')

    expect(typeof error.stack).toBe('string')
    expect(error.stack).toContain('PermissionError')
  })
})
