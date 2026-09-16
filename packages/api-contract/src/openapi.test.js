import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ApiContractError } from './errors.js'
import {
  BEARER_SCHEME_NAME,
  OPENAPI_VERSION,
  SESSION_SCHEME_NAME,
  buildOpenApiDocument,
  buildOperation,
  documentedErrorStatuses,
  hoistDefinitions,
  toJsonSchema,
} from './openapi.js'
import { toOpenApiPath } from './path.js'
import { API_ERRORS, apiRoutes, routeById } from './routes.js'

const document = buildOpenApiDocument()

describe('toJsonSchema', () => {
  it('strips the $schema dialect key so the fragment can be embedded', () => {
    const fragment = toJsonSchema(z.object({ a: z.string() }))
    expect(fragment).not.toHaveProperty('$schema')
    expect(fragment.type).toBe('object')
  })

  it('renders a preprocessed primitive as its inner schema', () => {
    const fragment = toJsonSchema(
      z.preprocess((v) => String(v).trim(), z.string().min(2)),
      'input',
    )
    expect(fragment).toMatchObject({ type: 'string', minLength: 2 })
  })

  it('emits nullable as a 2020-12 type union, not the OpenAPI 3.0 nullable flag', () => {
    const fragment = toJsonSchema(z.object({ a: z.string().nullable() }), 'output')
    expect(fragment.properties.a.type).toEqual(['string', 'null'])
    expect(fragment.properties.a).not.toHaveProperty('nullable')
  })

  it('degrades an unrepresentable construct instead of throwing', () => {
    expect(() => toJsonSchema(z.object({ when: z.date() }), 'output')).not.toThrow()
  })

  it('distinguishes input from output where defaults apply', () => {
    const schema = z.object({ page: z.number().default(1) })
    expect(toJsonSchema(schema, 'input').required ?? []).not.toContain('page')
    expect(toJsonSchema(schema, 'output').required).toContain('page')
  })
})

describe('hoistDefinitions', () => {
  it('lifts $defs into the component bag and repoints the refs', () => {
    const inner = z.object({ a: z.string() }).meta({ id: 'Inner' })
    const fragment = toJsonSchema(z.object({ x: inner, y: inner }), 'output')

    expect(fragment.$defs).toBeDefined()
    expect(fragment.properties.x.$ref).toBe('#/$defs/Inner')

    const components = {}
    const hoisted = hoistDefinitions(fragment, 'demo.route', components)

    expect(hoisted).not.toHaveProperty('$defs')
    expect(hoisted.properties.x.$ref).toBe('#/components/schemas/demo.route.Inner')
    expect(hoisted.properties.y.$ref).toBe('#/components/schemas/demo.route.Inner')
    expect(components['demo.route.Inner']).toMatchObject({ type: 'object' })
  })

  it('passes a fragment without $defs through untouched', () => {
    const components = {}
    expect(hoistDefinitions({ type: 'string' }, 'x', components)).toEqual({ type: 'string' })
    expect(components).toEqual({})
  })

  it('rewrites refs nested inside arrays', () => {
    const inner = z.object({ a: z.string() }).meta({ id: 'Item' })
    const fragment = toJsonSchema(z.object({ list: z.array(inner), other: inner }), 'output')
    const components = {}
    const hoisted = hoistDefinitions(fragment, 'demo', components)

    expect(hoisted.properties.list.items.$ref).toBe('#/components/schemas/demo.Item')
  })

  it('sanitises a prefix that is not component-name safe', () => {
    const inner = z.object({ a: z.string() }).meta({ id: 'Inner' })
    const fragment = toJsonSchema(z.object({ x: inner, y: inner }), 'output')
    const components = {}

    hoistDefinitions(fragment, 'weird/prefix id', components)

    expect(Object.keys(components)).toEqual(['weird_prefix_id.Inner'])
  })
})

