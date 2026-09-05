/**
 * Pure GeoJSON export for drawn features: build a FeatureCollection from the
 * accumulated `geoCommand` features, carrying the semantic type, area, and
 * centroid as properties. Coordinates are WGS84 `[lon, lat]` degrees. The
 * browser-download side effect lives in the component; this module is pure and
 * unit-tested.
 * @module
 */
import type { GeoDrawnFeature, GeoDrawnGeometry } from '@deepseek-ai/dsh-geo-command/client'
import { centroidOf, polygonAreaM2 } from './geoMetrics.ts'

/** A GeoJSON geometry object (the subset the drawn geometries map to). */
interface GeoJsonGeometry {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: unknown
}

/** One GeoJSON Feature with the drawn feature's derived properties. */
interface GeoJsonFeature {
  type: 'Feature'
  id: string
  geometry: GeoJsonGeometry
  properties: {
    featureType: string | null
    name: string | null
    areaM2: number | null
    centroid: readonly [number, number] | null
  }
}

/** A GeoJSON FeatureCollection. */
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

/** Map a drawn geometry to its GeoJSON geometry (polygon rings are closed). */
function toGeoJsonGeometry(geometry: GeoDrawnGeometry): GeoJsonGeometry {
  if (geometry.type === 'point') {
    return { type: 'Point', coordinates: [geometry.coordinates[0], geometry.coordinates[1]] }
  }
  if (geometry.type === 'polyline') {
    return { type: 'LineString', coordinates: geometry.coordinates.map(c => [c[0], c[1]]) }
  }
  // GeoJSON polygons are an array of linear rings; the ring must be closed
  // (first point repeated) to be valid.
  const ring = geometry.coordinates.map(c => [c[0], c[1]] as [number, number])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]])
  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * Build a GeoJSON FeatureCollection from the drawn features, deriving the area
 * (polygons only) and centroid for each and carrying the semantic type/name.
 * @param features - the accumulated drawn features.
 * @returns a FeatureCollection ready to serialize.
 */
export function featuresToGeoJson(features: readonly GeoDrawnFeature[]): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((feature): GeoJsonFeature => ({
      type: 'Feature',
      id: feature.id,
      geometry: toGeoJsonGeometry(feature.geometry),
      properties: {
        featureType: feature.featureType ?? null,
        name: feature.name ?? null,
        areaM2: feature.geometry.type === 'polygon' ? polygonAreaM2(feature.geometry.coordinates) : null,
        centroid: centroidOf(feature.geometry),
      },
    })),
  }
}
