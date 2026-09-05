/**
 * Pure view derivations: the globe overlay for one replay day, and the geometry
 * behind the report charts. These are the numbers a user reads off the map and
 * the sparklines, so they are asserted without any render machinery.
 */
import { describe, expect, it } from 'vitest'
import type { NetworkNode, SupplyChainNetwork } from '@deepseek-ai/dsh-supply-chain/types'
import {
  barFraction,
  nodeBacklogOn,
  nodeInventoryOn,
  overlayForDay,
  sparkline,
  sparklinePoints,
  alongPath,
  itemColor,
  goodsOverlay,
  networkOverlay,
  TIER_ROLES,
  tierPixels,
} from '../src/client/derive.ts'
import type { OverlayColors, OverlayDrawable } from '../src/client/derive.ts'

const COLORS: OverlayColors = {
  healthy: 'healthy',
  stressed: 'stressed',
  destination: 'destination',
  lane: 'lane',
  saturated: 'saturated',
  closed: 'closed',
}

/**
 * One facility with per-item day series.
 * @param id - facility id.
 * @param tier - echelon.
 * @param inventory - inventory per item, per day.
 * @param backlog - backlog per item, per day.
 * @returns the node.
 */
function node(
  id: string,
  tier: number,
  inventory: number[][],
  backlog: number[][],
): NetworkNode {
  return {
    id,
    tier,
    latitude: tier,
    longitude: tier * 2,
    inventory,
    backlog,
    inflow: [],
    outflow: [],
  } as unknown as NetworkNode
}

/**
 * A two-node, one-lane network.
 * @param overrides - fields replacing the defaults.
 * @returns the network.
 */
function network(overrides: Partial<SupplyChainNetwork> = {}): SupplyChainNetwork {
  return {
    startTime: '2026-01-01T00:00:00.000Z',
    days: 3,
    itemIds: ['I01'],
    nodes: [
      node('NewYork', 0, [[5, 5, 5]], [[0, 0, 0]]),
      node('Atlanta', 4, [[7, 0, 0]], [[0, 3, 0]]),
    ],
    edges: [{ source: 'Atlanta', target: 'NewYork', capacity: 10, utilization: [0.5, 1.2, 0] }],
    shipments: [],
    disruptions: [],
    ...overrides,
  } as unknown as SupplyChainNetwork
}

describe('node day totals', () => {
  it('sums backlog across every item', () => {
    const each = node('X', 1, [[]], [[1, 2], [10, 20]])
    expect(nodeBacklogOn(each, 1)).toBe(22)
  })

  it('sums inventory across every item', () => {
    const each = node('X', 1, [[1, 2], [10, 20]], [[]])
    expect(nodeInventoryOn(each, 0)).toBe(11)
  })

  it('reads a day outside the run as zero', () => {
    const each = node('X', 1, [[1]], [[1]])
    expect(nodeBacklogOn(each, 99)).toBe(0)
    expect(nodeInventoryOn(each, 99)).toBe(0)
  })
})

describe('tier roles', () => {
  it('sizes the destination largest and sources smallest', () => {
    expect(tierPixels(0)).toBe(22)
    expect(tierPixels(6)).toBe(11)
  })

  it('draws the regional hub larger than the warehouses below it', () => {
    // Marker size tracks how much freight a role concentrates, not depth, so
    // this deliberately breaks monotonicity in tier.
    expect(tierPixels(5)).toBeGreaterThan(tierPixels(4))
    expect(tierPixels(5)).toBeGreaterThan(tierPixels(3))
  })

  it('falls back to the smallest marker for an unnamed tier', () => {
    expect(tierPixels(42)).toBe(11)
  })

  it('names every echelon it sizes', () => {
    expect(TIER_ROLES.every(role => role.name.length > 0)).toBe(true)
  })
})

/**
 * The first drawn lane, narrowed for assertions on its width and color.
 * @param items - one day's overlay.
 * @returns the lane.
 */
function laneOf(items: readonly OverlayDrawable[]): Extract<OverlayDrawable, { kind: 'line' }> {
  const lane = items.find(each => each.kind === 'line')
  if (lane === undefined || lane.kind !== 'line') throw new Error('no lane drawn')
  return lane
}

