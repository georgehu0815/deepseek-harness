// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotPolicyId } from '@deepseek-ai/dsh-robot-lab/types'
import { RobotLab } from '../src/client/RobotLab.tsx'
import type { RobotLabProps } from '../src/client/RobotLab.tsx'
import { StudioPlayer } from '../src/client/StudioPlayer.tsx'
import { RobotViewer } from '../src/client/RobotViewer.tsx'
import { PlaybackTransport } from '../src/client/playback-transport.ts'
import { fixturePreview, fixtureProject, fixtureSimulation, fixtureBlockProject, readySnapshot } from './fixtures.client.ts'
import { pausedPlayback, studioFixture } from './studio-fixtures.tsx'

vi.mock('../src/client/RobotViewer.tsx', () => ({ RobotViewer: vi.fn(() => <div data-testid="recorded-robot" />) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function recorded() {
  return { ...readySnapshot(), recording: fixtureSimulation, recordingProject: fixtureProject,
    scene: { bodies: ['body'], meshes: [], geoms: [], defaultJoints: [], jointNames: [] } }
}

describe('Robot Studio session wrapper', () => {
  it('renders no-session guidance without store/data callbacks and adopts or loses the selected session', () => {
    let session: SessionId | undefined
    const renderSlot = vi.fn(() => <div>Session player</div>)
    const props = { width: 480, renderSlot,
      SessionProvider: ({ empty, children }) => session === undefined ? empty?.() : children,
    } as RobotLabProps
    const view = render(<RobotLab {...props} />)
    expect(view.getByRole('status').textContent).toBe('Select an existing session, or send your first message to create one.')
    expect(view.queryByRole('button')).toBeNull()
    expect(renderSlot).toHaveBeenCalledWith('robot-lab.visual.player', {})
    session = 'session-one' as SessionId
    view.rerender(<RobotLab {...props} />)
    expect(view.getByText('Session player')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('robot-lab.visual.player', {})
    session = undefined
    view.rerender(<RobotLab {...props} />)
    expect(view.queryByText('Session player')).toBeNull()
    expect(view.getByRole('status')).toBeTruthy()
  })
})

describe('synchronized Studio player', () => {
  it.each([null, recorded().scene])('opens the grid without a recording or automatic backend action (scene %#)', (scene) => {
    const fixture = studioFixture({ ...readySnapshot(), scene })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByTestId('recorded-robot')).toBeTruthy()
    expect(view.getByText('No performance loaded')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Play recording' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: 'Preview standing policy' })).toBeTruthy()
    expect(vi.mocked(RobotViewer).mock.lastCall![0]).toMatchObject({ scene, frames: [], playing: false, surface: 'studio', cameraView: 'perspective' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.play).not.toHaveBeenCalled()
    expect(fixture.playWithoutMusic).not.toHaveBeenCalled()
  })

  it('pauses the shared transport when the renderer fails without trying to autoplay', () => {
    const fixture = studioFixture(recorded(), { ...pausedPlayback, state: 'playing', mode: 'music' })
    const viewer = vi.mocked(RobotViewer)
    const previous = viewer.getMockImplementation()!
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    viewer.mockImplementation(() => { throw new Error('WebGL context creation failed') })
    try {
      const view = render(<StudioPlayer {...fixture.props} />)
      expect(view.getByRole('alert').textContent).toBe('Renderer unavailable: WebGL context creation failed')
      expect(view.queryByTestId('recorded-robot')).toBeNull()
      expect(fixture.pause).toHaveBeenCalledOnce()
      expect(fixture.play).not.toHaveBeenCalled()
      expect(fixture.playWithoutMusic).not.toHaveBeenCalled()
      expect(fixture.restartPlayback).not.toHaveBeenCalled()
      expect(fixture.execute).not.toHaveBeenCalled()
      view.unmount()
    } finally {
      viewer.mockImplementation(previous)
      consoleError.mockRestore()
    }
  })

  it('keeps active block labels and saved BPM bound to the recording while the current draft changes', () => {
    const snapshot = { ...recorded(), recordingProject: fixtureBlockProject }
    const playback = { ...pausedPlayback, time: 1.99 }
    const fixture = studioFixture(snapshot, playback)
    fixture.store.actions.loadProject(fixtureBlockProject)
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Move 1 / 2 · Beats 1–4')).toBeTruthy()
    act(() => {
      fixture.store.actions.projectName('Unrelated new draft')
      fixture.store.actions.parameters({ bpm: 60 })
      fixture.store.actions.blocks([...fixtureBlockProject.recipe.blocks!].reverse())
    })
    expect(view.getByText('My routine · frozen revision')).toBeTruthy()
    expect(view.queryByText('Unrelated new draft')).toBeNull()
    expect(view.getByText('120 BPM')).toBeTruthy()
    playback.time = 2
    view.rerender(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Move 2 / 2 · Beats 5–8')).toBeTruthy()
    expect(view.getByText('Hello')).toBeTruthy()
    playback.time = 4
    view.rerender(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Move 2 / 2 · Beats 5–8')).toBeTruthy()
    expect(view.getByLabelText('Beat 4 of four')).toBeTruthy()
  })

  it('drives the real shared transport rate without changing the saved recipe or measured physics speed', async () => {
    let now = 0
    const transport = new PlaybackTransport({ sampleRate: 22050, maxDurationSeconds: 10, maxSamples: 220500,
      hudIntervalMs: 10000, now: () => now, createAudioContext: () => null, visibility: null })
    transport.load({ id: 'performance', duration: 2, music: null })
    const fixture = studioFixture(recorded())
    const props = { ...fixture.props,
      usePlayback: (selector: Parameters<typeof fixture.props.usePlayback>[0]) => selector(useSyncExternalStore(
        listener => transport.subscribe(listener), () => transport.getSnapshot())),
      setPlaybackRate: (rate: number) => { transport.setRate(rate) }, readTime: () => transport.getTime(),
      pause: () => { transport.pause() },
    } as typeof fixture.props
    const view = render(<StudioPlayer {...props} />)
    try {
      const rates = view.getByLabelText('Replay speed') as HTMLSelectElement
      expect(Array.from(rates.options, item => item.value)).toEqual(['0.5', '1', '1.5', '2'])
      await act(async () => { await transport.play() })
      now = 0.5
      fireEvent.change(rates, { target: { value: '2' } })
      expect(transport.getSnapshot().rate).toBe(2)
      expect(rates.value).toBe('2')
      expect(view.getByText(/Replay only: music tempo and pitch change/)).toBeTruthy()
      expect(transport.getTime()).toBe(0.5)
      now = 1
      act(() => { transport.pause() })
      expect(transport.getSnapshot().time).toBe(1.5)
      expect(view.getByText('0.300 m/s')).toBeTruthy()
      expect(view.getByText('120 BPM')).toBeTruthy()
      expect(fixtureProject.recipe.music.bpm).toBe(120)
      expect(fixture.execute).not.toHaveBeenCalled()
      expect(fixture.saveProject).not.toHaveBeenCalled()
      view.unmount()
    } finally { await transport.dispose() }
  })

  it('labels real physics, shows timestamp-aligned measurements and discloses early termination', () => {
    const snapshot = recorded()
    const fixture = studioFixture(snapshot, { ...pausedPlayback, time: 0.6 })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Recorded simulation · Not live hardware')).toBeTruthy()
    expect(view.getByText('0.300 m/s')).toBeTruthy()
    expect(view.getByText('Measured body speed')).toBeTruthy()
    expect(view.queryByText('Measured travel speed')).toBeNull()
    expect(view.getByText('120 BPM')).toBeTruthy()
    expect(view.getByLabelText('Beat 2 of four')).toBeTruthy()
    expect(view.getByText(/ended early at 2.00 seconds/)).toBeTruthy()
    expect(view.getByText(/Recorded 2.00 of the target's 4.00 seconds/)).toBeTruthy()
    expect(view.getByText('policy-hash')).toBeTruthy()
    const viewer = vi.mocked(RobotViewer).mock.lastCall![0]
    expect(viewer.frames).toBe(snapshot.recording.frames)
    expect(viewer.readTime).toBe(fixture.readTime)
    act(() => { viewer.onBodySelect(0) })
    expect(view.getByText(/Selected part: body/)).toBeTruthy()
    expect(fixture.store.getSnapshot()).toMatchObject({ selectedBody: 0, inspector: true })
    expect(view.getByText('11.5°/s')).toBeTruthy()
    expect(view.getByText('0.010 N·m')).toBeTruthy()
  })

  it('labels kinematic targets without claiming measured travel, torque or learned skill', () => {
    const fixture = studioFixture({ ...recorded(), recording: fixturePreview })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Target preview · Not physics-tested')).toBeTruthy()
    expect(view.getByText(/does not test balance or prove the robot learned/)).toBeTruthy()
    expect(view.queryByText('0.300 m/s')).toBeNull()
    expect(view.queryByText('0.010 N·m')).toBeNull()
    expect(view.getByText('Target pose')).toBeTruthy()
    expect(view.getByText('project-hash')).toBeTruthy()
    expect(view.getByText('Measured body speed').nextElementSibling?.textContent).toBe('Not measured')
    for (const label of ['Controller target', 'Joint velocity', 'Actuator torque']) {
      expect(view.getByText(label).nextElementSibling?.textContent).toBe('Not measured')
    }
    expect(view.getByText('Target pose').nextElementSibling?.textContent).toBe('5.7°')
    expect(view.getByText('Body tilt').nextElementSibling?.textContent).toBe('2.9°')
    expect(view.queryByText(/Recorded physics values/)).toBeNull()
    expect(view.queryByText('11.5°/s')).toBeNull()
  })

  it('does not claim recorded physics values before any motion sample is loaded', () => {
    const fixture = studioFixture(readySnapshot())
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText(/No motion sample loaded/)).toBeTruthy()
    expect(view.queryByText(/Recorded physics values/)).toBeNull()
    expect(view.queryByText(/Kinematic target values/)).toBeNull()
    expect(view.getByText('Actual angle').nextElementSibling?.textContent).toBe('Not recorded')
    expect(view.getByText('Joint velocity').nextElementSibling?.textContent).toBe('Not recorded')
    expect(view.queryByText('0.000 m/s')).toBeNull()
    expect(view.queryByText('0.0°')).toBeNull()
  })

  it('distinguishes missing recorded speed and joint velocity from a measured zero', () => {
    const snapshot = recorded()
    snapshot.recording = { ...fixtureSimulation, frames: fixtureSimulation.frames.map(frame => ({ ...frame,
      telemetry: { ...frame.telemetry, jointVelocity: null, rootLinearVelocityWorld: null, rootSpeed: null },
    })) }
    const fixture = studioFixture(snapshot)
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Measured body speed').nextElementSibling?.textContent).toBe('Not recorded')
    expect(view.getByText('Joint velocity').nextElementSibling?.textContent).toBe('Not recorded')
    expect(view.queryByText('0.000 m/s')).toBeNull()
    expect(view.queryByText('0.0°/s')).toBeNull()
    snapshot.recording = { ...fixtureSimulation, frames: fixtureSimulation.frames.map(frame => ({ ...frame,
      telemetry: { ...frame.telemetry, jointVelocity: Array<number>(14).fill(0), rootLinearVelocityWorld: [0, 0, 0], rootSpeed: 0 },
    })) }
    view.rerender(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('Measured body speed').nextElementSibling?.textContent).toBe('0.000 m/s')
    expect(view.getByText('Joint velocity').nextElementSibling?.textContent).toBe('0.0°/s')
  })

  it('routes playback, seeking, mute and volume to the shared transport and pauses on unmount', () => {
    const fixture = studioFixture(recorded(), { ...pausedPlayback, mode: 'music' })
    const view = render(<StudioPlayer {...fixture.props} />)
    fireEvent.click(view.getByRole('button', { name: 'Play with soundtrack' }))
    expect(fixture.play).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Restart' }))
    expect(fixture.restartPlayback).toHaveBeenCalledOnce()
    fireEvent.change(view.getByLabelText('Performance time'), { target: { value: '1.2' } })
    expect(fixture.seek).toHaveBeenCalledExactlyOnceWith(1.2)
    fireEvent.change(view.getByLabelText('Music volume'), { target: { value: '0.3' } })
    expect(fixture.volume).toHaveBeenCalledExactlyOnceWith(0.3)
    fireEvent.click(view.getByRole('button', { name: 'Mute' }))
    expect(fixture.mute).toHaveBeenCalledExactlyOnceWith(true)
    expect(fixture.pause).not.toHaveBeenCalled()
    view.rerender(<StudioPlayer {...fixture.props} usePlayback={selector => selector({ ...pausedPlayback, state: 'playing' })} />)
    fireEvent.click(view.getByRole('button', { name: 'Pause' }))
    expect(fixture.pause).toHaveBeenCalledOnce()
    view.unmount()
    expect(fixture.pause).toHaveBeenCalledTimes(2)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('allows pending audio to be paused without starting the viewport frame loop', () => {
    const fixture = studioFixture(recorded(), { ...pausedPlayback, state: 'starting', mode: 'music' })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(vi.mocked(RobotViewer).mock.lastCall![0].playing).toBe(false)
    fireEvent.click(view.getByRole('button', { name: 'Pause' }))
    expect(fixture.pause).toHaveBeenCalledOnce()
    expect(fixture.play).not.toHaveBeenCalled()
  })

  it('offers explicit silent playback after audio failure', () => {
    const fixture = studioFixture(recorded(), { ...pausedPlayback, error: 'Audio unavailable' })
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByRole('alert').textContent).toBe('Audio unavailable')
    fireEvent.click(view.getByRole('button', { name: 'Play without music' }))
    expect(fixture.playWithoutMusic).toHaveBeenCalledOnce()
    expect(fixture.play).not.toHaveBeenCalled()
  })

  it('keeps surface, camera and inspector changes local and preserves saved authoring state', () => {
    const fixture = studioFixture(recorded())
    fixture.store.actions.loadProject(fixtureProject)
    const before = fixture.store.getSnapshot().dance
    const view = render(<StudioPlayer {...fixture.props} />)
    for (const surface of ['concrete', 'sand', 'grass', 'studio']) {
      fireEvent.change(view.getByLabelText('Visual surface'), { target: { value: surface } })
      expect(vi.mocked(RobotViewer).mock.lastCall![0].surface).toBe(surface)
    }
    for (const cameraView of ['front', 'side', 'top', 'perspective']) {
      fireEvent.change(view.getByLabelText('Camera'), { target: { value: cameraView } })
      expect(vi.mocked(RobotViewer).mock.lastCall![0].cameraView).toBe(cameraView)
    }
    fireEvent.click(view.getByRole('button', { name: 'Reset view' }))
    expect(vi.mocked(RobotViewer).mock.lastCall![0].cameraReset).toBe(1)
    fireEvent.click(view.getByRole('button', { name: 'Expand view' }))
    expect(view.getByRole('button', { name: 'Compact view' }).getAttribute('aria-pressed')).toBe('true')
    expect(fixture.store.getSnapshot().dance).toBe(before)
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(view.getByText(/Appearance does not change terrain or friction/)).toBeTruthy()
  })

  it('requests the standing policy explicitly without fabricating a recording', () => {
    const snapshot = readySnapshot()
    snapshot.policies.push({ ...snapshot.policies[0]!, id: 'shipped:alpha_stand' as RobotPolicyId })
    const fixture = studioFixture(snapshot)
    const view = render(<StudioPlayer {...fixture.props} />)
    expect(view.getByText('No performance loaded')).toBeTruthy()
    expect(vi.mocked(RobotViewer).mock.lastCall![0].frames).toEqual([])
    expect(fixture.execute).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Preview standing policy' }))
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'simulate', policyId: 'shipped:alpha_stand',
      steps: 1000, seed: 0, command: [0, 0, 0] })
    expect(vi.mocked(RobotViewer).mock.lastCall![0].frames).toEqual([])
  })

  it.each(['missing policy', 'incompatible', 'no readiness', 'not ready', 'simulation unavailable', 'busy'])
  ('cannot preview standing with %s', (blocker) => {
    const snapshot = readySnapshot()
    if (blocker !== 'missing policy') snapshot.policies.push({ ...snapshot.policies[0]!, id: 'shipped:alpha_stand' as RobotPolicyId,
      runtimeCompatibility: { available: blocker !== 'incompatible', reason: 'Runtime mismatch' } })
    if (blocker === 'no readiness') snapshot.readiness = null
    if (blocker === 'not ready') snapshot.readiness!.ready = false
    if (blocker === 'simulation unavailable') snapshot.readiness!.capabilities.simulate.available = false
    if (blocker === 'busy') snapshot.busy = 'refresh'
    const fixture = studioFixture(snapshot)
    const view = render(<StudioPlayer {...fixture.props} />)
    const preview = view.getByRole('button', { name: 'Preview standing policy' }) as HTMLButtonElement
    expect(preview.disabled).toBe(true)
    fireEvent.click(preview)
    expect(fixture.execute).not.toHaveBeenCalled()
  })
})
