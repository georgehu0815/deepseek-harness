# @deepseek-ai/dsh-geo-segment

Geo segmentation capability seam (`ctx.segment`): segments the current 3D Earth view into building/home polygons by calling an external SAM3 HTTP backend, then draws one polygon per detection by appending `geo/command` draw-feature events.

## Roles

- **Service Definition** (`src/types.ts`, `src/index.ts`): `SegmentRuntime` registered as `ctx.segment`, with the `SegmentRequest`/`SegmentSpec` split, GeoJSON result types, and the `SegmentProvider` interface. `resolve(request)` applies the seam defaults (prompt `building`, geometry `mask`, confidence threshold `0.5`); `segment(request)` resolves then delegates to the active provider and throws when none is registered.
- **Service Provider** (`src/provider-samgeo.ts`): `SamGeoProvider` (`id: 'samgeo-http'`) fetches a georeferenced view raster, POSTs it as multipart form data to `${baseUrl}/segment/geo`, and validates the GeoJSON reply at the HTTP boundary. Its `fetchImpl` constructor argument is injectable for offline tests. `baseUrl` is a required `Config` field; `timeoutMs` defaults to 60000. When a request omits an explicit `imageUrl`, the provider synthesizes one from the view's bounds using `imageryUrlTemplate` (default: Esri World Imagery `export`, the same imagery the 3D Earth panel renders) at `imageryWidth`×`imageryHeight` pixels (default 1024×1024); an empty template disables synthesis and requires an explicit `imageUrl`.
- **Consumer** (`src/tool.ts`): the `segment_view` tool reads the current view bbox from the latest `geo/view` or `geo/command` camera event, calls `ctx.segment.segment`, and appends one `geo/command` draw-feature polygon (`feat-${seq}-${i}`) per detection.

## Model Experience

- **Model-visible tools:** `segment_view` (params `prompt`, `geometry`, `maxFeatures`). Its result renders as `Segmented N features for '<prompt>' in the current view.`
- **Token/KV-cache:** each detection appends one `geo/command` event; drawing many features grows the session log linearly. No new model-visible input events beyond the drawn `geo/command` polygons the Earth view already consumes.

## Known Limitations and Deferred Work

- Imagery synthesis assumes the `imageryUrlTemplate` returns an equirectangular raster matching the requested bbox; the Esri `export` default is near-nadir imagery, and the backend's linear pixel-to-lonlat transform skews for oblique cameras or Web-Mercator tiles.
- No built-in provider: a composition must mount `SamGeoProvider` (or another `SegmentProvider`) via `registerProvider`.
