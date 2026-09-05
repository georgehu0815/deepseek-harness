import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotLabResult } from '@deepseek-ai/dsh-robot-lab/types'
import { LabClient } from '../src/client/lab-client.ts'
import type { LabTransport } from '../src/client/lab-client.ts'
import { fixtureIncompatibleRuns, fixtureRunningRun as running, fixtureUnavailableReadiness as unavailable,
  fixtureProject, fixturePreview, fixtureSimulation, fixtureCatalog, readySnapshot } from './fixtures.client.ts'

const session = 'session-one' as SessionId

afterEach(() => { vi.useRealTimers() })

describe('session-owned LabClient', () => {
  it('refreshes studio catalog and saved projects through the captured session', async () => {
    const data = readySnapshot()
    const transport = vi.fn<LabTransport>()
      .mockResolvedValueOnce({ operation: 'trials', trials: [] })
      .mockResolvedValueOnce({ operation: 'evaluations', evaluations: [], incompleteCount: 0 })
      .mockResolvedValueOnce({ operation: 'reflections', reflections: [] })
      .mockResolvedValueOnce({ operation: 'readiness', readiness: data.readiness! })
      .mockResolvedValueOnce({ operation: 'studio', catalog: fixtureCatalog })
      .mockResolvedValueOnce({ operation: 'projects', projects: [fixtureProject] })
      .mockResolvedValueOnce({ operation: 'behaviors', behaviors: data.behaviors })
      .mockResolvedValueOnce({ operation: 'policies', policies: data.policies })
      .mockResolvedValueOnce({ operation: 'runs', runs: [], incompatibleRuns: fixtureIncompatibleRuns })
      .mockResolvedValueOnce({ operation: 'scene', scene: { bodies: [], meshes: [], geoms: [], defaultJoints: [], jointNames: [] } })
    const client = new LabClient(session, transport, 2000)
    try {
      await client.refresh()
      expect(transport.mock.calls.map(([id, request]) => [id, request.operation])).toEqual(
        ['trials', 'evaluations', 'reflections', 'readiness', 'studio', 'projects', 'behaviors', 'policies', 'runs', 'scene'].map(operation => [session, operation]))
      expect(client.getSnapshot()).toMatchObject({ catalog: fixtureCatalog, projects: [fixtureProject], error: null,
        incompatibleRuns: fixtureIncompatibleRuns, recording: null })
    } finally { client.dispose() }
  })

  it('saves and previews the exact revision, initializing audio before publishing its recording', async () => {
    const transport = vi.fn<LabTransport>()
      .mockResolvedValueOnce({ operation: 'save_project', project: fixtureProject })
      .mockResolvedValueOnce({ operation: 'reference_preview', preview: fixturePreview })
    const load = vi.fn(() => { expect(client.getSnapshot().recording).toBeNull() })
    const client = new LabClient(session, transport, 2000, load)
    try {
      const saved = await client.saveProject(fixtureProject.recipe, true)
      expect(saved).toBe(fixtureProject)
      expect(transport.mock.calls.map(([, request]) => request)).toEqual([
        { operation: 'save_project', recipe: fixtureProject.recipe },
        { operation: 'reference_preview', projectRevisionId: fixtureProject.id },
      ])
      expect(load).toHaveBeenCalledExactlyOnceWith(fixturePreview, fixtureProject.recipe.music)
      expect(client.getSnapshot()).toMatchObject({ recording: fixturePreview, recordingProject: fixtureProject,
        projects: [fixtureProject], error: null })
    } finally { client.dispose() }
  })

  it('returns the committed revision even when subsequent reference preview fails', async () => {
    const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'save_project', project: fixtureProject })
      .mockRejectedValueOnce(new Error('forward kinematics unavailable'))
    const client = new LabClient(session, transport, 2000)
    try {
      expect(await client.saveProject(fixtureProject.recipe, true)).toBe(fixtureProject)
      expect(client.getSnapshot()).toMatchObject({ project: fixtureProject, recording: null,
        error: 'forward kinematics unavailable' })
    } finally { client.dispose() }
  })

  it('does not return a previously saved project when another save is busy or fails', async () => {
    let resolve!: (result: RobotLabResult) => void
    const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'project', project: fixtureProject })
      .mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockRejectedValueOnce(new Error('save denied'))
    const client = new LabClient(session, transport, 2000)
    try {
      await client.execute({ operation: 'project', projectRevisionId: fixtureProject.id })
      const busy = client.execute({ operation: 'projects' })
      expect(await client.saveProject(fixtureProject.recipe, false)).toBeNull()
      expect(transport).toHaveBeenCalledTimes(2)
      resolve({ operation: 'projects', projects: [fixtureProject] })
      await busy
      expect(await client.saveProject(fixtureProject.recipe, false)).toBeNull()
      expect(client.getSnapshot().error).toBe('save denied')
      expect(client.getSnapshot().project).toBe(fixtureProject)
    } finally { client.dispose() }
  })

  it('returns no saved revision for a disposed client or an ignored late save response', async () => {
    let resolve!: (result: RobotLabResult) => void
    const transport = vi.fn<LabTransport>().mockImplementation(() => new Promise((done) => { resolve = done }))
    const client = new LabClient(session, transport, 2000)
    const pending = client.saveProject(fixtureProject.recipe, true)
    client.dispose()
    resolve({ operation: 'save_project', project: fixtureProject })
    expect(await pending).toBeNull()
    expect(await client.saveProject(fixtureProject.recipe, true)).toBeNull()
    expect(client.getSnapshot().project).toBeNull()
    expect(client.getSnapshot().recording).toBeNull()
    expect(transport).toHaveBeenCalledExactlyOnceWith(session, { operation: 'save_project', recipe: fixtureProject.recipe })
  })

  it('rejects mismatched preview provenance without loading playback', async () => {
    const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'projects', projects: [fixtureProject] })
      .mockResolvedValueOnce({ operation: 'reference_preview', preview: { ...fixturePreview, projectSha256: 'other-revision' } })
    const load = vi.fn()
    const client = new LabClient(session, transport, 2000, load)
    try {
      await client.execute({ operation: 'projects' })
      await client.execute({ operation: 'reference_preview', projectRevisionId: fixtureProject.id })
      expect(client.getSnapshot().error).toContain('does not match a loaded project revision')
      expect(client.getSnapshot().recording).toBeNull()
      expect(load).not.toHaveBeenCalled()
    } finally { client.dispose() }
  })

  it('uses the policy run frozen soundtrack, never the newer authoring draft', async () => {
    const newer = { ...fixtureProject, recipe: { ...fixtureProject.recipe, music: { ...fixtureProject.recipe.music, seed: 99 } } }
    const run = { ...running, state: 'completed' as const, policyId: fixtureSimulation.policyId,
      policySha256: fixtureSimulation.policyHash, spec: { ...running.spec, projectSnapshot: fixtureProject } }
    const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'project', project: newer })
      .mockResolvedValueOnce({ operation: 'runs', runs: [run], incompatibleRuns: [] })
      .mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
    const load = vi.fn()
    const client = new LabClient(session, transport, 2000, load)
    try {
      await client.execute({ operation: 'project', projectRevisionId: newer.id })
      await client.execute({ operation: 'runs' })
      await client.execute({ operation: 'simulate', policyId: fixtureSimulation.policyId, steps: 100, seed: 0, command: [0, 0, 0] })
      expect(load).toHaveBeenCalledExactlyOnceWith(fixtureSimulation, fixtureProject.recipe.music)
      expect(client.getSnapshot().recordingProject).toBe(fixtureProject)
      expect(client.getSnapshot().project).toBe(newer)
    } finally { client.dispose() }
  })

  it('loads unassociated policy recordings silently rather than attaching another project soundtrack', async () => {
    const transport = vi.fn<LabTransport>().mockResolvedValueOnce({ operation: 'project', project: fixtureProject })
      .mockResolvedValueOnce({ operation: 'simulate', simulation: fixtureSimulation })
    const load = vi.fn()
    const client = new LabClient(session, transport, 2000, load)
    try {
      await client.execute({ operation: 'project', projectRevisionId: fixtureProject.id })
      await client.execute({ operation: 'simulate', policyId: fixtureSimulation.policyId, steps: 100, seed: 0, command: [0, 0, 0] })
      expect(load).toHaveBeenCalledExactlyOnceWith(fixtureSimulation, null)
      expect(client.getSnapshot().recordingProject).toBeNull()
    } finally { client.dispose() }
  })

  it('surfaces local music generation failure without invoking a remote operation', async () => {
    const transport = vi.fn<LabTransport>()
    const client = new LabClient(session, transport, 2000)
    try {
      await client.localAction('generate_music', () => { throw new Error('music sample budget exceeded') })
      expect(client.getSnapshot()).toMatchObject({ busy: null, error: 'music sample budget exceeded' })
      expect(transport).not.toHaveBeenCalled()
    } finally { client.dispose() }
  })

  it('loads metadata alongside unavailable readiness without querying scientific runtime data', async () => {
    const transport = vi.fn<LabTransport>()
      .mockResolvedValueOnce({ operation: 'trials', trials: [] })
      .mockResolvedValueOnce({ operation: 'evaluations', evaluations: [], incompleteCount: 0 })
      .mockResolvedValueOnce({ operation: 'reflections', reflections: [] })
      .mockResolvedValueOnce({ operation: 'readiness', readiness: unavailable })
    const client = new LabClient(session, transport, 2000)
    const before = client.getSnapshot()
    expect(client.getSnapshot()).toBe(before)
    const listener = vi.fn()
    const off = client.subscribe(listener)
    await client.refresh()
    expect(transport.mock.calls.map(([id, request]) => [id, request.operation])).toEqual(
      ['trials', 'evaluations', 'reflections', 'readiness'].map(operation => [session, operation]))
    expect(client.getSnapshot().readiness).toEqual(unavailable)
    expect(client.getSnapshot().scene).toBeNull()
    expect(client.getSnapshot().recording).toBeNull()
    expect(listener).toHaveBeenCalled()
    off()
    client.dispose()
  })

  it('publishes unsupported run diagnostics separately without fabricated runs or polling', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<LabTransport>().mockResolvedValue({ operation: 'runs', runs: [], incompatibleRuns: fixtureIncompatibleRuns })
    const client = new LabClient(session, transport, 2000)
    const changed = vi.fn()
    const off = client.subscribe(changed)
    try {
      expect(client.getSnapshot().incompatibleRuns).toEqual([])
      await client.execute({ operation: 'runs' })
      expect(client.getSnapshot()).toMatchObject({ runs: [], incompatibleRuns: fixtureIncompatibleRuns, error: null, busy: null })
      expect(client.getSnapshot().recording).toBeNull()
      expect(changed).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10000)
      expect(transport).toHaveBeenCalledExactlyOnceWith(session, { operation: 'runs' })
      transport.mockResolvedValueOnce({ operation: 'runs', runs: [], incompatibleRuns: [] })
      await client.execute({ operation: 'runs' })
      expect(client.getSnapshot().incompatibleRuns).toEqual([])
    } finally { off(); client.dispose() }
  })

  it('preserves unsupported diagnostics while publishing an independently admitted format-3 run', async () => {
    const transport = vi.fn<LabTransport>()
      .mockResolvedValueOnce({ operation: 'runs', runs: [], incompatibleRuns: fixtureIncompatibleRuns })
      .mockResolvedValueOnce({ operation: 'train', run: running })
      .mockResolvedValueOnce({ operation: 'policies', policies: [] })
    const client = new LabClient(session, transport, 2000)
    try {
      await client.execute({ operation: 'runs' })
      await client.execute({ operation: 'train', spec: running.spec })
      expect(client.getSnapshot().runs).toEqual([running])
      expect(client.getSnapshot().incompatibleRuns).toEqual(fixtureIncompatibleRuns)
      expect(client.getSnapshot().runs[0]).toMatchObject({ formatVersion: 3, spec: { backend: 'cpu' },
        provenance: { trainer: { backend: 'cpu', learnerDevice: 'cpu' } } })
      expect(client.getSnapshot().error).toBeNull()
    } finally { client.dispose() }
  })

  it('captures the owning session for every request', async () => {
    const transport = vi.fn<LabTransport>().mockResolvedValue({ operation: 'policies', policies: [] })
    const first = new LabClient(session, transport, 2000)
    const secondId = 'session-two' as SessionId
    const second = new LabClient(secondId, transport, 2000)
    await first.execute({ operation: 'policies' })
    await second.execute({ operation: 'policies' })
    expect(transport.mock.calls.map(call => call[0])).toEqual([session, secondId])
    first.dispose(); second.dispose()
  })

  it('retains an operation failure instead of advertising success', async () => {
    const client = new LabClient(session, vi.fn().mockRejectedValue(new Error('training denied')), 2000)
    await client.execute({ operation: 'train', spec: running.spec })
    expect(client.getSnapshot().error).toBe('training denied')
    expect(client.getSnapshot().runs).toEqual([])
    expect(client.getSnapshot().busy).toBeNull()
    client.dispose()
  })

  it('rejects a mismatched reply before changing result state', async () => {
    const client = new LabClient(session, vi.fn<LabTransport>().mockResolvedValue({ operation: 'policies', policies: [] }), 2000)
    await client.execute({ operation: 'runs' })
    expect(client.getSnapshot().error).toContain('response mismatch')
    client.dispose()
  })

  it('ignores late responses and cannot start requests after disposal', async () => {
    let resolve!: (result: RobotLabResult) => void
    const transport = vi.fn(() => new Promise<RobotLabResult>((done) => { resolve = done }))
    const client = new LabClient(session, transport, 2000)
    const listener = vi.fn()
    client.subscribe(listener)
    const pending = client.execute({ operation: 'runs' })
    client.dispose()
    const count = listener.mock.calls.length
    resolve({ operation: 'runs', runs: [running], incompatibleRuns: [] })
    await pending
    await client.execute({ operation: 'runs' })
    expect(listener).toHaveBeenCalledTimes(count)
    expect(client.getSnapshot().runs).toEqual([])
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('polls active runs and cancels the timer on disposal without stopping training', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<LabTransport>().mockResolvedValue({ operation: 'runs', runs: [running], incompatibleRuns: [] })
    const client = new LabClient(session, transport, 2000)
    await client.execute({ operation: 'runs' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(transport).toHaveBeenCalledTimes(2)
    client.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls.every(call => call[1].operation === 'runs')).toBe(true)
  })
})
