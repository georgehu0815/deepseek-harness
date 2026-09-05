/**
 * Pure types of the geo capability seam: geocoding results and base-map
 * presets. No runtime value imports — the service and its provider live in
 * `./index.ts`.
 * @module @deepseek-ai/dsh-geo/types
 */

/** A geographic bounding box in WGS84 degrees: [west, south, east, north]. */
export type GeoBBox = readonly [number, number, number, number]

/** A JSON value: domain feature geometry and properties come from parsed JSON. */
export type GeoJsonValue =
  | null
  | boolean
  | number
  | string
  | GeoJsonValue[]
  | { [key: string]: GeoJsonValue }

/** One resolved place from a geocode query. */
export interface GeoPlace {
  /** Display name of the matched place. */
  readonly name: string
  /** Latitude in WGS84 degrees. */
  readonly lat: number
  /** Longitude in WGS84 degrees. */
  readonly lon: number
  /** Bounding box [west, south, east, north] when the source supplies one. */
  readonly bbox?: GeoBBox
  /** Coarse place category the source reports (city, country, …), when present. */
  readonly kind?: string
}

/**
 * Terra domain layer ids. Mirrors Terra's `DOMAIN_IDS` (`src/domains/contracts.ts`)
 * exactly. A `type` here would let this drift from Terra's populated set; the
 * `const` is the single home so a provider reporting a different id is a loud
 * type error, not a silent widening.
 */
export type DomainId =
  | 'airports'
  | 'cities'
  | 'lakes'
  | 'ports'
  | 'railroads'
  | 'roads'
  | 'time-zones'

/** Level of detail a domain query resolves at. Mirrors Terra's `DomainLod`. */
export type DomainLod = 'world' | 'regional' | 'local'

/** Geometry kind a domain feature carries. Mirrors Terra's `DomainGeometryKind`. */
export type DomainGeometryKind = 'point' | 'line' | 'polygon'

/** One catalog entry returned by a catalog search. */
export interface GeoCatalogEntry {
  /** Stable catalog entry id. */
  readonly id: string
  /** Human title. */
  readonly title: string
  /** Coarse entry kind the source reports, when present. */
  readonly kind?: string
  /** Bounding box the entry covers, when the source supplies one. */
  readonly bbox?: GeoBBox
}

/** One domain layer's availability, as reported by the provider. */
export interface GeoDomainInfo {
  /** Domain layer id. */
  readonly id: DomainId
  /** Human title. */
  readonly title: string
  /** Geometry kind the layer's features carry. */
  readonly geometryKind: DomainGeometryKind
  /** Whether the provider currently has data for this layer. */
  readonly available: boolean
}

/** One domain feature: opaque GeoJSON geometry plus source-reported properties. */
export interface GeoDomainFeature {
  /** Stable feature id within its domain. */
  readonly id: string
  /** Domain layer the feature belongs to. */
  readonly domain: DomainId
  /** GeoJSON geometry object, passed through verbatim from the provider. */
  readonly geometry: Record<string, GeoJsonValue>
  /** Source-reported properties, passed through verbatim. */
  readonly properties: Record<string, GeoJsonValue>
}

/** A page of domain features for one viewport query. */
export interface GeoDomainFeatures {
  /** Domain layer queried. */
  readonly domain: DomainId
  /** Level of detail the provider resolved at. */
  readonly lod: DomainLod
  /** Features inside the requested viewport, capped by the provider's limit. */
  readonly features: readonly GeoDomainFeature[]
  /** Whether the provider truncated the result to its per-LOD limit. */
  readonly limited: boolean
}

/** One physical asset (COG, point cloud, …) the assets index reports. */
export interface GeoAsset {
  /** Stable asset id. */
  readonly id: string
  /** Human title. */
  readonly title: string
  /** Bounding box the asset covers, when present. */
  readonly bbox?: GeoBBox
}

/** One selectable base-map imagery preset. */
export interface GeoBaseMap {
  /** Stable id used by the client to select and by tools to name. */
  readonly id: string
  /** Human label. */
  readonly label: string
  /** XYZ tile URL template with {z}/{x}/{y} placeholders. */
  readonly urlTemplate: string
  /** Attribution text required by the tile source. */
  readonly attribution: string
  /** Maximum zoom level the source serves. */
  readonly maxZoom: number
}

/** Viewport a domain query resolves features inside. */
export interface GeoViewport {
  /** Bounding box [west, south, east, north] in WGS84 degrees. */
  readonly bbox: GeoBBox
  /** Level of detail to resolve at. */
  readonly lod: DomainLod
}

/**
 * A geo data provider. `geocode` is required (every provider resolves places);
 * the domain-data methods are optional because the built-in self-contained
 * provider serves only geocoding. `GeoRuntime` maps an absent optional method to
 * a `GeoError('geo_unsupported', …)`, so a Consumer never sees `undefined` and a
 * Terra-backed provider that implements them is a drop-in with no tool change.
 * Base-map presets are static seam data, not part of this contract.
 */
export interface GeoProvider {
  /** Stable provider id. */
  readonly id: string
  /**
   * Resolve a free-text place query to ranked places.
   * @param query - free-text place name.
   * @param limit - maximum results to return.
   * @param signal - abort signal forwarded from the caller.
   * @returns ranked places, best first; empty when nothing matched.
   */
  geocode(query: string, limit: number, signal: AbortSignal): Promise<GeoPlace[]>
  /**
   * Search the domain catalog for datasets matching free text.
   * @param query - free-text catalog query.
   * @param limit - maximum entries to return.
   * @param signal - abort signal forwarded from the caller.
   * @returns matched catalog entries, best first.
   */
  catalogSearch?(query: string, limit: number, signal: AbortSignal): Promise<GeoCatalogEntry[]>
  /**
   * List the domain layers this provider can serve and their availability.
   * @param signal - abort signal forwarded from the caller.
   * @returns one entry per domain layer.
   */
  domainList?(signal: AbortSignal): Promise<GeoDomainInfo[]>
  /**
   * Resolve domain features inside a viewport at a level of detail.
   * @param domain - domain layer to query.
   * @param view - viewport bbox and level of detail.
   * @param signal - abort signal forwarded from the caller.
   * @returns the features inside the viewport, capped by the provider's limit.
   */
  domainQuery?(domain: DomainId, view: GeoViewport, signal: AbortSignal): Promise<GeoDomainFeatures>
  /**
   * Resolve one domain feature by id.
   * @param domain - domain layer the feature belongs to.
   * @param id - feature id within the domain.
   * @param signal - abort signal forwarded from the caller.
   * @returns the feature, or null when the provider has no such feature.
   */
  featureGet?(domain: DomainId, id: string, signal: AbortSignal): Promise<GeoDomainFeature | null>
  /**
   * List physical assets by id or intersecting a bounding box.
   * @param selector - explicit ids, or a bbox to intersect.
   * @param signal - abort signal forwarded from the caller.
   * @returns matched assets.
   */
  assets?(selector: { readonly ids?: readonly string[]; readonly bbox?: GeoBBox }, signal: AbortSignal): Promise<GeoAsset[]>
}

/** Error raised by the geo seam. */
export class GeoError extends Error {
  /** @param code - stable machine code. @param message - human detail. */
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'GeoError'
  }
}
