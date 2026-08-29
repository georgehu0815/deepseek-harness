# @deepseek-ai/dsh-tool-geo-query

English | [中文](README.zh.md)

Read-only geo tools the model uses to resolve places and discover base-map imagery, over the `ctx.geo` seam. Part of the Terra geo port (Phase 1).

## What it does

Registers two tools:

- `geo_geocode` — resolve a free-text place name to coordinates (and a bounding box where available).
- `geo_list_basemaps` — list the selectable base-map imagery presets.

Both are read-only and concurrency-safe; neither appends a session event.

## Rendering

Both use the generic tool card. `geo_geocode` presents as a `fetch` call titled `Geocode "<query>"`; `geo_list_basemaps` as an `other` call titled `List base maps`.

## Export shape

Function plugin: named `name` / `inject` / `apply`, no default export. Injects `['tools', 'geo']`.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`geo_geocode` and `geo_list_basemaps` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-query). `geo_geocode(query, limit?)` — `query` is the free-text place name; `limit` is the maximum matches (1–20, default 5). `geo_list_basemaps()` takes no arguments.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse.

### Tool-call history and result

#### What the model sees

`geo_geocode` returns a text list of matches (`<name> — <lat>, <lon>`), or `No matches for "<query>".` when empty. `geo_list_basemaps` returns one `<id> — <label>` line per preset. Results are small and fixed-shape; geocoding depends on the external provider, so match text is dynamic.

#### Token effect

Bounded by `limit` for geocoding (default 5 matches) and by the fixed preset count for base maps.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No domain or catalog queries** — airports/buildings/lidar layers, catalog search, and feature lookups are deferred to a later phase; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Geocoding quality is the provider's** — the default public provider's precision and coverage are Nominatim's; a Terra-backed provider is swappable at the seam.
