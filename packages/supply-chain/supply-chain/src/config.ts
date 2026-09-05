/**
 * Config defaults, bounds, and scenario presets for the supply-chain seam.
 *
 * Bounds are the seam's own contract, not the simulator's: the simulator
 * silently clamps or defaults out-of-range keys, which would make a run's
 * config a poor record of what actually ran. Validating here means a stored
 * config always reproduces its run.
 * @module @deepseek-ai/dsh-supply-chain/config
 */

import { SupplyChainError, type SimulationConfig } from './types.ts'

/** Inclusive numeric bounds for one config field. */
interface Bound {
  /** Smallest accepted value. */
  readonly min: number
  /** Largest accepted value. */
  readonly max: number
  /** Whether the field must be a whole number. */
  readonly integer?: true
}

/** Accepted range of every numeric config field, keyed by field name. */
export const CONFIG_BOUNDS: Readonly<Record<string, Bound>> = Object.freeze({
  days: { min: 10, max: 500, integer: true },
  items: { min: 1, max: 5, integer: true },
  seed: { min: 0, max: 2_147_483_647, integer: true },
  pipelineMultiplier: { min: 0, max: 15 },
  phiLow: { min: 0.5, max: 0.999 },
  phiHigh: { min: 0.5, max: 0.9999 },
  shockCountScale: { min: 0, max: 6 },
  shockHeightScale: { min: 0, max: 6 },
  burstRateScale: { min: 0, max: 6 },
  burstHeightScale: { min: 0, max: 8 },
  seasonalScale: { min: 0, max: 6 },
  baseLambdaLow: { min: 1, max: 5_000 },
  baseLambdaHigh: { min: 1, max: 5_000 },
  capacityScale: { min: 0.1, max: 3 },
  safetyStockScale: { min: 0.1, max: 3 },
  leadTimeScale: { min: 0.5, max: 20 },
  disruptionProbability: { min: 0, max: 0.3 },
  disruptionDuration: { min: 1, max: 60, integer: true },
  holdingCost: { min: 0, max: 1_000 },
  backlogPenalty: { min: 0, max: 1_000 },
})

/** The unmodified baseline scenario. */
export const DEFAULT_SIMULATION_CONFIG: Readonly<SimulationConfig> = Object.freeze({
  days: 200,
  items: 3,
  seed: 42,
  pipelineMultiplier: 7,
  phiLow: 0.95,
  phiHigh: 0.97,
  shockCountScale: 1,
  shockHeightScale: 1,
  burstRateScale: 1,
  burstHeightScale: 1,
  seasonalScale: 1,
  baseLambdaLow: 80,
  baseLambdaHigh: 250,
  capacityScale: 1,
  safetyStockScale: 1,
  leadTimeScale: 1,
  disruptionEdge: null,
  disruptionProbability: 0,
  disruptionDuration: 10,
  holdingCost: 1,
  backlogPenalty: 5,
})

/**
 * Named scenarios worth comparing against the baseline. Each isolates one
 * failure mode the emulator is meant to show; the tool surface offers them by
 * name so a run can be requested without restating twenty fields.
 */
export const SIMULATION_PRESETS: Readonly<Record<string, Readonly<SimulationConfig>>> = Object.freeze({
  baseline: DEFAULT_SIMULATION_CONFIG,
  demandShock: Object.freeze({
    ...DEFAULT_SIMULATION_CONFIG,
    shockHeightScale: 4,
    burstRateScale: 2,
    burstHeightScale: 3,
  }),
  disruption: Object.freeze({
    ...DEFAULT_SIMULATION_CONFIG,
    disruptionEdge: ['Atlanta', 'Chicago'] as const,
    disruptionProbability: 0.08,
    disruptionDuration: 14,
  }),
  lowCapacity: Object.freeze({
    ...DEFAULT_SIMULATION_CONFIG,
    capacityScale: 0.4,
  }),
  thinSafetyStock: Object.freeze({
    ...DEFAULT_SIMULATION_CONFIG,
    safetyStockScale: 0.2,
  }),
})

/** Name of a built-in scenario preset. */
export type SimulationPresetId = keyof typeof SIMULATION_PRESETS

/**
 * Validate a candidate config, filling absent fields from the baseline.
 * @param candidate - partial config supplied by a tool call or the panel.
 * @returns a complete config whose every field is within bounds.
 * @throws {SupplyChainError} with `supply_chain_invalid_config` when a field is
 * out of range, non-finite, non-integral where integrality is required, or when
 * a paired bound is inverted.
 */
export function resolveConfig(candidate: Partial<SimulationConfig>): SimulationConfig {
  const merged: SimulationConfig = { ...DEFAULT_SIMULATION_CONFIG, ...candidate }

  for (const [field, bound] of Object.entries(CONFIG_BOUNDS)) {
    const value = merged[field as keyof SimulationConfig] as number
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SupplyChainError('supply_chain_invalid_config', `${field} must be a finite number`)
    }
    if (bound.integer === true && !Number.isInteger(value)) {
      throw new SupplyChainError('supply_chain_invalid_config', `${field} must be a whole number`)
    }
    if (value < bound.min || value > bound.max) {
      throw new SupplyChainError(
        'supply_chain_invalid_config',
        `${field} must be between ${bound.min} and ${bound.max}, got ${value}`,
      )
    }
  }

  if (merged.phiHigh < merged.phiLow) {
    throw new SupplyChainError('supply_chain_invalid_config', 'phiHigh must be greater than or equal to phiLow')
  }
  if (merged.baseLambdaHigh < merged.baseLambdaLow) {
    throw new SupplyChainError(
      'supply_chain_invalid_config',
      'baseLambdaHigh must be greater than or equal to baseLambdaLow',
    )
  }
  if (merged.disruptionEdge !== null) {
    const [source, target] = merged.disruptionEdge
    if (source.length === 0 || target.length === 0) {
      throw new SupplyChainError('supply_chain_invalid_config', 'disruptionEdge endpoints must be non-empty node ids')
    }
  }

  return merged
}
