import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import RobotLabRuntime, { validateRobotRequest } from '../src/index.ts'

const signal = new AbortController().signal
// These tests exercise only the session ownership share consumed by the service.
const agent = { session: Session.create(SessionId('robot-test-owner')) } as Agent

describe('Robot Lab service', () => {
  it('reports disabled capabilities without a configured provider', async () => {
    const runtime = new RobotLabRuntime(new Context())
    const result = await runtime.execute(agent, { operation: 'readiness' }, signal)
    expect(result).toMatchObject({ readiness: {
      ready: false, defaultBackend: 'cpu', capabilities: { deploy: { available: false } },
      backends: {
        cpu: { available: false, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
        mlx: { available: false, learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
      },
    } })
    await expect(runtime.execute(agent, { operation: 'policies' }, signal)).rejects.toThrow('not configured')
  })
  it('delegates the authoritative session and removes the disposed provider', async () => {
    const runtime = new RobotLabRuntime(new Context())
    const execute = vi.fn(async () => ({ operation: 'runs' as const, runs: [], incompatibleRuns: [] }))
    const dispose = runtime.registerProvider({ execute })
    await runtime.execute(agent, { operation: 'runs' }, signal)
    expect(execute).toHaveBeenCalledWith(agent.session, { operation: 'runs' }, signal)
    expect(() => runtime.registerProvider({ execute })).toThrow('already')
    dispose()
    dispose()
    await expect(runtime.execute(agent, { operation: 'runs' }, signal)).rejects.toThrow('not configured')
  })
  it.each([null, [], {}, { operation: 'prepare_train' }, { operation: 'constructor' }, { operation: 'readiness', sourceRoot: '/tmp' }, { operation: 'simulate', policyId: 'shipped:alpha_stand' }])('rejects non-public or incomplete requests: %j', (value) => {
    expect(() => validateRobotRequest(value)).toThrow()
  })
  it('delegates studio queries through the same authoritative owner', async () => {
    const runtime = new RobotLabRuntime(new Context())
    const execute = vi.fn(async () => ({ operation: 'projects' as const, projects: [] }))
    runtime.registerProvider({ execute })
    await runtime.request(agent, { operation: 'projects' })
    expect(execute).toHaveBeenCalledWith(agent.session, { operation: 'projects' }, expect.any(AbortSignal))
  })
  it('validates immutable project operations and rejects caller-frozen training metadata', () => {
    const id = 'revision-00000000-0000-0000-0000-000000000000'
    for (const operation of ['project', 'reference_preview']) {
      expect(validateRobotRequest({ operation, projectRevisionId: id })).toEqual({ operation, projectRevisionId: id })
      expect(() => validateRobotRequest({ operation, projectRevisionId: '../another-session' })).toThrow('identity')
    }
    expect(() => validateRobotRequest({ operation: 'train', spec: { projectSnapshot: {} } })).toThrow('provider-owned')
  })
  it('accepts matching studio music and rejects malformed nested recipes', () => {
    const recipe = { projectId: null, name: 'Disco', profileId: 'microduck', templateId: 'disco-groove', templateVersion: 1,
      parameters: { bpm: 96, beats: 32, moveSize: 0.5 }, music: { version: 1, style: 'disco', bpm: 96, beats: 32, seed: 42 } }
    expect(validateRobotRequest({ operation: 'save_project', recipe })).toEqual({ operation: 'save_project', recipe })
    const blocks = [
      { templateId: 'disco-groove', templateVersion: 1, beats: 16, moveSize: 0.5 },
      { templateId: 'hello', templateVersion: 1, beats: 16, moveSize: 0.8 },
    ]
    expect(validateRobotRequest({ operation: 'save_project', recipe: { ...recipe, blocks } })).toEqual({ operation: 'save_project', recipe: { ...recipe, blocks } })
    for (const invalid of [[], null, [{ ...blocks[0], beats: 32, moveSize: 2 }],
      [{ ...blocks[0], beats: 16 }], [{ ...blocks[1], beats: 32 }], [{ ...blocks[0], beats: 32, extra: true }]]) {
      expect(() => validateRobotRequest({ operation: 'save_project', recipe: { ...recipe, blocks: invalid } })).toThrow()
    }
    const unicode = { ...recipe, name: ' 我的鸭鸭 / ディスコ 🦆💃 ' }
    expect(validateRobotRequest({ operation: 'save_project', recipe: unicode })).toEqual({ operation: 'save_project', recipe: unicode })
    for (const name of ['🦆'.repeat(64), '../display-only-鸭鸭']) {
      const valid = { operation: 'save_project', recipe: { ...recipe, name } }
      expect(validateRobotRequest(valid)).toEqual(valid)
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(256)
    }
    for (const name of [' ', '\u0000', '\u0085', '\ud800', '🦆'.repeat(65)]) expect(() => validateRobotRequest({ operation: 'save_project', recipe: { ...recipe, name } })).toThrow('name')
    for (const patch of [
      { projectId: '../escape' }, { profileId: '/outside' }, { name: '' }, { templateVersion: 2 },
      { parameters: { ...recipe.parameters, moveSize: 1.01 } }, { parameters: { ...recipe.parameters, bpm: NaN } },
      { parameters: { ...recipe.parameters, beats: 1.5 } }, { music: { ...recipe.music, bpm: 120 } },
      { music: { ...recipe.music, style: 'provider' } }, { music: { ...recipe.music, seed: -1 } },
      { music: { ...recipe.music, seed: Infinity } }, { music: { ...recipe.music, apiKey: 'never' } },
    ]) expect(() => validateRobotRequest({ operation: 'save_project', recipe: { ...recipe, ...patch } })).toThrow()
  })
  it('preserves explicit public requests', () => {
    const request = { operation: 'simulate', policyId: 'shipped:alpha_stand', steps: 5, seed: 1, command: [0, 0, 0] }
    expect(validateRobotRequest(request)).toBe(request)
  })
})
