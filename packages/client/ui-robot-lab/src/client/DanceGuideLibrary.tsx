/** Browser-local instructions and keyed sequences shared across authoring sessions. */
import { useState } from 'react'
import type { DanceGuideProps } from './clip-gen-props.ts'
import css from './ClipGen.module.css'
import type { ClipSequence } from './clip-sequence.ts'

const starterIds = ['bounce', 'hello', 'sway'] as const

/**
 * Present built-in examples and explicitly saved browser-local guides.
 * @param props - root-scoped guide state and the current activity plan's selection callback.
 * @returns guide selection, a named-guide editor and truthful persistence status.
 */
export function DanceGuideLibrary(props: DanceGuideProps) {
  const state = props.useStore(value => value)
  const { t, actions, disabled } = props
  const [selectedId, setSelectedId] = useState('')
  const starters = starterIds.map(id => ({ id: `starter-${id}`, name: t(`guide.${id}.name`), prompt: t(`guide.${id}.prompt`), sequence: undefined as ClipSequence | undefined }))
  const saved = state.guides.map(guide => ({ ...guide, id: `saved-${guide.id}` }))
  const guides = [...starters, ...saved]
  const selected = guides.find(guide => guide.id === selectedId)
  const notice = state.persistence
  return <section className={css.guideLibrary} aria-label={t('guide.title')}>
    <h3>{t('guide.title')}</h3>
    <p className={css.note}>{t('guide.hint')}</p>
    <div className={css.guideToolbar}>
      <label>{t('guide.choose')}<select disabled={disabled} value={selected?.prompt === props.prompt ? selected.id : ''}
        onChange={(event) => {
          if (disabled) return
          const guide = guides.find(guide => guide.id === event.target.value)
          if (guide === undefined) return
          setSelectedId(guide.id)
          if (guide.sequence === undefined) props.onUse(guide.prompt)
          else props.onUse(guide.prompt, guide.sequence)
        }}>
        <option value="" disabled>{t('guide.placeholder')}</option>
        <optgroup label={t('guide.starters')}>{starters.map(guide => <option key={guide.id} value={guide.id}>{guide.name}</option>)}</optgroup>
        {saved.length > 0 && <optgroup label={t('guide.savedGroup')}>{saved.map(guide => <option key={guide.id} value={guide.id}>{guide.sequence === undefined ? guide.name : t('guide.sequenceName', { name: guide.name })}</option>)}</optgroup>}
      </select></label>
      <button type="button" disabled={disabled || state.adding} onClick={() => { actions.startAdd(props.prompt) }}>{t('guide.add')}</button>
      <button type="button" className={css.primary} disabled={disabled || props.aiDisabled || props.aiPending}
        onClick={() => { props.onSequenceByAI(actions.saveSequence) }}>{t('sequenceByAI')}</button>
    </div>
    {state.adding && <form onSubmit={(event) => { event.preventDefault(); if (!disabled) actions.save() }}>
      <fieldset className={css.guideEditor} disabled={disabled}>
        <legend>{t('guide.editor')}</legend>
        <label>{t('guide.name')}<input maxLength={80} value={state.name} aria-required="true"
          onChange={(event) => { actions.name(event.target.value) }} /></label>
        <label>{t('guide.description')}<textarea rows={4} maxLength={2000} value={state.prompt} aria-required="true"
          onChange={(event) => { actions.prompt(event.target.value) }} /></label>
        {state.error !== null && <p role="alert" className={css.error}>{t(`guide.error.${state.error}`)}</p>}
        <div className={css.transport}>
          <button type="submit" className={css.primary}>{t('guide.save')}</button>
          <button type="button" onClick={() => { actions.cancelAdd() }}>{t('guide.cancel')}</button>
        </div>
      </fieldset>
    </form>}
    <p role="status" className={notice.state === 'blocked' ? css.error : css.note}>
      {notice.state === 'blocked'
        ? t('guide.storageBlocked', { reason: t(`guide.reason.${notice.reason}`) })
        : t(`guide.storage.${notice.state}`)}
    </p>
  </section>
}
