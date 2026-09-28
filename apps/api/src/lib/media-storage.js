/**
 * Where picture bytes live.
 *
 * Behind one small interface so the rest of the API never learns the answer.
 * Today it is a PostgreSQL table, `MediaBlob`, one row per asset, keyed by the
 * asset's storage key and deleted with it by a cascade:
 *
 *   - it works in CI, on one instance and on many, with no disk to share;
 *   - the bytes commit in the same transaction as the row that names them, so
 *     there is never an asset without bytes or bytes without an asset;
 *   - the bytes are in their own table rather than a column, so the ordinary
 *     "every scalar" read of `MediaAsset` — which event lists make — never
 *     drags megabytes along.
 *
 * Moving to an object store later means an adapter whose `put` runs before the
 * transaction, a compensating `remove` when the transaction fails, and a sweep
 * for orphans. See ADR 0006.
 *
 * The storage key is `pg/` plus a random UUID. It is never sent to a client and
 * never logged; the only name a client ever sees is the asset id.
 *
 * @module @desi-event/api/lib/media-storage
 */

import { randomUUID } from 'node:crypto'

/**
 * What the stored `scanNote` says, honestly: the file was parsed and rebuilt
 * from allow-listed parts, and no antivirus engine looked at it.
 *
 * @type {string}
 */
export const STRUCTURAL_SCAN_NOTE =
  'structural-v1: parsed, rebuilt from allow-listed segments, metadata removed; no antivirus engine'

/**
 * @typedef {object} MediaStorage
 * @property {string} kind A name for logs and health output, e.g. `postgres`.
 * @property {function(): string} newKey A fresh storage key.
 * @property {function(object, {key: string, bytes: Buffer, checksum: string, byteSize: number}): Promise<void>} put Store bytes inside the caller's transaction.
 * @property {function(string): Promise<{bytes: Buffer}|null>} read The bytes under a key, or null.
 * @property {function(object, string): Promise<void>} remove Delete the bytes under a key inside the caller's transaction.
 */

/**
 * The PostgreSQL adapter.
 *
 * @param {object} prisma The Prisma client, for reads outside a transaction.
 * @returns {MediaStorage} The adapter.
 */
export function createPostgresMediaStorage(prisma) {
  return Object.freeze({
    kind: 'postgres',

    newKey() {
      return `pg/${randomUUID()}`
    },

    /**
     * @param {object} tx The transaction client.
     * @param {{key: string, bytes: Buffer, checksum: string, byteSize: number}} blob What to store.
     * @returns {Promise<void>} Resolves once written.
     */
    async put(tx, { key, bytes, checksum, byteSize }) {
      await tx.mediaBlob.create({
        data: { storageKey: key, bytes, checksum, byteSize },
        select: { storageKey: true },
      })
    },

    /**
     * @param {string} key The storage key.
     * @returns {Promise<{bytes: Buffer}|null>} The bytes, or null when there are none.
     */
    async read(key) {
      const row = await prisma.mediaBlob.findUnique({
        where: { storageKey: key },
        select: { bytes: true },
      })

      if (!row) return null

      const { bytes } = row

      return { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) }
    },

    /**
     * @param {object} tx The transaction client.
     * @param {string} key The storage key.
     * @returns {Promise<void>} Resolves once deleted.
     */
    async remove(tx, key) {
      await tx.mediaBlob.deleteMany({ where: { storageKey: key } })
    },
  })
}
