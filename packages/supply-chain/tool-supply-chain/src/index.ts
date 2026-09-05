/**
 * Model-facing supply-chain emulator tools: run a scenario
 * (`supply_chain_simulate`), list what has been run (`supply_chain_runs`), and
 * read one of the three reports (`supply_chain_report`).
 *
 * Simulation is expensive relative to a tool call and its full per-day history
 * is far too large to put in a model turn, so `supply_chain_simulate` returns
 * only the run id and its headline service outcomes. The model then pulls the
 * one report it needs, already reduced to the numbers that answer a question:
 * a node's series, echelon amplification, or lane pressure.
 * @module @deepseek-ai/dsh-tool-supply-chain
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CONFIG_BOUNDS, SIMULATION_PRESETS } from '@deepseek-ai/dsh-supply-chain'
import type { SimulationConfig, SupplyChainReport } from '@deepseek-ai/dsh-supply-chain'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-supply-chain'
/** Services required by the supply-chain tools. */
export const inject = ['tools', 'supplyChain']

/** Preset names offered to the model. */
const PRESET_IDS = Object.keys(SIMULATION_PRESETS)

/**
 * Append a field's accepted range to its description.
 *
 * The tool schema DSL carries no numeric bounds, so the range reaches the model
 * as prose. Reading it from {@link CONFIG_BOUNDS} keeps the seam the single
 * home for the fact the runtime actually enforces.
 * @param field - config field name.
 * @param text - what the field does.
 * @returns the model-facing description including the accepted range.
 */
function describe(field: keyof typeof CONFIG_BOUNDS, text: string): string {
  const bound = CONFIG_BOUNDS[field]
  if (bound === undefined) throw new Error(`missing config bounds for ${field}`)
  return `${text} Accepted range ${bound.min} to ${bound.max}.`
}

/**
 * Config fields the model may override. Each entry's `type` must stay literal
 * for the argument types to survive; only the descriptions are computed.
 */
const OVERRIDES = {
  days: { type: 'integer', description: describe('days', 'Simulated horizon in days.') },
  items: { type: 'integer', description: describe('items', 'Number of distinct items (SKUs) carried through the network.') },
  seed: { type: 'integer', description: describe('seed', 'Random seed; the same seed and settings reproduce a run exactly.') },
  capacityScale: { type: 'number', description: describe('capacityScale', 'Multiplier on per-lane shipping capacity. Below 1 starves the network.') },
  safetyStockScale: { type: 'number', description: describe('safetyStockScale', "Multiplier on every node's safety stock. Below 1 makes stockouts likelier.") },
  leadTimeScale: { type: 'number', description: describe('leadTimeScale', "Multiplier on every lane's transit time. Above 1 lengthens the pipeline.") },
  shockHeightScale: { type: 'number', description: describe('shockHeightScale', 'Multiplier on the size of sustained demand shocks.') },
  burstRateScale: { type: 'number', description: describe('burstRateScale', 'Multiplier on how often short demand bursts arrive.') },
  burstHeightScale: { type: 'number', description: describe('burstHeightScale', 'Multiplier on the size of short demand bursts.') },
  seasonalScale: { type: 'number', description: describe('seasonalScale', 'Multiplier on the seasonal component of demand.') },
  disruptionProbability: { type: 'number', description: describe('disruptionProbability', 'Per-day chance the chosen lane closes.') },
  disruptionDuration: { type: 'integer', description: describe('disruptionDuration', 'Days a lane stays closed once it fails.') },
  holdingCost: { type: 'number', description: describe('holdingCost', 'Cost per unit of inventory per day; scores the run only.') },
  backlogPenalty: { type: 'number', description: describe('backlogPenalty', 'Penalty per unit of unmet demand per day; scores the run only.') },
} as const

/** The overridable field schemas, exposed so a test can pin them to the seam's bounds. */
export const OVERRIDE_SCHEMAS: Readonly<Record<string, { type: string; description: string }>> = OVERRIDES

/**
 * Format a fraction as a percentage with one decimal.
 * @param value - the fraction.
 * @returns the formatted percentage.
 */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/** Normalize an optional lane tuple and reject every other length. */
