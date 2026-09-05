/**
 * SAM3 HTTP Service Provider for the segmentation seam. `SamGeoProvider` posts
 * a view raster to a SAM3-style backend's `/segment/geo` endpoint and validates
 * the GeoJSON reply at this process boundary. The `fetchImpl` constructor
 * argument is injectable so tests exercise the multipart call and reply mapping
 * offline. The plugin `apply` constructs the provider from validated config and
 * registers it on `ctx.segment`.
 * @module @deepseek-ai/dsh-geo-segment/provider-samgeo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: resolves ctx.segment for injection typing.
import type {} from './index.ts'
import type {
  SegmentFeatureCollection,
  SegmentProvider,
  SegmentSpec,
} from './types.ts'

/** The `fetch` surface this provider depends on, narrowed for injection. */
export type FetchImpl = (input: string, init?: {
  readonly method?: string
  readonly body?: FormData
  readonly signal?: AbortSignal
}) => Promise<{
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
  blob(): Promise<Blob>
}>

/** Deployment config for the SAM3 HTTP backend. */
export interface SamGeoConfig {
  /** Base URL of the SAM3 backend, e.g. `http://localhost:8000`. */
  readonly baseUrl: string
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  readonly timeoutMs?: number
  /**
   * Template for the georeferenced view raster fetched when a request omits an
   * explicit `imageUrl`. The `{west}` `{south}` `{east}` `{north}` `{width}`
   * `{height}` placeholders are replaced with the view's on-screen bounds and
   * the target pixel size. The default targets Esri World Imagery's `export`
   * endpoint — the same imagery the 3D Earth panel renders — so the segmented
   * raster matches what the person sees. Set to an empty string to require an
   * explicit `imageUrl` instead.
   */
  readonly imageryUrlTemplate?: string
  /** Target raster width in pixels for the synthesized imagery URL. Defaults to 1024. */
  readonly imageryWidth?: number
  /** Target raster height in pixels for the synthesized imagery URL. Defaults to 1024. */
  readonly imageryHeight?: number
}

/**
 * Default imagery source: Esri World Imagery `export`, returning a PNG for the
 * requested WGS84 bbox. Matches the `esri-satellite` basemap the earth panel uses.
 */
const DEFAULT_IMAGERY_TEMPLATE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
  + '?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326'
  + '&size={width},{height}&format=png&transparent=false&f=image'

/** Config schema: `baseUrl` is required and non-empty. */
export const Config: z<SamGeoConfig> = z.object({
  baseUrl: z.string().required(),
  timeoutMs: z.natural().default(60_000),
  imageryUrlTemplate: z.string().default(DEFAULT_IMAGERY_TEMPLATE),
  imageryWidth: z.natural().default(1024),
  imageryHeight: z.natural().default(1024),
})

/** Wire schema of one detected feature (validated at the HTTP boundary). */
const featureSchema = z.object({
  type: z.const('Feature').required(),
  geometry: z.object({
    type: z.const('Polygon').required(),
    coordinates: z.array(z.array(z.array(z.number()))).required(),
  }).required(),
  properties: z.object({
    score: z.number(),
    prompt: z.string(),
  }).required(),
})

/** Wire schema of the FeatureCollection the backend returns. */
const collectionSchema = z.object({
  type: z.const('FeatureCollection').required(),
  features: z.array(featureSchema).default([]),
})

/**
 * Build the multipart form for a `/segment/geo` request from a resolved spec
 * and its raster. Extracted so tests assert field composition without network.
 * @param spec - the resolved segmentation request.
 * @param image - the view raster to segment.
 * @returns the multipart form the provider posts.
 */
export function buildFormData(spec: SegmentSpec, image: Blob): FormData {
  const { west, south, east, north } = spec.bbox
  const form = new FormData()
  form.set('file', image, 'view.png')
  form.set('prompt', spec.prompt)
  form.set('bbox', `${west},${south},${east},${north}`)
  form.set('geometry', spec.geometry)
  form.set('confidence_threshold', String(spec.confidenceThreshold))
  return form
}

