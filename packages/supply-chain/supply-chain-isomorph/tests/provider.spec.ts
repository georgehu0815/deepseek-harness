// Provider tests for the ISOMORPH bridge.
//
// Two tiers. The failure-path tests drive a fake subprocess seam, so they run
// everywhere and pin the diagnostics a user actually sees. The end-to-end test
// runs the real bridge against a real ISOMORPH checkout and self-skips when one
// is not configured — CI has neither Python nor the checkout, so the real
// engine can only be asserted on a developer machine that has it.
//
// Point DSH_ISOMORPH_ROOT at the checkout's `demo` directory and
// DSH_ISOMORPH_PYTHON at an interpreter that can import it.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SupplyChainRuntime from '@deepseek-ai/dsh-supply-chain'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { IsomorphSupplyChainProvider } from '../src/index.ts'

const PROVIDER_CONFIG = {
  pythonBin: 'python3',
  simulatorRoot: '/nonexistent',
  timeoutMs: 30_000,
  maxOutputBytes: 1_024 * 1_024,
}

/** A subprocess seam returning one canned outcome, capturing the spawn spec. */
function fakeSubprocess(outcome: {
  exitCode: number | null
  stdout?: string
  stderr?: string
  pid?: number
}): SubprocessRuntime & { spec: SubprocessSpawnSpec | null } {
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  const seam = {
    spec: null as SubprocessSpawnSpec | null,
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      seam.spec = spec
      return {
        pid: outcome.pid ?? 1234,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: reader(outcome.stdout ?? ''),
          stderr: reader(outcome.stderr ?? ''),
        },
        done: Promise.resolve({ exitCode: outcome.exitCode, signal: null }),
        terminate: () => {},
        waitForExit: () => Promise.resolve(true),
      } as unknown as SubprocessHandle
    },
  }
  return seam as unknown as SubprocessRuntime & { spec: SubprocessSpawnSpec | null }
}

/** A provider over the fake seam. */
function provider(outcome: Parameters<typeof fakeSubprocess>[0]) {
  const subprocess = fakeSubprocess(outcome)
  return { subprocess, instance: new IsomorphSupplyChainProvider(subprocess, PROVIDER_CONFIG) }
}

/** The seam's baseline config, resolved without touching a provider. */
function baselineConfig() {
  const runtime = new SupplyChainRuntime(new Context(), { maxRuns: 1 })
  return runtime.preset('baseline')
}

describe('IsomorphSupplyChainProvider failure paths', () => {
  const signal = new AbortController().signal

  it('sends the config on stdin and names the simulator root', async () => {
    const network = { days: 1, itemIds: ['I01'], nodes: [], edges: [], shipments: [], disruptions: [], startTime: 'x' }
    const { subprocess, instance } = provider({ exitCode: 0, stdout: JSON.stringify({ network, results: [] }) })
    await instance.simulate(baselineConfig(), 'run-1', signal)

    const spec = subprocess.spec!
    expect(spec.argv[0]).toBe('python3')
    expect(spec.argv).toContain('--simulator-root')
    expect(spec.argv).toContain('/nonexistent')
    const stdin = spec.stdio.stdin as { data: string }
    expect(JSON.parse(stdin.data).days).toBe(200)
  })

  it('reports an unimportable checkout as unavailable, not as a failure', async () => {
    const { instance } = provider({ exitCode: 2, stderr: 'simulator root ... does not contain ...' })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toMatchObject({ code: 'supply_chain_simulator_unavailable' })
  })

  it('reports a spawn failure as unavailable', async () => {
    const { instance } = provider({ exitCode: 1, pid: -1, stderr: 'ENOENT' })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toMatchObject({ code: 'supply_chain_simulator_unavailable' })
  })

  it('surfaces the bridge stderr when the simulation itself fails', async () => {
    const { instance } = provider({ exitCode: 1, stderr: 'ValueError: bad seed' })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toThrow(/ISOMORPH bridge failed: ValueError: bad seed/)
  })

  it('falls back to the exit code when the bridge said nothing', async () => {
    const { instance } = provider({ exitCode: 3 })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toThrow(/ISOMORPH bridge failed: exit code 3/)
  })

  it('rejects unparseable output', async () => {
    const { instance } = provider({ exitCode: 0, stdout: 'not json', stderr: 'warned' })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toThrow(/bridge emitted unparseable output: warned/)
  })

  it('rejects output missing the members the seam reads', async () => {
    const { instance } = provider({ exitCode: 0, stdout: JSON.stringify({ network: { days: 1 }, results: [] }) })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toThrow(/missing days, itemIds, nodes, or edges/)
  })

  it('rejects a non-object document', async () => {
    const { instance } = provider({ exitCode: 0, stdout: '42' })
    await expect(instance.simulate(baselineConfig(), 'run-1', signal))
      .rejects.toThrow(/bridge output is not a JSON object/)
  })
})

