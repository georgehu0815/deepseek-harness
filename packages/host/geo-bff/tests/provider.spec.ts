// Unit tests for TerraGeoBffProvider. Every test injects `fetchImpl` and a
// permissive `resolver`, so no network or real DNS is touched. Assertions cover
// the exact URL/query each method builds, response mapping to the seam types,
// and every typed GeoError path (http error, bad response, too large, blocked
// target, unreachable) plus the featureGet 404 -> null path and abort.
import { describe, expect, it, vi } from 'vitest'
import { TerraGeoBffProvider } from '@deepseek-ai/dsh-host-geo-bff'
import type { TerraGeoBffProviderOptions } from '@deepseek-ai/dsh-host-geo-bff'
import type { ResolvedAddress, TargetResolver } from '@deepseek-ai/dsh-host-geo-bff'

/** A resolver yielding a public address, so the SSRF guard passes. */
const publicResolver: TargetResolver = async () => [{ address: '93.184.216.34', family: 4 }]

/** A resolver yielding a private address, for the blocked-target path. */
function privateResolver(...addresses: ResolvedAddress[]): TargetResolver {
  return async () => (addresses.length > 0 ? addresses : [{ address: '10.0.0.5', family: 4 }])
}

/** A JSON `Response` with a 200 status by default. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Records every requested URL and returns a response. Given a factory, a fresh
 * response is produced per call (a `Response` body is single-use); given a
 * value, it is reused (only single-call tests pass a value).
 */
function fetchWith(response: Response | (() => Response)): {
  fetchImpl: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input: URL | RequestInfo) => {
    urls.push(input instanceof Request ? input.url : String(input))
    return typeof response === 'function' ? response() : response
  }
  return { fetchImpl, urls }
}

/** Build a provider over a public base URL with the given fetch and overrides. */
function makeProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<TerraGeoBffProviderOptions> = {},
): TerraGeoBffProvider {
  return new TerraGeoBffProvider({
    baseUrl: 'http://terra.test',
    timeoutMs: 10_000,
    allowPrivateSources: false,
    maxResponseBytes: 10_000_000,
    fetchImpl,
    resolver: publicResolver,
    ...overrides,
  })
}

const signal = (): AbortSignal => new AbortController().signal

describe('geocode', () => {
  it('builds the q/limit query and maps places', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([
      { name: 'Tokyo', lat: 35.6762, lon: 139.6503, bbox: [1, 2, 3, 4], kind: 'city' },
      { name: 'skip', lat: 'nan', lon: 1 },
      'not-an-object',
    ]))
    const provider = makeProvider(fetchImpl)
    const places = await provider.geocode('Tokyo', 5, signal())
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe('/api/geocode')
    expect(url.searchParams.get('q')).toBe('Tokyo')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(places).toEqual([
      { name: 'Tokyo', lat: 35.6762, lon: 139.6503, bbox: [1, 2, 3, 4], kind: 'city' },
    ])
  })

  it('clamps the limit into 1..20 and falls back to the query name', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([{ lat: 0, lon: 0 }]))
    const provider = makeProvider(fetchImpl)
    const places = await provider.geocode('Q', 99, signal())
    expect(new URL(urls[0]!).searchParams.get('limit')).toBe('20')
    expect(places[0]!.name).toBe('Q')
    expect(places[0]!.bbox).toBeUndefined()
  })

  it('clamps a sub-1 limit up to 1', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([]))
    await makeProvider(fetchImpl).geocode('Q', 0, signal())
    expect(new URL(urls[0]!).searchParams.get('limit')).toBe('1')
  })

  it('throws bad_response when the body is not an array', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ places: 'nope' }))
    await expect(makeProvider(fetchImpl).geocode('Q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })

  it('drops a row whose lat is neither number nor string, and an invalid bbox', async () => {
    const { fetchImpl } = fetchWith(jsonResponse([
      { name: 'bad-lat', lat: { nested: true }, lon: 1 },
      { name: 'bad-bbox', lat: 1, lon: 2, bbox: [1, 2, 'x', 4] },
    ]))
    const places = await makeProvider(fetchImpl).geocode('Q', 5, signal())
    // The bad-lat row is dropped; the bad-bbox row is kept without a bbox.
    expect(places).toEqual([{ name: 'bad-bbox', lat: 1, lon: 2 }])
  })

  it('validates a loopback origin with no injected resolver (literal skips DNS)', async () => {
    const { fetchImpl } = fetchWith(() => jsonResponse([]))
    const provider = new TerraGeoBffProvider({
      baseUrl: 'http://127.0.0.1:4176',
      timeoutMs: 10_000,
      allowPrivateSources: true,
      maxResponseBytes: 10_000_000,
      fetchImpl,
    })
    await expect(provider.geocode('q', 5, signal())).resolves.toEqual([])
  })
})

