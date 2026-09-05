/**
 * Domain types for the supply-chain emulator seam. Types only — no runtime code.
 *
 * These mirror the ISOMORPH demo simulator's config keys and `SimResult`
 * outputs, in DSH naming. The bridge adapter converts between the two.
 * @module @deepseek-ai/dsh-supply-chain/types
 */

/**
 * Tunable inputs of one simulation run. Every field is required at this seam:
 * the simulator applies its own defaults for missing keys, and a half-specified
 * run would not be reproducible from the session log.
 */
export interface SimulationConfig {
  /** Simulated horizon in days (1..1000). */
  readonly days: number
  /** Number of distinct items carried through the network (1..5). */
  readonly items: number
  /** PRNG seed; equal seed and config reproduce a run exactly. */
  readonly seed: number
  /** Multiplier on the order pipeline target, in units of lead time (0..15). */
  readonly pipelineMultiplier: number
  /** Lower bound of per-item demand autocorrelation (0.5..0.999). */
  readonly phiLow: number
  /** Upper bound of per-item demand autocorrelation; must be >= phiLow (0.5..0.9999). */
  readonly phiHigh: number
  /** Multiplier on how many demand shocks occur (0..6). */
  readonly shockCountScale: number
  /** Multiplier on demand shock height (0..6). */
  readonly shockHeightScale: number
  /** Multiplier on demand burst arrival rate (0..6). */
  readonly burstRateScale: number
  /** Multiplier on demand burst height (0..8). */
  readonly burstHeightScale: number
  /** Multiplier on the seasonal demand component (0..6). */
  readonly seasonalScale: number
  /** Lower bound of the per-item base demand rate, in units per day. */
  readonly baseLambdaLow: number
  /** Upper bound of the per-item base demand rate; must be >= baseLambdaLow. */
  readonly baseLambdaHigh: number
  /** Multiplier on per-lane container capacity (0.1..3). */
  readonly capacityScale: number
  /** Multiplier on every node's safety stock (0.1..3). */
  readonly safetyStockScale: number
  /** Multiplier on every lane's lead time (0.5..20). */
  readonly leadTimeScale: number
  /** Lane singled out for disruption as `[sourceNodeId, targetNodeId]`, or null for none. */
  readonly disruptionEdge: readonly [string, string] | null
  /** Per-day probability that the disruption lane fails (0..0.3). */
  readonly disruptionProbability: number
  /** Days one disruption keeps the lane closed (1..60). */
  readonly disruptionDuration: number
  /** Cost charged per unit of on-hand inventory per day; used only to score a run. */
  readonly holdingCost: number
  /** Penalty charged per unit of backlog per day; used only to score a run. */
  readonly backlogPenalty: number
}

/** One geo-located facility and its per-day state, indexed `[item][day]`. */
export interface NetworkNode {
  /** Stable node id, unique within a network. */
  readonly id: string
  /** WGS84 latitude in degrees. */
  readonly latitude: number
  /** WGS84 longitude in degrees. */
  readonly longitude: number
  /** Echelon index; 0 is the demand destination, higher is further upstream. */
  readonly tier: number
  /** On-hand inventory indexed `[item][day]`. */
  readonly inventory: readonly (readonly number[])[]
  /** Unfilled demand indexed `[item][day]`. */
  readonly backlog: readonly (readonly number[])[]
  /** Units arriving at this node indexed `[item][day]`; the bullwhip order signal. */
  readonly inflow: readonly (readonly number[])[]
  /** Units dispatched from this node indexed `[item][day]`. */
  readonly outflow: readonly (readonly number[])[]
}

/** One directed transport lane and its per-day capacity pressure. */
export interface NetworkEdge {
  /** Upstream node id. */
  readonly source: string
  /** Downstream node id. */
  readonly target: string
  /** Units of all items this lane can move per day. */
  readonly capacity: number
  /** Fraction of capacity used, indexed by day. */
  readonly utilization: readonly number[]
}

/** One batch of goods in transit, used to animate the globe during replay. */
export interface Shipment {
  /** Run-unique shipment id. */
  readonly id: number
  /** Index into the run's item list. */
  readonly item: number
  /** Units carried. */
  readonly units: number
  /** Day the shipment left its source node. */
  readonly departureDay: number
  /** Day the shipment reaches its final node. */
  readonly arrivalDay: number
  /** Node ids the shipment traverses, source first. */
  readonly pathNodes: readonly string[]
}

/** One realized lane closure. */
export interface Disruption {
  /** First closed day. */
  readonly startDay: number
  /** Number of days the lane stayed closed. */
  readonly durationDays: number
  /** Upstream node id of the closed lane. */
  readonly source: string
  /** Downstream node id of the closed lane. */
  readonly target: string
}

