// Unit tests for the supply-chain seam: config validation and preset
// resolution, the three report derivations, and the run store's published
// contract (announce-after-commit, retention bound, eviction). A stub provider
// stands in for the simulator, so nothing here needs Python or the ISOMORPH
// checkout.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SupplyChainRuntime, {
  DEFAULT_SIMULATION_CONFIG,
  resolveConfig,
  sampleVariance,
  SupplyChainError,
} from '../src/index.ts'
import type { SimulationConfig, SimulationRun, SupplyChainProvider } from '../src/index.ts'

/**
 * Build a two-node, one-edge, one-item run whose series are chosen so each
 * report has a hand-checkable answer.
 */
function stubRun(id: string, config: SimulationConfig): SimulationRun {
  return {
    id,
    config,
    network: {
      startTime: '2026-01-01T00:00:00.000Z',
      days: 4,
      itemIds: ['I01'],
      nodes: [
        {
          id: 'NewYork',
          latitude: 40.7128,
          longitude: -74.006,
          tier: 0,
          inventory: [[10, 8, 6, 4]],
          backlog: [[0, 0, 1, 2]],
          inflow: [[2, 2, 2, 2]],
          outflow: [[1, 3, 1, 3]],
        },
        {
          id: 'Chicago',
          latitude: 41.8781,
          longitude: -87.6298,
          tier: 1,
          inventory: [[20, 20, 20, 20]],
          backlog: [[0, 0, 0, 0]],
          inflow: [[0, 8, 0, 8]],
          outflow: [[2, 2, 2, 2]],
        },
      ],
      edges: [
        { source: 'Chicago', target: 'NewYork', capacity: 10, utilization: [0.2, 1.0, 0.5, 1.3] },
      ],
      shipments: [],
      disruptions: [],
    },
    results: [{ item: 'I01', fillRate: 0.9, totalDemand: 100, totalBacklog: 3, totalCost: 42 }],
  }
}

/** A provider that records its calls and returns the stub run. */
function stubProvider(): SupplyChainProvider & { calls: SimulationConfig[] } {
  const calls: SimulationConfig[] = []
  return {
    calls,
    simulate: (config, runId) => {
      calls.push(config)
      return Promise.resolve(stubRun(runId, config))
    },
  }
}

/** A seam instance with the stub provider installed. */
function seam(maxRuns = 8) {
  const ctx = new Context()
  const runtime = new SupplyChainRuntime(ctx, { maxRuns })
  runtime.registerProvider(stubProvider())
  return { ctx, runtime }
}

describe('resolveConfig', () => {
  it('fills absent fields from the baseline', () => {
    expect(resolveConfig({ days: 30 })).toEqual({ ...DEFAULT_SIMULATION_CONFIG, days: 30 })
  })

  it('rejects a value outside its bound', () => {
    expect(() => resolveConfig({ capacityScale: 9 })).toThrow(SupplyChainError)
    expect(() => resolveConfig({ capacityScale: 9 })).toThrow(/capacityScale must be between 0.1 and 3/)
  })

  it('rejects a non-integral value where integrality is required', () => {
    expect(() => resolveConfig({ days: 30.5 })).toThrow(/days must be a whole number/)
  })

  it('rejects a non-finite value', () => {
    expect(() => resolveConfig({ leadTimeScale: Number.NaN })).toThrow(/leadTimeScale must be a finite number/)
  })

  it('rejects inverted paired bounds', () => {
    expect(() => resolveConfig({ phiLow: 0.9, phiHigh: 0.6 })).toThrow(/phiHigh must be greater than/)
    expect(() => resolveConfig({ baseLambdaLow: 300, baseLambdaHigh: 100 }))
      .toThrow(/baseLambdaHigh must be greater than/)
  })

  it('rejects an empty disruption endpoint', () => {
    expect(() => resolveConfig({ disruptionEdge: ['', 'Chicago'] })).toThrow(/non-empty node ids/)
  })

  it('accepts the exact bound values', () => {
    expect(resolveConfig({ capacityScale: 0.1 }).capacityScale).toBe(0.1)
    expect(resolveConfig({ capacityScale: 3 }).capacityScale).toBe(3)
  })
})

describe('presets', () => {
  it('names every built-in scenario', () => {
    const { runtime } = seam()
    expect(runtime.listPresets()).toEqual([
      'baseline', 'demandShock', 'disruption', 'lowCapacity', 'thinSafetyStock',
    ])
  })

  it('resolves a preset to a complete config', () => {
    const { runtime } = seam()
    expect(runtime.preset('disruption').disruptionEdge).toEqual(['Atlanta', 'Chicago'])
  })

  it('rejects an unknown preset by name', () => {
    const { runtime } = seam()
    expect(() => runtime.preset('nope')).toThrow(/unknown preset nope; available: baseline/)
  })

  it('carries each preset resolved config in the panel catalog', () => {
    const { runtime } = seam()
    const catalog = runtime.catalogForPanel()
    expect(catalog.presets.map(each => each.name)).toEqual(runtime.listPresets())
    // The panel seeds its controls from these values, so a preset must arrive
    // fully resolved rather than as the settings it overrides.
    const baseline = catalog.presets.find(each => each.name === 'baseline')
    expect(baseline?.config.days).toBe(200)
    expect(baseline?.config.items).toBe(3)
    expect(baseline?.config.capacityScale).toBe(1)
    const thin = catalog.presets.find(each => each.name === 'thinSafetyStock')
    expect(thin?.config.safetyStockScale).toBe(0.2)
    expect(thin?.config.days).toBe(200)
  })
})

