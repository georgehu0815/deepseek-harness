# @deepseek-ai/dsh-tool-geo-control

English | [中文](README.zh.md)

Action tools that let the model drive the live 3D Earth view — move the camera, switch base-map imagery, toggle domain data layers, and draw or edit annotation features — by appending `geo/command` session events the client bridge applies. Part of the Terra geo port (Phase 3).

## What it does

Registers ten tools:

- `control_camera` — fly the camera to a geographic target.
- `set_basemap` — switch the base-map imagery preset.
- `toggle_domain` — show or hide one domain data layer (`airports`, `cities`, `lakes`, `ports`, `railroads`, `roads`, `time-zones`).
- `draw_point` / `draw_polyline` / `draw_polygon` — draw an annotation feature and return its minted id.
- `move_feature` — shift a drawn feature by a `[lon, lat]` degree delta.
- `set_feature_properties` — rename a drawn feature.
- `delete_features` — remove drawn features by id.
- `undo_draw` — remove the most recently drawn feature.

Each appends a `geo/command` event to the calling agent's session; the `geoCommand` projection (from `@deepseek-ai/dsh-geo-command`) folds it into the latest command plus the accumulated enabled layers and drawn features, and the browser bridge drives the globe. A non-agent caller is rejected.

## Feature ids are replay-stable

A draw tool mints the id `feat-<seq>` from the session's next event sequence number — the seq the `draw-feature` event itself occupies. Because the log folds in sequence order, replaying the same log reconstructs the same ids, so `move_feature`, `set_feature_properties`, and `delete_features` stay valid across replay without the client assigning ids.

## Enforcement

Every tool's `execute` throws `<tool> requires an owning agent session` when there is no owning agent, so a direct or alternate caller cannot append a command without a session. `toggle_domain` rejects an unknown domain before appending; the draw tools reject out-of-range coordinates, too-few points, and malformed `[lon, lat]` pairs.

## Rendering

Generic tool card. `control_camera` presents as `Move camera to <lat>, <lon>`; `set_basemap` as `Set base map <id>`; `toggle_domain` as `Show domain <id>` / `Hide domain <id>`; the draw tools as `Draw point <lon>, <lat>` / `Draw polyline` / `Draw polygon`; `move_feature` as `Move feature <id>`; `set_feature_properties` as `Rename feature <id>`; `delete_features` as `Delete <n> feature(s)`; `undo_draw` as `Undo last drawing`.

## Export shape

Function plugin: named `name` / `inject` / `apply`, no default export. Injects `['tools']`.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [geo control tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-control). `control_camera(lat, lon, height?)` — latitude −90..90, longitude −180..180, both clamped; `height` is camera altitude in meters (default 2,000,000). `set_basemap(id)` — a base-map preset id from `geo_list_basemaps`. `toggle_domain(domain, on)` — a known domain id and a boolean. `draw_point(lon, lat)`, `draw_polyline(coordinates)` (≥2 `[lon, lat]` points), `draw_polygon(coordinates)` (a ring of ≥3 points), `move_feature(id, dLon, dLat)`, `set_feature_properties(id, name)`, `delete_features(ids)`, `undo_draw()`.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse.

### Tool-call history and result

#### What the model sees

`control_camera` returns `Camera moved to <lat>, <lon> at <height> m.`; `set_basemap` returns `Base map set to <id>.`; `toggle_domain` returns `Domain <id> shown.` / `Domain <id> hidden.`; a draw tool returns `Drew <point|polyline|polygon> <id>.`; `move_feature` returns `Moved feature <id>.`; `set_feature_properties` returns `Updated feature <id>.`; `delete_features` returns `Deleted <n> feature(s).`; `undo_draw` returns `Removed the most recent drawn feature.` Stable failures are the owning-session errors, the unknown-domain and non-empty-id errors, and the coordinate and point-count validation errors. The `geo/command` session event is UI and replay state, not a second model message.

#### Token effect

Small, fixed-shape results; the appended command is not re-sent to the model.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Rendering the new layers is deferred** — the seam and projection carry enabled domains and drawn features, but the Cesium controller drawing them on the globe (and the layer-control surface) land in a later client phase; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Last-wins camera and base map** — the `geoCommand` projection replays the latest camera/base-map command through the client bridge, so rapid successive moves converge on the final one rather than animating each step. Domain toggles and drawn features accumulate instead.
- **Rename only, no free-form attributes** — `set_feature_properties` sets the display name; arbitrary attribute maps are not part of the model-facing schema.
- **The browser must be showing the globe** — commands apply to the shared client controller; with no viewer mounted, the accumulated state is remembered and applied on mount, while a camera fly-to is dropped.
