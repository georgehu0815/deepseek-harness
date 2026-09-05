# @deepseek-ai/dsh-geo

English | [中文](README.zh.md)

The geo capability seam: a Service Definition (`ctx.geo`) plus a built-in provider that resolves place names to coordinates and lists base-map imagery presets. It is the host-plane foundation for the Terra geo port — the query and control tools and the 3D Earth client read through this one service.

## What it does

`ctx.geo` exposes `geocode(query, limit, signal)` and `listBaseMaps()`, and `registerProvider(provider)` to swap the active geocoder. The default provider (`public-nominatim`) calls public OpenStreetMap Nominatim over HTTPS with a timeout deadline, a response-byte cap, and manual redirect handling. Base-map presets (`osm`, `carto-dark`, `carto-light`, `esri-satellite`) are static and served without a network call.

## Single owner

One active geocode provider at a time; `registerProvider` returns a disposer and restores the previous provider on disposal. A Terra-backed provider can replace the built-in one without any change to the tools or the client.

## Configuration

Validated `Config`, all changeable from cordis.yml:

- `nominatimBaseUrl` (default `https://nominatim.openstreetmap.org`) — the geocode service origin.
- `userAgent` (default `deepseek-harness-geo/0.1 (+https://github.com/deepseek-ai/deepseek-harness)`) — sent on every geocode request, as Nominatim's usage policy requires.
- `geocodeTimeoutMs` (default `10000`) — per-request deadline in milliseconds.

## Export shape

Default-exports the `GeoRuntime` service class; merges `ctx.geo` into the cordis `Context`. `./client` re-exports the seam types for the browser side.

## Model Experience

### Capability seam (no direct model surface)

#### What the model sees

Nothing directly. This package registers no tool and adds no prompt text; it is a capability other plugins consume. The model reaches it only through `@deepseek-ai/dsh-tool-geo-query` (geocoding, base-map listing), whose schemas and results are documented there.

#### Token effect

None from this package alone.

#### KV Cache effect

None from this package alone; the consuming tools own their prefix effects.

## Known Limitations and Deferred Work

- **Geocoding and base-map presets only** — catalog search, domain layers, and feature data (Terra's richer BFF surface) are deferred; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **The default provider depends on a public service** — Nominatim rate limits and requires the descriptive `userAgent`; a self-hosted or Terra-backed provider is the intended production path through `registerProvider`.
- **Base-map presets are static** — the four presets are fixed in code; per-deployment imagery sources are not yet configurable.
