/** Browse lightweight model-derived color sketches before changing the shared canvas wardrobe. */
import { useMemo, useState } from 'react'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipGenProps } from './clip-gen-props.ts'
import type { ClipGenDraft } from './clip-gen-store.ts'
import { buildClipPartArtwork, type ClipPartArtwork } from './clip-part-artwork.ts'
import { clipSkins, clipSkinRegion, type ClipSkin, type ClipSkinId } from './clip-skins.ts'
import css from './ClipSkinPanel.module.css'

function SkinSketch({ artwork, scene, skin }: { artwork: ClipPartArtwork | null; scene: RobotScene | null; skin: ClipSkin }) {
  return <svg className={css.sketch} viewBox={artwork?.viewBox ?? '0 0 64 64'} aria-hidden="true" focusable="false">
    {artwork === null ? <>
      <rect x="8" y="12" width="22" height="40" rx="8" fill={skin.palette.torso} />
      <rect x="34" y="12" width="22" height="18" rx="6" fill={skin.palette.head} />
      <rect x="34" y="34" width="22" height="18" rx="6" fill={skin.palette.accent} />
    </> : artwork.bodies.map(body => <path key={body.body} d={body.path}
      fill={skin.palette[clipSkinRegion(body.joint === null ? undefined : scene?.jointNames[body.joint])]}
      stroke={skin.palette.joint} strokeWidth="0.3" strokeLinejoin="round" />)}
  </svg>
}

/**
 * Select a skin independently from motion and explicitly apply it to one duck or the whole ensemble.
 * @param props - session-owned appearance targets, installed scene and localized store actions.
 * @returns ten design cards, an original-finish choice and part-level palette details; capture locks all mutations.
 */
export function ClipSkinPanel({ state, scene, actions, t }: {
  state: ClipGenDraft
  scene: RobotScene | null
} & Pick<ClipGenProps, 'actions' | 't'>) {
  const [candidate, setCandidate] = useState<ClipSkinId | null>(null)
  const artwork = useMemo(() => scene === null ? null : buildClipPartArtwork(scene), [scene])
  const current = state.duckSkins[state.skinDuckNumber] ?? 'original'
  const selected = candidate ?? current
  const skin = clipSkins.find(item => item.id === selected)
  const duck = t('ducks.name', { number: state.skinDuckNumber })
  const numbers = [1, ...state.ducks.map(item => item.number)]
  return <section className={css.wardrobe} aria-label={t('skin.title')}>
    <header className={css.header}><div><small>{t('skin.subtitle')}</small><h3>{t('skin.title')}</h3></div></header>
    <p className={css.hint}>{t('skin.hint')}</p>
    <fieldset disabled={state.exporting || state.clip === null} className={css.editor}>
      <div className={css.toolbar}>
        <label>{t('skin.target')}<select value={state.skinDuckNumber} onChange={(event) => {
          actions.selectSkinDuck(Number(event.target.value)); setCandidate(null)
        }}>{numbers.map(number => <option key={number} value={number}>{t('ducks.name', { number })}</option>)}</select></label>
        <button type="button" aria-pressed={selected === 'original'} onClick={() => { setCandidate('original') }}>{t('skin.original')}</button>
      </div>
      <p className={css.current} role="status">{t('skin.current', { duck, skin: t(`skin.${current}`) })}</p>
      <div className={css.grid} role="group" aria-label={t('skin.browse')}>
        {clipSkins.map((design, index) => <button type="button" key={design.id} className={css.card}
          aria-label={t(`skin.${design.id}`)} aria-pressed={selected === design.id}
          onClick={() => { setCandidate(design.id) }}>
          <span className={css.cardTop}><span>{String(index + 1).padStart(2, '0')}</span>
            {current === design.id && <span title={t('skin.applied')} aria-label={t('skin.applied')}>✓</span>}</span>
          <SkinSketch artwork={artwork} scene={scene} skin={design} />
          <strong>{t(`skin.${design.id}`)}</strong><small>{t(`skin.${design.id}.style`)}</small>
          <span className={css.swatches} aria-hidden="true">
            {(['head', 'torso', 'foot', 'accent'] as const).map(part => <i key={part} style={{ background: design.palette[part] }} />)}
          </span>
        </button>)}
      </div>
      <p className={css.hint}>{t(artwork === null ? 'skin.noModel' : 'skin.schematic')}</p>
      <section className={css.detail} aria-label={t('skin.preview')}>
        {skin !== undefined && <SkinSketch artwork={artwork} scene={scene} skin={skin} />}
        <div className={css.detailText}><h4>{t(`skin.${selected}`)}</h4><p>{t(`skin.${selected}.description`)}</p>
          {skin !== undefined && <dl className={css.palette} aria-label={t('skin.palette')}>
            {(Object.keys(skin.palette) as Array<keyof ClipSkin['palette']>).map(part => <div key={part}>
              <dt>{t(`skin.part.${part}`)}</dt><dd><i style={{ background: skin.palette[part] }} aria-hidden="true" />{skin.palette[part]}</dd>
            </div>)}
          </dl>}
        </div>
      </section>
      <div className={css.apply}>
        <button type="button" disabled={current === selected} onClick={() => { actions.applySkin(selected, 'current') }}>
          {t('skin.apply', { duck })}</button>
        <button type="button" disabled={numbers.every(number => state.duckSkins[number] === selected)}
          onClick={() => { actions.applySkin(selected, 'all') }}>{t('skin.applyAll', { count: numbers.length })}</button>
      </div>
    </fieldset>
    <p className={css.hint}>{t('skin.scope')}</p>
  </section>
}
