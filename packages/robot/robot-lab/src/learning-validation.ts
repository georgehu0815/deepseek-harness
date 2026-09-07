/** Public JSON validation for immutable learning trials and measured reflections. */
import { validateDanceCriteria } from './dance-validation.ts'
type Row = Record<string, unknown>
function object(value: unknown, keys: string[], optional: string[] = []): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Robot learning requires an object')
  const row = value as Row
  if (keys.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !keys.includes(key) && !optional.includes(key))) throw new Error('Robot learning object has missing or unsupported fields')
  return row
}
function text(value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '' || /[\p{Cc}\p{Cs}]/u.test(value)) throw new Error('Robot learning text must be nonblank Unicode without controls')
}
function identity(value: unknown, prefix: string): void {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).test(value)) throw new Error(`Robot learning requires a ${prefix} identity`)
}
function number(value: unknown, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error('Robot learning number is outside its permitted range')
  return value
}
/** Validate learning operation JSON before session-owned provider dispatch.
 * @param row - Public request with validated outer keys.
 */
export function validateLearningFields(row: Row): void {
  if (row.operation === 'train_trial' || row.operation === 'evaluate_trial') identity(row.trialId, 'trial')
  if (row.operation === 'replay_evaluation') {
    identity(row.evaluationId, 'eval'); number(row.episodeIndex, 0, Number.MAX_SAFE_INTEGER)
  }
  if (row.operation === 'save_reflection') {
    const reflection = object(row.reflection, ['trialId', 'evaluationId', 'observation', 'interpretation', 'nextChange'])
    identity(reflection.trialId, 'trial'); identity(reflection.evaluationId, 'eval')
    for (const key of ['observation', 'interpretation', 'nextChange']) text(reflection[key])
  }
  if (row.operation !== 'save_trial') return
  const recipe = object(row.recipe, ['spec', 'brief', 'evaluation', 'parentReflectionId'])
  if (recipe.parentReflectionId !== null) identity(recipe.parentReflectionId, 'reflection')
  const brief = object(recipe.brief, ['goal', 'prediction', 'plannedChange', 'evidence'])
  Object.values(brief).forEach(text)
  const spec = object(recipe.spec, ['projectRevisionId', 'name', 'behaviorId', 'steps', 'envs', 'seed', 'actuator', 'weights', 'clip'], ['backend'])
  identity(spec.projectRevisionId, 'revision')
  if (spec.clip !== null) throw new Error('Guided trials require clip:null and a saved project revision')
  if (spec.backend !== undefined && spec.backend !== 'cpu' && spec.backend !== 'mlx' && spec.backend !== 'rlx') throw new Error('Training backend must be cpu, mlx or rlx')
  if (typeof spec.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(spec.name)) throw new Error('Invalid training name')
  text(spec.behaviorId)
  number(spec.steps, 1, Number.MAX_SAFE_INTEGER); number(spec.envs, 1, Number.MAX_SAFE_INTEGER); number(spec.seed, 0, 2147483647)
  if (spec.actuator !== 'bam' && spec.actuator !== 'xml') throw new Error('Training actuator must be bam or xml')
  if (spec.weights === null || typeof spec.weights !== 'object' || Array.isArray(spec.weights)) throw new Error('Training weights must be an object')
  Object.values(spec.weights).forEach(value => number(value, 0, Number.MAX_VALUE, false))
  const evaluation = object(recipe.evaluation, ['episodes', 'stepsPerEpisode', 'seed', 'maxTerminations', 'minMeanUprightFraction'], ['dance'])
  if (Object.hasOwn(evaluation, 'dance')) validateDanceCriteria(evaluation.dance)
  const episodes = number(evaluation.episodes, 1, 2147483647)
  number(evaluation.stepsPerEpisode, 1, Number.MAX_SAFE_INTEGER); number(evaluation.seed, 0, 2147483647 - episodes)
  number(evaluation.maxTerminations, 0, episodes); number(evaluation.minMeanUprightFraction, 0, 1, false)
}
