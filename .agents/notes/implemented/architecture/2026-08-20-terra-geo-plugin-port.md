# Agent Note: Port Terra's geo experience into DeepSeek Harness as plugins

Status: implemented

English | [中文](2026-08-20-terra-geo-plugin-port.zh.md)

## Problem

Terra is a separate Cesium/Three.js product: a 3D Earth view, an agent that drives the globe, and a Fastify BFF (`:4176`) serving catalog/domain/geocode data from SQLite. Bringing its experience into DeepSeek Harness means the harness agent should show an interactive globe in the web GUI and steer it — fly the camera, switch imagery — using any harness model, without standing up Terra's server or coupling the harness to Terra's process. The harness composes everything as plugins over capability seams and reconstructs every model-visible input from the session log; a naive port that reached a live external HTTP service from the browser, or pushed camera commands over an ad-hoc socket, would violate both.

## Decision

The port is a set of harness plugins across two planes, self-contained (no Terra backend required) and replay-correct.

**Geo capability seam (`ctx.geo`), host plane.** `@deepseek-ai/dsh-geo` is the Service Definition plus a built-in provider: `geocode(query, limit, signal)` and static base-map presets (`osm`, `carto-dark`, `carto-light`, `esri-satellite`). The default provider (`public-nominatim`) calls public OpenStreetMap Nominatim with a timeout deadline, a response-byte cap, and manual redirects; `registerProvider` lets a later Terra-backed provider replace it without touching the tools or client. Provider config (`nominatimBaseUrl`, `userAgent`, `geocodeTimeoutMs`) is `Config`, not constants.

**Read tools.** `@deepseek-ai/dsh-tool-geo-query` exposes `geo_geocode` (place name → coordinates + bbox) and `geo_list_basemaps` over `ctx.geo`. Both are read-only, concurrency-safe, and own no I/O.

**Agent → Earth command loop via a session projection.** The supported per-session server→client push is a session event plus a projection, not a bespoke socket. `@deepseek-ai/dsh-geo-command` declares the `geo/command` session event (camera or base-map) and the `geoCommand` projection — a last-wins fold carrying the latest command and a per-session `seq`. `@deepseek-ai/dsh-tool-geo-control` exposes `control_camera` and `set_basemap`, which append `geo/command` to the calling agent's session (a non-agent caller is rejected). The gateway auto-mints a `session/projection` frame; the client reads it through the standard `useProjection` hook. The projection is the desired-view state, so replay converges on the last commanded view without re-firing intermediate camera moves.

**The globe and its bridge, browser plane.** `@deepseek-ai/dsh-client-ui-geo-earth` mounts a CesiumJS viewer in the shell's first-class `earth` grid column — a fourth `ui-layout` track (`sidebar | center | details | earth`), opened from a sidebar action through `ctx.layout.toggleEarth()` and closed from the column header through `ctx.layout.closeEarth()`. The earth column is a `single`, `root`-scoped slot the `AppFrame` declares alongside its other children; its width is solved by the concession chain (`columns.ts`), which concedes the earth track ahead of details as the viewport narrows and auto-closes it before details. Engine assets are served from `/cesium`; the widget stylesheet is injected at runtime via a served `<link>` because the client bundle's CSS pipeline resolves only relative stylesheets. An in-column visibility toggle hides the globe while keeping the Cesium engine mounted, and an invisible session-scoped `GeoCommandBridge` (registered into `conversation.session.header.utilities`) reads `useProjection('geoCommand')` and drives a shared `earthController`, applying a command only when `seq` advances. The controller remembers the desired base map when no viewer is mounted and applies it on attach.

The geo host rows load on the host plane in `packages/bundle/base/cordis.patch.yml` and are not disabled in the web-app patch, so they register into the global tool layer and reach every web session's agent by default.

## Alternatives considered

**Proxy to Terra's live Fastify BFF for Phase 1.** Faithful to Terra's catalog/domains/assets, but requires running Terra's server and its imported SQLite data — a heavy external dependency for a demo. The seam keeps a Terra-backed provider as a drop-in replacement, so this remains available later without reworking the tools or client.

**Push camera commands over a dedicated WebSocket upgrade route.** Truly ephemeral, but it needs a bespoke client sink, reuse of the trusted-request check, and it is not replay-correct — a reconnecting or replaying client would miss the last commanded view. The projection is both the lowest-blast-radius channel and the correct replay semantics.

**A frame-wide `shell.overlay` panel instead of a grid column.** An earlier step mounted the globe in a right-docked `shell.overlay` layer, avoiding any `ui-layout` change. It is a floating layer over the conversation, not the requested permanent right column, and it cannot be resized against the other columns. The shipped `earth` grid track makes the globe a first-class, resizable column that concedes ahead of details, at the cost of editing the shared frame and its concession solver — the correct realization of the original "sidebar + conversation + right 3D view" request. Remaining geo domain layers are specified in [Agent Note: Geo domain layers for the Terra port](../../proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).

## Consequences

The harness agent geocodes a place, flies the camera, and switches base-map imagery with any model, and the globe is reconstructable from the session log. Six host rows (the seam, the projection, four tools) require a `dsh web` restart to load because the boot roster is fixed at boot; the client bundle is served fresh from disk, so client edits need only a rebuild and refresh.

Cesium bundles into `lib/client.js` at ~10.9 MB; acceptable for the demo but a candidate for plugin-owned external loading if the globe ships broadly. The client package follows `@deepseek-ai/dsh-client-ui-anatomy-3d` for the imperative WebGL-canvas pattern — a module-level controller observed through `useSyncExternalStore` — which sits outside the strict client store/hook discipline; a broadly shipped globe should revisit whether that state belongs in a declared store. `ui-anatomy-3d` remains the non-compliant precedent for `verify-package-invariants`; the four geo packages each own a compliant `./invariant` with a package-specific empty-installer reason.

The `earth` grid cell (`.earthCol`) is `position: relative` so the globe occupant, which fills its host with `position: absolute; inset: 0`, is contained within the column rather than escaping to the `position: relative` frame and floating over the conversation. Any `earth`-slot occupant that positions absolutely relies on that cell being its containing block.

## Testing

`@deepseek-ai/dsh-tool-geo-control` carries a real Loader composition test: a booted `cordis.yml` mounts the seam, the projection, and both tool packages, then asserts the four tools are offered and that executing them returns the model-visible results and appends the correct `geo/command` events (geocode uses a stub provider registered on `ctx.geo`, so the test needs no network). `@deepseek-ai/dsh-geo-command` carries a projection-provider test that reads the history tail page through the real apiproxy — the same wire the client bridge consumes — asserting the zero-seq null command before the first event, last-wins `seq` advance, key absence without the plugin, and key removal on fiber unload.
