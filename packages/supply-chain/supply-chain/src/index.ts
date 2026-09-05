/**
 * Service Definition for the supply-chain emulator seam (`ctx.supplyChain`).
 *
 * Owns config validation, run identity, a bounded run store, and derivation of
 * the three reports. It holds no simulation logic: one replaceable
 * {@link SupplyChainProvider} produces runs, so the ISOMORPH subprocess bridge
 * can be swapped for another engine without touching the tools or the panel.
 *
 * Unlike the geo seam, no provider is built in — simulation needs an external
 * simulator checkout, so an unconfigured seam fails loud on first use rather
 * than silently serving a lesser model.
 * @module @deepseek-ai/dsh-supply-chain
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { resolveConfig, SIMULATION_PRESETS } from './config.ts'
import { buildBullwhipReport, buildEdgeReport, buildNodeReport } from './reports.ts'
import { SupplyChainError, type BullwhipReport, type EdgeReport, type NodeReport, type SimulationConfig, type SimulationRun, type SupplyChainProvider } from './types.ts'

export {
  CONFIG_BOUNDS,
  DEFAULT_SIMULATION_CONFIG,
  resolveConfig,
  SIMULATION_PRESETS,
} from './config.ts'
export { buildBullwhipReport, buildEdgeReport, buildNodeReport, sampleVariance } from './reports.ts'
export { SupplyChainError } from './types.ts'
export type { SimulationPresetId } from './config.ts'
export type {
  BullwhipReport,
  BullwhipTier,
  Disruption,
  EdgeReport,
  EdgeUtilization,
  ItemResult,
  NetworkEdge,
  NetworkNode,
  NodeReport,
  ReportKind,
  Shipment,
  SimulationConfig,
  SimulationRun,
  SupplyChainErrorCode,
  SupplyChainNetwork,
  SupplyChainProvider,
  SupplyChainReport,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    supplyChain: SupplyChainRuntime
  }

  interface Events {
    /**
     * One simulation finished and was committed to the run store. Emitted only
     * after the run is retrievable through {@link SupplyChainRuntime.getRun},
     * so a listener may read it back immediately. Listener failures are
     * contained by cordis and do not fail the run.
     * @param run - the completed run, already stored.
     * @mode emit
     */
    'supply-chain/run'(run: SimulationRun): void
  }
}

/** Config for the supply-chain seam. */
export interface SupplyChainRuntimeConfig {
  /** How many completed runs to retain; the oldest is evicted past this. */
  readonly maxRuns: number
}

/**
 * The supply-chain emulator service, registered as `ctx.supplyChain` (one
 * instance per context).
 */
export class SupplyChainRuntime extends TypertRemoteService {
  /** Seam config. */
  static Config: z<SupplyChainRuntimeConfig> = z.object({
    maxRuns: z.natural().default(8),
  })

  /** Completed runs in insertion order, oldest first. */
  private readonly runs = new Map<string, SimulationRun>()

  private provider: SupplyChainProvider | null = null

  private nextRunId = 1

  /** @param ctx - owning context. @param config - seam config. */
  constructor(ctx: Context, private readonly config: SupplyChainRuntimeConfig) {
    super(ctx, 'supplyChain')
  }

  /** How many completed runs this seam retains before evicting the oldest. */
  get retentionLimit(): number {
    return this.config.maxRuns
  }

  /**
   * Install the simulation provider.
   * @param provider - the provider to make active.
   * @returns a disposer that restores the previous provider.
   */
  registerProvider(provider: SupplyChainProvider): () => void {
    const previous = this.provider
    this.provider = provider
    return () => { this.provider = previous }
  }

  /**
   * Validate a config, run it, and store the result.
   * @param candidate - partial config; absent fields come from the baseline.
   * @param signal - abort signal forwarded to the provider.
   * @returns the completed run.
   * @throws {SupplyChainError} when the config is invalid, no provider is
   * installed, or the provider fails.
   */
  async simulate(candidate: Partial<SimulationConfig>, signal: AbortSignal): Promise<SimulationRun> {
    const provider = this.provider
    if (provider === null) {
      throw new SupplyChainError(
        'supply_chain_simulator_unavailable',
        'no supply-chain simulation provider is installed',
      )
    }

    const config = resolveConfig(candidate)
    const runId = `run-${this.nextRunId}`
    this.nextRunId += 1

    const run = await provider.simulate(config, runId, signal)

    // Publish only after the provider succeeds: a failed run must not appear in
    // the store, the panel, or the agent's view of history.
    this.runs.set(run.id, run)
    while (this.runs.size > this.config.maxRuns) {
      const oldest = this.runs.keys().next()
      if (oldest.done === true) break
      this.runs.delete(oldest.value)
    }
    this.ctx.emit('supply-chain/run', run)
    return run
  }

