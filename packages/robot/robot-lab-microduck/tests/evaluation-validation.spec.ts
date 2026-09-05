import { describe, expect, it } from 'vitest'
import type { RobotEvaluation } from '@deepseek-ai/dsh-robot-lab'
import {
  computeEvaluationPass, evaluationReachedFullHorizon, validateEvaluationAdmission, validateEvaluationReport,
} from '../src/evaluation-validation.ts'

const limits = { maxEvaluationEpisodes: 4, maxSimulationSteps: 100 }
const evaluationId = 'eval-12345678-1234-4567-89ab-123456789abc'
const policyId = 'run:run-12345678-1234-4567-89ab-123456789abc'
function request() {
  return {
    id: evaluationId, createdAt: '2026-09-04T12:00:00.123456+00:00', policyId, policyHash: 'a'.repeat(64),
    spec: { policyId, episodes: 2, stepsPerEpisode: 100, seed: 42, maxTerminations: 1, minMeanUprightFraction: 0.75 },
    physics: { actuator: 'bam', bam: { source: 'fallback', parameters: { kp: 1, kd: 0.5 }, sha256: 'b'.repeat(64) },
      observationNoise: false, actionDelay: true, domainRandomization: false, randomYaw: false },
    observationProfile: 'microduck-standard-61',
  }
}
function fixture() {
  const admission = validateEvaluationAdmission(request(), limits)
  const report: RobotEvaluation = {
    ...structuredClone(admission), evaluatedAt: '2026-09-04T12:00:01.123456Z',
    episodes: [
      { seed: 42, steps: 100, terminated: false, reward: -1.5, uprightFraction: 1, poseRmse: null, bamSettings: { delay: null, kp: 1 } },
      { seed: 43, steps: 20, terminated: true, reward: 2.5, uprightFraction: 0.5, poseRmse: 0.25, bamSettings: {} },
    ],
    passed: true, limitations: ['Local evaluation, not hardware approval.', '确定性评估 🦆'],
  }
  return { admission, report }
}
function replace(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let row = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
  row[keys.at(-1)!] = replacement
}
function remove(value: unknown, path: string): void {
  const keys = path.split('.')
  let row = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
  Reflect.deleteProperty(row, keys.at(-1)!)
}

