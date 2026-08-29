/**
 * Geo provider that proxies Terra's Fastify BFF, implementing the full
 * `GeoProvider` contract (geocoding plus domain data) so it is a drop-in
 * replacement for the built-in geocoding-only provider. Every outbound request
 * passes the SSRF guard once per origin, carries a timeout deadline combined
 * with the caller's abort signal, reads at most `maxResponseBytes`, and refuses
 * to follow redirects. Terra responses are validated by narrowing at the JSON
 * boundary; malformed shapes raise a typed {@link GeoError}.
 * @module @deepseek-ai/dsh-host-geo-bff/provider
 */

import { GeoError } from '@deepseek-ai/dsh-geo'
import type {
  DomainGeometryKind,
  DomainId,
  DomainLod,
  GeoAsset,
  GeoBBox,
  GeoCatalogEntry,
  GeoDomainFeature,
  GeoDomainFeatures,
  GeoDomainInfo,
  GeoJsonValue,
  GeoPlace,
  GeoProvider,
  GeoViewport,
} from '@deepseek-ai/dsh-geo'
import { TargetPolicyError, validateTarget } from './targetPolicy.ts'
import type { TerraGeoBffProviderOptions } from './types.ts'

/** Domain ids Terra populates, mirrored from `@deepseek-ai/dsh-geo`'s `DomainId`. */
const DOMAIN_IDS: readonly DomainId[] = [
  'airports',
  'cities',
  'lakes',
  'ports',
  'railroads',
  'roads',
  'time-zones',
]

/** Levels of detail a domain query resolves at. */
const DOMAIN_LODS: readonly DomainLod[] = ['world', 'regional', 'local']

/** Geometry kinds a domain layer's features carry. */
const GEOMETRY_KINDS: readonly DomainGeometryKind[] = ['point', 'line', 'polygon']

/** Narrow an unknown to a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow a value parsed from a JSON response body to a JSON object. Values here
 * cross the HTTP/JSON boundary, so `JSON.parse` output that is an object is
 * structurally `GeoJsonValue`; a non-object yields an empty object.
 * @param value - a value from a parsed JSON response.
 * @returns the value as a JSON record, or `{}` when it is not an object.
 */
function asJsonRecord(value: unknown): Record<string, GeoJsonValue> {
  return isRecord(value) ? (value as Record<string, GeoJsonValue>) : {}
}

/** Parse a finite number from a number or numeric string, else undefined. */
function toFinite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Parse a `[west, south, east, north]` bbox of four finite numbers, else undefined. */
function toBBox(raw: unknown): GeoBBox | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined
  const west = toFinite(raw[0]); const south = toFinite(raw[1])
  const east = toFinite(raw[2]); const north = toFinite(raw[3])
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return undefined
  }
  return [west, south, east, north]
}

/** Narrow an unknown to one of Terra's domain ids, else undefined. */
function toDomainId(value: unknown): DomainId | undefined {
  return typeof value === 'string' && (DOMAIN_IDS as readonly string[]).includes(value)
    ? (value as DomainId)
    : undefined
}

/** Narrow an unknown to a level of detail, else undefined. */
function toDomainLod(value: unknown): DomainLod | undefined {
  return typeof value === 'string' && (DOMAIN_LODS as readonly string[]).includes(value)
    ? (value as DomainLod)
    : undefined
}

/** Narrow an unknown to a geometry kind, else undefined. */
function toGeometryKind(value: unknown): DomainGeometryKind | undefined {
  return typeof value === 'string' && (GEOMETRY_KINDS as readonly string[]).includes(value)
    ? (value as DomainGeometryKind)
    : undefined
}

/** Geocoder and domain-data provider backed by Terra's Fastify BFF. */
export class TerraGeoBffProvider implements GeoProvider {
  readonly id = 'terra-bff'

  private readonly fetchImpl: typeof fetch
  private validated = false

