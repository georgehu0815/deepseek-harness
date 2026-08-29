/**
 * Model-facing geo control tools that command the 3D Earth view: fly the camera
 * (`control_camera`), switch imagery (`set_basemap`), toggle a domain data layer
 * (`toggle_domain`), and draw/edit annotation features (`draw_point`,
 * `draw_polyline`, `draw_polygon`, `move_feature`, `set_feature_properties`,
 * `delete_features`, `undo_draw`). Each appends a `geo/command` event to the
 * calling agent's session; the `geoCommand` projection folds the latest command
 * plus the accumulated enabled layers and drawn features, and the Earth view
 * applies them. A non-agent caller has no owning session and is rejected.
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
 * Domain data layers the agent can toggle. Mirrors the seam's domain ids; a
 * fixed, model-facing list so the tool rejects an unknown layer by name.
 */
const DOMAIN_IDS = ['airports', 'cities', 'lakes', 'ports', 'railroads', 'roads', 'time-zones'] as const

/**
 * Register the geo control tools on `ctx.tools`.
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

  ctx.tools.register(defineTool({
    name: 'toggle_domain',
    description:
      'Show or hide a domain data layer on the 3D Earth view. Domains: '
      + `${DOMAIN_IDS.join(', ')}. Pass on=true to show the layer, on=false to hide it.`,
    parameters: {
      domain: { type: 'string', required: true, description: `Domain layer id (one of: ${DOMAIN_IDS.join(', ')}).` },
      on: { type: 'boolean', required: true, description: 'True to show the layer, false to hide it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { domain: { type: 'string', required: true }, on: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Domain ${value.domain} ${value.on ? 'shown' : 'hidden'}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('toggle_domain requires an owning agent session')
      const domain = args.domain.trim()
      if (!DOMAIN_IDS.includes(domain as (typeof DOMAIN_IDS)[number])) {
        throw new Error(`unknown domain '${domain}'; known: ${DOMAIN_IDS.join(', ')}`)
      }
      exec.agent.session.append('geo/command', { kind: 'domain-toggle', domain, on: args.on })
      return Promise.resolve({ domain, on: args.on })
    },
    presentCall: args => ({ card: 'generic', title: `${args.on ? 'Show' : 'Hide'} domain ${args.domain}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'draw_point',
    description:
      'Draw a point annotation on the 3D Earth view at a WGS84 longitude/latitude. Returns the '
      + 'minted feature id, which move_feature, set_feature_properties, and delete_features accept.',
    parameters: {
      lon: { type: 'number', required: true, description: 'Longitude in degrees (-180 to 180).' },
      lat: { type: 'number', required: true, description: 'Latitude in degrees (-90 to 90).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Drew point ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('draw_point requires an owning agent session')
      const lon = finiteLon(args.lon)
      const lat = finiteLat(args.lat)
      const id = mintFeatureId(exec.agent.session.seq)
      exec.agent.session.append('geo/command', { kind: 'draw-feature', id, geometry: { type: 'point', coordinates: [lon, lat] } })
      return Promise.resolve({ id })
    },
    presentCall: args => ({ card: 'generic', title: `Draw point ${args.lon}, ${args.lat}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'draw_polyline',
    description:
      'Draw a polyline annotation on the 3D Earth view from at least two WGS84 [lon, lat] points. '
      + 'Returns the minted feature id.',
    parameters: {
      coordinates: {
        type: 'array',
        required: true,
        description: 'At least two [lon, lat] points, e.g. [[-122.4, 37.8], [-122.3, 37.9]].',
        items: { type: 'array', items: { type: 'number' } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Drew polyline ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('draw_polyline requires an owning agent session')
      const coordinates = toCoordinates(args.coordinates, 2, 'draw_polyline needs at least 2 [lon, lat] points')
      const id = mintFeatureId(exec.agent.session.seq)
      exec.agent.session.append('geo/command', { kind: 'draw-feature', id, geometry: { type: 'polyline', coordinates } })
      return Promise.resolve({ id })
    },
    presentCall: () => ({ card: 'generic', title: 'Draw polyline', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'draw_polygon',
    description:
      'Draw a polygon annotation on the 3D Earth view from a ring of at least three WGS84 [lon, lat] '
      + 'points. Returns the minted feature id.',
    parameters: {
      coordinates: {
        type: 'array',
        required: true,
        description: 'A ring of at least three [lon, lat] points.',
        items: { type: 'array', items: { type: 'number' } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Drew polygon ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('draw_polygon requires an owning agent session')
      const coordinates = toCoordinates(args.coordinates, 3, 'draw_polygon needs a ring of at least 3 [lon, lat] points')
      const id = mintFeatureId(exec.agent.session.seq)
      exec.agent.session.append('geo/command', { kind: 'draw-feature', id, geometry: { type: 'polygon', coordinates } })
      return Promise.resolve({ id })
    },
    presentCall: () => ({ card: 'generic', title: 'Draw polygon', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'move_feature',
    description:
      'Move an existing drawn feature by a longitude/latitude delta in degrees. Pass the feature id '
      + 'from a draw tool and the dLon/dLat shift.',
    parameters: {
      id: { type: 'string', required: true, description: 'Id of the drawn feature to move.' },
      dLon: { type: 'number', required: true, description: 'Longitude delta in degrees.' },
      dLat: { type: 'number', required: true, description: 'Latitude delta in degrees.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Moved feature ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('move_feature requires an owning agent session')
      const id = args.id.trim()
      if (id.length === 0) throw new Error('move_feature requires a non-empty feature id')
      exec.agent.session.append('geo/command', { kind: 'move-feature', id, dLon: args.dLon, dLat: args.dLat })
      return Promise.resolve({ id })
    },
    presentCall: args => ({ card: 'generic', title: `Move feature ${args.id}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'set_feature_properties',
    description: 'Rename a drawn feature. Pass the feature id and a new display name.',
    parameters: {
      id: { type: 'string', required: true, description: 'Id of the drawn feature to update.' },
      name: { type: 'string', required: true, description: 'New display name for the feature.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Updated feature ${value.id}.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('set_feature_properties requires an owning agent session')
      const id = args.id.trim()
      if (id.length === 0) throw new Error('set_feature_properties requires a non-empty feature id')
      const name = args.name.trim()
      if (name.length === 0) throw new Error('set_feature_properties requires a non-empty name')
      exec.agent.session.append('geo/command', { kind: 'set-feature-props', id, name })
      return Promise.resolve({ id })
    },
    presentCall: args => ({ card: 'generic', title: `Rename feature ${args.id}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'delete_features',
    description: 'Remove drawn features from the 3D Earth view by id. Pass an array of feature ids.',
    parameters: {
      ids: {
        type: 'array',
        required: true,
        description: 'Ids of the drawn features to remove.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { count: { type: 'number', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Deleted ${value.count} feature(s).` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('delete_features requires an owning agent session')
      const ids = args.ids.map(id => id.trim()).filter(id => id.length > 0)
      if (ids.length === 0) throw new Error('delete_features requires at least one feature id')
      exec.agent.session.append('geo/command', { kind: 'delete-features', ids })
      return Promise.resolve({ count: ids.length })
    },
    presentCall: args => ({ card: 'generic', title: `Delete ${args.ids.length} feature(s)`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'undo_draw',
    description: 'Remove the most recently drawn feature from the 3D Earth view.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'Removed the most recent drawn feature.' }],
    },
    execute(_args, exec) {
      if (!exec.agent) throw new Error('undo_draw requires an owning agent session')
      exec.agent.session.append('geo/command', { kind: 'undo-draw' })
      return Promise.resolve({})
    },
    presentCall: () => ({ card: 'generic', title: 'Undo last drawing', kind: 'other' }),
  }))
}

/** Mint a replay-stable feature id from the seq the draw event will occupy. */
function mintFeatureId(seq: number): string {
  return `feat-${seq}`
}

/** Validate a longitude in [-180, 180]. */
function finiteLon(lon: number): number {
  if (lon < -180 || lon > 180) throw new Error('longitude must be a finite number in [-180, 180]')
  return lon
}

/** Validate a latitude in [-90, 90]. */
function finiteLat(lat: number): number {
  if (lat < -90 || lat > 90) throw new Error('latitude must be a finite number in [-90, 90]')
  return lat
}

/** Validate an array of at least `min` [lon, lat] points. */
function toCoordinates(raw: readonly (readonly number[])[], min: number, message: string): [number, number][] {
  if (raw.length < min) throw new Error(message)
  return raw.map((point) => {
    const [lon, lat] = point
    if (point.length !== 2 || lon === undefined || lat === undefined) throw new Error('each point must be [lon, lat]')
    return [finiteLon(lon), finiteLat(lat)]
  })
}

/** Clamp a number into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
