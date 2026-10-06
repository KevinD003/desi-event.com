/**
 * Run as a child process by `security-regression.test.js`, with every proxy
 * variable Node and the usual tools read pointing at a listener the test
 * holds, and `NODE_USE_ENV_PROXY=1`, which makes Node 22 send its global agent
 * through that proxy.
 *
 * It does two things and prints what happened as one line of JSON:
 *
 * - **The control.** A request through `https.globalAgent` to a name the test
 *   chose, which the environment sends to the proxy as a `CONNECT`. Without it
 *   the check below could pass on a Node that ignores the variables.
 * - **The fetcher.** `fetchImportImage` for a picture on the one allowed host,
 *   resolved to a public address. The request function it is given changes
 *   only where the socket lands (a local listener standing in for the picture
 *   host) and leaves the fetcher's own agent, headers and options as they are,
 *   so a proxy setting the fetcher honoured would show as a `CONNECT` naming
 *   the picture host at the proxy, and a direct connection as a socket at the
 *   stand-in.
 *
 * Nothing here reaches the network: both connections are to 127.0.0.1.
 *
 * @module @desi-event/api/tests/helpers/proxy-env-probe
 */

import https from 'node:https'
import net from 'node:net'

import { fetchImportImage, pinnedLookup } from '../../src/lib/import-images.js'

/** The name the control asks the global agent for. */
const CONTROL_HOST = process.argv[2]

/**
 * Listen on 127.0.0.1 and count the sockets that arrive, dropping each.
 *
 * @returns {Promise<{server: object, port: number, connections: Function}>} The listener.
 */
async function standIn() {
  let connections = 0
  const server = net.createServer((socket) => {
    connections += 1
    socket.on('error', () => {})
    socket.destroy()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return { server, port: server.address().port, connections: () => connections }
}

/**
 * The control: one request through the global agent, settled however it ends.
 *
 * @returns {Promise<string>} The error code it ended with, or `RESPONSE`.
 */
function throughGlobalAgent() {
  return new Promise((settle) => {
    const request = https.request({ hostname: CONTROL_HOST, port: 443, path: '/', method: 'GET' })

    request.on('response', (response) => {
      response.resume()
      settle('RESPONSE')
    })
    request.on('error', (error) => settle(String(error?.code ?? 'ERROR')))
    request.setTimeout(5000, () => {
      request.destroy()
      settle('TIMEOUT')
    })
    request.end()
  })
}

const host = await standIn()
const control = await throughGlobalAgent()
const fetched = await fetchImportImage('https://usimg.sulekha.io/cdn/events/images/probe.png', {
  source: 'network',
  // A public address, so the fetcher goes on to connect.
  resolve: (_name, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]),
  request: (options, onResponse) =>
    https.request(
      { ...options, port: host.port, lookup: pinnedLookup('127.0.0.1', 4) },
      onResponse,
    ),
  timeoutMs: 5000,
})

host.server.close()

process.stdout.write(
  `${JSON.stringify({ control, fetched: fetched.ok ? 'OK' : fetched.code, direct: host.connections() })}\n`,
)
