# Segmenting the current 3D Earth view

This guide shows how to use the **`segment_view`** feature: turn whatever is on the 3D Earth globe into one polygon per detected object (buildings, homes, …) using the SAM3 segmentation backend, and draw those polygons back onto the globe.

It is the answer to requests like *"for the current view, draw a polygon for each home."*

## How the pieces fit together

```
Browser (Cesium globe)                    Host (DSH agent)                       SAM3 backend
──────────────────────                    ────────────────                       ────────────
 user pans/zooms  ──geo/view report──▶  geoView projection
                                        get_current_view ◀── agent reads view
                                        segment_view tool
                                          │  reads current bbox
                                          │  ctx.segment.segment(...)
                                          └── SamGeoProvider ──POST /segment/geo──▶ SAM3 masks
                                        draws one geo/command  ◀──GeoJSON lon/lat──   → GeoJSON
                                          polygon per feature
 globe shows polygons ◀────────────────
```

Four capabilities, all already wired into the base bundle:

| Piece | Package | Role |
|---|---|---|
| `geo/view` event + `geoView` projection | `@deepseek-ai/dsh-geo-view` | logs the real on-screen camera + bounds |
| `get_current_view` tool | `@deepseek-ai/dsh-tool-geo-control` | lets the agent read the current view |
| `ctx.segment` seam + `segment_view` tool | `@deepseek-ai/dsh-geo-segment` | segments the view, draws polygons |
| `POST /segment/geo` | `mlx_sam3/app/backend/geo.py` | runs SAM3, returns lon/lat GeoJSON |

The segmentation provider (`geo-segment-samgeo`) ships **disabled by default** because it needs a running SAM3 backend URL. Everything else loads automatically.

---

## The `segment_view` tool

**What the model calls:**

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `prompt` | string | `building` | What to segment, e.g. `"house"` or `"building"`. |
| `geometry` | string | `mask` | `mask` = precise footprints; `box` = bounding boxes. |
| `maxFeatures` | number | (all) | Cap on how many detections to draw. |

**What it does:** reads the current view's bounding box (from the newest `geo/view`, else the last `geo/command` camera), calls the segmentation backend, and appends one `geo/command` `draw-feature` polygon per returned feature (ids `feat-<seq>-0`, `feat-<seq>-1`, …).

**Result text:** `Segmented N features for '<prompt>' in the current view.`

---

## Quick start (one script)

From the repo root, `start-dsh-segmentation.sh` starts the SAM3 backend, waits for `/segment/geo`, and boots the web GUI with segmentation enabled:

```bash
./start-dsh-segmentation.sh
```

Env overrides: `SAM_BACKEND_URL` (default `http://localhost:8000`), `SAM_REPO` (default the sibling `../segment-geospatial`), and `START_BACKEND=0` to reuse a backend you already run. Ctrl-C stops both. The manual steps below explain what the script automates.

## Step 1 — Start the SAM3 backend

The georeferenced endpoint lives in the MLX SAM3 app.

```bash
cd /Volumes/ExternalSSD/geoagent/segment-geospatial/mlx_sam3
# One-time: sync the Python env (uv, python 3.13)
uv sync
# Start the FastAPI backend (serves /segment/geo on :8000)
cd app && ./run.sh
```

The first real segmentation downloads the model weights (`mlx-community/sam3-image`) — this needs network once, then runs locally on Apple Silicon.

Verify the endpoint is up:

```bash
curl -s http://localhost:8000/openapi.json | grep -o '/segment/geo'   # → /segment/geo
```

`POST /segment/geo` takes a multipart form: `file` (the view raster), `prompt`, `bbox` (`"west,south,east,north"`), `geometry` (`mask`|`box`), `confidence_threshold`. It returns a GeoJSON `FeatureCollection` of lon/lat polygons, each with `score` and `prompt`.

## Step 2 — Enable the segmentation provider in DSH

