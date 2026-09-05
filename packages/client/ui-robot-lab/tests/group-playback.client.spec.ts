import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotEvaluation, RobotEvaluationId, RobotLabRequest, RobotLabResult, RobotPolicy, RobotPolicyId } from '@deepseek-ai/dsh-robot-lab/types'
import { LabClient } from '../src/client/lab-client.ts'
import type { LabTransport } from '../src/client/lab-client.ts'
import type { DuckMember } from '../src/client/group-playback.ts'
import { fixturePreview, fixtureProject, fixtureRunningRun, fixtureSimulation, readySnapshot, sourceFrame } from './fixtures.client.ts'

const session = 'group-session' as SessionId
const firstPolicy = readySnapshot().policies[0]!
const secondPolicy: RobotPolicy = { ...firstPolicy, id: 'policy-two' as RobotPolicyId, sha256: 'second-hash',
  observationProfile: 'microduck-standard-61' }
const secondSimulation = { ...fixtureSimulation, policyId: secondPolicy.id, policyHash: secondPolicy.sha256,
  observationProfile: secondPolicy.observationProfile, frames: [sourceFrame({ time: 0.02 }), sourceFrame({ time: 0.6 })] }
function members(): DuckMember[] {
  return [
    { id: 1, name: 'First duck', policyId: firstPolicy.id, projectRevisionId: fixtureProject.id, x: -1, z: 0 },
    { id: 2, name: 'Second duck', policyId: secondPolicy.id, projectRevisionId: null, x: 1, z: 0 },
  ]
}
async function setup(policies = [firstPolicy, secondPolicy]) {
  const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'policies', policies })
  const load = vi.fn()
  const client = new LabClient(session, transport, 2000, load)
  await client.execute({ operation: 'policies' })
  transport.mockClear()
  return { client, transport, load }
}
async function loadEvaluation(client: LabClient, transport: ReturnType<typeof vi.fn<LabTransport>>, id: RobotEvaluationId) {
  const evaluation: RobotEvaluation = { id, createdAt: '2026-09-05', evaluatedAt: '2026-09-05',
    policyId: fixtureSimulation.policyId, policyHash: fixtureSimulation.policyHash,
    physics: fixtureSimulation.physics, observationProfile: fixtureSimulation.observationProfile,
    spec: { policyId: fixtureSimulation.policyId, episodes: 1, stepsPerEpisode: 100, seed: 0,
      maxTerminations: 0, minMeanUprightFraction: 0.9 },
    episodes: [{ seed: 0, steps: 100, terminated: true, reward: 0, uprightFraction: 1, poseRmse: null, bamSettings: {} }],
    passed: false, limitations: ['Simulation only'] }
  transport.mockResolvedValueOnce({ operation: 'evaluations', evaluations: [evaluation], incompleteCount: 0 })
  await client.execute({ operation: 'evaluations' })
}
function simulations(transport: ReturnType<typeof vi.fn<LabTransport>>) {
  transport.mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
    .mockResolvedValueOnce({ operation: 'simulate', simulation: secondSimulation })
}

