/** Explicit experimental criteria editing; target names come only from the selected robot profile. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RobotDanceCriteria, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import { CHOREOGRAPHY_FIELDS, choreographyDraft, hasChoreographyJoints, type ChoreographyDraft } from './choreography-draft.ts'

type Locale = PropsLocale<'robot-lab'>
const VERSIONS: Record<RobotDanceCriteria['version'], Parameters<Locale['t']>[0]> = { 1: 'criteria.version1', 2: 'criteria.version2' }

/**
 * Keep optional, incomplete criteria editable without supplying calibrated defaults.
 * @param props - Raw or untouched numeric criteria, selected profile names, and declared-store mutation callback.
 * @returns An explicit opt-in and version-preserving fields, or a profile-unavailable notice.
 */
export function ChoreographyEditor({ value, criteria, profile, disabled, onChange, t }: Locale & {
  value: ChoreographyDraft | undefined
  criteria: RobotDanceCriteria | undefined
  profile: RobotProfile | undefined
  disabled: boolean
  onChange: (value: ChoreographyDraft) => void
}) {
  const draft = value ?? choreographyDraft(criteria)
  const enabled = value === undefined ? criteria !== undefined : value.enabled
  const available = hasChoreographyJoints(profile)
  return <details>
    <summary>{t('criteria.title')}</summary>
    <p>{t('criteria.experimental')}</p>
    <label><input type="checkbox" checked={enabled} disabled={disabled || (!available && !enabled)}
      onChange={(event) => { onChange({ ...draft, enabled: event.target.checked }) }} />{t('criteria.enable')}</label>
    {!available && <p>{t('criteria.profileMissing')}</p>}
    {enabled && <>
      <p>{t(VERSIONS[draft.version])}</p>
      <p>{t('criteria.ranges')}</p>
      {available && <fieldset disabled={disabled}>
        {CHOREOGRAPHY_FIELDS.map(key => <label key={key}>{t(`criteria.${key}`)}
          <input type="text" inputMode="decimal" value={draft.fields[key]} onChange={(event) => {
            onChange({ ...draft, fields: { ...draft.fields, [key]: event.target.value } })
          }} />
        </label>)}
        {profile.joints.map((joint, index) => <div key={joint.index}>
          <label>{joint.name} · {t('criteria.jointRmse')}
            <input type="text" inputMode="decimal" value={draft.maxJointRmseRad[index]}
              onChange={(event) => {
                onChange({ ...draft, maxJointRmseRad: draft.maxJointRmseRad.map((text, current) =>
                  current === index ? event.target.value : text) })
              }} />
          </label>
          <label><input type="checkbox" checked={draft.movingJointIndices.includes(index)} onChange={(event) => {
            onChange({ ...draft, movingJointIndices: event.target.checked
              ? [...draft.movingJointIndices, index].sort((a, b) => a - b)
              : draft.movingJointIndices.filter(current => current !== index) })
          }} />{joint.name} · {t('criteria.moving')}</label>
        </div>)}
      </fieldset>}
    </>}
  </details>
}