const isomorphRoot = process.env.DSH_ISOMORPH_ROOT
const isomorphPython = process.env.DSH_ISOMORPH_PYTHON
const haveSimulator =
  isomorphRoot !== undefined
  && isomorphPython !== undefined
  && existsSync(join(isomorphRoot, 'simulator', 'demo_simulator.py'))
  && existsSync(isomorphPython)

describe.skipIf(!haveSimulator)('IsomorphSupplyChainProvider against the real simulator', () => {
  /** The seam wired to the real bridge over the local subprocess seam. */
  async function realSeam() {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const runtime = new SupplyChainRuntime(ctx, { maxRuns: 4 })
    runtime.registerProvider(new IsomorphSupplyChainProvider(ctx.subprocess, {
      pythonBin: isomorphPython!,
      simulatorRoot: isomorphRoot!,
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1_024 * 1_024,
    }))
    return runtime
  }

  it('produces a geo-located network with per-day history', async () => {
    const runtime = await realSeam()
    const run = await runtime.simulate({ days: 40, items: 2 }, new AbortController().signal)

    expect(run.network.days).toBe(40)
    expect(run.network.itemIds).toEqual(['I01', 'I02'])
    expect(run.network.nodes.length).toBeGreaterThan(1)
    expect(run.network.edges.length).toBeGreaterThan(1)
    expect(run.results).toHaveLength(2)

    const node = run.network.nodes.find(candidate => candidate.id === 'NewYork')!
    expect(node.tier).toBe(0)
    expect(node.latitude).toBeCloseTo(40.71, 1)
    expect(node.inventory[0]).toHaveLength(40)
    expect(node.backlog[1]).toHaveLength(40)
    expect(run.network.edges[0]!.utilization).toHaveLength(40)
  })

  it('is reproducible for one seed and sensitive to another', async () => {
    const runtime = await realSeam()
    const signal = new AbortController().signal
    const first = await runtime.simulate({ days: 30, items: 1, seed: 7 }, signal)
    const same = await runtime.simulate({ days: 30, items: 1, seed: 7 }, signal)
    const other = await runtime.simulate({ days: 30, items: 1, seed: 8 }, signal)

    expect(same.network.nodes[0]!.inventory).toEqual(first.network.nodes[0]!.inventory)
    expect(other.network.nodes[0]!.inventory).not.toEqual(first.network.nodes[0]!.inventory)
  })

  it('degrades service when lane capacity is starved', async () => {
    const runtime = await realSeam()
    const signal = new AbortController().signal
    const healthy = await runtime.simulate({ days: 60, items: 1 }, signal)
    const starved = await runtime.simulate({ days: 60, items: 1, capacityScale: 0.2 }, signal)

    expect(healthy.results[0]!.fillRate).toBeGreaterThan(0.9)
    expect(starved.results[0]!.fillRate).toBeLessThan(healthy.results[0]!.fillRate)
    expect(starved.results[0]!.totalBacklog).toBeGreaterThan(healthy.results[0]!.totalBacklog)
  })

  it('realizes closures on the configured disruption lane', async () => {
    const runtime = await realSeam()
    const run = await runtime.simulate(
      { days: 60, items: 1, disruptionEdge: ['Atlanta', 'Chicago'], disruptionProbability: 0.2, disruptionDuration: 5 },
      new AbortController().signal,
    )
    expect(run.network.disruptions.length).toBeGreaterThan(0)
    for (const disruption of run.network.disruptions) {
      expect(disruption.source).toBe('Atlanta')
      expect(disruption.target).toBe('Chicago')
      expect(disruption.durationDays).toBe(5)
    }
  })

  it('derives all three reports from a real run', async () => {
    const runtime = await realSeam()
    const run = await runtime.simulate({ days: 40, items: 1 }, new AbortController().signal)

    expect(runtime.nodeReport(run.id, 'NewYork', 'I01').inventory).toHaveLength(40)

    const bullwhip = runtime.bullwhipReport(run.id, 'I01')
    expect(bullwhip.tiers[0]!.tier).toBe(0)
    expect(bullwhip.tiers.length).toBeGreaterThan(1)

    const edges = runtime.edgeReport(run.id).edges
    expect(edges.length).toBeGreaterThan(1)
    // Ranked by mean utilization, most saturated first.
    expect(edges[0]!.meanUtilization).toBeGreaterThanOrEqual(edges.at(-1)!.meanUtilization)
  })
})
