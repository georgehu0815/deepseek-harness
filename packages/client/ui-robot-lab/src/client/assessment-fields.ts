/** Plain assessment field descriptions shared by the two registered learning sections. */
import type { RobotEvaluationCriteria } from '@deepseek-ai/dsh-robot-lab/types'
import { validAssessment } from './evaluation-evidence.ts'

interface AssessmentField {
  key: keyof RobotEvaluationCriteria
  label: string
  min: number
  max?: number
  step: number
}

/** Serializable input descriptions and validation feedback for a registered learning section. */
export interface AssessmentForm {
  fields: AssessmentField[]
  error: string | null
}

/**
 * Describe editable criteria without rendering, subscribing or receiving framework props.
 * @param assessment - current criteria, including the episode count that bounds allowed terminations.
 * @returns plain field descriptors and validation feedback for the owning section to render.
 */
export function assessmentFields(assessment: RobotEvaluationCriteria): AssessmentForm {
  const fields: AssessmentField[] = [
    { key: 'episodes', label: 'Assessment episodes', min: 1, step: 1 },
    { key: 'stepsPerEpisode', label: 'Assessment horizon (steps)', min: 1, step: 1 },
    { key: 'seed', label: 'Assessment seed', min: 0, step: 1 },
    { key: 'maxTerminations', label: 'Maximum terminations', min: 0, max: assessment.episodes, step: 1 },
    { key: 'minMeanUprightFraction', label: 'Minimum mean upright fraction', min: 0, max: 1, step: 0.01 },
  ]
  return { fields, error: validAssessment(assessment) ? null
    : 'Enter valid integer episode counts, horizon and seeds, and criteria within the displayed ranges.' }
}
