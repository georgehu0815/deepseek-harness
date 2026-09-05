/**
 * The geo segmentation seam offline: `resolve` applies the documented defaults,
 * `segment` refuses with no provider and delegates to a registered one, the
 * `SamGeoProvider` builds the multipart `/segment/geo` call and maps a canned
 * reply through injected fetch, and the `segment_view` tool draws one unique-id
 * `geo/command` polygon per detection from a seeded camera view. No network.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SegmentRuntime from '../src/index.ts'
import { SamGeoProvider, buildFormData, buildImageryUrl } from '../src/provider-samgeo.ts'
import type { FetchImpl } from '../src/provider-samgeo.ts'
import { bboxFromEvents } from '../src/tool.ts'
import * as SegmentTool from '../src/tool.ts'
import type { SegmentFeatureCollection, SegmentProvider, SegmentSpec } from '../src/types.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SegmentInvariant from '../src/invariant.ts'

const BBOX = { west: -74.02, south: 40.70, east: -73.98, north: 40.74 }

/** A canned two-feature FeatureCollection the fakes return. */
const CANNED: SegmentFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-74.0, 40.71], [-73.99, 40.71], [-73.99, 40.72], [-74.0, 40.71]]] },
      properties: { score: 0.9, prompt: 'building' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-74.01, 40.72], [-74.0, 40.72], [-74.0, 40.73], [-74.01, 40.72]]] },
      properties: { score: 0.8, prompt: 'building' },
    },
  ],
}

/** A fake provider returning the canned collection. */
class FakeProvider implements SegmentProvider {
  readonly id = 'fake'
  lastSpec: SegmentSpec | undefined
  segment(spec: SegmentSpec): Promise<SegmentFeatureCollection> {
    this.lastSpec = spec
    return Promise.resolve(CANNED)
  }
}

/** Compose a context carrying the segmentation seam. */
async function seamCtx(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SegmentRuntime)
  return ctx
}

/** Build a registered owning agent for tool execution. */
function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('segment-agent')
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

describe('SegmentRuntime.resolve', () => {
  it('applies the documented defaults', async () => {
    const ctx = await seamCtx()
    expect(ctx.segment.resolve({ bbox: BBOX })).toEqual({
      bbox: BBOX,
      prompt: 'building',
      geometry: 'mask',
      confidenceThreshold: 0.25,
    })
  })

  it('keeps explicit request fields', async () => {
    const ctx = await seamCtx()
    expect(ctx.segment.resolve({ bbox: BBOX, prompt: 'house', geometry: 'box', confidenceThreshold: 0.7, imageUrl: 'u' })).toEqual({
      bbox: BBOX,
      prompt: 'house',
      geometry: 'box',
      confidenceThreshold: 0.7,
      imageUrl: 'u',
    })
  })
})

describe('SegmentRuntime.segment', () => {
  it('throws when no provider is registered', async () => {
    const ctx = await seamCtx()
    await expect(ctx.segment.segment({ bbox: BBOX })).rejects.toThrow('geo-segment: no segmentation provider registered')
  })

  it('delegates to the active provider and returns its collection', async () => {
    const ctx = await seamCtx()
    const provider = new FakeProvider()
    const dispose = ctx.segment.registerProvider(provider)
    const result = await ctx.segment.segment({ bbox: BBOX })
    expect(result).toBe(CANNED)
    expect(provider.lastSpec).toEqual({ bbox: BBOX, prompt: 'building', geometry: 'mask', confidenceThreshold: 0.25 })
    dispose()
    await expect(ctx.segment.segment({ bbox: BBOX })).rejects.toThrow('no segmentation provider registered')
  })
})

