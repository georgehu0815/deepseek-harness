/** Validates frozen choreography inputs and measured Python verdicts without rehashing Python JSON. */
import { isDeepStrictEqual } from 'node:util'
import {
  validateDanceCriteria, type RobotDanceCriteria, type RobotDanceEpisode, type RobotDancePlan,
  type RobotDanceStatus, type RobotDanceWindow,
} from '@deepseek-ai/dsh-robot-lab'

/** Deployment bounds for persisted plans and their measured windows. */
export interface DanceValidationLimits { maxEvaluationEpisodes: number; maxSimulationSteps: number }
type Row = Record<string, unknown>

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid MicroDuck dance: ${message}`)
}
function object(value: unknown, label: string, keys?: readonly string[]): Row {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  const row = value as Row
  requireValue(Object.getPrototypeOf(row) === Object.prototype || Object.getPrototypeOf(row) === null, `${label} must be a JSON object`)
  if (keys !== undefined) requireValue(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), `${label} has unexpected or missing fields`)
  return row
}
function number(value: unknown, label: string, min = -Infinity, max = Infinity, integer = false): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isSafeInteger(value)), `${label} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`)
}
function text(value: unknown, label: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${label} must be nonblank text`)
}
function hash(value: unknown, label: string): void {
  requireValue(typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value), `${label} must be a lowercase SHA256 digest`)
}
function array(value: unknown, length: number, label: string): unknown[] {
  requireValue(Array.isArray(value) && value.length === length, `${label} has an invalid array length`)
  return value
}
function close(actual: number, expected: number): boolean {
  return Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
}

/**
 * Validate a bounded decoded plan; hashes remain opaque Python digests.
 * The caller must bind the complete decoded plan to the independently saved trial record.
 * @param value - Parsed plan from a run or evaluation admission.
 * @param limits - Deployment episode and step bounds.
 * @returns The unchanged validated plan.
 */
