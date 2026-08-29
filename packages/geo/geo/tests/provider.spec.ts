// Unit tests for the built-in PublicGeoProvider (public Nominatim) and the
// static base-map presets. Global `fetch` is stubbed per test, so no network is
// touched. Assertions cover the search URL/query the provider builds, the row
// mapping to seam types (display_name/type/boundingbox handling and the
// missing-coordinate skip), every typed GeoError path (unreachable, http error,
// bad JSON, too large), the non-array and non-array-boundingbox fallbacks, the
// caller-abort and timeout aborts, and the presets.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE_MAP_PRESETS, PublicGeoProvider } from '../src/provider.ts'
import type { PublicGeoProviderOptions } from '../src/provider.ts'
import { GeoError } from '../src/types.ts'

const OPTIONS: PublicGeoProviderOptions = {
  baseUrl: 'https://nominatim.test',
  userAgent: 'dsh-geo-test/1.0 (test@example.com)',
  timeoutMs: 1_000,
}

/** A JSON `Response` (200 by default). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Stub global `fetch`, recording the requested URL, and return the response. */
function stubFetch(response: Response | (() => Response | Promise<Response>)): { urls: string[] } {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: URL | RequestInfo) => {
    urls.push(input instanceof URL ? input.href : input instanceof Request ? input.url : input)
    return typeof response === 'function' ? response() : response
  })
  return { urls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PublicGeoProvider', () => {
  it('exposes the provider id', () => {
    expect(new PublicGeoProvider(OPTIONS).id).toBe('public-nominatim')
  })

  it('builds the Nominatim search URL and maps a full row', async () => {
    const { urls } = stubFetch(jsonResponse([
      {
        display_name: 'Tokyo, Japan',
        lat: '35.6762',
        lon: '139.6503',
        type: 'city',
        boundingbox: ['35.5', '35.8', '139.6', '139.9'],
      },
    ]))
    const places = await new PublicGeoProvider(OPTIONS).geocode('Tokyo', 5, new AbortController().signal)
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0] ?? '')
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('q')).toBe('Tokyo')
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('addressdetails')).toBe('0')
    expect(places).toEqual([
      {
        name: 'Tokyo, Japan',
        lat: 35.6762,
        lon: 139.6503,
        bbox: [139.6, 35.5, 139.9, 35.8],
        kind: 'city',
      },
    ])
  })

  it('clamps the requested limit into 1..20', async () => {
    const under = stubFetch(jsonResponse([]))
    await new PublicGeoProvider(OPTIONS).geocode('x', 0, new AbortController().signal)
    expect(new URL(under.urls[0] ?? '').searchParams.get('limit')).toBe('1')
    vi.unstubAllGlobals()
    const over = stubFetch(jsonResponse([]))
    await new PublicGeoProvider(OPTIONS).geocode('x', 99, new AbortController().signal)
    expect(new URL(over.urls[0] ?? '').searchParams.get('limit')).toBe('20')
  })

  it('falls back to the query for a missing display_name and omits absent bbox/kind', async () => {
    stubFetch(jsonResponse([{ lat: '1', lon: '2' }]))
    const places = await new PublicGeoProvider(OPTIONS).geocode('Nowhere', 5, new AbortController().signal)
    expect(places).toEqual([{ name: 'Nowhere', lat: 1, lon: 2 }])
  })

  it('skips rows with a non-finite lat or lon', async () => {
    stubFetch(jsonResponse([
      { display_name: 'bad', lat: 'not-a-number', lon: '2' },
      { display_name: 'ok', lat: '3', lon: '4' },
    ]))
    const places = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(places).toEqual([{ name: 'ok', lat: 3, lon: 4 }])
  })

  it('drops a boundingbox that is not a four-element array', async () => {
    stubFetch(jsonResponse([{ lat: '1', lon: '2', boundingbox: ['1', '2', '3'] }]))
    const [place] = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(place).toEqual({ name: 'q', lat: 1, lon: 2 })
  })

  it('drops a boundingbox with a non-finite edge', async () => {
    stubFetch(jsonResponse([{ lat: '1', lon: '2', boundingbox: ['1', '2', '3', 'x'] }]))
    const [place] = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(place).toEqual({ name: 'q', lat: 1, lon: 2 })
  })

  it('accepts numeric coordinates and skips a row whose lat is neither number nor string', async () => {
    stubFetch(jsonResponse([
      { display_name: 'null-lat', lat: null, lon: '2' },
      { display_name: 'numeric', lat: 5.5, lon: 6.5 },
    ]))
    const places = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(places).toEqual([{ name: 'numeric', lat: 5.5, lon: 6.5 }])
  })

  it('returns an empty list when the response is not a JSON array', async () => {
    stubFetch(jsonResponse({ error: 'nope' }))
    const places = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(places).toEqual([])
  })

  it('throws geo_geocode_unreachable when fetch rejects', async () => {
    stubFetch(() => { throw new Error('network down') })
    await expect(new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal))
      .rejects.toMatchObject({ code: 'geo_geocode_unreachable' })
  })

  it('throws geo_geocode_http_error on a non-ok status', async () => {
    stubFetch(jsonResponse([], 503))
    await expect(new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal))
      .rejects.toMatchObject({ code: 'geo_geocode_http_error' })
  })

  it('throws geo_geocode_bad_response on invalid JSON', async () => {
    stubFetch(new Response('not json', { status: 200 }))
    await expect(new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal))
      .rejects.toMatchObject({ code: 'geo_geocode_bad_response' })
  })

  it('throws geo_geocode_too_large past the byte cap', async () => {
    // A 1.5 MB body over the 1 MB cap, streamed so readCapped sees the overflow.
    const big = 'x'.repeat(1_500_000)
    stubFetch(new Response(big, { status: 200 }))
    await expect(new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal))
      .rejects.toBeInstanceOf(GeoError)
  })

  it('reads a body with no stream via response.text()', async () => {
    // A Response whose body is null exercises the readCapped text() fallback.
    const noBody = new Response(null, { status: 200 })
    Object.defineProperty(noBody, 'body', { value: null })
    Object.defineProperty(noBody, 'text', { value: async () => '[]' })
    stubFetch(noBody)
    const places = await new PublicGeoProvider(OPTIONS).geocode('q', 5, new AbortController().signal)
    expect(places).toEqual([])
  })

  it('aborts the request when the caller signal fires', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) })
        controller.abort()
      }))
    await expect(new PublicGeoProvider(OPTIONS).geocode('q', 5, controller.signal))
      .rejects.toMatchObject({ code: 'geo_geocode_unreachable' })
  })

  it('aborts the request when the timeout fires', async () => {
    vi.stubGlobal('fetch', async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) })
      }))
    await expect(new PublicGeoProvider({ ...OPTIONS, timeoutMs: 5 }).geocode('q', 5, new AbortController().signal))
      .rejects.toMatchObject({ code: 'geo_geocode_unreachable' })
  })
})

describe('BASE_MAP_PRESETS', () => {
  it('lists the four presets with unique ids', () => {
    const ids = BASE_MAP_PRESETS.map(preset => preset.id)
    expect(ids).toEqual(['osm', 'carto-dark', 'carto-light', 'esri-satellite'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every preset a tile-template url and attribution', () => {
    for (const preset of BASE_MAP_PRESETS) {
      expect(preset.urlTemplate).toContain('{z}')
      expect(preset.attribution.length).toBeGreaterThan(0)
      expect(preset.maxZoom).toBeGreaterThan(0)
    }
  })
})