/**
 * Fill an imagery URL template with a view's bounds and target pixel size.
 * @param template - a URL with `{west}` `{south}` `{east}` `{north}` `{width}` `{height}` placeholders.
 * @param bbox - the view's on-screen WGS84 bounds.
 * @param width - target raster width in pixels.
 * @param height - target raster height in pixels.
 * @returns the concrete imagery URL to fetch.
 */
export function buildImageryUrl(
  template: string,
  bbox: SegmentSpec['bbox'],
  width: number,
  height: number,
): string {
  return template
    .replaceAll('{west}', String(bbox.west))
    .replaceAll('{south}', String(bbox.south))
    .replaceAll('{east}', String(bbox.east))
    .replaceAll('{north}', String(bbox.north))
    .replaceAll('{width}', String(width))
    .replaceAll('{height}', String(height))
}

/** A SAM3 HTTP segmentation backend. */
export class SamGeoProvider implements SegmentProvider {
  /** Stable provider id. */
  readonly id = 'samgeo-http'
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly imageryUrlTemplate: string
  private readonly imageryWidth: number
  private readonly imageryHeight: number
  private readonly fetchImpl: FetchImpl

  /**
   * @param config - validated backend config.
   * @param fetchImpl - HTTP client; defaults to global `fetch`. Tests inject a fake.
   */
  constructor(config: SamGeoConfig, fetchImpl: FetchImpl = fetch as unknown as FetchImpl) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? 60_000
    this.imageryUrlTemplate = config.imageryUrlTemplate ?? DEFAULT_IMAGERY_TEMPLATE
    this.imageryWidth = config.imageryWidth ?? 1024
    this.imageryHeight = config.imageryHeight ?? 1024
    this.fetchImpl = fetchImpl
  }

  /**
   * Segment a view: obtain the raster, POST it as multipart form data, and
   * validate the GeoJSON reply.
   * @param spec - the resolved segmentation request.
   * @param signal - caller abort signal, merged with the timeout deadline.
   * @returns the validated FeatureCollection.
   * @throws when no raster source is available or the backend fails.
   */
  async segment(spec: SegmentSpec, signal?: AbortSignal): Promise<SegmentFeatureCollection> {
    // Prefer an explicit raster URL; otherwise synthesize one for the view's
    // bounds from the configured imagery template (the imagery the earth panel
    // shows). An empty template disables synthesis and requires an explicit URL.
    const imageUrl = spec.imageUrl
      ?? (this.imageryUrlTemplate === ''
        ? undefined
        : buildImageryUrl(this.imageryUrlTemplate, spec.bbox, this.imageryWidth, this.imageryHeight))
    if (imageUrl === undefined) {
      throw new Error('SamGeoProvider: no raster source — provide an imageUrl or set imageryUrlTemplate')
    }

    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    if (signal !== undefined) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const imageResponse = await this.fetchImpl(imageUrl, { method: 'GET', signal: controller.signal })
      if (!imageResponse.ok) {
        throw new Error(`SamGeoProvider: image fetch failed (${imageResponse.status}): ${await imageResponse.text()}`)
      }
      const image = await imageResponse.blob()
      const form = buildFormData(spec, image)
      const response = await this.fetchImpl(`${this.baseUrl}/segment/geo`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const body = await response.text()
      if (!response.ok) {
        throw new Error(`SamGeoProvider: segment failed (${response.status}): ${body}`)
      }
      return collectionSchema(JSON.parse(body)) as SegmentFeatureCollection
    } finally {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'geo-segment-samgeo'
/** Services required before the provider can register. */
export const inject = ['segment']

/**
 * Construct the SAM3 provider and register it on `ctx.segment`.
 * @param ctx - registrant context carrying the segmentation seam.
 * @param config - validated backend config.
 */
export function apply(ctx: Context, config: SamGeoConfig): void {
  const provider = new SamGeoProvider(config)
  ctx.effect(() => ctx.segment.registerProvider(provider))
}
