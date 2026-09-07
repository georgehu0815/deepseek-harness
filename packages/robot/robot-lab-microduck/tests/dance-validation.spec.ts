import { describe, expect, it } from 'vitest'
import type { RobotDanceEpisode, RobotDancePlan, RobotDanceWindow, RobotEvaluation, RobotTrial } from '@deepseek-ai/dsh-robot-lab'
import { computeDanceStatus, validateDanceEpisode, validateDancePlan } from '../src/dance-validation.ts'
import { validateEvaluationAdmission, validateEvaluationReport } from '../src/evaluation-validation.ts'
import { parseReply } from '../src/reply.ts'
import { learningProject, learningRecipe, learningRun } from './learning-fixtures.ts'

const limits = { maxEvaluationEpisodes: 4, maxSimulationSteps: 2000, maxClipKeys: 100,
  maxClipSeconds: 60, maxProjects: 10, maxProjectBlocks: 8 }
function plan(version: 1 | 2 = 1): RobotDancePlan {
  return {
    version,
    evaluation: { episodes: 2, stepsPerEpisode: 20, seed: 42, maxTerminations: 0, minMeanUprightFraction: 0.8,
      dance: { version, requiredCycles: 2, minPassedEpisodeFraction: 1, maxJointRmseRad: Array<number>(14).fill(0.2),
        maxRootOrientationRmseRad: 0.2, movingJointIndices: [0], minReferenceExcursionRad: 0.01,
        minAmplitudeRatio: 0.5, maxAmplitudeRatio: 1.5, minReferenceGainRatio: 0.5, maxHorizontalDriftMeters: 0.1 } },
    reference: { clipSha256: 'a'.repeat(64), sampledSha256: 'b'.repeat(64), jointNames: Array.from({ length: 14 }, (_, i) => `joint-${i}`),
      rootBody: 'root', rootConvention: 'initial-heading-world-up-pitch-v1', authoredDurationSeconds: 0.2,
      controlDtSeconds: 0.02, cycleSteps: 10, cycleSeconds: 0.2, loop: true,
      blocks: [{ index: 0, startStep: 0, endStep: 5, activeJointIndices: [0] },
        { index: 1, startStep: 5, endStep: 10, activeJointIndices: [] }] },
    evaluatorSha256: 'c'.repeat(64), sourceFingerprint: 'd'.repeat(64), sha256: 'e'.repeat(64),
    physics: { actuator: 'bam', bam: { source: 'fallback', parameters: { kt: 0.36, damping: 0.1 }, sha256: '1'.repeat(64) },
      observationNoise: false, actionDelay: true, domainRandomization: false, randomYaw: false },
    runtimeVersions: { mujoco: '3.10.0' }, environment: { behaviorId: 'imitate', weights: { travel: 0, pose: 1 } },
  }
}
function window(index: number, steps: number, active = true): RobotDanceWindow {
  const ratios = Array<number | null>(14).fill(null)
  if (active) ratios[0] = 1
  return { index, steps, measuredSteps: steps, complete: true, jointRmseRad: Array<number>(14).fill(0.1), rootOrientationRmseRad: 0.1,
    amplitudeRatio: [...ratios], referenceGainRatio: [...ratios], maxHorizontalDriftMeters: 0.01, status: 'passed', reasons: [] }
}
function dance(): RobotDanceEpisode {
  return { completedCycles: 2, terminated: false, truncated: false, status: 'passed', reasons: [],
    cycles: [0, 1].map(index => ({ ...window(index, 10), blocks: [window(0, 5), window(1, 5, false)] })) }
}
function fixture(version: 1 | 2 = 1) {
  const dancePlan = plan(version)
  const policyId = 'run:run-12345678-1234-4567-89ab-123456789abc'
  const admission = validateEvaluationAdmission({ id: 'eval-12345678-1234-4567-89ab-123456789abc',
    createdAt: '2026-09-04T12:00:00Z', policyId, policyHash: 'f'.repeat(64),
    spec: { policyId, ...structuredClone(dancePlan.evaluation) }, physics: structuredClone(dancePlan.physics),
    observationProfile: 'microduck-lab-body-phase-61', dancePlan }, limits)
  const report: RobotEvaluation = { ...structuredClone(admission), danceStatus: 'passed', evaluatedAt: '2026-09-04T12:00:01Z',
    passed: true, limitations: [], episodes: [0, 1].map(index => ({ seed: 42 + index, steps: 20, terminated: false,
      reward: 1, uprightFraction: 1, poseRmse: 0.1, bamSettings: {}, dance: dance() })) }
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
function failedWindow(value: RobotDanceWindow, reason: string): void { value.status = 'failed'; value.reasons = [reason] }
function unmeasured(value: RobotDanceWindow): void {
  value.measuredSteps = 0; value.complete = false; value.jointRmseRad = null; value.rootOrientationRmseRad = null
  value.maxHorizontalDriftMeters = null; value.amplitudeRatio.fill(null); value.referenceGainRatio.fill(null)
  value.status = 'incomplete'; value.reasons = ['missing-measurements', 'incomplete-window']
}

describe('frozen dance plans', () => {
  it.each([1, 2] as const)('accepts matching v%s plan and criteria without changing their identity', (version) => {
    const value: unknown = JSON.parse(JSON.stringify(plan(version)))
    expect(validateDancePlan(value, limits)).toBe(value)
  })
  it.each([1, 2] as const)('rejects v%s plans with the other criteria version', (version) => {
    const input: unknown = JSON.parse(JSON.stringify(plan(version)))
    replace(input, 'evaluation.dance.version', version === 1 ? 2 : 1)
    expect(() => validateDancePlan(input, limits)).toThrow('plan.version must match criteria.version')
  })
  it('preserves opaque Python digests and decimal clocks without rehashing', () => {
    const value = plan()
    value.reference.cycleSeconds += 1e-12
    expect(validateDancePlan(value, limits)).toBe(value)
  })
  it('accepts one nonlooping cycle and rejects an endpoint-hold tail', () => {
    const value = plan()
    value.reference.loop = false; value.evaluation.dance.requiredCycles = 1
    value.evaluation.stepsPerEpisode = value.reference.cycleSteps
    expect(validateDancePlan(value, limits)).toBe(value)
    value.evaluation.stepsPerEpisode++
    expect(() => validateDancePlan(value, limits)).toThrow('endpoint-hold tail')
  })
  it.each([
    ['version', 3], ['evaluation.dance.version', 3], ['sha256', 'x'.repeat(64)], ['evaluatorSha256', 'C'.repeat(64)], ['sourceFingerprint', 'a'.repeat(63)],
    ['reference.clipSha256', 'a'.repeat(64) + '\n'], ['reference.sampledSha256', 42], ['reference.jointNames', ['one']],
    ['reference.jointNames.1', 'joint-0'], ['reference.jointNames.1', ''], ['reference.rootBody', ''], ['reference.rootConvention', 'unknown'],
    ['reference.controlDtSeconds', 0], ['reference.controlDtSeconds', Number.MAX_VALUE],
    ['reference.cycleSeconds', 0.21], ['reference.cycleSteps', 2.5],
    ['reference.authoredDurationSeconds', NaN], ['reference.loop', false], ['reference.blocks', []],
    ['reference.blocks.0.startStep', 1], ['reference.blocks.0.endStep', 11], ['reference.blocks.1.index', 0],
    ['reference.blocks.1.endStep', 9], ['reference.blocks.1.activeJointIndices', [0, 0]], ['reference.blocks.1.activeJointIndices', [14]],
    ['physics.actuator', 'xml'], ['physics.observationNoise', true], ['physics.actionDelay', false], ['physics.domainRandomization', true],
    ['physics.randomYaw', true], ['physics.bam.sha256', 'invalid'], ['physics.bam.parameters.kt', Infinity],
    ['environment.weights.pose', -1], ['environment.behaviorId', ''], ['runtimeVersions.mujoco', 3],
    ['evaluation.policyId', 'shipped:alpha_stand'], ['evaluation.episodes', 5], ['evaluation.stepsPerEpisode', 2001],
    ['evaluation.stepsPerEpisode', 19], ['evaluation.seed', 2147483647], ['evaluation.maxTerminations', 3],
    ['evaluation.minMeanUprightFraction', 2], ['evaluation.dance.maxJointRmseRad', [1]], ['evaluation.dance.extra', 1],
    ['extra', true], ['reference.extra', true], ['environment.extra', true], ['physics.extra', true], ['physics.bam.extra', true],
  ])('rejects malformed plan %s', (path, value) => {
    const input = plan(); replace(input, path, value)
    expect(() => validateDancePlan(input, limits)).toThrow()
  })
  it.each(['version', 'evaluation', 'reference', 'evaluatorSha256', 'sourceFingerprint', 'physics', 'runtimeVersions', 'environment', 'sha256',
    'evaluation.dance', 'reference.sampledSha256', 'reference.blocks.0.activeJointIndices', 'physics.bam.sha256'])('rejects a missing plan field %s', (path) => {
    const input = plan(); remove(input, path)
    expect(() => validateDancePlan(input, limits)).toThrow()
  })
  it.each([null, [], true, new Date()])('rejects non-JSON plan %s', (input) => {
    expect(() => validateDancePlan(input, limits)).toThrow()
  })
})

describe('dance admission and report binding', () => {
  it.each([1, 2] as const)('accepts v%s full cycle and inactive block metrics through durable and process parsers', (version) => {
    const { admission, report } = fixture(version)
    expect(validateEvaluationReport(admission, report, limits)).toBe(report)
    expect(parseReply(JSON.stringify({ operation: 'evaluate', evaluation: report }), limits)).toEqual({ operation: 'evaluate', evaluation: report })
    expect(() => parseReply(JSON.stringify({ operation: 'evaluate', evaluation: report }))).toThrow('explicit evaluation')
  })
  it.each(['dancePlan', 'dancePlan.reference', 'spec.dance'])('rejects admission missing %s', (path) => {
    const { admission } = fixture(); remove(admission, path)
    expect(() => validateEvaluationAdmission(admission, limits)).toThrow()
  })
  it.each(['dancePlan', 'danceStatus', 'episodes.0.dance'])('rejects report missing %s', (path) => {
    const { admission, report } = fixture(); remove(report, path)
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow()
  })
  it.each([
    ['dancePlan.evaluation.dance.minAmplitudeRatio', 0.6], ['dancePlan.evaluation.seed', 41],
    ['dancePlan.physics.bam.parameters.kt', 0.4], ['dancePlan.physics.bam.sha256', '2'.repeat(64)],
  ])('rejects plan mismatch %s at admission', (path, value) => {
    const { admission } = fixture(); replace(admission, path, value)
    expect(() => validateEvaluationAdmission(admission, limits)).toThrow('differs')
  })
  it('compares exact plan metadata with the admission even if the Python checksum is unchanged', () => {
    const { admission, report } = fixture(); report.dancePlan!.reference.clipSha256 = '9'.repeat(64)
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('differ from admission')
  })
  it.each([1, 2] as const)('rejects a changed v%s frozen assessment even with the same plan checksum', (version) => {
    const { admission, report } = fixture(version)
    const otherVersion = version === 1 ? 2 : 1
    const changed: unknown = JSON.parse(JSON.stringify(report))
    replace(changed, 'spec.dance.version', otherVersion)
    replace(changed, 'dancePlan.version', otherVersion)
    replace(changed, 'dancePlan.evaluation.dance.version', otherVersion)
    expect(parseReply(JSON.stringify({ operation: 'evaluate', evaluation: changed }), limits).operation).toBe('evaluate')
    expect(() => validateEvaluationReport(admission, changed, limits)).toThrow('differ from admission')
    expect(admission.dancePlan!.version).toBe(version)
  })
  it('rejects unsolicited dance records for legacy evaluation requests', () => {
    const { admission, report } = fixture(); delete admission.spec.dance; delete admission.dancePlan
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow()
  })
  it('keeps passed balance-only when dance fails', () => {
    const { admission, report } = fixture()
    const first = report.episodes[0]!.dance!
    first.cycles[0]!.jointRmseRad![13] = 0.3; failedWindow(first.cycles[0]!, 'joint-rmse')
    first.status = 'failed'; first.reasons = ['joint-rmse']; report.danceStatus = 'failed'
    expect(validateEvaluationReport(admission, report, limits).passed).toBe(true)
    report.danceStatus = 'passed'
    expect(() => validateEvaluationReport(admission, report, limits)).toThrow('danceStatus')
  })
})

describe('measured dance windows', () => {
  it.each([
    ['cycles', []], ['completedCycles', 1], ['terminated', true], ['truncated', null], ['extra', true],
    ['cycles.0.index', 1], ['cycles.0.steps', 9], ['cycles.0.measuredSteps', 11], ['cycles.0.measuredSteps', 0.5],
    ['cycles.0.complete', false], ['cycles.0.jointRmseRad', [0]], ['cycles.0.jointRmseRad.0', NaN],
    ['cycles.0.rootOrientationRmseRad', null], ['cycles.0.maxHorizontalDriftMeters', Infinity], ['cycles.0.amplitudeRatio', [null]],
    ['cycles.0.amplitudeRatio.0', -1], ['cycles.0.referenceGainRatio.0', Infinity], ['cycles.0.amplitudeRatio.0', null],
    ['cycles.0.blocks', []], ['cycles.0.blocks.1.amplitudeRatio.0', 1], ['cycles.0.status', 'failed'], ['cycles.0.reasons', ['unknown']],
    ['cycles.0.reasons', ['joint-rmse', 'joint-rmse']], ['status', 'incomplete'], ['reasons', ['unknown']],
    ['cycles.0.extra', true], ['cycles.0.blocks.0.extra', true],
  ])('rejects corrupt raw metric or forged verdict %s', (path, value) => {
    const input = dance(); replace(input, path, value)
    expect(() => validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toThrow()
  })
  it.each(['steps', 'measuredSteps', 'complete', 'jointRmseRad', 'rootOrientationRmseRad', 'amplitudeRatio', 'referenceGainRatio', 'maxHorizontalDriftMeters', 'status', 'reasons', 'blocks'])('rejects missing cycle field %s', (field) => {
    const input = dance(); remove(input, `cycles.0.${field}`)
    expect(() => validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toThrow()
  })
  it.each([
    ['jointRmseRad.13', 0.21, 'joint-rmse'], ['rootOrientationRmseRad', 0.21, 'root-rmse'],
    ['maxHorizontalDriftMeters', 0.11, 'horizontal-drift'], ['amplitudeRatio.0', 0.49, 'amplitude-ratio'],
    ['amplitudeRatio.0', 1.51, 'amplitude-ratio'], ['referenceGainRatio.0', 0.49, 'reference-gain'],
  ])('recomputes threshold failure %s at each cycle and block', (path, value, reason) => {
    for (const block of [false, true]) {
      const input = dance(); const cycle = input.cycles[1]!; const target = block ? cycle.blocks[0]! : cycle
      replace(target, path, value)
      expect(() => validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toThrow('status')
      failedWindow(target, reason); failedWindow(cycle, reason); input.status = 'failed'; input.reasons = [reason]
      expect(validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toBe(input)
    }
  })
  it('represents unavailable root and joint measurements as null rather than passing zeros', () => {
    const input = dance(); const cycle = input.cycles[1]!
    unmeasured(cycle); cycle.blocks.forEach(unmeasured)
    input.status = 'incomplete'; input.reasons = [...cycle.reasons]
    expect(validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toBe(input)
    cycle.jointRmseRad = Array<number>(14).fill(0)
    expect(() => validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toThrow('null measurements')
  })
  it('requires moving joints even when their cycle ratios are both null', () => {
    const input = dance(); const cycle = input.cycles[0]!
    cycle.amplitudeRatio[0] = null; cycle.referenceGainRatio[0] = null
    cycle.status = input.status = 'incomplete'; cycle.reasons = input.reasons = ['missing-measurements']
    expect(validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toBe(input)
  })
  it('cannot pass an early-terminated rollout or fabricate its missing cycle', () => {
    const input = dance(); input.completedCycles = 1; input.terminated = true
    const last = input.cycles[1]!
    for (const item of [last, ...last.blocks]) { unmeasured(item); item.steps = 0 }
    input.cycles[0]!.complete = false; input.cycles[0]!.status = 'incomplete'; input.cycles[0]!.reasons = ['incomplete-window']
    const boundaryBlock = input.cycles[0]!.blocks[1]!
    boundaryBlock.complete = false; boundaryBlock.status = 'incomplete'; boundaryBlock.reasons = ['incomplete-window']
    input.status = 'failed'; input.reasons = ['terminated', 'missing-measurements', 'incomplete-window']
    expect(validateDanceEpisode(input, plan(), { steps: 10, terminated: true })).toBe(input)
    input.status = 'passed'
    expect(() => validateDanceEpisode(input, plan(), { steps: 10, terminated: true })).toThrow('status')
  })
  it('accepts complete thresholds inclusively and signed low reference gain as a failure', () => {
    const input = dance(); const criteria = plan()
    criteria.evaluation.dance.maxJointRmseRad.fill(0.1); criteria.evaluation.dance.maxRootOrientationRmseRad = 0.1
    criteria.evaluation.dance.maxHorizontalDriftMeters = 0.01; criteria.evaluation.dance.minAmplitudeRatio = 1
    criteria.evaluation.dance.maxAmplitudeRatio = 1; criteria.evaluation.dance.minReferenceGainRatio = 1
    expect(validateDanceEpisode(input, criteria, { steps: 20, terminated: false })).toBe(input)
    input.cycles[0]!.referenceGainRatio[0] = -1
    failedWindow(input.cycles[0]!, 'reference-gain'); input.status = 'failed'; input.reasons = ['reference-gain']
    expect(validateDanceEpisode(input, criteria, { steps: 20, terminated: false })).toBe(input)
  })
  it('rejects aliased zero-length authored blocks at admission', () => {
    const frozen = plan()
    frozen.reference.blocks = [{ index: 0, startStep: 0, endStep: 0, activeJointIndices: [] },
      { index: 1, startStep: 0, endStep: 10, activeJointIndices: [0] }]
    expect(() => validateDancePlan(frozen, limits)).toThrow('block.endStep')
  })
  it('checks partial finite sample counts across cycle and block measurements', () => {
    const input = dance(); const cycle = input.cycles[0]!; const block = cycle.blocks[0]!
    for (const measured of [cycle, block]) {
      measured.measuredSteps--; measured.complete = false; measured.status = 'incomplete'
      measured.reasons = ['missing-measurements', 'incomplete-window']
    }
    input.status = 'incomplete'; input.reasons = [...cycle.reasons]
    expect(validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toBe(input)
    block.measuredSteps--
    expect(() => validateDanceEpisode(input, plan(), { steps: 20, terminated: false })).toThrow('block partition')
  })
  it('rejects early truncation even after all required cycles have completed', () => {
    const frozen = plan(); frozen.evaluation.stepsPerEpisode = 30
    const input = dance()
    expect(() => validateDanceEpisode(input, frozen, { steps: 20, terminated: false })).toThrow('must be truncated')
    input.truncated = true; input.status = 'failed'; input.reasons = ['early-truncated']
    expect(validateDanceEpisode(input, frozen, { steps: 20, terminated: false })).toBe(input)
    input.status = 'passed'; input.reasons = []
    expect(() => validateDanceEpisode(input, frozen, { steps: 20, terminated: false })).toThrow('status')
  })
  it('records coverage beyond the required cycles while retaining exactly the requested windows', () => {
    const frozen = plan(); frozen.evaluation.stepsPerEpisode = 30
    const input = dance(); input.completedCycles = 3
    expect(validateDanceEpisode(input, frozen, { steps: 30, terminated: false })).toBe(input)
    input.cycles.push({ ...window(2, 10), blocks: [] })
    expect(() => validateDanceEpisode(input, frozen, { steps: 30, terminated: false })).toThrow('array length')
  })
  it('uses conservative episode fractions without conflating missing measurements and failures', () => {
    const criteria = plan().evaluation.dance
    const pass = dance(); const fail = dance(); fail.status = 'failed'
    const incomplete = dance(); incomplete.status = 'incomplete'
    expect(computeDanceStatus(criteria, [pass, incomplete])).toBe('incomplete')
    expect(computeDanceStatus(criteria, [fail, incomplete])).toBe('failed')
    criteria.minPassedEpisodeFraction = 0.5
    expect(computeDanceStatus(criteria, [pass, incomplete])).toBe('passed')
  })
})

describe('versioned partial-measurement scoring', () => {
  function sampled(version: 1 | 2, measuredSteps: number, steps = 100) {
    const frozen = plan(version)
    frozen.evaluation.stepsPerEpisode = frozen.reference.cycleSteps = 100
    frozen.evaluation.dance.requiredCycles = 1
    frozen.evaluation.dance.minAmplitudeRatio = frozen.evaluation.dance.minReferenceGainRatio = 0.8
    frozen.evaluation.dance.maxAmplitudeRatio = 1.2
    frozen.reference.authoredDurationSeconds = frozen.reference.cycleSeconds = 2
    frozen.reference.blocks = [{ index: 0, startStep: 0, endStep: 100, activeJointIndices: [0] }]
    const block = window(0, steps)
    block.measuredSteps = measuredSteps
    if (measuredSteps === 0) unmeasured(block)
    else if (measuredSteps < 100) {
      block.complete = false; block.status = 'incomplete'
      block.reasons = steps > measuredSteps ? ['incomplete-window', 'missing-measurements'] : ['incomplete-window']
    }
    const cycle = { ...structuredClone(block), blocks: [block] }
    const input: RobotDanceEpisode = { completedCycles: Math.floor(steps / 100), terminated: false, truncated: steps < 100,
      cycles: [cycle], status: cycle.status, reasons: [...cycle.reasons] }
    if (steps < 100) { input.status = 'failed'; input.reasons.push('early-truncated') }
    const decoded: unknown = JSON.parse(JSON.stringify(frozen))
    return { frozen: validateDancePlan(decoded, limits), input, steps }
  }
  function read(value: ReturnType<typeof sampled>) {
    const decoded: unknown = JSON.parse(JSON.stringify(value.input))
    return validateDanceEpisode(decoded, value.frozen, { steps: value.steps, terminated: value.input.terminated })
  }
  function metrics(value: ReturnType<typeof sampled>, path: string, measurement: number) {
    const cycle = value.input.cycles[0]!
    for (const target of [cycle, ...cycle.blocks]) replace(target, path, measurement)
  }
  function verdicts(value: ReturnType<typeof sampled>, status: RobotDanceEpisode['status'], reasons: string[]) {
    const cycle = value.input.cycles[0]!
    for (const target of [value.input, cycle, ...cycle.blocks]) { target.status = status; target.reasons = [...reasons] }
  }

  it.each([
    ['jointRmseRad.0', 0.3, 0.03, 'joint-rmse', 1],
    ['rootOrientationRmseRad', 0.3, 0.03, 'root-rmse', 1],
    ['amplitudeRatio.0', 1.5, 1.024695077, 'amplitude-ratio', 2],
    ['amplitudeRatio.0', 0, 0.979795897, 'amplitude-ratio', 2],
    ['referenceGainRatio.0', -1, 0.92, 'reference-gain', 2],
  ] as const)('preserves v1 fragment rejection but permits a v2 incomplete-to-pass witness for %s = %s', (path, partial, full, reason, measuredSteps) => {
    const legacy = sampled(1, measuredSteps)
    metrics(legacy, path, partial)
    verdicts(legacy, 'failed', ['incomplete-window', 'missing-measurements', reason])
    expect(read(legacy)).toEqual(legacy.input)
    verdicts(legacy, 'incomplete', ['incomplete-window', 'missing-measurements'])
    expect(() => read(legacy)).toThrow('status')

    const prospective = sampled(2, measuredSteps)
    metrics(prospective, path, partial)
    const before = structuredClone(prospective.input)
    expect(read(prospective)).toEqual(before)
    expect(prospective.input).toEqual(before)
    verdicts(prospective, 'failed', ['incomplete-window', 'missing-measurements', reason])
    expect(() => read(prospective)).toThrow('status')

    const completed = sampled(2, 100)
    metrics(completed, path, full)
    expect(read(completed).status).toBe('passed')
  })

  it.each([
    ['jointRmseRad.13', 0.3, 50, 'joint-rmse'],
    ['rootOrientationRmseRad', 0.3, 50, 'root-rmse'],
    ['maxHorizontalDriftMeters', 0.11, 1, 'horizontal-drift'],
    ['jointRmseRad.13', Number.MAX_VALUE, 1, 'joint-rmse'],
  ] as const)('retains definite v2 partial failure for %s', (path, measurement, measuredSteps, reason) => {
    const value = sampled(2, measuredSteps)
    metrics(value, path, measurement)
    verdicts(value, 'failed', ['incomplete-window', 'missing-measurements', reason])
    expect(read(value).status).toBe('failed')
    verdicts(value, 'incomplete', ['incomplete-window', 'missing-measurements'])
    expect(() => read(value)).toThrow('status')
  })

  it('uses planned length, not elapsed steps, for an early-truncated window', () => {
    const value = sampled(2, 1, 1)
    metrics(value, 'jointRmseRad.0', 0.3)
    metrics(value, 'rootOrientationRmseRad', 0.3)
    metrics(value, 'amplitudeRatio.0', 2)
    metrics(value, 'referenceGainRatio.0', -1)
    expect(read(value)).toMatchObject({ status: 'failed', reasons: ['incomplete-window', 'early-truncated'],
      cycles: [{ status: 'incomplete', jointRmseRad: [0.3, ...Array<number>(13).fill(0.1)],
        rootOrientationRmseRad: 0.3, reasons: ['incomplete-window'], blocks: [{ status: 'incomplete' }] }] })
  })

  it('treats partial lower-bound equality as unresolved rather than failed or passed', () => {
    const value = sampled(2, 25)
    metrics(value, 'jointRmseRad.0', 0.4)
    metrics(value, 'rootOrientationRmseRad', 0.4)
    metrics(value, 'maxHorizontalDriftMeters', 0.1)
    expect(read(value).status).toBe('incomplete')
    verdicts(value, 'passed', [])
    expect(() => read(value)).toThrow('status')
  })

  it.each([0, 1, 99, 100])('requires complete finite coverage with %s of 100 planned measurements', (measuredSteps) => {
    const value = sampled(2, measuredSteps)
    const actual = read(value)
    expect(actual.status).toBe(measuredSteps === 100 ? 'passed' : 'incomplete')
    expect(actual.cycles[0]).toMatchObject({ measuredSteps, complete: measuredSteps === 100,
      jointRmseRad: measuredSteps === 0 ? null : Array<number>(14).fill(0.1) })
    if (measuredSteps < 100) {
      verdicts(value, 'passed', [])
      expect(() => read(value)).toThrow('status')
    }
  })

  it('accepts all full-coverage thresholds at equality', () => {
    const value = sampled(2, 100)
    metrics(value, 'jointRmseRad.0', 0.2)
    metrics(value, 'rootOrientationRmseRad', 0.2)
    metrics(value, 'maxHorizontalDriftMeters', 0.1)
    metrics(value, 'referenceGainRatio.0', 0.8)
    for (const amplitude of [0.8, 1.2]) {
      metrics(value, 'amplitudeRatio.0', amplitude)
      expect(read(value).status).toBe('passed')
    }
  })

  it.each([false, true])('applies full-coverage movement violations even when terminated = %s', (terminated) => {
    const value = sampled(2, 100)
    metrics(value, 'amplitudeRatio.0', 0)
    metrics(value, 'referenceGainRatio.0', 0)
    const reasons = ['amplitude-ratio', 'reference-gain']
    if (terminated) reasons.push('incomplete-window')
    verdicts(value, 'failed', reasons)
    if (terminated) {
      value.input.terminated = true
      value.input.reasons.push('terminated')
      const cycle = value.input.cycles[0]!
      for (const target of [cycle, ...cycle.blocks]) target.complete = false
    }
    expect(read(value).status).toBe('failed')
    const cycle = value.input.cycles[0]!
    cycle.blocks[0]!.status = 'incomplete'; cycle.blocks[0]!.reasons = ['incomplete-window']
    expect(() => read(value)).toThrow('status')
  })

  it('retains termination as an independent failure with fully measured passing metrics', () => {
    const value = sampled(2, 100)
    verdicts(value, 'incomplete', ['incomplete-window'])
    value.input.terminated = true; value.input.status = 'failed'; value.input.reasons.push('terminated')
    const cycle = value.input.cycles[0]!
    for (const target of [cycle, ...cycle.blocks]) target.complete = false
    expect(read(value)).toMatchObject({ status: 'failed', completedCycles: 1,
      cycles: [{ measuredSteps: 100, complete: false, status: 'incomplete' }] })
  })

  it.each(['jointRmseRad.0', 'rootOrientationRmseRad'])('uses each authored block length for the %s bound and propagates its failure', (path) => {
    const frozen = plan(2)
    frozen.evaluation.stepsPerEpisode = 10; frozen.evaluation.dance.requiredCycles = 1
    frozen.reference.blocks = [{ index: 0, startStep: 0, endStep: 2, activeJointIndices: [0] },
      { index: 1, startStep: 2, endStep: 10, activeJointIndices: [] }]
    const reason = path === 'rootOrientationRmseRad' ? 'root-rmse' : 'joint-rmse'
    const blocks = [window(0, 2), window(1, 8, false)]
    const cycle = { ...window(0, 10), blocks }
    for (const [index, target] of [cycle, ...blocks].entries()) {
      target.measuredSteps = [4, 1, 3][index]!
      target.complete = false; target.status = 'incomplete'
      target.reasons = ['incomplete-window', 'missing-measurements']
      replace(target, path, 0.3)
    }
    for (const target of [cycle, blocks[0]!]) { target.status = 'failed'; target.reasons.push(reason) }
    const input: RobotDanceEpisode = { completedCycles: 1, terminated: false, truncated: false,
      cycles: [cycle], status: 'failed', reasons: [...cycle.reasons] }
    const validated = validateDancePlan(JSON.parse(JSON.stringify(frozen)) as unknown, limits)
    expect(validateDanceEpisode(JSON.parse(JSON.stringify(input)) as unknown, validated, { steps: 10, terminated: false })).toEqual(input)
    blocks[0]!.status = 'incomplete'; blocks[0]!.reasons = ['incomplete-window', 'missing-measurements']
    expect(() => validateDanceEpisode(input, validated, { steps: 10, terminated: false })).toThrow('status')
  })

  it('aggregates validated v2 episodes with conservative pass-fraction bounds', () => {
    const pass = read(sampled(2, 100))
    const incomplete = read(sampled(2, 1))
    const failed = sampled(2, 1)
    metrics(failed, 'maxHorizontalDriftMeters', 0.2)
    verdicts(failed, 'failed', ['incomplete-window', 'missing-measurements', 'horizontal-drift'])
    const fail = read(failed)
    const criteria = failed.frozen.evaluation.dance
    expect(computeDanceStatus(criteria, [pass, incomplete])).toBe('incomplete')
    expect(computeDanceStatus(criteria, [fail, incomplete])).toBe('failed')
    expect(computeDanceStatus(criteria, [pass, pass])).toBe('passed')
    criteria.minPassedEpisodeFraction = 0.5
    expect(computeDanceStatus(criteria, [pass, incomplete])).toBe('passed')
    expect(computeDanceStatus(criteria, [fail, incomplete])).toBe('incomplete')
    expect(computeDanceStatus(criteria, [fail, fail])).toBe('failed')
  })
})

describe('run dance reference consistency', () => {
  function runFixture() {
    const project = learningProject(); const recipe = learningRecipe(project)
    const run = learningRun({ recipe, createdAt: '2026-01-01T00:00:00Z' } as RobotTrial, project)
    const dancePlan = plan()
    dancePlan.reference.authoredDurationSeconds = 20; dancePlan.reference.cycleSteps = 1000; dancePlan.reference.cycleSeconds = 20
    dancePlan.reference.blocks = [{ index: 0, startStep: 0, endStep: 1000, activeJointIndices: [0] }]
    dancePlan.evaluation.stepsPerEpisode = 2000
    dancePlan.evaluatorSha256 = run.provenance.bridgeSha256
    run.dancePlan = dancePlan
    return run
  }
  it('accepts a plan matching frozen clip, source, BAM, behavior and project joints', () => {
    const run = runFixture()
    expect(parseReply(JSON.stringify({ operation: 'run', run }), limits)).toEqual({ operation: 'run', run })
  })
  it('checks frozen projects in run collections and permits clip-only dance references', () => {
    const run = runFixture()
    expect(parseReply(JSON.stringify({ operation: 'runs', runs: [run], incompatibleRuns: [] }), limits))
      .toEqual({ operation: 'runs', runs: [run], incompatibleRuns: [] })
    run.spec.clip!.duration = 19
    expect(() => parseReply(JSON.stringify({ operation: 'run', run }), limits)).toThrow('Training clip differs from frozen project')
    run.spec.clip!.duration = 20
    delete run.spec.projectRevisionId; delete run.spec.projectSnapshot
    expect(parseReply(JSON.stringify({ operation: 'run', run }), limits)).toEqual({ operation: 'run', run })
  })
  it.each([
    ['dancePlan.sourceFingerprint', '9'.repeat(64)], ['dancePlan.evaluatorSha256', '8'.repeat(64)],
    ['dancePlan.runtimeVersions.mujoco', '3.9.0'], ['dancePlan.environment.behaviorId', 'stand'], ['dancePlan.environment.weights.pose', 2],
    ['dancePlan.physics.bam.parameters.kt', 0.4], ['dancePlan.reference.authoredDurationSeconds', 19],
    ['dancePlan.reference.jointNames.0', 'other-joint'], ['dancePlan.reference.rootBody', 'other-root'],
  ])('rejects a run with mismatched %s', (path, value) => {
    const run = runFixture(); replace(run, path, value)
    expect(() => parseReply(JSON.stringify({ operation: 'run', run }), limits)).toThrow('differs')
  })
})
