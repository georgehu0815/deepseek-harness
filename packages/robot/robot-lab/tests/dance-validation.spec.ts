import { describe, expect, it } from 'vitest'
import { validateDanceCriteria, validateRobotRequest, type RobotDanceCriteria } from '../src/index.ts'

function criteria(): RobotDanceCriteria {
  return { version: 1, requiredCycles: 2, minPassedEpisodeFraction: 0.8,
    maxJointRmseRad: Array<number>(14).fill(0.1), maxRootOrientationRmseRad: 0.2,
    movingJointIndices: [0, 1], minReferenceExcursionRad: 0.01,
    minAmplitudeRatio: 0.5, maxAmplitudeRatio: 1.5, minReferenceGainRatio: 0.4,
    maxHorizontalDriftMeters: 0.2 }
}
const evaluation = { episodes: 5, stepsPerEpisode: 2000, seed: 1, maxTerminations: 0, minMeanUprightFraction: 0.9 }
function request(dance: unknown, operation: 'evaluate' | 'save_trial') {
  return operation === 'evaluate'
    ? { operation, spec: { ...evaluation, policyId: 'shipped:alpha_stand', dance } }
    : { operation, recipe: { evaluation: { ...evaluation, dance }, parentReflectionId: null,
      brief: { goal: 'Repeat the target', prediction: 'Two cycles', plannedChange: 'Phase tracking', evidence: 'Measure gain' },
      spec: { projectRevisionId: 'revision-00000000-0000-4000-8000-000000000001', name: 'Dance test', behaviorId: 'imitate',
        steps: 256, envs: 1, seed: 1, actuator: 'bam', weights: {}, clip: null } } }
}

describe('explicit choreography criteria', () => {
  it.each([1, 2] as const)('preserves explicit v%s criteria through direct and guided JSON requests', (version) => {
    const value = { ...criteria(), version }
    expect(validateDanceCriteria(value)).toBe(value)
    for (const operation of ['evaluate', 'save_trial'] as const) expect(validateRobotRequest(request(value, operation)).operation).toBe(operation)
  })
  it.each(['evaluate', 'save_trial'] as const)('rejects explicit missing/null criteria on %s', (operation) => {
    for (const value of [undefined, null, [], {}, true]) expect(() => validateRobotRequest(request(value, operation))).toThrow('dance criteria')
  })
  it.each([
    ['version', 3], ['requiredCycles', 0], ['requiredCycles', 1.5], ['requiredCycles', Infinity],
    ['minPassedEpisodeFraction', 0], ['minPassedEpisodeFraction', 1.01], ['maxJointRmseRad', [0.1]],
    ['maxJointRmseRad', Array<number>(14).fill(NaN)], ['maxRootOrientationRmseRad', -1],
    ['movingJointIndices', []], ['movingJointIndices', [1, 1]], ['movingJointIndices', [14]],
    ['movingJointIndices', [0.5]], ['movingJointIndices', ['0']], ['minReferenceExcursionRad', 0],
    ['minAmplitudeRatio', 0], ['maxAmplitudeRatio', 0.1], ['minReferenceGainRatio', 0],
    ['maxHorizontalDriftMeters', -1], ['maxHorizontalDriftMeters', true], ['unsupported', 1],
  ])('rejects invalid %s through direct and guided request paths', (key, value) => {
    const invalid = { ...criteria(), [key]: value }
    for (const operation of ['evaluate', 'save_trial'] as const) expect(() => validateRobotRequest(request(invalid, operation))).toThrow('dance criteria')
  })
  it('rejects omitted thresholds instead of treating them as zero', () => {
    const { minReferenceGainRatio: _gain, ...missing } = criteria()
    expect(() => validateDanceCriteria(missing)).toThrow('missing or unsupported')
  })
  it('retains the legacy evaluation request when dance was not requested', () => {
    const value = { operation: 'evaluate', spec: { ...evaluation, policyId: 'shipped:alpha_stand' } }
    expect(validateRobotRequest(value)).toBe(value)
  })
})
