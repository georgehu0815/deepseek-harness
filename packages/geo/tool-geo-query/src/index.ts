/**
 * Model-facing geo read tools over the `ctx.geo` capability seam:
 * `geo_geocode` (place name → coordinates + bbox) and `geo_list_basemaps`
 * (available base-map presets). Both are read-only and concurrency-safe. The
 * tools own no I/O; they call the seam, which owns the provider.
 * @module @deepseek-ai/dsh-tool-geo-query
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves ctx.geo for injection typing.
import type {} from '@deepseek-ai/dsh-geo'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-geo-query'
/** Services required by the geo read tools. */
export const inject = ['tools', 'geo']

/**
 * Register `geo_geocode` and `geo_list_basemaps` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and geo seam.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'geo_geocode',
    description:
      'Resolve a place name (city, country, landmark, address) to geographic coordinates. '
      + 'Returns ranked matches with latitude/longitude and, when available, a bounding box. '
      + 'Use before flying the camera to a named place.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text place name to resolve.' },
      limit: { type: 'integer', description: 'Maximum matches to return (1-20, default 5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          places: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                lat: { type: 'number', required: true },
                lon: { type: 'number', required: true },
                kind: { type: 'string' },
                bbox: { type: 'array', items: { type: 'number' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.places.length === 0
          ? 'No matching place found.'
          : value.places.map(p => `${p.name} — ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 5
      const places = await ctx.geo.geocode(args.query, limit, exec.signal)
      return {
        places: places.map(p => ({
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          ...(p.kind === undefined ? {} : { kind: p.kind }),
          ...(p.bbox === undefined ? {} : { bbox: [...p.bbox] }),
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Geocode "${args.query}"`, kind: 'fetch', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_list_basemaps',
    description:
      'List the available base-map imagery presets for the 3D Earth view, each with an id and label. '
      + 'Use the returned id with set_basemap to change the globe imagery.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          basemaps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                attribution: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.basemaps.map(b => `${b.id} — ${b.label}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    execute() {
      const basemaps = ctx.geo.listBaseMaps().map(b => ({
        id: b.id,
        label: b.label,
        attribution: b.attribution,
      }))
      return Promise.resolve({ basemaps })
    },
    presentCall: () => ({ card: 'generic', title: 'List base maps', kind: 'other' }),
  }))
}
