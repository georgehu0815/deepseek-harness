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

  it('geo_geocode resolves through a stub provider on ctx.geo', async () => {
    const ctx = await boot()
    ctx.geo.registerProvider({
      id: 'stub',
      geocode: () => Promise.resolve([{ name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, kind: 'city' }]),
    })
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('geocode'),
      name: 'geo_geocode',
      arguments: { query: 'Tokyo' },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('Tokyo')
    expect(resultText(result)).toContain('35.67')
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
})