The provider ships `disabled: true` and requires a `baseUrl`. The repo ships an overlay that enables it and reads `SAM_BACKEND_URL` (default `http://localhost:8000`): [`examples/geo-segmentation.overlay.cordis.yml`](../../examples/geo-segmentation.overlay.cordis.yml). Boot the web profile with it:

```bash
pnpm dsh web --patch examples/geo-segmentation.overlay.cordis.yml
```

The overlay is:

```yaml
- id: geo-segment-samgeo
  name: '@deepseek-ai/dsh-geo-segment/provider-samgeo'
  disabled: false
  config:
    baseUrl: !!js process.env.SAM_BACKEND_URL ?? 'http://localhost:8000'
    timeoutMs: 60000
```

Config keys (`SamGeoProvider`):

- **`baseUrl`** *(required, non-empty)* — the backend origin. Misconfiguration fails loud at load, never silently.
- **`timeoutMs`** *(optional, default 60000)* — per-request timeout; also honors the tool's abort signal.

## Step 3 — Drive it from the agent

Open the 3D Earth panel (sidebar → **Earth 3D**), navigate to an area with buildings, then ask the agent. A typical sequence:

> **You:** Fly to Tokyo Haneda, then draw a polygon for each building in the current view.

The agent will:

1. `control_camera` → move the globe (or you pan it by hand — the browser reports `geo/view`).
2. `get_current_view` → confirm what's on screen (returns lat/lon/height + on-screen bounds).
3. `segment_view` with `prompt: "building"` → draws one polygon per detected building.

You'll see the polygons appear on the globe, and the agent reports e.g. `Segmented 12 features for 'building' in the current view.`

### More prompt examples

> Segment the homes in this view. → `segment_view { prompt: "house" }`

> Draw bounding boxes for every building, at most 20. → `segment_view { prompt: "building", geometry: "box", maxFeatures: 20 }`

> What am I currently looking at? → `get_current_view` (no segmentation)

---

## Step 4 (optional) — call the backend directly

To test the segmentation backend without DSH, POST a georeferenced image yourself:

```bash
curl -s -X POST http://localhost:8000/segment/geo \
  -F "file=@view.png" \
  -F "prompt=building" \
  -F "bbox=139.76,35.54,139.80,35.56" \
  -F "geometry=mask" \
  -F "confidence_threshold=0.5" | jq '.features | length'
```

`bbox` is `west,south,east,north` in degrees and must match the framing of `view.png`. The reply is GeoJSON in lon/lat you can drop straight onto a map.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `SamGeoProvider: no raster source — provide an imageUrl or set imageryUrlTemplate` | Only if you cleared `imageryUrlTemplate`. Leave it at the default (Esri imagery for the view bbox) or pass an explicit `imageUrl`. |
| `geo-segment: no segmentation provider registered` | The provider is still disabled. Apply the Step 2 overlay with a valid `baseUrl`. |
| Tool loads but the backend 503s | SAM3 model not loaded yet — the first call downloads weights; wait for `./run.sh` to finish initializing. |
| Polygons look skewed / offset | The backend maps pixels to lon/lat by a **linear bbox transform** assuming equirectangular framing. An oblique camera or a Web-Mercator tile mosaic skews results — keep the camera roughly top-down. Tile reprojection is deferred (see the Known Limitations in the package READMEs). |
| `422` from `/segment/geo` | Malformed `bbox` (needs four numbers, `east > west`). |

## Known limitations

- **Top-down framing assumed.** Georeferencing is a linear bbox transform, not a true reprojection; best for near-nadir views.
- **Raster source.** By default the provider fetches Esri World Imagery for the view's bbox (the same imagery the earth panel shows); set `imageryUrlTemplate` to point at another bbox imagery service, or pass an explicit `imageUrl`.
- **Last-wins view.** The agent segments the *most recent* reported view; rapid panning collapses to the final frame (~300 ms debounce).

## Related

- Package details: `packages/geo/geo-segment/README.md`, `packages/geo/geo-view/README.md`
- Design + rationale: `.agents/notes/proposed/architecture/2026-08-21-design-geo-view-report.md`
