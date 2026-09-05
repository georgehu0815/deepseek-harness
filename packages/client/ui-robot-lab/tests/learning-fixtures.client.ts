import type { RobotTrial, RobotTrialBinding, RobotTrialEntry, RobotEvaluation, RobotReflection, RobotLearningBrief } from '@deepseek-ai/dsh-robot-lab/types'
import { fixtureProject, fixtureRunningRun, fixturePhysics, fixtureSimulation, readySnapshot } from './fixtures.client.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'

export const brief: RobotLearningBrief = { goal: 'Track a gentle sway', prediction: 'Smaller moves reduce tracking error',
  plannedChange: 'Reduce master move size', evidence: 'Compare upright fraction, termination and tracking error' }
export const trial: RobotTrial = { version: 1, id: 'trial-one' as RobotTrial['id'], createdAt: '2026-09-05',
  projectRevisionId: fixtureProject.id, projectSha256: fixtureProject.sha256, sha256: 'a'.repeat(64),
  recipe: { spec: { projectRevisionId: fixtureProject.id, clip: null, name: `project-${fixtureProject.id}`,
    backend: 'cpu', behaviorId: 'imitate', steps: 100, envs: 4, seed: 0, actuator: 'bam', weights: {} },
  brief, evaluation: { episodes: 1, stepsPerEpisode: 100, seed: 17, maxTerminations: 0, minMeanUprightFraction: 0.9 },
  parentReflectionId: null } }
export const binding: RobotTrialBinding = { version: 1, trialId: trial.id, trialSha256: trial.sha256, runId: fixtureRunningRun.id,
  recipeHash: 'recipe', createdAt: '2026-09-05', sha256: 'b'.repeat(64) }
export const entry: RobotTrialEntry = { trial, binding, run: { ...fixtureRunningRun, state: 'completed',
  observationProfile: fixtureSimulation.observationProfile,
  policyId: fixtureSimulation.policyId, policySha256: fixtureSimulation.policyHash,
  spec: { ...fixtureRunningRun.spec, ...trial.recipe.spec, backend: 'cpu', clip: fixtureProject.clip, projectSnapshot: fixtureProject } } }
export const evaluation: RobotEvaluation = { id: 'evaluation-one' as RobotEvaluation['id'], createdAt: '2026-09-05', evaluatedAt: '2026-09-05',
  policyId: fixtureSimulation.policyId, policyHash: fixtureSimulation.policyHash,
  spec: { ...trial.recipe.evaluation, policyId: fixtureSimulation.policyId },
  physics: fixturePhysics, observationProfile: fixtureSimulation.observationProfile, passed: false, limitations: ['Simulation only'],
  episodes: [{ seed: 17, steps: 50, terminated: true, reward: 99, uprightFraction: 0.7, poseRmse: 0.2, bamSettings: {} }] }
export const reflection: RobotReflection = { version: 1, id: 'reflection-one' as RobotReflection['id'], createdAt: '2026-09-05',
  trialId: trial.id, trialSha256: trial.sha256, runId: binding.runId, evaluationId: evaluation.id, reportSha256: 'c'.repeat(64),
  policyHash: evaluation.policyHash, sha256: 'd'.repeat(64), observation: 'The episode terminated after 50 steps.',
  interpretation: 'The motion may be too large.', nextChange: 'Reduce move size again.' }

export function learningSnapshot(): LabSnapshot {
  const snapshot = readySnapshot()
  return { ...snapshot, policies: snapshot.policies.map(policy => ({ ...policy, runId: binding.runId })),
    projects: [fixtureProject], trials: [entry], runs: [entry.run!],
    evaluations: [evaluation], reflections: [reflection] }
}
