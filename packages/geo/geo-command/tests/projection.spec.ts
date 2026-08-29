/**
 * The `geoCommand` projection provider: mounting geo-command beside the session
 * projection registry serves the latest geo view command on the history tail
 * page (the same wire the client Earth bridge reads via useProjection). Before
 * any command the value is a zero-seq null command; each `geo/command` event
 * advances `seq` and replaces `command` last-wins; a composition without
 * geo-command has no `geoCommand` key; unmounting removes it (HMR safety). The
 * carrier and framework are exercised unmodified.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import * as GeoCommand from '@deepseek-ai/dsh-geo-command'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`geo-proj-${String(nextRpc++)}`), payload }
}

interface Bench {
  ctx: Context
  session: Session
  tailProjections(): Promise<{ asOfSeq: number; values: Record<string, unknown> } | undefined>
}

async function harness(withGeoCommand: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withGeoCommand) await ctx.plugin(GeoCommand)
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return {
    ctx,
    session,
    async tailProjections() {
      const response = await api.sessions.history(request({ sessionId: session.id }))
      if (!response.result.ok) throw new Error('history failed')
      return response.result.value.projections
    },
  }
}

/** One paginable message so the tail page is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('geoCommand projection provider', () => {
  it('serves a zero-seq null command before the first geo/command', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections?.values.geoCommand).toEqual({ seq: 0, command: null, enabledDomains: [], features: [] })
  })

  it('advances seq and replaces the command last-wins', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', { kind: 'camera', lat: 35.68, lon: 139.65, height: 500000 })
    session.append('geo/command', { kind: 'basemap', id: 'esri-satellite' })
    const projections = await bench.tailProjections()
    expect(projections?.values.geoCommand).toEqual({
      seq: 2,
      command: { kind: 'basemap', id: 'esri-satellite' },
      enabledDomains: [],
      features: [],
    })
    expect(projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('has no geoCommand key when geo-command is not composed', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections).toBeDefined()
    expect('geoCommand' in (projections?.values ?? {})).toBe(false)
  })

  it('drops the key when the geo-command fiber unloads (HMR safety)', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const fiber = await bench.ctx.plugin(GeoCommand)
    expect((await bench.tailProjections())?.values.geoCommand).toEqual({ seq: 0, command: null, enabledDomains: [], features: [] })
    await fiber.dispose()
    expect('geoCommand' in ((await bench.tailProjections())?.values ?? {})).toBe(false)
  })
})

describe('geoCommand accumulating fold', () => {
  it('toggles domain layers on and off, keeping first-enabled order', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', { kind: 'domain-toggle', domain: 'airports', on: true })
    session.append('geo/command', { kind: 'domain-toggle', domain: 'roads', on: true })
    session.append('geo/command', { kind: 'domain-toggle', domain: 'airports', on: true })
    session.append('geo/command', { kind: 'domain-toggle', domain: 'roads', on: false })
    const state = (await bench.tailProjections())?.values.geoCommand
    expect(state).toEqual({
      seq: 4,
      command: { kind: 'domain-toggle', domain: 'roads', on: false },
      enabledDomains: ['airports'],
      features: [],
    })
  })

  it('accumulates drawn features and applies move, rename, delete, and undo', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', { kind: 'draw-feature', id: 'feat-1', geometry: { type: 'point', coordinates: [-74, 40.7] } })
    session.append('geo/command', {
      kind: 'draw-feature',
      id: 'feat-2',
      geometry: { type: 'polyline', coordinates: [[-74, 40.7], [-73.9, 40.8]] },
    })
    session.append('geo/command', {
      kind: 'draw-feature',
      id: 'feat-3',
      geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] },
    })
    session.append('geo/command', { kind: 'move-feature', id: 'feat-1', dLon: 1, dLat: -0.5 })
    session.append('geo/command', { kind: 'move-feature', id: 'feat-2', dLon: 0.1, dLat: 0.1 })
    session.append('geo/command', { kind: 'set-feature-props', id: 'feat-1', name: 'Dock' })
    session.append('geo/command', { kind: 'delete-features', ids: ['feat-3'] })
    session.append('geo/command', { kind: 'undo-draw' })
    const state = (await bench.tailProjections())?.values.geoCommand as { features: unknown[]; enabledDomains: unknown[] }
    expect(state.enabledDomains).toEqual([])
    expect(state.features).toEqual([
      { id: 'feat-1', geometry: { type: 'point', coordinates: [-73, 40.2] }, name: 'Dock' },
    ])
  })

  it('leaves features unchanged for a move or rename of an unknown id', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', { kind: 'draw-feature', id: 'feat-1', geometry: { type: 'point', coordinates: [-74, 40.7] } })
    session.append('geo/command', { kind: 'move-feature', id: 'other', dLon: 5, dLat: 5 })
    session.append('geo/command', { kind: 'set-feature-props', id: 'other', name: 'X' })
    const state = (await bench.tailProjections())?.values.geoCommand as { features: unknown[] }
    expect(state.features).toEqual([{ id: 'feat-1', geometry: { type: 'point', coordinates: [-74, 40.7] } }])
  })

  it('shifts a polygon feature by the given delta', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', {
      kind: 'draw-feature',
      id: 'poly',
      geometry: { type: 'polygon', coordinates: [[0, 0], [2, 0], [2, 2]] },
    })
    session.append('geo/command', { kind: 'move-feature', id: 'poly', dLon: 1, dLat: 1 })
    const state = (await bench.tailProjections())?.values.geoCommand as { features: unknown[] }
    expect(state.features).toEqual([
      { id: 'poly', geometry: { type: 'polygon', coordinates: [[1, 1], [3, 1], [3, 3]] } },
    ])
  })
})
