/**
 * Unit tests for the pure viewport derivation and rendering: the view bbox from
 * a camera pose and its model-facing text.
 */

import { describe, expect, it } from 'vitest'
import { deriveViewBBox, renderViewContext } from '../src/viewport.ts'

describe('deriveViewBBox', () => {
  it('centers the box on the camera and stays within WGS84 ranges', () => {
    const [west, south, east, north] = deriveViewBBox({ lat: 40, lon: -74, height: 15_000 })
    expect(west).toBeGreaterThanOrEqual(-180)
    expect(east).toBeLessThanOrEqual(180)
    expect(south).toBeGreaterThanOrEqual(-90)
    expect(north).toBeLessThanOrEqual(90)
    // The box brackets the camera target.
    expect(west).toBeLessThan(-74)
    expect(east).toBeGreaterThan(-74)
    expect(south).toBeLessThan(40)
    expect(north).toBeGreaterThan(40)
  })

  it('widens the longitude span toward the poles (cos-lat correction)', () => {
    const low = deriveViewBBox({ lat: 0, lon: 0, height: 100_000 })
    const high = deriveViewBBox({ lat: 60, lon: 0, height: 100_000 })
    const lowLonSpan = low[2] - low[0]
    const highLonSpan = high[2] - high[0]
    expect(highLonSpan).toBeGreaterThan(lowLonSpan)
  })

  it('clamps a very high camera to a whole-globe box', () => {
    const [west, south, east, north] = deriveViewBBox({ lat: 0, lon: 0, height: 5e10 })
    expect([west, south, east, north]).toEqual([-180, -90, 180, 90])
  })

  it('treats a pole camera longitude span as the full range', () => {
    const [west, , east] = deriveViewBBox({ lat: 90, lon: 0, height: 100_000 })
    expect(west).toBe(-180)
    expect(east).toBe(180)
  })
})

describe('renderViewContext', () => {
  it('states the camera target, height, and viewport bounds', () => {
    const text = renderViewContext({ lat: 40.71273, lon: -74.00602, height: 15_000 })
    expect(text).toContain('latitude 40.71273')
    expect(text).toContain('longitude -74.00602')
    expect(text).toContain('camera height 15000 m')
    expect(text).toContain('west, south, east, north')
    expect(text).toContain('bbox for domain-layer queries')
  })
})