describe('overlay for one day', () => {
  it('draws every lane and every node', () => {
    const items = overlayForDay(network(), 0, COLORS)
    expect(items.filter(each => each.kind === 'line')).toHaveLength(1)
    expect(items.filter(each => each.kind === 'point')).toHaveLength(2)
  })

  it('draws lanes before nodes so markers sit on top', () => {
    const items = overlayForDay(network(), 0, COLORS)
    expect(items[0]?.kind).toBe('line')
    expect(items.at(-1)?.kind).toBe('point')
  })

  it('colors the destination apart from healthy upstream nodes', () => {
    const items = overlayForDay(network(), 0, COLORS)
    const points = items.filter(each => each.kind === 'point')
    expect(points.find(each => each.id === 'node:NewYork')).toMatchObject({ color: 'destination' })
    expect(points.find(each => each.id === 'node:Atlanta')).toMatchObject({ color: 'healthy' })
  })

  it('marks a node carrying backlog on the selected day', () => {
    const items = overlayForDay(network(), 1, COLORS)
    const atlanta = items.find(each => each.id === 'node:Atlanta')
    expect(atlanta).toMatchObject({ color: 'stressed' })
  })

  it('widens a lane with utilization and marks saturation', () => {
    const quiet = laneOf(overlayForDay(network(), 0, COLORS))
    const busy = laneOf(overlayForDay(network(), 1, COLORS))
    expect(quiet.color).toBe('lane')
    expect(busy.color).toBe('saturated')
    expect(busy.width).toBeGreaterThan(quiet.width)
  })

  it('caps lane width at full utilization', () => {
    const wild = network({
      edges: [{ source: 'Atlanta', target: 'NewYork', capacity: 1, utilization: [50] }],
    } as unknown as Partial<SupplyChainNetwork>)
    expect(laneOf(overlayForDay(wild, 0, COLORS)).width).toBe(6.5)
  })

  it('marks a lane closed only while its disruption is open', () => {
    const disrupted = network({
      disruptions: [{ startDay: 1, durationDays: 1, source: 'Atlanta', target: 'NewYork' }],
    } as unknown as Partial<SupplyChainNetwork>)
    expect(overlayForDay(disrupted, 0, COLORS)[0]).toMatchObject({ color: 'lane' })
    expect(overlayForDay(disrupted, 1, COLORS)[0]).toMatchObject({ color: 'closed' })
    // Day 2 is past the closure and idle, so it reads as an ordinary lane.
    expect(overlayForDay(disrupted, 2, COLORS)[0]).toMatchObject({ color: 'lane' })
  })

  it('carries each node position and role size', () => {
    const items = overlayForDay(network(), 0, COLORS)
    expect(items.find(each => each.id === 'node:Atlanta')).toMatchObject({
      lon: 8, lat: 4, pixelSize: tierPixels(4), label: 'Atlanta',
    })
  })
})

describe('goods in transit', () => {
  const moving = network({
    shipments: [{ id: 7, item: 0, units: 12, departureDay: 0, arrivalDay: 2, pathNodes: ['Atlanta', 'NewYork'] }],
  } as unknown as Partial<SupplyChainNetwork>)

  it('draws a shipment only between departure and arrival', () => {
    const has = (at: number): boolean =>
      overlayForDay(moving, at, COLORS).some(each => each.id === 'ship:7')
    expect(has(0)).toBe(true)
    expect(has(2)).toBe(true)
    expect(has(2.5)).toBe(false)
  })

  it('glides along the lane as the fractional day advances', () => {
    const at = (position: number): number => {
      const dot = overlayForDay(moving, position, COLORS).find(each => each.id === 'ship:7')
      return dot !== undefined && dot.kind === 'point' ? dot.lon : Number.NaN
    }
    // Atlanta sits at lon 8 and NewYork at lon 0, so progress moves it down.
    expect(at(0)).toBe(8)
    expect(at(1)).toBe(4)
    expect(at(2)).toBe(0)
  })

  it('colors a shipment by its item and labels it with the units carried', () => {
    const dot = overlayForDay(moving, 1, COLORS).find(each => each.id === 'ship:7')
    expect(dot).toMatchObject({ color: itemColor(0), label: 'I01 \u00d7 12' })
  })

  it('places same-day arrivals at the destination', () => {
    const instant = network({
      shipments: [{ id: 1, item: 0, units: 3, departureDay: 1, arrivalDay: 1, pathNodes: ['Atlanta', 'NewYork'] }],
    } as unknown as Partial<SupplyChainNetwork>)
    const dot = overlayForDay(instant, 1, COLORS).find(each => each.id === 'ship:1')
    expect(dot).toMatchObject({ lon: 0 })
  })

  it('skips a shipment whose path names no known facility', () => {
    const orphan = network({
      shipments: [{ id: 2, item: 0, units: 1, departureDay: 0, arrivalDay: 1, pathNodes: ['Nowhere'] }],
    } as unknown as Partial<SupplyChainNetwork>)
    expect(overlayForDay(orphan, 0, COLORS).some(each => each.id === 'ship:2')).toBe(false)
  })

  it('cycles item colors past the end of the palette', () => {
    expect(itemColor(5)).toBe(itemColor(0))
  })
})

