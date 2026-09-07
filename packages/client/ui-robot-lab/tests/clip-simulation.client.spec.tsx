// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClipPoseStageProps } from '../src/client/ClipPoseStage.tsx'
import type { ClipSimulationProps } from '../src/client/clip-gen-props.ts'
import type { ClipVideoOutput } from '../src/client/clip-gen-store.ts'
import type { ClipVideoResult } from '../src/client/clip-video.ts'
import type { ClipMovieOptions } from '../src/client/clip-movie.ts'
import { ClipSimulation } from '../src/client/ClipSimulation.tsx'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { compileClip } from '../src/client/clip-motion.ts'
import { compileTurningPreview } from '../src/client/clip-preview.ts'
import { compileWalkingPreview } from '../src/client/clip-walking.ts'
import { ClipVideoError } from '../src/client/clip-video.ts'
import { recordClipMovie } from '../src/client/clip-movie.ts'
import { clipEn } from '../src/client/clip-gen-locales.ts'
import { fixtureProfile, readySnapshot } from './fixtures.client.ts'
import { poseFixture } from './clip-pose-fixture.ts'
import { alternativeMusic, type ClipMusicChoice } from '../src/client/clip-soundtrack.ts'

const stage = vi.hoisted(() => ({ props: null as ClipPoseStageProps | null, capture: vi.fn<() => string>() }))
vi.mock('../src/client/ClipPoseStage.tsx', async () => {
  const { useEffect, useRef } = await import('react')
  return {
    ClipPoseStage: (props: ClipPoseStageProps) => {
      stage.props = props
      const canvas = useRef<HTMLCanvasElement>(null)
      useEffect(() => {
        props.onCanvas?.(canvas.current)
        return () => { props.onCanvas?.(null) }
      }, [props.onCanvas])
      useEffect(() => {
        props.onCaptureReady?.(stage.capture)
        return () => { props.onCaptureReady?.(null) }
      }, [props.onCaptureReady])
      return <canvas ref={canvas} aria-label={props.label} />
    },
  }
})
vi.mock('../src/client/clip-movie.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/clip-movie.ts')>()
  return { ...actual, recordClipMovie: vi.fn() }
})

type MovieResult = ClipVideoResult & { audio?: ClipVideoResult }
interface Recording {
  options: ClipMovieOptions
  promise: Promise<MovieResult>
  resolve: (value: MovieResult) => void
  reject: (error: unknown) => void
}
const recordings: Recording[] = []
const frames = new Map<number, FrameRequestCallback>()
const createUrl = vi.fn<(blob: Blob) => string>()
let nextFrame = 0

