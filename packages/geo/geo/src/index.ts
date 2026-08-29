/**
 * Service Definition for the geo capability seam (`ctx.geo`): geocoding and
 * static base-map presets for the Terra geo port. A built-in public provider
 * (Nominatim) is mounted from config, so the seam is self-contained; a later
 * Terra-backend provider can replace it via `registerProvider` without
 * touching the tools or the client.
 * @module @deepseek-ai/dsh-geo
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BASE_MAP_PRESETS, PublicGeoProvider } from './provider.ts'
import { GeoError } from './types.ts'
import type {
  DomainId,
  GeoAsset,
  GeoBaseMap,
  GeoBBox,
  GeoCatalogEntry,
  GeoDomainFeature,
  GeoDomainFeatures,
  GeoDomainInfo,
  GeoPlace,
  GeoProvider,
  GeoViewport,
} from './types.ts'

export { GeoError } from './types.ts'
export { BASE_MAP_PRESETS, PublicGeoProvider } from './provider.ts'
export type {
  DomainGeometryKind,
  DomainId,
  DomainLod,
  GeoAsset,
  GeoBaseMap,
  GeoBBox,
  GeoCatalogEntry,
  GeoDomainFeature,
  GeoDomainFeatures,
  GeoDomainInfo,
  GeoPlace,
  GeoProvider,
  GeoViewport,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    geo: GeoRuntime
  }
}

/** Config for the geo seam's built-in public provider. */
export interface GeoRuntimeConfig {
  /** Nominatim base URL. */
  readonly nominatimBaseUrl: string
  /** User-Agent for outbound geocode requests (Nominatim policy). */
  readonly userAgent: string
  /** Per-request geocode timeout in milliseconds. */
  readonly geocodeTimeoutMs: number
}

/**
 * The geo access service, registered as `ctx.geo` (one instance per context).
 * Holds one active geocode provider (built-in by default, replaceable) and the
 * static base-map presets.
 */
export class GeoRuntime extends Service {
  /** Config for the built-in provider. Env overrides feed these same fields. */
  static Config: z<GeoRuntimeConfig> = z.object({
    nominatimBaseUrl: z.string().default('https://nominatim.openstreetmap.org'),
    userAgent: z.string().default('deepseek-harness-geo/0.1 (+https://github.com/deepseek-ai/deepseek-harness)'),
    geocodeTimeoutMs: z.natural().default(10_000),
  })

  private provider: GeoProvider

  /** @param ctx - owning context. @param config - built-in provider config. */
  constructor(ctx: Context, config: GeoRuntimeConfig) {
    super(ctx, 'geo')
    this.provider = new PublicGeoProvider({
      baseUrl: config.nominatimBaseUrl,
      userAgent: config.userAgent,
      timeoutMs: config.geocodeTimeoutMs,
    })
  }

  /**
   * Replace the active geocode provider (e.g. a Terra-backend provider).
   * @param provider - the provider to make active.
   * @returns a disposer that restores the previous provider.
   */
  registerProvider(provider: GeoProvider): () => void {
    const previous = this.provider
    this.provider = provider
    return () => { this.provider = previous }
  }

  /**
   * Resolve a free-text place query to ranked places.
   * @param query - non-empty free-text place name.
   * @param limit - maximum results (clamped to 1..20 by the provider).
   * @param signal - abort signal forwarded to the provider.
   * @returns ranked places, best first.
   * @throws {GeoError} when the query is empty or the provider fails.
   */
  async geocode(query: string, limit: number, signal: AbortSignal): Promise<GeoPlace[]> {
    const trimmed = query.trim()
    if (trimmed.length === 0) throw new GeoError('geo_geocode_empty_query', 'geocode query must be non-empty')
    return await this.provider.geocode(trimmed, limit, signal)
  }

  /**
   * The static base-map presets.
   * @returns all selectable base-map presets.
   */
  listBaseMaps(): readonly GeoBaseMap[] {
    return BASE_MAP_PRESETS
  }

