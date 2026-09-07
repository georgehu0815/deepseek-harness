// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type { RobotClip, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ClipGenPanel } from '../src/client/ClipGenPanel.tsx'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import type { ClipGenProps, DanceGuideProps } from '../src/client/clip-gen-props.ts'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { DanceGuideLibrary } from '../src/client/DanceGuideLibrary.tsx'
import { createDanceGuideStore } from '../src/client/dance-guide-store.ts'
import { parseClipSequence } from '../src/client/clip-sequence.ts'
import type { ClipSequenceRequestId } from '../src/client/clip-sequence-agent.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'
import { clipEn, clipZh } from '../src/client/clip-gen-locales.ts'
import { compileClip } from '../src/client/clip-motion.ts'
import { fixtureProfile, readySnapshot } from './fixtures.client.ts'
import { poseFixture } from './clip-pose-fixture.ts'
import { clipPartScene } from './clip-part-fixture.ts'
import { danceClips } from '../src/client/dance-clips.ts'
import { danceClipsV2 } from '../src/client/dance-clips-v2.ts'
import { danceV2Model } from './dance-v2-fixture.ts'
import { alternativeMusic } from '../src/client/clip-soundtrack.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// Keep the MuJoCo fixture's actual training order and standing radians; UI ranges come from the bounded profile fixture.
const profile: RobotProfile = { ...fixtureProfile, modelSha256: 'a'.repeat(64), joints: fixtureProfile.joints.map((joint, index) => ({
  ...joint, index: index + 1, name: poseFixture.scene.jointNames[index]!, defaultPosition: poseFixture.scene.defaultJoints[index]!,
})) }
function snapshot(): LabSnapshot {
  const lab = readySnapshot()
  return { ...lab, catalog: { ...lab.catalog!, profiles: [profile] }, scene: poseFixture.scene }
}
function mount(lab = snapshot(), maxFileBytes = 16384, copy: Record<keyof typeof clipEn, string> = clipEn) {
  const store = createClipGenStore(120, 8).create()
  const declaration = createDanceGuideStore(maxFileBytes)
  const guideStore = defineStore({ init: declaration.spec.init, actions: declaration.spec.actions }).create()
  const callbacks = { refresh: vi.fn(), openWorkspace: vi.fn(), openTraining: vi.fn(), saveText: vi.fn(), publishVideo: vi.fn(),
    generateSequence: vi.fn<ClipGenProps['generateSequence']>(),
    cancelSequence: vi.fn(() => { store.actions.aiCancel() }) }
  const t: ClipGenProps['t'] = (key, params) => {
    const template = copy[key as keyof typeof clipEn]
    return params === undefined ? template
      : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
  }
  const renderSlot = vi.fn<ClipGenProps['renderSlot']>((_name, owner) => {
    const guideProps = { ...owner, t, actions: guideStore.actions,
      useStore: <S,>(selector: (state: ReturnType<typeof guideStore.getSnapshot>) => S) => selector(useSyncExternalStore(
        listener => guideStore.subscribe(listener),
        () => guideStore.getSnapshot())),
    } as unknown as DanceGuideProps
    return <DanceGuideLibrary {...guideProps} />
  })
  const props = {
    sessionId: 'clip-session' as SessionId,
    useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useLab: selector => selector(lab), actions: store.actions, renderSlot, t,
    ...callbacks, maxDpr: 1, defaultBpm: 120, frameRate: 30, videoBitsPerSecond: 4000000,
    finalizeTimeoutMs: 1000, maxFileBytes, maxDucks: 8,
  } as ClipGenProps
  const view = render(<ClipGenPanel {...props} />)
  return { ...view, store, guideStore, renderSlot, ...callbacks }
}
type View = ReturnType<typeof mount>
function design(view: View, prompt = 'right leg, neck, left leg at 90 BPM') {
  fireEvent.change(view.getByRole('textbox', { name: clipEn.prompt }), { target: { value: prompt } })
  fireEvent.click(view.getByRole('button', { name: clipEn.design }))
}
function file(contents: string) {
  const value = new File([contents], 'reference.json', { type: 'application/json' })
  const text = vi.fn().mockResolvedValue(contents)
  Object.defineProperty(value, 'text', { value: text })
  return { value, text }
}
async function upload(view: View, value: File) {
  await act(async () => {
    fireEvent.change(view.getByLabelText(clipEn.load, { selector: 'input' }), { target: { files: [value] } })
  })
}

const generatedGuide = '0–0.5 s: 轻轻点头。\n0.5–1 s: 回到自然站姿。'
const requestId = '11111111-1111-4111-8111-111111111111' as ClipSequenceRequestId
function savedSequence() {
  const clip = compileClip(profile, [{ action: 'neck-nod', beats: 2 }], 120, 0.5, '生成 🦆 timeline', true)
  clip.keys.splice(1, 0, { t: 0.375, joints: [...profile.joints.map(joint => joint.defaultPosition)], rootPitch: 0.1234 })
  return parseClipSequence({ version: 1, modelSha256: profile.modelSha256, jointNames: profile.joints.map(joint => joint.name),
    bpm: 123.5, clip })
}
function selectSequence(view: View, sequence = savedSequence(), prompt = '  Saved dance 🦆\n') {
  act(() => { view.guideStore.actions.saveSequence(prompt, sequence) })
  fireEvent.change(view.getByRole('combobox', { name: clipEn['guide.choose'] }), { target: { value: 'saved-1' } })
}

function danceSnapshot(): LabSnapshot {
  const lab = snapshot()
  lab.catalog = { ...lab.catalog!, profiles: [{ ...profile, modelSha256: danceClips[0].sequence.modelSha256 }],
    limits: { ...lab.catalog!.limits, maxClipKeys: 512, maxBpm: 200 } }
  return lab
}

