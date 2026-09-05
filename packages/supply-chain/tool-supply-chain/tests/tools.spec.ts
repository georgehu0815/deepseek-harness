// Tool tests for the supply-chain emulator surface.
//
// The tools are exercised through the real ToolRuntime, with a stub simulation
// provider behind the seam: what matters here is the model-facing behavior —
// schema bounds, defaulting to the latest run, the required-argument
// diagnostics, and the rendered summaries — not the simulator.
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SupplyChainRuntime, { CONFIG_BOUNDS } from '@deepseek-ai/dsh-supply-chain'
import type { SimulationConfig, SimulationRun } from '@deepseek-ai/dsh-supply-chain'
import * as ToolSupplyChain from '../src/index.ts'
import { OVERRIDE_SCHEMAS } from '../src/index.ts'

let ctx: Context

/** A two-node run whose numbers are recognizable in rendered output. */
function stubRun(id: string, config: SimulationConfig): SimulationRun {
  return {
    id,
    config,
    network: {
      startTime: '2026-01-01T00:00:00.000Z',
      days: 3,
      itemIds: ['I01'],
      nodes: [
        {
          id: 'NewYork',
          latitude: 40.7128,
          longitude: -74.006,
          tier: 0,
          inventory: [[10, 20, 30]],
          backlog: [[0, 5, 0]],
          inflow: [[1, 1, 1]],
          outflow: [[2, 4, 2]],
        },
        {
          id: 'Chicago',
          latitude: 41.8781,
          longitude: -87.6298,
          tier: 1,
          inventory: [[7, 7, 7]],
          backlog: [[0, 0, 0]],
          inflow: [[0, 9, 0]],
          outflow: [[3, 3, 3]],
        },
      ],
      edges: [{ source: 'Chicago', target: 'NewYork', capacity: 10, utilization: [0.5, 1.5, 0.25] }],
      shipments: [],
      disruptions: [{ startDay: 1, durationDays: 4, source: 'Chicago', target: 'NewYork' }],
    },
    results: [{ item: 'I01', fillRate: 0.875, totalDemand: 400, totalBacklog: 50, totalCost: 1234 }],
  }
}

/** Run one tool and return its result envelope. */
function call(name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`${name}-1`),
    name,
    arguments: args,
  })
}

/** The text a tool's renderer produced for its result. */
function rendered(result: Awaited<ReturnType<typeof call>>): string {
  const parts = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return parts.map(part => part.text ?? '').join('\n')
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SupplyChainRuntime, { maxRuns: 4 })
  ctx.supplyChain.registerProvider({
    simulate: (config, runId) => Promise.resolve(stubRun(runId, config)),
  })
  await ctx.plugin(ToolSupplyChain)
})

describe('tool schema', () => {
  it('registers the three supply-chain tools', () => {
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('supply_chain_simulate')
    expect(names).toContain('supply_chain_runs')
    expect(names).toContain('supply_chain_report')
  })

  it('tells the model the range the seam actually enforces', () => {
    for (const [field, declared] of Object.entries(OVERRIDE_SCHEMAS)) {
      const authoritative = CONFIG_BOUNDS[field]
      expect(authoritative, `${field} is not a real config field`).toBeDefined()
      expect(declared.type, `${field} type`).toBe(authoritative!.integer === true ? 'integer' : 'number')
      expect(declared.description, `${field} range`)
        .toContain(`Accepted range ${authoritative!.min} to ${authoritative!.max}.`)
    }
  })

  it('offers every seam preset by name', () => {
    const schema = ctx.tools.schemas().find(each => each.name === 'supply_chain_simulate')!
    const preset = (schema.parameters as { properties: { preset: { enum: string[] } } }).properties.preset
    expect(preset.enum).toEqual(ctx.supplyChain.listPresets())
  })
})

