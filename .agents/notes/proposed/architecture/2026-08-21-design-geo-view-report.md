# Agent Note: Browser-reported current view → model-visible `geo/view` event

Status: proposed

Area: geo, client, session. Extends (does not supersede) [Geo domain layers for the Terra port](2026-08-20-design-terra-geo-plugin-dsh.md): that note owns the agent→Earth `geo/command` channel and domain layers; this note adds the reverse browser→host view report and the segmentation seam that consumes it.

## Problem

The agent can *drive* the 3D Earth camera (`control_camera`, `draw_*`, `set_basemap`) but cannot *observe* it. The only "current view" the model sees is derived text from `@deepseek-ai/dsh-geo-viewcontext`, which reconstructs a bbox from the agent's own last `geo/command` of kind `camera` (`packages/geo/geo-viewcontext/src/index.ts` `latestCameraPose`
+ `viewport.ts` `deriveViewBBox`). Consequences:

- When a human pans/zooms/tilts the globe by hand, the agent never learns.
- The injected bbox is a heuristic from `{lat,lon,height}`, not the real on-screen rectangle.
- There is no way for the agent to reason about "what is currently in view" or to answer requests like "for the current view, do X per feature" with real bounds.

Goal: let the browser **report its real camera view** to the session, make that view **model-visible and replay-correct**, let the agent **pull** it and reason about it, and — using that real view — call a **SAM segmentation backend** (SamGeo) to turn the on-screen imagery into vector footprints (e.g. one polygon per home/building) that are drawn back onto the globe.

## Non-goals

- No dedicated WebSocket for camera state (rejected in the Terra port note: not replay-correct).
- No synchronous "read the browser now" tool call. The model reads *logged* view state, not a live DOM.
- No re-implementation of segmentation. Segmentation is delegated to the existing **SamGeo** service; DSH only orchestrates (fetch imagery for the view → POST → draw the returned GeoJSON).

## The SamGeo backend service

The repo at `/Volumes/ExternalSSD/geoagent/segment-geospatial` is **SamGeo** (`segment-geospatial` v1.4.2) — Meta's Segment Anything Model (SAM/SAM2/SAM3) for geospatial rasters. It ships a **FastAPI REST service** (`samgeo/api.py`, launched via `samgeo-api` or `uvicorn samgeo.api:app`, default port 8000) that takes a georeferenced image and returns **GeoJSON** in geographic coordinates. Relevant endpoints:

| Endpoint | Input (multipart form) | Output |
|---|---|---|
| `GET /health` | — | liveness |
| `GET /models` | — | available SAM models |
| `POST /segment/text` | `file` (TIFF/PNG/JPEG), `prompt` (e.g. `"building"`, `"house"`), `output_format=geojson\|detections`, `confidence_threshold`, `min_size`, `max_size` | SAM3 text-prompted masks → GeoJSON FeatureCollection (footprint polygons) or `detections` (bbox polygons + scores), in geographic coords |
| `POST /segment/automatic` | `file`, `output_format` | every object segmented → GeoJSON |
| `POST /segment/predict` | `file`, point/box prompts, `output_format` | prompted masks → GeoJSON |

`/segment/text` with `prompt="house"` (or `"building"`) is the direct answer to "draw a polygon for each home in the current view": it emits one polygon feature per detected home, already in lon/lat. CORS is `*`, so it is a self-contained HTTP service DSH treats as an external provider — reached from the **host** plane, never the browser.

Requires a georeferenced raster of the current view. SamGeo can itself download tiles (TMS → GeoTIFF); alternatively DSH fetches a static-map/tile image for the reported `bbox` and posts it.

### Chosen backend: MLX SAM3 `/segment/geo` (implemented)

The `segment-geospatial` FastAPI (`samgeo/api.py`) is pixel-agnostic but its SAM3 backends are `meta`/`transformers` (CPU/CUDA torch), which do not run natively on this Apple-Silicon host. The real, runnable SAM3 lives at `segment-geospatial/mlx_sam3` (native MLX; `app/backend/main.py` already serves `/upload`, `/segment/text`, etc. on :8000, but in **pixel space** — RLE masks + pixel xyxy boxes via an upload→session flow). To give DSH one clean georeferenced call, a new endpoint was added: **`POST /segment/geo`** (`mlx_sam3/app/backend/geo.py`), form fields `file`, `prompt`, `bbox=west,south,east,north`, `geometry=mask|box`, `confidence_threshold`. It runs the existing `set_image`→`set_text_prompt` pipeline, traces each mask's largest contour (or its pixel box) and maps raster pixels to WGS84 by the linear bbox transform (col across west..east, row across north..south), returning a GeoJSON `FeatureCollection` of lon/lat `Polygon`s with `score`/`prompt`. This is the exact endpoint DSH's `SamGeoProvider` POSTs to. Georeferencing is correct for an equirectangular-framed view; Web-Mercator tile reprojection is a documented follow-up. Tests (`app/backend/test_geo.py`, 4) mock the processor and pass offline; the DSH provider tests mock `fetch` — SAM3 is never loaded in CI.