export function validateDancePlan(value: unknown, limits: DanceValidationLimits): RobotDancePlan {
  const row = object(value, 'plan', ['version', 'evaluation', 'reference', 'evaluatorSha256', 'sourceFingerprint', 'physics', 'runtimeVersions', 'environment', 'sha256'])
  requireValue(row.version === 1 || row.version === 2, 'plan.version must be 1 or 2')
  for (const key of ['evaluatorSha256', 'sourceFingerprint', 'sha256']) hash(row[key], `plan.${key}`)
  const evaluation = object(row.evaluation, 'plan.evaluation', ['episodes', 'stepsPerEpisode', 'seed', 'maxTerminations', 'minMeanUprightFraction', 'dance'])
  const criteriaVersion = validateDanceCriteria(evaluation.dance).version
  requireValue(row.version === criteriaVersion, 'plan.version must match criteria.version')
  number(evaluation.episodes, 'plan.evaluation.episodes', 1, limits.maxEvaluationEpisodes, true)
  number(evaluation.stepsPerEpisode, 'plan.evaluation.stepsPerEpisode', 1, limits.maxSimulationSteps, true)
  number(evaluation.seed, 'plan.evaluation.seed', 0, 2147483647 - evaluation.episodes, true)
  number(evaluation.maxTerminations, 'plan.evaluation.maxTerminations', 0, evaluation.episodes, true)
  number(evaluation.minMeanUprightFraction, 'plan.evaluation.minMeanUprightFraction', 0, 1)
  const criteria = object(evaluation.dance, 'plan.evaluation.dance')
  number(criteria.requiredCycles, 'requiredCycles', 1, limits.maxSimulationSteps, true)
  const reference = object(row.reference, 'plan.reference', ['clipSha256', 'sampledSha256', 'jointNames', 'rootBody', 'rootConvention', 'authoredDurationSeconds', 'controlDtSeconds', 'cycleSteps', 'cycleSeconds', 'loop', 'blocks'])
  hash(reference.clipSha256, 'reference.clipSha256'); hash(reference.sampledSha256, 'reference.sampledSha256')
  const names = array(reference.jointNames, 14, 'reference.jointNames')
  names.forEach((value) => { text(value, 'joint name') })
  requireValue(new Set(names).size === 14, 'reference joint names must be unique')
  text(reference.rootBody, 'reference.rootBody')
  requireValue(reference.rootConvention === 'initial-heading-world-up-pitch-v1', 'unknown root convention')
  number(reference.authoredDurationSeconds, 'reference.authoredDurationSeconds', Number.MIN_VALUE)
  number(reference.controlDtSeconds, 'reference.controlDtSeconds', Number.MIN_VALUE)
  number(reference.cycleSteps, 'reference.cycleSteps', 1, limits.maxSimulationSteps, true)
  number(reference.cycleSeconds, 'reference.cycleSeconds', Number.MIN_VALUE)
  requireValue(close(reference.cycleSeconds, reference.cycleSteps * reference.controlDtSeconds), 'reference cycle clock differs from steps and dt')
  requireValue(typeof reference.loop === 'boolean' && (reference.loop
    || (criteria.requiredCycles === 1 && evaluation.stepsPerEpisode === reference.cycleSteps)), 'nonlooping references require exactly one cycle without an endpoint-hold tail')
  requireValue(criteria.requiredCycles * reference.cycleSteps <= evaluation.stepsPerEpisode, 'evaluation horizon does not cover required cycles')
  requireValue(Array.isArray(reference.blocks) && reference.blocks.length > 0 && reference.blocks.length <= limits.maxSimulationSteps, 'reference blocks must be a bounded partition')
  let end = 0
  for (const [index, value] of reference.blocks.entries()) {
    const block = object(value, 'reference block', ['index', 'startStep', 'endStep', 'activeJointIndices'])
    requireValue(block.index === index && block.startStep === end, 'reference block indices must partition the cycle')
    number(block.endStep, 'block.endStep', end + 1, reference.cycleSteps, true)
    requireValue(Array.isArray(block.activeJointIndices) && block.activeJointIndices.length <= 14, 'block active joints must be bounded')
    block.activeJointIndices.forEach((value) => { number(value, 'active joint index', 0, 13, true) })
    requireValue(new Set(block.activeJointIndices).size === block.activeJointIndices.length, 'block active joints must be unique')
    end = block.endStep
  }
  requireValue(end === reference.cycleSteps, 'reference blocks do not cover the cycle')
  const physics = object(row.physics, 'plan.physics', ['actuator', 'bam', 'observationNoise', 'actionDelay', 'domainRandomization', 'randomYaw'])
  requireValue(physics.actuator === 'bam' && physics.observationNoise === false && physics.actionDelay === true
    && physics.domainRandomization === false && physics.randomYaw === false, 'plan.physics must use fixed deterministic BAM settings')
  const bam = object(physics.bam, 'plan.physics.bam', ['source', 'parameters', 'sha256'])
  text(bam.source, 'BAM source'); hash(bam.sha256, 'BAM sha256')
  for (const value of Object.values(object(bam.parameters, 'BAM parameters'))) number(value, 'BAM parameter')
  for (const value of Object.values(object(row.runtimeVersions, 'runtimeVersions'))) text(value, 'runtime version')
  const environment = object(row.environment, 'plan.environment', ['behaviorId', 'weights'])
  text(environment.behaviorId, 'environment.behaviorId')
  for (const value of Object.values(object(environment.weights, 'environment.weights'))) number(value, 'environment weight', 0)
  return row as unknown as RobotDancePlan
}

/**
 * Bind a validated plan to the independently recorded evaluation criteria and physics.
 * @param plan - Validated frozen choreography plan.
 * @param evaluation - Policy-independent saved evaluation criteria.
 * @param physics - Independently validated rollout physics.
 */
export function matchDancePlan(plan: RobotDancePlan, evaluation: RobotDancePlan['evaluation'], physics: RobotDancePlan['physics']): void {
  requireValue(isDeepStrictEqual(plan.evaluation, evaluation), 'plan evaluation differs from requested criteria')
  requireValue(isDeepStrictEqual(plan.physics, physics), 'plan physics differs from evaluation physics')
}

