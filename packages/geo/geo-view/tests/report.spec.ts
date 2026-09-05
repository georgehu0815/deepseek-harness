/**
 * The `CameraViewService.report` Remote: appending the browser-reported live 3D
 * Earth camera as a durable, model-visible `geo/view` event. Composed beside a
 * SessionStore and AgentRegistry (the projection.spec harness), `report` is
 * called directly with a resolved live agent — the same object the Gateway hands
 * a Remote after resolving the wire session id. A valid report appends one
 * `geo/view` event and returns the new `{ seq }`; malformed browser input (bad
 * source, non-finite pose, inverted bbox) is rejected loudly without appending.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import CameraViewService from '@deepseek-ai/dsh-geo-view'
import type { GeoView } from '@deepseek-ai/dsh-geo-view'

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  service: CameraViewService
}

async function harness(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CameraViewService)
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return { ctx, session, agent, service: ctx.geoView }
}

/** Count of geo/view events currently in the session log. */
function viewEvents(session: Session): readonly { data: unknown }[] {
  return session.events.filter(e => e.type === 'geo/view')
}

describe('CameraViewService.report', () => {
  it('appends a geo/view event and returns the new seq', async () => {
    const bench = await harness()
    const view: GeoView = {
      source: 'user',
      pose: { lat: 40, lon: -105, height: 12000, heading: 30, pitch: -45 },
      bbox: { west: -105.1, south: 39.9, east: -104.9, north: 40.1 },
    }
    const result = bench.service.report(bench.agent, view)
    const appended = viewEvents(bench.session)
    expect(appended).toHaveLength(1)
    expect(appended[0]?.data).toEqual(view)
    expect(result.seq).toBe(bench.session.seq - 1)
  })

  it('appends a view without a bbox (oblique/space view)', async () => {
    const bench = await harness()
    const view: GeoView = { source: 'agent', pose: { lat: 35.68, lon: 139.65, height: 500000 } }
    bench.service.report(bench.agent, view)
    expect(viewEvents(bench.session)[0]?.data).toEqual(view)
  })

  it('rejects an invalid source without appending', async () => {
    const bench = await harness()
    const bad = { source: 'robot', pose: { lat: 0, lon: 0, height: 1 } } as unknown as GeoView
    expect(() => bench.service.report(bench.agent, bad)).toThrow(/invalid reported view/)
    expect(viewEvents(bench.session)).toHaveLength(0)
  })

  it('rejects a non-finite pose number without appending', async () => {
    const bench = await harness()
    const bad = { source: 'user', pose: { lat: Number.NaN, lon: 0, height: 1 } } as GeoView
    expect(() => bench.service.report(bench.agent, bad)).toThrow(/invalid reported view/)
    expect(viewEvents(bench.session)).toHaveLength(0)
  })

  it('rejects an inverted bbox (east <= west) without appending', async () => {
    const bench = await harness()
    const bad: GeoView = {
      source: 'user',
      pose: { lat: 40, lon: -105, height: 12000 },
      bbox: { west: -104.9, south: 39.9, east: -105.1, north: 40.1 },
    }
    expect(() => bench.service.report(bench.agent, bad)).toThrow(/invalid reported view/)
    expect(viewEvents(bench.session)).toHaveLength(0)
  })

  it('rejects an inverted bbox (north <= south) without appending', async () => {
    const bench = await harness()
    const bad: GeoView = {
      source: 'user',
      pose: { lat: 40, lon: -105, height: 12000 },
      bbox: { west: -105.1, south: 40.1, east: -104.9, north: 39.9 },
    }
    expect(() => bench.service.report(bench.agent, bad)).toThrow(/invalid reported view/)
    expect(viewEvents(bench.session)).toHaveLength(0)
  })
})