beforeEach(() => {
  stage.props = null
  stage.capture.mockReset().mockReturnValue('data:image/png;base64,cGl4ZWxz')
  recordings.length = 0
  frames.clear()
  nextFrame = 0
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
  createUrl.mockReset().mockReturnValue('blob:completed-mp4')
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = createUrl })
  vi.mocked(recordClipMovie).mockReset().mockImplementation((options) => {
    let resolve!: Recording['resolve']
    let reject!: Recording['reject']
    const promise = new Promise<MovieResult>((accept, fail) => { resolve = accept; reject = fail })
    recordings.push({ options, promise, resolve, reject })
    return promise
  })
})
afterEach(async () => {
  cleanup()
  for (const recording of recordings) recording.reject(new ClipVideoError('aborted'))
  await Promise.all(recordings.map(recording => recording.promise.catch(() => undefined)))
  frames.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const profile: RobotProfile = { ...fixtureProfile, joints: fixtureProfile.joints.map((joint, index) => ({
  ...joint, index: index + 1, name: poseFixture.scene.jointNames[index]!, defaultPosition: poseFixture.scene.defaultJoints[index]!,
})) }
function editor(loop = true) {
  const store = createClipGenStore(120, 8).create()
  store.actions.load(compileClip(profile, [{ action: 'left-step', beats: 2 }], 120, 0.5, 'Review clip 🦆', loop))
  return store
}
function mount(store = editor()) {
  const ready = readySnapshot()
  const lab = { ...ready, catalog: { ...ready.catalog!, profiles: [profile] }, scene: poseFixture.scene }
  const publishVideo = vi.fn((video: ClipVideoOutput) => { store.actions.generated(video) })
  const props = {
    sessionId: 'clip-session' as SessionId,
    useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useLab: selector => selector(lab), actions: store.actions,
    t: (key, params) => {
      const template = clipEn[key as keyof typeof clipEn]
      return params === undefined ? template
        : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
    },
    publishVideo, refresh: vi.fn(), openWorkspace: vi.fn(), openTraining: vi.fn(), saveText: vi.fn(),
    maxDpr: 1, defaultBpm: 120, frameRate: 30, videoBitsPerSecond: 4000000, finalizeTimeoutMs: 1000, maxFileBytes: 16384, maxDucks: 8,
  } as ClipSimulationProps
  return { ...render(<ClipSimulation {...props} />), store, publishVideo, saveText: props.saveText }
}
type View = ReturnType<typeof mount>
function begin(view: View): Recording {
  act(() => { view.store.actions.verify(true); view.store.actions.generate() })
  return recordings.at(-1)!
}
function advance(time: number) {
  const callbacks = [...frames.values()]
  frames.clear()
  act(() => { for (const callback of callbacks) callback(time) })
}
async function complete(recording: Recording) {
  const result = { blob: new Blob(['encoder-result'], { type: 'video/mp4' }), mimeType: 'video/mp4' }
  await act(async () => { recording.resolve(result); await recording.promise })
  return result
}
async function fail(recording: Recording, error: unknown) {
  await act(async () => { recording.reject(error); await recording.promise.catch(() => undefined) })
}

describe('dance audio and shared motion transport', () => {
  function musical() {
    const store = editor()
    const source = store.getSnapshot().clip!
    if (source.version !== 1) throw new Error('The musical fixture requires a training-reference clip')
    store.actions.loadDance('Original rhythm', 130, { ...source, duration: 30,
      keys: source.keys.map(key => ({ ...key, t: key.t * 30 })) }, 'bachata')
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const view = mount(store)
    const audio = view.container.querySelector('audio')!
    return { ...view, audio, play, pause }
  }

  it('uses audio time, not elapsed RAF time, and shares seeking, pause, speed, mute and duration edits', () => {
    const view = musical()
    expect(view.play).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: clipEn.play }))
    expect(view.play).toHaveBeenCalledOnce()
    view.audio.currentTime = 4
    advance(9000)
    expect(view.store.getSnapshot().time).toBe(4)
    act(() => { view.store.actions.seek(12) })
    expect(view.store.getSnapshot().playing).toBe(false)
    expect(view.audio.currentTime).toBe(12)
    expect(view.pause).toHaveBeenCalledOnce()
    act(() => { view.store.actions.meta({ duration: 60 }); view.store.actions.audioSettings({ muted: true, volume: 0.25 }) })
    expect(view.store.getSnapshot().time).toBe(24)
    expect(view.audio.currentTime).toBe(12)
    expect(view.audio.volume).toBe(0.25)
    expect(view.audio.muted).toBe(true)
    act(() => { view.store.actions.playbackSpeed(0.5); view.store.actions.playing(true) })
    expect(view.audio.playbackRate).toBe(0.25)
    view.audio.currentTime = 8
    advance(12000)
    expect(view.store.getSnapshot().time).toBe(16)
    view.audio.currentTime = 0
    advance(14000)
    expect(view.store.getSnapshot().time).toBe(0)
    view.unmount()
    expect(view.store.getSnapshot().playing).toBe(false)
    expect(frames.size).toBe(0)
    expect(view.pause.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('pauses motion on media failure and suppresses a pending play rejection after unmount', async () => {
    const view = musical()
    view.play.mockRejectedValueOnce(new Error('autoplay'))
    await act(async () => { view.store.actions.playing(true); await Promise.resolve() })
    expect(view.store.getSnapshot()).toMatchObject({ playing: false, error: 'audio' })
    expect(frames.size).toBe(0)
    let reject!: (reason: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    view.play.mockReturnValueOnce(pending)
    act(() => { view.store.actions.playing(true) })
    expect(view.store.getSnapshot().error).toBeNull()
    view.unmount()
    await act(async () => { reject(new Error('cancelled')); await pending.catch(() => undefined) })
    expect(view.store.getSnapshot()).toMatchObject({ playing: false, error: null })
    expect(frames.size).toBe(0)
  })

  it('silences playback on hidden tabs and on clip replacement', () => {
    const view = musical()
    act(() => { view.store.actions.playing(true) })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(view.store.getSnapshot().playing).toBe(false)
    hidden.mockRestore()
    act(() => { view.store.actions.playing(true); view.store.actions.load(editor().getSnapshot().clip!) })
    expect(view.store.getSnapshot()).toMatchObject({ playing: false, audioId: null })
    expect(view.container.querySelector('audio')).toBeNull()
    expect(frames.size).toBe(0)
  })

  it('locks the measured viewport for capture and restores its responsive layout after completion', async () => {
    const view = mount()
    const surface = view.container.querySelector('canvas')!.parentElement!
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ width: 446, height: 286 } as DOMRect)
    const recording = begin(view)
    expect(surface.style.width).toBe('446px')
    expect(surface.style.height).toBe('286px')
    expect(surface.style.flex).not.toBe('')
    await complete(recording)
    expect(surface.style.width).toBe('')
    expect(surface.style.height).toBe('')
    expect(surface.style.flex).toBe('')
  })

  it('freezes the soundtrack, uses its export clock and switches retained downloads without changing the draft', async () => {
    const view = musical()
    const choice = view.getByRole('checkbox', { name: clipEn['export.withAudio'] }) as HTMLInputElement
    expect(choice.checked).toBe(true)
    act(() => { view.store.actions.audioSettings({ muted: true, volume: 0 }); view.store.actions.playbackSpeed(0.5) })
    createUrl.mockReturnValueOnce('blob:silent').mockReturnValueOnce('blob:audio')
    const recording = begin(view)
    expect(recording.options.music?.duration).toBe(30)
    expect(recording.options.music?.src).toMatch(/^data:audio\/ogg;base64,/)
    act(() => { recording.options.onStarted(() => 2) })
    advance(9000)
    expect(view.store.getSnapshot().time).toBe(2)
    act(() => { view.store.actions.exportAudio(false) })
    expect(view.store.getSnapshot().exportWithAudio).toBe(true)
    await act(async () => { recording.resolve({ blob: new Blob(['silent']), mimeType: 'video/mp4',
      audio: { blob: new Blob(['soundtrack']), mimeType: 'video/mp4' } }); await recording.promise })
    expect(view.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:audio')
    expect(view.store.getSnapshot().video?.audio).toEqual({ url: 'blob:audio', bytes: 10 })
    const revision = view.store.getSnapshot().revision
    fireEvent.click(choice)
    expect(view.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:silent')
    expect(view.getByRole('link', { name: clipEn.download }).getAttribute('download')).toMatch(/-silent\.mp4$/)
    expect(view.store.getSnapshot().revision).toBe(revision)
    expect(view.publishVideo.mock.calls[0]?.[0].audio?.url).toBe('blob:audio')
  })

  it.each(Object.keys(alternativeMusic) as Exclude<ClipMusicChoice, 'original'>[])('uses %s in preview and MP4 capture, retaining captured credits', async (choice) => {
    const view = musical()
    const source = alternativeMusic[choice]
    act(() => { view.store.actions.chooseMusic(choice) })
    const audio = view.container.querySelector('audio')!
    expect(audio.src).toBe(source.src)
    act(() => { view.store.actions.playing(true) })
    expect(audio.playbackRate).toBe(130 / 120)
    audio.currentTime = 13
    advance(20_000)
    expect(view.store.getSnapshot().time).toBeCloseTo(12)
    act(() => { view.store.actions.playing(false) })
    const recording = begin(view)
    expect(recording.options.music).toMatchObject({ src: source.src, duration: 16, rate: 130 / 120, repeat: true,
      credit: { title: source.title, artist: source.artist } })
    act(() => { view.store.actions.chooseMusic('original') })
    expect(view.store.getSnapshot().musicChoice).toBe(choice)
    await act(async () => { recording.resolve({ blob: new Blob(['silent']), mimeType: 'video/mp4',
      audio: { blob: new Blob(['selected music']), mimeType: 'video/mp4' } }); await recording.promise })
    expect(view.publishVideo.mock.calls[0]![0].musicCredit).toMatchObject({ title: source.title })
    act(() => { view.store.actions.chooseMusic('original') })
    fireEvent.click(view.getByRole('button', { name: clipEn['audio.saveCredit'] }))
    expect(JSON.parse(vi.mocked(view.saveText).mock.calls[0]![0])).toMatchObject({ title: source.title, artist: source.artist })
  })

  it('stops preview audio for a non-loop ending and for MP4 capture', () => {
    const view = musical()
    act(() => { view.store.actions.meta({ loop: false }); view.store.actions.playing(true) })
    view.audio.currentTime = 30
    advance(1)
    expect(view.store.getSnapshot()).toMatchObject({ playing: false, time: 30 })
    act(() => { view.store.actions.playing(true) })
    expect(view.audio.currentTime).toBe(0)
    begin(view)
    expect(view.store.getSnapshot()).toMatchObject({ exporting: true, playing: false })
    expect(view.pause.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Simulation workspace controls', () => {
  it('downloads the current view as a PNG without changing playback, framing, or the draft', () => {
    const downloads: { url: string; filename: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ url: this.href, filename: this.download })
    })
    const view = mount()
    act(() => { view.store.actions.seek(0.5); view.store.actions.playing(true) })
    const before = view.store.getSnapshot()
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.capture'] }))
    expect(stage.capture).toHaveBeenCalledOnce()
    expect(downloads).toEqual([{ url: 'data:image/png;base64,cGl4ZWxz', filename: 'Review-clip-cover-0.50s.png' }])
    expect(view.store.getSnapshot()).toBe(before)
    expect(view.getByText(clipEn['sim.capture.saved']).getAttribute('role')).toBe('status')
    expect(recordClipMovie).not.toHaveBeenCalled()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })

  it('keeps capture disabled for unavailable previews and MP4 recording, and releases the capture callback', () => {
    const view = mount()
    const button = view.getByRole('button', { name: clipEn['sim.capture'] }) as HTMLButtonElement
    act(() => { view.store.actions.previewReady(false) })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(stage.capture).not.toHaveBeenCalled()
    act(() => { view.store.actions.previewReady(true) })
    expect(button.disabled).toBe(false)
    act(() => { stage.props!.onCaptureReady!(null) })
    expect(button.disabled).toBe(true)
    act(() => { stage.props!.onCaptureReady!(stage.capture) })
    begin(view)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(stage.capture).not.toHaveBeenCalled()
  })

  it.each(['exception', 'empty'] as const)('reports %s readback failure without modifying the draft and permits retry', (failure) => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = mount()
    const before = view.store.getSnapshot()
    if (failure === 'exception') stage.capture.mockImplementationOnce(() => { throw new DOMException('Tainted canvas', 'SecurityError') })
    else stage.capture.mockReturnValueOnce('data:,')
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.capture'] }))
    expect(view.getByRole('alert').textContent).toBe(clipEn['sim.capture.error'])
    expect(download).not.toHaveBeenCalled()
    expect(view.store.getSnapshot()).toBe(before)
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.capture'] }))
    expect(download).toHaveBeenCalledOnce()
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('captures a neutral preview without a clip or review requirement', () => {
    let filename = ''
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download
    })
    const view = mount(createClipGenStore(120, 8).create())
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.capture'] }))
    expect(download).toHaveBeenCalledOnce()
    expect(filename).toBe('microduck-clip-cover-0.00s.png')
    expect(view.store.getSnapshot().clip).toBeNull()
  })

  it('updates real stage inputs without changing keyframes and retains settings on remount', () => {
    const view = mount()
    const before = view.store.getSnapshot()
    fireEvent.change(view.getByLabelText(clipEn['sim.surface']), { target: { value: 'grass' } })
    fireEvent.click(view.getByLabelText(clipEn['sim.ground']))
    fireEvent.click(view.getByLabelText(clipEn['sim.grid']))
    fireEvent.click(view.getByLabelText(clipEn['sim.axes']))
    fireEvent.click(view.getByLabelText(clipEn['sim.wireframe']))
    fireEvent.change(view.getByLabelText(clipEn['sim.background']), { target: { value: '#123456' } })
    fireEvent.change(view.getByRole('slider', { name: clipEn['sim.light'] }), { target: { value: '2' } })
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.view.top'] }))
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.mode.pan'] }))
    fireEvent.change(view.getByLabelText(clipEn['sim.zoom']), { target: { value: '1.5' } })
    expect(stage.props?.settings).toEqual({ surface: 'grass', ground: false, grid: true, axes: true,
      wireframe: true, background: '#123456', lightIntensity: 2, cameraView: 'top', cameraMode: 'pan', cameraZoom: 1.5 })
    expect(view.store.getSnapshot()).toMatchObject({ clip: before.clip, revision: before.revision, editEpoch: before.editEpoch })
    view.unmount()
    const remount = mount(view.store)
    expect((remount.getByLabelText(clipEn['sim.surface']) as HTMLSelectElement).value).toBe('grass')
    fireEvent.click(remount.getByRole('button', { name: clipEn['sim.resetEnvironment'] }))
    expect(stage.props?.settings).toEqual(before.stage)
    expect(view.store.getSnapshot().clip).toEqual(before.clip)
  })

  it('changes preview speed continuously, steps through keys, and records at authored speed', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: clipEn.play }))
    advance(200)
    vi.spyOn(performance, 'now').mockReturnValue(200)
    fireEvent.change(view.getByLabelText(clipEn['sim.speed']), { target: { value: '0.5' } })
    advance(600)
    expect(view.store.getSnapshot().time).toBeCloseTo(0.4)
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.next'] }))
    const after = view.store.getSnapshot().time
    expect(after).toBeGreaterThan(0.4)
    expect(view.store.getSnapshot().playing).toBe(false)
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.previous'] }))
    expect(view.store.getSnapshot().time).toBeLessThan(after)
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    advance(500)
    expect(view.store.getSnapshot().time).toBe(0.5)
    await complete(recording)
  })

  it('edits, keys and discards the shared robot pose from the right column', () => {
    const view = mount()
    fireEvent.click(view.getByText(clipEn['sim.robot'], { selector: 'summary' }))
    fireEvent.click(view.getByRole('button', { name: /^Joints$/ }))
    fireEvent.change(view.getByRole('slider', { name: /^left_hip_pitch$/ }), { target: { value: '0.2' } })
    expect(view.store.getSnapshot()).toMatchObject({ unkeyed: true, selectedJoint: 2 })
    expect(view.getByRole('button', { name: clipEn.play }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: clipEn.key }))
    expect(view.store.getSnapshot().clip?.keys[0]?.joints[2]).toBe(0.2)
    expect(view.store.getSnapshot().unkeyed).toBe(false)
    fireEvent.change(view.getByRole('slider', { name: /^left_hip_pitch$/ }), { target: { value: '0.3' } })
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.discardPose'] }))
    expect(view.store.getSnapshot().pose?.joints[2]).toBe(0.2)
    expect(view.store.getSnapshot().unkeyed).toBe(false)
  })

  it('shows the installed duck before a clip exists and creates an editable neutral clip', () => {
    const view = mount(createClipGenStore(120, 8).create())
    expect(stage.props?.joints).toEqual(profile.joints.map(joint => joint.defaultPosition))
    expect(stage.props?.editing).toBe(false)
    fireEvent.click(view.getByRole('button', { name: clipEn['sim.create'] }))
    expect(view.store.getSnapshot().clip).toMatchObject({ version: 1, name: clipEn['sim.neutralName'], loop: true })
    expect(stage.props?.editing).toBe(true)
  })

  it('downloads the recorded clip JSON rather than a subsequently edited draft', async () => {
    const view = mount()
    fireEvent.click(view.getByText(clipEn['sim.export'], { selector: 'summary' }))
    const recording = begin(view)
    await complete(recording)
    const recorded = view.store.getSnapshot().video!
    act(() => { view.store.actions.joint(profile, 2, 0.25); view.store.actions.key(100) })
    expect(view.getByText(clipEn.stale)).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: clipEn.outputJson }))
    expect(view.saveText).toHaveBeenCalledWith(recorded.clipJson, recorded.filename.replace(/\.mp4$/i, '.json'))
    expect(view.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe(recorded.url)
  })

  it('locks view settings and speed in the store throughout capture', async () => {
    const view = mount()
    const recording = begin(view)
    const before = view.store.getSnapshot()
    act(() => {
      view.store.actions.stage({ surface: 'sand', cameraZoom: 2 })
      view.store.actions.resetStage(); view.store.actions.focus(); view.store.actions.playbackSpeed(2)
    })
    expect(view.store.getSnapshot()).toEqual(before)
    expect(view.getByLabelText(clipEn['sim.surface']).closest('fieldset')?.disabled).toBe(true)
    expect(view.getByLabelText(clipEn['sim.speed']).hasAttribute('disabled')).toBe(true)
    await complete(recording)
  })
})

