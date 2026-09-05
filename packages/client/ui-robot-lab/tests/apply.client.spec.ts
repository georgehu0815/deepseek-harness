// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { StudioInjected, MicroDuckProps } from '../src/client/studio-props.ts'
import { createRobotStore } from '../src/client/store.ts'
import { apply, inject } from '../src/client/index.ts'
import { fixtureUnavailableReadiness as readiness, fixtureProject, fixtureSimulation, readySnapshot } from './fixtures.client.ts'
import { encodeRosterFile } from '../src/client/roster-file.ts'
import { LabClient } from '../src/client/lab-client.ts'

const sessionId = 'session-one' as SessionId

// Source-only descriptor: identity codecs isolate Cordis authorization from generated protocol validation.
const fixtureCodec = {
  mode: 'strict' as const,
  typeSymbol: '@fixture/robot-lab#value',
  schema: { parse: (value: unknown): unknown => value },
}
const robotLabRemote: Parameters<Context['remote']['$mount']>[0] = {
  package: '@fixture/robot-lab',
  descriptors: [{
    id: '@fixture/robot-lab#robotLab/request',
    service: 'robotLab',
    namespace: 'robotLab',
    method: 'request',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'agent', wire: 'agentId', source: 'json', codec: fixtureCodec },
      { name: 'request', wire: 'request', source: 'json', codec: fixtureCodec },
    ],
    result: fixtureCodec,
  }],
}

