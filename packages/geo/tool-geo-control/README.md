# @deepseek-ai/dsh-tool-geo-control

English | [中文](README.zh.md)

Action tools that let the model drive the live 3D Earth view — move the camera and switch base-map imagery — by appending `geo/command` session events the client bridge applies. Part of the Terra geo port (Phase 2).

## What it does

Registers two tools:

- `control_camera` — fly the camera to a geographic target.
- `set_basemap` — switch the base-map imagery preset.

Each appends a `geo/command` event to the calling agent's session; the `geoCommand` projection (from `@deepseek-ai/dsh-geo-command`) folds it, and the browser bridge drives the globe. A non-agent caller is rejected.

## Enforcement

`execute` throws `control_camera requires an owning agent session` / `set_basemap requires an owning agent session` when there is no owning agent, so a direct or alternate caller cannot append a command without a session.

## Rendering

Generic tool card. `control_camera` presents as `Move camera to <lat>, <lon>`; `set_basemap` as `Set base map <id>`.

## Export shape

Function plugin: named `name` / `inject` / `apply`, no default export. Injects `['tools']`.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`control_camera` and `set_basemap` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-control). `control_camera(lat, lon, height?)` — latitude −90..90, longitude −180..180, both clamped; `height` is camera altitude in meters (default 2,000,000). `set_basemap(id)` — a base-map preset id from `geo_list_basemaps`.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse.

### Tool-call history and result

#### What the model sees

`control_camera` returns `Camera moved to <lat>, <lon> at <height> m.`; `set_basemap` returns `Base map set to <id>.` Stable failures are the two owning-session errors above and `set_basemap requires a non-empty base-map id`. The `geo/command` session event is UI and replay state, not a second model message.

#### Token effect

Small, fixed-shape results; the appended command is not re-sent to the model.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Camera and base map only** — `toggle_domain`, `draw_*`, and feature-move controls are deferred to a later phase; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Last-wins semantics** — the `geoCommand` projection carries only the latest desired view, so rapid successive commands converge on the final one rather than animating each step.
- **The browser must be showing the globe** — commands apply to the shared client controller; with no viewer mounted, the base map is remembered and applied on mount, while a camera fly-to is dropped.
