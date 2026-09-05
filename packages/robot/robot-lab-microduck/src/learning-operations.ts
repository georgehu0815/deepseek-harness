/** Learning operations compose host records with the unchanged Python training and rollout interface. */
import { isDeepStrictEqual } from 'node:util'
import type { RobotLabRequest, RobotLabResult, RobotRun, RobotRunId, RobotTrialEntry } from '@deepseek-ai/dsh-robot-lab'
import type { LearningLimits, LearningStore } from './learning-store.ts'

/** Dispatch host-owned learning operations; training admission remains in the process supervisor.
 * @param request - Validated public operation.
 * @param store - Current session's bounded immutable storage.
 * @param limits - Resolved deployment limits.
 * @param call - Existing confined Python operation caller.
 * @param reconcile - Existing supervisor's orphan-run reconciliation.
 * @returns Handled result, or undefined for an ordinary Python/supervisor operation.
 */
export async function learningOperation(request: RobotLabRequest, store: LearningStore, limits: LearningLimits,
  call: (request: RobotLabRequest) => Promise<RobotLabResult>,
  reconcile: (run: RobotRun) => Promise<RobotRun>,
): Promise<RobotLabResult | undefined> {
  switch (request.operation) {
    case 'save_trial': {
      store.validateRecipe(request.recipe)
      const project = await call({ operation: 'project', projectRevisionId: request.recipe.spec.projectRevisionId })
      if (project.operation !== 'project') throw new Error('Expected frozen project revision')
      const reply = await call({ operation: 'behaviors' })
      if (reply.operation !== 'behaviors') throw new Error('Expected registered training behaviors')
      const behavior = reply.behaviors.find(value => value.id === request.recipe.spec.behaviorId)
      if (behavior === undefined) throw new Error('Trial requires a registered behavior')
      const rewardKeys = new Set(reply.behaviors.flatMap(value => value.terms.map(term => term.key)))
      if (Object.keys(request.recipe.spec.weights).some(key => !rewardKeys.has(key))) throw new Error('Trial contains an unknown reward term')
      return { operation: 'save_trial', trial: await store.saveTrial(request.recipe, project.project) }
    }
    case 'trials': {
      const trials: RobotTrialEntry[] = []
      for (const id of await store.trialIds()) {
        const trial = await store.trial(id)
        const binding = await store.binding(trial)
        const run = binding === null ? null : await reconcile(await store.run(binding.runId))
        trials.push({ trial, binding, run })
      }
      return { operation: 'trials', trials }
    }
    case 'evaluations': return { operation: 'evaluations', ...await store.evaluations() }
    case 'evaluate_trial': {
      const trial = await store.trial(request.trialId)
      const run = await store.completedRun(trial)
      const history = await store.evaluations()
      if (history.evaluations.length + history.incompleteCount >= limits.maxEvaluationRecords) throw new Error('Maximum evaluation records reached')
      const result = await call({ operation: 'evaluate', spec: { ...trial.recipe.evaluation, policyId: run.policyId } })
      if (result.operation !== 'evaluate') throw new Error('Expected completed evaluation')
      const evaluation = await store.evaluation(result.evaluation.id)
      if (!isDeepStrictEqual(evaluation, result.evaluation)) throw new Error('Evaluation response differs from committed report')
      await store.matchEvaluation(trial, evaluation)
      return { operation: 'evaluate_trial', evaluation }
    }
    case 'save_reflection': return { operation: 'save_reflection', reflection: await store.saveReflection(request.reflection) }
    case 'reflections': return { operation: 'reflections', reflections: await store.reflections() }
    case 'replay_evaluation': {
      const evaluation = await store.evaluation(request.evaluationId)
      const episode = evaluation.episodes[request.episodeIndex]
      if (episode === undefined) throw new Error('Evaluation episodeIndex is outside the completed report')
      if (!evaluation.policyId.startsWith('run:')) throw new Error('Exact evaluation re-simulation requires an owned completed run policy')
      const run = await store.run(evaluation.policyId.slice(4) as RobotRunId)
      if (run.state !== 'completed' || run.policyId !== evaluation.policyId || run.policySha256 !== evaluation.policyHash
        || run.observationProfile !== evaluation.observationProfile || !isDeepStrictEqual(run.provenance.bam, evaluation.physics.bam)) throw new Error('Evaluation policy bytes or physics differ from the frozen run')
      const result = await call({ operation: 'simulate', policyId: evaluation.policyId,
        steps: evaluation.spec.stepsPerEpisode, seed: episode.seed, command: [0, 0, 0] })
      if (result.operation !== 'simulate' || result.simulation.policyId !== evaluation.policyId || result.simulation.policyHash !== evaluation.policyHash
        || result.simulation.observationProfile !== evaluation.observationProfile || !isDeepStrictEqual(result.simulation.physics, evaluation.physics)) throw new Error('New re-simulation differs from evaluated policy or physics')
      return { operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: request.episodeIndex,
        mode: 'new-resimulation', simulation: result.simulation }
    }
    default: return undefined
  }
}
