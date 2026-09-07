/** Explicit experimental choreography inputs; incomplete text is not an admission request. */
import type { RobotDanceCriteria, RobotEvaluationCriteria, RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'

/** Scalar fields whose raw text survives navigation and draft recovery. */
export const CHOREOGRAPHY_FIELDS = ['requiredCycles', 'minPassedEpisodeFraction', 'maxRootOrientationRmseRad',
  'minReferenceExcursionRad', 'minAmplitudeRatio', 'maxAmplitudeRatio', 'minReferenceGainRatio', 'maxHorizontalDriftMeters'] as const
/** One editable source, retained while disabled; old criterion versions are never upgraded implicitly. */
export type ChoreographyDraft = {
  enabled: boolean
  version: RobotDanceCriteria['version']
  fields: Record<typeof CHOREOGRAPHY_FIELDS[number], string>
  maxJointRmseRad: string[]
  movingJointIndices: number[]
}

/**
 * Require a complete target-to-criterion index mapping before editing or admitting choreography.
 * @param profile - Selected target profile, absent while its catalog is unavailable.
 * @returns Whether all fourteen canonical indices have explicit joint names.
 */
export function hasChoreographyJoints(profile: RobotProfile | undefined): profile is RobotProfile {
  return profile !== undefined && profile.joints.length === 14
    && profile.joints.every((joint, index) => joint.index === index && joint.name.trim() !== '')
}

/**
 * Create empty explicit v2 inputs or hydrate recorded criteria without choosing new thresholds.
 * @param criteria - Existing criteria whose version and all values must be preserved.
 * @returns Enabled raw inputs, not validated scientific criteria.
 */
export function choreographyDraft(criteria?: RobotDanceCriteria): ChoreographyDraft {
  return { enabled: true, version: criteria?.version ?? 2,
    fields: { requiredCycles: criteria === undefined ? '' : String(criteria.requiredCycles),
      minPassedEpisodeFraction: criteria === undefined ? '' : String(criteria.minPassedEpisodeFraction),
      maxRootOrientationRmseRad: criteria === undefined ? '' : String(criteria.maxRootOrientationRmseRad),
      minReferenceExcursionRad: criteria === undefined ? '' : String(criteria.minReferenceExcursionRad),
      minAmplitudeRatio: criteria === undefined ? '' : String(criteria.minAmplitudeRatio),
      maxAmplitudeRatio: criteria === undefined ? '' : String(criteria.maxAmplitudeRatio),
      minReferenceGainRatio: criteria === undefined ? '' : String(criteria.minReferenceGainRatio),
      maxHorizontalDriftMeters: criteria === undefined ? '' : String(criteria.maxHorizontalDriftMeters) },
    maxJointRmseRad: criteria === undefined ? Array<string>(14).fill('') : criteria.maxJointRmseRad.map(String),
    movingJointIndices: criteria === undefined ? [] : [...criteria.movingJointIndices] }
}

/**
 * Check numeric admission ranges; the provider still owns resource limits and target feasibility.
 * @param criteria - Explicit, version-preserving numeric criteria.
 * @returns Whether all required thresholds and selected joint indices are admissible.
 */
export function validChoreography(criteria: RobotDanceCriteria): boolean {
  const nonnegative = (value: number) => Number.isFinite(value) && value >= 0
  const positive = (value: number) => Number.isFinite(value) && value > 0
  return Number.isSafeInteger(criteria.requiredCycles) && criteria.requiredCycles > 0
    && positive(criteria.minPassedEpisodeFraction) && criteria.minPassedEpisodeFraction <= 1
    && criteria.maxJointRmseRad.length === 14 && criteria.maxJointRmseRad.every(nonnegative)
    && nonnegative(criteria.maxRootOrientationRmseRad) && nonnegative(criteria.maxHorizontalDriftMeters)
    && positive(criteria.minReferenceExcursionRad) && positive(criteria.minReferenceGainRatio)
    && positive(criteria.minAmplitudeRatio) && positive(criteria.maxAmplitudeRatio)
    && criteria.maxAmplitudeRatio >= criteria.minAmplitudeRatio
    && criteria.movingJointIndices.length > 0 && criteria.movingJointIndices.length <= 14
    && criteria.movingJointIndices.every(index => Number.isSafeInteger(index) && index >= 0 && index < 14)
    && new Set(criteria.movingJointIndices).size === criteria.movingJointIndices.length
}

/**
 * Resolve an enabled text draft without treating blank entries as zero or falling back to balance-only assessment.
 * @param draft - Raw numeric text and explicitly selected joints.
 * @returns Numeric criteria, or null while required inputs are incomplete or outside their ranges.
 */
export function resolveChoreography(draft: ChoreographyDraft): RobotDanceCriteria | null {
  const values = [...Object.values(draft.fields), ...draft.maxJointRmseRad]
  if (values.some(text => text.trim() === '' || !Number.isFinite(Number(text)))) return null
  const criteria: RobotDanceCriteria = { version: draft.version, requiredCycles: Number(draft.fields.requiredCycles),
    minPassedEpisodeFraction: Number(draft.fields.minPassedEpisodeFraction),
    maxRootOrientationRmseRad: Number(draft.fields.maxRootOrientationRmseRad),
    minReferenceExcursionRad: Number(draft.fields.minReferenceExcursionRad), minAmplitudeRatio: Number(draft.fields.minAmplitudeRatio),
    maxAmplitudeRatio: Number(draft.fields.maxAmplitudeRatio), minReferenceGainRatio: Number(draft.fields.minReferenceGainRatio),
    maxHorizontalDriftMeters: Number(draft.fields.maxHorizontalDriftMeters), maxJointRmseRad: draft.maxJointRmseRad.map(Number),
    movingJointIndices: [...draft.movingJointIndices] }
  return validChoreography(criteria) ? criteria : null
}

/**
 * Project the one active editor into a request without mutating saved or configured criteria.
 * @param base - Balance settings and any untouched legacy choreography criteria.
 * @param draft - Optional raw editor, including disabled work retained for later use.
 * @returns Resolved criteria, or null when enabled choreography is incomplete.
 */
export function resolveAssessment(base: RobotEvaluationCriteria, draft: ChoreographyDraft | undefined): RobotEvaluationCriteria | null {
  if (draft === undefined) return base
  const { dance: _dance, ...balance } = base
  if (!draft.enabled) return balance
  const dance = resolveChoreography(draft)
  return dance === null ? null : { ...balance, dance }
}