// Groups combine independently recorded physics, not additional robots in one environment.
describe('independent group recording', () => {
  it('loads mixed policies without retiming and uses the first run’s frozen soundtrack despite another tempo or newer draft', async () => {
    const { client, transport, load } = await setup()
    try {
      const run = { ...fixtureRunningRun, state: 'completed' as const, policyId: firstPolicy.id,
        policySha256: firstPolicy.sha256, spec: { ...fixtureRunningRun.spec, projectSnapshot: fixtureProject } }
      const otherProject = { ...fixtureProject, recipe: { ...fixtureProject.recipe,
        music: { ...fixtureProject.recipe.music, bpm: 96 } } }
      const otherRun = { ...run, id: 'run-second' as typeof run.id, policyId: secondPolicy.id,
        policySha256: secondPolicy.sha256, spec: { ...run.spec, projectSnapshot: otherProject } }
      transport.mockResolvedValueOnce({ operation: 'runs', runs: [otherRun, run], incompatibleRuns: [] })
      await client.execute({ operation: 'runs' })
      transport.mockResolvedValueOnce({ operation: 'project', project: otherProject })
      await client.execute({ operation: 'project', projectRevisionId: otherProject.id })
      transport.mockClear()
      simulations(transport)
      const roster = members()
      load.mockImplementation(() => { expect(client.getSnapshot().groupRecording).toBeNull() })
      await client.simulateGroup(roster, 100, 7)
      expect(transport.mock.calls).toEqual(roster.map(member => [session,
        { operation: 'simulate', policyId: member.policyId, steps: 100, seed: 7, command: [0, 0, 0] }]))
      expect(load).toHaveBeenCalledExactlyOnceWith(fixtureSimulation, fixtureProject.recipe.music, 0.6)
      expect(client.getSnapshot()).toMatchObject({ recording: fixtureSimulation, recordingProject: fixtureProject,
        recordingEvaluation: null, busy: null, error: null,
        groupRecording: { duration: 0.6, tracks: [{ member: roster[0], simulation: fixtureSimulation },
          { member: roster[1], simulation: secondSimulation }] } })
    } finally { client.dispose() }
  })

  it('captures membership before notifications and waits for each response without publishing partial tracks', async () => {
    const { client, transport, load } = await setup()
    try {
      const roster = members()
      const expected = roster.map(member => ({ ...member }))
      const first = Promise.withResolvers<RobotLabResult>()
      const second = Promise.withResolvers<RobotLabResult>()
      transport.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      client.subscribe(() => {
        if (client.getSnapshot().busy !== 'simulate_group') return
        roster[0]!.name = 'Changed during notification'
        roster[1]!.policyId = firstPolicy.id
        roster[1]!.x = 100
      })
      const pending = client.simulateGroup(roster, 100, 9)
      roster.reverse()
      roster.push({ ...expected[0]!, id: 3 })
      expect(transport).toHaveBeenCalledTimes(1)
      first.resolve({ operation: 'simulate', simulation: fixtureSimulation })
      await Promise.resolve()
      expect(transport).toHaveBeenCalledTimes(2)
      expect(load).not.toHaveBeenCalled()
      expect(client.getSnapshot().groupRecording).toBeNull()
      expect(client.getSnapshot().recording).toBeNull()
      second.resolve({ operation: 'simulate', simulation: secondSimulation })
      await pending
      expect(client.getSnapshot().groupRecording?.tracks.map(track => track.member)).toEqual(expected)
      expect(client.getSnapshot().groupRecording?.tracks[0]?.member).not.toBe(roster[1])
      expect(client.getSnapshot().recordingProject).toBeNull()
      expect(load).toHaveBeenCalledExactlyOnceWith(fixtureSimulation, null, 0.6)
    } finally { client.dispose() }
  })

  it.each(['null', 'missing', 'unavailable'] as const)('rejects a %s policy on the last duck before any simulation', async (mode) => {
    const policies = [firstPolicy, { ...secondPolicy, runtimeCompatibility: { available: mode !== 'unavailable', reason: 'Unavailable' } }]
    const { client, transport, load } = await setup(policies)
    try {
      const roster = members()
      if (mode === 'null') roster[1]!.policyId = null
      if (mode === 'missing') roster[1]!.policyId = 'missing' as RobotPolicyId
      await client.simulateGroup(roster, 100, 0)
      expect(transport).not.toHaveBeenCalled()
      expect(load).not.toHaveBeenCalled()
      expect(client.getSnapshot().error).toBe('Second duck (2): Select an available policy.')
    } finally { client.dispose() }
  })

  it('replaces evaluation replay provenance only after the complete group succeeds', async () => {
    const { client, transport, load } = await setup()
    try {
      const evaluationId = 'eval-before-group' as RobotEvaluationId
      await loadEvaluation(client, transport, evaluationId)
      transport.mockResolvedValueOnce({ operation: 'replay_evaluation', evaluationId, episodeIndex: 0,
        mode: 'new-resimulation', simulation: fixtureSimulation })
      await client.execute({ operation: 'replay_evaluation', evaluationId, episodeIndex: 0 })
      transport.mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
        .mockRejectedValueOnce(new Error('Second failed'))
      load.mockClear()
      await client.simulateGroup(members(), 100, 0)
      expect(client.getSnapshot().recordingEvaluation).toEqual({ evaluationId, episodeIndex: 0 })
      expect(load).not.toHaveBeenCalled()
      simulations(transport)
      await client.simulateGroup(members(), 100, 0)
      expect(client.getSnapshot().recordingEvaluation).toBeNull()
      expect(load).toHaveBeenCalledTimes(1)
    } finally { client.dispose() }
  })

  it('rejects an empty roster without disturbing playback', async () => {
    const { client, transport, load } = await setup()
    try {
      await client.simulateGroup([], 100, 0)
      expect(client.getSnapshot().error).toContain('at least one duck')
      expect(transport).not.toHaveBeenCalled()
      expect(load).not.toHaveBeenCalled()
    } finally { client.dispose() }
  })

  it.each(['failure', 'failure-string', 'operation', 'policy', 'hash', 'empty', 'zero', 'nonfinite'] as const)(
    'preserves the previous complete recording when the second track has %s', async (mode) => {
      const { client, transport, load } = await setup()
      try {
        simulations(transport)
        await client.simulateGroup(members(), 100, 0)
        const previous = client.getSnapshot()
        transport.mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
        if (mode === 'failure') transport.mockRejectedValueOnce(new Error('Second simulation failed'))
        else if (mode === 'failure-string') transport.mockRejectedValueOnce('Second simulation failed')
        else if (mode === 'operation') transport.mockResolvedValueOnce({ operation: 'policies', policies: [] })
        else transport.mockResolvedValueOnce({ operation: 'simulate', simulation: {
          ...secondSimulation,
          ...(mode === 'policy' ? { policyId: firstPolicy.id } : {}),
          ...(mode === 'hash' ? { policyHash: 'changed-artifact' } : {}),
          ...(mode === 'empty' ? { frames: [] } : {}),
          ...(mode === 'zero' ? { frames: [sourceFrame({ time: 0 })] } : {}),
          ...(mode === 'nonfinite' ? { frames: [sourceFrame({ time: NaN })] } : {}),
        } })
        load.mockClear()
        await client.simulateGroup(members(), 100, 0)
        expect(client.getSnapshot().error).toMatch(/^Second duck \(2\): /)
        if (mode === 'failure') expect(client.getSnapshot().error).toBe('Second duck (2): Second simulation failed')
        expect(client.getSnapshot().groupRecording).toBe(previous.groupRecording)
        expect(client.getSnapshot().recording).toBe(previous.recording)
        expect(client.getSnapshot().recordingProject).toBe(previous.recordingProject)
        expect(load).not.toHaveBeenCalled()
      } finally { client.dispose() }
    })

  it('ignores another group or single action while busy', async () => {
    const { client, transport } = await setup()
    try {
      const response = Promise.withResolvers<RobotLabResult>()
      transport.mockReturnValueOnce(response.promise)
      const pending = client.simulateGroup(members().slice(0, 1), 100, 0)
      await client.simulateGroup(members(), 200, 1)
      await client.execute({ operation: 'projects' })
      expect(transport).toHaveBeenCalledTimes(1)
      expect(client.getSnapshot().busy).toBe('simulate_group')
      response.resolve({ operation: 'simulate', simulation: fixtureSimulation })
      await pending
      expect(client.getSnapshot().busy).toBeNull()
    } finally { client.dispose() }
  })

  it.each([0, 1])('suppresses late track %i after disposal and leaves previous playback loaded', async (index) => {
    const { client, transport, load } = await setup()
    simulations(transport)
    await client.simulateGroup(members(), 100, 0)
    const previous = client.getSnapshot()
    transport.mockClear()
    load.mockClear()
    const response = Promise.withResolvers<RobotLabResult>()
    if (index === 1) transport.mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
    transport.mockReturnValueOnce(response.promise)
    const pending = client.simulateGroup(members(), 100, 0)
    if (index === 1) await Promise.resolve()
    client.dispose()
    response.resolve({ operation: 'simulate', simulation: index === 0 ? fixtureSimulation : secondSimulation })
    await pending
    await client.simulateGroup(members(), 100, 0)
    expect(transport).toHaveBeenCalledTimes(index + 1)
    expect(load).not.toHaveBeenCalled()
    expect(client.getSnapshot().groupRecording).toBe(previous.groupRecording)
    expect(client.getSnapshot().recording).toBe(previous.recording)
  })

  it('sends no requests when a busy notification disposes the client', async () => {
    const { client, transport, load } = await setup()
    client.subscribe(() => { client.dispose() })
    await client.simulateGroup(members(), 100, 0)
    expect(transport).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['simulate', 'reference_preview', 'replay_evaluation'] as const)('clears the group only after successful single %s', async (operation) => {
    const { client, transport, load } = await setup()
    try {
      transport.mockResolvedValueOnce({ operation: 'projects', projects: [fixtureProject] })
      await client.execute({ operation: 'projects' })
      simulations(transport)
      await client.simulateGroup(members(), 100, 0)
      const group = client.getSnapshot().groupRecording
      const evaluationId = 'eval-one' as RobotEvaluationId
      if (operation === 'replay_evaluation') await loadEvaluation(client, transport, evaluationId)
      const request: RobotLabRequest = operation === 'simulate'
        ? { operation, policyId: firstPolicy.id, steps: 100, seed: 0, command: [0, 0, 0] }
        : operation === 'reference_preview' ? { operation, projectRevisionId: fixtureProject.id }
          : { operation, evaluationId, episodeIndex: 0 }
      transport.mockRejectedValueOnce(new Error('Single failed'))
      await client.execute(request)
      expect(client.getSnapshot().groupRecording).toBe(group)
      const result: RobotLabResult = operation === 'simulate' ? { operation, simulation: fixtureSimulation }
        : operation === 'reference_preview' ? { operation, preview: fixturePreview }
          : { operation, simulation: fixtureSimulation, evaluationId, episodeIndex: 0, mode: 'new-resimulation' }
      transport.mockResolvedValueOnce(result)
      load.mockClear()
      await client.execute(request)
      expect(client.getSnapshot().groupRecording).toBeNull()
      expect(client.getSnapshot().recording).toBe(operation === 'reference_preview' ? fixturePreview : fixtureSimulation)
      expect(load).toHaveBeenCalledTimes(1)
      expect(load.mock.calls[0]).toHaveLength(2)
    } finally { client.dispose() }
  })
})
