# @deepseek-ai/dsh-geo-command

English | [中文](README.zh.md)

The agent→Earth command channel: the `geo/command` session event and the `geoCommand` session projection that carries the latest desired globe view — plus the accumulated domain layers and drawn features — to the browser. Part of the Terra geo port (Phase 3).

## What it does

Declares the `geo/command` session event (a camera, base-map, domain-toggle, or feature draw/move/rename/delete/undo command) and registers the `geoCommand` projection. The fold is last-wins for `command` and accumulating for `enabledDomains` and `features`. `@deepseek-ai/dsh-tool-geo-control` appends the events; the client bridge in `@deepseek-ai/dsh-client-ui-geo-earth` reads the projection through `useProjection('geoCommand')` and drives the globe, applying the latest command when the sequence advances and rebuilding domain visibility and the "Drawings" layer from the accumulated state.

## Session projection

`geoCommand` initial value is `{ seq: 0, command: null, enabledDomains: [], features: [] }`. Each `geo/command` event increments `seq` and replaces `command`; any other event returns the same state reference (no spurious frames). A `domain-toggle` adds or removes a layer id from `enabledDomains` (first-enabled order); `draw-feature` appends a feature; `move-feature` shifts its geometry by a `[lon, lat]` delta; `set-feature-props` renames it; `delete-features` removes by id; `undo-draw` drops the most recent. Because the state carries the full desired view, replay converges on the last commanded camera and base map and reconstructs the exact enabled layers and drawn features.

## Export shape

Default-exports the projection-registering plugin. `./types` is the single home for `GeoCameraCommand`, `GeoBaseMapCommand`, the domain and draw command types, `GeoCommand`, `GeoDrawnFeature`, and `GeoCommandState`, and declares the `SessionEventMap` and `SessionProjectionMap` members. `./client` re-exports those types for the browser side.

## Model Experience

### Command channel (no direct model surface)

#### What the model sees

Nothing directly. The `geo/command` event and `geoCommand` projection are UI and replay state, never a model message. The model acts through `@deepseek-ai/dsh-tool-geo-control`, whose results are documented there.

#### Token effect

None from this package.

#### KV Cache effect

None from this package; the command events are not part of the model request.

## Known Limitations and Deferred Work

- **Rendering is deferred** — the projection carries enabled domains and drawn features, but the Cesium controller that draws them on the globe lands in a later client phase; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Last-wins camera and base map** — the `command` slot keeps only the latest command; a client that reconnects or replays converges on the final camera and base map and does not observe intermediate ones. Domain toggles and drawn features accumulate instead.
