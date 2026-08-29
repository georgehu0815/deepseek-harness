# @deepseek-ai/dsh-tool-geo-query

English | [中文](README.zh.md)

Read-only geo tools the model uses to resolve places, discover base-map imagery, and read domain feature layers, over the `ctx.geo` seam. Part of the Terra geo port.

## What it does

Registers six tools:

- `geo_geocode` — resolve a free-text place name to coordinates (and a bounding box where available).
- `geo_list_basemaps` — list the selectable base-map imagery presets.
- `geo_catalog_search` — search the geo data catalog for datasets matching free text.
- `geo_domain_list` — list the domain feature layers the active provider can serve, and whether each has data.
- `geo_domain_query` — fetch a layer's features inside a bounding box at a level of detail.
- `geo_feature_get` — fetch one domain feature by id within a layer.

All are read-only and concurrency-safe; none appends a session event. The first two work on the built-in geocoding-only provider; the four domain tools need a domain-data provider (for example the Terra BFF provider) and otherwise report that the active provider does not support them.

## Rendering

All use the generic tool card. `geo_geocode`, `geo_catalog_search`, `geo_domain_query`, and `geo_feature_get` present as `fetch` calls; `geo_list_basemaps` and `geo_domain_list` as `other` calls.

## Export shape

Function plugin: named `name` / `inject` / `apply`, no default export. Injects `['tools', 'geo']`.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [tool-geo-query schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-query). `geo_geocode(query, limit?)` resolves a place name; `geo_list_basemaps()` takes no arguments. `geo_catalog_search(query, limit?)` searches the catalog. `geo_domain_list()` takes no arguments. `geo_domain_query(domain, bbox, lod?)` — `domain` is a layer id (airports, cities, lakes, ports, railroads, roads, time-zones), `bbox` is `[west, south, east, north]` in degrees, `lod` is `world`/`regional`/`local` (default `regional`). `geo_feature_get(domain, id)` fetches one feature. Unknown domain or malformed bbox values are rejected before the provider is called.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse.

### Tool-call history and result

#### What the model sees

`geo_geocode` returns a text list of matches (`<name> — <lat>, <lon>`). `geo_list_basemaps` returns one `<id> — <label>` line per preset. `geo_catalog_search` returns matched `<id> — <title>` entries. `geo_domain_list` returns one line per layer with its geometry kind and a `— no data` marker when empty. `geo_domain_query` returns a count line noting the level of detail and whether the result was capped, plus the features as GeoJSON geometry with properties. `geo_feature_get` returns the feature or `No such feature.`. Domain results depend on the active provider, so their content is dynamic.

#### Token effect

Bounded by `limit` for geocoding and catalog search, by the fixed preset count for base maps, and by the provider's per-detail feature cap for domain queries.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Domain data needs a domain-data provider** — the four domain tools return an unsupported-provider error on the default geocoding-only provider; wire a Terra-backed provider (`@deepseek-ai/dsh-host-geo-bff`) to serve them. See the [design note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Geocoding quality is the provider's** — the default public provider's precision and coverage are Nominatim's; a Terra-backed provider is swappable at the seam.