describe('catalogSearch', () => {
  it('builds the q/limit query and maps entries', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([
      { id: 'a', title: 'Alpha', kind: 'raster', bbox: [1, 2, 3, 4] },
      { id: 'b', title: 'Beta' },
      { id: 'c' },
      { title: 'no id' },
      'x',
    ]))
    const provider = makeProvider(fetchImpl)
    const entries = await provider.catalogSearch('roads', 3, signal())
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe('/api/catalog/search')
    expect(url.searchParams.get('q')).toBe('roads')
    expect(url.searchParams.get('limit')).toBe('3')
    expect(entries).toEqual([
      { id: 'a', title: 'Alpha', kind: 'raster', bbox: [1, 2, 3, 4] },
      { id: 'b', title: 'Beta' },
    ])
  })

  it('clamps the catalog limit to 50', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([]))
    await makeProvider(fetchImpl).catalogSearch('q', 999, signal())
    expect(new URL(urls[0]!).searchParams.get('limit')).toBe('50')
  })

  it('throws bad_response when the body is not an array', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ entries: {} }))
    await expect(makeProvider(fetchImpl).catalogSearch('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })
})

describe('domainList', () => {
  it('maps domain rows, filtering invalid ids/kinds', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse({
      domains: [
        { id: 'cities', title: 'Cities', geometryKind: 'point', available: true },
        { id: 'roads', geometryKind: 'line', available: false },
        { id: 'bogus', geometryKind: 'point' },
        { id: 'lakes', geometryKind: 'bogus' },
        'x',
      ],
    }))
    const infos = await makeProvider(fetchImpl).domainList(signal())
    expect(new URL(urls[0]!).pathname).toBe('/api/domains')
    expect(infos).toEqual([
      { id: 'cities', title: 'Cities', geometryKind: 'point', available: true },
      { id: 'roads', title: 'roads', geometryKind: 'line', available: false },
    ])
  })

  it('throws bad_response when the body is not an object', async () => {
    const { fetchImpl } = fetchWith(jsonResponse([1, 2, 3]))
    await expect(makeProvider(fetchImpl).domainList(signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })

  it('throws bad_response when domains is not an array', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ domains: 5 }))
    await expect(makeProvider(fetchImpl).domainList(signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })
})

