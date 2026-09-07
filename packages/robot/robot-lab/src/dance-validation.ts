/** JSON validation shared by requested choreography criteria and persisted scientific plans. */
import type { RobotDanceCriteria } from './types.ts'

/** Validate explicit versioned thresholds without choosing or calibrating defaults.
 * @param value - Untrusted model, browser or persisted criteria.
 * @returns Validated criteria in the caller's object; no input is normalized or mutated.
 */
export function validateDanceCriteria(value: unknown): RobotDanceCriteria {
  const fail = (message: string): never => { throw new Error(`Invalid dance criteria: ${message}`) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
  const row = value as Record<string, unknown>
  const keys = ['version', 'requiredCycles', 'minPassedEpisodeFraction', 'maxJointRmseRad',
    'maxRootOrientationRmseRad', 'movingJointIndices', 'minReferenceExcursionRad', 'minAmplitudeRatio',
    'maxAmplitudeRatio', 'minReferenceGainRatio', 'maxHorizontalDriftMeters']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) fail('missing or unsupported fields')
  const finite = (item: unknown, name: string, positive: boolean): number => {
    if (typeof item !== 'number' || !Number.isFinite(item) || (positive ? item <= 0 : item < 0)) fail(`${name} must be finite and ${positive ? 'positive' : 'nonnegative'}`)
    return item as number
  }
  if (row.version !== 1 && row.version !== 2) fail('unsupported version')
  const cycles = finite(row.requiredCycles, 'requiredCycles', true)
  if (!Number.isSafeInteger(cycles)) fail('requiredCycles must be an integer')
  if (finite(row.minPassedEpisodeFraction, 'minPassedEpisodeFraction', true) > 1) fail('episode fraction exceeds one')
  if (!Array.isArray(row.maxJointRmseRad) || row.maxJointRmseRad.length !== 14) fail('fourteen joint thresholds required')
  for (const value of row.maxJointRmseRad as unknown[]) finite(value, 'joint RMSE', false)
  const joints = row.movingJointIndices
  if (!Array.isArray(joints) || joints.length < 1 || joints.length > 14) fail('one to fourteen moving joint indices required')
  const indices = joints as unknown[]
  if (indices.some(index => typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 13)
    || new Set(indices).size !== indices.length) fail('moving joint indices must be unique integers in [0,13]')
  finite(row.maxRootOrientationRmseRad, 'root RMSE', false)
  finite(row.maxHorizontalDriftMeters, 'horizontal drift', false)
  finite(row.minReferenceExcursionRad, 'reference excursion', true)
  finite(row.minReferenceGainRatio, 'reference gain', true)
  const minimum = finite(row.minAmplitudeRatio, 'minimum amplitude', true)
  if (finite(row.maxAmplitudeRatio, 'maximum amplitude', true) < minimum) fail('maximum amplitude is below minimum')
  return row as unknown as RobotDanceCriteria
}
