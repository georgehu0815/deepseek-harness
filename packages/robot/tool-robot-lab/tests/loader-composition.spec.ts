import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import RobotLabRuntime, { type RobotRun } from '@deepseek-ai/dsh-robot-lab'
import * as Tools from '../src/index.ts'
import { describe, expect, it } from 'vitest'

function owner(ctx: Context): Agent {
  const fiber = ctx.plugin(() => {})
  const session = Session.create(SessionId('robot-loader-owner'))
  const agent: Agent = {
    id: session.id, session, options: {}, ctx: fiber.ctx, status: 'idle',
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    followup() {}, steer() {}, inject() {}, send() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

describe('Robot Lab real Loader composition', () => {
  it('summarizes supported learners and reports unsupported formats without synthetic runs', () => {
    const runs = (['cpu', 'mlx'] as const).map((backend): RobotRun => ({
      formatVersion: 3, id: `run-${backend}` as RobotRun['id'], state: 'stopped', createdAt: '2026-09-04T00:00:00Z', finishedAt: '2026-09-04T00:01:00Z',
      spec: { backend, name: backend, behaviorId: 'stand', steps: 256, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null },
      observationProfile: 'microduck-standard-61', recipeHash: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), progress: null, error: null, policyId: null, policySha256: null,
      provenance: { bridgeSha256: 'c'.repeat(64), dependencyVersions: {},
        bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'd'.repeat(64) },
        environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false, updateDevice: backend === 'mlx' ? 'metal' : 'cpu', observationNoise: true, actionDelay: true },
        trainer: { backend, learnerDevice: backend === 'mlx' ? 'metal' : 'cpu', physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin', architecture: 'arm64', hardware: 'fixture',
          dependencyVersions: {}, helperSha256: backend === 'mlx' ? { 'mlx_ppo.py': 'e'.repeat(64) } : {}, recipe: {}, sha256: 'f'.repeat(64) },
      },
    }))
    const incompatibleRuns = [{ id: 'run-unsupported' as RobotRun['id'], formatVersion: 2, reason: 'unsupported Robot Lab run format; only version 3 is supported' }]
    const result = JSON.parse(Tools.summarizeResult({ operation: 'runs', runs, incompatibleRuns })) as { runs: Array<{ id: string; backend: unknown }>; incompatibleRuns: unknown }
    expect(result.runs.map(run => [run.id, run.backend])).toEqual([['run-cpu', 'cpu'], ['run-mlx', 'mlx']])
    expect(result.incompatibleRuns).toEqual(incompatibleRuns)
  })
  it('offers the real tool, reports absent compute honestly, and removes registrations on disposal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-robot-loader-'))
    const ctx = new Context()
    try {
      const modules = new Map<string, unknown>([
        ['@deepseek-ai/dsh-agent', AgentRegistry], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
        ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-robot-lab', RobotLabRuntime],
        ['@deepseek-ai/dsh-tool-robot-lab', Tools],
      ])
      const configPath = join(directory, 'cordis.yml')
      await writeFile(configPath, [...modules.keys()].map(name => `- name: '${name}'`).join('\n') + '\n')
      ctx.baseUrl = pathToFileURL(directory).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = { version: 'v2', async import(name: string) {
        if (!modules.has(name)) throw new Error(`Unexpected module ${name}`)
        return modules.get(name)
      } } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      const agent = owner(ctx)
      const tools = ctx.tools
      expect(tools.schemas().map(t => t.name)).toContain('robot_lab')
      const schema = JSON.stringify(tools.schemas().find(t => t.name === 'robot_lab'))
      for (const phrase of ['Stand Steady (stand)', 'Say Hello (hello)', 'Look Around (look-around)',
        'use \\"project-\\" + project.id as the ASCII train name, not clip.name',
        'save_trial', 'train_trial', 'evidence describes what to measure', 'NEW re-simulation']) expect(schema).toContain(phrase)
      const result = await tools.execute({ name: 'robot_lab', arguments: { request_json: '{"operation":"readiness"}' }, agent, callId: ToolCallId('robot-readiness'), signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain('Configure a MicroDuck Lab provider')
      expect(JSON.stringify(result.content)).toContain('defaultBackend')
      expect(JSON.stringify(result.content)).toContain('metal')
      expect(JSON.stringify(result.content)).toContain('physicsDevice')
      const denied = await tools.execute({ name: 'robot_lab', arguments: { request_json: '{"operation":"prepare_train"}' }, agent, callId: ToolCallId('robot-private-operation'), signal: new AbortController().signal })
      expect(denied.isError).toBe(true)
      const removeProvider = ctx.robotLab.registerProvider({ async execute(session, request) {
        expect(session).toBe(agent.session)
        if (request.operation === 'trials') return { operation: 'trials', trials: [] }
        if (request.operation === 'evaluations') return { operation: 'evaluations', evaluations: [], incompleteCount: 1 }
        if (request.operation === 'reflections') return { operation: 'reflections', reflections: [] }
        if (request.operation === 'save_trial') return { operation: 'save_trial', trial: {
          version: 1, id: 'trial-00000000-0000-4000-8000-000000000001' as import('@deepseek-ai/dsh-robot-lab').RobotTrialId,
          createdAt: '2026-09-05T00:00:00Z', projectRevisionId: request.recipe.spec.projectRevisionId,
          projectSha256: 'a'.repeat(64), recipe: request.recipe, sha256: 'b'.repeat(64),
        } }
        expect(request.operation).toBe('projects')
        return { operation: 'projects', projects: [] }
      } })
      const projects = await tools.execute({ name: 'robot_lab', arguments: { request_json: '{"operation":"projects"}' }, agent, callId: ToolCallId('robot-projects'), signal: new AbortController().signal })
      expect(projects.isError).toBe(false)
      expect(JSON.stringify(projects.content)).toContain('projects')
      const malformedProject = await tools.execute({ name: 'robot_lab', arguments: { request_json: '{"operation":"project","projectRevisionId":"../another-session"}' }, agent, callId: ToolCallId('robot-project-denied'), signal: new AbortController().signal })
      expect(malformedProject.isError).toBe(true)
      for (const operation of ['trials', 'evaluations', 'reflections']) {
        const history = await tools.execute({ name: 'robot_lab', arguments: { request_json: JSON.stringify({ operation }) },
          agent, callId: ToolCallId(`robot-${operation}`), signal: new AbortController().signal })
        expect(history.isError).toBe(false)
        expect(JSON.stringify(history.content)).toContain(operation)
        if (operation === 'evaluations') expect(JSON.stringify(history.content)).toContain('incompleteCount')
      }
      const trialRecipe = { spec: { projectRevisionId: 'revision-00000000-0000-4000-8000-000000000001', name: 'Trial',
        behaviorId: 'stand', steps: 32, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null },
      brief: { goal: 'Stand', prediction: 'Remain upright', plannedChange: 'Lower motion', evidence: 'Measure upright fraction' },
      evaluation: { episodes: 1, stepsPerEpisode: 32, seed: 0, maxTerminations: 0, minMeanUprightFraction: 0.9 }, parentReflectionId: null }
      const saved = await tools.execute({ name: 'robot_lab', arguments: { request_json: JSON.stringify({ operation: 'save_trial', recipe: trialRecipe }) },
        agent, callId: ToolCallId('robot-save-trial'), signal: new AbortController().signal })
      expect(saved.isError).toBe(false)
      expect(JSON.stringify(saved.content)).toContain('Measure upright fraction')
      const oversized = await tools.execute({ name: 'robot_lab', arguments: { request_json: JSON.stringify({ operation: 'save_trial',
        recipe: { ...trialRecipe, brief: { ...trialRecipe.brief, evidence: '测'.repeat(10_000) } } }) },
      agent, callId: ToolCallId('robot-oversized-trial'), signal: new AbortController().signal })
      expect(oversized.isError).toBe(true)
      expect(JSON.stringify(oversized.content)).toContain('maxResultBytes')
      removeProvider()
      await ctx.fiber.dispose()
      expect(tools.schemas().map(t => t.name)).not.toContain('robot_lab')
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
