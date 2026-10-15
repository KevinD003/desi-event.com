/**
 * An event's published contact address, in a subject's redaction.
 *
 * The address an organiser prints on the event page is public, so when it is
 * the subject's own it is personal data about them on a public page: counted in
 * the preview and replaced by the redaction, exactly like the private contact
 * columns. Somebody else's address is left alone.
 *
 * @module @desi-event/api/tests/privacy-public-contact
 */

import { describe, expect, it } from 'vitest'

import { countContactAddresses, redactContactAddresses } from '../src/lib/privacy-redaction.js'
import { isRedactedValue } from '../src/lib/privacy-placeholders.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const ORG = 'ckv9w1p0a0000qz0l7h2korg1'

/**
 * A stub with three events of one organisation and one of another.
 *
 * @returns {object} The stub.
 */
function world() {
  return createPrismaStub({
    organization: [{ id: ORG, contactEmail: 'hello@org.example' }],
    event: [
      {
        id: 'mine',
        organizationId: ORG,
        contactEmail: null,
        publicContactEmail: 'Priya@Example.com',
      },
      {
        id: 'both',
        organizationId: ORG,
        contactEmail: 'priya@example.com',
        publicContactEmail: 'PRIYA@example.com',
      },
      {
        id: 'theirs',
        organizationId: ORG,
        contactEmail: null,
        publicContactEmail: 'box@venue.example',
      },
      {
        id: 'elsewhere',
        organizationId: 'another-org',
        contactEmail: null,
        publicContactEmail: 'priya@example.com',
      },
    ],
  })
}

describe('an event’s published contact in a redaction', () => {
  it('is counted when it is the subject’s own, whatever its case', async () => {
    const prisma = world()

    expect(
      await countContactAddresses(prisma, {
        organizationId: ORG,
        subjectEmail: 'priya@example.com',
      }),
    ).toBe(3)
  })

  it('is replaced when it is the subject’s own, and nothing else is touched', async () => {
    const prisma = world()
    const byId = (id) => prisma._store.event.find((row) => row.id === id)

    const result = await redactContactAddresses(prisma, {
      organizationId: ORG,
      subjectEmail: 'priya@example.com',
    })

    expect(result.count).toBe(3)
    expect(isRedactedValue(byId('mine').publicContactEmail)).toBe(true)
    expect(isRedactedValue(byId('both').publicContactEmail)).toBe(true)
    expect(isRedactedValue(byId('both').contactEmail)).toBe(true)
    expect(byId('theirs').publicContactEmail).toBe('box@venue.example')
    expect(byId('elsewhere').publicContactEmail).toBe('priya@example.com')
    expect(prisma._store.organization[0].contactEmail).toBe('hello@org.example')
  })

  it('counts nothing without an address to match', async () => {
    expect(await countContactAddresses(world(), { organizationId: ORG, subjectEmail: null })).toBe(
      0,
    )
  })
})
