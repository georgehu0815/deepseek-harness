# @deepseek-ai/dsh-geo-view

The browser→host view-report channel: the `geo/view` session event and the `geoView` session projection that carry the live 3D Earth camera — the real on-screen camera target and, when available, the geographic rectangle currently visible — into the session log, so the agent can reason about what the person is actually looking at. Part of the Terra geo port.

## What it does

Declares the `geo/view` session event (`source` of `user` or `agent`, a camera `pose` of latitude/longitude/height with optional heading/pitch, and an optional `bbox` of the on-screen west/south/east/north) and registers the `geoView` last-wins projection. The host-side `CameraViewService` (a Typert `@Remote` service bound to the `geoView` namespace) exposes `report(agent, view)`: the browser reporter in `@deepseek-ai/dsh-client-ui-geo-earth` reads the live Cesium camera on each settle and calls `ctx.remote.geoView.report(sessionId, view)`, which validates the untrusted browser input and appends one `geo/view` event. `@deepseek-ai/dsh-tool-geo-control`'s `get_current_view` tool and `@deepseek-ai/dsh-geo-viewcontext` read the newest reported view, preferring it over a camera the agent itself flew.

## Session projection

`geoView` initial value is `{ seq: 0, view: null }`. Each `geo/view` event increments `seq` and replaces `view`; any other event returns the same state reference (no spurious frames). Because the report is last-wins, replay converges on the last on-screen view.

## Wire validation

`report` is a process/wire boundary: the reported view is untrusted browser input. `source` must be `user` or `agent`, every pose number must be finite, and an optional `bbox` must have `east > west` and `north > south`. An invalid view is rejected loudly and nothing is appended. The event carries `ignorable: true`, so a build that does not know the `geo/view` type still reads the log.

## Export shape

Default-exports the `CameraViewService` (a projection-registering Typert remote service). `./types` is the single home for `GeoView`, `GeoViewPose`, `GeoViewBBox`, and `GeoViewState`, and declares the `SessionEventMap` and `SessionProjectionMap` members. `./client` re-exports those types for the browser side; `./typert` and `./remote` are the generated host binding and client remote.

## Model Experience

### `get_current_view` (documented in `@deepseek-ai/dsh-tool-geo-control`)

#### What the model sees

Nothing directly from this package. The `geo/view` event and `geoView` projection are report and replay state, never a model message. The model reads the current view through `get_current_view` and through the ambient injection in `@deepseek-ai/dsh-geo-viewcontext`, whose text is documented there.

#### Token effect

None from this package; the report events are not part of the model request.

#### KV Cache effect

None from this package.

## Known Limitations and Deferred Work

- **Last-wins view** — the projection keeps only the latest reported view; a client that reconnects or replays converges on the final on-screen view and does not observe intermediate ones.
- **No bbox for oblique or space views** — Cesium `computeViewRectangle()` returns nothing for a tilted or whole-globe camera, so the report omits `bbox` and consumers fall back to a pose-derived approximation.
- **Debounce on the browser** — the reporter debounces camera settles (~300 ms); very rapid panning collapses to the final view rather than logging every intermediate frame.