function disruptionEdge(value: readonly string[] | undefined): readonly [string, string] | undefined {
  if (value === undefined) return undefined
  const [source, target, ...extra] = value
  if (source === undefined || target === undefined || extra.length > 0) {
    throw new Error('disruptionEdge must name exactly two nodes: [sourceNode, targetNode]')
  }
  return [source, target]
}

/**
 * Register the supply-chain tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the seam.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'supply_chain_simulate',
    description:
      'Run one supply-chain scenario over a multi-echelon shipping network and return its service outcomes. '
      + `Start from a named preset (${PRESET_IDS.join(', ')}) and override individual settings as needed. `
      + 'Returns a run id plus per-SKU fill rate, demand, backlog, and cost — not the full history. '
      + 'Use supply_chain_report to read the day-by-day detail behind a run.',
    parameters: {
      preset: {
        type: 'string',
        enum: PRESET_IDS,
        description: 'Scenario to start from. Defaults to baseline (a healthy network).',
      },
      disruptionEdge: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Lane to disrupt as [sourceNode, targetNode], for example ["Atlanta", "Chicago"]. '
          + 'Only takes effect together with a non-zero disruptionProbability.',
      },
      ...OVERRIDES,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          days: { type: 'number', required: true },
          nodeCount: { type: 'number', required: true },
          edgeCount: { type: 'number', required: true },
          disruptionCount: { type: 'number', required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                item: { type: 'string', required: true },
                fillRate: { type: 'number', required: true },
                totalDemand: { type: 'number', required: true },
                totalBacklog: { type: 'number', required: true },
                totalCost: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Run ${value.runId}: ${value.days} days, ${value.nodeCount} nodes, ${value.edgeCount} lanes, `
          + `${value.disruptionCount} lane closures.`,
          ...value.results.map(result =>
            `  ${result.item}: fill ${percent(result.fillRate)}, demand ${Math.round(result.totalDemand)}, `
            + `backlog ${Math.round(result.totalBacklog)}, cost ${Math.round(result.totalCost)}`),
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { preset, disruptionEdge: requestedEdge, ...overrides } = args
      const base = preset === undefined ? {} : ctx.supplyChain.preset(preset)
      const edge = disruptionEdge(requestedEdge)
      const candidate: Partial<SimulationConfig> = {
        ...base,
        ...overrides,
        ...(edge === undefined ? {} : { disruptionEdge: edge }),
      }

      const run = await ctx.supplyChain.simulate(candidate, exec.signal)
      return {
        runId: run.id,
        days: run.network.days,
        nodeCount: run.network.nodes.length,
        edgeCount: run.network.edges.length,
        disruptionCount: run.network.disruptions.length,
        results: run.results.map(result => ({ ...result })),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Simulate supply chain${args.preset === undefined ? '' : ` (${args.preset})`}`,
      kind: 'other',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'supply_chain_runs',
    description:
      'List the completed supply-chain runs still retained, newest last, with the settings that produced '
      + 'each one. Use it to recover a run id before reading a report, or to compare what was tried.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                runId: { type: 'string', required: true },
                days: { type: 'number', required: true },
                items: { type: 'number', required: true },
                seed: { type: 'number', required: true },
                nodeIds: { type: 'array', required: true, items: { type: 'string' } },
                itemIds: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.runs.length === 0
          ? 'No supply-chain runs yet. Call supply_chain_simulate first.'
          : value.runs
            .map(run => `${run.runId}: ${run.days} days, ${run.items} items, seed ${run.seed}`)
            .join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    execute() {
      return Promise.resolve({
        runs: ctx.supplyChain.listRuns().map((runId) => {
          const run = ctx.supplyChain.getRun(runId)
          return {
            runId,
            days: run.config.days,
            items: run.config.items,
            seed: run.config.seed,
            nodeIds: run.network.nodes.map(node => node.id),
            itemIds: [...run.network.itemIds],
          }
        }),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'List supply-chain runs', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'supply_chain_report',
    description:
      'Read one of a run\'s three reports. "node" gives one facility\'s inventory, backlog, and flow by day '
      + '(needs nodeId and item). "bullwhip" gives order-variance amplification by echelon, showing where '
      + 'demand distortion is created (needs item). "edge" ranks every lane by capacity pressure. '
      + 'Omit runId to read the most recent run.',
    parameters: {
      kind: {
        type: 'string',
        enum: ['node', 'bullwhip', 'edge'],
        required: true,
        description: 'Which report to read.',
      },
      runId: { type: 'string', description: 'Run to read. Defaults to the most recent run.' },
      nodeId: { type: 'string', description: 'Facility to report on. Required for the node report.' },
      item: { type: 'string', description: 'Item to report on, e.g. I01. Required for node and bullwhip.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { kind: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const runId = args.runId ?? ctx.supplyChain.latestRun()?.id
      if (runId === undefined) {
        throw new Error('no supply-chain run to report on; call supply_chain_simulate first')
      }

      if (args.kind === 'edge') return Promise.resolve(asJson(ctx.supplyChain.edgeReport(runId)))
      if (args.item === undefined) {
        throw new Error(`the ${args.kind} report requires an item, e.g. I01`)
      }
      if (args.kind === 'bullwhip') return Promise.resolve(asJson(ctx.supplyChain.bullwhipReport(runId, args.item)))
      if (args.nodeId === undefined) {
        throw new Error('the node report requires a nodeId; call supply_chain_runs to see the facilities')
      }
      return Promise.resolve(asJson(ctx.supplyChain.nodeReport(runId, args.nodeId, args.item)))
    },
    presentCall: args => ({
      card: 'generic',
      title: `Read supply-chain ${args.kind} report`,
      kind: 'other',
    }),
  }))
}

/**
 * Present a report as the tool result's JSON record.
 *
 * Every report is built from numbers, strings, and arrays of them, so it is
 * JSON-serializable by construction; the cast only tells the compiler what its
 * `readonly` array types hide.
 * @param report - a report from the seam.
 * @returns the same value typed as a tool-result record.
 */
