import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  VALIDATION_ERROR_CODE,
  ValidationError,
  formatIssuePath,
  formatIssues,
  isValidationError,
  parseOrThrow,
  safeParseWithIssues,
} from './errors.js'

describe('formatIssuePath', () => {
  it('returns an empty string for a root-level issue', () => {
    expect(formatIssuePath([])).toBe('')
    expect(formatIssuePath(undefined)).toBe('')
    expect(formatIssuePath('not-an-array')).toBe('')
  })

  it('joins object keys with dots', () => {
    expect(formatIssuePath(['error', 'message'])).toBe('error.message')
  })

  it('renders numeric segments as array indices', () => {
    expect(formatIssuePath(['items', 0, 'quantity'])).toBe('items[0].quantity')
  })

  it('handles a leading array index', () => {
    expect(formatIssuePath([2, 'id'])).toBe('[2].id')
  })
})

describe('formatIssues', () => {
  it('flattens a ZodError into plain objects', () => {
    const schema = z.object({ items: z.array(z.object({ quantity: z.number() })) })
    const result = schema.safeParse({ items: [{ quantity: 'two' }] })

    expect(result.success).toBe(false)
    const issues = formatIssues(result.error)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('items[0].quantity')
    expect(issues[0].code).toBe('invalid_type')
    expect(typeof issues[0].message).toBe('string')
  })

  it('returns an empty array when there is nothing to report', () => {
    expect(formatIssues(undefined)).toEqual([])
    expect(formatIssues({})).toEqual([])
    expect(formatIssues({ issues: 'nope' })).toEqual([])
  })

  it('substitutes defaults for malformed issues', () => {
    expect(formatIssues({ issues: [{}] })).toEqual([
      { path: '', code: 'custom', message: 'Invalid value' },
    ])
  })
})

describe('ValidationError', () => {
  it('carries a 400 status, a code and its issues', () => {
    const error = new ValidationError('Bad body', [
      { path: 'email', code: 'invalid_format', message: 'Invalid email' },
    ])

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ValidationError')
    expect(error.statusCode).toBe(400)
    expect(error.code).toBe(VALIDATION_ERROR_CODE)
    expect(error.issues).toHaveLength(1)
  })

  it('defaults its message and issue list', () => {
    const error = new ValidationError()
    expect(error.message).toBe('Validation failed')
    expect(error.issues).toEqual([])
  })

  it('tolerates a non-array issue list', () => {
    expect(new ValidationError('x', null).issues).toEqual([])
  })

  it('records the underlying cause when given one', () => {
    const cause = new Error('root')
    expect(new ValidationError('x', [], { cause }).cause).toBe(cause)
    expect(new ValidationError('x', []).cause).toBeUndefined()
  })

  it('serialises to the error response body shape', () => {
    const issues = [{ path: 'a', code: 'custom', message: 'nope' }]
    expect(new ValidationError('Bad', issues).toJSON()).toEqual({
      code: VALIDATION_ERROR_CODE,
      message: 'Bad',
      statusCode: 400,
      issues,
    })
  })
})

describe('isValidationError', () => {
  it('recognises a ValidationError', () => {
    expect(isValidationError(new ValidationError('x'))).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidationError(new Error('x'))).toBe(false)
    expect(isValidationError(null)).toBe(false)
    expect(isValidationError({ code: VALIDATION_ERROR_CODE, issues: [] })).toBe(false)
  })

  it('recognises a structurally identical error from a duplicated module copy', () => {
    const impostor = new Error('x')
    impostor.code = VALIDATION_ERROR_CODE
    impostor.issues = []
    expect(isValidationError(impostor)).toBe(true)
  })
})

describe('parseOrThrow', () => {
  const schema = z.object({ email: z.email(), age: z.coerce.number().int().min(0) })

  it('returns the parsed and coerced value', () => {
    expect(parseOrThrow(schema, { email: 'a@b.com', age: '21' })).toEqual({
      email: 'a@b.com',
      age: 21,
    })
  })

  it('throws a ValidationError carrying the issues', () => {
    let thrown
    try {
      parseOrThrow(schema, { email: 'nope', age: -1 }, 'Invalid body')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ValidationError)
    expect(thrown.message).toBe('Invalid body')
    expect(thrown.statusCode).toBe(400)
    expect(thrown.issues.map((issue) => issue.path).sort()).toEqual(['age', 'email'])
  })

  it('uses a default message', () => {
    expect(() => parseOrThrow(schema, {})).toThrow('Validation failed')
  })

  it('rejects a non-schema argument', () => {
    expect(() => parseOrThrow(null, {})).toThrow(TypeError)
    expect(() => parseOrThrow({}, {})).toThrow(/safeParse/)
  })
})

describe('safeParseWithIssues', () => {
  it('reports success with the parsed data', () => {
    expect(safeParseWithIssues(z.string(), 'hello')).toEqual({ success: true, data: 'hello' })
  })

  it('reports failure with flattened issues instead of throwing', () => {
    const result = safeParseWithIssues(z.object({ a: z.string() }), { a: 1 })
    expect(result.success).toBe(false)
    expect(result.issues[0].path).toBe('a')
  })

  it('rejects a non-schema argument', () => {
    expect(() => safeParseWithIssues(undefined, 1)).toThrow(TypeError)
  })
})
