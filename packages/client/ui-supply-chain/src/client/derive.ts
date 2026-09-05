/**
 * Pure view derivations for the supply-chain panel: the globe overlay for one
 * replay day, and the geometry behind the three report charts.
 *
 * Kept free of React and of Cesium so the numbers a user reads are testable on
 * their own. Colors arrive as resolved CSS strings from the caller, because a
 * design token only has a value once the theme is applied.
 */
import type { NetworkNode, SupplyChainNetwork } from '@deepseek-ai/dsh-supply-chain/types'

/** One marker or lane handed to the globe overlay face. */
export type OverlayDrawable =
  | { kind: 'point'; id: string; lon: number; lat: number; color: string; pixelSize: number; label?: string | undefined }
  | { kind: 'line'; id: string; coordinates: ReadonlyArray<readonly [number, number]>; color: string; width: number }

/**
 * Role name and marker diameter per echelon, carried over from the upstream
 * simulator's map so the same network reads the same way here. Size is not
 * monotonic in tier: it tracks how much freight a role concentrates, which is
 * why the Nashville hub (tier 5) draws larger than the warehouses below it.
 */
export const TIER_ROLES: readonly { tier: number; name: string; pixels: number }[] = [
  { tier: 0, name: 'Destination (end customer)', pixels: 22 },
  { tier: 1, name: 'Last-mile DC', pixels: 16 },
  { tier: 2, name: 'Tier-4 warehouse', pixels: 13 },
  { tier: 3, name: 'Tier-3 warehouse', pixels: 13 },
  { tier: 4, name: 'Tier-2 warehouse', pixels: 15 },
  { tier: 5, name: 'Regional hub', pixels: 18 },
  { tier: 6, name: 'Source / supplier', pixels: 11 },
]

/**
 * Per-item colors for goods in transit, carried over from the upstream
 * simulator so an item keeps its identity between the two maps.
 */
const DEFAULT_ITEM_COLOR = '#1f77b4'

export const ITEM_COLORS: readonly string[] = [
  DEFAULT_ITEM_COLOR, '#ff7f0e', '#2ca02c', '#9467bd', '#d62728',
]

/** Marker diameter for a shipment dot. */
const SHIPMENT_PIXELS = 7

/**
 * Color for one item index.
 * @param item - index into the run's item list.
 * @returns the item's color.
 */
export function itemColor(item: number): string {
  return ITEM_COLORS[item % ITEM_COLORS.length] ?? DEFAULT_ITEM_COLOR
}

/**
 * Interpolate a position along a node path.
 *
 * The path is walked by leg rather than by great-circle distance: legs are
 * short relative to the network and equal-time legs read as steady motion,
 * which is what the replay is showing.
 * @param points - the path's [lon, lat] pairs, source first.
 * @param progress - fraction of the journey completed, 0 to 1.
 * @returns the interpolated [lon, lat].
 */
export function alongPath(
  points: readonly (readonly [number, number])[],
  progress: number,
): readonly [number, number] {
  const first = points[0]
  if (first === undefined) return [0, 0]
  if (points.length === 1) return first
  const legs = points.length - 1
  const scaled = Math.max(0, Math.min(1, progress)) * legs
  const leg = Math.min(Math.floor(scaled), legs - 1)
  const within = scaled - leg
  const from = points[leg]
  const to = points[leg + 1]
  if (from === undefined || to === undefined) {
    throw new RangeError('path segment is outside the available points')
  }
  return [from[0] + (to[0] - from[0]) * within, from[1] + (to[1] - from[1]) * within]
}

/** Marker diameter for a tier the role table does not name. */
const UNKNOWN_TIER_PIXELS = 11

/**
 * Marker diameter for one echelon.
 * @param tier - the node's echelon.
 * @returns the diameter in pixels.
 */
export function tierPixels(tier: number): number {
  return TIER_ROLES.find(role => role.tier === tier)?.pixels ?? UNKNOWN_TIER_PIXELS
}
/** Lane width at zero utilization. */
const MIN_LANE_WIDTH = 1.5
/** Extra lane width at full utilization. */
const LANE_WIDTH_RANGE = 5

/** Resolved theme colors the overlay needs. */
export interface OverlayColors {
  /** A node holding stock and meeting demand. */
  readonly healthy: string
  /** A node carrying backlog on the selected day. */
  readonly stressed: string
  /** The demand destination (tier 0). */
  readonly destination: string
  /** A lane below capacity. */
  readonly lane: string
  /** A lane at or above capacity on the selected day. */
  readonly saturated: string
  /** A lane closed by a disruption on the selected day. */
  readonly closed: string
}

/**
 * Total backlog carried by one node across every item on one day.
 * @param node - the node to measure.
 * @param day - zero-based replay day.
 * @returns backlog units, or 0 when the day is outside the run.
 */
export function nodeBacklogOn(node: NetworkNode, day: number): number {
  let total = 0
  for (const series of node.backlog) total += series[day] ?? 0
  return total
}

/**
 * Total inventory held by one node across every item on one day.
 * @param node - the node to measure.
 * @param day - zero-based replay day.
 * @returns inventory units, or 0 when the day is outside the run.
 */
export function nodeInventoryOn(node: NetworkNode, day: number): number {
  let total = 0
  for (const series of node.inventory) total += series[day] ?? 0
  return total
}

/**
 * Build the globe overlay for one replay day.
 *
 * Marker size encodes echelon depth (the destination is largest) and marker
 * color encodes whether that node is carrying backlog that day, so a stockout
 * wave is visible travelling upstream as the replay runs. Lane width tracks
 * utilization and lane color marks saturation and active closures.
 * @param network - the run's network.
 * @param day - zero-based replay day.
 * @param colors - resolved theme colors.
 * @returns the layer's complete contents for that day.
 */
