/**
 * Deterministic segmentation provider fixture for the geo-segment snapshot
 * scenario: registers a fixed-data provider on `ctx.segment` so recording and
 * keyless replay drive the real `segment_view` tool and `ctx.segment` seam
 * without any network or SAM backend. The returned polygons are small and
 * stable because they are part of the recorded model transcript and the pinned
 * tool-result outputs.
 */

/** Cordis plugin name. */
export const name = 'segment-fixture-provider'

/** Services the fixture provider needs before it can register. */
export const inject = ['segment']

/**
 * Two fixed building footprints inside the scenario's view bbox
 * (west 139.76, south 35.54, east 139.80, north 35.56), as lon/lat polygon rings.
 */
const FEATURES = [
  {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[139.770, 35.548], [139.772, 35.548], [139.772, 35.550], [139.770, 35.550], [139.770, 35.548]]] },
    properties: { score: 0.94, prompt: 'building' },
  },
  {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[139.785, 35.552], [139.788, 35.552], [139.788, 35.555], [139.785, 35.555], [139.785, 35.552]]] },
    properties: { score: 0.88, prompt: 'building' },
  },
]

/**
 * Register a deterministic provider on `ctx.segment` that echoes fixed building
 * footprints regardless of the posted view, so the scenario is offline and stable.
 * @param ctx - Cordis context carrying the segment seam.
 */
export function apply(ctx) {
  ctx.segment.registerProvider({
    id: 'fixture-segment',
    segment: () => Promise.resolve({ type: 'FeatureCollection', features: FEATURES }),
  })
}
