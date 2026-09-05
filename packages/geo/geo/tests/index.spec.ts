// Unit tests for the GeoRuntime service (the `ctx.geo` seam). A stub provider
// registered through registerProvider exercises delegation and the disposer's
// restore; the built-in provider (Nominatim, geocoding-only) exercises the
// geo_unsupported path for every optional domain method. No network is touched:
// geocode delegation uses the stub, not the built-in provider's fetch.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import GeoRuntime, { GeoError } from '../src/index.ts'
import type {
  GeoAsset,
  GeoCatalogEntry,
  GeoDomainFeature,
  GeoDomainFeatures,
  GeoDomainInfo,
  GeoPlace,
  GeoProvider,
  GeoViewport,
} from '../src/index.ts'

const CONFIG = {
  nominatimBaseUrl: 'https://nominatim.test',
  userAgent: 'dsh-geo-test/1.0',
  geocodeTimeoutMs: 1_000,
}

/** A provider implementing every optional method with fixed results. */
function fullProvider(): GeoProvider & { calls: string[] } {
  const calls: string[] = []
  const place: GeoPlace = { name: 'Stub', lat: 1, lon: 2 }
  const entry: GeoCatalogEntry = { id: 'ds:1', title: 'Dataset' }
  const info: GeoDomainInfo = { id: 'airports', title: 'Airports', geometryKind: 'point', available: true }
  const feature: GeoDomainFeature = { id: 'airport:1', domain: 'airports', geometry: {}, properties: {} }
  const features: GeoDomainFeatures = { domain: 'airports', lod: 'local', features: [feature], limited: false }
  const asset: GeoAsset = { id: 'asset:1' } as GeoAsset
  return {
    id: 'stub',
    calls,
    async geocode() { calls.push('geocode'); return [place] },
    async catalogSearch() { calls.push('catalogSearch'); return [entry] },
    async domainList() { calls.push('domainList'); return [info] },
    async domainQuery() { calls.push('domainQuery'); return features },
    async featureGet() { calls.push('featureGet'); return feature },
    async assets() { calls.push('assets'); return [asset] },
  }
}

/** Build a GeoRuntime on a fresh context with the built-in provider. */
function makeRuntime(): GeoRuntime {
  return new GeoRuntime(new Context(), CONFIG)
}

const signal = (): AbortSignal => new AbortController().signal
const VIEW: GeoViewport = { bbox: [139.6, 35.5, 139.9, 35.8], lod: 'local' }

describe('GeoRuntime geocode and base maps', () => {
  it('rejects an empty (whitespace) query', async () => {
    await expect(makeRuntime().geocode('   ', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_geocode_empty_query' })
  })

  it('trims and delegates geocode to the active provider', async () => {
    const runtime = makeRuntime()
    const provider = fullProvider()
    runtime.registerProvider(provider)
    const places = await runtime.geocode('  Stub  ', 5, signal())
    expect(places).toEqual([{ name: 'Stub', lat: 1, lon: 2 }])
    expect(provider.calls).toContain('geocode')
  })

  it('returns the static base-map presets', () => {
    const maps = makeRuntime().listBaseMaps()
    expect(maps.map(map => map.id)).toContain('osm')
  })
})

describe('GeoRuntime registerProvider', () => {
  it('swaps the active provider and restores it on dispose', async () => {
    const runtime = makeRuntime()
    const provider = fullProvider()
    const restore = runtime.registerProvider(provider)
    // Active: the stub supports domainList.
    await expect(runtime.domainList(signal())).resolves.toHaveLength(1)
    restore()
    // Restored: the built-in provider is geocoding-only.
    await expect(runtime.domainList(signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
  })
})

describe('GeoRuntime domain methods delegate to a capable provider', () => {
  it('delegates catalogSearch, domainQuery, featureGet, and assets', async () => {
    const runtime = makeRuntime()
    const provider = fullProvider()
    runtime.registerProvider(provider)
    await expect(runtime.catalogSearch('  ports  ', 10, signal())).resolves.toEqual([{ id: 'ds:1', title: 'Dataset' }])
    await expect(runtime.domainQuery('airports', VIEW, signal())).resolves.toMatchObject({ domain: 'airports' })
    await expect(runtime.featureGet('airports', '  airport:1  ', signal())).resolves.toMatchObject({ id: 'airport:1' })
    await expect(runtime.assets({ ids: ['asset:1'] }, signal())).resolves.toHaveLength(1)
    expect(provider.calls).toEqual(
      expect.arrayContaining(['catalogSearch', 'domainQuery', 'featureGet', 'assets']),
    )
  })

  it('rejects an empty catalog query before touching the provider', async () => {
    const runtime = makeRuntime()
    runtime.registerProvider(fullProvider())
    await expect(runtime.catalogSearch('  ', 10, signal()))
      .rejects.toMatchObject({ code: 'geo_catalog_empty_query' })
  })

  it('rejects an empty feature id before touching the provider', async () => {
    const runtime = makeRuntime()
    runtime.registerProvider(fullProvider())
    await expect(runtime.featureGet('airports', '   ', signal()))
      .rejects.toMatchObject({ code: 'geo_feature_empty_id' })
  })
})

describe('GeoRuntime rejects unsupported domain methods on the built-in provider', () => {
  it('throws geo_unsupported naming the provider and method', async () => {
    const runtime = makeRuntime()
    await expect(runtime.catalogSearch('x', 5, signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
    await expect(runtime.domainList(signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
    await expect(runtime.domainQuery('airports', VIEW, signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
    await expect(runtime.featureGet('airports', 'airport:1', signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
    await expect(runtime.assets({ bbox: [0, 0, 1, 1] }, signal())).rejects.toMatchObject({ code: 'geo_unsupported' })
    const error = await runtime.domainList(signal()).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(GeoError)
    expect((error as GeoError).message).toContain("'public-nominatim'")
    expect((error as GeoError).message).toContain('domainList')
  })
})
