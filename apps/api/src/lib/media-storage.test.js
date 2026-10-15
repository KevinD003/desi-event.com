import { describe, expect, it } from 'vitest'

import { createPrismaStub } from '../../tests/helpers/prisma-stub.js'
import { STRUCTURAL_SCAN_NOTE, createPostgresMediaStorage } from './media-storage.js'

/**
 * A stub holding one asset row for the blob to hang off.
 *
 * @param {string} key The storage key.
 * @returns {object} The stub.
 */
function stubWithAsset(key) {
  return createPrismaStub({
    mediaAsset: [
      {
        id: 'cmedia0000000000000000001',
        ownerType: 'EVENT',
        ownerId: 'cevent000000000000000001',
        eventId: 'cevent000000000000000001',
        kind: 'EVENT_COVER',
        storageKey: key,
        contentType: 'image/png',
        byteSize: 4,
      },
    ],
  })
}

describe('createPostgresMediaStorage', () => {
  it('hands out distinct keys that name the adapter and nothing else', () => {
    const storage = createPostgresMediaStorage(createPrismaStub())
    const keys = new Set(Array.from({ length: 50 }, () => storage.newKey()))

    expect(keys.size).toBe(50)
    for (const key of keys) expect(key).toMatch(/^pg\/[0-9a-f-]{36}$/)
    expect(storage.kind).toBe('postgres')
    expect(Object.isFrozen(storage)).toBe(true)
  })

  it('puts, reads and removes bytes by key inside the caller’s transaction', async () => {
    const key = 'pg/00000000-0000-4000-8000-000000000001'
    const prisma = stubWithAsset(key)
    const storage = createPostgresMediaStorage(prisma)
    const bytes = Buffer.from([1, 2, 3, 4])

    await prisma.$transaction((tx) =>
      storage.put(tx, { key, bytes, checksum: 'a'.repeat(64), byteSize: 4 }),
    )

    expect(prisma._store.mediaBlob).toHaveLength(1)
    expect(prisma._store.mediaBlob[0]).toMatchObject({ storageKey: key, byteSize: 4 })
    // The table's key is the storage key; the row carries no generated id.
    expect(prisma._store.mediaBlob[0]).not.toHaveProperty('id')

    const read = await storage.read(key)

    expect(Buffer.isBuffer(read.bytes)).toBe(true)
    expect(read.bytes.equals(bytes)).toBe(true)

    await prisma.$transaction((tx) => storage.remove(tx, key))

    expect(prisma._store.mediaBlob).toHaveLength(0)
    expect(await storage.read(key)).toBeNull()
  })

  it('answers null for a key that holds nothing', async () => {
    const storage = createPostgresMediaStorage(createPrismaStub())

    expect(await storage.read('pg/missing')).toBeNull()
  })

  it('returns a Buffer even when the driver hands back a plain Uint8Array', async () => {
    const storage = createPostgresMediaStorage({
      mediaBlob: { findUnique: async () => ({ bytes: new Uint8Array([9, 8, 7]) }) },
    })
    const read = await storage.read('pg/x')

    expect(Buffer.isBuffer(read.bytes)).toBe(true)
    expect([...read.bytes]).toEqual([9, 8, 7])
  })

  it('rolls the bytes back with the transaction that wrote them', async () => {
    const key = 'pg/00000000-0000-4000-8000-000000000002'
    const prisma = stubWithAsset(key)
    const storage = createPostgresMediaStorage(prisma)

    await expect(
      prisma.$transaction(async (tx) => {
        await storage.put(tx, {
          key,
          bytes: Buffer.from([1]),
          checksum: 'b'.repeat(64),
          byteSize: 1,
        })
        throw new Error('the asset write failed')
      }),
    ).rejects.toThrow('the asset write failed')

    expect(prisma._store.mediaBlob).toHaveLength(0)
  })

  it('refuses a second blob under the same key', async () => {
    const key = 'pg/00000000-0000-4000-8000-000000000003'
    const prisma = stubWithAsset(key)
    const storage = createPostgresMediaStorage(prisma)
    const blob = { key, bytes: Buffer.from([1]), checksum: 'c'.repeat(64), byteSize: 1 }

    await storage.put(prisma, blob)
    await expect(storage.put(prisma, blob)).rejects.toMatchObject({ code: 'P2002' })
  })

  it('says honestly what the structural check is and is not', () => {
    expect(STRUCTURAL_SCAN_NOTE).toMatch(/^structural-v1:/)
    expect(STRUCTURAL_SCAN_NOTE).toContain('no antivirus engine')
  })
})
