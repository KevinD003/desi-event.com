/**
 * Server-side reads for the import pages (SPEC2-XI I-H).
 *
 * Built on `callApi` from `./organizer-api.js`, and like the other workspace
 * reads, **nothing here falls back**: a plan that was not the real plan would
 * invite an administrator to apply fiction. Every helper throws what
 * `callApi` threw (`status`, `code` and `retryAfterSeconds` intact), and the
 * page draws the refusal.
 *
 * These answers name the listing site's own addresses (its listing pages and
 * pictures), which no public payload carries; they are `no-store` at the API
 * and never cached here. Nothing that imports this module may reach a browser:
 * `callApi` reads the request's cookies.
 *
 * @module lib/imports-api
 */

import { callApi } from './organizer-api.js'

/** How many runs the list page asks for. */
export const RUN_PAGE_SIZE = 20

/**
 * A page of import runs, newest first.
 *
 * @param {object} [options] Which page.
 * @param {number} [options.page] The page, from 1.
 * @returns {Promise<{runs: object[], pagination: object|null}>} The runs.
 */
export async function getImportRuns({ page = 1 } = {}) {
  const query = new URLSearchParams({ page: String(page), perPage: String(RUN_PAGE_SIZE) })
  const body = await callApi(`/v1/platform/imports?${query.toString()}`)

  return { runs: body.data ?? [], pagination: body.pagination ?? null }
}

/**
 * One run: its plan row by row, and what each row's event is now.
 *
 * @param {string} runId The run.
 * @returns {Promise<{run: object, picturesWaiting: number}>} The run, and how many pictures still wait.
 */
export async function getImportRun(runId) {
  const body = await callApi(`/v1/platform/imports/${encodeURIComponent(runId)}`)

  return {
    run: body.data,
    picturesWaiting: Number.isInteger(body.meta?.picturesWaiting) ? body.meta.picturesWaiting : 0,
  }
}