describe('SamGeoProvider', () => {
  it('builds the multipart call and maps a canned reply', async () => {
    const spec: SegmentSpec = {
      bbox: BBOX, prompt: 'building', geometry: 'mask', confidenceThreshold: 0.5, imageUrl: 'http://img/view.png',
    }
    const calls: { url: string; method: string; body?: FormData }[] = []
    const fakeFetch: FetchImpl = (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', ...(init?.body === undefined ? {} : { body: init.body as FormData }) })
      if (url === spec.imageUrl) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
          blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob()),
        text: () => Promise.resolve(JSON.stringify(CANNED)),
      })
    }
    const provider = new SamGeoProvider({ baseUrl: 'http://backend/' }, fakeFetch)
    const result = await provider.segment(spec)

    expect(result.features).toHaveLength(2)
    expect(result.type).toBe('FeatureCollection')
    expect(calls[0]?.url).toBe('http://img/view.png')
    expect(calls[1]?.url).toBe('http://backend/segment/geo')
    expect(calls[1]?.method).toBe('POST')
    const form = calls[1]?.body
    expect(form?.get('prompt')).toBe('building')
    expect(form?.get('bbox')).toBe('-74.02,40.7,-73.98,40.74')
    expect(form?.get('geometry')).toBe('mask')
    expect(form?.get('confidence_threshold')).toBe('0.5')
    expect(form?.get('file')).toBeInstanceOf(Blob)
  })

  it('synthesizes a bbox imagery URL from the default template when no imageUrl is given', async () => {
    const spec: SegmentSpec = { bbox: BBOX, prompt: 'building', geometry: 'mask', confidenceThreshold: 0.5 }
    const calls: string[] = []
    const fakeFetch: FetchImpl = (url, init) => {
      calls.push(url)
      return (init?.method ?? 'GET') === 'GET'
        ? Promise.resolve({
          ok: true, status: 200, text: () => Promise.resolve(''),
          blob: () => Promise.resolve(new Blob([new Uint8Array([1])])),
        })
        : Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(new Blob()),
          text: () => Promise.resolve(JSON.stringify(CANNED)),
        })
    }
    const provider = new SamGeoProvider({ baseUrl: 'http://backend' }, fakeFetch)
    await provider.segment(spec)

    expect(calls[0]).toContain('server.arcgisonline.com')
    expect(calls[0]).toContain('bbox=-74.02,40.7,-73.98,40.74')
    expect(calls[0]).toContain('size=1024,1024')
    expect(calls[1]).toBe('http://backend/segment/geo')
  })

  it('fills every placeholder in a custom imagery template', () => {
    const url = buildImageryUrl(
      '{west}/{south}/{east}/{north}/{width}x{height}',
      BBOX,
      512,
      256,
    )
    expect(url).toBe('-74.02/40.7/-73.98/40.74/512x256')
  })

  it('throws without an image source when the imagery template is empty', async () => {
    const provider = new SamGeoProvider(
      { baseUrl: 'http://backend', imageryUrlTemplate: '' },
      (() => Promise.reject(new Error('unused'))) as unknown as FetchImpl,
    )
    await expect(provider.segment({ bbox: BBOX, prompt: 'building', geometry: 'mask', confidenceThreshold: 0.5 }))
      .rejects.toThrow('no raster source')
  })

  it('throws on a non-200 backend reply', async () => {
    const spec: SegmentSpec = {
      bbox: BBOX, prompt: 'building', geometry: 'mask', confidenceThreshold: 0.5, imageUrl: 'http://img/view.png',
    }
    const fakeFetch: FetchImpl = url => url === spec.imageUrl
      ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), blob: () => Promise.resolve(new Blob()) })
      : Promise.resolve({ ok: false, status: 503, blob: () => Promise.resolve(new Blob()), text: () => Promise.resolve('backend down') })
    const provider = new SamGeoProvider({ baseUrl: 'http://backend' }, fakeFetch)
    await expect(provider.segment(spec)).rejects.toThrow('segment failed (503): backend down')
  })

  it('buildFormData composes the documented fields', () => {
    const form = buildFormData({ bbox: BBOX, prompt: 'house', geometry: 'box', confidenceThreshold: 0.25 }, new Blob())
    expect(form.get('prompt')).toBe('house')
    expect(form.get('geometry')).toBe('box')
    expect(form.get('confidence_threshold')).toBe('0.25')
  })
})

