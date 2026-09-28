/**
 * What the image optimiser may fetch.
 *
 * The optimiser fetches whatever `src` it is handed and caches the answer, so
 * its allow-list is a security boundary: a remote host would make it a proxy
 * for anybody's pictures, and SVG would make it serve markup from this origin.
 *
 * @module lib/next-config.test
 */

import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config.mjs'

describe('next.config images', () => {
  it('lets the optimiser fetch event pictures through the API proxy, and nothing else', () => {
    expect(nextConfig.images.localPatterns).toEqual([{ pathname: '/api/v1/media/**', search: '' }])
  })

  it('allows no remote host at all', () => {
    expect(nextConfig.images.remotePatterns).toEqual([])
    expect(nextConfig.images).not.toHaveProperty('domains')
  })

  it('never serves SVG', () => {
    expect(nextConfig.images.dangerouslyAllowSVG).toBe(false)
  })

  it('offers modern formats', () => {
    expect(nextConfig.images.formats).toEqual(['image/avif', 'image/webp'])
  })
})
