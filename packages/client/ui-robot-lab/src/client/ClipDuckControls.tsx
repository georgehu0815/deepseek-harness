/** Companion selection stays in the shared authoring draft; only Duck 1 has a raw-pose editor. */
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipSimulationProps } from './clip-gen-props.ts'
import type { ClipGenDraft } from './clip-gen-store.ts'
import { dancePresets, resolveDancePreset } from './dance-presets.ts'
import css from './ClipGen.module.css'

/**
 * Add, remove and configure independently posed companions on the existing canvas.
 * @param props - shared draft, installed validation metadata, deployment limits and localized actions.
 * @returns exclusive per-duck dance selectors; recording locks the whole group.
 */
export function ClipDuckControls({ state, profile, scene, limits, maxDucks, maxFileBytes, actions, t }: {
  state: ClipGenDraft
  profile: RobotProfile | undefined
  scene: RobotScene | null
  limits: RobotStudioCatalog['limits'] | undefined
} & Pick<ClipSimulationProps, 'maxDucks' | 'maxFileBytes' | 'actions' | 't'>) {
  if (state.clip === null) return null
  const ready = profile !== undefined && limits !== undefined && scene?.kinematics !== undefined
  return <section className={css.controlSection} aria-label={t('ducks.title')}>
    <h3>{t('ducks.title')}</h3>
    <p className={css.note}>{t('ducks.hint')}</p>
    <fieldset disabled={state.exporting} className={css.editor}>
      <div className={css.transport}><button type="button" disabled={!ready || state.ducks.length + 1 >= maxDucks}
        onClick={() => { actions.addDuck() }}>{t('ducks.add')}</button>
      <output>{t('ducks.count', { count: state.ducks.length + 1, max: maxDucks })}</output></div>
      <p>{t('ducks.primary', { name: state.clip.name })}</p>
      {state.ducks.map(duck => <div key={duck.number} className={css.duckRow}>
        <label>{t('ducks.dance', { number: duck.number })}<select value={duck.dance?.id ?? 'follow'}
          onChange={(event) => {
            if (event.target.value === 'follow') { actions.duckDance(duck.number, null); return }
            if (!ready) return
            const preset = dancePresets.find(dance => dance.id === event.target.value)
            if (preset === undefined) return
            const selection = resolveDancePreset(preset, profile, scene, limits, maxFileBytes)
            if ('error' in selection) { actions.failure(selection.error); return }
            actions.duckDance(duck.number, selection.dance)
          }}>
          <option value="follow">{t('ducks.follow')}</option>
          {dancePresets.map(dance => <option key={dance.id} value={dance.id} disabled={!ready}>
            {t(dance.revision === 2 ? 'danceClip.optionV2' : 'danceClip.option', {
              name: t(`danceClip.${dance.style}`), duration: Number(dance.clip.duration.toFixed(2)), bpm: dance.bpm,
            })}</option>)}
        </select></label>
        <button type="button" onClick={() => { actions.removeDuck(duck.number) }}
          aria-label={t('ducks.remove', { number: duck.number })}>{t('ducks.remove', { number: duck.number })}</button>
      </div>)}
    </fieldset>
    <p className={css.note}>{t('ducks.captureHint')}</p>
  </section>
}
