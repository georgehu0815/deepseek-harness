/** Shared model-part identification and joint/rig authoring controls for Clip Gen poses. */
import { useEffect, useId, useMemo, useState } from 'react'
import type { RobotProfile, RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipGenProps } from './clip-gen-props.ts'
import type { ClipGenDraft } from './clip-gen-store.ts'
import { applyClipRig, clipRigs, measureClipRig, rootPitchLimit } from './clip-motion.ts'
import type { ClipRig } from './clip-motion.ts'
import { rootYawLimit } from './clip-preview.ts'
import { buildClipPartArtwork } from './clip-part-artwork.ts'
import { ClipPartIcon } from './ClipPartIcon.tsx'
import css from './ClipGen.module.css'

const jointControls = [
  ['left_hip_yaw', 'hipYaw'], ['left_hip_roll', 'hipRoll'], ['left_hip_pitch', 'hipPitch'],
  ['left_knee', 'knee'], ['left_ankle', 'ankle'], ['neck_pitch', 'neckPitch'],
  ['head_pitch', 'headPitch'], ['head_yaw', 'headYaw'], ['head_roll', 'headRoll'],
  ['right_hip_yaw', 'hipYaw'], ['right_hip_roll', 'hipRoll'], ['right_hip_pitch', 'hipPitch'],
  ['right_knee', 'knee'], ['right_ankle', 'ankle'],
] as const

function ExactNumber({ value, min, max, label, describedBy, onChange }: {
  value: number
  min: number
  max: number
  label: string
  describedBy: string
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(current => current.trim() !== '' && Number(current) === value ? current : String(value))
  }, [value])
  return <input type="number" aria-label={label} aria-describedby={describedBy}
    min={min} max={max} step="any" value={text} onChange={(event) => {
      setText(event.currentTarget.value)
      const next = event.currentTarget.valueAsNumber
      if (Number.isFinite(next) && next >= min && next <= max) onChange(next)
    }} onBlur={() => { setText(String(value)) }} />
}

/**
 * Edit the current pose without keying it; export and walking clips lock all pose mutations.
 * @param props - localized controls, installed profile, optional matching scene and draft actions.
 * @returns fourteen joint controls, root angles and optional rig controls, or nothing without a pose.
 */
