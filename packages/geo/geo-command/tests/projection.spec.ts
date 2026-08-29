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
    expect(projections?.values.geoCommand).toEqual({ seq: 0, command: null })
  })

  it('advances seq and replaces the command last-wins', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('geo/command', { kind: 'camera', lat: 35.68, lon: 139.65, height: 500000 })
    session.append('geo/command', { kind: 'basemap', id: 'esri-satellite' })
    const projections = await bench.tailProjections()
    expect(projections?.values.geoCommand).toEqual({ seq: 2, command: { kind: 'basemap', id: 'esri-satellite' } })
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
    expect((await bench.tailProjections())?.values.geoCommand).toEqual({ seq: 0, command: null })
    await fiber.dispose()
    expect('geoCommand' in ((await bench.tailProjections())?.values ?? {})).toBe(false)
  })
})
