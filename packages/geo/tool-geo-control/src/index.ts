/**
 * Model-facing geo control tools that command the 3D Earth view: `control_camera`
 * (fly to a location) and `set_basemap` (change the globe imagery). Each appends
 * a `geo/command` event to the calling agent's session; the `geoCommand`
 * projection folds the latest command and the Earth view applies it. A
 * non-agent caller has no owning session and is rejected.
 * @module @deepseek-ai/dsh-tool-geo-control
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the geo/command SessionEventMap merge for session.append.
import type {} from '@deepseek-ai/dsh-geo-command'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-geo-control'
/** Services required by the geo control tools. */
export const inject = ['tools']

/** Default camera height in meters when the model omits one. */
const DEFAULT_HEIGHT_M = 2_000_000

/**
 * Register `control_camera` and `set_basemap` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'control_camera',
    description:
      'Move the 3D Earth view camera to a geographic location. Provide latitude and longitude in '
      + 'degrees; optionally a height in meters (lower is closer). Use after geo_geocode to fly to a '
      + 'named place. The view updates immediately for the person watching.',
    parameters: {
      lat: { type: 'number', required: true, description: 'Latitude in degrees (-90 to 90).' },
      lon: { type: 'number', required: true, description: 'Longitude in degrees (-180 to 180).' },
      height: { type: 'number', description: 'Camera height above the surface in meters (default 2,000,000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lat: { type: 'number', required: true },
          lon: { type: 'number', required: true },
          height: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Camera moved to ${value.lat.toFixed(4)}, ${value.lon.toFixed(4)} at ${Math.round(value.height)} m.`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('control_camera requires an owning agent session')
      const lat = clamp(args.lat, -90, 90)
      const lon = clamp(args.lon, -180, 180)
      const height = typeof args.height === 'number' && args.height > 0 ? args.height : DEFAULT_HEIGHT_M
      exec.agent.session.append('geo/command', { kind: 'camera', lat, lon, height })
      return Promise.resolve({ lat, lon, height })
    },
    presentCall: args => ({ card: 'generic', title: `Move camera to ${args.lat}, ${args.lon}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'set_basemap',
    description:
      'Change the base-map imagery of the 3D Earth view. Pass a base-map id from geo_list_basemaps '
      + '(for example "osm", "carto-dark", "esri-satellite"). The view updates immediately.',
    parameters: {
      id: { type: 'string', required: true, description: 'Base-map preset id from geo_list_basemaps.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Base map set to ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('set_basemap requires an owning agent session')
      const id = args.id.trim()
      if (id.length === 0) throw new Error('set_basemap requires a non-empty base-map id')
      exec.agent.session.append('geo/command', { kind: 'basemap', id })
      return Promise.resolve({ id })
    },
    presentCall: args => ({ card: 'generic', title: `Set base map ${args.id}`, kind: 'other' }),
  }))
}

/** Clamp a number into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
