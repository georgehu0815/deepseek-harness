/**
 * Built-in geo provider backed by public OpenStreetMap Nominatim, plus the
 * static base-map presets. Self-contained: no external Terra backend. Outbound
 * HTTP uses a timeout deadline and a response-size cap; Nominatim requires a
 * descriptive User-Agent, which the config supplies.
 * @module @deepseek-ai/dsh-geo/provider
 */

import { GeoError } from './types.ts'
import type { GeoBaseMap, GeoPlace, GeoProvider } from './types.ts'

/** Static base-map presets the seam exposes to tools and the client. */
export const BASE_MAP_PRESETS: readonly GeoBaseMap[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    id: 'carto-dark',
    label: 'Carto Dark',
    urlTemplate: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  {
    id: 'carto-light',
    label: 'Carto Light',
    urlTemplate: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  {
    id: 'esri-satellite',
    label: 'Esri Satellite',
    urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri',
    maxZoom: 19,
  },
]

/** Maximum bytes read from a geocode response before aborting. */
const MAX_RESPONSE_BYTES = 1_000_000

/** One raw Nominatim search row (only the fields this provider reads). */
interface NominatimRow {
  readonly display_name?: unknown
  readonly lat?: unknown
  readonly lon?: unknown
  readonly type?: unknown
  readonly boundingbox?: unknown
}

/** Parse a finite number from Nominatim's string-encoded coordinates. */
function toFinite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Nominatim boundingbox is [south, north, west, east] as strings. */
function toBBox(raw: unknown): GeoPlace['bbox'] {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined
  const south = toFinite(raw[0]); const north = toFinite(raw[1])
  const west = toFinite(raw[2]); const east = toFinite(raw[3])
  if (south === undefined || north === undefined || west === undefined || east === undefined) return undefined
  return [west, south, east, north]
}

/** Options for the public Nominatim provider. */
export interface PublicGeoProviderOptions {
  /** Nominatim base URL (default the public instance). */
  readonly baseUrl: string
  /** User-Agent header (Nominatim policy requires a descriptive one). */
  readonly userAgent: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/** Geocoder backed by public Nominatim search. */
export class PublicGeoProvider implements GeoProvider {
  readonly id = 'public-nominatim'

  /** @param options - endpoint, User-Agent, and timeout. */
  constructor(private readonly options: PublicGeoProviderOptions) {}

  async geocode(query: string, limit: number, signal: AbortSignal): Promise<GeoPlace[]> {
    const url = new URL('/search', this.options.baseUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 20))))
    url.searchParams.set('addressdetails', '0')

    const timeout = new AbortController()
    const onAbort = (): void => { timeout.abort() }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timeout.abort() }, this.options.timeoutMs)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': this.options.userAgent, 'accept': 'application/json' },
        signal: timeout.signal,
      })
    } catch (cause) {
      throw new GeoError('geo_geocode_unreachable', `geocode request failed: ${String(cause)}`)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    if (!response.ok) {
      throw new GeoError('geo_geocode_http_error', `geocode responded ${response.status}`)
    }
    const text = await readCapped(response, MAX_RESPONSE_BYTES)
    let rows: unknown
    try {
      rows = JSON.parse(text)
    } catch {
      throw new GeoError('geo_geocode_bad_response', 'geocode response was not valid JSON')
    }
    if (!Array.isArray(rows)) return []
    const places: GeoPlace[] = []
    for (const row of rows as NominatimRow[]) {
      const lat = toFinite(row.lat); const lon = toFinite(row.lon)
      if (lat === undefined || lon === undefined) continue
      const bbox = toBBox(row.boundingbox)
      const kind = typeof row.type === 'string' ? row.type : undefined
      places.push({
        name: typeof row.display_name === 'string' ? row.display_name : query,
        lat,
        lon,
        ...(bbox === undefined ? {} : { bbox }),
        ...(kind === undefined ? {} : { kind }),
      })
    }
    return places
  }
}

/** Read a response body as text, aborting past a byte cap. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (!body) return await response.text()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new GeoError('geo_geocode_too_large', `geocode response exceeded ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(concat(chunks, total))
}

/** Concatenate byte chunks into one buffer of the given length. */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}