describe('immutable evaluation admissions', () => {
  it('accepts Python timestamps, fixed BAM provenance and the exact seed ceiling without rehashing', () => {
    const admission = request()
    admission.spec.seed = 2147483647 - admission.spec.episodes
    expect(validateEvaluationAdmission(admission, limits)).toBe(admission)
  })

  it.each(['shipped:alpha_stand', 'shipped:alpha_walking'])('accepts supported shipped policy %s', (id) => {
    const admission = request()
    admission.policyId = admission.spec.policyId = id
    expect(validateEvaluationAdmission(admission, limits).policyId).toBe(id)
    admission.observationProfile = 'microduck-lab-body-phase-61'
    expect(() => validateEvaluationAdmission(admission, limits)).toThrow('standard observationProfile')
  })

  it('accepts the phase observation profile on owned run policies', () => {
    const admission = request()
    admission.observationProfile = 'microduck-lab-body-phase-61'
    expect(validateEvaluationAdmission(admission, limits).observationProfile).toBe(admission.observationProfile)
  })

  it.each([
    ['id', '../eval-12345678-1234-4567-89ab-123456789abc'], ['id', evaluationId.toUpperCase()],
    ['id', 'eval-123456781234456789ab123456789abc'], ['id', `${evaluationId}\n`], ['id', 1],
    ['policyId', 'run:../elsewhere'], ['policyId', 'run:run-------------------------------------'],
    ['policyId', 'shipped:unsupported'], ['policyId', 'run:12345678-1234-4567-89ab-123456789abc'],
    ['policyHash', 'a'.repeat(63)], ['policyHash', 'A'.repeat(64)], ['policyHash', null],
    ['createdAt', '2026-09-04T12:00:00'], ['createdAt', '2026-02-30T12:00:00Z'],
    ['createdAt', '2026-09-04T24:00:00Z'], ['createdAt', '2026-09-04T12:00:00+24:00'],
    ['createdAt', '2026-09-04T12:00:00+00:60'], ['createdAt', '0000-01-01T00:00:00Z'],
    ['createdAt', 1], ['createdAt', 'yesterday'], ['observationProfile', 'unknown'],
    ['spec', null], ['spec', []], ['spec.policyId', 'shipped:alpha_stand'], ['spec.extra', 1],
    ['spec.episodes', 0], ['spec.episodes', 5], ['spec.episodes', 1.5], ['spec.episodes', true],
    ['spec.stepsPerEpisode', 0], ['spec.stepsPerEpisode', 101], ['spec.stepsPerEpisode', 1.5],
    ['spec.seed', -1], ['spec.seed', 2147483646], ['spec.seed', 0.5], ['spec.seed', '42'],
    ['spec.maxTerminations', -1], ['spec.maxTerminations', 3], ['spec.maxTerminations', 0.5],
    ['spec.minMeanUprightFraction', -0.01], ['spec.minMeanUprightFraction', 1.01], ['spec.minMeanUprightFraction', NaN],
    ['physics.actuator', 'xml'], ['physics.observationNoise', true], ['physics.actionDelay', false],
    ['physics.domainRandomization', true], ['physics.randomYaw', true], ['physics.extra', false],
    ['physics.bam', []], ['physics.bam.extra', 1], ['physics.bam.source', null],
    ['physics.bam.sha256', 'bad'], ['physics.bam.parameters', []], ['physics.bam.parameters.kp', null],
    ['physics.bam.parameters.kp', Infinity], ['physics.bam.parameters.kp', {}], ['extra', 'unexpected'],
  ])('rejects invalid %s = %s', (path, value) => {
    const admission = request()
    replace(admission, path, value)
    expect(() => validateEvaluationAdmission(admission, limits)).toThrow('Invalid MicroDuck evaluation')
  })

  it.each(['id', 'createdAt', 'policyId', 'policyHash', 'spec', 'physics', 'observationProfile',
    'spec.policyId', 'spec.episodes', 'spec.stepsPerEpisode', 'spec.seed', 'spec.maxTerminations', 'spec.minMeanUprightFraction',
    'physics.actuator', 'physics.bam', 'physics.observationNoise', 'physics.actionDelay', 'physics.domainRandomization',
    'physics.randomYaw', 'physics.bam.source', 'physics.bam.parameters', 'physics.bam.sha256'])('rejects missing %s', (path) => {
    const admission = request()
    remove(admission, path)
    expect(() => validateEvaluationAdmission(admission, limits)).toThrow('missing fields')
  })

  it.each([null, [], true, 'request', new Date()])('rejects non-record admission %s', (value) => {
    expect(() => validateEvaluationAdmission(value, limits)).toThrow('object')
  })
})