export function ClipPoseControls({ state, profile, scene, actions, t }: {
  state: ClipGenDraft
  profile: RobotProfile
  scene: RobotScene | null
  actions: ClipGenProps['actions']
  t: ClipGenProps['t']
}) {
  const { clip, pose } = state
  const hintId = useId()
  const hasPose = clip !== null && pose !== null
  const artwork = useMemo(() => {
    if (!hasPose || scene === null || scene.jointNames.length !== profile.joints.length
      || scene.jointNames.some((name, index) => name !== profile.joints[index]?.name)) return null
    return buildClipPartArtwork(scene)
  }, [hasPose, scene, profile])
  if (clip === null || pose === null) return null
  const angle = (value: number) => t('angleValue', { radians: value.toFixed(3), degrees: (value * 180 / Math.PI).toFixed(1) })
  const sliders = (indices: number[], label: string) => <fieldset className={css.jointGroup}>
    <legend><span className={css.iconLabel}>
      <ClipPartIcon artwork={artwork} joints={indices} className={css.headingIcon} />{label}
    </span></legend>
    {indices.map((index) => {
      const joint = profile.joints[index] as RobotProfile['joints'][number]
      const control = jointControls.find(([name]) => name === joint.name)
      const helpId = `${hintId}-joint-${index}`
      return <label key={joint.name} htmlFor={`${helpId}-input`} className={css.slider} data-selected={state.selectedJoint === index}>
        <span className={css.controlHeader}>
          <ClipPartIcon artwork={artwork} joints={[index]} />
          <span className={css.controlIdentity}>
            <button type="button" className={css.jointName} aria-label={joint.name} onClick={() => { actions.select(index) }}>
              <strong>{t(control === undefined ? 'joint.unknown' : `joint.${control[0]}`)}</strong><code>{joint.name}</code>
            </button><small>{t('servoLabel', { number: index + 1 })}</small>
          </span>
          <button type="button" aria-label={t('reset', { name: joint.name })}
            onClick={() => { actions.joint(profile, index, joint.defaultPosition) }}>↺</button>
        </span>
        <output>{angle(pose.joints[index] as number)}</output>
        <span id={helpId} className={css.controlHelp}>{t(`jointHelp.${control?.[1] ?? 'unknown'}`)}</span>
        <span>
          <input id={`${helpId}-input`} type="range" aria-label={joint.name} aria-describedby={`${helpId} ${helpId}-range ${hintId}-joints`}
            aria-valuetext={angle(pose.joints[index] as number)} min={joint.lower} max={joint.upper} step={0.001}
            value={pose.joints[index]} onChange={(event) => {
              actions.select(index); actions.joint(profile, index, Number(event.target.value))
            }} />
          <ExactNumber key={joint.name} value={pose.joints[index] as number} min={joint.lower} max={joint.upper}
            label={t('preciseAngle', { name: joint.name })} describedBy={`${helpId} ${helpId}-range ${hintId}-joints`}
            onChange={(value) => { actions.select(index); actions.joint(profile, index, value) }} />
        </span>
        <small id={`${helpId}-range`} className={css.controlRange}>{t('jointRange', {
          lower: joint.lower.toFixed(3), upper: joint.upper.toFixed(3), neutral: joint.defaultPosition.toFixed(3),
        })}</small>
      </label>
    })}
  </fieldset>
  return <>
    {clip.version === 3 && <p role="status" className={css.note}>{t('walkingLocked')}</p>}
    <fieldset disabled={state.exporting || clip.version === 3} className={css.editor}>
      <div className={css.transport}>
        <button type="button" className={css.iconLabel} aria-pressed={state.mode === 'joints'} onClick={() => { actions.mode('joints') }}>
          <ClipPartIcon artwork={artwork} joints={[]} className={css.headingIcon} />{t('joints')}</button>
        <button type="button" className={css.iconLabel} aria-pressed={state.mode === 'rig'} onClick={() => { actions.mode('rig') }}>
          <ClipPartIcon artwork={artwork} joints={[0, 1, 2, 3, 4, 9, 10, 11, 12, 13]} root className={css.headingIcon} />{t('rig')}</button>
      </div>
      <p className={css.note}>{t(artwork === null ? 'anatomyUnavailable' : 'anatomyHint')}</p>
      {state.mode === 'rig' && <><p id={`${hintId}-rig`} className={css.note}>{t('rigControlHint')}</p><div className={css.rigGrid}>
        {(Object.keys(clipRigs) as ClipRig[]).map((rig) => {
          const range = measureClipRig(profile, pose, rig)
          const parts = Object.keys(clipRigs[rig])
          const indices = profile.joints.flatMap((joint, index) => parts.includes(joint.name) ? [index] : [])
          const helpId = `${hintId}-rig-${rig}`
          return <label key={rig} htmlFor={`${helpId}-input`} className={css.slider} data-selected={state.rig === rig}
            title={t('rigLimit', { lower: range.lowerBy, upper: range.upperBy })}>
            <span className={css.controlHeader}>
              <ClipPartIcon artwork={artwork} joints={indices} root={parts.includes('root')} />
              <strong className={css.controlIdentity}>{t(`rig.${rig}`)}</strong>
              <button type="button" aria-label={t('reset', { name: t(`rig.${rig}`) })}
                onClick={() => { actions.rig(rig); actions.pose(applyClipRig(profile, pose, rig, 0)) }}>↺</button>
            </span>
            <output>{t('rigValue', { value: range.value.toFixed(3) })}</output>
            <span id={helpId} className={css.controlHelp}>{t(`rigHelp.${rig}`)}</span>
            <span>
              <input id={`${helpId}-input`} type="range" aria-label={t(`rig.${rig}`)} aria-describedby={`${helpId} ${helpId}-range ${hintId}-rig`}
                aria-valuetext={t('rigValue', { value: range.value.toFixed(3) })} min={range.lower} max={range.upper} step={0.001}
                value={range.value} onChange={(event) => {
                  actions.rig(rig); actions.pose(applyClipRig(profile, pose, rig, Number(event.target.value)))
                }} />
              <ExactNumber key={rig} value={range.value} min={range.lower} max={range.upper}
                label={t('preciseAmount', { name: t(`rig.${rig}`) })} describedBy={`${helpId} ${helpId}-range ${hintId}-rig`}
                onChange={(value) => { actions.rig(rig); actions.pose(applyClipRig(profile, pose, rig, value)) }} />
            </span>
            <small id={`${helpId}-range`} className={css.controlRange}>{t('rigRange', { lower: range.lower.toFixed(3), upper: range.upper.toFixed(3) })}
              {' · '}{t('rigLimit', { lower: range.lowerBy, upper: range.upperBy })}</small>
          </label>
        })}
      </div></>}
      <label htmlFor={`${hintId}-root-input`} className={css.slider}>
        <span className={css.controlHeader}><ClipPartIcon artwork={artwork} joints={[]} root />
          <strong className={css.controlIdentity}>{t('root')}</strong>
          <button type="button" aria-label={t('reset', { name: t('root') })} onClick={() => { actions.joint(profile, -1, 0) }}>↺</button></span>
        <output>{angle(pose.rootPitch)}</output>
        <span id={`${hintId}-root`} className={css.controlHelp}>{t('rootHelp')}</span>
        <span>
          <input id={`${hintId}-root-input`} type="range" aria-label={t('root')} aria-describedby={`${hintId}-root ${hintId}-root-range`}
            aria-valuetext={angle(pose.rootPitch)} min={-rootPitchLimit} max={rootPitchLimit} step={0.001}
            value={pose.rootPitch} onChange={(event) => { actions.joint(profile, -1, Number(event.target.value)) }} />
          <ExactNumber key="root" value={pose.rootPitch} min={-rootPitchLimit} max={rootPitchLimit}
            label={t('preciseAngle', { name: t('root') })} describedBy={`${hintId}-root ${hintId}-root-range`}
            onChange={(value) => { actions.joint(profile, -1, value) }} />
        </span>
        <small id={`${hintId}-root-range`} className={css.controlRange}>{t('jointRange', {
          lower: (-rootPitchLimit).toFixed(3), upper: rootPitchLimit.toFixed(3), neutral: '0.000',
        })}</small>
      </label>
      <label htmlFor={`${hintId}-heading-input`} className={css.slider}>
        <span className={css.controlHeader}><strong className={css.controlIdentity}>{t('heading')}</strong>
          <button type="button" aria-label={t('reset', { name: t('heading') })} onClick={() => { actions.heading(0) }}>↺</button></span>
        <output>{angle(pose.rootYaw ?? 0)}</output>
        <span id={`${hintId}-heading-help`} className={css.controlHelp}>{t('headingHelp')}</span>
        <span>
          <input id={`${hintId}-heading-input`} type="range" aria-label={t('heading')} aria-describedby={`${hintId}-heading-help`}
            aria-valuetext={angle(pose.rootYaw ?? 0)} min={-rootYawLimit} max={rootYawLimit} step={0.001}
            value={pose.rootYaw ?? 0} onChange={(event) => { actions.heading(Number(event.target.value)) }} />
          <ExactNumber key="heading" value={pose.rootYaw ?? 0} min={-rootYawLimit} max={rootYawLimit}
            label={t('preciseAngle', { name: t('heading') })} describedBy={`${hintId}-heading-help`}
            onChange={(value) => { actions.heading(value) }} />
        </span>
      </label>
      {clip.version === 2 && <p role="status" className={css.note}>{t('previewOnly')}</p>}
      <details open={state.mode === 'joints'}>
        <summary><span className={css.iconLabel}>
          <ClipPartIcon artwork={artwork} joints={[]} className={css.headingIcon} />{t('joints')}
        </span></summary>
        <p id={`${hintId}-joints`} className={css.note}>{t('jointControlHint')}</p>
        <div className={css.jointGrid}>{sliders([0, 1, 2, 3, 4], t('leftLeg'))}
          {sliders([5, 6, 7, 8], t('headNeck'))}{sliders([9, 10, 11, 12, 13], t('rightLeg'))}</div>
      </details>
      <button type="button" onClick={() => { actions.defaultPose(profile) }}>{t('defaultPose')}</button>
    </fieldset>
  </>
}
