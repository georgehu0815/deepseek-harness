/** Right-column authored preview owns its canvas, current-view PNG download and cancellable MP4 capture. */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClipSimulationProps } from './clip-gen-props.ts'
import type { ClipRig } from './clip-motion.ts'
import { applyClipRig, measureClipRig, compileClip, defaultClipPose } from './clip-motion.ts'
import { ClipWorkspaceControls } from './ClipWorkspaceControls.tsx'
import { ClipPoseStage } from './ClipPoseStage.tsx'
import { ClipVideoError } from './clip-video.ts'
import { recordClipMovie } from './clip-movie.ts'
import { resolveClipSoundtrack } from './clip-soundtrack.ts'
import { startClipAudio } from './clip-audio.ts'
import { sampleClipDuck } from './clip-ducks.ts'
import css from './ClipGen.module.css'

/**
 * Render the preview only under an existing session; opening a visual tab never creates a session.
 * @param props - root visual bindings and the declared session-scoped child.
 * @returns the bound preview or a localized session-selection hint.
 */
export function ClipSimulationEntry(props: PropsRuntime<'visual.workspace.view'> & PropsLocale<'clip-gen'>
  & PropsRenderSlots<'robot-lab.clip.player'>) {
  return <props.SessionProvider empty={() => <section className={css.simulation} aria-label={props.t('workspace')}>
    <h2>{props.t('workspace')}</h2><p>{props.t('session')}</p>
  </section>}>{props.renderSlot('robot-lab.clip.player', {})}</props.SessionProvider>
}

class ClipRenderBoundary extends Component<{ label: string; onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override componentDidCatch() { this.props.onError() }
  override render() { return this.state.failed ? <p role="alert">{this.props.label}</p> : this.props.children }
}

function pickedRig(name: string | undefined): ClipRig {
  if (name === undefined) return 'lean'
  if (name.includes('knee')) return 'squat'
  if (name.includes('ankle')) return 'toes'
  if (name === 'left_hip_pitch') return 'swingL'
  if (name === 'right_hip_pitch') return 'swingR'
  if (name.includes('hip_roll')) return 'sway'
  if (name.includes('hip_yaw')) return 'twist'
  return 'look'
}

/**
 * Keep the live duck synchronized with the center timeline and export one reviewed reference cycle.
 * @param props - shared authoring state, installed geometry and plugin-owned media retention callback.
 * @returns a native canvas with visible capture progress and cancellation.
 */
