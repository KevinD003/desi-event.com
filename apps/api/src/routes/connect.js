/**
 * The two routes for the simulated connected-account lifecycle.
 *
 * Both are thin. Everything that decides anything lives in `../lib/connect.js`,
 * for the reason the privacy routes keep their decisions in a library: a rule
 * written in a handler is a rule the next handler copies slightly differently.
 *
 * What the handlers themselves are responsible for is the boundary. The
 * mock-mode guard runs first and runs in both, because a surface that only
 * simulates must not be reachable in a deployment wired to anything else — and
 * that guard needs `app.payments` and the provider registry, which is why it is
 * here rather than in the library.
 *
 * Neither route contacts a payment provider. There is no SDK import, no URL, no
 * credential read and no network call in this file or anything it imports, and
 * `payment-kill-switch.test.js` holds that as a repository-wide property rather
 * than a promise made here.
 *
 * @module @desi-event/api/routes/connect
 */

import { CONNECT_ACTIONS } from '@desi-event/schemas'

import {
  advanceMockConnect,
  assertMockConnectAvailable,
  findConnectedAccount,
  loadOrganizationForConnect,
  startMockConnect,
  toConnectStatus,
} from '../lib/connect.js'
import { defineRoute } from '../lib/register.js'

/**
 * Register the simulated connected-account routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @returns {void} Nothing.
 */
export function registerConnectRoutes(app, { prisma, providers }) {
  /**
   * Both halves of the mode check, on every request.
   *
   * `app.payments` is the boot gate's resolution and is authoritative. The
   * provider name is the second lock: it is what stops this surface simulating
   * after a real adapter is wired into the registry, which is the next step in
   * the sequence this phase belongs to.
   *
   * @returns {void} Nothing.
   */
  function assertMockMode() {
    assertMockConnectAvailable({ payments: app.payments, providers })
  }

  defineRoute(app, 'connect.status', {
    handler: async (request) => {
      assertMockMode()

      const organizationId = request.params.id

      // The organisation is resolved before the account is read, so an id naming
      // nothing gets a 404 rather than a cheerful NOT_STARTED for an
      // organisation that does not exist.
      await loadOrganizationForConnect(prisma, organizationId)

      // No row is not an error. "Nothing has been simulated yet" is the answer,
      // and NOT_STARTED is the state that says it.
      const account = await findConnectedAccount(prisma, organizationId)

      return { data: toConnectStatus(account) }
    },
  })

  defineRoute(app, 'connect.start', {
    handler: async (request) => {
      assertMockMode()

      const organizationId = request.params.id
      const { action } = request.body

      await loadOrganizationForConnect(prisma, organizationId)

      const outcome =
        action === CONNECT_ACTIONS.START
          ? await startMockConnect(prisma, {
              organizationId,
              actor: request.actor,
              requestId: request.id,
              now: new Date(),
            })
          : await advanceMockConnect(prisma, {
              organizationId,
              action,
              actor: request.actor,
              requestId: request.id,
              now: new Date(),
            })

      return { data: toConnectStatus(outcome.account) }
    },
  })
}
