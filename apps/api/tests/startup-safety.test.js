/**
 * Startup refuses before it can accept traffic, and never prints a secret.
 *
 * These spawn the real entry point rather than calling a function. "Validation
 * happens before `listen`" is a claim about the order of operations in a
 * process, and the only way to be sure is to start one and try to connect.
 */

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(appDir, 'src', 'server.js')

/** A port this suite owns, away from anything a developer runs locally. */
const PORT = 4387

/** The exact placeholder shipped in .env.example. */
const PLACEHOLDER_SECRET = 'dev-only-insecure-secret-change-me-before-any-deploy'

/**
 * Is anything accepting connections on the port?
 *
 * @param {number} port The port.
 * @returns {Promise<boolean>} True when a connection is accepted.
 */
function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Start the server and wait for it to exit, or for a listener to appear.
 *
 * @param {Record<string, string>} env Environment overrides.
 * @returns {Promise<{code: number|null, output: string, everListened: boolean}>} What happened.
 */
async function startServer(env) {
  const child = spawn(process.execPath, [entry], {
    cwd: appDir,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      API_PORT: String(PORT),
      API_HOST: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })

  let everListened = false
  const poller = setInterval(async () => {
    if (await portIsOpen(PORT)) everListened = true
  }, 50)

  const code = await new Promise((resolve) => {
    const guard = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, 8_000)

    child.once('exit', (exitCode) => {
      clearTimeout(guard)
      resolve(exitCode)
    })
  })

  clearInterval(poller)
  // One final check, in case it bound and exited between polls.
  if (await portIsOpen(PORT)) everListened = true

  return { code, output, everListened }
}

const VALID_BASE = {
  DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public',
  REDIS_URL: 'redis://127.0.0.1:6379',
}

describe('startup fails before the port is bound', () => {
  it('refuses the placeholder secret and never listens', async () => {
    const result = await startServer({ ...VALID_BASE, JWT_SECRET: PLACEHOLDER_SECRET })

    expect(result.code).not.toBe(0)
    // The important half: it did not accept a single connection first.
    expect(result.everListened).toBe(false)
  }, 30_000)

  it('refuses a missing secret and never listens', async () => {
    const result = await startServer({ ...VALID_BASE })

    expect(result.code).not.toBe(0)
    expect(result.everListened).toBe(false)
  }, 30_000)

  it('refuses a short secret and never listens', async () => {
    const result = await startServer({ ...VALID_BASE, JWT_SECRET: 'tooshort' })

    expect(result.code).not.toBe(0)
    expect(result.everListened).toBe(false)
  }, 30_000)

  it('refuses a malformed database URL and never listens', async () => {
    const result = await startServer({
      ...VALID_BASE,
      DATABASE_URL: 'mysql://nope/nope',
      JWT_SECRET: 'a-genuinely-random-secret-value-of-length',
    })

    expect(result.code).not.toBe(0)
    expect(result.everListened).toBe(false)
  }, 30_000)
})

describe('failure output never contains a secret', () => {
  it('names the variable without printing its value', async () => {
    const secret = 'short-but-memorable-canary-value-abcdef'
    const result = await startServer({ ...VALID_BASE, JWT_SECRET: secret.slice(0, 10) })

    expect(result.code).not.toBe(0)
    // It must say which variable is wrong...
    expect(result.output).toContain('JWT_SECRET')
    // ...without echoing what was supplied.
    expect(result.output).not.toContain(secret.slice(0, 10))
  }, 30_000)

  it('does not echo the placeholder secret back when rejecting it', async () => {
    const result = await startServer({ ...VALID_BASE, JWT_SECRET: PLACEHOLDER_SECRET })

    expect(result.output).not.toContain(PLACEHOLDER_SECRET)
  }, 30_000)

  it('does not print the database password', async () => {
    const result = await startServer({
      ...VALID_BASE,
      DATABASE_URL: 'postgresql://desi:hunter2-canary@127.0.0.1:5432/x',
      JWT_SECRET: 'tooshort',
    })

    expect(result.code).not.toBe(0)
    expect(result.output).not.toContain('hunter2-canary')
  }, 30_000)
})