describe('soundtrack radio choices', () => {
  it('reports audition failures but ignores stale media errors during motion and locks pending playback during export', () => {
    const view = mount(); design(view)
    const audio = view.container.querySelector('audio')!
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
    fireEvent.error(audio)
    expect(view.store.getSnapshot().error).toBe('audio')
    act(() => { view.store.actions.playing(true) })
    fireEvent.error(audio)
    expect(view.store.getSnapshot()).toMatchObject({ playing: true, error: null })
    act(() => { view.store.actions.playing(false) })
    const rate = vi.spyOn(audio, 'playbackRate', 'set').mockImplementation(() => { throw new Error('Unsupported rate') })
    fireEvent.play(audio)
    expect(view.store.getSnapshot()).toMatchObject({ playing: false, error: 'audio' })
    expect(pause).toHaveBeenCalledOnce()
    rate.mockRestore()
    act(() => { view.store.actions.previewReady(true); view.store.actions.verify(true); view.store.actions.generate() })
    expect(audio.controls).toBe(false)
    fireEvent.error(audio); fireEvent.play(audio)
    expect(view.store.getSnapshot()).toMatchObject({ exporting: true, error: null })
    expect(pause).toHaveBeenCalledTimes(2)
    expect(view.getAllByRole('radio').every(radio => radio.matches(':disabled'))).toBe(true)
  })

  it('offers original plus three independent auditions and requires review after selecting music', () => {
    const view = mount(); design(view)
    expect(view.getAllByRole('radio')).toHaveLength(4)
    expect(view.getByRole('radio', { name: clipEn['audio.original'] })).toHaveProperty('checked', true)
    const source = view.store.getSnapshot().clip
    act(() => { view.store.actions.verify(true) })
    fireEvent.click(view.getByRole('radio', { name: alternativeMusic['soundhelix-17'].title }))
    expect(view.store.getSnapshot()).toMatchObject({ musicChoice: 'soundhelix-17', playing: false, verifiedRevision: null, clip: source })
    expect(view.getAllByRole('radio').filter(radio => (radio as HTMLInputElement).checked)).toHaveLength(1)
    expect(view.getByRole('checkbox', { name: clipEn['export.withAudio'] })).toHaveProperty('disabled', false)
    fireEvent.change(view.getByRole('textbox', { name: clipEn.name }), { target: { value: 'My dance' } })
    expect(view.store.getSnapshot().musicChoice).toBe('soundhelix-17')
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    expect(view.store.getSnapshot().musicChoice).toBe('original')
  })

  it('auditions one track at a time without selecting it and silences previews when motion starts', () => {
    const view = mount(); design(view)
    const players = [...view.container.querySelectorAll('audio')]
    const pauses = players.map((audio) => {
      Object.defineProperty(audio, 'paused', { configurable: true, value: true, writable: true })
      return vi.spyOn(audio, 'pause').mockImplementation(() => { Object.defineProperty(audio, 'paused', { value: true }) })
    })
    Object.defineProperty(players[0]!, 'paused', { value: false })
    fireEvent.play(players[0]!)
    expect(players[0]!.playbackRate).toBe(90 / 120)
    expect(players[0]!.preservesPitch).toBe(false)
    expect(view.store.getSnapshot().musicChoice).toBe('original')
    Object.defineProperty(players[1]!, 'paused', { value: false })
    fireEvent.play(players[1]!)
    expect(pauses[0]).toHaveBeenCalledOnce()
    act(() => { view.store.actions.playing(true) })
    expect(pauses[1]).toHaveBeenCalledOnce()
    Object.defineProperty(players[1]!, 'paused', { value: false })
    fireEvent.play(players[1]!)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(pauses[1]).toHaveBeenCalledOnce()
    hidden.mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(pauses[1]).toHaveBeenCalledTimes(2)
    view.unmount()
    pauses.forEach((pause) => { pause.mockRestore() })
  })
})

describe('completed MP4 audio choices', () => {
  it('switches the saved file and video player between frozen variants without invalidating review', () => {
    const view = mount(); design(view)
    const revision = view.store.getSnapshot().revision
    act(() => { view.store.actions.verify(true); view.store.actions.generated({ url: 'blob:silent', bytes: 3,
      audio: { url: 'blob:audio', bytes: 5 }, filename: 'captured.mp4', revision, clipJson: '{}' }) })
    const output = within(view.getByRole('region', { name: clipEn.outputTitle }))
    const checkbox = output.getByRole<HTMLInputElement>('checkbox', { name: clipEn['export.withAudio'] })
    const player = output.getByLabelText<HTMLVideoElement>(clipEn.video)
    expect(checkbox.checked).toBe(true)
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:audio')
    expect(player.getAttribute('src')).toBe('blob:audio')
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => {
      Object.defineProperty(player, 'paused', { configurable: true, value: true })
    })
    fireEvent.click(checkbox)
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:silent')
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('download')).toBe('captured-silent.mp4')
    expect(player.getAttribute('src')).toBe('blob:silent')
    expect(pause).toHaveBeenCalledOnce()
    expect(view.store.getSnapshot().verifiedRevision).toBe(revision)
    fireEvent.change(view.getByLabelText(clipEn.name), { target: { value: 'Another draft' } })
    fireEvent.click(checkbox)
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:audio')
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    view.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('stops an older movie on soundtrack selection and keeps its captured attribution and bytes', () => {
    const view = mount(); design(view)
    const source = alternativeMusic['soundhelix-17']
    const musicCredit = { title: source.title, artist: source.artist, source: source.source, licenseUrl: source.licenseUrl }
    act(() => { view.store.actions.chooseMusic('soundhelix-17'); view.store.actions.generated({ url: 'blob:silent', bytes: 3,
      audio: { url: 'blob:captured-song-17', bytes: 5 }, filename: 'captured.mp4',
      revision: view.store.getSnapshot().revision, clipJson: '{}', musicCredit }) })
    const output = within(view.getByRole('region', { name: clipEn.outputTitle }))
    const player = output.getByLabelText<HTMLVideoElement>(clipEn.video)
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => {
      Object.defineProperty(player, 'paused', { configurable: true, value: true })
    })
    fireEvent.click(view.getByRole('radio', { name: alternativeMusic['soundhelix-8'].title }))
    expect(pause).toHaveBeenCalledOnce()
    expect(player.src).toBe('blob:captured-song-17')
    fireEvent.click(output.getByRole('button', { name: clipEn['audio.saveCredit'] }))
    expect(view.saveText).toHaveBeenCalledWith(JSON.stringify(musicCredit, null, 2) + '\n', 'captured-music-credits.json')
    expect(output.getByRole('status').textContent).toBe(clipEn.stale)
  })

  it('keeps the default-on preference but explicitly saves video only without a soundtrack', () => {
    const view = mount(); design(view)
    act(() => { view.store.actions.generated({ url: 'blob:video-only', bytes: 3, filename: 'plain.mp4',
      revision: view.store.getSnapshot().revision, clipJson: '{}' }) })
    const output = within(view.getByRole('region', { name: clipEn.outputTitle }))
    const checkbox = output.getByRole<HTMLInputElement>('checkbox', { name: clipEn['export.withAudio'] })
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)
    expect(output.getByText(clipEn['export.noAudio'])).toBeTruthy()
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('href')).toBe('blob:video-only')
    expect(output.getByRole('link', { name: clipEn.download }).getAttribute('download')).toBe('plain.mp4')
  })
})

