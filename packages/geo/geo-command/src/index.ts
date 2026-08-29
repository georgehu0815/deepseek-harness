/**
 * Registers the `geoCommand` session projection: a last-wins fold over
 * `geo/command` events that carries the latest camera/base-map command plus a
 * per-session sequence number. The client Earth bridge reads this projection
 * and re-applies a command only when the sequence advances. The `geo/command`
 * event and `geoCommand` key are declared in `./types.ts` (their one home).
 * @module @deepseek-ai/dsh-geo-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
// Type-only: resolves ctx.sessionProjections and the SessionProjectionMap merge.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { GeoCommand, GeoCommandState } from './types.ts'

// Re-export the domain types onto the package root and keep the declaration
// merges (SessionEventMap, SessionProjectionMap) in the emitted index.d.ts so
// aggregate programs consuming this package receive them.
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'geo-command'
/** Services required to register the projection. */
export const inject = ['sessionProjections']

/** Wire payload schema of the `geoCommand` projection. */
const geoCommandSchema: ZodType<GeoCommandState> = zod.object({
  seq: zod.number(),
  command: zod.union([
    zod.object({ kind: zod.literal('camera'), lat: zod.number(), lon: zod.number(), height: zod.number() }),
    zod.object({ kind: zod.literal('basemap'), id: zod.string() }),
    zod.null(),
  ]),
})

/** Empty-log state: no command issued. */
const INITIAL: GeoCommandState = { seq: 0, command: null }

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
        return { seq: state.seq + 1, command }
      }
      return state
    },
    view: state => state,
    stateVersion: 1,
  })
}