const windowKeys = ['index', 'steps', 'measuredSteps', 'complete', 'jointRmseRad', 'rootOrientationRmseRad', 'amplitudeRatio', 'referenceGainRatio', 'maxHorizontalDriftMeters', 'status', 'reasons']
const incompleteReasons = new Set(['missing-measurements', 'incomplete-window'])

function verdict(row: Row, reasons: Set<string>, label: string): void {
  const status = [...reasons].some(reason => !incompleteReasons.has(reason)) ? 'failed' : reasons.size > 0 ? 'incomplete' : 'passed'
  requireValue(row.status === status, `${label}.status differs from computed metrics`)
  requireValue(Array.isArray(row.reasons) && row.reasons.length === reasons.size
    && row.reasons.every(reason => typeof reason === 'string' && reasons.has(reason))
    && new Set(row.reasons).size === reasons.size, `${label}.reasons differ from computed metrics`)
}

function window(value: unknown, criteria: RobotDanceCriteria, expected: {
  index: number
  start: number
  length: number
  outerSteps: number
  terminated: boolean
  active: number[] | null
  cycle: boolean
}): { measured: RobotDanceWindow; reasons: Set<string> } {
  const row = object(value, 'window', [...windowKeys, ...(expected.cycle ? ['blocks'] : [])])
  const steps = Math.min(expected.length, Math.max(0, expected.outerSteps - expected.start))
  number(row.measuredSteps, 'window.measuredSteps', 0, steps, true)
  const complete = expected.length > 0 && steps === expected.length && row.measuredSteps === expected.length
    && !(expected.terminated && expected.outerSteps === expected.start + expected.length)
  requireValue(row.index === expected.index && row.steps === steps && row.complete === complete, 'window index, steps or complete differ from episode coverage')
  const amplitude = array(row.amplitudeRatio, 14, 'window.amplitudeRatio')
  const gain = array(row.referenceGainRatio, 14, 'window.referenceGainRatio')
  for (let index = 0; index < 14; index++) {
    const a = amplitude[index]; const g = gain[index]
    if (a !== null) number(a, 'amplitude ratio', 0)
    if (g !== null) number(g, 'reference gain')
    requireValue((a === null) === (g === null), 'movement ratios must be paired null or finite measurements')
    if (expected.active !== null && !expected.active.includes(index)) requireValue(a === null, 'inactive block movement ratios must be null')
  }
  const rmse = row.jointRmseRad === null ? null : array(row.jointRmseRad, 14, 'window.jointRmseRad')
  rmse?.forEach((value) => { number(value, 'joint RMSE', 0) })
  for (const key of ['rootOrientationRmseRad', 'maxHorizontalDriftMeters']) if (row[key] !== null) number(row[key], key, 0)
  if (row.measuredSteps === 0) requireValue(rmse === null && row.rootOrientationRmseRad === null && row.maxHorizontalDriftMeters === null
    && amplitude.every(value => value === null), 'unmeasured windows must contain null measurements')
  else requireValue(rmse !== null && row.rootOrientationRmseRad !== null && row.maxHorizontalDriftMeters !== null, 'measured windows require finite joint, root and drift metrics')
  const reasons = new Set<string>()
  if (!complete) reasons.add('incomplete-window')
  if (row.measuredSteps < steps || rmse === null || row.rootOrientationRmseRad === null || row.maxHorizontalDriftMeters === null) reasons.add('missing-measurements')
  const rmseScale = criteria.version === 2 ? Math.sqrt(row.measuredSteps / expected.length) : 1
  if (rmse?.some((value, index) => (value as number) * rmseScale > (criteria.maxJointRmseRad[index] as number))) reasons.add('joint-rmse')
  if (row.rootOrientationRmseRad !== null && (row.rootOrientationRmseRad as number) * rmseScale > criteria.maxRootOrientationRmseRad) reasons.add('root-rmse')
  if (row.maxHorizontalDriftMeters !== null && (row.maxHorizontalDriftMeters as number) > criteria.maxHorizontalDriftMeters) reasons.add('horizontal-drift')
  for (const index of criteria.movingJointIndices) {
    if (expected.active !== null && !expected.active.includes(index)) continue
    const a = amplitude[index]; const g = gain[index]
    if (a === null || g === null) reasons.add('missing-measurements')
    else if (criteria.version === 1 || row.measuredSteps === expected.length) {
      if ((a as number) < criteria.minAmplitudeRatio || (a as number) > criteria.maxAmplitudeRatio) reasons.add('amplitude-ratio')
      if ((g as number) < criteria.minReferenceGainRatio) reasons.add('reference-gain')
    }
  }
  if (!expected.cycle) verdict(row, reasons, 'window')
  return { measured: row as unknown as RobotDanceWindow, reasons }
}

