/** Pre-training admission derivation from editable UI inputs and exact saved project data. */
import type { RobotBehavior, RobotProjectRevision, RobotTrialRecipe, RobotEvaluationCriteria } from '@deepseek-ai/dsh-robot-lab/types'
import type { RobotDraft } from './store.ts'
import { validAssessment } from './evaluation-evidence.ts'
import { hasChoreographyJoints, resolveAssessment } from './choreography-draft.ts'

/**
 * Resolve guided admission without borrowing a performance duration or fabricating a learning prediction.
 * @param view - current authoring and training inputs.
 * @param project - exact saved revision, absent for dirty or unsaved authoring.
 * @param behavior - registered behavior supplying default budget and reward weights.
 * @param defaults - configured assessment criteria before explicit edits.
 * @returns a complete save request, or null when the student's plan is incomplete.
 */
export function trialRecipe(view: RobotDraft, project: RobotProjectRevision | undefined, behavior: RobotBehavior | undefined,
  defaults: RobotEvaluationCriteria): RobotTrialRecipe | null {
  const evaluation = resolveAssessment(view.assessment ?? defaults, view.choreography)
  const steps = view.steps === '' ? behavior?.defaultSteps ?? 0 : Number(view.steps)
  const briefFields: string[] = [view.brief.goal, view.brief.prediction, view.brief.plannedChange, view.brief.evidence]
  if (view.customTraining || project === undefined || behavior === undefined || evaluation === null || !validAssessment(evaluation)
    || (evaluation.dance !== undefined && !hasChoreographyJoints(project.profile))
    || briefFields.some(value => value.trim() === '')
    || !Number.isSafeInteger(steps) || steps < 1 || view.envs.trim() === '' || !Number.isSafeInteger(Number(view.envs)) || Number(view.envs) < 1
    || view.seed.trim() === '' || !Number.isSafeInteger(Number(view.seed)) || Number(view.seed) < 0 || Number(view.seed) > 2147483647) return null
  return {
    spec: { projectRevisionId: project.id, clip: null, name: `project-${project.id}`, behaviorId: behavior.id,
      backend: view.trainingBackend, steps, envs: Number(view.envs), seed: Number(view.seed), actuator: 'bam',
      weights: view.trainingWeights ?? {
        ...Object.fromEntries(behavior.terms.map(term => [term.key, term.weight])), ...project.training.weights,
      } },
    brief: { ...view.brief }, evaluation: { ...evaluation }, parentReflectionId: view.parentReflectionId,
  }
}
