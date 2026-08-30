/**
 * Pure geodesic metrics: polygon spherical area, vertex-average centroid, and
 * the compact area/location formatters. Every branch of each helper is covered:
 * degenerate rings, point/line/polygon centroids, the empty-vertex null case,
 * and the formatter's em-dash, m², km², and non-finite arms.
 */
import { describe, expect, it } from 'vitest'
import type { GeoDrawnGeometry } from '@deepseek-ai/dsh-geo-command/client'
import { centroidOf, formatArea, formatLocation, polygonAreaM2 } from '../src/client/geoMetrics.ts'

describe('polygonAreaM2', () => {
  it('returns 0 for fewer than three vertices', () => {
    expect(polygonAreaM2([])).toBe(0)
    expect(polygonAreaM2([[0, 0]])).toBe(0)
    expect(polygonAreaM2([[0, 0], [1, 1]])).toBe(0)
  })

  it('returns a plausible positive area for a small equatorial box', () => {
    const small = polygonAreaM2([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]])
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(2e6)
  })

  it('is winding-independent and grows with the box (absolute value)', () => {
    const cw = polygonAreaM2([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]])
    const ccw = polygonAreaM2([[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0]])
    expect(cw).toBeCloseTo(ccw, 3)
    const bigger = polygonAreaM2([[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]])
    expect(bigger).toBeGreaterThan(cw)
  })
})

describe('centroidOf', () => {
  it('returns a point coordinate directly', () => {
    const geom: GeoDrawnGeometry = { type: 'point', coordinates: [139.65, 35.68] }
    expect(centroidOf(geom)).toEqual([139.65, 35.68])
  })

  it('averages polyline vertices', () => {
    const geom: GeoDrawnGeometry = { type: 'polyline', coordinates: [[0, 0], [2, 4]] }
    expect(centroidOf(geom)).toEqual([1, 2])
  })

  it('averages polygon vertices', () => {
    const geom: GeoDrawnGeometry = { type: 'polygon', coordinates: [[0, 0], [3, 0], [0, 3]] }
    expect(centroidOf(geom)).toEqual([1, 1])
  })

  it('returns null for an empty line/polygon', () => {
    expect(centroidOf({ type: 'polyline', coordinates: [] })).toBeNull()
    expect(centroidOf({ type: 'polygon', coordinates: [] })).toBeNull()
  })
})

describe('formatArea', () => {
  it('renders an em dash for zero', () => {
    expect(formatArea(0)).toBe('—')
  })

  it('renders an em dash for a non-finite value', () => {
    expect(formatArea(Number.NaN)).toBe('—')
  })

  it('renders m² below one square kilometer', () => {
    const s = formatArea(1234)
    expect(s).toContain('m²')
    expect(s).not.toContain('km²')
  })

  it('renders km² above one square kilometer', () => {
    const s = formatArea(2_500_000)
    expect(s).toContain('km²')
    expect(s).toBe('2.50 km²')
  })
})

describe('formatLocation', () => {
  it('renders an em dash for null', () => {
    expect(formatLocation(null)).toBe('—')
  })

  it('renders lat, lon to five decimals', () => {
    expect(formatLocation([139.65, 35.68])).toBe('35.68000, 139.65000')
  })
})