export function networkOverlay(
  network: SupplyChainNetwork,
  day: number,
  colors: OverlayColors,
): OverlayDrawable[] {
  const positions = new Map<string, readonly [number, number]>()
  const items: OverlayDrawable[] = []

  for (const node of network.nodes) {
    positions.set(node.id, [node.longitude, node.latitude])
  }

  // Lanes first so markers draw on top of them.
  const closed = new Set(
    network.disruptions
      .filter(each => day >= each.startDay && day < each.startDay + each.durationDays)
      .map(each => `${each.source}->${each.target}`),
  )
  for (const edge of network.edges) {
    const from = positions.get(edge.source)
    const to = positions.get(edge.target)
    /* v8 ignore next -- every edge endpoint is a node of the same run */
    if (!from || !to) continue
    const utilization = edge.utilization[day] ?? 0
    const isClosed = closed.has(`${edge.source}->${edge.target}`)
    items.push({
      kind: 'line',
      id: `lane:${edge.source}->${edge.target}`,
      coordinates: [from, to],
      color: isClosed ? colors.closed : utilization >= 1 ? colors.saturated : colors.lane,
      width: MIN_LANE_WIDTH + Math.min(utilization, 1) * LANE_WIDTH_RANGE,
    })
  }

  for (const node of network.nodes) {
    const backlog = nodeBacklogOn(node, day)
    items.push({
      kind: 'point',
      id: `node:${node.id}`,
      lon: node.longitude,
      lat: node.latitude,
      color: node.tier === 0 ? colors.destination : backlog > 0 ? colors.stressed : colors.healthy,
      pixelSize: tierPixels(node.tier),
      label: node.id,
    })
  }

  return items
}

/**
 * Goods in transit at a continuous replay position.
 *
 * Kept apart from {@link networkOverlay} because these move every frame while
 * lanes and facilities only change on a day boundary. Lanes are draped ground
 * primitives that load asynchronously, so rebuilding them at frame rate leaves
 * them permanently unloaded — they must be redrawn only when their day changes.
 * @param network - the run's network.
 * @param position - continuous replay position; the fraction sets progress along a path.
 * @returns one drawable per shipment currently in transit.
 */
export function goodsOverlay(
  network: SupplyChainNetwork,
  position: number,
): OverlayDrawable[] {
  const positions = new Map<string, readonly [number, number]>()
  for (const node of network.nodes) {
    positions.set(node.id, [node.longitude, node.latitude])
  }
  const items: OverlayDrawable[] = []
  for (const shipment of network.shipments) {
    if (position < shipment.departureDay || position > shipment.arrivalDay) continue
    const transit = shipment.arrivalDay - shipment.departureDay
    const progress = transit <= 0 ? 1 : (position - shipment.departureDay) / transit
    const path = shipment.pathNodes
      .map(id => positions.get(id))
      .filter((point): point is readonly [number, number] => point !== undefined)
    if (path.length === 0) continue
    const [lon, lat] = alongPath(path, progress)
    items.push({
      kind: 'point',
      id: `ship:${shipment.id}`,
      lon,
      lat,
      pixelSize: SHIPMENT_PIXELS,
      color: itemColor(shipment.item),
      label: `${network.itemIds[shipment.item] ?? 'item'} × ${shipment.units}`,
    })
  }
  return items
}

/**
 * The whole overlay at one replay position.
 * @param network - the run's network.
 * @param position - continuous replay position.
 * @param colors - resolved theme colors.
 * @returns lanes, facilities, and goods in transit.
 */
export function overlayForDay(
  network: SupplyChainNetwork,
  position: number,
  colors: OverlayColors,
): OverlayDrawable[] {
  return [
    ...networkOverlay(network, Math.floor(position), colors),
    ...goodsOverlay(network, position),
  ]
}

/** One point of a normalized sparkline path, in 0..1 view units. */
export interface SparklinePoint {
  readonly x: number
  readonly y: number
}

/**
 * Normalize a series into 0..1 view units for an SVG path.
 *
 * A flat series maps to the middle of the band rather than to 0 or 1, so a
 * constant inventory reads as a level line instead of hugging an axis.
 * @param series - the values in day order.
 * @returns the normalized points, empty when the series is empty.
 */
export function sparkline(series: readonly number[]): SparklinePoint[] {
  if (series.length === 0) return []
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min
  const lastIndex = Math.max(series.length - 1, 1)
  return series.map((value, index) => ({
    x: index / lastIndex,
    y: span === 0 ? 0.5 : (value - min) / span,
  }))
}

/**
 * Render normalized points as an SVG polyline `points` attribute.
 * @param points - normalized sparkline points.
 * @param width - viewport width in user units.
 * @param height - viewport height in user units.
 * @returns the `points` attribute value, y flipped so larger values sit higher.
 */
export function sparklinePoints(points: readonly SparklinePoint[], width: number, height: number): string {
  return points.map(point => `${(point.x * width).toFixed(2)},${((1 - point.y) * height).toFixed(2)}`).join(' ')
}

/**
 * Scale a value against the largest in a set, for a bar chart's fill fraction.
 * @param value - the bar's value.
 * @param max - the largest value in the chart.
 * @returns a fraction in 0..1; 0 when the chart's maximum is not positive.
 */
export function barFraction(value: number, max: number): number {
  if (!(max > 0)) return 0
  return Math.min(Math.max(value / max, 0), 1)
}
