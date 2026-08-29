# @deepseek-ai/dsh-client-ui-geo-earth

English | [中文](README.zh.md)

Interactive 3D Earth plugin: an "Earth 3D" action in the sidebar foot opens a CesiumJS globe in the shell's first-class `earth` grid column — the fourth `ui-layout` track (`sidebar | center | details | earth`). The button toggles the column through `ctx.layout.toggleEarth()` and the column header closes it through `ctx.layout.closeEarth()`, so the globe is a real, resizable layout column rather than a floating overlay. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The plugin registers into three slots and owns no shared store. `sidebar.footer.action` gets an "Earth 3D" button (beside "Human Body 3D") whose injected `toggleEarth` callback drives the layout; the `earth` grid-column seat renders the globe plus a header with an in-column visibility toggle and a close button (its injected `closeEarth` callback). A session-scoped contribution in `conversation.session.header.utilities` is the invisible `GeoCommandBridge`. The globe uses a switchable raster base layer (OpenStreetMap by default), ellipsoid terrain, and every Cesium widget disabled — the same configuration as Terra's `CesiumEarth`. A page-local visibility observable hides the globe while keeping the Cesium engine mounted so toggling back is instant.

The CesiumJS engine loads Workers, Assets, Widgets, and ThirdParty files at runtime from `/cesium`. Those static files are the Cesium `Build/Cesium/` tree, copied into `apps/web/public/cesium` and served by the web shell exactly as [ui-anatomy-3d](../ui-anatomy-3d/README.md) serves its `/models` glTF assets. `window.CESIUM_BASE_URL` is set to `/cesium` before the engine reads it. Without those files the panel shows an inline "Engine assets may be missing from /cesium" message rather than throwing.

The `/client` exports are the plugin body (`apply`/`inject`) only; the launcher, the sidebar button and earth-column components, and the globe panel remain package-internal behind the slot registration.

## Model Experience

### Browser globe (no direct model surface)

#### What the model sees

Nothing. This package renders a browser-only 3D globe and an invisible bridge that reads the `geoCommand` session projection to drive it; nothing here enters a model request, tool schema, or session log. The agent controls the globe through the separate `@deepseek-ai/dsh-tool-geo-control` and `@deepseek-ai/dsh-tool-geo-query` tools, whose schemas and results are documented there.

#### Token effect

None; this package neither assembles nor sends a provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Camera and base map only** — the bridge applies `control_camera`/`set_basemap` commands; `toggle_domain`/`draw_*` controls are deferred to a later phase.
- **No layers beyond the base maps** — 3D city (3D Tiles), point cloud (COPC/LAZ), COG imagery, geodata boundaries, and FreeGeoDB domains are deferred; this phase mounts the base globe with switchable imagery presets.
- **One globe per page** — the earth column is a single root-scoped seat with one occupant; there is no multi-viewer support.
- **Engine assets are shell-served, not bundled** — the Cesium `Build/Cesium/` tree is copied into `apps/web/public/cesium`; a self-contained plugin-owned asset route is deferred.
