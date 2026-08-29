/**
 * Derivation of the current Earth viewport from the latest camera command in a
 * session, and its rendered text. Pure functions with no cordis or session
 * imports so they are unit-testable in isolation.
 * @module @deepseek-ai/dsh-geo-viewcontext/viewport
 */

/** A camera pose the globe is looking from. */
export interface CameraPose {
  /** Latitude in WGS84 degrees. */
  readonly lat: number
  /** Longitude in WGS84 degrees. */
  readonly lon: number
  /** Camera height above the ellipsoid in meters. */
  readonly height: number
}

/** An approximate view bounding box [west, south, east, north] in degrees. */
export type ViewBBox = readonly [number, number, number, number]

/** Mean Earth radius in meters, used to convert a camera height to a ground span. */
const EARTH_RADIUS_M = 6_371_000

/**
 * Approximate the visible ground half-span, in degrees of latitude, for a
 * camera looking straight down from `height`. Uses a 60° vertical field of
 * view: the visible ground radius is `height * tan(30°)`, converted to degrees
 * by the Earth radius. Clamped to a hemisphere so a very high camera yields a
 * whole-globe box rather than an out-of-range one.
 * @param height - camera height above the ellipsoid in meters.
 * @returns the half-span in degrees (0..90).
 */
function halfSpanDegrees(height: number): number {
  const groundRadiusM = Math.max(0, height) * Math.tan(Math.PI / 6)
  const degrees = (groundRadiusM / EARTH_RADIUS_M) * (180 / Math.PI)
  return Math.min(90, degrees)
}

/**
 * Derive an approximate view bbox from a camera pose. Longitude half-span is
 * widened by `1 / cos(lat)` because meridians converge toward the poles, and
 * the result is clamped to valid WGS84 ranges.
 * @param pose - the camera pose.
 * @returns an approximate [west, south, east, north] bbox.
 */
export function deriveViewBBox(pose: CameraPose): ViewBBox {
  const latHalf = halfSpanDegrees(pose.height)
  // A saturated latitude half-span means the camera sees a hemisphere or more;
  // report the whole globe rather than a cos-lat-scaled longitude sub-span.
  if (latHalf >= 90) return [-180, -90, 180, 90]
  const cosLat = Math.cos((pose.lat * Math.PI) / 180)
  const lonHalf = Math.min(180, cosLat > 1e-6 ? latHalf / cosLat : 180)
  const south = Math.max(-90, pose.lat - latHalf)
  const north = Math.min(90, pose.lat + latHalf)
  const west = Math.max(-180, pose.lon - lonHalf)
  const east = Math.min(180, pose.lon + lonHalf)
  return [west, south, east, north]
}

/** Round a degree value to five decimals (about 1 m) for stable rendered text. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

/**
 * Render the current-view context text for the model. States the camera
 * target, height, and the approximate viewport bbox that domain queries can use.
 * @param pose - the camera pose the globe is looking from.
 * @returns a single model-facing context block.
 */
export function renderViewContext(pose: CameraPose): string {
  const [west, south, east, north] = deriveViewBBox(pose)
  return (
    `The 3D Earth view is currently centered at latitude ${round5(pose.lat)}, longitude ${round5(pose.lon)}, `
    + `camera height ${Math.round(pose.height)} m. `
    + 'Approximate visible bounds (west, south, east, north): '
    + `${round5(west)}, ${round5(south)}, ${round5(east)}, ${round5(north)}. `
    + 'Use these bounds as the bbox for domain-layer queries about what is on screen.'
  )
}
