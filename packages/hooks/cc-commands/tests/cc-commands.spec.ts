/**
 * Real-composition tests for @deepseek-ai/dsh-cc-commands: load a fixture
 * plugin's commands, register them on the real CommandRuntime, execute one
 * through the executor, and assert the handler injects the variable-expanded
 * prompt through `agent.followup`. Plus the Loader-safe export shape and
 * disposal (HMR safety).
 */

import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import * as ccCommands from '@deepseek-ai/dsh-cc-commands'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), 'fixture-plugin')

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly followups: UserMessage[]
}

/** A live idle agent that records every followup the command handler injects. */
function stubAgent(ctx: Context, id: string, followups: UserMessage[]): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: (message: UserMessage) => { followups.push(message) },
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

/** Mount the real command registry + agent registry and the cc-commands producer. */
async function harness(config: ccCommands.Config): Promise<Harness & { plugin: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const plugin = await ctx.plugin(ccCommands, config)
  const followups: UserMessage[] = []
  const agent = stubAgent(ctx, `cc-commands-${Math.random()}`, followups)
  ctx.agents.register(agent)
  return { ctx, agent, followups, plugin }
}

describe('@deepseek-ai/dsh-cc-commands export shape', () => {
  it('is a namespace plugin with Loader-safe exports', () => {
    expect(ccCommands.name).toBe('cc-commands')
    expect(ccCommands.inject).toEqual(['commands'])
    expect('default' in ccCommands).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(ccCommands)).toBe(ccCommands)
  })
})

describe('cc-commands loaders', () => {
  it('namespaces command names into the DSH grammar', () => {
    const commands = ccCommands.loadCommands(PLUGIN, 'demo')
    expect(commands.map(c => c.name).sort()).toEqual(['demo-hello', 'demo-plain'])
    const hello = commands.find(c => c.name === 'demo-hello')
    expect(hello?.description).toBe('Greet someone by name')
    expect(hello?.argumentHint).toBe('<name>')
  })

  it('expands every Claude Code variable and leaves no residue', () => {
    const commands = ccCommands.loadCommands(PLUGIN, 'demo')
    const hello = commands.find(c => c.name === 'demo-hello')!
    const text = ccCommands.expandBody(hello.body, { args: 'Ada', pluginRoot: '/p', projectDir: '/d' })
    expect(text).toContain('greet Ada.')
    expect(text).toContain('/p/agents/brain.md')
    expect(text).toContain('project /d.')
    expect(text).not.toContain('$ARGUMENTS')
    expect(text).not.toContain('${CLAUDE_')
  })

  it('coerces colon and leading-digit names to the command grammar', () => {
    expect(ccCommands.commandName('Win:Brain', 'Do')).toBe('win-brain-do')
    expect(ccCommands.commandName('3plugin', 'go')).toBe('cc-3plugin-go')
  })
})

describe('cc-commands registration and injection', () => {
  it('registers every command and injects the expanded prompt through the executor', async () => {
    const test = await harness({ pluginRoot: PLUGIN, pluginName: 'demo', projectDir: '/work/proj' })

    expect(test.ctx.commands.find(test.agent, 'demo-hello')).toBeDefined()
    expect(test.ctx.commands.find(test.agent, 'demo-plain')).toBeDefined()
    expect(test.ctx.commands.list(test.agent)).toContainEqual(
      expect.objectContaining({ name: 'demo-hello', input: { hint: '<name>' } }),
    )

    const execution = await test.ctx.commands.execute(test.agent, '/demo-hello Grace', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Running /demo-hello' })

    expect(test.followups).toHaveLength(1)
    const injected = test.followups[0]
    if (!injected) throw new Error('expected one injected followup')
    expect(injected.role).toBe('user')
    expect(injected.source.kind).toBe('user')
    const block = injected.content[0]
    if (!block || block.type !== 'text' || !('text' in block)) throw new Error('expected injected text content')
    expect(block.text).toContain('greet Grace.')
    expect(block.text).toContain(`${PLUGIN}/agents/brain.md`)
    expect(block.text).toContain('project /work/proj.')
  })

  it('disposes every registration when the fiber unloads (HMR safety)', async () => {
    const test = await harness({ pluginRoot: PLUGIN, pluginName: 'demo' })
    expect(test.ctx.commands.find(test.agent, 'demo-hello')).toBeDefined()
    expect(test.ctx.commands.find(test.agent, 'demo-plain')).toBeDefined()

    await test.plugin.dispose()

    expect(test.ctx.commands.find(test.agent, 'demo-hello')).toBeUndefined()
    expect(test.ctx.commands.find(test.agent, 'demo-plain')).toBeUndefined()
  })
})
