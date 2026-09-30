/**
 * The request validator: Zod first, then no NUL anywhere in what passed.
 *
 * PostgreSQL stores U+0000 in no text column (22021) and no JSON column
 * (22P05). A schema that forgets to refuse it used to let a NUL through to a
 * `jsonb` write, where it came back as a 500. The validator now refuses it in
 * every string of every validated request part, before any handler runs.
 *
 * @module @desi-event/api/tests/validation
 */

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { withoutControlCharacters } from '@desi-event/schemas'

import { UNSTORABLE_CHARACTER_MESSAGE } from '../src/lib/errors.js'
import { findUnstorableCharacter, zodValidatorCompiler } from '../src/lib/validation.js'
import { registerErrorHandler } from '../src/plugins/error-handler.js'
import { registerValidation } from '../src/plugins/validation.js'

describe('findUnstorableCharacter', () => {
  it('finds a NUL in any string, at any depth, and names the first in document order', () => {
    expect(findUnstorableCharacter('a\u0000b')).toEqual([])
    expect(findUnstorableCharacter({ reason: 'Needs\u0000access' })).toEqual(['reason'])
    expect(
      findUnstorableCharacter({
        faq: [
          { question: 'Q', answer: 'fine' },
          { question: 'Q\u0000', answer: 'A\u0000' },
        ],
        later: '\u0000',
      }),
    ).toEqual(['faq', 1, 'question'])
    expect(findUnstorableCharacter({ policies: { refund: 'no\u0000refunds' } })).toEqual([
      'policies',
      'refund',
    ])
  })

  it('reports a NUL in a key at the object that holds it, never echoing the key', () => {
    expect(findUnstorableCharacter({ metadata: { 'bad\u0000key': 'value' } })).toEqual(['metadata'])
  })

  it('passes everything PostgreSQL can store, including other control characters', () => {
    expect(
      findUnstorableCharacter({
        text: 'Line one\nLine two\ttabbed\r\n',
        bell: '\u0007',
        emoji: 'Garba 💃',
        when: new Date(),
        count: 3,
        flag: true,
        nothing: null,
        absent: undefined,
        list: [1, 'two', { three: 3 }],
      }),
    ).toBeNull()
  })

  // A free-form field (`z.record(z.string(), z.unknown())`) takes any nesting a
  // body can carry. The walk is linear: a copy of the path at every level made
  // this depth take tens of billions of steps, and a recursive walk overflowed.
  it('walks a very deep value in linear time without exhausting the stack', () => {
    const depth = 200_000
    let deep = 'end\u0000'

    for (let index = 0; index < depth; index += 1) deep = [deep]

    const path = findUnstorableCharacter(deep)

    expect(path).toHaveLength(depth)
    expect(path.every((key) => key === 0)).toBe(true)
  }, 5_000)
})

describe('zodValidatorCompiler', () => {
  const schema = z.object({ name: z.string(), notes: z.array(z.string()).optional() })

  it('passes a clean value through as the parsed value', () => {
    const validate = zodValidatorCompiler({ schema, httpPart: 'body' })

    expect(validate({ name: 'Diya', notes: ['one'] })).toEqual({
      value: { name: 'Diya', notes: ['one'] },
    })
  })

  it('refuses a NUL the schema accepted, naming the field', () => {
    const validate = zodValidatorCompiler({ schema, httpPart: 'body' })
    const { error, value } = validate({ name: 'Diya', notes: ['fine', 'bad\u0000'] })

    expect(value).toBeUndefined()
    expect(error).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      issues: [{ path: 'notes[1]', code: 'custom', message: UNSTORABLE_CHARACTER_MESSAGE }],
    })
  })

  it("leaves a schema's own control-character refusal as it was", () => {
    const validate = zodValidatorCompiler({
      schema: z.object({ q: withoutControlCharacters(z.string()) }),
      httpPart: 'querystring',
    })

    expect(validate({ q: 'a\u0000b' }).error.issues).toEqual([
      expect.objectContaining({ path: 'q', message: 'Remove the control character.' }),
    ])
  })
})

describe('the validator on a running app', () => {
  /**
   * An app with the real validator and error handler and one route whose
   * schema refuses no control character anywhere.
   *
   * @returns {Promise<object>} The ready app, and whether the handler ran.
   */
  async function appWithRoute() {
    const app = Fastify({ logger: false })
    const reached = { count: 0 }

    await registerValidation(app)
    await registerErrorHandler(app, { nodeEnv: 'production' })

    app.post(
      '/things/:slug',
      {
        schema: {
          params: z.object({ slug: z.string() }),
          querystring: z.object({ note: z.string().optional() }),
          body: z.object({ content: z.record(z.string(), z.unknown()) }),
        },
      },
      async () => {
        reached.count += 1

        return { ok: true }
      },
    )
    await app.ready()

    return { app, reached }
  }

  it('answers 400 for a NUL in the body, the query or the path, and never runs the handler', async () => {
    const { app, reached } = await appWithRoute()

    const cases = [
      [
        { url: '/things/ok', payload: { content: { faq: [{ answer: 'A\u0000' }] } } },
        'content.faq[0].answer',
      ],
      [{ url: '/things/ok?note=a%00b', payload: { content: {} } }, 'note'],
      [{ url: '/things/o%00k', payload: { content: {} } }, 'slug'],
    ]

    for (const [request, path] of cases) {
      const response = await app.inject({ method: 'POST', ...request })

      expect(response.statusCode, response.body).toBe(400)
      expect(response.json().error).toMatchObject({
        code: 'VALIDATION_ERROR',
        issues: [{ path, message: UNSTORABLE_CHARACTER_MESSAGE }],
      })
      expect(response.body).not.toContain('\\u0000')
    }

    expect(reached.count).toBe(0)

    const clean = await app.inject({
      method: 'POST',
      url: '/things/ok?note=fine',
      payload: { content: { faq: [{ answer: 'Line one\nLine two' }] } },
    })

    expect(clean.statusCode, clean.body).toBe(200)
    expect(reached.count).toBe(1)

    await app.close()
  })
})