describe('domainQuery', () => {
  it('builds west/south/east/north/lod and maps features', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse({
      domain: 'cities',
      lod: 'regional',
      limited: true,
      features: [
        { id: 'f1', domain: 'cities', geometry: { type: 'Point' }, properties: { pop: 1 } },
        { id: 'f2' },
        'x',
      ],
    }))
    const result = await makeProvider(fetchImpl).domainQuery(
      'cities',
      { bbox: [-10, -20, 30, 40], lod: 'regional' },
      signal(),
    )
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe('/api/domains/cities/features')
    expect(url.searchParams.get('west')).toBe('-10')
    expect(url.searchParams.get('south')).toBe('-20')
    expect(url.searchParams.get('east')).toBe('30')
    expect(url.searchParams.get('north')).toBe('40')
    expect(url.searchParams.get('lod')).toBe('regional')
    expect(result).toEqual({
      domain: 'cities',
      lod: 'regional',
      limited: true,
      features: [
        { id: 'f1', domain: 'cities', geometry: { type: 'Point' }, properties: { pop: 1 } },
        { id: 'f2', domain: 'cities', geometry: {}, properties: {} },
      ],
    })
  })

  it('falls back to the requested domain/lod when the body omits valid ones', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({
      domain: 'bogus',
      lod: 'bogus',
      features: [],
    }))
    const result = await makeProvider(fetchImpl).domainQuery(
      'roads',
      { bbox: [0, 0, 1, 1], lod: 'local' },
      signal(),
    )
    expect(result.domain).toBe('roads')
    expect(result.lod).toBe('local')
    expect(result.limited).toBe(false)
  })

  it('throws bad_response when the body is not an object', async () => {
    const { fetchImpl } = fetchWith(jsonResponse('nope'))
    await expect(makeProvider(fetchImpl).domainQuery('roads', { bbox: [0, 0, 1, 1], lod: 'world' }, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })

  it('throws bad_response when features is not an array', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ features: {} }))
    await expect(makeProvider(fetchImpl).domainQuery('roads', { bbox: [0, 0, 1, 1], lod: 'world' }, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })
})

describe('featureGet', () => {
  it('maps a feature by id and builds the path', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse({
      id: 'x/y', domain: 'ports', geometry: { type: 'Point' }, properties: { a: 1 },
    }))
    const feature = await makeProvider(fetchImpl).featureGet('ports', 'x/y', signal())
    expect(new URL(urls[0]!).pathname).toBe('/api/domains/ports/feature/x%2Fy')
    expect(feature).toEqual({
      id: 'x/y', domain: 'ports', geometry: { type: 'Point' }, properties: { a: 1 },
    })
  })

  it('returns null on a 404 (not an error)', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ error: 'missing' }, 404))
    const feature = await makeProvider(fetchImpl).featureGet('ports', 'nope', signal())
    expect(feature).toBeNull()
  })

  it('throws bad_response when the feature lacks an id', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ domain: 'ports' }))
    await expect(makeProvider(fetchImpl).featureGet('ports', 'x', signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })
})

describe('assets', () => {
  it('sends ids and bbox and maps an array body', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([
      { id: 'a', title: 'Alpha', bbox: [1, 2, 3, 4] },
      { id: 'b', title: 'Beta' },
      { id: 'c' },
      'x',
    ]))
    const assets = await makeProvider(fetchImpl).assets(
      { ids: ['a', 'b'], bbox: [1, 2, 3, 4] },
      signal(),
    )
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe('/api/assets')
    expect(url.searchParams.get('ids')).toBe('a,b')
    expect(url.searchParams.get('bbox')).toBe('1,2,3,4')
    expect(assets).toEqual([
      { id: 'a', title: 'Alpha', bbox: [1, 2, 3, 4] },
      { id: 'b', title: 'Beta' },
    ])
  })

  it('maps an object body with an assets array', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse({
      assets: [{ id: 'a', title: 'Alpha' }],
    }))
    const assets = await makeProvider(fetchImpl).assets({}, signal())
    const url = new URL(urls[0]!)
    expect(url.searchParams.get('ids')).toBeNull()
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(assets).toEqual([{ id: 'a', title: 'Alpha' }])
  })

  it('omits the ids param when the id list is empty', async () => {
    const { fetchImpl, urls } = fetchWith(jsonResponse([]))
    await makeProvider(fetchImpl).assets({ ids: [] }, signal())
    expect(new URL(urls[0]!).searchParams.get('ids')).toBeNull()
  })

  it('drops asset rows lacking a string id or title', async () => {
    const { fetchImpl } = fetchWith(jsonResponse([
      { id: 'a', title: 5 },
      { id: 7, title: 'b' },
      { id: 'c', title: 'Gamma' },
    ]))
    const assets = await makeProvider(fetchImpl).assets({}, signal())
    expect(assets).toEqual([{ id: 'c', title: 'Gamma' }])
  })

  it('throws bad_response when the body is neither array nor object', async () => {
    const { fetchImpl } = fetchWith(jsonResponse('nope'))
    await expect(makeProvider(fetchImpl).assets({}, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })
})

