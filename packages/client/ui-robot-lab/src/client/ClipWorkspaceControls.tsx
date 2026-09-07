/** Session-local visual controls and draft editing beside the authored preview. */
import type { ClipSimulationProps } from './clip-gen-props.ts'
import type { ClipGenDraft } from './clip-gen-store.ts'
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import { ClipPoseControls } from './ClipPoseControls.tsx'
import { ClipAudioExport } from './ClipAudioExport.tsx'
import { ClipMusicCredit } from './ClipMusicCredit.tsx'
import { ClipDuckControls } from './ClipDuckControls.tsx'
import { clipVideoDownload } from './clip-video-output.ts'
import css from './ClipGen.module.css'

/**
 * Control the rendered environment without changing physics or saved motion.
 * @param props - session viewing state, model metadata and declared authoring actions.
 * @returns scrollable environment, robot and export controls with recording locks.
 */
export function ClipWorkspaceControls({ state, profile, scene, limits, maxDucks, maxFileBytes, actions, t, saveText }: {
  state: ClipGenDraft
  profile: RobotProfile | undefined
  scene: RobotScene | null
  limits: RobotStudioCatalog['limits'] | undefined
} & Pick<ClipSimulationProps, 'actions' | 't' | 'saveText' | 'maxDucks' | 'maxFileBytes'>) {
  const { stage, clip } = state
  const download = state.video === null ? null : clipVideoDownload(state.video, state.exportWithAudio)
  const poseLocked = state.exporting || clip?.version === 3
  return <div className={css.simulationControls}>
    <ClipDuckControls state={state} profile={profile} scene={scene} limits={limits}
      maxDucks={maxDucks} maxFileBytes={maxFileBytes} actions={actions} t={t} />
    <details open className={css.controlSection}>
      <summary>{t('sim.environment')}</summary>
      <fieldset disabled={state.exporting} className={css.editor}>
        <p className={css.note}>{t('sim.environmentHint')}</p>
        <label>{t('sim.surface')}<select value={stage.surface} onChange={(event) => {
          const surface = event.target.value
          if (surface === 'studio' || surface === 'concrete' || surface === 'sand' || surface === 'grass') actions.stage({ surface })
        }}>{(['studio', 'concrete', 'sand', 'grass'] as const).map(surface =>
            <option key={surface} value={surface}>{t(`sim.surface.${surface}`)}</option>)}</select></label>
        <div className={css.toggleGrid}>{(['ground', 'grid', 'axes', 'wireframe'] as const).map(key =>
          <label className={css.check} key={key}><input type="checkbox" checked={stage[key]}
            onChange={(event) => { actions.stage({ [key]: event.target.checked }) }} />{t(`sim.${key}`)}</label>)}</div>
        <div className={css.environmentFields}>
          <label>{t('sim.background')}<input type="color" value={stage.background}
            onChange={(event) => { actions.stage({ background: event.target.value }) }} /></label>
          <label>{t('sim.light')}<output>{t('sim.speedValue', { speed: stage.lightIntensity.toFixed(2) })}</output>
            <input type="range" aria-label={t('sim.light')} min={0} max={3} step={0.05} value={stage.lightIntensity}
              onChange={(event) => { actions.stage({ lightIntensity: Number(event.target.value) }) }} /></label>
        </div>
        <button type="button" onClick={() => { actions.resetStage() }}>{t('sim.resetEnvironment')}</button>
      </fieldset>
    </details>
    <details className={css.controlSection}>
      <summary>{t('sim.robot')}</summary>
      <p className={css.note}>{t('sim.poseHint')}</p>
      {profile !== undefined && clip !== null && state.pose !== null ? <>
        <div className={css.transport}>
          <button type="button" disabled={poseLocked || limits === undefined} onClick={() => {
            if (limits !== undefined) actions.key(limits.maxClipKeys)
          }}>{t('key')}</button>
          <button type="button" disabled={state.exporting || !state.unkeyed}
            onClick={() => { actions.seek(state.time) }}>{t('sim.discardPose')}</button>
          <button type="button" disabled={poseLocked || state.time === 0 || clip.keys.length <= 2
            || !clip.keys.some(key => Math.abs(key.t - state.time) < 0.0001)}
          onClick={() => { actions.removeKey() }}>{t('deleteKey')}</button>
        </div>
        <ClipPoseControls state={state} profile={profile} scene={scene} actions={actions} t={t} />
      </> : <p className={css.note}>{t('sim.empty')}</p>}
    </details>
    {clip !== null && <details className={css.controlSection}>
      <summary>{t('sim.export')}</summary>
      <p className={css.note}>{t('sim.captureSpeed')}</p>
      <label className={css.check}><input type="checkbox" checked={state.verifiedRevision === state.revision}
        disabled={state.exporting || state.unkeyed} onChange={(event) => { actions.verify(event.target.checked) }} />{t('verified')}</label>
      <div className={css.transport}>
        <button type="button" disabled={state.exporting || state.unkeyed || !state.previewReady || state.verifiedRevision !== state.revision}
          onClick={() => { actions.generate() }}>{t('generate')}</button>
        <ClipAudioExport checked={state.exportWithAudio} available={state.audioId !== null || state.musicChoice !== 'original'} disabled={state.exporting}
          onChange={actions.exportAudio} label={t('export.withAudio')} emptyHint={t('export.noAudio')} />
        <button type="button" disabled={state.exporting || state.unkeyed}
          onClick={() => { saveText(JSON.stringify(clip, null, 2) + '\n', 'microduck-clip.json') }}>{t('save')}</button>
      </div>
      {state.video !== null && download !== null && <>
        {state.video.duckCount !== undefined && <p>{t('ducks.output', { count: state.video.duckCount })}</p>}
        <ClipMusicCredit credit={state.exportWithAudio ? state.video.musicCredit : undefined}
          filename={state.video.filename} t={t} saveText={saveText} />
        {state.video.revision !== state.revision && <p role="status" className={css.note}>{t('stale')}</p>}
        <div className={css.transport}><a href={download.url} download={download.filename}>{t('download')}</a>
          <button type="button" onClick={() => {
            if (state.video !== null) saveText(state.video.clipJson, state.video.filename.replace(/\.mp4$/i, '.json'))
          }}>{t(state.video.duckCount === undefined ? 'outputJson' : 'ducks.outputJson')}</button></div>
      </>}
    </details>}
  </div>
}