describe('buildOpenApiDocument', () => {
  it('declares OpenAPI 3.1', () => {
    expect(document.openapi).toBe(OPENAPI_VERSION)
    expect(document.openapi).toBe('3.1.0')
  })

  it('carries info, servers and tags', () => {
    expect(document.info).toMatchObject({ title: 'Desi-Event API', version: '1.0.0' })
    expect(document.info.description).toEqual(expect.any(String))
    expect(document.servers.length).toBeGreaterThan(0)
    expect(document.tags.map((tag) => tag.name)).toContain('events')
  })

  it('honours caller-supplied metadata', () => {
    const custom = buildOpenApiDocument({
      title: 'Staging',
      version: '9.9.9',
      servers: [{ url: 'https://staging.desi-event.com' }],
    })

    expect(custom.info.title).toBe('Staging')
    expect(custom.info.version).toBe('9.9.9')
    expect(custom.servers).toEqual([{ url: 'https://staging.desi-event.com' }])
  })

  it('defines a bearer JWT security scheme', () => {
    expect(document.components.securitySchemes[BEARER_SCHEME_NAME]).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    // No `bearerFormat`: the token is opaque, not a JWT. Advertising a format
    // would invite a client to decode it, and there is nothing inside.
    expect(document.components.securitySchemes[BEARER_SCHEME_NAME]).not.toHaveProperty(
      'bearerFormat',
    )
  })

  it('emits one operation per route, keyed by the OpenAPI path form', () => {
    const operations = Object.values(document.paths).flatMap((item) => Object.values(item))
    expect(operations).toHaveLength(apiRoutes.length)

    const ids = operations.map((operation) => operation.operationId).sort()
    expect(ids).toEqual(apiRoutes.map((route) => route.id).sort())
  })

  it('collapses two routes that share a path into one path item', () => {
    expect(Object.keys(document.paths['/v1/events']).sort()).toEqual(['get', 'post'])
    expect(Object.keys(document.paths['/v1/orders']).sort()).toEqual(['get', 'post'])
  })

  it('templates path parameters and documents each one as required', () => {
    const operation = document.paths['/v1/events/{eventId}/ticket-types'].get
    const params = operation.parameters.filter((parameter) => parameter.in === 'path')

    expect(params).toHaveLength(1)
    expect(params[0]).toMatchObject({ name: 'eventId', in: 'path', required: true })
    expect(params[0].schema.type).toBe('string')
  })

  it('documents every query field of the event listing', () => {
    const names = document.paths['/v1/events'].get.parameters
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => parameter.name)

    expect(names).toEqual(
      expect.arrayContaining(['page', 'perPage', 'category', 'status', 'city', 'q', 'sort']),
    )
  })

  it('omits the parameters array entirely for a route that has none', () => {
    expect(document.paths['/v1/auth/login'].post).not.toHaveProperty('parameters')
  })

  it('marks the request body required and renders it as JSON', () => {
    const body = document.paths['/v1/auth/register'].post.requestBody

    expect(body.required).toBe(true)
    expect(body.content['application/json'].schema.type).toBe('object')
    expect(body.content['application/json'].schema.properties).toHaveProperty('email')
  })

  it('gives no request body to a GET', () => {
    expect(document.paths['/health'].get).not.toHaveProperty('requestBody')
  })

  it('documents the success status the route declares, not a blanket 200', () => {
    expect(Object.keys(document.paths['/v1/auth/register'].post.responses)).toContain('201')
    expect(Object.keys(document.paths['/v1/auth/login'].post.responses)).toContain('200')
    expect(Object.keys(document.paths['/v1/auth/register'].post.responses)).not.toContain('200')
  })

  it('documents every declared error status against the shared envelope', () => {
    for (const route of apiRoutes) {
      const path = document.paths[route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')]
      const operation = path[route.method.toLowerCase()]

      for (const error of route.errors) {
        const response = operation.responses[String(error.status)]
        expect(response, `${route.id} ${error.status}`).toBeDefined()
        expect(response.content['application/json'].schema.$ref).toBe(
          '#/components/schemas/ErrorResponse',
        )
      }
    }
  })

  it('gives every response a description', () => {
    for (const item of Object.values(document.paths)) {
      for (const operation of Object.values(item)) {
        for (const response of Object.values(operation.responses)) {
          expect(response.description).toEqual(expect.any(String))
          expect(response.description.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('offers both ways of presenting a session on a protected route', () => {
    // Two alternatives, not two requirements: a browser sends the cookie and a
    // script sends the header, and they carry the same secret.
    expect(document.paths['/v1/auth/me'].get.security).toEqual([
      { [SESSION_SCHEME_NAME]: [] },
      { [BEARER_SCHEME_NAME]: [] },
    ])
    expect(document.paths['/health'].get).not.toHaveProperty('security')
  })

  it('lets an optional-auth route be called with or without credentials', () => {
    expect(document.paths['/v1/events'].get.security).toEqual([
      {},
      { [SESSION_SCHEME_NAME]: [] },
      { [BEARER_SCHEME_NAME]: [] },
    ])
  })

  it('describes the session cookie, and what a state-changing request must add', () => {
    const scheme = document.components.securitySchemes[SESSION_SCHEME_NAME]

    expect(scheme).toMatchObject({ type: 'apiKey', in: 'cookie' })
    expect(scheme.description).toContain('x-desi-csrf')
  })

  it('names the capability a route requires, where it requires one', () => {
    for (const route of apiRoutes.filter((candidate) => candidate.capability)) {
      const path = toOpenApiPath(route.path)
      const operation = document.paths[path][route.method.toLowerCase()]

      expect(operation.description, route.id).toContain(route.capability)
    }
  })

  it('says when a route needs a step-up', () => {
    for (const route of apiRoutes.filter((candidate) => candidate.stepUp)) {
      const path = toOpenApiPath(route.path)
      const operation = document.paths[path][route.method.toLowerCase()]

      expect(operation.description, route.id).toContain('step-up')
    }
  })

  it('resolves the ErrorResponse component it references', () => {
    expect(document.components.schemas.ErrorResponse).toMatchObject({ type: 'object' })
    expect(document.components.schemas.ErrorResponse.properties.error).toBeDefined()
  })

  it('leaves no dangling or local $defs references anywhere', () => {
    const refs = []
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref') refs.push(value)
        else walk(value)
      }
    }

    walk(document)

    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/'), ref).toBe(true)
      expect(
        document.components.schemas[ref.slice('#/components/schemas/'.length)],
        ref,
      ).toBeDefined()
    }
  })

  it('survives a JSON round trip, proving there are no functions or cycles', () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
  })

  it('rejects two routes claiming the same method and path', () => {
    const route = routeById('events.list')
    const clash = { ...route, id: 'events.clash' }

    expect(() => buildOpenApiDocument({ routes: [route, clash] })).toThrow(ApiContractError)
    expect(() => buildOpenApiDocument({ routes: [route, clash] })).toThrow(/Duplicate operation/)
  })

  it('reports an unrenderable response schema as a contract error', () => {
    // A descriptor whose `response` is a plain object rather than a Zod schema
    // is the realistic version of this: Zod throws deep inside and the failure
    // must surface as a contract problem, not an unrelated TypeError.
    const broken = { ...routeById('health.get'), response: {} }

    expect(() => buildOpenApiDocument({ routes: [broken] })).toThrow(ApiContractError)

    try {
      buildOpenApiDocument({ routes: [broken] })
    } catch (error) {
      expect(error.code).toBe('SCHEMA_NOT_REPRESENTABLE')
      expect(error.cause).toBeInstanceOf(Error)
    }
  })

  it('hoists the defs a self-referencing schema produces instead of leaving a local ref', () => {
    /** @type {ZodType} */
    const node = z.object({
      name: z.string(),
      get child() {
        return node.optional()
      },
    })

    const route = { ...routeById('health.get'), response: z.object({ data: node }) }
    const custom = buildOpenApiDocument({ routes: [route] })
    const schema = custom.paths['/health'].get.responses['200'].content['application/json'].schema

    expect(JSON.stringify(custom)).not.toContain('#/$defs/')
    expect(schema).not.toHaveProperty('$defs')
    expect(Object.keys(custom.components.schemas).length).toBeGreaterThan(1)
  })
})

describe('buildOperation', () => {
  it('falls back to a string path parameter when the schema omits it', () => {
    const route = { ...routeById('events.get'), params: z.object({}) }
    const operation = buildOperation(route, {})
    const param = operation.parameters.find((candidate) => candidate.name === 'slug')

    expect(param).toMatchObject({ in: 'path', required: true, schema: { type: 'string' } })
  })

  it('keeps a single response when a route documents a status twice', () => {
    const route = {
      ...routeById('health.get'),
      errors: [API_ERRORS.unavailable, { ...API_ERRORS.unavailable, description: 'Second' }],
    }

    const operation = buildOperation(route, {})
    expect(operation.responses['503'].description).toBe(API_ERRORS.unavailable.description)
  })
})

describe('documentedErrorStatuses', () => {
  it('lists the catalogue statuses once each, in ascending order', () => {
    const statuses = documentedErrorStatuses()

    expect(statuses).toEqual([...statuses].sort((a, b) => a - b))
    expect(new Set(statuses).size).toBe(statuses.length)
    expect(statuses).toEqual(expect.arrayContaining([400, 401, 403, 404, 409, 422, 503]))
  })
})
