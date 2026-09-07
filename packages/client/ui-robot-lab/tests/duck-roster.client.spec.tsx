// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import type { RobotPolicyId } from '@deepseek-ai/dsh-robot-lab/types'
import { createRobotStore } from '../src/client/store.ts'
import { StudioPlayer } from '../src/client/StudioPlayer.tsx'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { RobotViewer } from '../src/client/RobotViewer.tsx'
import { fixtureProject, fixtureSimulation, readySnapshot, sourceFrame } from './fixtures.client.ts'
import { pausedPlayback, studioFixture } from './studio-fixtures.client.tsx'

vi.mock('../src/client/RobotViewer.tsx', () => ({ RobotViewer: vi.fn(() => <div data-testid="group-stage" />) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('duck roster draft', () => {
  it('adds, duplicates and removes stable members without sharing policy mutations', () => {
    const store = createRobotStore(4, 3).create()
    store.actions.updateDuck(1, { name: 'Lead 🦆', policyId: fixtureSimulation.policyId, projectRevisionId: fixtureProject.id })
    store.actions.duplicateDuck(1)
    store.actions.addDuck()
    store.actions.addDuck()
    store.actions.duplicateDuck(1)
    expect(store.getSnapshot().ducks).toHaveLength(3)
    store.actions.updateDuck(2, { policyId: null })
    expect(store.getSnapshot().ducks[0]!.policyId).toBe(fixtureSimulation.policyId)
    expect(store.getSnapshot().ducks[1]).toMatchObject({ name: 'Lead 🦆 copy', projectRevisionId: fixtureProject.id, policyId: null })
    store.actions.selectDuck(3)
    store.actions.removeDuck(3)
    expect(store.getSnapshot().selectedDuck).toBe(1)
    store.actions.removeDuck(2)
    store.actions.removeDuck(1)
    expect(store.getSnapshot().ducks).toHaveLength(1)
    store.actions.addDuck()
    expect(store.getSnapshot().ducks[1]!.id).toBe(4)
    expect(createRobotStore().create().getSnapshot().ducks).toHaveLength(1)
  })

  it('arranges line, grid and circle spacing without changing a training project', () => {
    const store = createRobotStore().create()
    for (let i = 0; i < 3; i++) store.actions.addDuck()
    store.actions.arrangeDucks('line', 1)
    expect(store.getSnapshot().ducks.map(duck => [duck.x, duck.z])).toEqual([[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]])
    store.actions.arrangeDucks('grid', 1)
    expect(store.getSnapshot().ducks.map(duck => [duck.x, duck.z])).toEqual([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
    store.actions.arrangeDucks('circle', 1)
    const [first, second] = store.getSnapshot().ducks
    expect(Math.hypot(first!.x - second!.x, first!.z - second!.z)).toBeCloseTo(1)
    store.actions.trainDuck(2, fixtureProject)
    expect(store.getSnapshot()).toMatchObject({ trainingDuck: 2, selectedDuck: 2, page: 'train', savedRevisionId: fixtureProject.id })
    store.actions.removeDuck(2)
    expect(store.getSnapshot().trainingDuck).toBeNull()
  })
})

describe('independent group controls', () => {
  it('exports the draft and reads a selected group file without starting playback', async () => {
    const fixture = studioFixture()
    const view = render(<StudioPlayer {...fixture.props} />)
    fireEvent.click(view.getByRole('button', { name: 'Save group file' }))
    expect(fixture.saveRoster).toHaveBeenCalledWith({ version: 1, members: fixture.store.getSnapshot().ducks, formation: 'line', spacing: 0.6 })
    const text = vi.fn().mockResolvedValue('{"version":1}')
    fireEvent.change(view.getByLabelText('Load group file'), { target: { files: [{ size: 20, text }] } })
    await waitFor(() => { expect(fixture.loadRoster).toHaveBeenCalledWith('{"version":1}') })
    expect(fixture.play).not.toHaveBeenCalled()
    expect(fixture.simulateGroup).not.toHaveBeenCalled()
  })

  it('rejects oversized files before reading and exposes file read failures', async () => {
    const fixture = studioFixture()
    const view = render(<StudioPlayer {...fixture.props} />)
    const text = vi.fn().mockRejectedValue(new Error('Cannot read file'))
    fireEvent.change(view.getByLabelText('Load group file'), { target: { files: [{ size: 1048577, text }] } })
    expect(view.getByRole('alert').textContent).toBe('Group file exceeds the 1 MiB limit.')
    expect(text).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Load group file'), { target: { files: [{ size: 10, text }] } })
    await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Cannot read file') })
    expect(fixture.loadRoster).not.toHaveBeenCalled()
  })
  it('requires explicit policies, manages each duck and sends the selected formation', () => {
    const snapshot = readySnapshot()
    snapshot.policies.push({ ...snapshot.policies[0]!, id: 'other-policy' as RobotPolicyId, name: 'Second routine' })
    const fixture = studioFixture(snapshot)
    const view = render(<StudioPlayer {...fixture.props} />)
    const record = view.getByRole('button', { name: 'Record group dance' })
    expect(record.hasAttribute('disabled')).toBe(true)
    fireEvent.change(view.getByLabelText('Duck 1 policy'), { target: { value: fixtureSimulation.policyId } })
    fireEvent.click(view.getByRole('button', { name: '+ Add duck' }))
    fireEvent.change(view.getByLabelText('Duck name'), { target: { value: 'Partner' } })
    expect(record.hasAttribute('disabled')).toBe(true)
    fireEvent.change(view.getByLabelText('Duck 2 policy'), { target: { value: 'other-policy' } })
    fireEvent.change(view.getByLabelText('Formation'), { target: { value: 'grid' } })
    fireEvent.change(view.getByLabelText('Spacing (meters)'), { target: { value: '1' } })
    fireEvent.click(record)
    expect(fixture.simulateGroup).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, policyId: fixtureSimulation.policyId, x: -0.5 }),
      expect.objectContaining({ id: 2, name: 'Partner', policyId: 'other-policy', x: 0.5 }),
    ], 1000, 0)
    expect(fixture.execute).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Duplicate duck' }))
    expect((view.getByLabelText('Duck 3 policy') as HTMLSelectElement).value).toBe('other-policy')
    fireEvent.click(view.getByRole('button', { name: 'Remove duck' }))
    expect(view.queryByLabelText('Duck 3 policy')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Refresh policies' }))
    expect(fixture.refresh).toHaveBeenCalledOnce()
  })

  it('keeps incompatible policies visible but prevents recording and admission while busy', () => {
    const snapshot = readySnapshot()
    snapshot.policies[0]!.runtimeCompatibility = { available: false, reason: 'Runtime changed' }
    const fixture = studioFixture(snapshot)
    fixture.store.actions.updateDuck(1, { policyId: fixtureSimulation.policyId })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Runtime changed')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Record group dance' }).hasAttribute('disabled')).toBe(true)
    snapshot.busy = 'simulate_group'
    view.rerender(<StudioPlayer {...fixture.props} />)
    expect(view.getByRole('button', { name: 'Recording ducks…' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: '+ Add duck' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens individual project training without starting a run or overwriting an unsaved draft', () => {
    const snapshot = { ...readySnapshot(), projects: [fixtureProject] }
    const fixture = studioFixture(snapshot)
    const view = render(<StudioPlayer {...fixture.props} />)
    fireEvent.change(view.getByLabelText('Training project'), { target: { value: fixtureProject.id } })
    fireEvent.click(view.getByRole('button', { name: 'Set up individual training' }))
    expect(fixture.store.getSnapshot()).toMatchObject({ trainingDuck: 1, page: 'train', savedRevisionId: fixtureProject.id })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.saveTrial).not.toHaveBeenCalled()
    act(() => { fixture.store.actions.projectName('Unsaved edits') })
    expect(view.getByRole('button', { name: 'Set up individual training' }).hasAttribute('disabled')).toBe(true)
    view.unmount()
    const center = render(<MicroDuckPanel {...fixture.props} />)
    expect(center.getByText('Individual training for Duck 1')).toBeTruthy()
    fireEvent.click(center.getByRole('button', { name: 'Leave duck training setup' }))
    expect(fixture.store.getSnapshot().trainingDuck).toBeNull()
  })

  it.each([
    { state: 'paused' as const, sameHash: false }, { state: 'playing' as const, sameHash: false },
    { state: 'paused' as const, sameHash: true }, { state: 'playing' as const, sameHash: true },
  ])('preserves the group viewport and clock on duck selection ($state, same hash: $sameHash)', ({ state, sameHash }) => {
    const second = { ...fixtureSimulation, policyId: 'second-policy' as RobotPolicyId,
      policyHash: sameHash ? fixtureSimulation.policyHash : 'second-policy-hash',
      frames: [sourceFrame({ time: 0 }), sourceFrame({ time: 0.5,
        telemetry: { ...sourceFrame().telemetry, rootSpeed: 1.2 } }), sourceFrame({ time: 2 })] }
    const tracks = [fixtureSimulation, second].map((simulation, index) => ({ simulation,
      member: { id: index + 1, name: `Duck ${index + 1}`, policyId: simulation.policyId, projectRevisionId: null, x: index, z: 0 } }))
    const snapshot = { ...readySnapshot(), recording: fixtureSimulation, groupRecording: { tracks, duration: 2 } }
    const playback = { ...pausedPlayback, state, time: 0.75 }
    const fixture = studioFixture(snapshot, playback)
    fixture.store.actions.addDuck()
    fixture.store.actions.selectDuck(1)
    const mounted = vi.fn()
    const disposed = vi.fn()
    const viewer = vi.mocked(RobotViewer)
    const previous = viewer.getMockImplementation()!
    // The mock retains React lifecycle so changing the parent's key still destroys the viewport instance.
    viewer.mockImplementation(function ViewerProbe() {
      useEffect(() => { mounted(); return () => { disposed() } }, [])
      return <div data-testid="group-stage" />
    })
    const view = render(<StudioPlayer {...fixture.props} />)
    try {
      const stage = view.getByTestId('group-stage')
      const before = viewer.mock.lastCall![0]
      expect(before.frames).toBe(fixtureSimulation.frames)
      expect(before.groupTracks).toBe(tracks)
      expect(before.selectedDuck).toBe(1)
      expect(before.playing).toBe(state === 'playing')
      expect(view.getByText('0.300 m/s')).toBeTruthy()
      for (const id of [2, 1, 2]) {
        fireEvent.change(view.getByLabelText('Recorded duck'), { target: { value: String(id) } })
        const current = viewer.mock.lastCall![0]
        expect(current.frames).toBe(before.frames)
        expect(current.groupTracks).toBe(before.groupTracks)
        expect(current.selectedDuck).toBe(id)
        expect(current.readTime).toBe(before.readTime)
        expect(current.readTime()).toBe(0.75)
        expect(current.time).toBe(0.75)
        expect(current.playing).toBe(before.playing)
        expect(view.getByText(id === 2 ? '1.200 m/s' : '0.300 m/s')).toBeTruthy()
        expect(view.getByTestId('group-stage')).toBe(stage)
        expect(mounted).toHaveBeenCalledOnce()
        expect(disposed).not.toHaveBeenCalled()
      }
      for (const callback of [fixture.play, fixture.pause, fixture.restartPlayback, fixture.seek,
        fixture.playWithoutMusic, fixture.setPlaybackRate, fixture.simulateGroup, fixture.execute]) {
        expect(callback).not.toHaveBeenCalled()
      }
      expect(playback).toMatchObject({ state, time: 0.75, duration: 2 })
    } finally {
      view.unmount()
      viewer.mockImplementation(previous)
    }
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('renders frozen tracks and warns about subsequent roster edits', () => {
    const fixture = studioFixture()
    fixture.store.actions.updateDuck(1, { policyId: fixtureSimulation.policyId })
    fixture.store.actions.duplicateDuck(1)
    const tracks = fixture.store.getSnapshot().ducks.map(member => ({ member: { ...member }, simulation: fixtureSimulation }))
    const snapshot = { ...readySnapshot(), recording: fixtureSimulation, groupRecording: { tracks, duration: 2 } }
    const props = { ...fixture.props,
      useLab: (select: Parameters<typeof fixture.props.useLab>[0]) => select(snapshot) } as typeof fixture.props
    const view = render(<StudioPlayer {...props} />)
    expect(view.getByText('2 ducks · Independent group replay')).toBeTruthy()
    expect(vi.mocked(RobotViewer).mock.lastCall![0].groupTracks).toBe(tracks)
    expect(view.queryByText(/Roster changed/)).toBeNull()
    fireEvent.change(view.getByLabelText('Duck name'), { target: { value: 'New draft name' } })
    expect(view.getByText(/Roster changed/)).toBeTruthy()
    expect(tracks[1]!.member.name).toBe('Duck 1 copy')
    fireEvent.change(view.getByLabelText('Recorded duck'), { target: { value: '1' } })
    expect(vi.mocked(RobotViewer).mock.lastCall![0].selectedDuck).toBe(1)
  })
})