describe('bundled MicroDuck dance selection', () => {
  it.each(danceClipsV2)('loads $id with exact root/contact targets and its own original audio', (dance) => {
    const lab = snapshot()
    lab.catalog = { ...lab.catalog!, profiles: [danceV2Model.profile], limits: danceV2Model.limits }
    lab.scene = danceV2Model.scene
    const view = mount(lab, 262144)
    const picker = view.getByRole('combobox', { name: clipEn['danceClip.choose'] })
    fireEvent.change(picker, { target: { value: dance.id } })
    expect(view.store.getSnapshot()).toMatchObject({ clip: dance.clip, bpm: dance.bpm, prompt: dance.guide,
      audioId: dance.id, playing: false, time: 0, verifiedRevision: null })
    expect(view.getByRole('checkbox', { name: clipEn['audio.mute'] })).toHaveProperty('checked', false)
    fireEvent.click(view.getByRole('checkbox', { name: clipEn['audio.mute'] }))
    fireEvent.change(view.getByRole('slider', { name: clipEn['audio.volume'] }), { target: { value: '0.25' } })
    expect(view.store.getSnapshot()).toMatchObject({ audioMuted: true, audioVolume: 0.25 })
    expect(view.getByRole('button', { name: clipEn.train })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.save }))
    expect(view.saveText).toHaveBeenLastCalledWith(JSON.stringify(dance.clip, null, 2) + '\n', 'microduck-clip.json')
    fireEvent.change(view.getByLabelText(clipEn.name), { target: { value: 'My revision' } })
    expect(view.store.getSnapshot().clip!.name).toBe('My revision')
    expect(view.store.getSnapshot().audioId).toBe(dance.id)
    fireEvent.change(picker, { target: { value: dance.id } })
    expect(view.store.getSnapshot().clip).toEqual(dance.clip)
    expect(dance.clip.name).not.toBe('My revision')
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    expect(view.store.getSnapshot().audioId).toBeNull()
    expect(view.queryByRole('checkbox', { name: clipEn['audio.mute'] })).toBeNull()
  })

  it.each(['model', 'missing-kinematics', 'tempo', 'bytes'] as const)('keeps the draft when a v2 dance fails %s', (failure) => {
    const lab = snapshot()
    lab.catalog = { ...lab.catalog!, profiles: [structuredClone(danceV2Model.profile)], limits: { ...danceV2Model.limits } }
    lab.scene = structuredClone(danceV2Model.scene)
    if (failure === 'model') lab.catalog.profiles[0]!.modelSha256 = 'a'.repeat(64)
    if (failure === 'missing-kinematics') lab.scene = null
    if (failure === 'tempo') lab.catalog.limits.maxBpm = 100
    const view = mount(lab, failure === 'bytes' ? 8 : 262144)
    act(() => { view.store.actions.load(savedSequence().clip) })
    const before = view.store.getSnapshot().clip
    fireEvent.change(view.getByRole('combobox', { name: clipEn['danceClip.choose'] }), { target: { value: 'bachata_v2' } })
    expect(view.store.getSnapshot().clip).toEqual(before)
    expect(view.store.getSnapshot().audioId).toBeNull()
    expect(view.store.getSnapshot().error).toBe(failure === 'bytes' ? 'fileSize' : 'danceClip')
  })

  it.each(danceClips)('loads $id exactly for editing without planning, playback or prior review', (dance) => {
    const view = mount(danceSnapshot(), 262144)
    design(view)
    act(() => { view.store.actions.previewReady(true); view.store.actions.verify(true); view.store.actions.playing(true) })
    const before = view.store.getSnapshot()
    const animate = within(view.getByRole('region', { name: clipEn.animateTitle }))
    const picker = animate.getByRole('combobox', { name: clipEn['danceClip.choose'] })
    expect(within(picker).getAllByRole('option')).toHaveLength(13)
    fireEvent.change(picker, { target: { value: dance.id } })
    expect(view.store.getSnapshot()).toMatchObject({ clip: dance.sequence.clip, prompt: dance.guide,
      bpm: dance.sequence.bpm, steps: [], playing: false, time: 0, unkeyed: false,
      verifiedRevision: null, revision: before.revision + 1, editEpoch: before.editEpoch + 1 })
    expect((picker as HTMLSelectElement).value).toBe('')
    expect(view.openWorkspace).toHaveBeenCalledTimes(2)
    expect(view.generateSequence).not.toHaveBeenCalled()
    expect(view.openTraining).not.toHaveBeenCalled()
    expect(view.guideStore.getSnapshot().guides).toEqual([])
    fireEvent.click(view.getByRole('button', { name: clipEn.save }))
    expect(view.saveText).toHaveBeenLastCalledWith(JSON.stringify(dance.sequence.clip, null, 2) + '\n', 'microduck-clip.json')
    act(() => {
      view.store.actions.seek(1); view.store.actions.joint(danceSnapshot().catalog!.profiles[0]!, 7, 0.2); view.store.actions.key(512)
    })
    expect(view.store.getSnapshot().clip!.keys.find(key => key.t === 1)!.joints[7]).toBe(0.2)
    expect(dance.sequence.clip.keys.find(key => key.t === 1)?.joints[7]).not.toBe(0.2)
    fireEvent.change(picker, { target: { value: dance.id } })
    expect(view.store.getSnapshot().clip).toEqual(dance.sequence.clip)
  })

  it.each(['model', 'joint-order', 'joint-limit', 'key-limit', 'duration-limit', 'tempo-limit', 'byte-limit'] as const)(
    'retains the editable timeline when the chosen dance fails %s', (failure) => {
      const lab = danceSnapshot()
      const target = lab.catalog!.profiles[0]!
      if (failure === 'model') target.modelSha256 = 'b'.repeat(64)
      if (failure === 'joint-order') target.joints = [...target.joints].reverse()
      if (failure === 'joint-limit') target.joints = target.joints.map(joint => ({ ...joint, lower: -0.1, upper: 0.1 }))
      if (failure === 'key-limit') lab.catalog!.limits.maxClipKeys = 2
      if (failure === 'duration-limit') lab.catalog!.limits.maxClipSeconds = 1
      if (failure === 'tempo-limit') lab.catalog!.limits.maxBpm = 100
      const view = mount(lab, failure === 'byte-limit' ? 8 : 262144)
      act(() => { view.store.actions.load(savedSequence().clip); view.store.actions.verify(true) })
      const before = view.store.getSnapshot()
      fireEvent.change(view.getByRole('combobox', { name: clipEn['danceClip.choose'] }), { target: { value: 'bachata' } })
      expect(view.store.getSnapshot()).toMatchObject({ clip: before.clip, revision: before.revision,
        verifiedRevision: before.verifiedRevision, error: failure === 'byte-limit' ? 'fileSize' : 'danceClip' })
      expect(view.getByRole('alert').textContent).toBe(clipEn[failure === 'byte-limit' ? 'error.fileSize' : 'error.danceClip'])
      expect(view.openWorkspace).not.toHaveBeenCalled()
    })

  it.each(['missing-model', 'exporting'] as const)('prevents selection while %s', (reason) => {
    const lab = danceSnapshot()
    if (reason === 'missing-model') lab.catalog = null
    const view = mount(lab, 262144)
    if (reason === 'exporting') {
      act(() => {
        view.store.actions.load(savedSequence().clip); view.store.actions.previewReady(true)
        view.store.actions.verify(true); view.store.actions.generate()
      })
    }
    const picker = view.getByRole('combobox', { name: clipEn['danceClip.choose'] })
    const before = view.store.getSnapshot()
    expect((picker as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(picker, { target: { value: 'bachata' } })
    expect(view.store.getSnapshot()).toEqual(before)
    expect(view.openWorkspace).not.toHaveBeenCalled()
  })

  it('localizes the picker and treats its empty option as no replacement', () => {
    const view = mount(danceSnapshot(), 262144, clipZh)
    const picker = view.getByRole('combobox', { name: clipZh['danceClip.choose'] })
    expect(within(picker).getByRole('option', { name: '巴恰塔 · 30 秒 · 130 BPM' })).toBeTruthy()
    fireEvent.change(picker, { target: { value: '' } })
    expect(view.store.getSnapshot().clip).toBeNull()
    expect(view.openWorkspace).not.toHaveBeenCalled()
  })
})

