/**
 * Service Definition types for the geo segmentation seam (`ctx.segment`): the
 * request/spec split, the GeoJSON result the backend returns, the provider
 * interface a segmentation backend implements, and the `SegmentRuntime`
 * declaration merge onto the Cordis context. Types only — no runtime code.
 * @module @deepseek-ai/dsh-geo-segment/types
 */

/** A WGS84 bounding box in degrees for the view being segmented. */
export interface SegmentBBox {
  /** Western longitude edge. */
  readonly west: number
  /** Southern latitude edge. */
  readonly south: number
  /** Eastern longitude edge. */
  readonly east: number
  /** Northern latitude edge. */
  readonly north: number
}

/** Geometry mode a segmentation returns: mask footprints or bounding boxes. */
export type SegmentGeometry = 'mask' | 'box'

/**
 * A segmentation request as issued by a Consumer, before defaults are applied.
 * Optional fields are resolved to a `SegmentSpec` by `SegmentRuntime.resolve`.
 */
export interface SegmentRequest {
  /** The view bbox to segment. */
  readonly bbox: SegmentBBox
  /** What to segment, e.g. 'building' or 'house'. Defaults to 'building'. */
  readonly prompt?: string
  /** Return mask footprints or bounding boxes. Defaults to 'mask'. */
  readonly geometry?: SegmentGeometry
  /** Minimum detection score to keep, 0..1. Defaults to 0.5. */
  readonly confidenceThreshold?: number
  /** A pre-fetched raster of the view; the provider decides how to obtain the raster when absent. */
  readonly imageUrl?: string
}

/** A fully-resolved segmentation request with all defaults applied. */
export interface SegmentSpec {
  /** The view bbox to segment. */
  readonly bbox: SegmentBBox
  /** Resolved segmentation prompt. */
  readonly prompt: string
  /** Resolved geometry mode. */
  readonly geometry: SegmentGeometry
  /** Resolved minimum detection score, 0..1. */
  readonly confidenceThreshold: number
  /** A pre-fetched raster of the view, when the Consumer supplied one. */
  readonly imageUrl?: string
}

/** One detected feature as a GeoJSON Polygon with scoring properties. */
export interface SegmentFeature {
  /** GeoJSON discriminant. */
  readonly type: 'Feature'
  /** The detected polygon geometry (rings of `[lon, lat]` positions). */
  readonly geometry: {
    /** GeoJSON geometry discriminant. */
    readonly type: 'Polygon'
    /** Polygon rings; the first ring is the outer boundary. */
    readonly coordinates: number[][][]
  }
  /** Detection metadata. */
  readonly properties: {
    /** Detection score, 0..1, when the backend reports one. */
    readonly score?: number
    /** The prompt the detection answered, when the backend echoes it. */
    readonly prompt?: string
  }
}

/** A GeoJSON FeatureCollection of detected polygons. */
export interface SegmentFeatureCollection {
  /** GeoJSON discriminant. */
  readonly type: 'FeatureCollection'
  /** The detected features. */
  readonly features: SegmentFeature[]
}

/** A segmentation backend the seam can delegate to. */
export interface SegmentProvider {
  /** Stable provider id for diagnostics and last-wins replacement. */
  readonly id: string
  /**
   * Segment a resolved view spec into detected polygons.
   * @param spec - the fully-resolved request.
   * @param signal - abort signal to cancel the backend call.
   * @returns the detected features as a GeoJSON FeatureCollection.
   */
  segment(spec: SegmentSpec, signal?: AbortSignal): Promise<SegmentFeatureCollection>
}

/**
 * The segmentation service registered as `ctx.segment`: holds one active
 * provider, resolves requests to specs, and delegates segmentation.
 */
export interface SegmentRuntime {
  /**
   * Replace the active segmentation provider.
   * @param provider - the provider to make active.
   * @returns a disposer that restores the previous provider.
   */
  registerProvider(provider: SegmentProvider): () => void
  /**
   * Apply the seam's defaults to a request, producing a resolved spec.
   * @param request - the Consumer request.
   * @returns the fully-resolved spec.
   */
  resolve(request: SegmentRequest): SegmentSpec
  /**
   * Resolve then segment a view, delegating to the active provider.
   * @param request - the Consumer request.
   * @param signal - abort signal forwarded to the provider.
   * @returns the detected features as a GeoJSON FeatureCollection.
   */
  segment(request: SegmentRequest, signal?: AbortSignal): Promise<SegmentFeatureCollection>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    segment: SegmentRuntime
  }
}