describe('paired evaluation reports', () => {
  it('preserves a complete report and permits early termination', () => {
    const { admission, report } = fixture()
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
    expect(computeEvaluationPass(admission.spec, report.episodes)).toBe(true)
  })

  it('compares nested admission fields independently of JSON property order', () => {
    const { admission, report } = fixture()
    report.physics.bam.parameters = { kd: 0.5, kp: 1 }
    report.spec = Object.fromEntries(Object.entries(report.spec).reverse()) as unknown as typeof report.spec
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
  })

  it.each([
    ['id', 'eval-87654321-1234-4567-89ab-123456789abc'], ['createdAt', '2026-09-04T11:59:00Z'],
    ['policyHash', 'c'.repeat(64)], ['observationProfile', 'microduck-lab-body-phase-61'],
    ['spec.seed', 41], ['spec.episodes', 3], ['spec.stepsPerEpisode', 99], ['spec.maxTerminations', 0],
    ['spec.minMeanUprightFraction', 0.25], ['physics.bam.source', 'alternate'],
    ['physics.bam.sha256', 'c'.repeat(64)], ['physics.bam.parameters.kp', 2], ['physics.bam.parameters.extra', 1],
  ])('rejects a schema-valid report with altered admission field %s', (path, value) => {
    const { admission, report } = fixture()
    replace(report, path, value)
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('differ from admission')
  })

  it('rejects a report paired with a different supported policy even if the nested policy matches', () => {
    const { admission, report } = fixture()
    replace(report, 'policyId', 'shipped:alpha_stand')
    replace(report, 'spec.policyId', 'shipped:alpha_stand')
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('differ from admission')
  })

  it.each([
    ['episodes', []], ['episodes', null], ['episodes.0', null], ['episodes.0.extra', 1],
    ['episodes.0.seed', 43], ['episodes.1.seed', 42], ['episodes.0.seed', '42'],
    ['episodes.0.steps', 0], ['episodes.0.steps', 101], ['episodes.0.steps', 99.5],
    ['episodes.1.steps', 0], ['episodes.1.steps', 101], ['episodes.0.terminated', 1],
    ['episodes.0.reward', Infinity], ['episodes.0.reward', NaN], ['episodes.0.reward', '1'],
    ['episodes.0.uprightFraction', -0.01], ['episodes.0.uprightFraction', 1.01], ['episodes.0.uprightFraction', null],
    ['episodes.0.poseRmse', -1], ['episodes.0.poseRmse', Infinity], ['episodes.0.poseRmse', '0'],
    ['episodes.0.bamSettings', []], ['episodes.0.bamSettings', null], ['episodes.0.bamSettings.kp', NaN],
    ['episodes.0.bamSettings.kp', '1'], ['episodes.0.bamSettings.kp', {}],
    ['passed', false], ['passed', 1], ['limitations', 'not an array'], ['limitations', [null]],
    ['evaluatedAt', '2026-09-04T12:00:01'], ['evaluatedAt', '2026-09-04T11:00:00Z'],
    ['evaluatedAt', '2026-09-04T12:00:00.123455Z'], ['extra', true],
  ])('rejects malformed or incomplete report %s = %s', (path, value) => {
    const { admission, report } = fixture()
    replace(report, path, value)
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('Invalid MicroDuck evaluation')
  })

  it.each(['id', 'createdAt', 'policyId', 'policyHash', 'spec', 'physics', 'observationProfile',
    'episodes', 'passed', 'limitations', 'evaluatedAt', 'episodes.0.seed', 'episodes.0.steps', 'episodes.0.terminated',
    'episodes.0.reward', 'episodes.0.uprightFraction', 'episodes.0.poseRmse', 'episodes.0.bamSettings'])('rejects a report missing %s', (path) => {
    const { admission, report } = fixture()
    remove(report, path)
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('missing fields')
  })

  it('rejects missing, extra, duplicated and reordered episodes', () => {
    for (const order of [[0], [0, 1, 1], [0, 0], [1, 0]]) {
      const { admission, report } = fixture()
      report.episodes = order.map(index => report.episodes[index]!)
      expect(() => validateEvaluationReport(admission, report, limits)).toThrow()
    }
  })

  it.each(['2026-09-04T13:00:00.123456+01:00', '2026-09-04T07:00:00.123456-05:00',
    '2026-09-04T12:00:00.123457Z'])('orders timezone-aware timestamps at Python precision: %s', (timestamp) => {
    const { admission, report } = fixture()
    report.evaluatedAt = timestamp
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
  })

  it('applies limits to the report admission as well as the request', () => {
    const { admission, report } = fixture()
    expect(() => validateEvaluationReport(admission, report, { ...limits, maxEvaluationEpisodes: 1 })).toThrow('spec.episodes')
    expect(() => validateEvaluationReport(admission, report, { ...limits, maxSimulationSteps: 99 })).toThrow('spec.stepsPerEpisode')
  })

  it.each(['termination count', 'mean upright fraction'])('accepts a computed failed evaluation for %s and rejects a forged pass', (reason) => {
    const { admission, report } = fixture()
    if (reason === 'termination count') report.episodes[0]!.terminated = true
    else report.episodes[0]!.uprightFraction = 0.99
    report.passed = false
    expect(computeEvaluationPass(admission.spec, report.episodes)).toBe(false)
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
    report.passed = true
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('computed criteria')
  })

  it('accepts zero pose error, finite BAM samples and an empty limitations array', () => {
    const { admission, report } = fixture()
    report.episodes[0]!.poseRmse = 0
    report.episodes[0]!.bamSettings = { positive: 1.5, zero: 0, negative: -1, absent: null }
    report.limitations = []
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
  })

  it('validates a nonterminated episode short of the horizon but classifies it as incomplete', () => {
    const { admission, report } = fixture()
    expect(evaluationReachedFullHorizon(validateEvaluationReport(admission, report, limits))).toBe(true)
    report.episodes[0]!.steps = 99
    expect(evaluationReachedFullHorizon(validateEvaluationReport(admission, report, limits))).toBe(false)
  })
})