## Governing constraints (from AGENTS.md)

- **Model-visible ⟺ logged**: the reported view must become a session event, not an ad-hoc RPC side effect.
- **Registrations are effects**; new behavior is a plugin on documented extension points, not an agent-loop change.
- **SessionEventMap members are required-on-read by default** unless `ignorable: true`.
- New model-visible input ⇒ new session event; additive event key does **not** bump `SESSION_FORMAT_VERSION`.

## Proposal

Mirror the proven `geo/command` path in reverse (browser → host):

```
Cesium viewer.camera (real state)
   │  camera.changed  (throttled read: positionCartographic + computeViewRectangle)
   ▼
earthController.getViewState()  ── new read method (packages/client/ui-geo-earth)
   │
   ▼
GeoViewReporter (new client bridge)  ── client→host HTTP uplink RPC (four-quadrant model)
   │
   ▼
host plugin  @deepseek-ai/dsh-geo-view  ── appends session event
   │
   ▼
session event  'geo/view' : GeoView { pose, bbox, seq, source }   ← durable, replay-correct
   │
   ├─▶ geoView projection (optional, mirrors geoCommand) — latest view for UI/read tools
   └─▶ geo-viewcontext reads newest 'geo/view' (falls back to derived 'geo/command')
   │
   ▼
get_current_view tool (read Consumer)  ── model PULLS logged view + attaches reasoning
   │
   ▼  the model, now knowing the real bbox, calls:
segment_view tool  ──▶  ctx.segment  (Segmentation Service Definition)
                          │
                          ▼  SamGeoProvider (HTTP): fetch tiles for bbox → GeoTIFF
                          ▼  POST /segment/text {prompt:"house", output_format:geojson}
                       SamGeo FastAPI service (external, :8000)
                          │  GeoJSON FeatureCollection (lon/lat footprints)
                          ▼
segment_view appends one 'geo/command' draw-polygon per feature (reuses existing draw seam)
                          │
                          ▼
GeoCommandBridge → earthController.renderFeatures → polygons on the globe
```

### New packages / changes

