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
import type { DomainId, DomainLod } from '@deepseek-ai/dsh-geo'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-geo-query'
/** Services required by the geo read tools. */
export const inject = ['tools', 'geo']

/** Domain layer ids the model may name, kept in sync with `@deepseek-ai/dsh-geo`. */
const DOMAIN_IDS: readonly DomainId[] = ['airports', 'cities', 'lakes', 'ports', 'railroads', 'roads', 'time-zones']

/** Level-of-detail values a domain query accepts. */
const DOMAIN_LODS: readonly DomainLod[] = ['world', 'regional', 'local']

/**
 * Narrow a model-supplied string to a `DomainId`. Model tool arguments are a
 * JSON boundary, so an unknown domain is rejected loudly rather than passed on.
 * @param value - the raw `domain` argument.
 * @returns the validated domain id.
 * @throws when the value is not a known domain layer.
 */
function toDomainId(value: string): DomainId {
  const match = DOMAIN_IDS.find(id => id === value)
  if (match === undefined) throw new Error(`unknown domain '${value}'; known domains: ${DOMAIN_IDS.join(', ')}`)
  return match
}

/**
 * Narrow a model-supplied string to a `DomainLod`, defaulting when absent.
 * @param value - the raw `lod` argument, or undefined.
 * @returns the validated level of detail (`regional` when unset).
 * @throws when the value is a non-empty unknown level of detail.
 */
function toDomainLod(value: string | undefined): DomainLod {
  if (value === undefined) return 'regional'
  const match = DOMAIN_LODS.find(lod => lod === value)
  if (match === undefined) throw new Error(`unknown lod '${value}'; known: ${DOMAIN_LODS.join(', ')}`)
  return match
}

/**
 * Read a four-number bounding box from a model-supplied array.
 * @param raw - the `bbox` argument.
 * @returns the bbox as [west, south, east, north].
 * @throws when the value is not four finite numbers.
 */
function toBBox(raw: readonly number[]): [number, number, number, number] {
  const [west, south, east, north] = raw
  if (raw.length !== 4
    || west === undefined || south === undefined || east === undefined || north === undefined
    || ![west, south, east, north].every(n => Number.isFinite(n))) {
    throw new Error('bbox must be four finite numbers: [west, south, east, north]')
  }
  return [west, south, east, north]
}

/**
 * Register `geo_geocode` and `geo_list_basemaps` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and geo seam.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'geo_geocode',
    description:
      'Resolve a place name (city, country, landmark, address) to geographic coordinates. '
      + 'Returns ranked matches with latitude/longitude and, when available, a bounding box (bbox) '
      + 'describing the place extent. Pass a match\'s bbox to control_camera so the camera frames the '
      + 'place at the right zoom (a country wide, a city mid, a street close). Use before flying the camera.',
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
          : value.places.map((p) => {
            const kind = p.kind === undefined ? '' : ` [${p.kind}]`
            const bbox = p.bbox === undefined ? '' : ` bbox=[${p.bbox.map(n => n.toFixed(4)).join(', ')}]`
            return `${p.name}${kind} — ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${bbox}`
          }).join('\n'),
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

  ctx.tools.register(defineTool({
    name: 'geo_catalog_search',
    description:
      'Search the geo data catalog for datasets matching free text (imagery, terrain, point clouds, '
      + 'and other sources). Returns matched entries with an id and title. Requires a domain-data geo '
      + 'provider; with the built-in geocoding-only provider this reports that catalog search is unavailable.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text catalog query.' },
      limit: { type: 'integer', description: 'Maximum entries to return (default 10).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                kind: { type: 'string' },
                bbox: { type: 'array', items: { type: 'number' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? 'No matching catalog entry found.'
          : value.entries.map(e => `${e.id} — ${e.title}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10
      const entries = await ctx.geo.catalogSearch(args.query, limit, exec.signal)
      return {
        entries: entries.map(e => ({
          id: e.id,
          title: e.title,
          ...(e.kind === undefined ? {} : { kind: e.kind }),
          ...(e.bbox === undefined ? {} : { bbox: [...e.bbox] }),
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Catalog search "${args.query}"`, kind: 'fetch', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_domain_list',
    description:
      'List the domain feature layers the active geo provider can serve (for example airports, cities, '
      + 'roads, railroads, ports, lakes, time-zones) and whether each currently has data. Requires a '
      + 'domain-data geo provider.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          domains: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                geometryKind: { type: 'string', required: true },
                available: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.domains.map(d => `${d.id} (${d.geometryKind})${d.available ? '' : ' — no data'}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const domains = await ctx.geo.domainList(exec.signal)
      return { domains: domains.map(d => ({ id: d.id, title: d.title, geometryKind: d.geometryKind, available: d.available })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List domain layers', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_domain_query',
    description:
      'Fetch domain features of one layer inside a bounding box, at a level of detail. Use the current '
      + 'view bounds (west, south, east, north) reported for the 3D Earth, or bounds from geo_geocode. '
      + 'Returns the features (as GeoJSON geometry with properties) capped by the provider\'s per-detail '
      + 'limit. Requires a domain-data geo provider.',
    parameters: {
      domain: { type: 'string', required: true, description: 'Domain layer id (airports, cities, lakes, ports, railroads, roads, time-zones).' },
      bbox: { type: 'array', required: true, items: { type: 'number' }, description: 'Bounding box [west, south, east, north] in degrees.' },
      lod: { type: 'string', description: 'Level of detail: world, regional (default), or local.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          domain: { type: 'string', required: true },
          lod: { type: 'string', required: true },
          limited: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
          features: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                properties: { type: 'object', required: true, additionalProperties: true },
                geometry: { type: 'object', required: true, additionalProperties: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.count} ${value.domain} feature(s) at ${value.lod} detail`
          + `${value.limited ? ' (capped)' : ''}.`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const domain = toDomainId(args.domain)
      const lod = toDomainLod(args.lod)
      const bbox = toBBox(args.bbox)
      const result = await ctx.geo.domainQuery(domain, { bbox, lod }, exec.signal)
      return {
        domain: result.domain,
        lod: result.lod,
        limited: result.limited,
        count: result.features.length,
        features: result.features.map(f => ({ id: f.id, properties: f.properties, geometry: f.geometry })),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Query ${args.domain} features`, kind: 'fetch' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_feature_get',
    description:
      'Fetch one domain feature by its id within a layer, returning its GeoJSON geometry and properties, '
      + 'or nothing when no such feature exists. Requires a domain-data geo provider.',
    parameters: {
      domain: { type: 'string', required: true, description: 'Domain layer id the feature belongs to.' },
      id: { type: 'string', required: true, description: 'Feature id within the domain.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          id: { type: 'string' },
          properties: { type: 'object', additionalProperties: true },
          geometry: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found ? `Feature ${value.id ?? ''}` : 'No such feature.',
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const domain = toDomainId(args.domain)
      const feature = await ctx.geo.featureGet(domain, args.id, exec.signal)
      if (feature === null) return { found: false }
      return { found: true, id: feature.id, properties: feature.properties, geometry: feature.geometry }
    },
    presentCall: args => ({ card: 'generic', title: `Get ${args.domain} feature ${args.id}`, kind: 'fetch' }),
  }))
}
