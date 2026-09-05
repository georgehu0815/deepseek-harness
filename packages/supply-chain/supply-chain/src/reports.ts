/**
 * Derivation of the emulator's three reports from a completed run.
 *
 * Reports are pure functions of the stored run, never separate state: the run
 * is the single authoritative source, so the panel, the tools, and replay all
 * read the same numbers.
 * @module @deepseek-ai/dsh-supply-chain/reports
 */

import {
  SupplyChainError,
  type BullwhipReport,
  type BullwhipTier,
  type EdgeReport,
  type EdgeUtilization,
  type NodeReport,
  type SimulationRun,
} from './types.ts'

/**
 * Sample variance of a series, matching the upstream analysis' `ddof=1`.
 * @param values - the samples.
 * @returns the sample variance, or 0 for series shorter than two samples.
 */
export function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
}

/**
 * Resolve an item id to its index within a run.
 * @param run - the run to look in.
 * @param item - the item id.
 * @returns the item's index.
 * @throws {SupplyChainError} with `supply_chain_unknown_item` when absent.
 */
function itemIndex(run: SimulationRun, item: string): number {
  const index = run.network.itemIds.indexOf(item)
  if (index < 0) {
    throw new SupplyChainError(
      'supply_chain_unknown_item',
      `run ${run.id} has no item ${item}; available: ${run.network.itemIds.join(', ')}`,
    )
  }
  return index
}

/** Return one item's series, failing loud when simulator output violates its item dimensions. */
function itemSeries(
  run: SimulationRun,
  nodeId: string,
  item: string,
  field: string,
  values: readonly (readonly number[])[],
  index: number,
): readonly number[] {
  const series = values[index]
  if (series === undefined) {
    throw new SupplyChainError(
      'supply_chain_simulator_failed',
      `run ${run.id} node ${nodeId} has no ${field} series for item ${item}`,
    )
  }
  return series
}

/**
 * Build the per-node time-series report.
 * @param run - the completed run.
 * @param nodeId - the node to report on.
 * @param item - the item to report on.
 * @returns inventory, backlog, inflow, and outflow by day.
 * @throws {SupplyChainError} when the node or item is not in the run.
 */
export function buildNodeReport(run: SimulationRun, nodeId: string, item: string): NodeReport {
  const node = run.network.nodes.find(candidate => candidate.id === nodeId)
  if (node === undefined) {
    throw new SupplyChainError(
      'supply_chain_unknown_node',
      `run ${run.id} has no node ${nodeId}; available: ${run.network.nodes.map(each => each.id).join(', ')}`,
    )
  }
  const index = itemIndex(run, item)
  return {
    kind: 'node',
    nodeId,
    item,
    inventory: itemSeries(run, nodeId, item, 'inventory', node.inventory, index),
    backlog: itemSeries(run, nodeId, item, 'backlog', node.backlog, index),
    inflow: itemSeries(run, nodeId, item, 'inflow', node.inflow, index),
    outflow: itemSeries(run, nodeId, item, 'outflow', node.outflow, index),
  }
}

/**
 * Build the bullwhip report: inflow-variance amplification by echelon.
 *
 * Per node, the demand proxy is that node's outflow — what the tier below drew
 * from it — and the order signal is its inflow. Amplification is the ratio of
 * the two variances, averaged within an echelon, matching the upstream
 * per-tier summary.
 * @param run - the completed run.
 * @param item - the item to measure.
 * @returns one entry per echelon, destination tier first.
 * @throws {SupplyChainError} when the item is not in the run.
 */
export function buildBullwhipReport(run: SimulationRun, item: string): BullwhipReport {
  const index = itemIndex(run, item)
  const byTier = new Map<number, { nodeIds: string[]; inflow: number[]; demand: number[] }>()

  for (const node of run.network.nodes) {
    const bucket = byTier.get(node.tier) ?? { nodeIds: [], inflow: [], demand: [] }
    bucket.nodeIds.push(node.id)
    bucket.inflow.push(sampleVariance(itemSeries(run, node.id, item, 'inflow', node.inflow, index)))
    bucket.demand.push(sampleVariance(itemSeries(run, node.id, item, 'outflow', node.outflow, index)))
    byTier.set(node.tier, bucket)
  }

  const tiers: BullwhipTier[] = [...byTier.entries()]
    .sort(([left], [right]) => left - right)
    .map(([tier, bucket]) => {
      const inflowVariance = bucket.inflow.reduce((sum, value) => sum + value, 0) / bucket.inflow.length
      const demandVariance = bucket.demand.reduce((sum, value) => sum + value, 0) / bucket.demand.length
      return {
        tier,
        nodeIds: bucket.nodeIds,
        inflowVariance,
        demandVariance,
        amplification: demandVariance === 0 ? 0 : inflowVariance / demandVariance,
      }
    })

  return { kind: 'bullwhip', item, tiers }
}

/**
 * Build the lane capacity-pressure report.
 * @param run - the completed run.
 * @returns one entry per lane, most saturated first.
 */
export function buildEdgeReport(run: SimulationRun): EdgeReport {
  const edges: EdgeUtilization[] = run.network.edges.map((edge) => {
    const used = edge.utilization
    const mean = used.length === 0 ? 0 : used.reduce((sum, value) => sum + value, 0) / used.length
    return {
      source: edge.source,
      target: edge.target,
      capacity: edge.capacity,
      meanUtilization: mean,
      peakUtilization: used.length === 0 ? 0 : Math.max(...used),
      saturatedDays: used.filter(value => value >= 1).length,
    }
  })
  return {
    kind: 'edge',
    edges: [...edges].sort((left, right) => right.meanUtilization - left.meanUtilization),
  }
}