1. **`packages/geo/geo-view/` — `@deepseek-ai/dsh-geo-view`** (host)
   - `types.ts`: declaration-merge `SessionEventMap['geo/view'] = GeoView`.
     ```ts
     interface GeoView {
       /** @param source who reported it: 'user' (hand pan/zoom) or 'agent' (echo after a command). */
       source: 'user' | 'agent'
       pose: { lat: number; lon: number; height: number; heading?: number; pitch?: number }
       /** On-screen rectangle from computeViewRectangle; absent when the globe fills < full view. */
       bbox?: { west: number; south: number; east: number; north: number }
       /** Monotonic per-session, minted from session.seq — last-wins like geoCommand. */
       seq: number
     }
     ```
     JSDoc: `@mode` whole-value; `ignorable: true` on the envelope so builds without this package still read geo sessions (matches "required-on-read" rule).
   - Host RPC method (uplink target) that validates the wire payload (it crosses a process boundary → validate here) and calls `agent.session.append('geo/view', …)` with a server-minted `seq`. Throttle/dedup identical consecutive views.
   - Optional `geoView` projection folding to the latest view (copy `geo-command`'s projection).

2. **`packages/client/ui-geo-earth/` — extend** (browser)
   - `earthController.ts`: add `getViewState(): GeoView['pose'] & { bbox? }` reading `viewer.camera.positionCartographic`, `heading/pitch`, `viewer.camera.computeViewRectangle(ellipsoid)`.
   - New `GeoViewReporter.tsx` bridge (sibling of `GeoCommandBridge.tsx`): subscribe to `viewer.camera.changed` (Cesium), debounce (~300–500ms), send the uplink RPC. Register into `conversation.session.header.utilities` like the command bridge.
   - Guard against feedback loops: a view caused by the agent's own `flyTo` reports `source:'agent'` (or is suppressed) so it does not thrash the log.

3. **`packages/geo/geo-viewcontext/` — augment** (host)
   - `latestCameraPose` prefers newest `geo/view`; falls back to derived `geo/command`.
   - When a `geo/view.bbox` exists, inject it directly instead of `deriveViewBBox`.

4. **`packages/geo/tool-geo-query/` (or a small new tool package) — add `get_current_view`** (read Consumer)
   - Reads the latest logged view (projection or event scan) and returns `{ pose, bbox, source, seq }`. Pure read of logged state → satisfies model-visible ⟺ logged.
   - `render`: text summary of pose + bbox. `presentCall`: generic card.
   - This is the tool that answers "send current view + reasoning": the model calls it to obtain the real view, then reasons in its own turn.

5. **`packages/geo/segment/` — `@deepseek-ai/dsh-geo-segment`** (host) — the segmentation capability seam
   - **Service Definition** `ctx.segment` with `segment(request): Promise<FeatureCollection>` where `request = { bbox, prompt?, mode: 'text'|'automatic', confidenceThreshold?, minSize?, maxSize? }`. A `resolve(request): Spec` step defaults `mode`/thresholds explicitly (per the request/spec rule), never a hidden `?? default` in `run()`.
   - **Provider** `SamGeoProvider` (id `samgeo-http`): validates the reply at this process/wire boundary, (a) obtains a georeferenced raster for `bbox` (SamGeo TMS→GeoTIFF, or a configured tile/static-map source), (b) `POST`s multipart to `${baseUrl}/segment/text` (or `/automatic`), (c) returns the GeoJSON. `Config`: `baseUrl` (required — deployment-varying, validated field, no hardcoded `localhost:8000`), `defaultPrompt`, `defaultModelId`, `timeoutMs`, `tileSource`. Misconfig fails loud at load. Credentials (if the tile source needs a key) go through `dsh-credentials`, never inline.
   - **Consumer** `segment_view` tool (own package or in `tool-geo-control`): reads the latest logged view (`geoView` projection / `get_current_view`), calls `ctx.segment`, then appends one `geo/command` `draw-polygon` per returned feature — **reusing the existing draw seam and its replay-stable `feat-<seq>` ids**, so segmentation output is drawn and logged exactly like manual draws. Args: `{ prompt?, mode?, maxFeatures? }`. `render`: "Segmented N homes in view." `presentCall`: generic card.

### Wiring

- Add the two host packages to `packages/bundle/base/cordis.patch.yml` alongside the existing geo rows.
- Add `@deepseek-ai/dsh-geo-segment` + its provider row; ship the provider `disabled: true` by default (like `host-geo-bff`), enabled via overlay once a `baseUrl` for a running SamGeo service is configured.
- The client bridge ships through `packages/bundle/web-app` like `GeoCommandBridge`.
- `geo-view` declares `inject: ['agents']` (session append) and registers its RPC method on the gateway.
- **SamGeo service is out-of-process**: run it separately (`samgeo-api --port 8000`, or its Dockerfile). DSH depends on it over HTTP only; it is not vendored. Segmentation is unavailable (loud error, not a silent skip) when the provider is disabled or `baseUrl` is unreachable.

## Acceptance criteria

- **Unit**: projection fold (last-wins by seq); `get_current_view` over a synthetic log; wire validation rejects malformed payloads; `geo-viewcontext` prefers `geo/view` over derived; `segment` `resolve()` defaults; `SamGeoProvider` maps a canned SamGeo GeoJSON reply to draw commands (HTTP mocked); provider errors loudly when `baseUrl` is unset/unreachable.
- **Snapshot (required)**: a keyless runnable example — agent calls `get_current_view` after a seeded `geo/view` event, then `segment_view` against a **stubbed** `ctx.segment` returning a fixed 2-feature FeatureCollection; transcript shows the real bbox and two drawn polygons. Update TS + Python SDK expected outputs if the loop/SessionEventMap projection changes.
- **Client**: `earthController.getViewState` against a headless Cesium viewer (or mocked camera); reporter debounce + agent-echo suppression.
- **e2e**: opt-in real-service test hitting a live SamGeo `/segment/text` (self-skips without a configured `SAMGEO_BASE_URL`), asserting a georeferenced FeatureCollection returns.

## Alternatives considered

- **Dedicated camera WebSocket** — rejected: not replay-correct (same reason the Terra note rejected it for commands).
- **Push-only (no tool)**: inject view text every step like today but from real data. Simpler, but the model can't decide *when* it needs the view; keep injection for ambient context and add the tool for pull.
- **Reuse `geo/command` with a `viewReport` kind** — rejected: conflates agent intents (commands) with observations; different `@mode`/source semantics; separate key keeps the projection clean.
- **Vendor SamGeo into DSH / call it in-process** — rejected: it is a heavy PyTorch/SAM service with its own CUDA/model lifecycle. Treat it as an external HTTP provider behind `ctx.segment`, swappable for any other segmentation backend without touching the tool.
- **Segment in the browser** — rejected: imagery fetch + model inference belong on the host provider plane; the browser only reports the view and renders the returned polygons.

## Risks

- **Georeferencing accuracy** — the SAM3 `/segment/geo` backend maps mask pixels to lon/lat by a linear bbox transform that assumes equirectangular framing matching the reported bbox. A Web-Mercator tile mosaic or an oblique camera skews the polygons; mitigated by preferring a real `computeViewRectangle` bbox and documented as a limitation until tile reprojection lands.
- **Untrusted browser input** — `report` is a wire boundary; a malformed pose or inverted bbox must be rejected without appending. Covered by `CameraViewService` zod validation and its rejection tests.
- **Report volume** — an unthrottled `camera.changed` stream would flood the session log with `geo/view` events. Mitigated by the reporter's ~300 ms debounce and the last-wins projection; a server-side dedup is deferred.
- **SAM inference latency** — a large view can exceed a normal tool timeout. Deferred: cap bbox area or run `segment_view` as a long-running tool; the fixture provider keeps tests offline and fast.

## Open questions

1. Should agent-caused view changes be logged at all, or only user-initiated ones? (Proposed: log both, tag `source`, so the log fully reconstructs the camera.)
2. Debounce/throttle budget on the browser vs. server-side dedup — pick one authoritative throttle.
3. Does `computeViewRectangle` returning `undefined` (oblique/space view) need a fallback bbox from frustum corners, or is "no bbox" acceptable (agent falls back to pose-derived)?
4. Imagery source for the raster posted to SamGeo: let SamGeo pull TMS tiles itself, or have DSH fetch a static-map/tile mosaic for the bbox? Affects zoom/resolution control and any tile-provider key.
5. SamGeo inference latency (SAM3 on large views) can exceed a normal tool timeout — cap `bbox` area / tile zoom, or run `segment_view` as a long-running/streaming tool with progress?
6. `output_format`: `geojson` (mask footprints, precise home outlines) vs `detections` (bbox polygons + confidence). Homes want footprints; expose both via the `mode`/`output_format` arg?

## Implementation status (2026-08-21)

Host, backend, browser reporter, and app wiring implemented and tested offline.

- **`@deepseek-ai/dsh-geo-view`** (`packages/geo/geo-view`) — `geo/view` event (`ignorable`), `geoView` last-wins projection, and the default-exported `CameraViewService extends TypertRemoteService` (namespace `geoView`) whose validated `@Remote('report')` appends the event. 26 tests; typecheck clean; host typert codegen runs offline.
- **`get_current_view`** tool added to `@deepseek-ai/dsh-tool-geo-control` — reads the newest `geo/view`, falls back to the newest `geo/command` camera; returns pose + optional real bbox.
- **`geo-viewcontext`** prefers a real `geo/view` (using its on-screen bbox verbatim, label "On-screen bounds") over the derived `geo/command` pose ("Approximate visible bounds").
- **`@deepseek-ai/dsh-geo-segment`** (`packages/geo/segment`) — `ctx.segment` Service Definition + last-wins provider registry with explicit `resolve()` defaults (`prompt='building'`, `geometry='mask'`, `confidenceThreshold=0.5`); `SamGeoProvider` (validated `baseUrl`, injectable `fetchImpl`, POSTs the multipart `/segment/geo` form, validates the GeoJSON reply); `segment_view` tool that reads the current view bbox and draws one `geo/command` polygon per returned feature (`feat-${seq}-${i}`). When a request omits `imageUrl`, the provider synthesizes a bbox raster URL from `imageryUrlTemplate` (default Esri World Imagery `export`, matching the earth panel's `esri-satellite` basemap) — this resolves the imagery-source open question below. 19 offline tests, typecheck clean.
- **Client** — `earthController.getViewState()`/`onCameraChanged()` and the `GeoViewReporter` bridge (registered on the `conversation.session.header.utilities` seat) report the live Cesium camera through `ctx.remote.geoView.report`. `api/remotes` mounts `geoViewRemote`. 29 client tests.
- **SAM3 backend** — `POST /segment/geo` in `mlx_sam3/app/backend/geo.py`; 4 offline tests (`test_geo.py`).
- **Composition** — `dsh-base` carries `geo-view`, `geo-segment`, `tool-geo-segment`, and `geo-segment-samgeo` (`disabled: true`); the `web-app` profile enables `ui-geo-earth` with the reporter. `examples/geo-segmentation.overlay.cordis.yml` flips the SAM provider on. Snapshot `geo-segment` replays keyless.
- All geo package test files pass together (140 with the client panel).