async function fixture() {
  const ctx = new Context()
  const registry = ctx.plugin(SlotRegistry)
  await registry.await()
  const toggleVisual = vi.fn()
  const openVisual = vi.fn()
  ctx.provide('layout', { toggleVisual, openVisual } as never)
  const typert = ctx.plugin(TypertRegistry)
  await typert.await()
  const call = vi.fn<ConnectionHandle['rpc']['call']>().mockImplementation(async (_path, _method, body) => {
    const operation = (body as { args: { request: { operation: string } } }).args.request.operation
    if (operation === 'trials') return { ok: true, value: { operation, trials: [] } }
    if (operation === 'evaluations') return { ok: true, value: { operation, evaluations: [], incompleteCount: 0 } }
    if (operation === 'reflections') return { ok: true, value: { operation, reflections: [] } }
    return { ok: true, value: { operation: 'readiness', readiness } }
  })
  ctx.provide('connection', {
    isLoopback: true,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    state: { getSnapshot: () => 'connected' as const, subscribe: () => () => {} },
    rpc: { call },
    reconnect: () => {},
    registerGenerationSource: () => () => {},
    start: () => ({ stop: () => {} }),
  } satisfies ConnectionHandle)
  const remote = ctx.plugin(gateway)
  await remote.await()
  // The production gateway installs a traced remote.robotLab service; a flat object bypasses Cordis authorization.
  const assembly = ctx.plugin({ inject: ['remote'], apply(scope: Context) {
    return scope.remote.$mount(robotLabRemote)
  } })
  await assembly.await()
  const shell = ctx.plugin({ inject: ['slots'], apply(scope: Context) {
    scope.slots.register({ name: 'root', children: {
      'visual.workspace.view': { kind: 'list', scope: 'session-maybe' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
    } }, (_props: PropsRenderSlots<'visual.workspace.view' | 'sidebar.footer.action' | 'conversation.view'>) => null)
    scope.slots.register({ name: 'visual.workspace.view', id: 'earth', label: () => 'Earth 3D', order: 10 }, () => null)
    scope.slots.register({ name: 'conversation.view', id: 'supply-chain', label: () => 'Supply chain', order: 30 }, () => null)
  } })
  await shell.await()
  return { ctx, slots: ctx.get('slots')!, toggleVisual, openVisual, call, dispose: async () => {
    await shell.dispose()
    await assembly.dispose()
    await remote.dispose()
    await typert.dispose()
    await registry.dispose()
  } }
}

describe('Robot Lab slot composition', () => {
  it('contributes beside Earth and disposes only its own entries', async () => {
    const { ctx, slots, toggleVisual, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('visual.workspace.view').map(entry => entry.options.id)).toEqual(['earth', 'robot-lab'])
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['supply-chain', 'micro-duck'])
    const center = slots.entries('conversation.view')[1]!
    expect(typeof center.options.label === 'function' ? center.options.label() : center.options.label).toBe('Micro Duck')
    expect(center.options.order).toBe(40)
    const player = slots.entries('robot-lab.visual.player')[0]!
    const wrapper = slots.entries('visual.workspace.view')[1]!
    expect(slots.spec('conversation.view')?.scope).toBe('session')
    expect(slots.spec('robot-lab.visual.player')?.scope).toBe('session')
    expect(slots.spec('visual.workspace.view')?.scope).toBe('session-maybe')
    expect(player.store).toBe(center.store)
    for (const name of ['conversation.micro-duck.learning-plan', 'conversation.micro-duck.learning-review'] as const) {
      expect(slots.spec(name)).toMatchObject({ kind: 'single', scope: 'session' })
      const section = slots.entries(name)[0]!
      expect(section.store).toBe(center.store)
      expect(section.inject).toBe(center.inject)
    }
    expect(wrapper.store).toBeUndefined()
    const launcher = slots.entries('sidebar.footer.action').find(entry => entry.options.id === 'robot-lab')!
    const actions = (launcher.inject as () => { open: () => void })()
    actions.open()
    expect(toggleVisual).toHaveBeenCalledExactlyOnceWith('robot-lab')
    await fiber.dispose()
    expect(slots.entries('visual.workspace.view').map(entry => entry.options.id)).toEqual(['earth'])
    expect(slots.entries('sidebar.footer.action')).toEqual([])
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['supply-chain'])
    expect(slots.entries('robot-lab.visual.player')).toEqual([])
    for (const name of ['conversation.micro-duck.learning-plan', 'conversation.micro-duck.learning-review'] as const) {
      expect(slots.entries(name)).toEqual([])
      expect(slots.spec(name)).toBeUndefined()
    }
    await dispose()
  })

  it('loads session readiness through the namespaced Remote service', async () => {
    const { ctx, slots, call, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const entry = slots.entries('conversation.view').find(entry => entry.options.id === 'micro-duck')!
      const face = (entry.inject as unknown as (id: SessionId, actions: MicroDuckProps['actions']) => StudioInjected)
      (sessionId, createRobotStore().create().actions)
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().busy).toBeNull() })
      expect(face.hooks.lab.getSnapshot().error).toBeNull()
      expect(face.hooks.lab.getSnapshot().readiness).toEqual(readiness)
      expect(call).toHaveBeenCalledTimes(4)
      expect(call).toHaveBeenLastCalledWith('/api', 'robotLab/request', {
        args: { agentId: sessionId, request: { operation: 'readiness' } },
      }, expect.any(AbortSignal))
    } finally {
      await fiber.dispose()
      await dispose()
    }
  })

  it('shares session data and playback across center/player, isolates sessions and disposes both owners', async () => {
    const { ctx, slots, call, openVisual, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const center = slots.entries('conversation.view')[1]!
      const player = slots.entries('robot-lab.visual.player')[0]!
      const bind = center.inject as unknown as (id: SessionId, actions: MicroDuckProps['actions']) => StudioInjected
      const playerBind = player.inject as unknown as typeof bind
      const actions = createRobotStore().create().actions
      const first = bind(sessionId, actions)
      const right = playerBind(sessionId, actions)
      const second = bind('session-two' as SessionId, createRobotStore().create().actions)
      expect(first.hooks.lab).toBe(right.hooks.lab)
      expect(first.hooks.playback).toBe(right.hooks.playback)
      for (const name of ['conversation.micro-duck.learning-plan', 'conversation.micro-duck.learning-review'] as const) {
        const sectionBind = slots.entries(name)[0]!.inject as unknown as typeof bind
        const section = sectionBind(sessionId, actions)
        expect(section.hooks.lab).toBe(first.hooks.lab)
        expect(section.hooks.playback).toBe(first.hooks.playback)
      }
      expect(second.hooks.lab).not.toBe(first.hooks.lab)
      expect(second.hooks.playback).not.toBe(first.hooks.playback)
      await vi.waitFor(() => { expect(second.hooks.lab.getSnapshot().busy).toBeNull() })
      expect(call).toHaveBeenCalledTimes(8)
      first.openStudio()
      expect(openVisual).toHaveBeenCalledExactlyOnceWith('robot-lab')
      await fiber.dispose()
      expect(first.hooks.playback.getSnapshot().state).toBe('disposed')
      expect(second.hooks.playback.getSnapshot().state).toBe('disposed')
      first.refresh()
      expect(call).toHaveBeenCalledTimes(8)
    } finally { await fiber.dispose(); await dispose() }
  })

  it.each([false, true])('acknowledges only the returned save revision, committed=%s', async (committed) => {
    const { ctx, slots, call, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    const save = vi.spyOn(LabClient.prototype, 'saveProject').mockResolvedValue(committed ? fixtureProject : null)
    try {
      await fiber.await()
      const entry = slots.entries('conversation.view')[1]!
      const savedProject = vi.fn()
      const bind = entry.inject as unknown as (id: SessionId, actions: MicroDuckProps['actions']) => StudioInjected
      const face = bind(sessionId, { ...createRobotStore().create().actions, savedProject })
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().busy).toBeNull() })
      if (!committed) {
        call.mockResolvedValueOnce({ ok: true, value: { operation: 'project', project: fixtureProject } })
        face.execute({ operation: 'project', projectRevisionId: fixtureProject.id })
        await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().project).toEqual(fixtureProject) })
      }
      face.saveProject(fixtureProject.recipe, 7, false)
      await Promise.resolve()
      expect(save).toHaveBeenCalledExactlyOnceWith(fixtureProject.recipe, false)
      if (committed) expect(savedProject).toHaveBeenCalledExactlyOnceWith(7, fixtureProject.projectId, fixtureProject.id)
      else expect(savedProject).not.toHaveBeenCalled()
    } finally { save.mockRestore(); await fiber.dispose(); await dispose() }
  })

  it('denies namespace access when only the parent Remote service is injected', async () => {
    const { ctx, slots, call, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: ['slots', 'layout', 'remote'], apply })
    try {
      await fiber.await()
      const entry = slots.entries('conversation.view').find(entry => entry.options.id === 'micro-duck')!
      const face = (entry.inject as unknown as (id: SessionId, actions: MicroDuckProps['actions']) => StudioInjected)
      (sessionId, createRobotStore().create().actions)
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().busy).toBeNull() })
      expect(face.hooks.lab.getSnapshot().error).toBe(['trials', 'evaluations', 'reflections', 'readiness']
        .map(operation => `${operation}: cannot get property "remote.robotLab" without inject`).join('\n'))
      expect(face.hooks.lab.getSnapshot().readiness).toBeNull()
      expect(call).not.toHaveBeenCalled()
    } finally {
      await fiber.dispose()
      await dispose()
    }
  })

  it('binds group recording, shortest playback duration and roster recovery to the captured session', async () => {
    const { ctx, slots, call, dispose } = await fixture()
    const fiber = ctx.plugin({ inject: [...inject], apply(scope: Context) { apply(scope, { maxGroupMembers: 2 }) } })
    try {
      await fiber.await()
      const entry = slots.entries('conversation.view')[1]!
      const store = createRobotStore(4, 2).create()
      const bind = entry.inject as unknown as (id: SessionId, actions: MicroDuckProps['actions']) => StudioInjected
      const face = bind(sessionId, store.actions)
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().busy).toBeNull() })
      expect(face.maxGroupMembers).toBe(2)
      store.actions.updateDuck(1, { policyId: fixtureSimulation.policyId })
      store.actions.duplicateDuck(1)
      call.mockResolvedValueOnce({ ok: true, value: { operation: 'policies', policies: readySnapshot().policies } })
      face.execute({ operation: 'policies' })
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().busy).toBeNull() })
      const shorter = { ...fixtureSimulation, frames: [fixtureSimulation.frames[0]!, { ...fixtureSimulation.frames[1]!, time: 1 }] }
      call.mockResolvedValueOnce({ ok: true, value: { operation: 'simulate', simulation: fixtureSimulation } })
      call.mockResolvedValueOnce({ ok: true, value: { operation: 'simulate', simulation: shorter } })
      face.simulateGroup(store.getSnapshot().ducks, 100, 4)
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().groupRecording?.tracks).toHaveLength(2) })
      expect(face.hooks.playback.getSnapshot()).toMatchObject({ duration: 1, time: 0, state: 'paused' })
      expect(call).toHaveBeenLastCalledWith('/api', 'robotLab/request', { args: { agentId: sessionId,
        request: { operation: 'simulate', policyId: fixtureSimulation.policyId, steps: 100, seed: 4, command: [0, 0, 0] } } }, expect.any(AbortSignal))
      const recording = face.hooks.lab.getSnapshot().groupRecording
      const roster = { version: 1 as const, members: [{ ...store.getSnapshot().ducks[0]!, name: 'Recovered duck' }], formation: 'line' as const, spacing: 0.8 }
      face.loadRoster(encodeRosterFile(roster))
      await vi.waitFor(() => { expect(store.getSnapshot().ducks[0]!.name).toBe('Recovered duck') })
      expect(store.getSnapshot().ducks).toHaveLength(1)
      expect(face.hooks.lab.getSnapshot().groupRecording).toBe(recording)
      face.loadRoster('{')
      await vi.waitFor(() => { expect(face.hooks.lab.getSnapshot().error).not.toBeNull() })
      expect(store.getSnapshot().ducks[0]!.name).toBe('Recovered duck')
      const calls = call.mock.calls.length
      face.simulateGroup([...roster.members, ...roster.members, ...roster.members], 100, 0)
      expect(call).toHaveBeenCalledTimes(calls)
    } finally { await fiber.dispose(); await dispose() }
  })

  it('rejects invalid resource configuration before registering contributions', async () => {
    const { ctx, slots, dispose } = await fixture()
    for (const maxGroupMembers of [0, -1, 1.5, Infinity]) {
      expect(() => { apply(ctx, { maxGroupMembers }) }).toThrow('maxGroupMembers')
    }
    expect(() =>{  apply(ctx, { maxDpr: 0 }) }).toThrow('maxDpr')
    expect(() =>{  apply(ctx, { evaluationEpisodes: 0 }) }).toThrow('episode')
    expect(slots.entries('visual.workspace.view').map(entry => entry.options.id)).toEqual(['earth'])
    await dispose()
  })
})