export function ClipSimulation(props: ClipSimulationProps) {
  const state = props.useStore(value => value)
  const lab = props.useLab(value => value)
  const { t, actions } = props
  const profile = lab.catalog?.profiles[0]
  const scene = lab.scene
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [imageCapture, setImageCapture] = useState<{ capture: () => string } | null>(null)
  const [imageStatus, setImageStatus] = useState<'saved' | 'error' | null>(null)
  const onCaptureReady = useCallback((capture: (() => string) | null) => {
    setImageCapture(capture === null ? null : { capture })
  }, [])
  const capture = useRef<AbortController | null>(null)
  const captureSurface = useRef<HTMLDivElement | null>(null)
  const frame = useRef<number | null>(null)
  const audioElement = useRef<HTMLAudioElement | null>(null)
  const duration = state.clip?.duration
  const music = useMemo(() => duration === undefined ? null
    : resolveClipSoundtrack(state.audioId, state.musicChoice, state.bpm, duration),
  [state.audioId, state.musicChoice, state.bpm, duration])
  const onCanvas = useCallback((value: HTMLCanvasElement | null) => {
    setCanvas(value); actions.previewReady(value !== null)
  }, [actions])
  const latest = useRef(state)
  latest.current = state

  useEffect(() => () => { actions.playing(false) }, [actions])

  useEffect(() => {
    const audio = audioElement.current
    if (audio === null) return
    audio.volume = state.audioVolume; audio.muted = state.audioMuted
  }, [state.audioVolume, state.audioMuted, music])

  useEffect(() => {
    if (!state.playing && audioElement.current !== null && music !== null && state.clip !== null) {
      const time = state.time * music.rate
      audioElement.current.currentTime = music.repeat ? time % music.duration : time
    }
  }, [state.time, state.playing, state.clip, music])

  useEffect(() => {
    if (!state.playing || state.exporting || state.clip === null) return
    const started = performance.now()
    const initial = state.time
    const clip = state.clip
    const audio = audioElement.current
    const playback = music !== null && audio !== null ? startClipAudio(audio, {
      time: initial, duration: clip.duration, audioDuration: music.duration,
      rate: music.rate, repeat: music.repeat, speed: state.playbackSpeed,
      loop: clip.loop, volume: state.audioVolume, muted: state.audioMuted, onFailure: () => { actions.failure('audio') },
    }) : null
    let request = 0
    const advance = (now: number) => {
      const time = playback === null ? initial + (now - started) / 1000 * state.playbackSpeed : playback.time()
      const playing = clip.loop || time < clip.duration
      actions.tick(clip.loop ? time % clip.duration : Math.min(time, clip.duration), playing)
      if (playing) request = requestAnimationFrame(advance)
    }
    const onVisibility = () => { if (document.hidden) actions.playing(false) }
    document.addEventListener('visibilitychange', onVisibility)
    request = requestAnimationFrame(advance)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      cancelAnimationFrame(request); playback?.dispose()
    }
  }, [state.playing, state.exporting, state.clip, state.playbackSpeed, music, actions])

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) { capture.current?.abort(); actions.playing(false) }
    }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); actions.playing(false); actions.previewReady(false) }
  }, [actions])

  useEffect(() => {
    if (canvas === null) return
    const lost = () => { capture.current?.abort(); actions.previewReady(false); actions.failure('capture') }
    canvas.addEventListener('webglcontextlost', lost)
    return () => { canvas.removeEventListener('webglcontextlost', lost) }
  }, [canvas, actions])

  useEffect(() => {
    if (!state.exporting || state.clip === null || canvas === null) return
    const surface = captureSurface.current
    if (surface === null) { actions.failure('capture'); return }
    const controller = new AbortController()
    capture.current = controller
    const clip = state.clip
    const revision = state.revision
    const before = { width: surface.style.width, height: surface.style.height, flex: surface.style.flex }
    const bounds = surface.getBoundingClientRect()
    surface.style.width = `${bounds.width}px`; surface.style.height = `${bounds.height}px`; surface.style.flex = 'none'
    let finished = false
    let mounted = true
    const stopFrames = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    void recordClipMovie({ canvas, music, durationMs: clip.duration * 1000, frameRate: props.frameRate,
      videoBitsPerSecond: props.videoBitsPerSecond, finalizeTimeoutMs: props.finalizeTimeoutMs,
      signal: controller.signal, onStarted: (clock) => {
        const started = performance.now()
        const advance = (now: number) => {
          if (controller.signal.aborted) return
          const time = Math.min(clip.duration, clock === undefined ? (now - started) / 1000 : clock())
          actions.tick(time, false)
          if (time < clip.duration) frame.current = requestAnimationFrame(advance)
        }
        actions.tick(0, false); frame.current = requestAnimationFrame(advance)
      },
    }).then(({ blob, audio }) => {
      finished = true; stopFrames()
      if (!mounted) return
      if (controller.signal.aborted || latest.current.revision !== revision) { actions.failure('aborted'); return }
      const url = URL.createObjectURL(blob)
      const basename = clip.name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'microduck-clip'
      props.publishVideo({ url, filename: `${basename}.mp4`, bytes: blob.size, revision,
        ...(music?.credit === undefined ? {} : { musicCredit: music.credit }),
        ...(state.ducks.length === 0 ? {} : { duckCount: state.ducks.length + 1 }),
        ...(audio === undefined ? {} : { audio: { url: URL.createObjectURL(audio.blob), bytes: audio.blob.size } }),
        clipJson: JSON.stringify(clip, null, 2) + '\n' }, state.exportWithAudio)
    }, (error: unknown) => {
      finished = true; stopFrames()
      if (mounted) actions.failure(error instanceof ClipVideoError ? error.code : 'encode')
    })
    return () => {
      mounted = false; controller.abort(); stopFrames()
      Object.assign(surface.style, before)
      if (capture.current === controller) capture.current = null
      if (!finished && latest.current.exporting) actions.failure('aborted')
    }
  }, [state.exportRequest, state.exporting, state.clip, music, canvas, actions, props.frameRate,
    props.videoBitsPerSecond, props.finalizeTimeoutMs, props.publishVideo])

  const available = scene !== null && scene.kinematics !== undefined && profile !== undefined
    && (state.clip?.version !== 3 || state.clip.modelSha256 === profile.modelSha256)
    && state.ducks.every(duck => duck.dance === null || duck.dance.modelSha256 === profile.modelSha256)
  const pose = state.pose ?? (profile === undefined ? null : defaultClipPose(profile))
  const ensemble = useMemo(() => pose === null || state.ducks.length === 0 ? undefined : {
    primaryLabel: t('ducks.name', { number: 1 }),
    companions: state.ducks.map(duck => ({ number: duck.number, label: t('ducks.name', { number: duck.number }),
      skinId: state.duckSkins[duck.number] ?? 'original', pose: sampleClipDuck(duck, pose, state.time, state.bpm) })),
  }, [state.ducks, state.duckSkins, pose, state.time, state.bpm, t])
  const previousKey = state.clip?.keys.filter(key => key.t < state.time - 0.0001).at(-1)
  const nextKey = state.clip?.keys.find(key => key.t > state.time + 0.0001)
  return <section className={css.simulation} aria-label={t('workspace')}>
    {music !== null && <audio key={`${state.audioId}:${state.musicChoice}`} ref={audioElement} src={music.src} preload="auto" aria-label={t('audio.source')} />}
    <header className={css.simHeader}><div><small>{t('ready')}</small><h2>{state.clip?.name ?? t('workspace')}</h2></div>
      <div className={css.cameraButtons}>
        <button type="button" title={t('sim.captureHint')} disabled={imageCapture === null || !state.previewReady || state.exporting}
          onClick={() => {
            if (imageCapture === null) return
            try {
              const url = imageCapture.capture()
              if (!url.startsWith('data:image/png;')) throw new Error('PNG capture is unavailable')
              const basename = (state.clip?.name ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'microduck-clip'
              const anchor = document.createElement('a')
              anchor.href = url; anchor.download = `${basename}-cover-${state.time.toFixed(2)}s.png`; anchor.click()
              setImageStatus('saved')
            } catch { setImageStatus('error') }
          }}>{t('sim.capture')}</button>
        <button type="button" onClick={() => { actions.focus() }} disabled={state.exporting}>{t('focus')}</button>
      </div></header>
    {imageStatus !== null && <p role={imageStatus === 'error' ? 'alert' : 'status'} className={imageStatus === 'error' ? css.error : css.note}>
      {t(`sim.capture.${imageStatus}`)}</p>}
    <p className={css.safety}>{t('scope')}</p>
    {!available && <div className={css.notice}><p role="status">{t(lab.busy !== null ? 'loading' : 'unavailable')}</p>
      <button type="button" onClick={props.refresh} disabled={lab.busy !== null}>{t('refresh')}</button>
      {lab.error !== null && <p role="alert">{lab.error}</p>}</div>}
    <fieldset disabled={state.exporting} className={css.cameraTools} aria-label={t('sim.camera')}>
      <div className={css.cameraButtons}>{(['perspective', 'front', 'side', 'top'] as const).map(view =>
        <button type="button" key={view} aria-pressed={state.stage.cameraView === view}
          onClick={() => { actions.stage({ cameraView: view }); actions.focus() }}>{t(`sim.view.${view}`)}</button>)}</div>
      <div className={css.cameraButtons}>{(['orbit', 'pan', 'pose'] as const).map(mode =>
        <button type="button" key={mode} aria-pressed={state.stage.cameraMode === mode}
          onClick={() => { actions.stage({ cameraMode: mode }) }}>{t(`sim.mode.${mode}`)}</button>)}
      <label>{t('sim.zoom')}<input type="range" min={0.25} max={3} step={0.05} value={state.stage.cameraZoom}
        onChange={(event) => { actions.stage({ cameraZoom: Number(event.target.value) }) }} /></label></div>
    </fieldset>
    {state.clip === null && <div className={css.notice}><p>{t('sim.empty')}</p>
      <button type="button" disabled={!available || state.exporting} onClick={() => {
        if (profile !== undefined) actions.load(compileClip(profile, [{ action: 'stand', beats: 4 }], state.bpm, 0.5, t('sim.neutralName'), true))
      }}>{t('sim.create')}</button></div>}
    <div className={css.stage} ref={captureSurface}>
      {available && pose !== null && <ClipRenderBoundary label={t('error.capture')}
        onError={() => { actions.previewReady(false); actions.failure('capture') }}>
        <ClipPoseStage scene={scene} joints={pose.joints} rootPitch={pose.rootPitch} rootYaw={pose.rootYaw ?? 0}
          label={t('ready')} selectedJoint={state.exporting ? null : state.selectedJoint} maxDpr={props.maxDpr} onCanvas={onCanvas}
          onCaptureReady={onCaptureReady}
          cameraReset={state.cameraReset} cameraLocked={state.exporting} editing={state.clip !== null && state.clip.version !== 3}
          settings={state.stage} skinId={state.duckSkins[1]} {...(ensemble === undefined ? {} : { ensemble })}
          rootRoll={pose.rootRoll ?? 0} {...(pose.rootPosition === undefined ? {} : { rootPosition: pose.rootPosition })}
          onJointSelect={(index) => {
            if (state.exporting) return
            actions.select(index)
            if (state.mode === 'rig') actions.rig(pickedRig(profile.joints[index]?.name))
          }}
          onPoseDrag={(index, delta) => {
            if (state.exporting || state.pose === null) return
            if (state.mode === 'joints') {
              const value = index === -1 ? state.pose.rootPitch : (state.pose.joints[index] as number)
              actions.joint(profile, index, value + delta)
            } else {
              const rig = pickedRig(profile.joints[index]?.name)
              const current = measureClipRig(profile, state.pose, rig).value
              actions.rig(rig); actions.pose(applyClipRig(profile, state.pose, rig, current + delta))
            }
          }} /></ClipRenderBoundary>}
      {state.exporting && state.clip !== null && <div className={css.captureStatus}>
        <p role="status">{t('generating')}</p><progress max={state.clip.duration} value={state.time} />
        <button type="button" onClick={() => capture.current?.abort()}>{t('cancel')}</button>
      </div>}
    </div>
    <p className={css.cameraHint}>{t('sim.cameraHint')}</p>
    {state.clip !== null && <footer className={css.simFooter}>
      <div className={css.transport}><button type="button" disabled={state.exporting || previousKey === undefined}
        onClick={() => { if (previousKey !== undefined) actions.seek(previousKey.t) }}>{t('sim.previous')}</button>
      <button type="button" disabled={state.exporting || nextKey === undefined}
        onClick={() => { if (nextKey !== undefined) actions.seek(nextKey.t) }}>{t('sim.next')}</button>
      <label className={css.check}><input type="checkbox" checked={state.clip.loop} disabled={state.exporting}
        onChange={(event) => { actions.meta({ loop: event.target.checked }) }} />{t('loop')}</label>
      </div>
      <div className={css.transport}><button type="button" disabled={state.exporting} onClick={() => { actions.seek(0) }} aria-label={t('first')}>⏮</button>
        <button type="button" disabled={state.exporting || state.unkeyed} onClick={() => { actions.playing(!state.playing) }}>{t(state.playing ? 'pause' : 'play')}</button>
        <label>{t('sim.speed')}<select value={state.playbackSpeed} disabled={state.exporting}
          onChange={(event) => { actions.playbackSpeed(Number(event.target.value)) }}>
          {[0.25, 0.5, 1, 1.5, 2].map(speed => <option key={speed} value={speed}>{t('sim.speedValue', { speed })}</option>)}
        </select></label>
        <output>{t('time', { time: state.time.toFixed(2), duration: state.clip.duration.toFixed(2) })}</output></div>
      <input type="range" min={0} max={state.clip.duration} step={0.01} value={state.time} disabled={state.exporting}
        aria-label={t('timeline')} onChange={(event) => { actions.seek(Number(event.target.value)) }} />
      {state.unkeyed && <p role="status" className={css.note}>{t('unkeyed')}</p>}
    </footer>}
    {state.error !== null && <p role="alert" className={css.error}>{t(`error.${state.error}`)}</p>}
    <ClipWorkspaceControls state={state} profile={profile} scene={scene} limits={lab.catalog?.limits}
      maxDucks={props.maxDucks} maxFileBytes={props.maxFileBytes} actions={actions} t={t} saveText={props.saveText} />
  </section>
}
