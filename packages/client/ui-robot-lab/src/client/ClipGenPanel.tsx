/** Central Clip Gen workflow: supported activity recipes, servo mapping, animation and video review. */
import { useEffect, useMemo, useRef } from 'react'
import type { ClipGenProps } from './clip-gen-props.ts'
import { ClipAnimate } from './ClipAnimate.tsx'
import { ClipAudioExport } from './ClipAudioExport.tsx'
import { ClipMusicPicker } from './ClipMusicPicker.tsx'
import { ClipMusicCredit } from './ClipMusicCredit.tsx'
import { clipVideoDownload } from './clip-video-output.ts'
import { clipActions, compileClip, defaultClipPose, planClip } from './clip-motion.ts'
import { compileTurningPreview, validatePreviewClip } from './clip-preview.ts'
import { compileWalkingPreview, validateWalkingClip } from './clip-walking.ts'
import type { ClipStep } from './clip-motion.ts'
import { validateClipSequence, type ClipSequence } from './clip-sequence.ts'
import { dancePresets, resolveDancePreset } from './dance-presets.ts'
import css from './ClipGen.module.css'

/**
 * Offer authored reference generation without admitting training or invoking hardware.
 * @param props - framework-bound session draft, model snapshot and browser actions.
 * @returns four ordered authoring and review sections.
 */
