// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipSimulation } from '../src/client/ClipSimulation.tsx'
import { ClipGenPanel } from '../src/client/ClipGenPanel.tsx'
import type { ClipPoseStageProps } from '../src/client/ClipPoseStage.tsx'
import type { ClipGenProps, ClipSimulationProps } from '../src/client/clip-gen-props.ts'
import type { ClipVideoOutput } from '../src/client/clip-gen-store.ts'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { dancePresets } from '../src/client/dance-presets.ts'
import { sampleAuthoredClip } from '../src/client/clip-motion.ts'
import type { WalkingClip } from '../src/client/clip-walking.ts'
import { recordClipMovie } from '../src/client/clip-movie.ts'
import type { ClipMovieOptions } from '../src/client/clip-movie.ts'
import { ClipVideoError } from '../src/client/clip-video.ts'
import { clipEn } from '../src/client/clip-gen-locales.ts'
import { readySnapshot } from './fixtures.client.ts'
import { danceV2Model as model } from './dance-v2-fixture.ts'

const stage = vi.hoisted(() => ({ props: null as ClipPoseStageProps | null }))
vi.mock('../src/client/ClipPoseStage.tsx', async () => {
  const { useEffect, useRef } = await import('react')
  return { ClipPoseStage: (props: ClipPoseStageProps) => {
    stage.props = props
    const canvas = useRef<HTMLCanvasElement>(null)
    useEffect(() => { props.onCanvas?.(canvas.current); return () => { props.onCanvas?.(null) } }, [props.onCanvas])
    return <canvas ref={canvas} aria-label={props.label} />
  } }
})
vi.mock('../src/client/clip-movie.ts', async original => ({
  ...await original<typeof import('../src/client/clip-movie.ts')>(), recordClipMovie: vi.fn(),
}))
const frames = new Map<number, FrameRequestCallback>()
let serial = 0
let capture: {
  options: ClipMovieOptions
  resolve: (result: Awaited<ReturnType<typeof recordClipMovie>>) => void
  reject: (error: unknown) => void
  promise: ReturnType<typeof recordClipMovie>
} | undefined
beforeEach(() => {
  capture = undefined; stage.props = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = () => 'blob:group-mp4' })
  vi.mocked(recordClipMovie).mockImplementation((options) => {
    let resolve!: NonNullable<typeof capture>['resolve'], reject!: NonNullable<typeof capture>['reject']
    const promise = new Promise<Awaited<ReturnType<typeof recordClipMovie>>>((accept, fail) => { resolve = accept; reject = fail })
    capture = { options, promise, resolve, reject }
    return promise
  })
})
afterEach(async () => {
  cleanup(); capture?.reject(new ClipVideoError('aborted'))
  await capture?.promise.catch(() => undefined)
  frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

const t: ClipSimulationProps['t'] = (key, params) => clipEn[key as keyof typeof clipEn].replace(/\{(\w+)\}/g,
  (match, name: string) => params !== undefined && name in params ? String(params[name]) : match)

describe('whole-view multi-duck MP4 entry points', () => {
  it.each(['workspace', 'editor'])('records all configured ducks from the %s button and retains the captured count', async (entry) => {
    const store = createClipGenStore(120, 8).create()
    const primary = dancePresets.find(dance => dance.id === 'cumbia_v2')!
    const independent = dancePresets.find(dance => dance.id === 'salsa_v2')!
    const primaryClip: WalkingClip = primary.clip as WalkingClip
    store.actions.loadDance(primary.guide, primary.bpm, primaryClip, 'cumbia_v2')
    const lab = { ...readySnapshot(), scene: model.scene,
      catalog: { ...readySnapshot().catalog!, profiles: [model.profile], limits: model.limits } }
    const publishVideo = vi.fn((video: ClipVideoOutput) => { store.actions.generated(video) })
    const props = { useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
      useLab: selector => selector(lab), actions: store.actions, t, publishVideo, saveText: vi.fn(),
      maxDpr: 1, defaultBpm: 120, frameRate: 30, videoBitsPerSecond: 4000000, finalizeTimeoutMs: 1000,
      maxFileBytes: 262144, maxDucks: 8, refresh: vi.fn(), openWorkspace: vi.fn(), openTraining: vi.fn(),
      generateSequence: vi.fn(), cancelSequence: vi.fn(),
    } as ClipSimulationProps
    const viewport = render(<ClipSimulation {...props} />)
    const controls = within(viewport.container)
    fireEvent.click(controls.getByRole('button', { name: 'Add duck' }))
    fireEvent.click(controls.getByRole('button', { name: 'Add duck' }))
    fireEvent.change(controls.getByRole('combobox', { name: 'Duck 3 dance' }), { target: { value: 'salsa_v2' } })
    expect(stage.props!.ensemble!.companions).toHaveLength(2)
    expect(stage.props!.ensemble!.companions.map(duck => duck.label)).toEqual(['Duck 2', 'Duck 3'])
    const author = entry === 'editor' ? render(<ClipGenPanel {...props as unknown as ClipGenProps} renderSlot={() => null} />) : null
    const buttons = author === null ? controls : within(author.container)
    if (author === null) fireEvent.click(controls.getByText(clipEn['sim.export']))
    fireEvent.click(buttons.getByRole('checkbox', { name: clipEn.verified }))
    fireEvent.click(buttons.getByRole('button', { name: clipEn.generate }))
    expect(capture!.options.canvas).toBe(viewport.container.querySelector('canvas'))
    expect(capture!.options.durationMs).toBeCloseTo(primary.clip.duration * 1000)
    expect(stage.props!.cameraLocked).toBe(true)
    act(() => {
      capture!.options.onStarted(() => 5)
      const pending = [...frames.values()]; frames.clear()
      for (const callback of pending) callback(5000)
    })
    expect(stage.props!.ensemble!.companions[0]!.pose).toEqual(sampleAuthoredClip(primary.clip, 5))
    expect(stage.props!.ensemble!.companions[1]!.pose)
      .toEqual(sampleAuthoredClip(independent.clip, 5 * primary.bpm / independent.bpm))
    act(() => { store.actions.addDuck(); store.actions.removeDuck(3); store.actions.duckDance(3, null) })
    expect(stage.props!.ensemble!.companions).toHaveLength(2)
    await act(async () => {
      capture!.resolve({ blob: new Blob(['whole-canvas MP4']), mimeType: 'video/mp4' }); await capture!.promise
    })
    expect(publishVideo.mock.calls[0]![0].duckCount).toBe(3)
    expect(JSON.parse(publishVideo.mock.calls[0]![0].clipJson)).toEqual(primary.clip)
    act(() => { store.actions.removeDuck(3) })
    expect(controls.getByText('This MP4 captured 3 ducks. The accompanying clip JSON describes Duck 1 only.')).toBeTruthy()
    expect(controls.getByRole('button', { name: clipEn['ducks.outputJson'] })).toBeTruthy()
    if (author !== null) expect(within(author.container).getByRole('button', { name: clipEn['ducks.outputJson'] })).toBeTruthy()
  })
})
