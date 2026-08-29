/**
 * Deterministic geo provider fixture for the geo snapshot scenario: registers
 * a fixed-data provider on `ctx.geo` so recording and keyless replay drive the
 * real `dsh-tool-geo-query` tools and `ctx.geo` seam without any network. The
 * data is small and stable because it is part of the recorded model transcript
 * and the pinned tool-result outputs.
 */

/** Cordis plugin name. */
export const name = 'geo-fixture-provider'

/** Services the fixture provider needs before it can register. */
export const inject = ['geo']

/** Fixed base-map presets, matching the seam's built-in ids. */
const BASE_MAPS = [
  { id: 'osm', label: 'OpenStreetMap', urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 },
  { id: 'esri-satellite', label: 'Esri Satellite', urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery © Esri', maxZoom: 19 },
]

/** One fixed airport feature the domain tools return. */
const HND = {
  id: 'airport:HND',
  domain: 'airports',
  geometry: { type: 'Point', coordinates: [139.7798, 35.5494] },
  properties: { name: 'Tokyo Haneda', iata: 'HND' },
}

/**
 * Register a deterministic provider on `ctx.geo`.
 * @param ctx - Cordis context carrying the geo seam.
 */
export function apply(ctx) {
  ctx.geo.registerProvider({
    id: 'fixture-geo',
    geocode: (query) => Promise.resolve(
      /tokyo/i.test(query)
        ? [{ name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, kind: 'city', bbox: [139.5, 35.5, 139.9, 35.8] }]
        : [],
    ),
    listBaseMaps: () => BASE_MAPS,
    catalogSearch: () => Promise.resolve([
      { id: 'terra:imagery', title: 'Terra base imagery', kind: 'imagery', bbox: [-180, -90, 180, 90] },
    ]),
    domainList: () => Promise.resolve([
      { id: 'airports', title: 'Airports', geometryKind: 'point', available: true },
      { id: 'roads', title: 'Roads', geometryKind: 'line', available: false },
    ]),
    domainQuery: (domain, viewport) => Promise.resolve({
      domain,
      lod: viewport.lod,
      limited: false,
      features: domain === 'airports' ? [HND] : [],
    }),
    featureGet: (domain, id) => Promise.resolve(
      domain === 'airports' && id === HND.id ? HND : null,
    ),
    assets: () => Promise.resolve([]),
  })
}