describe('Clip Gen SequenceByAI and saved timelines', () => {
  it('loads and exports a planted-foot stepping track with locked raw editing and disabled training', async () => {
    const lab = snapshot(); lab.catalog!.limits.maxClipKeys = 512
    const view = mount(lab, 262144)
    fireEvent.click(view.getByRole('button', { name: clipEn.walkDemo }))
    const walking = structuredClone(view.store.getSnapshot().clip!)
    expect(walking).toMatchObject({ version: 3, duration: 20 })
    expect(view.store.getSnapshot().prompt).toBe(clipEn.walkDemoGuide)
    expect(view.getByRole('button', { name: clipEn.train })).toHaveProperty('disabled', true)
    expect(view.getByRole('button', { name: clipEn.key })).toHaveProperty('disabled', true)
    expect(view.getByRole('slider', { name: clipEn.heading }).closest('fieldset')!.disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: clipEn.save }))
    const json = view.saveText.mock.calls[0]![0] as string
    expect(JSON.parse(json)).toEqual(walking)
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    await upload(view, file(json).value)
    expect(view.store.getSnapshot().clip).toEqual(walking)
    expect(view.openTraining).not.toHaveBeenCalled()
  })

  it('does not replace the draft when contact generation cannot fit the configured file limit', () => {
    const lab = snapshot(); lab.catalog!.limits.maxClipKeys = 512
    const view = mount(lab, 100)
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    const before = view.store.getSnapshot().clip
    fireEvent.click(view.getByRole('button', { name: clipEn.walkDemo }))
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.fileSize'])
    expect(view.store.getSnapshot().clip).toEqual(before)
  })

  it('offers a model-bound full-turn preview, preserves heading through save/load and blocks training', async () => {
    const view = mount(snapshot(), 65536)
    fireEvent.click(view.getByRole('button', { name: clipEn.turnDemo }))
    const preview = structuredClone(view.store.getSnapshot().clip!)
    expect(preview).toMatchObject({ version: 2, duration: 20, loop: true })
    expect(view.store.getSnapshot()).toMatchObject({ bpm: 120, prompt: clipEn.turnDemoGuide, playing: false })
    expect(view.getByRole('button', { name: clipEn.train })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.train }))
    expect(view.openTraining).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: clipEn.save }))
    const json = view.saveText.mock.calls[0]![0] as string
    expect(JSON.parse(json)).toEqual(preview)
    fireEvent.change(view.getByRole('slider', { name: clipEn.timeline }), { target: { value: '6' } })
    expect(view.getByRole('slider', { name: clipEn.heading }).getAttribute('aria-valuetext')).toContain('180.0°')
    fireEvent.change(view.getByRole('slider', { name: clipEn.heading }), { target: { value: '1' } })
    expect(view.getByRole('button', { name: clipEn.save })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.key }))
    await upload(view, file(json).value)
    expect(view.store.getSnapshot().clip).toEqual(preview)
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    expect(view.store.getSnapshot().clip!.version).toBe(1)
    expect(view.getByRole('button', { name: clipEn.train })).toHaveProperty('disabled', false)
    fireEvent.click(view.getByRole('button', { name: clipEn.train }))
    expect(view.openTraining).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing clip when the turning example exceeds installed duration limits', () => {
    const lab = snapshot()
    lab.catalog!.limits.maxClipSeconds = 10
    const view = mount(lab)
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    const before = view.store.getSnapshot().clip
    fireEvent.click(view.getByRole('button', { name: clipEn.turnDemo }))
    expect(view.store.getSnapshot().clip).toEqual(before)
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.limits'])
  })

  it.each([
    { language: 'English', copy: clipEn, navigation: 'Drag empty background to rotate the view; scroll to zoom.', editing: 'Body clicks select a joint; drag around its hinge to adjust it.' },
    { language: 'Chinese', copy: clipZh, navigation: '拖动空白背景可旋转视角；滚动可缩放。', editing: '点击身体部位选择关节；绕其铰链拖动可调整。' },
  ])('shows $language view navigation separately from joint editing', ({ copy, navigation, editing }) => {
    const view = mount(snapshot(), 16384, copy)
    expect(view.getByText(navigation, { exact: false })).toBeTruthy()
    expect(view.getByText(editing, { exact: false })).toBeTruthy()
    expect(view.store.getSnapshot().clip).toBeNull()
    expect(view.openTraining).not.toHaveBeenCalled()
    expect(view.generateSequence).not.toHaveBeenCalled()
  })

  it('keeps generation explicit and forwards exact text, parsed tempo, edit epoch and the library save callback', () => {
    const view = mount()
    const button = () => view.getByRole('button', { name: clipEn.sequenceByAI }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    expect(view.generateSequence).not.toHaveBeenCalled()
    expect(view.cancelSequence).not.toHaveBeenCalled()
    const prompt = '  点头 🦆\nThen hold at 137 BPM.  '
    fireEvent.change(view.getByRole('textbox', { name: clipEn.prompt }), { target: { value: prompt } })
    expect(button().disabled).toBe(false)
    expect(view.generateSequence).not.toHaveBeenCalled()
    fireEvent.click(button())
    expect(view.generateSequence).toHaveBeenCalledExactlyOnceWith({ prompt, bpm: 137, editEpoch: view.store.getSnapshot().editEpoch },
      view.guideStore.actions.saveSequence)
    expect(view.store.getSnapshot().clip).toBeNull()
    const generated = savedSequence()
    act(() => { view.generateSequence.mock.calls[0]![1](prompt, generated) })
    expect(view.guideStore.getSnapshot().guides[0]).toEqual({ id: 1, name: generated.clip.name, prompt, sequence: generated })
    expect(view.getByRole('option', { name: clipEn['guide.sequenceName'].replace('{name}', generated.clip.name) })).toBeTruthy()
    expect(view.store.getSnapshot().clip).toBeNull()
    expect(view.publishVideo).not.toHaveBeenCalled()
    expect(view.openTraining).not.toHaveBeenCalled()
  })

  it('uses the current tempo without rewriting user text when no BPM is stated', () => {
    const view = mount()
    design(view, 'left leg at 90 BPM')
    const prompt = '  Custom movement 🦆\nNo numeric tempo  '
    fireEvent.change(view.getByRole('textbox', { name: clipEn.prompt }), { target: { value: prompt } })
    fireEvent.click(view.getByRole('button', { name: clipEn.sequenceByAI }))
    expect(view.generateSequence).toHaveBeenCalledExactlyOnceWith({ prompt, bpm: 90, editEpoch: view.store.getSnapshot().editEpoch },
      view.guideStore.actions.saveSequence)
  })

  it.each(['missing-model', 'blank-prompt', 'exporting'] as const)('keeps AI generation disabled for %s', (reason) => {
    const lab = snapshot()
    if (reason === 'missing-model') lab.catalog = null
    const view = mount(lab)
    if (reason === 'exporting') {
      design(view)
      act(() => { view.store.actions.previewReady(true); view.store.actions.verify(true); view.store.actions.generate() })
    } else fireEvent.change(view.getByRole('textbox', { name: clipEn.prompt }), { target: { value: reason === 'blank-prompt' ? '  ' : 'Dance' } })
    const button = view.getByRole('button', { name: clipEn.sequenceByAI }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(view.generateSequence).not.toHaveBeenCalled()
  })

  it('shows pending state, disables duplicate generation and cancels only through the supplied owner', () => {
    const view = mount()
    fireEvent.change(view.getByRole('textbox', { name: clipEn.prompt }), { target: { value: 'Generate a nod' } })
    act(() => { view.store.actions.aiStart(requestId, 'Generate a nod', view.store.getSnapshot().editEpoch) })
    expect(view.getByText(clipEn.aiPending)).toBeTruthy()
    expect(view.getByRole('button', { name: clipEn.sequenceByAI })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.sequenceByAI }))
    expect(view.generateSequence).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: clipEn.aiCancel }))
    expect(view.cancelSequence).toHaveBeenCalledTimes(1)
    expect(view.queryByText(clipEn.aiPending)).toBeNull()
    expect(view.store.getSnapshot().ai).toEqual({ status: 'idle' })
    view.unmount()
    expect(view.cancelSequence).toHaveBeenCalledTimes(2)
  })

  it('reloads every exact keyed target and tempo from the guide and invalidates prior review', () => {
    const view = mount()
    design(view)
    act(() => { view.store.actions.verify(true); view.store.actions.playing(true) })
    const before = view.store.getSnapshot()
    const saved = savedSequence()
    const prompt = '  Original instructions 🦆\n'
    selectSequence(view, saved, prompt)
    expect(view.store.getSnapshot()).toMatchObject({ prompt, clip: saved.clip, bpm: saved.bpm, steps: [],
      time: 0, playing: false, verifiedRevision: null, unkeyed: false, revision: before.revision + 1 })
    expect(view.getByRole('textbox', { name: clipEn.name })).toHaveProperty('value', saved.clip.name)
    expect(view.getByRole('spinbutton', { name: clipEn.duration })).toHaveProperty('value', String(saved.clip.duration))
    expect(view.getAllByRole('button', { name: /^Key at / })).toHaveLength(saved.clip.keys.length)
    expect(view.getByRole('checkbox', { name: clipEn.verified })).toHaveProperty('checked', false)
    expect(view.openWorkspace).toHaveBeenCalledTimes(2)
    expect(view.generateSequence).not.toHaveBeenCalled()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })

  it('keeps prompt-only guide selection separate from timeline replacement', () => {
    const view = mount()
    design(view)
    const clip = view.store.getSnapshot().clip
    fireEvent.change(view.getByRole('combobox', { name: clipEn['guide.choose'] }), { target: { value: 'starter-bounce' } })
    expect(view.store.getSnapshot().prompt).toBe(clipEn['guide.bounce.prompt'])
    expect(view.store.getSnapshot().clip).toBe(clip)
    expect(view.generateSequence).not.toHaveBeenCalled()
  })

  it.each(['model-hash', 'joint-order', 'malformed-keys'] as const)('refuses a saved %s mismatch without changing the draft', (reason) => {
    const view = mount()
    design(view)
    const before = view.store.getSnapshot()
    const saved = savedSequence()
    if (reason === 'model-hash') saved.modelSha256 = 'b'.repeat(64)
    if (reason === 'joint-order') saved.jointNames.reverse()
    if (reason === 'malformed-keys') saved.clip.keys[1]!.joints = []
    selectSequence(view, saved)
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.aiProfile'])
    expect(view.store.getSnapshot()).toMatchObject({ prompt: before.prompt, clip: before.clip, revision: before.revision })
    expect(view.openWorkspace).toHaveBeenCalledTimes(1)
  })

  it('refuses sequence loading when the current model is unavailable while keeping prompt guides usable', () => {
    const lab = snapshot(); lab.catalog = null
    const view = mount(lab)
    selectSequence(view)
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.aiUnavailable'])
    expect(view.store.getSnapshot().clip).toBeNull()
    expect(view.store.getSnapshot().prompt).toBe('')
    expect(view.openWorkspace).not.toHaveBeenCalled()
    fireEvent.change(view.getByRole('combobox', { name: clipEn['guide.choose'] }), { target: { value: 'starter-hello' } })
    expect(view.store.getSnapshot().prompt).toBe(clipEn['guide.hello.prompt'])
  })

  it('loads the generated guide and motion for manual editing and offers a plain clip JSON download', () => {
    const view = mount(snapshot(), 16384, clipZh)
    const result = savedSequence()
    const lyrics = '根据歌词改编鸭子舞蹈：左三圈，右三圈，脖子扭扭。'
    view.generateSequence.mockImplementation((input, save) => {
      view.store.actions.aiStart(requestId, input.prompt, input.editEpoch)
      view.store.actions.aiReceive(requestId, result, generatedGuide)
      save(generatedGuide, result)
    })
    fireEvent.change(view.getByRole('textbox', { name: clipZh.prompt }), { target: { value: lyrics } })
    fireEvent.click(view.getByRole('button', { name: clipZh.sequenceByAI }))
    expect(view.generateSequence.mock.calls[0]![0].prompt).toBe(lyrics)
    expect(view.getByRole('textbox', { name: clipZh.prompt })).toHaveProperty('value', generatedGuide)
    expect(view.store.getSnapshot()).toMatchObject({ clip: result.clip, bpm: result.bpm, steps: [],
      playing: false, verifiedRevision: null, exporting: false, exportRequest: 0 })
    expect(view.guideStore.getSnapshot().guides).toMatchObject([{ prompt: generatedGuide, sequence: result }])
    expect(view.saveText).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: clipZh.aiDownload }))
    expect(view.saveText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result.clip, null, 2) + '\n', 'microduck-motion-123.5bpm.json')
    fireEvent.change(view.getByRole('textbox', { name: clipZh.prompt }), { target: { value: '我修改后的指南' } })
    expect(view.store.getSnapshot().prompt).toBe('我修改后的指南')
    expect(view.store.getSnapshot().ai).toMatchObject({ status: 'ready', prompt: lyrics, guide: generatedGuide })
    expect(view.openTraining).not.toHaveBeenCalled()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })

  it('shows a changed-draft candidate and replaces the current timeline only on explicit confirmation', () => {
    const view = mount()
    design(view)
    const result = savedSequence()
    act(() => {
      view.store.actions.aiStart(requestId, 'Generated instructions', view.store.getSnapshot().editEpoch)
      view.store.actions.meta({ name: 'My local edit' })
      view.store.actions.aiReceive(requestId, result, generatedGuide)
      view.store.actions.verify(true)
    })
    expect(view.getByText(clipEn.aiChanged)).toBeTruthy()
    expect(view.store.getSnapshot().clip?.name).toBe('My local edit')
    expect(view.getByText(clipEn.aiGuide)).toBeTruthy()
    const beforeDownload = view.store.getSnapshot()
    fireEvent.click(view.getByRole('button', { name: clipEn.aiDownload }))
    expect(view.saveText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result.clip, null, 2) + '\n', 'microduck-motion-123.5bpm.json')
    expect(view.store.getSnapshot()).toEqual(beforeDownload)
    expect(view.publishVideo).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: clipEn.aiApply }))
    expect(view.store.getSnapshot()).toMatchObject({ clip: result.clip, prompt: generatedGuide, verifiedRevision: null })
    expect(view.getByText(clipEn.aiLoaded)).toBeTruthy()
    expect(view.queryByRole('button', { name: clipEn.aiApply })).toBeNull()
    expect(view.openWorkspace).toHaveBeenCalledTimes(2)
    expect(view.generateSequence).not.toHaveBeenCalled()
  })

  it('refuses candidate replacement if its model fingerprint does not match', () => {
    const view = mount()
    design(view)
    const result = { ...savedSequence(), modelSha256: 'b'.repeat(64) }
    act(() => {
      view.store.actions.aiStart(requestId, 'Generated instructions', view.store.getSnapshot().editEpoch)
      view.store.actions.meta({ name: 'Keep my edit' })
      view.store.actions.aiReceive(requestId, result, generatedGuide)
    })
    const before = view.store.getSnapshot()
    fireEvent.click(view.getByRole('button', { name: clipEn.aiApply }))
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.aiProfile'])
    expect(view.store.getSnapshot()).toMatchObject({ clip: before.clip, revision: before.revision, prompt: before.prompt })
    expect(view.getByText(clipEn.aiChanged)).toBeTruthy()
    expect(view.openWorkspace).toHaveBeenCalledTimes(1)
  })

  it('disables candidate replacement during capture', () => {
    const view = mount()
    design(view)
    act(() => {
      view.store.actions.aiStart(requestId, 'Generated instructions', view.store.getSnapshot().editEpoch)
      view.store.actions.meta({ name: 'Keep captured edit' })
      view.store.actions.aiReceive(requestId, savedSequence(), generatedGuide)
      view.store.actions.previewReady(true); view.store.actions.verify(true); view.store.actions.generate()
    })
    const before = view.store.getSnapshot()
    const apply = view.getByRole('button', { name: clipEn.aiApply }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)
    expect(view.store.getSnapshot()).toEqual(before)
  })
})

