# Explore the 3D Earth

English | [中文](3d-earth.zh.md)

The agent can drive an interactive 3D globe from your prompts: fly the camera to a place, switch the base-map imagery, turn geographic data layers on or off, and draw annotations such as points, lines, and areas. You describe what you want in plain language; the agent calls the geo tools, and the globe responds.

This guide assumes the Web UI is running (see [Use the Web UI](./index.md)) with a workspace and a model configured.

## What is new

The agent now has a full set of geo control tools:

- **Camera** — fly to any latitude/longitude at a chosen height.
- **Base map** — switch between imagery presets (`osm`, `carto-dark`, `carto-light`, `esri-satellite`).
- **Domain layers** — show or hide built-in data layers: `airports`, `cities`, `lakes`, `ports`, `railroads`, `roads`, `time-zones`.
- **Drawings** — draw a point, a polyline, or a polygon; move, rename, delete, or undo a drawn feature.

Every command is recorded on the session, so a drawing you made earlier is still part of the map's state when you reload or resume — the globe rebuilds the enabled layers and the drawn features from the session history, not from a live connection you must keep open.

> **Rendering scope today.** Camera moves and base-map switches appear on the globe immediately. Domain layers and drawings are recorded and accumulated in the map's state now; the on-globe rendering of those layers and shapes arrives in a follow-up update. You can drive and verify the full command set today through the agent's replies, described below.

## Open the globe

1. In the sidebar footer, click **Earth 3D**. A resizable globe column opens on the right of the shell, beside the conversation.
2. Use the column header to hide the globe (the engine stays mounted, so showing it again is instant) or to close the column.

## Move the camera

Ask the agent to fly somewhere. For a named place it first resolves the name to coordinates, then moves the camera:

> Fly to Tokyo and zoom in fairly close.

The agent calls `control_camera` and replies with a line like `Camera moved to 35.6762, 139.6503 at 15000 m.` The globe animates to the new view. You can also give coordinates directly:

> Move the camera to latitude 40.71, longitude -74.01 at 15 km height.

Latitude must be between −90 and 90, longitude between −180 and 180.

## Switch the base map

> Switch the base map to satellite imagery.

The agent calls `set_basemap` with `esri-satellite` and replies `Base map set to esri-satellite.` Ask for `carto-dark` for a dark theme, or `osm` to return to the default OpenStreetMap tiles.

## Turn a data layer on or off

> Show the airports layer.

The agent calls `toggle_domain` and replies `Domain airports shown.` Hide it again with:

> Hide the airports layer.

which replies `Domain airports hidden.` The available layers are `airports`, `cities`, `lakes`, `ports`, `railroads`, `roads`, and `time-zones`. Enabled layers accumulate: showing `cities` after `airports` keeps both on.

## Draw annotations

### Draw a point

> Drop a point at longitude 139.78, latitude 35.55.

The agent calls `draw_point` and replies `Drew point feat-1.` The reply includes the feature's id (here `feat-1`). Ids are assigned in the order you draw, so the first feature is `feat-<n>` for the sequence position it occupies — the agent tells you the exact id, and you refer to it later by that id.

### Draw a line or an area

> Draw a polyline through [139.70, 35.68], [139.75, 35.70], and [139.80, 35.66].

`draw_polyline` needs at least two `[longitude, latitude]` points and replies `Drew polyline feat-2.`

> Draw a polygon around [139.70, 35.65], [139.80, 35.65], [139.80, 35.72], and [139.70, 35.72].

`draw_polygon` needs a ring of at least three points and replies `Drew polygon feat-3.`

### Move, rename, delete, and undo

Refer to a feature by the id the agent reported:

> Move feature feat-1 east by 0.1 degrees longitude.

`move_feature` shifts the feature by a longitude/latitude delta and replies `Moved feature feat-1.`

> Rename feature feat-1 to "Dock entrance".

`set_feature_properties` sets the display name and replies `Updated feature feat-1.`

> Delete features feat-2 and feat-3.

`delete_features` removes them and replies `Deleted 2 feature(s).`

> Undo the last drawing.

`undo_draw` removes the most recently drawn feature and replies `Removed the most recent drawn feature.`

## A worked example

Send these one after another and watch the agent's replies build up the map state:

1. > Fly to Tokyo, fairly close.
2. > Switch the base map to satellite.
3. > Show the airports layer.
4. > Drop a point at longitude 139.78, latitude 35.55, and tell me its id.
5. > Rename that feature to "Haneda".
6. > Undo the last drawing.

After step 4 the agent reports a feature id (for example `feat-1`); use it in step 5 if the agent asks. By step 6 the point is removed again, the airports layer is still on, and the base map is still satellite — the camera and base map reflect your latest commands while layers and drawings accumulate.

## Tips and limits

- **Refer to features by id.** The draw tools return the id in their reply; use that id for `move`, `rename`, and `delete`.
- **Deltas, not absolute positions, for moves.** `move_feature` shifts a feature by a longitude/latitude offset in degrees.
- **One globe.** The Earth column hosts a single globe; there is no split or multi-viewer view.
- **The globe must be showing for live camera moves.** With the column closed, the latest base map is remembered and applied when you reopen it, while a camera fly-to issued meanwhile is not replayed.

## Related

- [Use the Web UI](./index.md)
- [Configure models](./providers.md)