  /** @param options - Terra origin, timeout, SSRF permission, byte cap, and test injections. */
  constructor(private readonly options: TerraGeoBffProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Resolve a free-text place query to ranked places.
   * @param query - free-text place name.
   * @param limit - maximum results to return.
   * @param signal - abort signal forwarded from the caller.
   * @returns ranked places, best first.
   */
  async geocode(query: string, limit: number, signal: AbortSignal): Promise<GeoPlace[]> {
    const url = this.url('/api/geocode')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 20))))
    const body = await this.request(url, signal)
    const rows = this.array(body, 'places')
    const places: GeoPlace[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const lat = toFinite(row.lat); const lon = toFinite(row.lon)
      if (lat === undefined || lon === undefined) continue
      const bbox = toBBox(row.bbox)
      const kind = typeof row.kind === 'string' ? row.kind : undefined
      places.push({
        name: typeof row.name === 'string' ? row.name : query,
        lat,
        lon,
        ...(bbox === undefined ? {} : { bbox }),
        ...(kind === undefined ? {} : { kind }),
      })
    }
    return places
  }

  /**
   * Search the domain catalog for datasets matching free text.
   * @param query - free-text catalog query.
   * @param limit - maximum entries to return.
   * @param signal - abort signal forwarded from the caller.
   * @returns matched catalog entries, best first.
   */
  async catalogSearch(query: string, limit: number, signal: AbortSignal): Promise<GeoCatalogEntry[]> {
    const url = this.url('/api/catalog/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 50))))
    const body = await this.request(url, signal)
    const rows = this.array(body, 'catalog entries')
    const entries: GeoCatalogEntry[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const id = typeof row.id === 'string' ? row.id : undefined
      const title = typeof row.title === 'string' ? row.title : undefined
      if (id === undefined || title === undefined) continue
      const kind = typeof row.kind === 'string' ? row.kind : undefined
      const bbox = toBBox(row.bbox)
      entries.push({
        id,
        title,
        ...(kind === undefined ? {} : { kind }),
        ...(bbox === undefined ? {} : { bbox }),
      })
    }
    return entries
  }

  /**
   * List the domain layers Terra can serve and their availability.
   * @param signal - abort signal forwarded from the caller.
   * @returns one entry per known domain layer.
   */
  async domainList(signal: AbortSignal): Promise<GeoDomainInfo[]> {
    const url = this.url('/api/domains')
    const body = await this.request(url, signal)
    if (!isRecord(body)) throw this.badResponse('domains response was not an object')
    const rows = this.array(body.domains, 'domains')
    const infos: GeoDomainInfo[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const id = toDomainId(row.id)
      const geometryKind = toGeometryKind(row.geometryKind)
      if (id === undefined || geometryKind === undefined) continue
      infos.push({
        id,
        title: typeof row.title === 'string' ? row.title : id,
        geometryKind,
        available: row.available === true,
      })
    }
    return infos
  }

  /**
   * Resolve domain features inside a viewport at a level of detail.
   * @param domain - domain layer to query.
   * @param view - viewport bbox and level of detail.
   * @param signal - abort signal forwarded from the caller.
   * @returns the features inside the viewport, capped by Terra's per-LOD limit.
   */
  async domainQuery(domain: DomainId, view: GeoViewport, signal: AbortSignal): Promise<GeoDomainFeatures> {
    const url = this.url(`/api/domains/${encodeURIComponent(domain)}/features`)
    const [west, south, east, north] = view.bbox
    url.searchParams.set('west', String(west))
    url.searchParams.set('south', String(south))
    url.searchParams.set('east', String(east))
    url.searchParams.set('north', String(north))
    url.searchParams.set('lod', view.lod)
    const body = await this.request(url, signal)
    if (!isRecord(body)) throw this.badResponse('domain features response was not an object')
    const resolvedDomain = toDomainId(body.domain) ?? domain
    const lod = toDomainLod(body.lod) ?? view.lod
    const rows = this.array(body.features, 'features')
    const features: GeoDomainFeature[] = []
    for (const row of rows) {
      const feature = this.toFeature(row, resolvedDomain)
      if (feature !== undefined) features.push(feature)
    }
    return {
      domain: resolvedDomain,
      lod,
      features,
      limited: body.limited === true,
    }
  }

  /**
   * Resolve one domain feature by id.
   * @param domain - domain layer the feature belongs to.
   * @param id - feature id within the domain.
   * @param signal - abort signal forwarded from the caller.
   * @returns the feature, or null when Terra has no such feature (HTTP 404).
   */
  async featureGet(domain: DomainId, id: string, signal: AbortSignal): Promise<GeoDomainFeature | null> {
    const url = this.url(`/api/domains/${encodeURIComponent(domain)}/feature/${encodeURIComponent(id)}`)
    const body = await this.request(url, signal, { notFoundIsNull: true })
    if (body === NOT_FOUND) return null
    const feature = this.toFeature(body, domain)
    if (feature === undefined) throw this.badResponse('feature response was not a valid feature')
    return feature
  }

  /**
   * List physical assets by id or intersecting a bounding box.
   * @param selector - explicit ids, or a bbox to intersect.
   * @param signal - abort signal forwarded from the caller.
   * @returns matched assets.
   */
  async assets(
    selector: { readonly ids?: readonly string[]; readonly bbox?: GeoBBox },
    signal: AbortSignal,
  ): Promise<GeoAsset[]> {
    const url = this.url('/api/assets')
    if (selector.ids !== undefined && selector.ids.length > 0) {
      url.searchParams.set('ids', selector.ids.join(','))
    }
    if (selector.bbox !== undefined) {
      url.searchParams.set('bbox', selector.bbox.join(','))
    }
    const body = await this.request(url, signal)
    const rows = Array.isArray(body)
      ? body
      : isRecord(body)
        ? this.array(body.assets, 'assets')
        : (() => { throw this.badResponse('assets response was neither an array nor an object') })()
    const assets: GeoAsset[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const id = typeof row.id === 'string' ? row.id : undefined
      const title = typeof row.title === 'string' ? row.title : undefined
      if (id === undefined || title === undefined) continue
      const bbox = toBBox(row.bbox)
      assets.push({ id, title, ...(bbox === undefined ? {} : { bbox }) })
    }
    return assets
  }

  /**
   * Map a raw Terra feature row to a {@link GeoDomainFeature}, passing geometry
   * and properties through verbatim.
   * @param row - raw feature row.
   * @param fallbackDomain - domain to use when the row omits a valid domain.
   * @returns the feature, or undefined when the row lacks a string id.
   */
  private toFeature(row: unknown, fallbackDomain: DomainId): GeoDomainFeature | undefined {
    if (!isRecord(row)) return undefined
    const id = typeof row.id === 'string' ? row.id : undefined
    if (id === undefined) return undefined
    return {
      id,
      domain: toDomainId(row.domain) ?? fallbackDomain,
      geometry: asJsonRecord(row.geometry),
      properties: asJsonRecord(row.properties),
    }
  }

  /**
   * Build a request URL against the Terra origin.
   * @param pathname - the API path.
   * @returns the composed URL.
   */
  private url(pathname: string): URL {
    return new URL(pathname, this.options.baseUrl)
  }

  /**
   * Narrow an unknown to an array or raise a typed bad-response error.
   * @param value - the value that should be an array.
   * @param what - description used in the error message.
   * @returns the value as an unknown array.
   */
  private array(value: unknown, what: string): readonly unknown[] {
    if (!Array.isArray(value)) throw this.badResponse(`${what} response was not an array`)
    return value
  }

  /** Build a `geo_bff_bad_response` error. */
  private badResponse(detail: string): GeoError {
    return new GeoError('geo_bff_bad_response', `Terra BFF ${detail}`)
  }

  /**
   * Validate the origin against the SSRF guard once, caching success.
   * @throws {GeoError} `geo_bff_blocked_target` when the guard rejects the origin.
   */
  private async ensureValidated(): Promise<void> {
    if (this.validated) return
    try {
      await validateTarget(this.options.baseUrl, {
        allowPrivateSources: this.options.allowPrivateSources,
        ...(this.options.resolver === undefined ? {} : { resolver: this.options.resolver }),
      })
    } catch (cause) {
      /* v8 ignore next 2 -- validateTarget only rejects with TargetPolicyError, so the non-matching branch is defensive. */
      if (cause instanceof TargetPolicyError) {
        throw new GeoError('geo_bff_blocked_target', `Terra BFF target rejected: ${cause.code}`)
      }
      /* v8 ignore next -- unreachable fallback: validateTarget throws only TargetPolicyError. */
      throw new GeoError('geo_bff_blocked_target', `Terra BFF target rejected: ${String(cause)}`)
    }
    this.validated = true
  }

  /**
   * Perform one GET against Terra with a timeout, byte cap, and manual-redirect
   * policy, and parse the JSON body.
   * @param url - the request URL.
   * @param signal - the caller's abort signal.
   * @param opts - when `notFoundIsNull`, an HTTP 404 resolves to the {@link NOT_FOUND} sentinel.
   * @returns the parsed JSON, or {@link NOT_FOUND} on a 404 when requested.
   * @throws {GeoError} on blocked target, unreachable origin, HTTP error,
   *   oversized body, or malformed JSON.
   */
  private async request(
    url: URL,
    signal: AbortSignal,
    opts: { readonly notFoundIsNull?: boolean } = {},
  ): Promise<unknown> {
    await this.ensureValidated()

    const timeout = new AbortController()
    const onAbort = (): void => { timeout.abort() }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timeout.abort() }, this.options.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'application/json' },
        signal: timeout.signal,
      })
    } catch (cause) {
      throw new GeoError('geo_bff_unreachable', `Terra BFF request failed: ${String(cause)}`)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    if (opts.notFoundIsNull === true && response.status === 404) return NOT_FOUND
    if (!response.ok) {
      throw new GeoError('geo_bff_http_error', `Terra BFF responded ${response.status}`)
    }

    const text = await readCapped(response, this.options.maxResponseBytes)
    try {
      return JSON.parse(text)
    } catch {
      throw new GeoError('geo_bff_bad_response', 'Terra BFF response was not valid JSON')
    }
  }
}

/** Sentinel distinguishing a Terra 404 from a `null` JSON body. */
const NOT_FOUND: unique symbol = Symbol('terra-bff-not-found')

/**
 * Read a response body as text, aborting past a byte cap.
 * @param response - the fetch response.
 * @param maxBytes - maximum bytes to read before aborting.
 * @returns the decoded body text.
 * @throws {GeoError} `geo_bff_too_large` when the body exceeds `maxBytes`.
 */
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
      throw new GeoError('geo_bff_too_large', `Terra BFF response exceeded ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(concat(chunks, total))
}

/**
 * Concatenate byte chunks into one buffer of the given length.
 * @param chunks - the byte chunks in order.
 * @param total - the summed byte length of all chunks.
 * @returns one buffer holding every chunk.
 */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}
