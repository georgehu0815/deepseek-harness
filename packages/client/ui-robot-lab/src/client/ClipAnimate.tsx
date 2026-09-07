/** Keyframe transport, metadata and timeline with shared pose authoring controls. */
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipGenProps } from './clip-gen-props.ts'
import type { ClipGenDraft } from './clip-gen-store.ts'
import { ClipPoseControls } from './ClipPoseControls.tsx'
import { ClipSkinPanel } from './ClipSkinPanel.tsx'
import css from './ClipGen.module.css'

/**
 * Edit a pose independently of its keyframes; explicit keying commits it to playback and export.
 * @param props - localized controls, installed profile, state and declared mutation callbacks.
 * @returns the animation panel with timeline and fourteen raw servo controls.
 */
export function ClipAnimate({ state, profile, scene, limits, actions, t, openWorkspace }: {
  state: ClipGenDraft
  profile: RobotProfile
  scene: RobotScene | null
  limits: RobotStudioCatalog['limits']
} & Pick<ClipGenProps, 'actions' | 't' | 'openWorkspace'>) {
  const { clip, pose } = state
  if (clip === null || pose === null) return null
  return <>
    <div className={css.controls}>
      <button type="button" onClick={() => { openWorkspace(); actions.focus() }}>{t('focus')}</button>
      <label>{t('name')}<input value={clip.name} maxLength={160} disabled={state.exporting}
        onChange={(event) => { actions.meta({ name: event.target.value }) }} /></label>
      <label>{t('duration')}<input type="number" min={0.1} max={limits.maxClipSeconds} step={0.1} value={clip.duration}
        disabled={state.exporting} onChange={(event) => {
          const value = event.target.valueAsNumber
          if (Number.isFinite(value) && value >= 0.1 && value <= limits.maxClipSeconds) actions.meta({ duration: value })
        }} /></label>
      <label className={css.check}><input type="checkbox" checked={clip.loop} disabled={state.exporting}
        onChange={(event) => { actions.meta({ loop: event.target.checked }) }} />{t('loop')}</label>
    </div>
    <div className={css.transport}>
      <button type="button" disabled={state.exporting} aria-label={t('first')} onClick={() => { actions.seek(0) }}>⏮</button>
      <button type="button" disabled={state.exporting || state.unkeyed} onClick={() => {
        openWorkspace(); actions.playing(!state.playing)
      }}>{t(state.playing ? 'pause' : 'play')}</button>
      <button type="button" disabled={state.exporting || clip.version === 3} onClick={() => { actions.key(limits.maxClipKeys) }}>{t('key')}</button>
      <button type="button" disabled={state.exporting || clip.version === 3 || state.time === 0 || clip.keys.length <= 2
        || !clip.keys.some(key => Math.abs(key.t - state.time) < 0.0001)} onClick={() => { actions.removeKey() }}>{t('deleteKey')}</button>
      <output>{t('time', { time: state.time.toFixed(2), duration: clip.duration.toFixed(2) })}</output>
    </div>
    <div className={css.timeline}>
      <input aria-label={t('timeline')} type="range" min={0} max={clip.duration} step={0.01} value={state.time}
        disabled={state.exporting} onChange={(event) => { actions.seek(Number(event.target.value)) }} />
      <div className={css.keyTrack}>
        {clip.keys.map((key, index) => <button type="button" key={index} className={css.keyMarker}
          style={{ left: `${key.t / clip.duration * 100}%` }} disabled={state.exporting}
          aria-label={t('keyAt', { time: key.t.toFixed(2) })} title={t('keyAt', { time: key.t.toFixed(2) })}
          onClick={() => { actions.seek(key.t) }}>◆</button>)}
      </div>
      {state.steps.length > 0 && <div className={css.phrases}>
        {state.steps.map((step, index) => {
          const total = state.steps.reduce((sum, step) => sum + step.beats, 0)
          const start = state.steps.slice(0, index).reduce((sum, step) => sum + step.beats, 0) / total * clip.duration
          return <button type="button" key={index} style={{ flex: step.beats }} disabled={state.exporting}
            aria-current={state.time >= start && state.time < start + step.beats / total * clip.duration ? 'step' : undefined}
            onClick={() => { actions.seek(start) }}>{t(`action.${step.action}`)}</button>
        })}
      </div>}
    </div>
    <p className={css.note} role="status">{t(state.unkeyed ? 'unkeyed' : 'keyed')}</p>
    <ClipSkinPanel state={state} scene={scene} actions={actions} t={t} />
    <ClipPoseControls state={state} profile={profile} scene={scene} actions={actions} t={t} />
    <p className={css.note}>{t(clip.version !== 1 ? 'previewInterpolation' : 'interpolation')}</p>
  </>
}
