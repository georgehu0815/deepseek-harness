/**
 * Consumer for the segmentation seam: the `segment_view` tool. It reads the
 * current view bbox from the session's latest `geo/view` or `geo/command`
 * camera event, calls `ctx.segment.segment`, and draws one `geo/command`
 * polygon per detected feature. The tool owns no I/O; the seam owns the
 * provider.
 * @module @deepseek-ai/dsh-geo-segment/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves ctx.segment and the geo/command SessionEventMap merge.
import type {} from './index.ts'
import type {} from '@deepseek-ai/dsh-geo-command'
import type { SegmentBBox, SegmentGeometry } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-segment-view'
/** Services required by the segment_view tool. */
export const inject = ['tools', 'segment']

/**
 * Half-span in degrees of the bbox derived from a camera pose, per meter of
 * camera height. The heuristic treats the visible ground half-width as roughly
 * proportional to height and converts meters to degrees at ~111 km/degree, so
 * `height / 111000 / 2` degrees on each side. It is a coarse fallback used only
 * when no explicit bbox is logged.
 */
const CAMERA_HALF_SPAN_DEG_PER_METER = 1 / 111_000 / 2

/** A logged event with a discriminating `type` and opaque `data`. */
interface LoggedEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * Derive the current view bbox from the session's most recent geo event. Scans
 * newest-first for a `geo/view` event carrying a bbox or pose, else a
 * `geo/command` camera event, and approximates a bbox from a camera pose.
 * @param events - the session event log, oldest-first.
 * @returns the current view bbox, or undefined when no geo event yields one.
 */
export function bboxFromEvents(events: readonly LoggedEvent[]): SegmentBBox | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event === undefined) continue
    if (event.type === 'geo/view') {
      const data = event.data as {
        bbox?: SegmentBBox
        pose?: { lat: number; lon: number; height: number }
      }
      if (data.bbox !== undefined) return data.bbox
      if (data.pose !== undefined) return bboxFromPose(data.pose)
    }
    if (event.type === 'geo/command') {
      const data = event.data as { kind?: string; lat?: number; lon?: number; height?: number }
      if (data.kind === 'camera' && data.lat !== undefined && data.lon !== undefined && data.height !== undefined) {
        return bboxFromPose({ lat: data.lat, lon: data.lon, height: data.height })
      }
    }
  }
  return undefined
}

/**
 * Approximate a view bbox from a camera pose using the height heuristic.
 * @param pose - camera latitude, longitude, and height in meters.
 * @returns a square bbox centered on the pose.
 */
function bboxFromPose(pose: { lat: number; lon: number; height: number }): SegmentBBox {
  const half = Math.max(pose.height, 0) * CAMERA_HALF_SPAN_DEG_PER_METER
  return {
    west: pose.lon - half,
    south: pose.lat - half,
    east: pose.lon + half,
    north: pose.lat + half,
  }
}

/**
 * Narrow a model-supplied geometry string, defaulting when absent.
 * @param value - the raw `geometry` argument.
 * @returns 'mask' or 'box'; undefined leaves the seam default in place.
 * @throws when the value is a non-empty unknown geometry mode.
 */
function toGeometry(value: string | undefined): SegmentGeometry | undefined {
  if (value === undefined) return undefined
  if (value === 'mask' || value === 'box') return value
  throw new Error(`unknown geometry '${value}'; known: mask, box`)
}

/**
 * Register `segment_view` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and segment seam.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'segment_view',
    description:
      'Segment the current 3D Earth view into polygons for each detected object '
      + '(default: buildings/homes) using the SAM segmentation backend, and draw '
      + 'one polygon per detection on the globe. If nothing is detected, retry with '
      + 'a lower confidence (e.g. 0.25) or a different prompt.',
    parameters: {
      prompt: { type: 'string', description: "What to segment, e.g. 'house' or 'building'." },
      geometry: { type: 'string', description: "'mask' for footprints (default) or 'box' for bounding boxes." },
      confidence: { type: 'number', description: 'Detection confidence threshold 0-1 (default 0.25). Lower finds more, less precise objects.' },
      maxFeatures: { type: 'number', description: 'Maximum number of detections to draw.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          prompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Segmented ${String(value.count)} features for '${value.prompt}' in the current view.`,
      }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('segment_view requires an owning agent session')
      const session = exec.agent.session
      const bbox = bboxFromEvents(session.events)
      if (bbox === undefined) throw new Error('segment_view: no current view; move the camera first.')

      const geometry = toGeometry(args.geometry)
      const confidence = typeof args.confidence === 'number' && args.confidence > 0 && args.confidence <= 1
        ? args.confidence
        : undefined
      const collection = await ctx.segment.segment({
        bbox,
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(geometry === undefined ? {} : { geometry }),
        ...(confidence === undefined ? {} : { confidenceThreshold: confidence }),
      }, exec.signal)

      const limit = typeof args.maxFeatures === 'number' && args.maxFeatures >= 0
        ? Math.floor(args.maxFeatures)
        : collection.features.length
      const selected = collection.features.slice(0, limit)
      const baseSeq = session.seq
      // The prompt is the feature's semantic type (house/building/road...); it
      // rides each draw-feature command so the summary table and GeoJSON export
      // can label the polygon by what it was detected as.
      const prompt = args.prompt ?? ctx.segment.resolve({ bbox }).prompt
      selected.forEach((feature, i) => {
        const ring = feature.geometry.coordinates[0] ?? []
        const coordinates: (readonly [number, number])[] = []
        for (const position of ring) {
          const lon = position[0]
          const lat = position[1]
          if (lon !== undefined && lat !== undefined) coordinates.push([lon, lat])
        }
        session.append('geo/command', {
          kind: 'draw-feature',
          id: `feat-${baseSeq}-${i}`,
          geometry: { type: 'polygon', coordinates },
          featureType: prompt,
        })
      })

      return { count: selected.length, prompt }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Segment view for ${args.prompt ?? 'buildings'}`,
      kind: 'other',
    }),
  }))
}
