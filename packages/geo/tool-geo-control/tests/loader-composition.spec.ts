// Real Loader composition for the geo tool plugins: boots a cordis.yml carrying
// the geo seam, the geoCommand projection, and both geo tool packages through
// the real Loader, then proves the four tools are offered and that executing
// them produces the model-visible results and durable geo/command events the
// Earth view consumes. Geocode uses a stub provider registered on ctx.geo so
// the test needs no network; the base-map, camera, and projection paths are
// exercised end to end.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import GeoRuntime from '@deepseek-ai/dsh-geo'
import * as GeoCommand from '@deepseek-ai/dsh-geo-command'
import * as ToolGeoQuery from '@deepseek-ai/dsh-tool-geo-query'
import * as ToolGeoControl from '@deepseek-ai/dsh-tool-geo-control'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('geo-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const concurrencyArgs: Record<string, unknown> = {
  geo_geocode: { query: 'Tokyo' },
  geo_list_basemaps: {},
  geo_catalog_search: { query: 'terrain' },
  geo_domain_list: {},
  geo_domain_query: { domain: 'cities', bbox: [0, 0, 1, 1] },
  geo_feature_get: { domain: 'cities', id: 'city-1' },
}

/**
 * Boot a cordis.yml composing the geo seam, projection, and both tool packages.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-geo-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-geo'",
    "- name: '@deepseek-ai/dsh-geo-command'",
    "- name: '@deepseek-ai/dsh-tool-geo-query'",
    "- name: '@deepseek-ai/dsh-tool-geo-control'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-geo', GeoRuntime],
    ['@deepseek-ai/dsh-geo-command', GeoCommand],
    ['@deepseek-ai/dsh-tool-geo-query', ToolGeoQuery],
    ['@deepseek-ai/dsh-tool-geo-control', ToolGeoControl],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('geo tools real Loader composition through cordis.yml', () => {
  it('offers the four geo tools to the model', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('geo_geocode')
    expect(names).toContain('geo_list_basemaps')
    expect(names).toContain('control_camera')
    expect(names).toContain('set_basemap')
  }, 30_000)

  it('geo_list_basemaps returns the seam presets', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('list'),
      name: 'geo_list_basemaps',
      arguments: {},
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('osm')
    expect(resultText(result)).toContain('esri-satellite')
  }, 30_000)

  it('declares model-facing presentation for every geo tool', async () => {
    const ctx = await boot()
    expect(ctx.tools.get('geo_geocode')?.presentCall?.({ query: 'Tokyo' })?.title).toBe('Geocode "Tokyo"')
    expect(ctx.tools.get('geo_list_basemaps')?.presentCall?.({})?.title).toBe('List base maps')
    expect(ctx.tools.get('control_camera')?.presentCall?.({ lat: 1, lon: 2 })?.title).toBe('Move camera to 1, 2')
    expect(ctx.tools.get('set_basemap')?.presentCall?.({ id: 'osm' })?.title).toBe('Set base map osm')
    expect(ctx.tools.get('geo_catalog_search')?.presentCall?.({ query: 'terrain' })?.title).toBe('Catalog search "terrain"')
    expect(ctx.tools.get('geo_domain_list')?.presentCall?.({})?.title).toBe('List domain layers')
    expect(ctx.tools.get('geo_domain_query')?.presentCall?.({ domain: 'cities', bbox: [0, 0, 1, 1] })?.title).toBe('Query cities features')
    expect(ctx.tools.get('geo_feature_get')?.presentCall?.({ domain: 'cities', id: 'city-1' })?.title).toBe('Get cities feature city-1')
    for (const name of ['geo_geocode', 'geo_list_basemaps', 'geo_catalog_search', 'geo_domain_list', 'geo_domain_query', 'geo_feature_get']) {
      expect(ctx.tools.get(name)?.isConcurrencySafe?.(concurrencyArgs[name])).toBe(true)
    }
  }, 30_000)

  it('renders a defensive label when a found feature has no id', async () => {
    const ctx = await boot()
    expect(ctx.tools.get('geo_feature_get')?.output.render({}, { found: true })[0]).toMatchObject({ text: 'Feature ' })
  }, 30_000)

  it('geo_geocode resolves through a stub provider on ctx.geo', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub',
      geocode: () => Promise.resolve([
        { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, kind: 'city' },
        { name: 'Tokyo Bay', lat: 35.5, lon: 139.8, bbox: [139.5, 35.2, 140.1, 35.8] },
      ]),
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('geocode'),
      name: 'geo_geocode',
      arguments: { query: 'Tokyo', limit: 2 },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('Tokyo')
    expect(resultText(result)).toContain('35.67')
  }, 30_000)

  it('geo_geocode applies its default limit and renders an empty result', async () => {
    const ctx = await boot()
    let receivedLimit: number | undefined
    ctx.geo.registerProvider({
      id: 'stub',
      geocode: (_query, limit) => {
        receivedLimit = limit
        return Promise.resolve([])
      },
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('geocode-empty'),
      name: 'geo_geocode',
      arguments: { query: 'Nowhere', limit: 0 },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(receivedLimit).toBe(5)
    expect(resultText(result)).toBe('No matching place found.')
  }, 30_000)

  it('control_camera appends a camera geo/command and folds the projection', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('camera'),
      name: 'control_camera',
      arguments: { lat: 35.6762, lon: 139.6503, height: 500000 },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    const event = owner.session.events.findLast(e => e.type === 'geo/command')
    expect(event?.data).toEqual({ kind: 'camera', lat: 35.6762, lon: 139.6503, height: 500000 })
  }, 30_000)

  it('control_camera clamps coordinates and defaults an invalid height', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('camera-defaults'),
      name: 'control_camera',
      arguments: { lat: 100, lon: -200, height: 0 },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('90.0000, -180.0000 at 2000000 m')
    expect(owner.session.events.findLast(e => e.type === 'geo/command')?.data)
      .toEqual({ kind: 'camera', lat: 90, lon: -180, height: 2_000_000 })
  }, 30_000)

  it('set_basemap appends a basemap geo/command', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('basemap'),
      name: 'set_basemap',
      arguments: { id: 'esri-satellite' },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    const event = owner.session.events.findLast(e => e.type === 'geo/command')
    expect(event?.data).toEqual({ kind: 'basemap', id: 'esri-satellite' })
  }, 30_000)

  it('set_basemap rejects missing ownership and a blank id', async () => {
    const ctx = await boot()
    const missingOwner = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('basemap-no-agent'),
      name: 'set_basemap',
      arguments: { id: 'osm' },
    })
    expect(missingOwner.isError).toBe(true)
    expect(resultText(missingOwner)).toContain('requires an owning agent session')

    const blank = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('basemap-blank'),
      name: 'set_basemap',
      arguments: { id: '   ' },
      agent: agent(ctx),
    })
    expect(blank.isError).toBe(true)
    expect(resultText(blank)).toContain('requires a non-empty base-map id')
  }, 30_000)

  it('control_camera without an owning agent is rejected', async () => {
    const ctx = await boot()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('no-agent'),
      name: 'control_camera',
      arguments: { lat: 0, lon: 0 },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('requires an owning agent session')
  }, 30_000)

  it('offers the four domain read tools to the model', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('geo_catalog_search')
    expect(names).toContain('geo_domain_list')
    expect(names).toContain('geo_domain_query')
    expect(names).toContain('geo_feature_get')
  }, 30_000)

  it('geo_catalog_search returns entries from a domain provider', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      catalogSearch: () => Promise.resolve([
        { id: 'terra:imagery', title: 'Terra base imagery', kind: 'imagery', bbox: [-180, -90, 180, 90] },
        { id: 'terra:terrain', title: 'Terra terrain' },
      ]),
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('catalog'),
      name: 'geo_catalog_search',
      arguments: { query: 'imagery', limit: 2 },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('terra:imagery')
    expect(resultText(result)).toContain('Terra base imagery')
  }, 30_000)

  it('geo_catalog_search applies its default limit and renders an empty result', async () => {
    const ctx = await boot()
    let receivedLimit: number | undefined
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      catalogSearch: (_query, limit) => {
        receivedLimit = limit
        return Promise.resolve([])
      },
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('catalog-empty'),
      name: 'geo_catalog_search',
      arguments: { query: 'missing', limit: -1 },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(receivedLimit).toBe(10)
    expect(resultText(result)).toBe('No matching catalog entry found.')
  }, 30_000)

  it('geo_domain_query fetches features inside a bbox at a level of detail', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      domainQuery: (domain, viewport) => Promise.resolve({
        domain,
        lod: viewport.lod,
        limited: false,
        features: [
          { id: 'ap-1', domain, geometry: { type: 'Point', coordinates: [139.78, 35.55] }, properties: { name: 'HND' } },
        ],
      }),
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('domain-query'),
      name: 'geo_domain_query',
      arguments: { domain: 'airports', bbox: [139, 35, 140, 36], lod: 'local' },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('1 airports feature(s) at local detail')
  }, 30_000)

  it('geo_domain_query defaults detail and reports capped results', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      domainQuery: (domain, viewport) => Promise.resolve({
        domain,
        lod: viewport.lod,
        limited: true,
        features: [],
      }),
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('domain-defaults'),
      name: 'geo_domain_query',
      arguments: { domain: 'cities', bbox: [-1, -2, 3, 4] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toBe('0 cities feature(s) at regional detail (capped).')
  }, 30_000)

  it('geo_domain_query rejects unknown detail and malformed bounds', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      domainQuery: (domain, viewport) => Promise.resolve({ domain, lod: viewport.lod, limited: false, features: [] }),
    })
    const owner = agent(ctx)
    const unknownLod = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('bad-lod'),
      name: 'geo_domain_query',
      arguments: { domain: 'cities', bbox: [0, 0, 1, 1], lod: 'street' },
      agent: owner,
    })
    expect(resultText(unknownLod)).toContain("unknown lod 'street'")

    const malformedBBox = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('bad-bbox'),
      name: 'geo_domain_query',
      arguments: { domain: 'cities', bbox: [0, 0, 1] },
      agent: owner,
    })
    expect(resultText(malformedBBox)).toContain('bbox must be four finite numbers')
  }, 30_000)

  it('geo_domain_query rejects an unknown domain before reaching the provider', async () => {
    const ctx = await boot()
    let called = false
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      domainQuery: (domain, viewport) => {
        called = true
        return Promise.resolve({ domain, lod: viewport.lod, limited: false, features: [] })
      },
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('bad-domain'),
      name: 'geo_domain_query',
      arguments: { domain: 'volcanoes', bbox: [0, 0, 1, 1] },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain("unknown domain 'volcanoes'")
    expect(called).toBe(false)
  }, 30_000)

  it('geo_feature_get returns one feature, and reports absence', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      featureGet: (domain, id) => Promise.resolve(
        id === 'ap-1'
          ? { id, domain, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
          : null,
      ),
    })
    const owner = agent(ctx)
    const found = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('feat-hit'),
      name: 'geo_feature_get',
      arguments: { domain: 'airports', id: 'ap-1' },
      agent: owner,
    })
    expect(found.isError).toBe(false)
    expect(resultText(found)).toContain('ap-1')
    const missing = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('feat-miss'),
      name: 'geo_feature_get',
      arguments: { domain: 'airports', id: 'nope' },
      agent: owner,
    })
    expect(missing.isError).toBe(false)
    expect(resultText(missing)).toContain('No such feature')
  }, 30_000)

  it('geo_domain_list reports the layers a domain provider serves', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub-domain',
      geocode: () => Promise.resolve([]),
      domainList: () => Promise.resolve([
        { id: 'airports', title: 'Airports', geometryKind: 'point', available: true },
        { id: 'roads', title: 'Roads', geometryKind: 'line', available: false },
      ]),
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('domain-list'),
      name: 'geo_domain_list',
      arguments: {},
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('airports (point)')
    expect(resultText(result)).toContain('roads (line) — no data')
  }, 30_000)

  it('a domain tool reports unavailability on the geocoding-only default provider', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('unsupported'),
      name: 'geo_domain_list',
      arguments: {},
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('does not support')
    expect(resultText(result)).toContain('domain-data provider')
  }, 30_000)
})