describe('transport error paths', () => {
  it('maps a non-2xx status to http_error', async () => {
    const { fetchImpl } = fetchWith(jsonResponse({ error: 'boom' }, 500))
    await expect(makeProvider(fetchImpl).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_http_error' })
  })

  it('maps invalid JSON to bad_response', async () => {
    const { fetchImpl } = fetchWith(new Response('{ not json', { status: 200 }))
    await expect(makeProvider(fetchImpl).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })

  it('reads a bodyless response via text() (empty body -> bad_response)', async () => {
    // A null body takes readCapped's `!body` path; text() yields '' which is
    // not valid JSON, surfacing as bad_response.
    const { fetchImpl } = fetchWith(() => new Response(null, { status: 200 }))
    await expect(makeProvider(fetchImpl).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_bad_response' })
  })

  it('tolerates empty chunks while streaming the body', async () => {
    // A stream that yields a zero-length chunk exercises readCapped's falsy-chunk
    // branch before the real payload.
    const payload = new TextEncoder().encode('[]')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(0))
        controller.enqueue(payload)
        controller.close()
      },
    })
    const { fetchImpl } = fetchWith(() => new Response(stream, { status: 200 }))
    await expect(makeProvider(fetchImpl).geocode('q', 5, signal())).resolves.toEqual([])
  })

  it('maps an oversized body to too_large', async () => {
    const big = JSON.stringify({ places: new Array(1000).fill({ name: 'x', lat: 0, lon: 0 }) })
    const { fetchImpl } = fetchWith(new Response(big, { status: 200 }))
    await expect(makeProvider(fetchImpl, { maxResponseBytes: 8 }).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_too_large' })
  })

  it('maps a fetch rejection to unreachable', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
    await expect(makeProvider(fetchImpl).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_unreachable' })
  })

  it('maps a blocked target to blocked_target (private resolver, disallowed)', async () => {
    const { fetchImpl } = fetchWith(() => jsonResponse([]))
    const provider = makeProvider(fetchImpl, {
      allowPrivateSources: false,
      resolver: privateResolver(),
    })
    await expect(provider.geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_blocked_target' })
  })

  it('maps a non-TargetPolicyError guard failure to blocked_target', async () => {
    const { fetchImpl } = fetchWith(() => jsonResponse([]))
    const resolver: TargetResolver = async () => { throw { weird: true } as unknown as Error }
    // A thrown non-Error from the resolver surfaces as DNS_UNAVAILABLE inside
    // validateTarget (a TargetPolicyError), still mapped to blocked_target.
    const provider = makeProvider(fetchImpl, { resolver })
    await expect(provider.geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_blocked_target' })
  })

  it('validates the origin only once across calls', async () => {
    const resolver = vi.fn(publicResolver)
    const { fetchImpl } = fetchWith(() => jsonResponse([]))
    const provider = makeProvider(fetchImpl, { resolver })
    await provider.geocode('a', 5, signal())
    await provider.geocode('b', 5, signal())
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('rejects (unreachable) when the caller aborts during the request', async () => {
    const controller = new AbortController()
    // The provider forwards a caller abort onto the request signal; rejecting
    // on that abort surfaces as unreachable.
    const fetchImpl: typeof fetch = async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) })
        controller.abort()
      })
    await expect(makeProvider(fetchImpl).geocode('q', 5, controller.signal))
      .rejects.toMatchObject({ code: 'geo_bff_unreachable' })
  })

  it('aborts the request when the timeout fires', async () => {
    const fetchImpl: typeof fetch = async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) })
      })
    await expect(makeProvider(fetchImpl, { timeoutMs: 5 }).geocode('q', 5, signal()))
      .rejects.toMatchObject({ code: 'geo_bff_unreachable' })
  })
})