function asJson(report: SupplyChainReport): { kind: string } & Record<string, JsonValue> {
  return report as unknown as { kind: string } & Record<string, JsonValue>
}

/**
 * Summarize a report for the model, reducing long day-series to the facts that
 * distinguish one run from another.
 * @param value - the report returned by the seam.
 * @returns the model-facing summary text.
 */
function renderReport(value: Record<string, unknown>): string {
  if (value.kind === 'edge') {
    const edges = value.edges as Array<{
      source: string
      target: string
      meanUtilization: number
      peakUtilization: number
      saturatedDays: number
    }>
    return [
      'Lane capacity pressure (most loaded first):',
      ...edges.map(edge =>
        `  ${edge.source} → ${edge.target}: mean ${percent(edge.meanUtilization)}, `
        + `peak ${percent(edge.peakUtilization)}, ${edge.saturatedDays} days at or above capacity`),
    ].join('\n')
  }

  if (value.kind === 'bullwhip') {
    const tiers = value.tiers as { tier: number; nodeIds: string[]; amplification: number }[]
    return [
      `Order-variance amplification for ${String(value.item)} (tier 0 is the demand destination):`,
      ...tiers.map(tier =>
        `  tier ${tier.tier} (${tier.nodeIds.join(', ')}): ${tier.amplification.toFixed(2)}x`),
    ].join('\n')
  }

  const inventory = value.inventory as number[]
  const backlog = value.backlog as number[]
  const mean = (series: number[]) => series.reduce((sum, each) => sum + each, 0) / Math.max(series.length, 1)
  return [
    `${String(value.nodeId)} / ${String(value.item)} over ${inventory.length} days:`,
    `  inventory: mean ${Math.round(mean(inventory))}, min ${Math.round(Math.min(...inventory))}, `
    + `max ${Math.round(Math.max(...inventory))}`,
    `  backlog: mean ${Math.round(mean(backlog))}, peak ${Math.round(Math.max(...backlog))}, `
    + `${backlog.filter(units => units > 0).length} days with unmet demand`,
  ].join('\n')
}