export function ClipGenPanel(props: ClipGenProps) {
  const state = props.useStore(value => value)
  const lab = props.useLab(value => value)
  const { t, actions } = props
  const { clip, video } = state
  const download = video === null ? null : clipVideoDownload(video, state.exportWithAudio)
  const profile = lab.catalog?.profiles[0]
  const limits = lab.catalog?.limits
  const ready = profile !== undefined && profile.joints.length === 14 && limits !== undefined
  const input = useRef<HTMLInputElement>(null)
  const movieElement = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = movieElement.current
    return () => { if (element !== null && !element.paused) element.pause() }
  }, [download?.url, state.musicChoice])
  const importOwner = useRef({ active: true, revision: state.revision })
  useEffect(() => { importOwner.current.revision = state.revision }, [state.revision])
  useEffect(() => { importOwner.current.active = true; return () => { importOwner.current.active = false } }, [])
  useEffect(() => () => { props.cancelSequence() }, [props.cancelSequence])
  const mapping = useMemo(() => {
    if (profile === undefined || clip === null) return []
    return profile.joints.map((joint, channel) => state.steps.flatMap((step, index) => {
      const total = state.steps.reduce((sum, step) => sum + step.beats, 0)
      const start = state.steps.slice(0, index).reduce((sum, step) => sum + step.beats, 0) / total * clip.duration
      const end = start + step.beats / total * clip.duration
      return clip.keys.some(key => key.t >= start && key.t <= end
        && Math.abs((key.joints[channel] as number) - joint.defaultPosition) > 0.00001) ? [step.action] : []
    }))
  }, [profile, clip, state.steps])
  const replaceSequence = (steps: ClipStep[], bpm = state.bpm, moveSize = state.moveSize) => {
    if (!ready || steps.length === 0) return
    const duration = steps.reduce((sum, step) => sum + step.beats, 0) * 60 / bpm
    if (steps.length * 2 + 1 > limits.maxClipKeys || duration > limits.maxClipSeconds || bpm < limits.minBpm || bpm > limits.maxBpm) {
      actions.failure('limits'); return
    }
    const clip = compileClip(profile, steps, bpm, moveSize, state.clip?.name || `dance-${bpm}bpm`, state.clip?.loop ?? true)
    actions.parameters(bpm, moveSize, steps, clip)
    props.openWorkspace()
  }
  const saveClip = () => {
    if (state.clip !== null && !state.unkeyed) props.saveText(JSON.stringify(state.clip, null, 2) + '\n', 'microduck-clip.json')
  }
  return <section className={css.panel} aria-label={t('title')} data-conversation-composer-overlay="">
    <header className={css.hero}><div><small>{t('eyebrow')}</small><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <button type="button" onClick={props.openWorkspace}>{t('openWorkspace')}</button></header>
    <p className={css.safety}>{t('scope')}</p>
    {!ready && <div className={css.notice}><p role="status">{t(lab.busy !== null ? 'loading' : 'disabled')}</p>
      <button type="button" disabled={lab.busy !== null} onClick={props.refresh}>{t('refresh')}</button>
      {lab.error !== null && <p role="alert">{lab.error}</p>}</div>}
    {state.error !== null && <p role="alert" className={css.error}>{t(`error.${state.error}`)}</p>}
    <section className={css.section} aria-label={t('planTitle')}><h2>{t('planTitle')}</h2><p className={css.note}>{t('planHint')}</p>
      <label>{t('prompt')}<textarea rows={3} maxLength={2000} placeholder={t('promptPlaceholder')} value={state.prompt}
        disabled={state.exporting} onChange={(event) => { actions.prompt(event.target.value) }} /></label>
      {props.renderSlot('conversation.clip-gen.guides', {
        prompt: state.prompt, disabled: state.exporting, aiDisabled: !ready || !state.prompt.trim(), aiPending: state.ai.status === 'pending',
        onSequenceByAI: (save) => {
          const tempo = /\b(\d{2,3})\s*bpm\b/i.exec(state.prompt)
          props.generateSequence({ prompt: state.prompt, bpm: tempo === null ? state.bpm : Number(tempo[1]),
            editEpoch: state.editEpoch }, save)
        },
        onUse: (prompt, sequence) => {
          if (sequence === undefined) { actions.prompt(prompt); return }
          if (!ready) { actions.failure('aiUnavailable'); return }
          let compatible: ClipSequence
          try { compatible = validateClipSequence(sequence, profile, limits) }
          catch { actions.failure('aiProfile'); return }
          actions.loadSequence(prompt, compatible)
          props.openWorkspace()
        },
      })}
      <p className={css.note}>{t('aiHint')}</p>
      {state.ai.status === 'pending' && <div className={css.transport}>
        <p role="status">{t('aiPending')}</p><button type="button" onClick={props.cancelSequence}>{t('aiCancel')}</button>
      </div>}
      {state.ai.status === 'ready' && <div>
        <p role="status">{t(state.ai.applied ? 'aiLoaded' : 'aiChanged')}</p>
        <details><summary>{t('aiGuide')}</summary><p className={css.guideText}>{state.ai.guide}</p></details>
        <button type="button" onClick={() => {
          if (state.ai.status !== 'ready') return
          props.saveText(JSON.stringify(state.ai.sequence.clip, null, 2) + '\n', `microduck-motion-${state.ai.sequence.bpm}bpm.json`)
        }}>{t('aiDownload')}</button>
        {!state.ai.applied && <button type="button" disabled={state.exporting || !ready} onClick={() => {
          if (!ready || state.ai.status !== 'ready') return
          try { validateClipSequence(state.ai.sequence, profile, limits) }
          catch { actions.failure('aiProfile'); return }
          actions.aiApply()
          props.openWorkspace()
        }}>{t('aiApply')}</button>}
      </div>}
      <div className={css.transport}>
        <button type="button" className={css.primary} disabled={!ready || state.exporting || !state.prompt.trim()} onClick={() => {
          const steps = planClip(state.prompt)
          if (steps === null) { actions.failure('unsupported'); return }
          const tempo = /\b(\d{2,3})\s*bpm\b/i.exec(state.prompt)
          replaceSequence(steps, tempo === null ? state.bpm : Number(tempo[1]))
        }}>{t('design')}</button>
        <button type="button" disabled={!ready || state.exporting} onClick={() => { replaceSequence([...state.steps, { action: 'left-step', beats: 2 }]) }}>{t('add')}</button>
      </div>
      {state.steps.length === 0 && <p className={css.note}>{t(state.clip === null ? 'emptyPlan' : 'imported')}</p>}
      <ol className={css.plan}>{state.steps.map((step, index) => <li key={index}>
        <span className={css.number}>{String(index + 1).padStart(2, '0')}</span>
        <select aria-label={t('action', { number: index + 1 })} value={step.action} disabled={state.exporting}
          onChange={(event) => {
            const action = clipActions.find(action => action === event.target.value)
            if (action === undefined) return
            replaceSequence(state.steps.map((step, at) => at === index ? { ...step, action } : step))
          }}>{clipActions.map(action => <option key={action} value={action}>{t(`action.${action}`)}</option>)}</select>
        <input type="number" min={1} max={32} step={1} aria-label={t('beats', { number: index + 1 })} value={step.beats}
          disabled={state.exporting} onChange={(event) => {
            const beats = event.target.valueAsNumber
            if (Number.isSafeInteger(beats) && beats >= 1 && beats <= 32) {
              replaceSequence(state.steps.map((step, at) => at === index ? { ...step, beats } : step))
            }
          }} />
        <button type="button" aria-label={t('up', { number: index + 1 })} disabled={state.exporting || index === 0} onClick={() => {
          const steps = [...state.steps]
          steps[index - 1] = step; steps[index] = state.steps[index - 1] as ClipStep; replaceSequence(steps)
        }}>↑</button>
        <button type="button" aria-label={t('down', { number: index + 1 })} disabled={state.exporting || index === state.steps.length - 1} onClick={() => {
          const steps = [...state.steps]
          steps[index + 1] = step; steps[index] = state.steps[index + 1] as ClipStep; replaceSequence(steps)
        }}>↓</button>
        <button type="button" aria-label={t('remove', { number: index + 1 })} disabled={state.exporting || state.steps.length === 1}
          onClick={() => { replaceSequence(state.steps.filter((_, at) => index !== at)) }}>×</button>
      </li>)}</ol>
      {ready && state.steps.length > 0 && <div className={css.controls}>
        <label>{t('bpm')}<input type="number" min={limits.minBpm} max={limits.maxBpm} value={state.bpm} disabled={state.exporting}
          onChange={(event) => {
            const bpm = event.target.valueAsNumber
            if (Number.isFinite(bpm) && bpm >= limits.minBpm && bpm <= limits.maxBpm) replaceSequence(state.steps, bpm)
          }} /></label>
        <label>{t('moveSize')}<input type="range" min={0} max={1} step={0.01} value={state.moveSize} disabled={state.exporting}
          onChange={(event) => { replaceSequence(state.steps, state.bpm, Number(event.target.value)) }} /></label>
      </div>}
    </section>
    <section className={css.section} aria-label={t('mappingTitle')}><h2>{t('mappingTitle')}</h2><p className={css.note}>{t('mappingHint')}</p>
      {ready && <div className={css.tableWrap}><table><thead><tr><th>{t('channel')}</th><th>{t('joint')}</th><th>{t('mapped')}</th><th>{t('current')}</th></tr></thead>
        <tbody>{profile.joints.map((joint, index) => <tr key={joint.name} data-selected={state.selectedJoint === index}>
          <td>{String(index + 1).padStart(2, '0')}</td><td><button type="button" onClick={() => { actions.select(index); actions.mode('joints') }}>{joint.name}</button></td>
          <td>{mapping[index]?.length ? [...new Set(mapping[index])].map(action => t(`action.${action}`)).join(' · ')
            : state.steps.length === 0 && state.clip !== null ? t('keyframed') : t('held')}</td>
          <td><output>{(state.pose?.joints[index] ?? joint.defaultPosition).toFixed(3)}</output></td>
        </tr>)}</tbody></table></div>}
    </section>
    <section className={css.section} aria-label={t('animateTitle')}><h2>{t('animateTitle')}</h2><p className={css.note}>{t('animateHint')}</p>
      <div className={css.controls}>
        <label>{t('danceClip.choose')}<select value="" disabled={!ready || state.exporting} onChange={(event) => {
          if (!ready || state.exporting) return
          const dance = dancePresets.find(dance => dance.id === event.target.value)
          if (dance === undefined) return
          const selection = resolveDancePreset(dance, profile, lab.scene, limits, props.maxFileBytes)
          if ('error' in selection) { actions.failure(selection.error); return }
          actions.loadDance(dance.guide, dance.bpm, selection.dance.clip, dance.id)
          props.openWorkspace()
        }}>
          <option value="" disabled>{t('danceClip.placeholder')}</option>
          {dancePresets.map(dance => <option key={dance.id} value={dance.id}
            disabled={dance.kind === 'walking' && lab.scene?.kinematics === undefined}>{t(dance.revision === 2 ? 'danceClip.optionV2' : 'danceClip.option', {
              name: t(`danceClip.${dance.style}`), duration: Number(dance.clip.duration.toFixed(2)), bpm: dance.bpm,
            })}</option>)}
        </select></label>
      </div>
      <p className={css.note}>{t('danceClip.hint')}</p>
      <ClipMusicPicker state={state} actions={actions} t={t} />
      <div className={css.transport}>
        <button type="button" disabled={!ready || state.exporting} onClick={() => {
          if (!ready) return
          const pose = defaultClipPose(profile)
          actions.load({ version: 1, name: 'new-clip', duration: 1, loop: true, keys: [{ t: 0, ...pose }, { t: 1, ...pose }] })
          props.openWorkspace()
        }}>{t('newClip')}</button>
        <button type="button" disabled={!ready || state.exporting} onClick={() => {
          if (!ready) return
          try {
            const preview = validatePreviewClip(compileTurningPreview(profile, 120, t('turnDemoName')), profile, limits)
            actions.parameters(120, 0.5, [], preview); actions.prompt(t('turnDemoGuide')); props.openWorkspace()
          } catch { actions.failure('limits') }
        }}>{t('turnDemo')}</button>
        <button type="button" disabled={!ready || state.exporting || lab.scene?.kinematics === undefined} onClick={() => {
          if (!ready || lab.scene === null) return
          if (limits.maxClipSeconds < 20 || limits.maxClipKeys < 259 || limits.minBpm > 120 || limits.maxBpm < 120) {
            actions.failure('limits'); return
          }
          try {
            const walking = validateWalkingClip(compileWalkingPreview(profile, lab.scene, t('walkDemoName')), profile, lab.scene, limits)
            if (new TextEncoder().encode(JSON.stringify(walking, null, 2) + '\n').byteLength > props.maxFileBytes) {
              actions.failure('fileSize'); return
            }
            actions.parameters(120, 0.5, [], walking); actions.prompt(t('walkDemoGuide')); props.openWorkspace()
          } catch { actions.failure('walking') }
        }}>{t('walkDemo')}</button>
        <button type="button" disabled={!ready || state.exporting} onClick={() => input.current?.click()}>{t('load')}</button>
        <button type="button" disabled={state.clip === null || state.unkeyed || state.exporting} onClick={saveClip}>{t('save')}</button>
        <input ref={input} hidden type="file" accept=".json,application/json" aria-label={t('load')} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file === undefined || !ready) return
          if (file.size > props.maxFileBytes) { actions.failure('fileSize'); return }
          const revision = state.revision
          void file.text().then((text) => {
            if (!importOwner.current.active || importOwner.current.revision !== revision) return
            try {
              const value = JSON.parse(text) as unknown
              const walking = typeof value === 'object' && value !== null && 'version' in value && value.version === 3
              if (walking && lab.scene === null) { actions.failure('walking'); return }
              actions.load(walking && lab.scene !== null ? validateWalkingClip(value, profile, lab.scene, limits)
                : validatePreviewClip(value, profile, limits))
              props.openWorkspace()
            } catch { actions.failure('import') }
          }, () => { if (importOwner.current.active) actions.failure('import') })
        }} />
      </div>
      {ready && <ClipAnimate state={state} profile={profile} scene={lab.scene} limits={limits}
        actions={actions} t={t} openWorkspace={props.openWorkspace} />}
      {state.clip !== null && <>
        <label className={css.check}><input type="checkbox" checked={state.verifiedRevision === state.revision} disabled={state.unkeyed || state.exporting}
          onChange={(event) => { actions.verify(event.target.checked) }} />{t('verified')}</label>
        <ClipAudioExport checked={state.exportWithAudio} available={state.audioId !== null || state.musicChoice !== 'original'} disabled={state.exporting}
          onChange={actions.exportAudio} label={t('export.withAudio')} emptyHint={t('export.noAudio')} />
        <button type="button" className={css.primary} disabled={state.verifiedRevision !== state.revision || state.unkeyed || state.exporting || !state.clip.name.trim()
          || !state.previewReady || lab.scene?.kinematics === undefined} onClick={() => { props.openWorkspace(); actions.generate() }}>{t(state.exporting ? 'generating' : 'generate')}</button>
        <p className={css.note}>{t('generationScope')}</p>
      </>}
    </section>
    <section className={css.section} aria-label={t('outputTitle')}><h2>{t('outputTitle')}</h2>
      {video === null || download === null ? <p className={css.note}>{t('outputEmpty')}</p> : <>
        <video ref={movieElement} className={css.video} controls preload="metadata" src={download.url} aria-label={t('video')} />
        <p>{t('outputReady', { filename: download.filename, bytes: download.bytes })}</p>
        {video.duckCount !== undefined && <p>{t('ducks.output', { count: video.duckCount })}</p>}
        <ClipMusicCredit credit={state.exportWithAudio ? video.musicCredit : undefined}
          filename={video.filename} t={t} saveText={props.saveText} />
        {video.revision !== state.revision && <p role="status" className={css.note}>{t('stale')}</p>}
        <div className={css.transport}><a href={download.url} download={download.filename}>{t('download')}</a>
          <ClipAudioExport checked={state.exportWithAudio} available={video.audio !== undefined} disabled={state.exporting}
            onChange={actions.exportAudio} label={t('export.withAudio')} emptyHint={t('export.noAudio')} />
          <button type="button" onClick={() => { props.saveText(video.clipJson, 'microduck-clip.json') }}>{t(video.duckCount === undefined ? 'outputJson' : 'ducks.outputJson')}</button></div>
      </>}
      <p className={css.note}>{t('export.audioHint')}</p>
      <p className={css.note}>{t('localSave')}</p>
      <p className={css.note}>{t(clip?.version === 3 ? 'walkingLocked' : clip?.version === 2 ? 'previewOnly' : 'trainHint')}</p>
      <button type="button" disabled={state.clip === null || state.clip.version !== 1 || state.unkeyed || state.exporting}
        onClick={() => { if (state.clip?.version !== 1) return; saveClip(); props.openTraining() }}>{t('train')}</button>
    </section>
  </section>
}