describe('Clip Gen central authoring and animation controls', () => {
  it('shows four ordered sections without implicitly designing, playing or exporting', () => {
    const view = mount()
    expect(view.getByRole('region', { name: clipEn.title }).hasAttribute('data-conversation-composer-overlay')).toBe(true)
    expect(view.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual([
      clipEn.planTitle, clipEn.mappingTitle, clipEn.animateTitle, clipEn.outputTitle,
    ])
    expect(view.getByText(clipEn.scope)).toBeTruthy()
    expect(view.getByText(clipEn.planHint)).toBeTruthy()
    expect(view.store.getSnapshot()).toMatchObject({ clip: null, playing: false, exporting: false, exportRequest: 0 })
    expect(view.openWorkspace).not.toHaveBeenCalled()
    expect(view.refresh).not.toHaveBeenCalled()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })

  it('designs an ordered recipe in real joint order and exposes all fourteen mapping rows', () => {
    const view = mount()
    design(view)
    expect(view.store.getSnapshot()).toMatchObject({ bpm: 90, steps: [
      { action: 'right-step', beats: 2 }, { action: 'neck-nod', beats: 2 }, { action: 'left-step', beats: 2 },
    ], clip: { duration: 4, keys: expect.any(Array) as unknown }, time: 0, playing: false })
    expect(view.openWorkspace).toHaveBeenCalledOnce()
    const table = within(view.getByRole('table'))
    expect(table.getAllByRole('row')).toHaveLength(15)
    expect(table.getAllByRole('button').map(button => button.textContent)).toEqual(poseFixture.scene.jointNames)
    const left = table.getByRole('button', { name: 'left_hip_pitch' }).closest('tr')!
    const right = table.getByRole('button', { name: 'right_hip_pitch' }).closest('tr')!
    expect(within(left).getByText(clipEn['action.left-step'])).toBeTruthy()
    expect(within(right).getByText(clipEn['action.right-step'])).toBeTruthy()
    fireEvent.click(table.getByRole('button', { name: 'head_yaw' }))
    expect(view.store.getSnapshot()).toMatchObject({ selectedJoint: 7, mode: 'joints' })
    expect(view.getByRole('button', { name: clipEn.joints }).getAttribute('aria-pressed')).toBe('true')
  })

  it('lets users reorder, replace and resize recipe actions without starting playback', () => {
    const view = mount()
    design(view)
    fireEvent.click(view.getByRole('button', { name: 'Move action 3 earlier' }))
    expect(view.store.getSnapshot().steps.map(step => step.action)).toEqual(['right-step', 'left-step', 'neck-nod'])
    fireEvent.click(view.getByRole('button', { name: 'Move action 1 later' }))
    fireEvent.change(view.getByRole('combobox', { name: 'Action 1' }), { target: { value: 'squat' } })
    fireEvent.change(view.getByRole('spinbutton', { name: 'Beats for action 1' }), { target: { value: '4' } })
    fireEvent.change(view.getByRole('spinbutton', { name: clipEn.bpm }), { target: { value: '120' } })
    fireEvent.change(view.getByRole('slider', { name: clipEn.moveSize }), { target: { value: '0.8' } })
    expect(view.store.getSnapshot()).toMatchObject({ bpm: 120, moveSize: 0.8, clip: { duration: 4 }, playing: false })
    fireEvent.click(view.getByRole('button', { name: 'Remove action 2' }))
    expect(view.store.getSnapshot().steps.map(step => step.action)).toEqual(['squat', 'neck-nod'])
    fireEvent.click(view.getByRole('button', { name: clipEn.add }))
    expect(view.store.getSnapshot().steps.at(-1)).toEqual({ action: 'left-step', beats: 2 })
  })

  it('reports an unsupported request or excessive duration without replacing a previous sequence', () => {
    const view = mount()
    design(view)
    const before = view.store.getSnapshot().clip
    design(view, 'fly to the moon')
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.unsupported'])
    expect(view.store.getSnapshot().clip).toBe(before)
    design(view, 'dance at 999 BPM')
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.limits'])
    expect(view.store.getSnapshot().clip).toBe(before)
  })

  it('requires keyed pose edits and review of the current revision before exporting', () => {
    const view = mount()
    design(view)
    const generate = () => view.getByRole('button', { name: clipEn.generate }) as HTMLButtonElement
    const verify = () => view.getByRole('checkbox', { name: clipEn.verified }) as HTMLInputElement
    expect(generate().disabled).toBe(true)
    fireEvent.click(verify())
    expect(generate().disabled).toBe(true)
    fireEvent.click(generate())
    expect(view.store.getSnapshot().exportRequest).toBe(0)
    act(() => { view.store.actions.previewReady(true) })
    expect(generate().disabled).toBe(false)
    fireEvent.change(view.getByRole('slider', { name: clipEn.root }), { target: { value: '0.3' } })
    expect(view.getByText(clipEn.unkeyed)).toBeTruthy()
    expect(verify().checked).toBe(false)
    expect(verify().disabled).toBe(true)
    for (const name of [clipEn.save, clipEn.play, clipEn.generate]) expect(view.getByRole('button', { name })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.key }))
    expect(view.getByText(clipEn.keyed)).toBeTruthy()
    expect(view.store.getSnapshot().clip?.keys[0]?.rootPitch).toBe(0.3)
    fireEvent.click(verify())
    fireEvent.change(view.getByRole('textbox', { name: clipEn.name }), { target: { value: 'Reviewed dance 🦆' } })
    expect(verify().checked).toBe(false)
    expect(generate().disabled).toBe(true)
    fireEvent.click(verify())
    fireEvent.click(view.getByRole('button', { name: clipEn.save }))
    const saved = JSON.parse(view.saveText.mock.calls[0]![0] as string) as RobotClip
    expect(saved).toMatchObject({ name: 'Reviewed dance 🦆', keys: [{ rootPitch: 0.3 }, ...saved.keys.slice(1)] })
    act(() => { view.store.actions.previewReady(false) })
    expect(generate().disabled).toBe(true)
    act(() => { view.store.actions.previewReady(true) })
    fireEvent.click(generate())
    expect(view.store.getSnapshot()).toMatchObject({ exporting: true, exportRequest: 1, time: 0, playing: false })
    expect(view.getByRole('button', { name: clipEn.generating })).toHaveProperty('disabled', true)
    expect(view.getByRole('textbox', { name: clipEn.name })).toHaveProperty('disabled', true)
    expect(view.publishVideo).not.toHaveBeenCalled()
  })

  it.each([clipEn, clipZh])('explains real-part icons, joint angles and rig amounts in the selected locale', (copy) => {
    const view = mount({ ...snapshot(), scene: clipPartScene() }, 16384, copy)
    fireEvent.change(view.getByRole('textbox', { name: copy.prompt }), { target: { value: 'neck nod' } })
    fireEvent.click(view.getByRole('button', { name: copy.design }))
    expect(view.getByText(copy.anatomyHint)).toBeTruthy()
    expect(view.getByText(copy.rigControlHint)).toBeTruthy()
    expect(view.getByText(copy['rigHelp.look'])).toBeTruthy()
    const rig = view.getByRole('slider', { name: copy['rig.look'] })
    expect(rig.getAttribute('aria-valuetext')).toBe(copy.rigValue.replace('{value}', '0.000'))
    expect(rig.closest('label')!.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    const before = view.store.getSnapshot()
    fireEvent.click(rig.closest('label')!.querySelector('svg')!)
    expect(view.store.getSnapshot()).toEqual(before)
    fireEvent.click(view.getByRole('button', { name: copy.joints }))
    expect(view.getByText(copy.jointControlHint)).toBeTruthy()
    expect(view.getByText(copy['joint.left_hip_yaw'])).toBeTruthy()
    expect(view.getByText(copy['joint.right_ankle'])).toBeTruthy()
    for (const joint of profile.joints) {
      const slider = view.getByRole('slider', { name: joint.name })
      const icon = slider.closest('label')!.querySelector('svg')!
      expect(icon.getAttribute('aria-hidden')).toBe('true')
      expect(icon.getAttribute('focusable')).toBe('false')
      expect(slider.getAttribute('aria-valuetext')).toContain('rad')
      expect(slider.getAttribute('aria-valuetext')).toContain('°')
      for (const id of slider.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)?.textContent).toBeTruthy()
    }
    const neck = view.getByRole('slider', { name: 'neck_pitch' })
    expect(neck.getAttribute('aria-valuetext')).toBe(copy.angleValue.replace('{radians}', '0.349').replace('{degrees}', '20.0'))
    fireEvent.change(neck, { target: { value: '0.5' } })
    expect(view.store.getSnapshot()).toMatchObject({ selectedJoint: 5, unkeyed: true, verifiedRevision: null })
    fireEvent.click(view.getByRole('button', { name: copy.reset.replace('{name}', 'neck_pitch') }))
    expect(view.store.getSnapshot().pose?.joints[5]).toBe(profile.joints[5]!.defaultPosition)
    const root = view.getByRole('slider', { name: copy.root })
    expect(root.closest('label')!.textContent).toContain(copy.rootHelp)
    expect(root.closest('label')!.querySelector('svg')).not.toBeNull()
    expect(view.publishVideo).not.toHaveBeenCalled()
    expect(view.openTraining).not.toHaveBeenCalled()
  })

  it('keeps usable named controls when geometry or the matching joint-order metadata is unavailable', () => {
    const lab = snapshot()
    const mismatched = { ...lab, scene: { ...clipPartScene(), jointNames: [...lab.scene!.jointNames].reverse() } }
    const view = mount(mismatched)
    design(view)
    expect(view.getByText(clipEn.anatomyUnavailable)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: clipEn.joints }))
    expect(view.getByText(clipEn['joint.head_roll'])).toBeTruthy()
    const slider = view.getByRole('slider', { name: 'head_roll' })
    expect(slider.closest('label')!.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    fireEvent.change(slider, { target: { value: '0.05' } })
    expect(view.store.getSnapshot().pose?.joints[8]).toBe(0.05)
  })

  it('keys raw joint and rig edits, deletes the selected key and protects the first key', () => {
    const view = mount()
    design(view, 'left leg')
    fireEvent.change(view.getByRole('slider', { name: clipEn.timeline }), { target: { value: '0.25' } })
    fireEvent.click(view.getByRole('button', { name: clipEn.joints }))
    fireEvent.change(view.getByRole('slider', { name: 'head_yaw' }), { target: { value: '0.2' } })
    expect(view.store.getSnapshot()).toMatchObject({ selectedJoint: 7, unkeyed: true })
    fireEvent.click(view.getByRole('button', { name: clipEn.key }))
    expect(view.store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 0.25, 0.5, 1])
    expect(view.getByRole('button', { name: 'Key at 0.25 seconds' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: clipEn.deleteKey }))
    expect(view.store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 0.5, 1])
    fireEvent.click(view.getByRole('button', { name: clipEn.first }))
    expect(view.getByRole('button', { name: clipEn.deleteKey })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.rig }))
    fireEvent.change(view.getByRole('slider', { name: clipEn['rig.look'] }), { target: { value: '0.1' } })
    expect(view.store.getSnapshot()).toMatchObject({ rig: 'look', unkeyed: true })
    fireEvent.click(view.getByRole('button', { name: clipEn.defaultPose }))
    expect(view.store.getSnapshot().pose?.joints).toEqual(poseFixture.scene.defaultJoints)
  })

  it('retimes keys and playback controls without implying that a preview is a trained policy', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: clipEn.newClip }))
    fireEvent.change(view.getByRole('spinbutton', { name: clipEn.duration }), { target: { value: '2' } })
    expect(view.store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 2])
    fireEvent.click(view.getByRole('checkbox', { name: clipEn.loop }))
    expect(view.store.getSnapshot().clip?.loop).toBe(false)
    fireEvent.click(view.getByRole('button', { name: clipEn.play }))
    expect(view.store.getSnapshot().playing).toBe(true)
    fireEvent.click(view.getByRole('button', { name: clipEn.pause }))
    expect(view.store.getSnapshot().playing).toBe(false)
    fireEvent.click(view.getByRole('button', { name: clipEn.focus }))
    expect(view.store.getSnapshot().cameraReset).toBe(1)
    expect(view.getByText(clipEn.scope)).toBeTruthy()
  })

  it('validates imported JSON before replacement and lets a valid named reference load', async () => {
    const view = mount()
    design(view)
    const before = view.store.getSnapshot().clip
    await upload(view, file('{').value)
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.import'])
    expect(view.store.getSnapshot().clip).toBe(before)
    const reference = compileClip(profile, [{ action: 'head-turn', beats: 2 }], 120, 0.5, '导入 🦆', false)
    await upload(view, file(JSON.stringify({ ...reference, keys: [{ t: 0, joints: [0], rootPitch: 0 }] })).value)
    expect(view.store.getSnapshot().clip).toBe(before)
    await upload(view, file(JSON.stringify(reference)).value)
    expect(view.store.getSnapshot()).toMatchObject({ clip: reference, steps: [], time: 0, unkeyed: false, verifiedRevision: null })
    expect(view.getByRole('textbox', { name: clipEn.name })).toHaveProperty('value', '导入 🦆')
  })

  it('rejects an oversized import before reading its text', async () => {
    const view = mount(snapshot(), 32)
    const imported = file('x'.repeat(33))
    await upload(view, imported.value)
    expect(imported.text).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toBe(clipEn['error.fileSize'])
    expect(view.store.getSnapshot().clip).toBeNull()
  })

  it.each(['edit', 'unmount'] as const)('discards delayed file reads after %s', async (action) => {
    const view = mount()
    design(view)
    const reference = compileClip(profile, [{ action: 'stand', beats: 2 }], 120, 0.5, 'Late import', false)
    let resolve!: (value: string) => void
    const pending = new Promise<string>((accept) => { resolve = accept })
    const imported = file('pending')
    imported.text.mockReturnValue(pending)
    fireEvent.change(view.getByLabelText(clipEn.load, { selector: 'input' }), { target: { files: [imported.value] } })
    if (action === 'edit') fireEvent.change(view.getByRole('textbox', { name: clipEn.name }), { target: { value: 'Keep my edit' } })
    else view.unmount()
    const before = view.store.getSnapshot()
    await act(async () => { resolve(JSON.stringify(reference)); await pending })
    expect(view.store.getSnapshot()).toBe(before)
  })

  it('holds generation when the scene has no live pose metadata', () => {
    const lab = snapshot()
    const { kinematics: _kinematics, ...scene } = poseFixture.scene
    lab.scene = scene
    const view = mount(lab)
    design(view)
    act(() => { view.store.actions.previewReady(true) })
    fireEvent.click(view.getByRole('checkbox', { name: clipEn.verified }))
    expect(view.getByRole('button', { name: clipEn.generate })).toHaveProperty('disabled', true)
    expect(view.store.getSnapshot().exporting).toBe(false)
  })

  it('keeps readiness failure explicit and refreshes only when requested', () => {
    const lab = snapshot()
    lab.catalog = null
    lab.error = 'Model unavailable'
    const view = mount(lab)
    expect(view.getByRole('alert').textContent).toBe('Model unavailable')
    expect(view.getByText(clipEn.disabled)).toBeTruthy()
    expect(view.getByRole('button', { name: clipEn.newClip })).toHaveProperty('disabled', true)
    expect(view.getByRole('button', { name: clipEn.design })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: clipEn.refresh }))
    expect(view.refresh).toHaveBeenCalledOnce()
  })

  it('keeps matching output JSON distinct from later edits and hands current JSON to training', () => {
    const view = mount()
    design(view)
    const original = JSON.stringify(view.store.getSnapshot().clip)
    act(() => { view.store.actions.generated({ url: 'blob:finished', filename: 'dance.mp4', clipJson: original,
      revision: view.store.getSnapshot().revision, bytes: 128 }) })
    fireEvent.change(view.getByRole('textbox', { name: clipEn.name }), { target: { value: 'Next revision' } })
    expect(view.getByText(clipEn.stale)).toBeTruthy()
    const download = view.getByRole('link', { name: clipEn.download }) as HTMLAnchorElement
    expect(download.href).toBe('blob:finished')
    expect(download.download).toBe('dance.mp4')
    fireEvent.click(view.getByRole('button', { name: clipEn.outputJson }))
    expect(view.saveText).toHaveBeenLastCalledWith(original, 'microduck-clip.json')
    fireEvent.click(view.getByRole('button', { name: clipEn.train }))
    const training = JSON.parse(view.saveText.mock.calls.at(-1)![0] as string) as RobotClip
    expect(training.name).toBe('Next revision')
    expect(view.openTraining).toHaveBeenCalledOnce()
    expect(view.publishVideo).not.toHaveBeenCalled()
  })
})
