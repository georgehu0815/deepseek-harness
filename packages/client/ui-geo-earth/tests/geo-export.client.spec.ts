/**
 * Pure GeoJSON export: drawn features become a FeatureCollection with Point,
 * LineString, and closed-ring Polygon geometries, carrying featureType, name,
 * area (polygons only), and centroid as properties. Both an already-closed and
 * an open polygon ring are covered, plus the null-property and empty-set arms.
 */
import { describe, expect, it } from 'vitest'
import type { GeoDrawnFeature } from '@deepseek-ai/dsh-geo-command/client'
import { featuresToGeoJson } from '../src/client/geoExport.ts'

describe('featuresToGeoJson', () => {
  it('returns an empty collection for no features', () => {
    expect(featuresToGeoJson([])).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('maps a point to a GeoJSON Point with null area and its centroid', () => {
    const feature: GeoDrawnFeature = { id: 'p1', geometry: { type: 'point', coordinates: [139.65, 35.68] } }
    const fc = featuresToGeoJson([feature])
    const f = fc.features[0]!
    expect(fc.type).toBe('FeatureCollection')
    expect(f.type).toBe('Feature')
    expect(f.id).toBe('p1')
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [139.65, 35.68] })
    expect(f.properties.featureType).toBeNull()
    expect(f.properties.name).toBeNull()
    expect(f.properties.areaM2).toBeNull()
    expect(f.properties.centroid).toEqual([139.65, 35.68])
  })

  it('maps a polyline to a LineString with null area', () => {
    const feature: GeoDrawnFeature = {
      id: 'l1',
      geometry: { type: 'polyline', coordinates: [[0, 0], [1, 1]] },
      featureType: 'road',
      name: 'Main St',
    }
    const f = featuresToGeoJson([feature]).features[0]!
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })
    expect(f.properties.featureType).toBe('road')
    expect(f.properties.name).toBe('Main St')
    expect(f.properties.areaM2).toBeNull()
    expect(f.properties.centroid).toEqual([0.5, 0.5])
  })

  it('closes an open polygon ring by appending the first coordinate', () => {
    const feature: GeoDrawnFeature = {
      id: 'g1',
      geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] },
      featureType: 'house',
    }
    const f = featuresToGeoJson([feature]).features[0]!
    expect(f.geometry.type).toBe('Polygon')
    expect(f.geometry.coordinates).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]])
    expect(f.properties.featureType).toBe('house')
    expect(typeof f.properties.areaM2).toBe('number')
    expect(f.properties.areaM2).toBeGreaterThan(0)
  })

  it('leaves an already-closed polygon ring unchanged', () => {
    const feature: GeoDrawnFeature = {
      id: 'g2',
      geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1], [0, 0]] },
    }
    const f = featuresToGeoJson([feature]).features[0]!
    expect(f.geometry.coordinates).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]])
  })
})