describe('run store', () => {
  it('refuses to simulate without a provider', async () => {
    const runtime = new SupplyChainRuntime(new Context(), { maxRuns: 8 })
    await expect(runtime.simulate({}, AbortSignal.abort())).rejects.toThrow(/no supply-chain simulation provider/)
  })

  it('announces a run only after it is retrievable', async () => {
    const { ctx, runtime } = seam()
    const seen: string[] = []
    ctx.on('supply-chain/run', (run) => { seen.push(runtime.getRun(run.id).id) })
    const run = await runtime.simulate({ days: 30 }, new AbortController().signal)
    expect(seen).toEqual([run.id])
  })

  it('does not store a run whose provider failed', async () => {
    const ctx = new Context()
    const runtime = new SupplyChainRuntime(ctx, { maxRuns: 8 })
    runtime.registerProvider({ simulate: () => Promise.reject(new Error('boom')) })
    await expect(runtime.simulate({}, new AbortController().signal)).rejects.toThrow('boom')
    expect(runtime.listRuns()).toEqual([])
    expect(runtime.latestRun()).toBeNull()
  })

  it('evicts the oldest run past the retention limit', async () => {
    const { runtime } = seam(2)
    const signal = new AbortController().signal
    await runtime.simulate({}, signal)
    await runtime.simulate({}, signal)
    await runtime.simulate({}, signal)
    expect(runtime.listRuns()).toEqual(['run-2', 'run-3'])
    expect(runtime.retentionLimit).toBe(2)
    expect(runtime.latestRun()?.id).toBe('run-3')
  })

  it('reports an unknown run with the retained ids', async () => {
    const { runtime } = seam()
    await runtime.simulate({}, new AbortController().signal)
    expect(() => runtime.getRun('run-9')).toThrow(/unknown run run-9; retained runs: run-1/)
  })

  it('restores the previous provider when the disposer runs', async () => {
    const { runtime } = seam()
    const replacement = stubProvider()
    const dispose = runtime.registerProvider(replacement)
    await runtime.simulate({}, new AbortController().signal)
    expect(replacement.calls).toHaveLength(1)
    dispose()
    await runtime.simulate({}, new AbortController().signal)
    expect(replacement.calls).toHaveLength(1)
  })

  it('forwards the caller abort signal to the provider', async () => {
    const ctx = new Context()
    const runtime = new SupplyChainRuntime(ctx, { maxRuns: 8 })
    const simulate = vi.fn((config: SimulationConfig, runId: string, _signal: AbortSignal) =>
      Promise.resolve(stubRun(runId, config)))
    runtime.registerProvider({ simulate })
    const controller = new AbortController()
    await runtime.simulate({}, controller.signal)
    expect(simulate.mock.calls[0]![2]).toBe(controller.signal)
  })
})

describe('reports', () => {
  it('returns the selected node and item series', async () => {
    const { runtime } = seam()
    const run = await runtime.simulate({}, new AbortController().signal)
    expect(runtime.nodeReport(run.id, 'NewYork', 'I01')).toEqual({
      kind: 'node',
      nodeId: 'NewYork',
      item: 'I01',
      inventory: [10, 8, 6, 4],
      backlog: [0, 0, 1, 2],
      inflow: [2, 2, 2, 2],
      outflow: [1, 3, 1, 3],
    })
  })

  it('reports an unknown node and an unknown item distinctly', async () => {
    const { runtime } = seam()
    const run = await runtime.simulate({}, new AbortController().signal)
    expect(() => runtime.nodeReport(run.id, 'Nowhere', 'I01')).toThrow(/has no node Nowhere/)
    expect(() => runtime.nodeReport(run.id, 'NewYork', 'I99')).toThrow(/has no item I99/)
  })

  it('amplifies flat inflow into zero and volatile inflow into a ratio', async () => {
    const { runtime } = seam()
    const run = await runtime.simulate({}, new AbortController().signal)
    const report = runtime.bullwhipReport(run.id, 'I01')
    // NewYork: inflow [2,2,2,2] has zero variance; outflow [1,3,1,3] has 4/3.
    expect(report.tiers[0]).toEqual({
      tier: 0,
      nodeIds: ['NewYork'],
      inflowVariance: 0,
      demandVariance: sampleVariance([1, 3, 1, 3]),
      amplification: 0,
    })
    // Chicago: inflow [0,8,0,8] is volatile against a flat outflow, so the
    // amplification denominator is zero and the ratio is reported as 0.
    expect(report.tiers[1]!.inflowVariance).toBeGreaterThan(0)
    expect(report.tiers[1]!.amplification).toBe(0)
  })

  it('ranks lanes by mean utilization and counts saturated days', async () => {
    const { runtime } = seam()
    const run = await runtime.simulate({}, new AbortController().signal)
    expect(runtime.edgeReport(run.id).edges).toEqual([
      {
        source: 'Chicago',
        target: 'NewYork',
        capacity: 10,
        meanUtilization: 0.75,
        peakUtilization: 1.3,
        saturatedDays: 2,
      },
    ])
  })
})

describe('sampleVariance', () => {
  it('uses the ddof=1 denominator the upstream analysis uses', () => {
    expect(sampleVariance([1, 3])).toBe(2)
  })

  it('is zero for a series too short to have a sample variance', () => {
    expect(sampleVariance([])).toBe(0)
    expect(sampleVariance([5])).toBe(0)
  })
})
