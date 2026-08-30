# Agent Note: Render drawn geo features with labels on the 3D Earth globe

Status: implemented

English | [中文](2026-08-29-earth-drawn-feature-rendering.zh.md)

## Problem

The `geoCommand` session projection accumulates a `features` array — the drawn points, polylines, and polygons the agent's `draw_*`/`move`/`set-props`/`delete` tools produce, with moves and deletes already folded into a final draw-ordered set. The 3D Earth panel could fly the camera and switch the base map from that projection, but ignored `features`, so nothing the agent drew appeared on the globe.

`features` is not shaped like the other geo inputs. The `command` field is a one-shot instruction the bridge applies exactly once, gated on a monotonic `seq` so re-render and replay converge on the last commanded view without re-firing intermediate camera moves. `features` is whole-set accumulated state: the correct globe at any moment is the full current set, and a change may not advance `seq` in a way the one-shot guard would honor. Applying it through the same seq/one-shot path would drop or double-apply drawings.

## Decision

`earthController` gains `renderFeatures(features)`, a full reconcile into one dedicated Cesium `CustomDataSource` named "Drawings". Each call remembers the set as controller state and, when a viewer is attached, clears the source's entities and rebuilds one `Entity` per feature — a point/polyline/polygon graphic plus, when the feature carries a non-empty name, a text label anchored at the point position or the first line/ring vertex. The remembered set is reapplied on `attach` (after the base map), so a viewer mounted later reconstructs the drawings from the projection alone. `detach` drops the data-source reference so a fresh viewer gets a fresh one; the data source is added to the viewer exactly once and guarded against re-add across re-renders.

`GeoCommandBridge` drives it through a **second** `useEffect`, keyed on `state?.features`, calling `earthController.renderFeatures(state.features ?? [])`. This is deliberately separate from the seq-gated command effect: the command effect keeps its "apply only when `seq` advances" contract for camera/basemap, while feature reconciliation runs whenever the accumulated set changes, independent of `seq` and of the one-shot command switch. An undefined projection reconciles the empty set rather than crashing.

Labels set `disableDepthTestDistance: Number.POSITIVE_INFINITY` so a name is never occluded by the globe when its anchor rotates to the far side or drops below the horizon — without it, Cesium depth-tests label text against the ellipsoid and hides labels whose anchor faces away, which for a whole-Earth annotation layer reads as flickering, disappearing names.

## Full reconcile vs. incremental diff

Each feature-set change rebuilds every entity rather than diffing the previous set against the new one and mutating only the delta. The reconcile is O(features) per change, and the annotation counts here are tiny — a handful of agent-drawn marks, not a fleet. A diff would add an id-keyed reconciler (add/update/remove, per-graphic property patching) whose complexity is unjustified at this scale and easy to get subtly wrong. The tradeoff is recorded in the package README's Known Limitations; an entity-level diff is deferred until a feature volume makes rebuild cost visible.

## Alternatives considered

- **Fold features into the seq/one-shot command effect** — rejected: `features` is accumulated whole-set state, not a one-shot command. The `seq` guard exists to avoid re-firing camera moves; gating whole-set reconciliation behind it would skip legitimate feature changes that share a `seq`, and threading it through the `command.kind` switch would couple two unrelated update rhythms.
- **Incremental entity diffing** — rejected for now: unjustified complexity at annotation scale (see above).
- **A separate data source per feature, or per geometry type** — rejected: one "Drawings" source keeps reconcile and teardown a single clear-and-rebuild, and matches the single-layer model the drawing tools present.
- **Omit `disableDepthTestDistance`** — rejected: globe depth-testing hides labels whose anchor faces away from the camera, which is wrong for a whole-Earth annotation layer.

## Consequences

The globe now shows everything the agent draws, with optional names, and a freshly mounted or replayed viewer reconstructs the full "Drawings" layer from the projection. The cost is a full rebuild on every feature change and the deferred incremental-diff work noted above. The bridge's basemap branch is now narrowed to `command.kind === 'basemap'` (other command kinds — domain toggles, the draw/move/edit/delete family — are folded into `enabledDomains`/`features` by the projection, not applied as one-shot globe commands here), closing a latent type hole the growing command union had opened. Behavior is pinned by package specs: the controller reconcile (each geometry type, name present/absent, add-once, no-viewer/destroyed-viewer, attach-with-remembered-features) and the bridge's separate feature effect, at 100% per-file coverage.