describe('bboxFromEvents', () => {
  it('prefers an explicit geo/view bbox', () => {
    const events = [{ type: 'geo/view', data: { bbox: BBOX, pose: { lat: 0, lon: 0, height: 1 } } }]
    expect(bboxFromEvents(events)).toEqual(BBOX)
  })

  it('derives a bbox from a geo/command camera pose when no bbox is logged', () => {
    const events = [{ type: 'geo/command', data: { kind: 'camera', lat: 40, lon: -74, height: 222_000 } }]
    const bbox = bboxFromEvents(events)
    expect(bbox?.west).toBeCloseTo(-75, 5)
    expect(bbox?.east).toBeCloseTo(-73, 5)
  })

  it('returns undefined without any geo event', () => {
    expect(bboxFromEvents([{ type: 'user/message', data: {} }])).toBeUndefined()
  })
})

describe('segment_view tool', () => {
  async function toolCtx(): Promise<{ tools: Context['tools']; owner: Agent }> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SegmentRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.segment.registerProvider(new FakeProvider())
    await ctx.plugin(SegmentTool)
    const tools = ctx.reflect.get('tools')
    if (tools === undefined) throw new Error('tools service missing')
    return { tools, owner: agent(ctx) }
  }

  it('draws one unique-id polygon per detection in the current view', async () => {
    const { tools, owner } = await toolCtx()
    owner.session.append('geo/command', { kind: 'camera', lat: 40.72, lon: -74.0, height: 5_000 })

    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('seg-1'),
      name: 'segment_view',
      arguments: {},
      agent: owner,
    })
    expect(result.isError).toBe(false)

    const drawn = owner.session.events.filter(e => e.type === 'geo/command' && (e.data as { kind: string }).kind === 'draw-feature')
    expect(drawn).toHaveLength(2)
    const ids = drawn.map(e => (e.data as { id: string }).id)
    expect(new Set(ids).size).toBe(2)
    expect((drawn[0]?.data as { geometry: { type: string } }).geometry.type).toBe('polygon')
    // Each drawn feature is tagged with the segmentation prompt as its type.
    expect((drawn[0]?.data as { featureType?: string }).featureType).toBe('building')
    expect((drawn[1]?.data as { featureType?: string }).featureType).toBe('building')
    expect(result.content.map(b => ('text' in b ? b.text : '')).join('')).toContain("Segmented 2 features for 'building'")
  })

  it('honors maxFeatures', async () => {
    const { tools, owner } = await toolCtx()
    owner.session.append('geo/command', { kind: 'camera', lat: 40.72, lon: -74.0, height: 5_000 })
    await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('seg-2'),
      name: 'segment_view',
      arguments: { maxFeatures: 1 },
      agent: owner,
    })
    const drawn = owner.session.events.filter(e => e.type === 'geo/command' && (e.data as { kind: string }).kind === 'draw-feature')
    expect(drawn).toHaveLength(1)
  })

  it('rejects when no view has been established', async () => {
    const { tools, owner } = await toolCtx()
    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('seg-3'),
      name: 'segment_view',
      arguments: {},
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(b => ('text' in b ? b.text : '')).join('')).toContain('no current view')
  })

  it('rejects a missing owning agent', async () => {
    const { tools, owner } = await toolCtx()
    void owner
    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: CallId('seg-4'),
      name: 'segment_view',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(b => ('text' in b ? b.text : '')).join('')).toContain('requires an owning agent session')
  })
})

describe('geo-segment invariant companion', () => {
  it('exposes companion metadata', () => {
    expect(SegmentInvariant.name).toBe('geo-segment-invariant')
    expect(SegmentInvariant.inject).toEqual(['invariants'])
  })

  it('loads and unloads as a plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(SegmentInvariant)
    await fiber.dispose()
  })
})
