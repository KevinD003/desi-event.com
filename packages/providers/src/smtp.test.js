import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import { SMTPServer } from 'smtp-server'

import { createSmtpEmailProvider } from './smtp.js'
import { assertEmailProvider } from './interfaces.js'
import { PROVIDER_ERROR_CODES, ProviderError } from './errors.js'

/**
 * Decode a quoted-printable body into UTF-8 text.
 *
 * @param {string} body The encoded body.
 * @returns {string} The decoded text.
 */
function decodeQuotedPrintable(body) {
  const joined = body.replace(/=\r?\n/gu, '')
  const bytes = []

  for (let index = 0; index < joined.length; index += 1) {
    const char = joined[index]

    if (char === '=' && /^[0-9A-F]{2}$/iu.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(...Buffer.from(char, 'utf8'))
    }
  }

  return Buffer.from(bytes).toString('utf8')
}

/**
 * Decode RFC 2047 encoded words in a header value.
 *
 * @param {string} value The raw header value.
 * @returns {string} The decoded value.
 */
function decodeWords(value) {
  return value
    .replace(/\?=\s+=\?/gu, '?==?')
    .replace(/=\?utf-8\?([QB])\?([^?]*)\?=/giu, (_match, kind, text) =>
      kind.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : decodeQuotedPrintable(text.replace(/_/gu, ' ')),
    )
}

/**
 * Split a raw RFC 5322 message into decoded headers and a decoded body.
 *
 * @param {string} raw The message as the server received it.
 * @returns {{headers: Record<string, string>, body: string, rawBody: string}} The parts.
 */
function parseMessage(raw) {
  const split = raw.indexOf('\r\n\r\n')
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/gu, ' ')
  const rawBody = raw.slice(split + 4)
  /** @type {Record<string, string>} */
  const headers = {}

  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':')

    headers[line.slice(0, colon).toLowerCase()] = decodeWords(line.slice(colon + 1).trim())
  }

  const encoding = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase()
  const body =
    encoding === 'quoted-printable'
      ? decodeQuotedPrintable(rawBody)
      : encoding === 'base64'
        ? Buffer.from(rawBody.replace(/\s/gu, ''), 'base64').toString('utf8')
        : rawBody

  return { headers, body: body.replace(/\r\n/gu, '\n'), rawBody }
}

/**
 * A local SMTP sink on a free loopback port. Nothing leaves the machine.
 *
 * @param {object} [options] Sink behaviour.
 * @param {boolean} [options.withAuth] Advertise AUTH, and record what the client sends.
 * @param {boolean} [options.rejectRecipients] Refuse every recipient with a 550.
 * @returns {Promise<{port: number, messages: object[], logins: object[], close: function(): Promise<void>}>} The sink.
 */
async function startSink({ withAuth = false, rejectRecipients = false } = {}) {
  const messages = []
  const logins = []

  const server = new SMTPServer({
    secure: false,
    disabledCommands: withAuth ? ['STARTTLS'] : ['STARTTLS', 'AUTH'],
    authOptional: true,
    allowInsecureAuth: withAuth,
    logger: false,
    onAuth(auth, _session, callback) {
      logins.push({ username: auth.username, password: auth.password })
      callback(null, { user: auth.username })
    },
    onRcptTo(address, _session, callback) {
      if (rejectRecipients) {
        const error = new Error('Mailbox unavailable')
        error.responseCode = 550
        callback(error)
        return
      }
      callback()
    },
    onData(stream, session, callback) {
      const chunks = []

      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => {
        messages.push({
          envelope: {
            from: session.envelope.mailFrom?.address,
            to: session.envelope.rcptTo.map((entry) => entry.address),
          },
          raw: Buffer.concat(chunks).toString('utf8'),
        })
        callback()
      })
    },
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    port: server.server.address().port,
    messages,
    logins,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * A loopback port with nothing listening on it.
 *
 * @returns {Promise<number>} The port.
 */
async function closedPort() {
  const probe = createServer()

  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))

  const { port } = probe.address()

  await new Promise((resolve) => probe.close(resolve))

  return port
}

/**
 * A provider pointed at a local sink, with short timeouts.
 *
 * @param {number} port The sink's port.
 * @param {object} [options] Extra options.
 * @returns {object} The provider.
 */
function providerFor(port, options = {}) {
  return createSmtpEmailProvider({
    host: '127.0.0.1',
    port,
    secure: false,
    requireTLS: false,
    from: 'no-reply@desi-event.test',
    connectionTimeoutMs: 2_000,
    greetingTimeoutMs: 2_000,
    socketTimeoutMs: 4_000,
    ...options,
  })
}

const CODE = 'Abc123_-xyzAbc123_-xyzAbc123_-xyzAbc123_-x'

