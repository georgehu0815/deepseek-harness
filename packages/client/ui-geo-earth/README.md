# @deepseek-ai/dsh-client-ui-geo-earth

English | [中文](README.zh.md)

Interactive 3D Earth plugin: the sidebar action opens the `earth` entry of the shell's shared `visual.workspace.view` slot. The fourth layout track is `sidebar | center | details | visual`; independent plugins contribute neighboring tabs. The button calls `ctx.layout.toggleVisual('earth')`, and the globe header closes the column through `ctx.layout.closeVisual()`. The globe remains a resizable column rather than an embedded application. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The `sidebar.footer.action` contribution opens the Earth tab; the `visual.workspace.view` entry renders the existing globe header with maximize, fullscreen and close controls. Session-scoped `GeoCommandBridge` and `GeoViewReporter` contributions remain in `conversation.session.header.utilities`, and the Summary view and `earthOverlays` service retain their existing integration. The globe uses a switchable raster base layer (OpenStreetMap by default), ellipsoid terrain and disabled Cesium widgets. Maximizing preserves the engine; closing the column or selecting another visual tab unmounts it.

The CesiumJS engine loads Workers, Assets, Widgets, and ThirdParty files at runtime from `/cesium`. Those static files are the Cesium `Build/Cesium/` tree, copied into `apps/web/public/cesium` and served by the web shell exactly as [ui-anatomy-3d](../ui-anatomy-3d/README.md) serves its `/models` glTF assets. `window.CESIUM_BASE_URL` is set to `/cesium` before the engine reads it. Without those files the panel shows an inline "Engine assets may be missing from /cesium" message rather than throwing.

The `/client` exports are the plugin body (`apply`/`inject`) only; the launcher, the sidebar button and earth-column components, and the globe panel remain package-internal behind the slot registration.

## Model Experience

### Browser globe (no direct model surface)

#### What the model sees

Nothing. This package renders a browser-only 3D globe and an invisible bridge that reads the `geoCommand` session projection to drive it — flying the camera, switching the base map, and reconciling the accumulated drawn features (points, polylines, and polygons, each with an optional text label) into a dedicated "Drawings" layer. Nothing here enters a model request, tool schema, or session log. The agent controls the globe through the separate `@deepseek-ai/dsh-tool-geo-control` and `@deepseek-ai/dsh-tool-geo-query` tools, whose schemas and results are documented there.

#### Token effect

None; this package neither assembles nor sends a provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Camera, base map, and drawn features only** — the bridge applies `control_camera`/`set_basemap` commands and reconciles the accumulated drawn features (points/lines/polygons with optional labels); `toggle_domain` and the other domain-layer controls are deferred to a later phase.
- **Full-reconcile drawings, not incremental diffing** — each feature-set change clears the "Drawings" data source and rebuilds every entity from the projection's `features` list. This is the simplest correct approach for annotation-scale counts; an entity-level diff is deferred until a feature volume makes it worthwhile.
- **No layers beyond the base maps** — 3D city (3D Tiles), point cloud (COPC/LAZ), COG imagery, geodata boundaries, and FreeGeoDB domains are deferred; this phase mounts the base globe with switchable imagery presets.
- **One globe per page** — Earth is one entry in the shared visual workspace; only the selected visual tab renders. There is no multi-globe support.
- **Engine assets are shell-served, not bundled** — the Cesium `Build/Cesium/` tree is copied into `apps/web/public/cesium`; a self-contained plugin-owned asset route is deferred.
