import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-geo-command'
import type {} from '@deepseek-ai/dsh-geo-view'
import * as GeoViewContext from '../src/index.ts'

const BASE = Date.parse('2026-08-29T00:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BASE)
})

afterEach(() => {
  vi.useRealTimers()
})

async function mount(config: GeoViewContext.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(GeoViewContext, config)
  return { ctx, fiber }
}

function sessionAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function fire(
  ctx: Context,
  agent: Agent,
  terminal: PreStepDecision = { kind: 'enter', messages: [] },
  signal: AbortSignal = new AbortController().signal,
): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve(terminal),
  )
}

function commitInjected(session: Session, decision: PreStepDecision): void {
  if (decision.kind !== 'enter') return
  for (const message of decision.messages) session.append('user/message', message, { surfaceOp: 'append' })
}

function camera(session: Session, lat = 40, lon = -74, height = 15_000): void {
  session.append('geo/command', { kind: 'camera', lat, lon, height })
}

/** Append a browser-reported live view with a real on-screen bbox. */
function reportView(session: Session): void {
  session.append('geo/view', {
    source: 'user',
    pose: { lat: 51.5, lon: -0.12, height: 8_000 },
    bbox: { west: -0.2, south: 51.45, east: -0.04, north: 51.55 },
  })
}

describe('geo-viewcontext', () => {
  it('exposes plugin metadata and rejects invalid refresh intervals', async () => {
    expect(GeoViewContext.name).toBe('geo-viewcontext')
    expect(GeoViewContext.inject).toEqual(['agents'])
    expect(GeoViewContext.Config).toBeDefined()

    for (const refreshIntervalMs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const ctx = new Context()
      await ctx.plugin(AgentRegistry)
      await expect(ctx.plugin(GeoViewContext, { refreshIntervalMs })).rejects.toThrow(
        'geo-viewcontext: refreshIntervalMs must be a non-negative safe integer',
      )
      await ctx.fiber.dispose()
    }
  })

  it('preserves rejection and abort decisions without injecting', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('blocked'))
    camera(session)
    const owner = sessionAgent(session)

    await expect(fire(ctx, owner, { kind: 'reject' })).resolves.toEqual({
      kind: 'reject',
    })
    const controller = new AbortController()
    controller.abort()
    await expect(fire(ctx, owner, { kind: 'enter', messages: [] }, controller.signal)).resolves.toEqual({
      kind: 'enter',
      messages: [],
    })
  })

  it('does not inject before the camera has been positioned', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('no-camera'))
    session.append('geo/command', { kind: 'basemap', id: 'osm' })
    expect(await fire(ctx, sessionAgent(session))).toEqual({ kind: 'enter', messages: [] })
  })

  it('injects the latest camera pose after later non-camera commands', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('latest-camera'))
    camera(session, 10, 20, 30_000)
    camera(session, 11, 21, 40_000)
    session.append('geo/command', { kind: 'basemap', id: 'osm' })

    const decision = await fire(ctx, sessionAgent(session), {
      kind: 'enter',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'existing' }], source: { kind: 'user' } })],
    })
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const injected = decision.messages[1]?.content ?? []
    const texts = injected
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
    expect(texts.join('\n')).toContain('latitude 11, longitude 21')
    expect(decision.messages[1]?.source).toMatchObject({ kind: 'plugin', plugin: 'geo-viewcontext', form: 'snapshot' })
  })

  it('prefers a browser-reported geo/view and states its real on-screen bounds', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('prefer-geo-view'))
    camera(session, 10, 20, 30_000) // an agent-flown camera the report should override.
    reportView(session)

    const decision = await fire(ctx, sessionAgent(session))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    const text = (decision.messages[0]?.content ?? [])
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    expect(text).toContain('latitude 51.5, longitude -0.12')
    expect(text).toContain('On-screen bounds (west, south, east, north): -0.2, 51.45, -0.04, 51.55')
    expect(text).not.toContain('Approximate visible bounds')
  })

  it('throttles recent injections but refreshes after rollback or elapsed time', async () => {
    const { ctx } = await mount({ refreshIntervalMs: 1_000 })
    const session = Session.create(SessionId('throttle'))
    camera(session)
    const owner = sessionAgent(session)

    const first = await fire(ctx, owner)
    commitInjected(session, first)
    expect(first.kind === 'enter' ? first.messages : []).toHaveLength(1)

    vi.setSystemTime(BASE + 500)
    expect(await fire(ctx, owner)).toEqual({ kind: 'enter', messages: [] })

    vi.setSystemTime(BASE - 100)
    const rollback = await fire(ctx, owner)
    commitInjected(session, rollback)
    expect(rollback.kind === 'enter' ? rollback.messages : []).toHaveLength(1)

    vi.setSystemTime(BASE + 2_000)
    expect((await fire(ctx, owner)).kind).toBe('enter')
  })

  it.each([undefined, 0])('injects every eligible step when refreshIntervalMs is %s', async (refreshIntervalMs) => {
    const { ctx } = await mount(refreshIntervalMs === undefined ? {} : { refreshIntervalMs })
    const session = Session.create(SessionId(`always-${String(refreshIntervalMs)}`))
    camera(session)
    const owner = sessionAgent(session)
    expect((await fire(ctx, owner)).kind).toBe('enter')
    expect((await fire(ctx, owner)).kind).toBe('enter')
  })

  it('removes its pre-step listener when disposed', async () => {
    const { ctx, fiber } = await mount()
    const session = Session.create(SessionId('disposed'))
    camera(session)
    await fiber.dispose()
    expect(await fire(ctx, sessionAgent(session))).toEqual({ kind: 'enter', messages: [] })
  })
})