describe('supply_chain_simulate', () => {
  it('summarizes the run without emitting the day-by-day history', async () => {
    const result = await call('supply_chain_simulate', { days: 30 })
    const text = rendered(result)
    expect(text).toContain('Run run-1: 3 days, 2 nodes, 1 lanes, 1 lane closures.')
    expect(text).toContain('I01: fill 87.5%, demand 400, backlog 50, cost 1234')
    expect(text).not.toContain('inventory')
  })

  it('starts from a named preset', async () => {
    await call('supply_chain_simulate', { preset: 'disruption' })
    expect(ctx.supplyChain.getRun('run-1').config.disruptionEdge).toEqual(['Atlanta', 'Chicago'])
  })

  it('lets an explicit override win over the preset', async () => {
    await call('supply_chain_simulate', { preset: 'lowCapacity', capacityScale: 2 })
    expect(ctx.supplyChain.getRun('run-1').config.capacityScale).toBe(2)
  })

  it('rejects a malformed disruption lane', async () => {
    const result = await call('supply_chain_simulate', { disruptionEdge: ['Atlanta'] })
    expect(JSON.stringify(result)).toContain('disruptionEdge must name exactly two nodes')
  })

  it('surfaces a seam validation failure to the model', async () => {
    const result = await call('supply_chain_simulate', { capacityScale: 99 })
    expect(JSON.stringify(result)).toContain('capacityScale must be between 0.1 and 3')
  })
})

describe('supply_chain_runs', () => {
  it('tells the model what to do when nothing has run', async () => {
    expect(rendered(await call('supply_chain_runs', {}))).toContain('No supply-chain runs yet')
  })

  it('lists each retained run with its settings', async () => {
    await call('supply_chain_simulate', { days: 30, seed: 7 })
    expect(rendered(await call('supply_chain_runs', {}))).toContain('run-1: 30 days, 3 items, seed 7')
  })
})

describe('supply_chain_report', () => {
  beforeEach(async () => {
    await call('supply_chain_simulate', {})
  })

  it('defaults to the most recent run', async () => {
    expect(rendered(await call('supply_chain_report', { kind: 'edge' })))
      .toContain('Chicago → NewYork')
  })

  it('summarizes a node series instead of dumping it', async () => {
    const text = rendered(await call('supply_chain_report', { kind: 'node', nodeId: 'NewYork', item: 'I01' }))
    expect(text).toContain('NewYork / I01 over 3 days')
    expect(text).toContain('inventory: mean 20, min 10, max 30')
    expect(text).toContain('backlog: mean 2, peak 5, 1 days with unmet demand')
  })

  it('reports amplification per echelon', async () => {
    const text = rendered(await call('supply_chain_report', { kind: 'bullwhip', item: 'I01' }))
    expect(text).toContain('tier 0 (NewYork)')
    expect(text).toContain('tier 1 (Chicago)')
  })

  it('counts days at or above lane capacity', async () => {
    expect(rendered(await call('supply_chain_report', { kind: 'edge' })))
      .toContain('peak 150.0%, 1 days at or above capacity')
  })

  it('names the missing argument for each report', async () => {
    expect(JSON.stringify(await call('supply_chain_report', { kind: 'node', item: 'I01' })))
      .toContain('the node report requires a nodeId')
    expect(JSON.stringify(await call('supply_chain_report', { kind: 'bullwhip' })))
      .toContain('the bullwhip report requires an item')
  })

  it('tells the model to simulate first when no run exists', async () => {
    const fresh = new Context()
    await fresh.plugin(SystemPrompt)
    await fresh.plugin(ToolRuntime)
    await fresh.plugin(SupplyChainRuntime, { maxRuns: 4 })
    await fresh.plugin(ToolSupplyChain)
    const result = await fresh.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('empty'),
      name: 'supply_chain_report',
      arguments: { kind: 'edge' },
    })
    expect(JSON.stringify(result)).toContain('call supply_chain_simulate first')
  })
})
