import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotLabResult } from '@deepseek-ai/dsh-robot-lab/types'
import { LabClient } from '../src/client/lab-client.ts'
import type { LabTransport } from '../src/client/lab-client.ts'
import { fixtureProject, fixtureSimulation, fixtureUnavailableReadiness, readySnapshot } from './fixtures.client.ts'
import { trial, binding, entry, evaluation, reflection } from './learning-fixtures.client.ts'

const session = 'learning-session' as SessionId

function fixture(...results: Array<RobotLabResult | Error>) {
  const transport = vi.fn<LabTransport>()
  for (const result of results) {
    if (result instanceof Error) transport.mockRejectedValueOnce(result)
    else transport.mockResolvedValueOnce(result)
  }
  const load = vi.fn()
  const client = new LabClient(session, transport, 2000, load)
  return { client, transport, load }
}

describe('session-owned learning operations', () => {
  it.each([false, true])('commits an immutable trial before optional training, start=%s', async (start) => {
    const { client, transport } = fixture({ operation: 'save_trial', trial },
      { operation: 'train_trial', trial, binding, run: entry.run! }, { operation: 'policies', policies: [] })
    try {
      expect(await client.saveTrial(trial.recipe, start)).toBe(trial)
      expect(transport.mock.calls.map(([id, request]) => [id, request.operation])).toEqual(
        (start ? ['save_trial', 'train_trial', 'policies'] : ['save_trial']).map(operation => [session, operation]))
      expect(client.getSnapshot().trials[0]?.binding).toEqual(start ? binding : null)
    } finally { client.dispose() }
  })

  it('keeps committed trial admission when starting fails; a failed save starts nothing', async () => {
    const first = fixture({ operation: 'save_trial', trial }, new Error('Training slot occupied'))
    try {
      expect(await first.client.saveTrial(trial.recipe, true)).toBe(trial)
      expect(first.client.getSnapshot()).toMatchObject({ error: 'Training slot occupied', trials: [{ trial, binding: null, run: null }] })
    } finally { first.client.dispose() }
    const second = fixture(new Error('Storage unavailable'))
    try {
      expect(await second.client.saveTrial(trial.recipe, true)).toBeNull()
      expect(second.transport).toHaveBeenCalledTimes(1)
      expect(second.client.getSnapshot().trials).toEqual([])
    } finally { second.client.dispose() }
  })

  it('loads saved learning metadata even when scientific readiness is unavailable', async () => {
    const { client } = fixture({ operation: 'trials', trials: [entry] },
      { operation: 'evaluations', evaluations: [evaluation], incompleteCount: 2 },
      { operation: 'reflections', reflections: [reflection] }, { operation: 'readiness', readiness: fixtureUnavailableReadiness })
    try {
      await client.refresh()
      expect(client.getSnapshot()).toMatchObject({ trials: [entry], evaluations: [evaluation], incompleteEvaluations: 2,
        reflections: [reflection], scene: null, readiness: fixtureUnavailableReadiness })
    } finally { client.dispose() }
  })

  it('resolves disabled readiness when an absent provider rejects learning history', async () => {
    const transport = vi.fn<LabTransport>(async (_id, request) => {
      if (request.operation === 'readiness') return { operation: 'readiness', readiness: fixtureUnavailableReadiness }
      throw new Error('Robot Lab provider is not installed')
    })
    const client = new LabClient(session, transport, 2000)
    try {
      await client.refresh()
      expect(client.getSnapshot()).toMatchObject({ readiness: fixtureUnavailableReadiness, busy: null })
      expect(client.getSnapshot().error).toContain('trials: Robot Lab provider is not installed')
      expect(client.getSnapshot().error).toContain('evaluations: Robot Lab provider is not installed')
      expect(client.getSnapshot().error).toContain('reflections: Robot Lab provider is not installed')
      expect(transport.mock.calls.map(([, request]) => request.operation)).toEqual(['trials', 'evaluations', 'reflections', 'readiness'])
    } finally { client.dispose() }
  })

  it('retains corrupt-history predecessors while publishing independent runtime library updates', async () => {
    const ready = readySnapshot()
    const { client } = fixture({ operation: 'trials', trials: [entry] },
      { operation: 'evaluations', evaluations: [evaluation], incompleteCount: 2 },
      new Error('Corrupt trial file'), new Error('Corrupt report file'),
      { operation: 'reflections', reflections: [reflection] }, { operation: 'readiness', readiness: ready.readiness! },
      { operation: 'studio', catalog: ready.catalog! }, { operation: 'projects', projects: [fixtureProject] },
      { operation: 'behaviors', behaviors: ready.behaviors }, { operation: 'policies', policies: ready.policies },
      { operation: 'runs', runs: [], incompatibleRuns: [] },
      { operation: 'scene', scene: { bodies: [], meshes: [], geoms: [], defaultJoints: [], jointNames: [] } })
    try {
      await client.execute({ operation: 'trials' })
      await client.execute({ operation: 'evaluations' })
      await client.refresh()
      expect(client.getSnapshot()).toMatchObject({ readiness: ready.readiness, catalog: ready.catalog, projects: [fixtureProject],
        trials: [entry], evaluations: [evaluation], incompleteEvaluations: 2, reflections: [reflection], busy: null })
      expect(client.getSnapshot().error).toContain('trials: Corrupt trial file')
      expect(client.getSnapshot().error).toContain('evaluations: Corrupt report file')
    } finally { client.dispose() }
  })

  it.each([false, true])('retains one refresh owner while readiness settles before history, disposed=%s', async (disposed) => {
    let settle!: (result: RobotLabResult) => void
    const transport = vi.fn<LabTransport>().mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
      .mockResolvedValueOnce({ operation: 'evaluations', evaluations: [evaluation], incompleteCount: 0 })
      .mockResolvedValueOnce({ operation: 'reflections', reflections: [reflection] })
      .mockResolvedValueOnce({ operation: 'readiness', readiness: fixtureUnavailableReadiness })
    const client = new LabClient(session, transport, 2000)
    try {
      const refreshing = client.refresh()
      await vi.waitFor(() => { expect(client.getSnapshot().readiness).toEqual(fixtureUnavailableReadiness) })
      expect(client.getSnapshot().busy).toBe('refresh')
      expect(await client.execute({ operation: 'policies' })).toBeNull()
      expect(transport).toHaveBeenCalledTimes(4)
      if (disposed) client.dispose()
      const previous = client.getSnapshot()
      settle({ operation: 'trials', trials: [entry] })
      await refreshing
      if (disposed) expect(client.getSnapshot()).toBe(previous)
      else expect(client.getSnapshot()).toMatchObject({ trials: [entry], busy: null, error: null })
    } finally { client.dispose() }
  })

  it('publishes saved reflections only after commit and never starts an improvement run', async () => {
    const { client, transport } = fixture({ operation: 'save_reflection', reflection }, new Error('Disk full'))
    const request = { trialId: trial.id, evaluationId: evaluation.id, observation: reflection.observation,
      interpretation: reflection.interpretation, nextChange: reflection.nextChange }
    try {
      expect(await client.saveReflection(request)).toBe(reflection)
      expect(await client.saveReflection(request)).toBeNull()
      expect(client.getSnapshot().reflections).toEqual([reflection])
      expect(transport.mock.calls.every(([, operation]) => operation.operation === 'save_reflection')).toBe(true)
    } finally { client.dispose() }
  })

  it('opens the exact frozen parent project without contacting the runtime when it is already in history', async () => {
    const { client, transport } = fixture({ operation: 'trials', trials: [entry] })
    try {
      await client.execute({ operation: 'trials' })
      expect(await client.improvementSource(reflection)).toEqual({ trial, project: fixtureProject })
      expect(transport).toHaveBeenCalledTimes(1)
    } finally { client.dispose() }
  })

  it('loads a missing parent project by exact revision and refuses a mismatched source', async () => {
    const { client } = fixture({ operation: 'trials', trials: [{ ...entry, run: null }] },
      { operation: 'project', project: { ...fixtureProject, sha256: 'different' } })
    try {
      await client.execute({ operation: 'trials' })
      expect(await client.improvementSource(reflection)).toBeNull()
      expect(client.getSnapshot().error).toContain('exact saved project is unavailable')
    } finally { client.dispose() }
  })

  it('does not invent a parent trial for a reflection without its exact trial hash', async () => {
    const { client } = fixture()
    try {
      expect(await client.improvementSource(reflection)).toBeNull()
      expect(client.getSnapshot().error).toContain('exact parent trial is not loaded')
    } finally { client.dispose() }
  })

  it('keeps original report evidence unchanged when new re-simulation frames load', async () => {
    const { client, load } = fixture({ operation: 'evaluations', evaluations: [evaluation], incompleteCount: 0 },
      { operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0, mode: 'new-resimulation', simulation: fixtureSimulation })
    try {
      await client.execute({ operation: 'evaluations' })
      await client.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
      expect(client.getSnapshot()).toMatchObject({ evaluations: [evaluation], recording: fixtureSimulation,
        recordingEvaluation: { evaluationId: evaluation.id, episodeIndex: 0 } })
      expect(load).toHaveBeenCalledOnce()
    } finally { client.dispose() }
  })

  it.each([
    { ...fixtureSimulation, policyHash: 'different-bytes' },
    { ...fixtureSimulation, observationProfile: 'microduck-standard-61' as const },
    { ...fixtureSimulation, physics: { ...fixtureSimulation.physics, bam: { ...fixtureSimulation.physics.bam, source: 'other-source' } } },
  ])('rejects replay provenance mismatches without replacing the recording', async (simulation) => {
    const { client, load } = fixture({ operation: 'evaluations', evaluations: [evaluation], incompleteCount: 0 },
      { operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0, mode: 'new-resimulation', simulation })
    try {
      await client.execute({ operation: 'evaluations' })
      expect(await client.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })).toBeNull()
      expect(client.getSnapshot().error).toContain('does not match the requested recorded evaluation')
      expect(load).not.toHaveBeenCalled()
      expect(client.getSnapshot().recording).toBeNull()
    } finally { client.dispose() }
  })

  it('preserves group recording on rejected replay and clears it only when an exact episode commits', async () => {
    const { client, load } = fixture({ operation: 'policies', policies: readySnapshot().policies },
      { operation: 'simulate', simulation: fixtureSimulation },
      { operation: 'evaluations', evaluations: [evaluation], incompleteCount: 0 },
      { operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 1, mode: 'new-resimulation', simulation: fixtureSimulation },
      { operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0, mode: 'new-resimulation', simulation: fixtureSimulation },
      { operation: 'simulate', simulation: fixtureSimulation })
    const members = [{ id: 1, name: 'Duck', policyId: fixtureSimulation.policyId, projectRevisionId: null, x: 0, z: 0 }]
    try {
      await client.execute({ operation: 'policies' })
      await client.simulateGroup(members, 100, 0)
      const group = client.getSnapshot().groupRecording
      expect(group).not.toBeNull()
      await client.execute({ operation: 'evaluations' })
      await client.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
      expect(client.getSnapshot().groupRecording).toBe(group)
      expect(client.getSnapshot().recordingEvaluation).toBeNull()
      expect(load).toHaveBeenCalledOnce()
      await client.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
      expect(client.getSnapshot().groupRecording).toBeNull()
      expect(client.getSnapshot().recordingEvaluation).toEqual({ evaluationId: evaluation.id, episodeIndex: 0 })
      await client.simulateGroup(members, 100, 0)
      expect(client.getSnapshot().groupRecording).not.toBeNull()
      expect(client.getSnapshot().recordingEvaluation).toBeNull()
      expect(load).toHaveBeenCalledTimes(3)
    } finally { client.dispose() }
  })

  it('publishes a committed trial report despite a subsequent policy-list failure', async () => {
    const { client } = fixture({ operation: 'evaluate_trial', evaluation }, new Error('Runtime disappeared'))
    try {
      expect(await client.execute({ operation: 'evaluate_trial', trialId: trial.id })).toEqual({ operation: 'evaluate_trial', evaluation })
      expect(client.getSnapshot()).toMatchObject({ evaluations: [evaluation], evaluation, error: 'Runtime disappeared' })
    } finally { client.dispose() }
  })

  it('ignores a saved trial response after session disposal and never starts the run', async () => {
    let settle!: (result: RobotLabResult) => void
    const transport = vi.fn<LabTransport>(() => new Promise((resolve) => { settle = resolve }))
    const client = new LabClient(session, transport, 2000)
    const saving = client.saveTrial(trial.recipe, true)
    client.dispose()
    settle({ operation: 'save_trial', trial })
    expect(await saving).toBeNull()
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
