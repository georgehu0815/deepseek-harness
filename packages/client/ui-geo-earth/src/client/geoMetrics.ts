/**
 * Pure geodesic metrics for drawn features: polygon area and centroid, used by
 * the summary table and the GeoJSON export. Coordinates are WGS84 `[lon, lat]`
 * degrees. Area uses the spherical excess of the polygon on an Earth-radius
 * sphere (good to a fraction of a percent at city scale); the centroid is the
 * vertex average, adequate for labeling and camera framing.
 * @module
 */
import type { GeoDrawnGeometry } from '@deepseek-ai/dsh-geo-command/client'

/** Mean Earth radius in meters (WGS84 authalic sphere). */
const EARTH_RADIUS_M = 6_371_008.8

/** Degrees→radians. */
function rad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Spherical area of a polygon ring in square meters. Returns 0 for fewer than
 * three vertices. The ring need not be explicitly closed; winding direction
 * does not matter (the absolute value is returned).
 * @param ring - polygon vertices as `[lon, lat]` degrees.
 * @returns the enclosed area in square meters (>= 0).
 */
export function polygonAreaM2(ring: ReadonlyArray<readonly [number, number]>): number {
  if (ring.length < 3) return 0
  let sum = 0
  let previous = ring[ring.length - 1]
  if (previous === undefined) return 0
  for (const current of ring) {
    sum += (rad(current[0]) - rad(previous[0]))
      * (2 + Math.sin(rad(previous[1])) + Math.sin(rad(current[1])))
    previous = current
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

/**
 * Centroid (vertex average) of a geometry as `[lon, lat]` degrees, or null when
 * the geometry has no vertices. A point returns its own coordinate.
 * @param geometry - the drawn geometry.
 * @returns the centroid `[lon, lat]`, or null.
 */
export function centroidOf(geometry: GeoDrawnGeometry): readonly [number, number] | null {
  if (geometry.type === 'point') return geometry.coordinates
  const coords = geometry.coordinates
  if (coords.length === 0) return null
  let lon = 0
  let lat = 0
  for (const [x, y] of coords) {
    lon += x
    lat += y
  }
  return [lon / coords.length, lat / coords.length]
}

/**
 * Format an area in square meters as a compact, readable string (m² below one
 * km², km² above). Zero or negative areas render as an em dash.
 * @param m2 - area in square meters.
 * @returns a human-readable area string.
 */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return '—'
  if (m2 < 1_000_000) return `${Math.round(m2).toLocaleString()} m²`
  return `${(m2 / 1_000_000).toFixed(2)} km²`
}

/**
 * Format a `[lon, lat]` centroid as `lat, lon` to five decimals, or an em dash
 * when null.
 * @param centroid - the `[lon, lat]` centroid, or null.
 * @returns a human-readable location string.
 */
export function formatLocation(centroid: readonly [number, number] | null): string {
  if (!centroid) return '—'
  return `${centroid[1].toFixed(5)}, ${centroid[0].toFixed(5)}`
}