  /**
   * Read one stored run.
   * @param runId - the run's id.
   * @returns the run.
   * @throws {SupplyChainError} with `supply_chain_unknown_run` when the run is
   * absent or has been evicted.
   */
  getRun(runId: string): SimulationRun {
    const run = this.runs.get(runId)
    if (run === undefined) {
      throw new SupplyChainError(
        'supply_chain_unknown_run',
        `unknown run ${runId}; retained runs: ${[...this.runs.keys()].join(', ') || 'none'}`,
      )
    }
    return run
  }

  /**
   * The most recently completed run, if any.
   * @returns the newest stored run, or null when nothing has run yet.
   */
  latestRun(): SimulationRun | null {
    let latest: SimulationRun | null = null
    for (const run of this.runs.values()) latest = run
    return latest
  }

  /**
   * Ids of the retained runs, oldest first.
   * @returns the retained run ids.
   */
  listRuns(): readonly string[] {
    return [...this.runs.keys()]
  }

  /**
   * The names of the built-in scenario presets.
   * @returns preset names.
   */
  listPresets(): readonly string[] {
    return Object.keys(SIMULATION_PRESETS)
  }

  /**
   * Resolve a preset name to its config.
   * @param preset - a name from {@link listPresets}.
   * @returns the preset's complete config.
   * @throws {SupplyChainError} with `supply_chain_invalid_config` when unknown.
   */
  preset(preset: string): SimulationConfig {
    const config = SIMULATION_PRESETS[preset]
    if (config === undefined) {
      throw new SupplyChainError(
        'supply_chain_invalid_config',
        `unknown preset ${preset}; available: ${this.listPresets().join(', ')}`,
      )
    }
    return config
  }

  /**
   * Per-node inventory, backlog, and flow over time.
   * @param runId - the run to read.
   * @param nodeId - the node to report on.
   * @param item - the item to report on.
   * @returns the node report.
   * @throws {SupplyChainError} when the run, node, or item is unknown.
   */
  nodeReport(runId: string, nodeId: string, item: string): NodeReport {
    return buildNodeReport(this.getRun(runId), nodeId, item)
  }

  /**
   * Order-variance amplification by echelon.
   * @param runId - the run to read.
   * @param item - the item to measure.
   * @returns the bullwhip report.
   * @throws {SupplyChainError} when the run or item is unknown.
   */
  bullwhipReport(runId: string, item: string): BullwhipReport {
    return buildBullwhipReport(this.getRun(runId), item)
  }

  /**
   * Lane capacity pressure across the network.
   * @param runId - the run to read.
   * @returns the edge report.
   * @throws {SupplyChainError} with `supply_chain_unknown_run` when unknown.
   */
  edgeReport(runId: string): EdgeReport {
    return buildEdgeReport(this.getRun(runId))
  }

  /**
   * Run a scenario for the browser panel.
   *
   * Preset resolution stays here so the panel names a scenario instead of
   * carrying a copy of its settings. The panel is untrusted input, so the
   * merged config goes through the same bounds the tools use; the whole run
   * comes back because the panel needs the per-day history to draw the reports,
   * the globe network, and the replay timeline.
   * @param request.preset - scenario to start from; omitted starts from the baseline.
   * @param request.overrides - settings that win over the preset.
   * @returns the completed run.
   * @throws {SupplyChainError} when the preset or config is invalid, or no provider is installed.
   */
  @Remote('simulate')
  simulateForPanel(request: { preset?: string; overrides?: Partial<SimulationConfig> }): Promise<SimulationRun> {
    const base = request.preset === undefined ? {} : this.preset(request.preset)
    return this.simulate({ ...base, ...request.overrides }, new AbortController().signal)
  }

  /**
   * Read one retained run back for the panel, e.g. after a page reload.
   * @param runId - the run's id.
   * @returns the run.
   * @throws {SupplyChainError} with `supply_chain_unknown_run` when it is gone.
   */
  @Remote('run')
  runForPanel(runId: string): SimulationRun {
    return this.getRun(runId)
  }

  /**
   * Summarize what the panel can offer without transferring any history.
   *
   * Each preset carries its fully resolved config so the panel can show a
   * scenario's real settings before any run exists; deriving them here keeps
   * preset values in one place instead of copying them into the browser.
   * @returns the retained run ids, the newest run's id, and each preset with its resolved config.
   */
  @Remote('catalog')
  catalogForPanel(): {
    runIds: string[]
    latestRunId: string | null
    presets: { name: string; config: SimulationConfig }[]
  } {
    return {
      runIds: [...this.listRuns()],
      latestRunId: this.latestRun()?.id ?? null,
      presets: this.listPresets().map(name => ({ name, config: resolveConfig(this.preset(name)) })),
    }
  }
}

export default SupplyChainRuntime