describe('createSmtpEmailProvider against a local sink', () => {
  let sink

  beforeAll(async () => {
    sink = await startSink()
  })

  afterAll(async () => {
    await sink.close()
  })

  afterEach(() => {
    sink.messages.length = 0
    vi.restoreAllMocks()
  })

  it('satisfies the email provider interface', () => {
    const provider = providerFor(sink.port)

    expect(() => assertEmailProvider(provider)).not.toThrow()
    expect(provider.name).toBe('smtp-email')
    expect(provider.from).toBe('no-reply@desi-event.test')
  })

  it('delivers a message with the right sender, recipient, subject and body', async () => {
    const provider = providerFor(sink.port)
    const receipt = await provider.send({
      to: 'Invitee@Example.com',
      subject: 'Your organiser invitation from Desi-Event',
      text: `Hello,\n\nYour invitation code is:\n\n    ${CODE}\n\nThanks.`,
    })

    expect(receipt.status).toBe('SENT')
    expect(receipt.accepted).toEqual(['invitee@example.com'])
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(sink.messages).toHaveLength(1)

    const [message] = sink.messages
    const { headers, body } = parseMessage(message.raw)

    expect(message.envelope).toEqual({
      from: 'no-reply@desi-event.test',
      to: ['invitee@example.com'],
    })
    expect(headers.from).toBe('no-reply@desi-event.test')
    expect(headers.to).toBe('invitee@example.com')
    expect(headers.subject).toBe('Your organiser invitation from Desi-Event')
    expect(headers['content-type']).toMatch(/text\/plain; charset=utf-8/iu)
    expect(body).toContain(`\n    ${CODE}\n`)
    // An ASCII code on its own line survives the encoding verbatim.
    expect(message.raw).toContain(`    ${CODE}\r\n`)
  })

  it('keeps Gujarati and Devanagari text as written (UTF-8, quoted-printable)', async () => {
    const provider = providerFor(sink.port)
    const name = 'કાઠિયાવાડ ફોક નાઇટ્સ'
    const note = 'आपका स्वागत है'

    await provider.send({
      to: 'invitee@example.com',
      subject: `You are invited to join ${name} on Desi-Event`,
      text: `"${name}"\n\n> ${note}\n\n    ${CODE}\n`,
    })

    const { headers, body } = parseMessage(sink.messages[0].raw)

    expect(headers['content-transfer-encoding']).toBe('quoted-printable')
    expect(headers.subject).toBe(`You are invited to join ${name} on Desi-Event`)
    expect(body).toContain(`"${name}"`)
    expect(body).toContain(`> ${note}`)
    expect(body).toContain(`    ${CODE}`)
  })

  it('refuses an unusable recipient before opening any connection', async () => {
    const sendMail = vi.fn()
    const provider = createSmtpEmailProvider({
      host: '127.0.0.1',
      from: 'no-reply@desi-event.test',
      transport: { sendMail },
    })

    await expect(
      provider.send({ to: 'not-an-address', subject: 'x', text: 'y' }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.INVALID_RECIPIENT })
    await expect(
      provider.send({ to: 'a@example.com', subject: ' ', text: 'y' }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
    })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('never writes to the console, because the transcript holds the code', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    const provider = providerFor(sink.port)

    await provider.send({ to: 'invitee@example.com', subject: 'Code', text: `    ${CODE}` })

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('createSmtpEmailProvider with credentials', () => {
  it('signs in with the configured user and password', async () => {
    const sink = await startSink({ withAuth: true })

    try {
      const provider = providerFor(sink.port, {
        auth: { user: 'mailer', pass: 'mailer-password-for-tests' },
      })

      await provider.send({ to: 'invitee@example.com', subject: 'Hello', text: 'Body' })

      expect(sink.logins).toEqual([{ username: 'mailer', password: 'mailer-password-for-tests' }])
      expect(sink.messages).toHaveLength(1)
    } finally {
      await sink.close()
    }
  })
})

describe('createSmtpEmailProvider when the server says no', () => {
  it('turns a refused recipient into SEND_FAILED carrying status and no body', async () => {
    const sink = await startSink({ rejectRecipients: true })

    try {
      const provider = providerFor(sink.port)
      const error = await provider
        .send({ to: 'invitee@example.com', subject: 'Code', text: `    ${CODE}` })
        .catch((caught) => caught)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.code).toBe(PROVIDER_ERROR_CODES.SEND_FAILED)
      expect(error.message).toBe('The mail server did not accept the message')
      expect(error.details.responseCode).toBe(550)
      expect(error.details.command).toBe('RCPT')
      expect(error.cause).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain(CODE)
      expect(JSON.stringify(error.details)).not.toContain('invitee@example.com')
      expect(sink.messages).toHaveLength(0)
    } finally {
      await sink.close()
    }
  })

  it('turns a refused connection into SEND_FAILED within the timeout', async () => {
    const port = await closedPort()
    const provider = providerFor(port)
    const started = Date.now()

    const error = await provider
      .send({ to: 'invitee@example.com', subject: 'Code', text: `    ${CODE}` })
      .catch((caught) => caught)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error.code).toBe(PROVIDER_ERROR_CODES.SEND_FAILED)
    expect(JSON.stringify(error)).not.toContain(CODE)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})

describe('createSmtpEmailProvider options', () => {
  it('refuses a missing host, a bad port and a malformed auth block', () => {
    expect(() => createSmtpEmailProvider({})).toThrow(/needs `host`/u)
    expect(() => createSmtpEmailProvider({ host: 'mail.example', port: 0 })).toThrow(/port/u)
    expect(() => createSmtpEmailProvider({ host: 'mail.example', auth: { user: 'x' } })).toThrow(
      /auth/u,
    )
    expect(() => createSmtpEmailProvider(null)).toThrow(ProviderError)
  })

  it('refuses a sender that is not an address', () => {
    expect(() => createSmtpEmailProvider({ host: 'mail.example', from: 'nope' })).toThrow(
      /valid email address/u,
    )
  })

  it('hands the message to the transport as UTF-8 quoted-printable', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<id@test>', accepted: ['a@example.com'] }))
    const provider = createSmtpEmailProvider({
      host: '127.0.0.1',
      from: 'no-reply@desi-event.test',
      transport: { sendMail },
    })

    const receipt = await provider.send({ to: 'a@example.com', subject: 'S', text: 'T' })

    expect(receipt).toMatchObject({ id: '<id@test>', providerRef: '<id@test>', status: 'SENT' })
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@desi-event.test',
        to: ['a@example.com'],
        subject: 'S',
        text: 'T',
        textEncoding: 'quoted-printable',
      }),
    )
  })
})
