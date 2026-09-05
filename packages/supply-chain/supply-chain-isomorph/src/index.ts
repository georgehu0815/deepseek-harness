/**
 * ISOMORPH simulation provider for the supply-chain seam.
 *
 * Runs the bundled `python/isomorph_bridge.py` as a one-shot subprocess per
 * simulation: the config goes in on stdin, one JSON document comes back on
 * stdout. There is no long-lived server and no port — a run costs roughly
 * 0.2 s including interpreter startup, so process-per-run keeps the provider
 * stateless and cancellable without owning a service lifecycle.
 *
 * The simulator checkout is external to this repository, so both its location
 * and the interpreter that can import it are required config with no defaults.
 * A missing or unusable checkout surfaces as `supply_chain_simulator_unavailable`
 * at first use rather than at load: the checkout can live on removable storage,
 * and refusing to boot the GUI over an unmounted volume would be worse than
 * reporting it in the panel.
 * @module @deepseek-ai/dsh-supply-chain-isomorph
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SupplyChainError,
  type SimulationConfig,
  type SimulationRun,
  type SupplyChainNetwork,
  type SupplyChainProvider,
} from '@deepseek-ai/dsh-supply-chain'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Cordis plugin name. */
export const name = 'supply-chain-isomorph'

/** Required services (cordis fiber inject). */
export const inject = ['supplyChain', 'subprocess']

/** Config for the ISOMORPH provider. */
export interface IsomorphProviderConfig {
  /**
   * Interpreter able to import the simulator, e.g. the checkout's own
   * `.venv/bin/python`. Required: the ambient `python3` rarely has the
   * simulator's dependencies.
   */
  readonly pythonBin: string
  /**
   * The ISOMORPH `demo` directory — the one containing
   * `simulator/demo_simulator.py`. Required and never guessed.
   */
  readonly simulatorRoot: string
  /** Wall-clock budget for one simulation, in milliseconds. */
  readonly timeoutMs: number
  /** Cap on the JSON document read from the bridge, in bytes. */
  readonly maxOutputBytes: number
}

/** Plugin config schema. */
export const Config: z<IsomorphProviderConfig> = z.object({
  pythonBin: z.string().required(),
  simulatorRoot: z.string().required(),
  timeoutMs: z.natural().default(120_000),
  maxOutputBytes: z.natural().default(64 * 1024 * 1024),
})

/** Grace period for the terminate escalation when a run is cancelled. */
const TERMINATE_GRACE_MS = 2_000

/** Bytes of bridge stderr retained to explain a failure. */
const STDERR_TAIL_BYTES = 8_192

/**
 * Absolute path to the bundled bridge script, resolved from this module so it
 * works from both `lib/` and a source launch.
 * @returns the bridge script path.
 */
function bridgeScriptPath(): string {
  return fileURLToPath(new URL('../python/isomorph_bridge.py', import.meta.url))
}

/**
 * Narrow the bridge's parsed stdout to the seam's run payload.
 *
 * This is a process boundary, so the JSON is validated rather than trusted:
 * the bridge is a separate program that can be pointed at an arbitrary
 * simulator checkout whose `SimResult` may not carry the fields we read.
 * @param value - the parsed JSON document.
 * @returns the network and per-item results.
 * @throws {SupplyChainError} when a required member is missing or mistyped.
 */
function parseBridgeOutput(value: unknown): Pick<SimulationRun, 'network' | 'results'> {
  if (typeof value !== 'object' || value === null) {
    throw new SupplyChainError('supply_chain_simulator_failed', 'bridge output is not a JSON object')
  }
  const { network, results } = value as { network?: unknown; results?: unknown }
  if (typeof network !== 'object' || network === null) {
    throw new SupplyChainError('supply_chain_simulator_failed', 'bridge output has no network object')
  }
  const candidate = network as Partial<SupplyChainNetwork>
  if (
    typeof candidate.days !== 'number'
    || !Array.isArray(candidate.nodes)
    || !Array.isArray(candidate.edges)
    || !Array.isArray(candidate.itemIds)
  ) {
    throw new SupplyChainError(
      'supply_chain_simulator_failed',
      'bridge network is missing days, itemIds, nodes, or edges',
    )
  }
  if (!Array.isArray(results)) {
    throw new SupplyChainError('supply_chain_simulator_failed', 'bridge output has no results array')
  }
  return { network: network as SupplyChainNetwork, results: results as SimulationRun['results'] }
}

/** Provider that delegates simulation to the ISOMORPH demo simulator. */
export class IsomorphSupplyChainProvider implements SupplyChainProvider {
  /**
   * @param subprocess - the subprocess seam used to run the bridge.
   * @param config - interpreter, checkout location, and limits.
   */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: IsomorphProviderConfig,
  ) {}

  /**
   * Run one simulation through the bridge script.
   * @param config - a config already validated by the seam.
   * @param runId - the id the seam assigned to this run.
   * @param signal - abort signal terminating the bridge process tree.
   * @returns the completed run.
   * @throws {SupplyChainError} when the bridge cannot start, exits non-zero,
   * exceeds the output cap, or emits output this seam cannot read.
   */
  async simulate(config: SimulationConfig, runId: string, signal: AbortSignal): Promise<SimulationRun> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])

    const handle = this.subprocess.spawn({
      argv: [this.config.pythonBin, bridgeScriptPath(), '--simulator-root', this.config.simulatorRoot],
      cwd: this.config.simulatorRoot,
      stdio: {
        stdin: { data: JSON.stringify(config) },
        stdout: { maxBytes: this.config.maxOutputBytes },
        stderr: { maxBytes: STDERR_TAIL_BYTES },
      },
      graceMs: TERMINATE_GRACE_MS,
      signal: combined,
    })

    const outcome = await handle.done
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''

    if (outcome.exitCode !== 0) {
      if (timeout.aborted) {
        throw new SupplyChainError(
          'supply_chain_simulator_failed',
          `simulation exceeded ${this.config.timeoutMs}ms and was terminated`,
        )
      }
      const reason = stderr.trim() === '' ? `exit code ${String(outcome.exitCode)}` : stderr.trim()
      // The bridge exits 2 for a checkout it cannot import; anything else with
      // a signal or a missing interpreter is equally "cannot run right now".
      const code = outcome.exitCode === 2 || handle.pid === -1
        ? 'supply_chain_simulator_unavailable'
        : 'supply_chain_simulator_failed'
      throw new SupplyChainError(code, `ISOMORPH bridge failed: ${reason}`)
    }

    const stdout = handle.collected.stdout?.readFrom(0)
    if (stdout === undefined || stdout.lossy) {
      throw new SupplyChainError(
        'supply_chain_simulator_failed',
        `simulation output exceeded ${this.config.maxOutputBytes} bytes; reduce days or items`,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.text)
    } catch {
      // Swallowed: JSON.parse's message names an offset in a document the
      // caller cannot see, and stderr already carries the bridge's own reason.
      throw new SupplyChainError('supply_chain_simulator_failed', `bridge emitted unparseable output: ${stderr.trim()}`)
    }

    return { id: runId, config, ...parseBridgeOutput(parsed) }
  }
}

/**
 * Install the ISOMORPH provider into the supply-chain seam.
 * @param ctx - context carrying the supplyChain and subprocess services.
 * @param config - interpreter, checkout location, and limits.
 */
export function apply(ctx: Context, config: IsomorphProviderConfig): void {
  const provider = new IsomorphSupplyChainProvider(ctx.subprocess, config)
  ctx.effect(() => ctx.supplyChain.registerProvider(provider))
}
