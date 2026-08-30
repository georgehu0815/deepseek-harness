/**
 * The geo view-report domain: the `geoView` session projection (a last-wins fold
 * over `geo/view` events carrying the latest reported camera view) and the
 * `CameraViewService` (`ctx.geoView`) whose `report` Remote appends one
 * `geo/view` event from the untrusted browser reporter. Consumers — the
 * geo-viewcontext pre-step injection, the `get_current_view` tool, and the
 * client Earth panel — read the projection or the underlying event to reason
 * about what is actually on screen. The `geo/view` event and `geoView` key are
 * declared in `./types.ts` (their one home).
 * @module @deepseek-ai/dsh-geo-view
 */

import { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: resolves ctx.sessionProjections and the SessionProjectionMap merge.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { GeoView, GeoViewState } from './types.ts'

// Re-export the domain types onto the package root and keep the declaration
// merges (SessionEventMap, SessionProjectionMap) in the emitted index.d.ts.
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    geoView: CameraViewService
  }
}

/** Wire schema of a reported camera pose. Numbers must be finite (untrusted browser input). */
const poseSchema = zod.object({
  lat: zod.number().finite(),
  lon: zod.number().finite(),
  height: zod.number().finite(),
  heading: zod.number().finite().optional(),
  pitch: zod.number().finite().optional(),
})

/** Wire schema of an on-screen bbox: east strictly east of west, north strictly north of south. */
const bboxSchema = zod.object({
  west: zod.number().finite(),
  south: zod.number().finite(),
  east: zod.number().finite(),
  north: zod.number().finite(),
}).refine(b => b.east > b.west, { message: 'bbox east must be greater than west' })
  .refine(b => b.north > b.south, { message: 'bbox north must be greater than south' })

/** Wire schema of one reported view (used to fold the projection). */
const viewSchema: ZodType<GeoView> = zod.object({
  source: zod.union([zod.literal('user'), zod.literal('agent')]),
  pose: poseSchema,
  bbox: bboxSchema.optional(),
}) as ZodType<GeoView>

/** Wire payload schema of the `geoView` projection. */
const geoViewSchema: ZodType<GeoViewState> = zod.object({
  seq: zod.number(),
  view: zod.union([viewSchema, zod.null()]),
}) as ZodType<GeoViewState>

/** Empty-log state: no view reported yet. */
const INITIAL: GeoViewState = { seq: 0, view: null }

/**
 * Validate one browser-reported view at the wire boundary. The camera report is
 * untrusted input, so every field is checked and an invalid report is rejected
 * loudly rather than appended.
 * @param view - the reported view to validate.
 * @returns the same value, typed, once every field passes.
 * @throws {@link Error} when the source, pose, or bbox is malformed.
 */
function validateReportedView(view: GeoView): GeoView {
  const parsed = viewSchema.safeParse(view)
  if (!parsed.success) {
    throw new Error(`geo-view: invalid reported view — ${parsed.error.message}`)
  }
  return parsed.data
}

/**
 * Camera-view report service (`ctx.cameraView`). Its single Remote appends one
 * `geo/view` event to the owning agent's session so the browser's real camera
 * becomes durable and model-visible. Registers the `geoView` projection fold in
 * its constructor when a projection registry is composed.
 */
export class CameraViewService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'geoView')
    // The `geoView` projection unit: last-wins fold of geo/view whole values.
    // Activates only when a projection registry is composed (headless
    // assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'geoView', GeoViewState>({
        key: 'geoView',
        schema: geoViewSchema,
        init: () => INITIAL,
        apply: (state, event) => {
          if (event.type === 'geo/view') {
            return { seq: state.seq + 1, view: event.data }
          }
          return state
        },
        view: state => state,
        stateVersion: 1,
      })
    })
  }

  /**
   * Append one browser-reported camera view to the owning session log.
   * @param agent - exact live Agent resolved from the wire identity.
   * @param view - the reported view (validated as untrusted browser input).
   * @returns the new per-session view sequence number.
   * @throws {@link Error} when the view is malformed.
   */
  @Remote('report')
  report(agent: Agent, view: GeoView): { seq: number } {
    const validated = validateReportedView(view)
    const event = agent.session.append('geo/view', validated)
    return { seq: event.seq }
  }
}

export default CameraViewService