describe('Simulation workspace recording lifecycle', () => {
  it('renders solved walking root coordinates on a fixed floor and exports the same contact reference', async () => {
    const store = editor()
    const walking = compileWalkingPreview(profile, poseFixture.scene, 'Walking turns')
    store.actions.load(walking)
    const view = mount(store)
    act(() => { store.actions.seek(2.125) })
    expect(stage.props!.rootPosition).toEqual(store.getSnapshot().pose!.rootPosition)
    expect(stage.props!.rootRoll).toBe(store.getSnapshot().pose!.rootRoll)
    expect(stage.props!.editing).toBe(false)
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    advance(2125)
    expect(stage.props!.rootPosition).toEqual(store.getSnapshot().pose!.rootPosition)
    await complete(recording)
    expect(JSON.parse(view.publishVideo.mock.calls[0]![0].clipJson)).toEqual(walking)
  })

  it('passes unwrapped heading through playback and retains it in the exact video JSON', async () => {
    const store = editor()
    const preview = compileTurningPreview(profile, 120, 'Left and right full turns')
    store.actions.load(preview)
    const view = mount(store)
    act(() => { store.actions.playing(true) })
    advance(6000)
    expect(stage.props!.rootYaw).toBe(Math.PI)
    advance(10000)
    expect(stage.props!.rootYaw).toBe(Math.PI * 2)
    advance(14000)
    expect(stage.props!.rootYaw).toBe(Math.PI)
    act(() => { store.actions.playing(false) })
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    advance(10000)
    expect(stage.props!.rootYaw).toBe(Math.PI * 2)
    await complete(recording)
    expect(JSON.parse(view.publishVideo.mock.calls[0]![0].clipJson)).toEqual(preview)
  })

  it('publishes canvas readiness on mount, canvas loss, replacement and unmount without recording', () => {
    const store = editor()
    expect(store.getSnapshot().previewReady).toBe(false)
    const view = mount(store)
    const canvas = view.getByLabelText(clipEn.ready) as HTMLCanvasElement
    expect(store.getSnapshot().previewReady).toBe(true)
    act(() => { stage.props!.onCanvas?.(null) })
    expect(store.getSnapshot().previewReady).toBe(false)
    act(() => { stage.props!.onCanvas?.(canvas) })
    expect(store.getSnapshot().previewReady).toBe(true)
    expect(recordClipMovie).not.toHaveBeenCalled()
    view.unmount()
    expect(store.getSnapshot().previewReady).toBe(false)
    expect(frames.size).toBe(0)
  })

  it('starts capture once, keeps frame ticks on one clock and exports one cycle even when preview loops', async () => {
    const view = mount()
    act(() => { view.store.actions.seek(0.5) })
    const source = view.store.getSnapshot().clip!
    const recording = begin(view)
    expect(recordClipMovie).toHaveBeenCalledOnce()
    expect(recording.options.canvas).toBe(view.getByLabelText(clipEn.ready))
    expect(recording.options).toMatchObject({ durationMs: 1000,
      frameRate: 30, videoBitsPerSecond: 4000000, finalizeTimeoutMs: 1000 })
    expect(view.store.getSnapshot()).toMatchObject({ time: 0, exporting: true, playing: false })
    expect(frames.size).toBe(0)
    expect(stage.props).toMatchObject({ cameraLocked: true, selectedJoint: null })
    act(() => { recording.options.onStarted() })
    expect(frames.size).toBe(1)
    advance(250)
    expect(view.store.getSnapshot().time).toBe(0.25)
    advance(500)
    expect(view.store.getSnapshot().time).toBe(0.5)
    expect(recordClipMovie).toHaveBeenCalledOnce()
    expect(recording.options.signal.aborted).toBe(false)
    advance(1250)
    expect(view.store.getSnapshot()).toMatchObject({ time: 1, playing: false, exporting: true })
    expect(frames.size).toBe(0)
    const result = await complete(recording)
    expect(createUrl).toHaveBeenCalledExactlyOnceWith(result.blob)
    expect(view.publishVideo).toHaveBeenCalledExactlyOnceWith({ url: 'blob:completed-mp4', filename: 'Review-clip.mp4',
      bytes: result.blob.size, revision: 1, clipJson: JSON.stringify(source, null, 2) + '\n' }, true)
    expect(view.store.getSnapshot()).toMatchObject({ exporting: false, playing: false, error: null })
    expect(recordClipMovie).toHaveBeenCalledOnce()
    expect(stage.props?.cameraLocked).toBe(false)
  })

  it.each([false, true])('plays the authored clock without restarting between ticks, loop=%s', (loop) => {
    const view = mount(editor(loop))
    fireEvent.click(view.getByRole('button', { name: clipEn.play }))
    advance(250)
    expect(view.store.getSnapshot().time).toBe(0.25)
    advance(750)
    expect(view.store.getSnapshot().time).toBe(0.75)
    advance(1250)
    expect(view.store.getSnapshot()).toMatchObject({ time: loop ? 0.25 : 1, playing: loop })
    expect(frames.size).toBe(loop ? 1 : 0)
    expect(recordClipMovie).not.toHaveBeenCalled()
    view.unmount()
    expect(frames.size).toBe(0)
    expect(view.store.getSnapshot().playing).toBe(false)
  })

  it('settles as aborted when a fulfilled recorder result is cancelled before its completion callback runs', async () => {
    const view = mount()
    const recording = begin(view)
    const result = { blob: new Blob(['encoder-result'], { type: 'video/mp4' }), mimeType: 'video/mp4' }
    await act(async () => {
      recording.resolve(result)
      fireEvent.click(view.getByRole('button', { name: clipEn.cancel }))
      await recording.promise
    })
    expect(recording.options.signal.aborted).toBe(true)
    expect(view.store.getSnapshot()).toMatchObject({ exporting: false, error: 'aborted' })
    expect(view.publishVideo).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('aborts on explicit cancellation and clears the authored capture frame loop on settlement', async () => {
    const view = mount()
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    fireEvent.click(view.getByRole('button', { name: clipEn.cancel }))
    expect(recording.options.signal.aborted).toBe(true)
    await fail(recording, new ClipVideoError('aborted'))
    expect(view.store.getSnapshot()).toMatchObject({ exporting: false, playing: false, error: 'aborted' })
    expect(frames.size).toBe(0)
    expect(view.publishVideo).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('aborts when the browser tab becomes hidden and removes its visibility listener on unmount', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const view = mount()
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')![1]
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    fireEvent(document, new Event('visibilitychange'))
    expect(recording.options.signal.aborted).toBe(false)
    hidden.mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(recording.options.signal.aborted).toBe(true)
    await fail(recording, new ClipVideoError('aborted'))
    expect(view.store.getSnapshot()).toMatchObject({ exporting: false, playing: false, error: 'aborted' })
    expect(frames.size).toBe(0)
    expect(view.publishVideo).not.toHaveBeenCalled()
    view.unmount()
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener)
    expect(view.store.getSnapshot().previewReady).toBe(false)
  })

  it('aborts and reports capture failure when the WebGL context is lost', async () => {
    const view = mount()
    const canvas = view.getByLabelText(clipEn.ready)
    const remove = vi.spyOn(canvas, 'removeEventListener')
    const recording = begin(view)
    act(() => { recording.options.onStarted() })
    fireEvent(canvas, new Event('webglcontextlost'))
    expect(recording.options.signal.aborted).toBe(true)
    expect(view.store.getSnapshot()).toMatchObject({ previewReady: false, exporting: false, error: 'capture' })
    expect(frames.size).toBe(0)
    await complete(recording)
    expect(view.publishVideo).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
    view.unmount()
    expect(remove).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
  })

  it('discards an unmounted generation after a new workspace generation starts', async () => {
    const store = editor()
    const old = mount(store)
    const oldRecording = begin(old)
    act(() => { oldRecording.options.onStarted() })
    old.unmount()
    expect(oldRecording.options.signal.aborted).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ previewReady: false, exporting: false, error: 'aborted' })
    expect(frames.size).toBe(0)
    const current = mount(store)
    const currentRecording = begin(current)
    act(() => { currentRecording.options.onStarted() })
    expect(recordClipMovie).toHaveBeenCalledTimes(2)
    await complete(oldRecording)
    expect(old.publishVideo).not.toHaveBeenCalled()
    expect(current.publishVideo).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
    expect(store.getSnapshot().exporting).toBe(true)
    expect(currentRecording.options.signal.aborted).toBe(false)
    expect(frames.size).toBe(1)
    await complete(currentRecording)
    expect(current.publishVideo).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toMatchObject({ exporting: false, error: null })
    expect(frames.size).toBe(0)
  })

  it.each([new ClipVideoError('unavailable'), new Error('Encoder rejected capture')])('localizes recorder failure without publishing media: %s', async (error) => {
    const view = mount()
    const recording = begin(view)
    await fail(recording, error)
    const code = error instanceof ClipVideoError ? error.code : 'encode'
    expect(view.store.getSnapshot()).toMatchObject({ exporting: false, playing: false, error: code })
    expect(view.getByRole('alert').textContent).toBe(clipEn[`error.${code}`])
    expect(frames.size).toBe(0)
    expect(createUrl).not.toHaveBeenCalled()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })
})