/** The simulated network and its full per-day history. */
export interface SupplyChainNetwork {
  /** ISO 8601 timestamp mapped to day 0, anchoring the replay clock. */
  readonly startTime: string
  /** Simulated horizon in days. */
  readonly days: number
  /** Item ids, indexed by item. */
  readonly itemIds: readonly string[]
  /** Every facility in the network. */
  readonly nodes: readonly NetworkNode[]
  /** Every transport lane in the network. */
  readonly edges: readonly NetworkEdge[]
  /** Every shipment dispatched during the run. */
  readonly shipments: readonly Shipment[]
  /** Every lane closure realized during the run. */
  readonly disruptions: readonly Disruption[]
}

/** One item's service outcome over the whole horizon. */
export interface ItemResult {
  /** Item id. */
  readonly item: string
  /** Share of demand served from stock on the day it arrived, in 0..1. */
  readonly fillRate: number
  /** Total units demanded at the destination across the horizon. */
  readonly totalDemand: number
  /** Total units left unfilled, summed over nodes and days. */
  readonly totalBacklog: number
  /** Holding plus backlog cost implied by this run's cost parameters. */
  readonly totalCost: number
}

/**
 * Per-node inventory, backlog, and flow over time — the first of the three
 * reports. Every series is indexed by day for the selected node and item.
 */
export interface NodeReport {
  /** Report discriminant. */
  readonly kind: 'node'
  /** Node the series describe. */
  readonly nodeId: string
  /** Item the series describe. */
  readonly item: string
  /** On-hand inventory by day. */
  readonly inventory: readonly number[]
  /** Backlog by day. */
  readonly backlog: readonly number[]
  /** Units arriving by day. */
  readonly inflow: readonly number[]
  /** Units dispatched by day. */
  readonly outflow: readonly number[]
}

/** Demand-variance amplification for one echelon. */
export interface BullwhipTier {
  /** Echelon index; 0 is the demand destination. */
  readonly tier: number
  /** Node ids in this echelon. */
  readonly nodeIds: readonly string[]
  /** Mean inflow variance across this echelon's nodes. */
  readonly inflowVariance: number
  /** Mean demand variance across this echelon's nodes. */
  readonly demandVariance: number
  /** Inflow variance over demand variance; 1 means no amplification. */
  readonly amplification: number
}

/**
 * Order-variance amplification by echelon — the second of the three reports.
 * Follows the upstream analysis: per node and item, variance of inflow over
 * variance of demand, averaged within each echelon.
 */
export interface BullwhipReport {
  /** Report discriminant. */
  readonly kind: 'bullwhip'
  /** Item the measurements describe. */
  readonly item: string
  /** One entry per echelon, ordered destination first. */
  readonly tiers: readonly BullwhipTier[]
}

/** Capacity pressure on one lane across the horizon. */
export interface EdgeUtilization {
  /** Upstream node id. */
  readonly source: string
  /** Downstream node id. */
  readonly target: string
  /** Units per day this lane can move. */
  readonly capacity: number
  /** Mean utilization across the horizon. */
  readonly meanUtilization: number
  /** Highest single-day utilization. */
  readonly peakUtilization: number
  /** Number of days utilization reached or exceeded capacity. */
  readonly saturatedDays: number
}

/**
 * Lane capacity pressure across the network — the third of the three reports.
 */
export interface EdgeReport {
  /** Report discriminant. */
  readonly kind: 'edge'
  /** One entry per lane, most saturated first. */
  readonly edges: readonly EdgeUtilization[]
}

/** The three reports a completed run exposes. */
export type SupplyChainReport = NodeReport | BullwhipReport | EdgeReport

/** Which of the three reports to read. */
export type ReportKind = SupplyChainReport['kind']

/** A completed simulation run. */
export interface SimulationRun {
  /** Run id, unique within the seam's store. */
  readonly id: string
  /** The exact config that produced this run. */
  readonly config: SimulationConfig
  /** The simulated network and its history. */
  readonly network: SupplyChainNetwork
  /** Per-item service outcomes. */
  readonly results: readonly ItemResult[]
}

/** Error codes the supply-chain seam raises. */
export type SupplyChainErrorCode =
  | 'supply_chain_invalid_config'
  | 'supply_chain_unknown_run'
  | 'supply_chain_unknown_node'
  | 'supply_chain_unknown_item'
  | 'supply_chain_simulator_unavailable'
  | 'supply_chain_simulator_failed'

/** Failure raised by the supply-chain seam, carrying a stable machine-readable code. */
export class SupplyChainError extends Error {
  /**
   * @param code - stable machine-readable failure code.
   * @param message - human-readable explanation.
   */
  constructor(readonly code: SupplyChainErrorCode, message: string) {
    super(message)
    this.name = 'SupplyChainError'
  }
}

/**
 * Service Provider contract for the supply-chain seam. A provider turns a
 * validated config into a completed run; the seam owns run storage and report
 * derivation, so a provider holds no state about past runs.
 */
export interface SupplyChainProvider {
  /**
   * Simulate one run.
   * @param config - a config already validated by the seam.
   * @param runId - the id the seam assigned to this run.
   * @param signal - abort signal cancelling the underlying simulator.
   * @returns the completed run.
   * @throws {SupplyChainError} when the simulator is unavailable or fails.
   */
  simulate(config: SimulationConfig, runId: string, signal: AbortSignal): Promise<SimulationRun>
}