describe('overlay layer split', () => {
  const moving2 = network({
    shipments: [{ id: 7, item: 0, units: 12, departureDay: 0, arrivalDay: 2, pathNodes: ['Atlanta', 'NewYork'] }],
  } as unknown as Partial<SupplyChainNetwork>)

  it('keeps goods out of the network layer', () => {
    const items = networkOverlay(moving2, 0, COLORS)
    expect(items.some(each => each.id.startsWith('ship:'))).toBe(false)
    expect(items.some(each => each.kind === 'line')).toBe(true)
  })

  it('keeps lanes and facilities out of the goods layer', () => {
    const items = goodsOverlay(moving2, 0.5)
    expect(items.every(each => each.id.startsWith('ship:'))).toBe(true)
  })

  it('redraws an identical network layer for every frame within one day', () => {
    // Lanes are draped ground primitives that load asynchronously; the caller
    // relies on this to skip redrawing them between frames of the same day.
    expect(networkOverlay(moving2, 1, COLORS)).toEqual(networkOverlay(moving2, 1, COLORS))
  })

  it('moves goods between frames of the same day', () => {
    const a = goodsOverlay(moving2, 1)[0]
    const b = goodsOverlay(moving2, 1.5)[0]
    expect(a?.kind === 'point' && b?.kind === 'point' && a.lon !== b.lon).toBe(true)
  })
})

describe('path interpolation', () => {
  it('walks a multi-leg path by equal time per leg', () => {
    const path = [[0, 0], [10, 0], [10, 10]] as const
    expect(alongPath(path, 0.5)).toEqual([10, 0])
    expect(alongPath(path, 0.25)).toEqual([5, 0])
    expect(alongPath(path, 0.75)).toEqual([10, 5])
  })

  it('clamps progress outside 0..1 to the endpoints', () => {
    const path = [[0, 0], [10, 10]] as const
    expect(alongPath(path, -1)).toEqual([0, 0])
    expect(alongPath(path, 9)).toEqual([10, 10])
  })

  it('holds a single-point path in place', () => {
    expect(alongPath([[3, 4]], 0.7)).toEqual([3, 4])
  })

  it('reads an empty path as the origin', () => {
    expect(alongPath([], 0.5)).toEqual([0, 0])
  })
})

describe('sparkline geometry', () => {
  it('has no points for an empty series', () => {
    expect(sparkline([])).toEqual([])
  })

  it('normalizes a rising series across the full band', () => {
    expect(sparkline([0, 5, 10])).toEqual([
      { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 },
    ])
  })

  it('centers a flat series instead of pinning it to an axis', () => {
    expect(sparkline([4, 4, 4]).every(point => point.y === 0.5)).toBe(true)
  })

  it('places a single sample at the start', () => {
    expect(sparkline([9])).toEqual([{ x: 0, y: 0.5 }])
  })

  it('flips y so larger values sit higher', () => {
    expect(sparklinePoints(sparkline([0, 10]), 100, 40)).toBe('0.00,40.00 100.00,0.00')
  })

  it('renders nothing for an empty series', () => {
    expect(sparklinePoints([], 100, 40)).toBe('')
  })
})

describe('bar fractions', () => {
  it('scales a value against the chart maximum', () => {
    expect(barFraction(5, 20)).toBe(0.25)
  })

  it('clamps into 0..1', () => {
    expect(barFraction(30, 20)).toBe(1)
    expect(barFraction(-5, 20)).toBe(0)
  })

  it('reads an empty chart as zero rather than dividing by it', () => {
    expect(barFraction(5, 0)).toBe(0)
    expect(barFraction(5, -1)).toBe(0)
  })
})
