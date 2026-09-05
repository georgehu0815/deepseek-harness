import { describe, expect, it } from 'vitest'
import { validateRobotRequest } from '../src/index.ts'

const id = '00000000-0000-0000-0000-000000000000'
function recipe() {
  return { spec: { projectRevisionId: `revision-${id}`, name: 'Trial', behaviorId: 'stand', steps: 32, envs: 1,
    seed: 0, actuator: 'bam', weights: {}, clip: null },
  brief: { goal: 'Stand', prediction: 'Remain upright', plannedChange: 'Reduce movement', evidence: 'Measure upright fraction' },
  evaluation: { episodes: 2, stepsPerEpisode: 32, seed: 1, maxTerminations: 0, minMeanUprightFraction: 0.9 }, parentReflectionId: null }
}

describe('public learning requests', () => {
  it('requires four text plans and freezes guided project selection without provider snapshots', () => {
    const request = { operation: 'save_trial', recipe: recipe() }
    expect(validateRobotRequest(request)).toBe(request)
    expect(validateRobotRequest({ ...request, recipe: { ...recipe(), parentReflectionId: `reflection-${id}` } })).toBeDefined()
  })
  it.each([
    { recipe: null }, { recipe: { ...recipe(), extra: true } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, projectSnapshot: {} } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, clip: {} } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, projectRevisionId: '../foreign' } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, backend: 'cuda' } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, steps: Infinity } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, envs: 1.5 } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, weights: [] } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, weights: { upright: -1 } } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, seed: -1 } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, actuator: 'hardware' } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, name: '鸭鸭' } } },
    { recipe: { ...recipe(), spec: { ...recipe().spec, behaviorId: '' } } },
    { recipe: { ...recipe(), brief: { ...recipe().brief, evidence: [] } } },
    { recipe: { ...recipe(), brief: { ...recipe().brief, evidence: ' ' } } },
    { recipe: { ...recipe(), brief: { ...recipe().brief, goal: '\u0000' } } },
    { recipe: { ...recipe(), evaluation: { ...recipe().evaluation, policyId: 'run:any' } } },
    { recipe: { ...recipe(), evaluation: { ...recipe().evaluation, seed: 2147483647 } } },
    { recipe: { ...recipe(), evaluation: { ...recipe().evaluation, maxTerminations: 3 } } },
    { recipe: { ...recipe(), evaluation: { ...recipe().evaluation, minMeanUprightFraction: 1.1 } } },
    { recipe: { ...recipe(), parentReflectionId: '../foreign' } },
  ])('rejects malformed nested trial fields %#', (patch) => {
    expect(() => validateRobotRequest({ operation: 'save_trial', ...patch })).toThrow()
  })
  it.each(['trials', 'evaluations', 'reflections'])('accepts bounded history operation %s without caller storage paths', (operation) => {
    expect(validateRobotRequest({ operation })).toEqual({ operation })
    expect(() => validateRobotRequest({ operation, root: '/foreign' })).toThrow()
  })
  it.each(['train_trial', 'evaluate_trial'])('requires trial identity for %s', (operation) => {
    expect(validateRobotRequest({ operation, trialId: `trial-${id}` })).toBeDefined()
    expect(() => validateRobotRequest({ operation, trialId: `run-${id}` })).toThrow()
  })
  it('separates actual reflection evidence from the earlier plan', () => {
    const reflection = { trialId: `trial-${id}`, evaluationId: `eval-${id}`, observation: 'Fell', interpretation: 'Too large', nextChange: 'Reduce move size' }
    expect(validateRobotRequest({ operation: 'save_reflection', reflection })).toBeDefined()
    for (const patch of [{ observation: '' }, { policyHash: 'caller' }, { evaluationId: '../escape' }]) {
      expect(() => validateRobotRequest({ operation: 'save_reflection', reflection: { ...reflection, ...patch } })).toThrow()
    }
  })
  it('replay accepts only a report identity and nonnegative episode index', () => {
    expect(validateRobotRequest({ operation: 'replay_evaluation', evaluationId: `eval-${id}`, episodeIndex: 0 })).toBeDefined()
    for (const episodeIndex of [-1, 0.5, NaN, '0']) expect(() => validateRobotRequest({ operation: 'replay_evaluation', evaluationId: `eval-${id}`, episodeIndex })).toThrow()
    expect(() => validateRobotRequest({ operation: 'replay_evaluation', evaluationId: `eval-${id}`, episodeIndex: 0, seed: 4 })).toThrow()
  })
})
