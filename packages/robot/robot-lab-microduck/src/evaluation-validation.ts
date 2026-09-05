/** Validates persisted Python evaluation records without filesystem access or rehashing Python JSON. */
import { isDeepStrictEqual } from 'node:util'
import type {
  ObservationProfile, RobotEvaluation, RobotEvaluationId, RobotEvaluationSpec, RobotPhysics, RobotPolicyId,
} from '@deepseek-ai/dsh-robot-lab'

/** Immutable request.json fields recorded before any evaluation episode executes. */
export interface RobotEvaluationAdmission {
  id: RobotEvaluationId
  createdAt: string
  policyId: RobotPolicyId
  policyHash: string
  spec: RobotEvaluationSpec
  physics: RobotPhysics
  observationProfile: ObservationProfile
}

interface EvaluationLimits { maxEvaluationEpisodes: number; maxSimulationSteps: number }
type Row = Record<string, unknown>
const admissionKeys = ['id', 'createdAt', 'policyId', 'policyHash', 'spec', 'physics', 'observationProfile'] as const
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid MicroDuck evaluation: ${message}`)
}
function object(value: unknown, label: string, keys?: readonly string[]): Row {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  const row = value as Row
  requireValue(Object.getPrototypeOf(row) === Object.prototype || Object.getPrototypeOf(row) === null, `${label} must be a JSON object`)
  if (keys !== undefined) {
    requireValue(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), `${label} has unexpected or missing fields`)
  }
  return row
}
function text(value: unknown, label: string): asserts value is string {
  requireValue(typeof value === 'string', `${label} must be text`)
}
function number(value: unknown, label: string, min = -Infinity, max = Infinity, integer = false): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isSafeInteger(value)), `${label} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`)
}
function hash(value: unknown, label: string): void {
  text(value, label)
  requireValue(value.length === 64 && /^[a-f0-9]{64}$/.test(value), `${label} must be a lowercase SHA256 digest`)
}
function policy(value: unknown): void {
  text(value, 'policyId')
  requireValue((value.length === 44 && new RegExp(`^run:run-${uuid}$`).test(value))
    || value === 'shipped:alpha_stand' || value === 'shipped:alpha_walking', 'policyId must identify an owned run or supported shipped policy')
}
function timestamp(value: unknown, label: string): bigint {
  text(value, label)
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  requireValue(match !== null && match[0] === value, `${label} must be an ISO timestamp with timezone`)
  const local = value.slice(0, 19)
  const milliseconds = Date.parse(`${local}Z`)
  requireValue(!local.startsWith('0000-') && Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString().slice(0, 19) === local, `${label} has an invalid calendar date or time`)
  const hours = Number(match[5] ?? 0)
  const minutes = Number(match[6] ?? 0)
  requireValue(hours <= 23 && minutes <= 59, `${label} has an invalid timezone`)
  const offset = (hours * 60 + minutes) * 60_000 * (match[4] === '-' ? -1 : 1)
  return BigInt(milliseconds - offset) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0'))
}
function physics(value: unknown): void {
  const row = object(value, 'physics', ['actuator', 'bam', 'observationNoise', 'actionDelay', 'domainRandomization', 'randomYaw'])
  requireValue(row.actuator === 'bam' && row.observationNoise === false && row.actionDelay === true
    && row.domainRandomization === false && row.randomYaw === false, 'physics must use fixed deterministic BAM settings')
  const bam = object(row.bam, 'physics.bam', ['source', 'parameters', 'sha256'])
  text(bam.source, 'physics.bam.source')
  hash(bam.sha256, 'physics.bam.sha256')
  for (const value of Object.values(object(bam.parameters, 'physics.bam.parameters'))) number(value, 'BAM parameter')
}

/**
 * Validate an immutable evaluation request decoded from bounded JSON; throws on invalid fields.
 * Policy ownership and artifact integrity must be checked by the caller against session storage.
 * @param value - Parsed request.json contents.
 * @param limits - Deployment episode and horizon limits.
 * @returns The validated admission, without copying or recomputing Python provenance hashes.
 */
export function validateEvaluationAdmission(value: unknown, limits: EvaluationLimits): RobotEvaluationAdmission {
  const row = object(value, 'admission', admissionKeys)
  text(row.id, 'id')
  requireValue(row.id.length === 41 && new RegExp(`^eval-${uuid}$`).test(row.id), 'id must be a canonical eval UUID')
  timestamp(row.createdAt, 'createdAt')
  policy(row.policyId)
  hash(row.policyHash, 'policyHash')
  requireValue(row.observationProfile === 'microduck-standard-61' || row.observationProfile === 'microduck-lab-body-phase-61', 'unknown observationProfile')
  requireValue(!(row.policyId as string).startsWith('shipped:') || row.observationProfile === 'microduck-standard-61', 'shipped policies require standard observationProfile')
  const spec = object(row.spec, 'spec', ['policyId', 'episodes', 'stepsPerEpisode', 'seed', 'maxTerminations', 'minMeanUprightFraction'])
  requireValue(spec.policyId === row.policyId, 'spec.policyId differs from admission policyId')
  number(spec.episodes, 'spec.episodes', 1, limits.maxEvaluationEpisodes, true)
  number(spec.stepsPerEpisode, 'spec.stepsPerEpisode', 1, limits.maxSimulationSteps, true)
  number(spec.seed, 'spec.seed', 0, 2147483647 - spec.episodes, true)
  number(spec.maxTerminations, 'spec.maxTerminations', 0, spec.episodes, true)
  number(spec.minMeanUprightFraction, 'spec.minMeanUprightFraction', 0, 1)
  physics(row.physics)
  return row as unknown as RobotEvaluationAdmission
}

/**
 * Compute the Python pass criteria over a validated, complete episode collection.
 * @param spec - Frozen evaluation criteria.
 * @param episodes - Validated episodes in admission order, with exactly spec.episodes entries.
 * @returns Whether termination count and mean upright fraction both meet the frozen criteria.
 */
export function computeEvaluationPass(spec: RobotEvaluationSpec, episodes: RobotEvaluation['episodes']): boolean {
  return episodes.filter(episode => episode.terminated).length <= spec.maxTerminations
    && episodes.reduce((sum, episode) => sum + episode.uprightFraction, 0) / spec.episodes >= spec.minMeanUprightFraction
}

/**
 * Whether every episode reached the frozen horizon or terminated early.
 * A record short of stepsPerEpisode without termination is an incomplete assessment, not a full-horizon result;
 * such records are preserved and counted as incomplete rather than surfaced as evidence or rewritten.
 * @param evaluation - A report already validated by validateEvaluationReport.
 * @returns Whether the report is a complete full-horizon assessment.
 */
export function evaluationReachedFullHorizon(evaluation: RobotEvaluation): boolean {
  return evaluation.episodes.every(episode => episode.terminated || episode.steps === evaluation.spec.stepsPerEpisode)
}

/**
 * Validate a complete report against its independently loaded admission; throws on tampering or structural corruption.
 * Callers must bound the complete JSON record's bytes, including limitations, before decoding.
 * @param admission - Validated request.json from the same owned evaluation directory.
 * @param value - Parsed report.json contents.
 * @param limits - Deployment episode and horizon limits.
 * @returns The validated report, without copying or changing its recorded metrics.
 */
export function validateEvaluationReport(admission: RobotEvaluationAdmission, value: unknown, limits: EvaluationLimits): RobotEvaluation {
  const row = object(value, 'report', [...admissionKeys, 'episodes', 'passed', 'limitations', 'evaluatedAt'])
  const recordedAdmission = validateEvaluationAdmission(Object.fromEntries(admissionKeys.map(key => [key, row[key]])), limits)
  requireValue(isDeepStrictEqual(recordedAdmission, admission), 'report fields differ from admission')
  requireValue(timestamp(row.evaluatedAt, 'evaluatedAt') >= timestamp(admission.createdAt, 'createdAt'), 'evaluatedAt precedes createdAt')
  requireValue(Array.isArray(row.episodes) && row.episodes.length === admission.spec.episodes, 'episode count differs from admission')
  for (const [index, value] of row.episodes.entries()) {
    const episode = object(value, `episodes[${index}]`, ['seed', 'steps', 'terminated', 'reward', 'uprightFraction', 'poseRmse', 'bamSettings'])
    requireValue(episode.seed === admission.spec.seed + index, 'episode seeds must follow admission order')
    number(episode.steps, 'episode.steps', 1, admission.spec.stepsPerEpisode, true)
    requireValue(typeof episode.terminated === 'boolean', 'episode.terminated must be boolean')
    number(episode.reward, 'episode.reward')
    number(episode.uprightFraction, 'episode.uprightFraction', 0, 1)
    if (episode.poseRmse !== null) number(episode.poseRmse, 'episode.poseRmse', 0)
    for (const setting of Object.values(object(episode.bamSettings, 'episode.bamSettings'))) {
      if (setting !== null) number(setting, 'BAM setting')
    }
  }
  requireValue(Array.isArray(row.limitations) && row.limitations.every(item => typeof item === 'string'), 'limitations must be a text array')
  const report = row as unknown as RobotEvaluation
  requireValue(typeof row.passed === 'boolean' && row.passed === computeEvaluationPass(admission.spec, report.episodes), 'passed differs from computed criteria')
  return report
}