/**
 * Validate full-rate windows and recompute every verdict from recorded measurements.
 * @param value - Parsed per-episode dance measurements.
 * @param plan - Independently validated frozen plan.
 * @param episode - Validated outer episode coverage and termination.
 * @returns The unchanged validated dance episode.
 */
export function validateDanceEpisode(
  value: unknown, plan: RobotDancePlan, episode: { steps: number; terminated: boolean },
): RobotDanceEpisode {
  const row = object(value, 'episode.dance', ['completedCycles', 'terminated', 'truncated', 'cycles', 'status', 'reasons'])
  const { cycleSteps, blocks } = plan.reference
  const criteria = plan.evaluation.dance
  requireValue(row.completedCycles === Math.floor(episode.steps / cycleSteps), 'completedCycles differs from episode coverage')
  requireValue(row.terminated === episode.terminated && typeof row.truncated === 'boolean', 'dance termination flags differ from episode')
  requireValue(episode.terminated || episode.steps === plan.evaluation.stepsPerEpisode || row.truncated, 'short nonterminated dance episode must be truncated')
  const cycles = array(row.cycles, criteria.requiredCycles, 'dance.cycles')
  const reasons = new Set<string>()
  if (episode.terminated) reasons.add('terminated')
  if (row.truncated && episode.steps < plan.evaluation.stepsPerEpisode) reasons.add('early-truncated')
  for (const [index, value] of cycles.entries()) {
    const start = index * cycleSteps
    const cycle = window(value, criteria, { index, start, length: cycleSteps,
      outerSteps: episode.steps, terminated: episode.terminated, active: null, cycle: true })
    const cycleRow = object(value, 'cycle')
    const measuredBlocks = array(cycleRow.blocks, blocks.length, 'cycle.blocks')
    let measuredSteps = 0
    for (const [index, block] of blocks.entries()) {
      const measured = window(measuredBlocks[index], criteria, {
        index, start: start + block.startStep, length: block.endStep - block.startStep,
        outerSteps: episode.steps, terminated: episode.terminated, active: block.activeJointIndices, cycle: false })
      measured.reasons.forEach(reason => cycle.reasons.add(reason))
      measuredSteps += measured.measured.measuredSteps
    }
    requireValue(cycle.measured.measuredSteps === measuredSteps, 'cycle measuredSteps differs from its block partition')
    verdict(cycleRow, cycle.reasons, 'cycle')
    cycle.reasons.forEach(reason => reasons.add(reason))
  }
  verdict(row, reasons, 'episode.dance')
  return row as unknown as RobotDanceEpisode
}

/**
 * Compute the requested passing fraction using conservative bounds on incomplete episodes.
 * @param criteria - Frozen dance thresholds.
 * @param episodes - Validated dance episodes, exactly matching the requested episode count.
 * @returns Passed when enough episodes pass, failed when incompletes cannot reach the threshold, otherwise incomplete.
 */
export function computeDanceStatus(criteria: RobotDanceCriteria, episodes: RobotDanceEpisode[]): RobotDanceStatus {
  const passed = episodes.filter(episode => episode.status === 'passed').length
  if (passed / episodes.length >= criteria.minPassedEpisodeFraction) return 'passed'
  const incomplete = episodes.filter(episode => episode.status === 'incomplete').length
  return (passed + incomplete) / episodes.length < criteria.minPassedEpisodeFraction ? 'failed' : 'incomplete'
}