  /**
   * Search the domain catalog for datasets matching free text.
   * @param query - non-empty free-text catalog query.
   * @param limit - maximum entries to return.
   * @param signal - abort signal forwarded to the provider.
   * @returns matched catalog entries, best first.
   * @throws {GeoError} `geo_unsupported` when the active provider serves geocoding only.
   */
  async catalogSearch(query: string, limit: number, signal: AbortSignal): Promise<GeoCatalogEntry[]> {
    const trimmed = query.trim()
    if (trimmed.length === 0) throw new GeoError('geo_catalog_empty_query', 'catalog query must be non-empty')
    const provider = this.provider
    if (!provider.catalogSearch) throw unsupported(provider, 'catalogSearch')
    return await provider.catalogSearch(trimmed, limit, signal)
  }

  /**
   * List the domain layers the active provider can serve.
   * @param signal - abort signal forwarded to the provider.
   * @returns one entry per domain layer.
   * @throws {GeoError} `geo_unsupported` when the active provider serves geocoding only.
   */
  async domainList(signal: AbortSignal): Promise<GeoDomainInfo[]> {
    const provider = this.provider
    if (!provider.domainList) throw unsupported(provider, 'domainList')
    return await provider.domainList(signal)
  }

  /**
   * Resolve domain features inside a viewport at a level of detail.
   * @param domain - domain layer to query.
   * @param view - viewport bbox and level of detail.
   * @param signal - abort signal forwarded to the provider.
   * @returns features inside the viewport, capped by the provider's limit.
   * @throws {GeoError} `geo_unsupported` when the active provider serves geocoding only.
   */
  async domainQuery(domain: DomainId, view: GeoViewport, signal: AbortSignal): Promise<GeoDomainFeatures> {
    const provider = this.provider
    if (!provider.domainQuery) throw unsupported(provider, 'domainQuery')
    return await provider.domainQuery(domain, view, signal)
  }

  /**
   * Resolve one domain feature by id.
   * @param domain - domain layer the feature belongs to.
   * @param id - non-empty feature id within the domain.
   * @param signal - abort signal forwarded to the provider.
   * @returns the feature, or null when the provider has no such feature.
   * @throws {GeoError} `geo_unsupported` when the active provider serves geocoding only.
   */
  async featureGet(domain: DomainId, id: string, signal: AbortSignal): Promise<GeoDomainFeature | null> {
    const trimmed = id.trim()
    if (trimmed.length === 0) throw new GeoError('geo_feature_empty_id', 'feature id must be non-empty')
    const provider = this.provider
    if (!provider.featureGet) throw unsupported(provider, 'featureGet')
    return await provider.featureGet(domain, trimmed, signal)
  }

  /**
   * List physical assets by id or intersecting a bounding box.
   * @param selector - explicit ids, or a bbox to intersect.
   * @param signal - abort signal forwarded to the provider.
   * @returns matched assets.
   * @throws {GeoError} `geo_unsupported` when the active provider serves geocoding only.
   */
  async assets(selector: { readonly ids?: readonly string[]; readonly bbox?: GeoBBox }, signal: AbortSignal): Promise<GeoAsset[]> {
    const provider = this.provider
    if (!provider.assets) throw unsupported(provider, 'assets')
    return await provider.assets(selector, signal)
  }
}

/**
 * The `geo_unsupported` error for an optional provider method the active
 * provider omits. Names the provider and method so a caller can report which
 * backend to swap in.
 * @param provider - the active provider lacking the method.
 * @param method - the optional method name the caller invoked.
 * @returns a `GeoError` with code `geo_unsupported`.
 */
function unsupported(provider: GeoProvider, method: string): GeoError {
  return new GeoError('geo_unsupported', `active geo provider '${provider.id}' does not support ${method}; select a domain-data provider`)
}

export default GeoRuntime
