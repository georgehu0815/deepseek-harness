/**
 * Registers the `geoCommand` session projection: a fold over `geo/command`
 * events that carries the latest camera/base-map/domain/draw command, the
 * accumulated set of enabled domain layers and drawn features, and a per-session
 * sequence number. The client Earth bridge reads this projection, re-applies the
 * latest command when the sequence advances, and reconstructs domain visibility
 * and the "Drawings" layer from the accumulated state. The `geo/command` event
 * and `geoCommand` key are declared in `./types.ts` (their one home).
 * @module @deepseek-ai/dsh-geo-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
// Type-only: resolves ctx.sessionProjections and the SessionProjectionMap merge.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { GeoCommand, GeoCommandState, GeoDrawnFeature, GeoDrawnGeometry } from './types.ts'

// Re-export the domain types onto the package root and keep the declaration
// merges (SessionEventMap, SessionProjectionMap) in the emitted index.d.ts so
// aggregate programs consuming this package receive them.
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'geo-command'
/** Services required to register the projection. */
export const inject = ['sessionProjections']

/** A WGS84 `[lon, lat]` coordinate pair. */
const lonLat = zod.tuple([zod.number(), zod.number()])

/** Wire schema of a drawn feature's geometry. */
const geometrySchema: ZodType<GeoDrawnGeometry> = zod.union([
  zod.object({ type: zod.literal('point'), coordinates: lonLat }),
  zod.object({ type: zod.literal('polyline'), coordinates: zod.array(lonLat) }),
  zod.object({ type: zod.literal('polygon'), coordinates: zod.array(lonLat) }),
])

/** Wire schema of an accumulated drawn feature. */
const featureSchema: ZodType<GeoDrawnFeature> = zod.object({
  id: zod.string(),
  geometry: geometrySchema,
  name: zod.string().optional(),
})

/** Wire schema of one geo command. */
const commandSchema: ZodType<GeoCommand> = zod.union([
  zod.object({ kind: zod.literal('camera'), lat: zod.number(), lon: zod.number(), height: zod.number() }),
  zod.object({ kind: zod.literal('basemap'), id: zod.string() }),
  zod.object({ kind: zod.literal('domain-toggle'), domain: zod.string(), on: zod.boolean() }),
  zod.object({ kind: zod.literal('draw-feature'), id: zod.string(), geometry: geometrySchema }),
  zod.object({ kind: zod.literal('move-feature'), id: zod.string(), dLon: zod.number(), dLat: zod.number() }),
  zod.object({ kind: zod.literal('set-feature-props'), id: zod.string(), name: zod.string() }),
  zod.object({ kind: zod.literal('delete-features'), ids: zod.array(zod.string()) }),
  zod.object({ kind: zod.literal('undo-draw') }),
])

/** Wire payload schema of the `geoCommand` projection. */
const geoCommandSchema: ZodType<GeoCommandState> = zod.object({
  seq: zod.number(),
  command: zod.union([commandSchema, zod.null()]),
  enabledDomains: zod.array(zod.string()),
  features: zod.array(featureSchema),
})

/** Empty-log state: no command issued, no layers enabled, no features drawn. */
const INITIAL: GeoCommandState = { seq: 0, command: null, enabledDomains: [], features: [] }

/** Shift a geometry's coordinates by a `[lon, lat]` degree delta. */
function shiftGeometry(geometry: GeoDrawnGeometry, dLon: number, dLat: number): GeoDrawnGeometry {
  if (geometry.type === 'point') {
    const [lon, lat] = geometry.coordinates
    return { type: 'point', coordinates: [lon + dLon, lat + dLat] }
  }
  const moved = geometry.coordinates.map(([lon, lat]): readonly [number, number] => [lon + dLon, lat + dLat])
  return geometry.type === 'polyline'
    ? { type: 'polyline', coordinates: moved }
    : { type: 'polygon', coordinates: moved }
}

/** Fold one accumulating draw/domain command into the enabled/feature state. */
function foldAccumulated(state: GeoCommandState, command: GeoCommand): {
  enabledDomains: readonly string[]
  features: readonly GeoDrawnFeature[]
} {
  const { enabledDomains, features } = state
  switch (command.kind) {
    case 'domain-toggle': {
      const without = enabledDomains.filter(domain => domain !== command.domain)
      return { enabledDomains: command.on ? [...without, command.domain] : without, features }
    }
    case 'draw-feature':
      return { enabledDomains, features: [...features, { id: command.id, geometry: command.geometry }] }
    case 'move-feature':
      return {
        enabledDomains,
        features: features.map(feature => feature.id === command.id
          ? { ...feature, geometry: shiftGeometry(feature.geometry, command.dLon, command.dLat) }
          : feature),
      }
    case 'set-feature-props':
      return {
        enabledDomains,
        features: features.map(feature => feature.id === command.id
          ? { ...feature, name: command.name }
          : feature),
      }
    case 'delete-features': {
      const removed = new Set(command.ids)
      return { enabledDomains, features: features.filter(feature => !removed.has(feature.id)) }
    }
    case 'undo-draw':
      return { enabledDomains, features: features.slice(0, -1) }
    default:
      // camera and basemap commands leave the accumulated state unchanged.
      return { enabledDomains, features }
  }
}

/**
 * Register the `geoCommand` projection fold on `ctx.sessionProjections`.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register<'geoCommand', GeoCommandState>({
    key: 'geoCommand',
    schema: geoCommandSchema,
    init: () => INITIAL,
    apply: (state, event) => {
      if (event.type === 'geo/command') {
        const command: GeoCommand = event.data
        return { seq: state.seq + 1, command, ...foldAccumulated(state, command) }
      }
      return state
    },
    view: state => state,
    stateVersion: 2,
  })
}
