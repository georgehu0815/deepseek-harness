# Agent Note: The shared 3D globe follows the active conversation's bridge

Status: proposed

Area: geo, client. Related to [Agent Note: Browser-reported current view](2026-08-21-design-geo-view-report.md) and [Geo domain layers for the Terra port](2026-08-20-design-terra-geo-plugin-dsh.md).

## Problem

The 3D Earth panel renders drawings (camera flights, `draw_*`, and `segment_view` polygons) from only one conversation at a time: whichever conversation currently owns the session-scoped header seat. A person who runs `segment_view` in conversation A but has the Earth 3D panel focused on conversation B sees no polygons on the globe, even though the tool succeeded and conversation A's `geoCommand` projection holds every drawn feature. This reads as "segmentation does not render", when the features exist and are correct — they are simply not the ones driving the shared globe.

The cause is the current topology. `earthController` (`packages/client/ui-geo-earth/src/client/earthController.ts`) is a module-level singleton — one globe for the whole app. `EarthColumnPanel` rides the app-level `earth` layout seat, so the globe UI is always the same instance. But `GeoCommandBridge` and `GeoViewReporter` ride the per-conversation `conversation.session.header.utilities` seat (`src/client/index.ts`), so `useProjection('geoCommand')` — and therefore the `renderFeatures(state.features)` call that fills the globe — is bound to the active conversation's session. When focus is on a conversation whose `geoCommand.features` is empty, the bridge calls `renderFeatures([])` and clears the shared globe. The same split explains why `get_current_view` reports no on-screen bounds when the panel is focused elsewhere: the reporter that appends `geo/view` runs only for the active conversation, so a non-focused conversation's session log never receives a real bbox.

This is a design gap, not a render bug: the drawn-feature reconciler, the polygon path, and the projection fold are all correct. The limitation is that the shared globe silently follows the active conversation's bridge with no way to pin it to the conversation whose drawings a person wants to see.

## Proposal

Bind the shared globe to an explicit target conversation instead of implicitly to the active header seat. Introduce a small app-level selection — the "conversation currently driving the globe" — that `EarthColumnPanel` owns and displays, defaulting to the active conversation but pinnable. The bridge that feeds `earthController.renderFeatures` reads that selection rather than assuming the active-header session, so a person can keep the globe on conversation A's LA houses while typing in conversation B. The reporter's `geo/view` append stays tied to the conversation actually shown on the globe, so `get_current_view` reflects the pinned view. The exact mechanism (a client selection service the panel and bridge share, versus threading a session id into a single app-level bridge) is an implementation choice for the change; either removes the silent active-follows-focus coupling.

Until then, the operational rule is: run geo tools in the conversation that owns the open Earth 3D panel, and refresh once so the current client bundle (which carries the bridge and reporter) is loaded.

## Acceptance criteria

- Running `segment_view` (or any `draw_*`) in a conversation and viewing the Earth 3D panel pinned to that conversation renders every drawn feature on the globe, regardless of which conversation currently holds input focus.
- `get_current_view` returns the on-screen bounds of the conversation the globe is showing, not only the active-header conversation.
- Switching the globe's target conversation reconciles the drawn-feature set to that conversation's `geoCommand.features` (add and remove), with no leftover entities from the previously shown conversation.

## Alternatives considered

- **One globe per conversation.** Rejected: the Earth panel is a single app-level layout column by design ([Terra geo port](2026-08-20-design-terra-geo-plugin-dsh.md)); multiplying Cesium viewers is heavy and contradicts that layout decision.
- **Always follow the active conversation (status quo).** Rejected: it is the current behavior and is exactly the confusing coupling this note removes; a person cannot watch one conversation's drawings while working in another.
- **Document only, no code change.** Rejected as insufficient: the silent clear-on-focus-change surprises every multi-conversation user and makes the segmentation feature look broken.

## Risks

- **Singleton reconciliation on target switch** — moving the globe between conversations must fully clear the previous conversation's entities before applying the new set, or stale polygons linger. The existing `applyFeatures` already `removeAll()`s, so the switch reuses that path.
- **Reporter attribution** — the `geo/view` report must be attributed to the shown conversation's session id, not the focused one, or the agent reads a view that belongs to a different conversation.
- **Selection lifetime** — a pinned conversation that is closed or archived must fall back to the active conversation rather than leaving the globe frozen on a dead session.
