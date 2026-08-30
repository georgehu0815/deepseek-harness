/**
 * Service Definition and Service Provider registry for the geo segmentation
 * seam (`ctx.segment`). Segments the current 3D Earth view into GeoJSON
 * polygons by delegating to one active `SegmentProvider` (a SAM3-style
 * backend). The request→spec defaulting is an explicit `resolve` step, never a
 * hidden fallback inside `segment`. No provider is built in: a composition
 * mounts one (e.g. `./provider-samgeo.ts`) via `registerProvider`.
 * @module @deepseek-ai/dsh-geo-segment
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  SegmentFeatureCollection,
  SegmentProvider,
  SegmentRequest,
  SegmentSpec,
} from './types.ts'

export type * from './types.ts'

/** Default segmentation prompt when a request omits one. */
export const DEFAULT_PROMPT = 'building'
/** Default geometry mode: mask footprints. */
export const DEFAULT_GEOMETRY = 'mask' as const
/** Default minimum detection score to keep. Tuned against SAM3 on Esri World
 * Imagery, where 0.5 rejects most true rooftops; 0.25 keeps clean footprints
 * without flooding the view with low-confidence noise. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.25

/**
 * The segmentation service, registered as `ctx.segment` (one instance per
 * context). Holds one active provider (none by default) and applies the seam's
 * defaults.
 */
export class SegmentRuntime extends Service {
  private provider: SegmentProvider | undefined

  /** @param ctx - owning context. */
  constructor(ctx: Context) {
    super(ctx, 'segment')
  }

  /**
   * Replace the active segmentation provider (last-wins).
   * @param provider - the provider to make active.
   * @returns a disposer that restores the previous provider.
   */
  registerProvider(provider: SegmentProvider): () => void {
    const previous = this.provider
    this.provider = provider
    return () => { this.provider = previous }
  }

  /**
   * Apply the seam's defaults to a request, producing a resolved spec. This is
   * the seam's only defaulting step; `segment` performs none of its own.
   * @param request - the Consumer request.
   * @returns the fully-resolved spec.
   */
  resolve(request: SegmentRequest): SegmentSpec {
    return {
      bbox: request.bbox,
      prompt: request.prompt ?? DEFAULT_PROMPT,
      geometry: request.geometry ?? DEFAULT_GEOMETRY,
      confidenceThreshold: request.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      ...(request.imageUrl === undefined ? {} : { imageUrl: request.imageUrl }),
    }
  }

  /**
   * Resolve then segment a view, delegating to the active provider.
   * @param request - the Consumer request.
   * @param signal - abort signal forwarded to the provider.
   * @returns the detected features as a GeoJSON FeatureCollection.
   * @throws when no segmentation provider is registered.
   */
  async segment(request: SegmentRequest, signal?: AbortSignal): Promise<SegmentFeatureCollection> {
    const spec = this.resolve(request)
    const provider = this.provider
    if (provider === undefined) throw new Error('geo-segment: no segmentation provider registered')
    return await provider.segment(spec, signal)
  }
}

export default SegmentRuntime
