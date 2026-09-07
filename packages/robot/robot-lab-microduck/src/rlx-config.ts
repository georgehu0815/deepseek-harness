/** Configurable numerical inputs for the independently identified RLX learner. */
import z from '@deepseek-ai/schemastery'

/** Deployment defaults resolved and frozen by the Python adapter before admission. */
export interface RlxPpoConfig {
  /** Maximum control steps per environment in each rollout batch. */
  horizon: number
  /** Requested minibatch count; admission resolves a divisor for a bounded batch. */
  numMinibatches: number
  /** Optimization passes per collected batch. */
  epochs: number
  /** Constant Adam learning rate. */
  learningRate: number
  /** Future-reward discount, inclusive zero through one. */
  gamma: number
  /** Generalized advantage trace coefficient, inclusive zero through one. */
  gaeLambda: number
  /** Normalize advantages within each optimization minibatch. */
  normalizeAdvantages: boolean
  /** PPO probability-ratio clipping radius. */
  clipCoefficient: number
  /** Clip critic updates against the previous value estimates. */
  clipValueLoss: boolean
  /** Nonnegative entropy bonus coefficient. */
  entropyCoefficient: number
  /** Nonnegative critic loss coefficient. */
  valueCoefficient: number
  /** Positive gradient norm ceiling. */
  maxGradNorm: number
  /** Positive normalized-observation clipping bound. */
  observationClip: number
  /** Positive stabilizer added to observation variance. */
  normalizationEpsilon: number
  /** Minimum episode horizon; longer frozen clips extend it. */
  minimumEpisodeSeconds: number
}

/** RLX settings are deployment inputs, not hidden constants in the training loop. */
export const RlxPpoConfig: z<Partial<RlxPpoConfig>, RlxPpoConfig> = z.object({
  horizon: z.natural().default(24), numMinibatches: z.natural().default(4), epochs: z.natural().default(5),
  learningRate: z.number().default(3e-4), gamma: z.number().default(0.99), gaeLambda: z.number().default(0.95),
  normalizeAdvantages: z.boolean().default(true), clipCoefficient: z.number().default(0.2), clipValueLoss: z.boolean().default(true),
  entropyCoefficient: z.number().default(0.01), valueCoefficient: z.number().default(1), maxGradNorm: z.number().default(0.5),
  observationClip: z.number().default(10), normalizationEpsilon: z.number().default(1e-8), minimumEpisodeSeconds: z.number().default(4),
})

/** Reject invalid numerical settings at provider activation.
 * @param config - Fully default-resolved RLX settings.
 */
export function validateRlxPpo(config: RlxPpoConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'boolean') continue
    if (!Number.isFinite(value)) throw new Error(`RLX ${key} must be finite`)
    if (['horizon', 'numMinibatches', 'epochs'].includes(key) && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`RLX ${key} must be a positive safe integer`)
    if (['gamma', 'gaeLambda'].includes(key)) {
      if (value < 0 || value > 1) throw new Error(`RLX ${key} must be between zero and one`)
    } else if (['entropyCoefficient', 'valueCoefficient'].includes(key)) {
      if (value < 0) throw new Error(`RLX ${key} must be nonnegative`)
    } else if (value <= 0) throw new Error(`RLX ${key} must be positive`)
  }
}
