/** Plain assessment field descriptions shared by the two registered learning sections. */
import type { RobotEvaluationCriteria } from '@deepseek-ai/dsh-robot-lab/types'
import type { en } from './locales.ts'
import { validAssessment } from './evaluation-evidence.ts'

interface AssessmentField {
  key: keyof Omit<RobotEvaluationCriteria, 'dance'>
  label: keyof typeof en
  min: number
  max?: number
  step: number
}

/** Serializable input descriptions and locale keys for a registered learning section. */
export interface AssessmentForm {
  fields: AssessmentField[]
  error: keyof typeof en | null
}

/**
 * Describe editable criteria without rendering, subscribing or receiving framework props.
 * @param assessment - current criteria, including the episode count that bounds allowed terminations.
 * @returns plain field descriptors and validation locale keys for the owning section to render.
 */
export function assessmentFields(assessment: RobotEvaluationCriteria): AssessmentForm {
  const fields: AssessmentField[] = [
    { key: 'episodes', label: 'fields.episodes', min: 1, step: 1 },
    { key: 'stepsPerEpisode', label: 'fields.stepsPerEpisode', min: 1, step: 1 },
    { key: 'seed', label: 'fields.seed', min: 0, step: 1 },
    { key: 'maxTerminations', label: 'fields.maxTerminations', min: 0, max: assessment.episodes, step: 1 },
    { key: 'minMeanUprightFraction', label: 'fields.minMeanUprightFraction', min: 0, max: 1, step: 0.01 },
  ]
  return { fields, error: validAssessment(assessment) ? null : 'fields.invalid' }
}
