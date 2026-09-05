# @deepseek-ai/dsh-client-ui-supply-chain

English | [中文](README.zh.md)

The supply-chain emulator's browser half: a `conversation.view` tab that configures a scenario, runs it, renders the three reports, and replays the resulting network day by day on the 3D Earth.

## What it registers

One `conversation.view` entry (id `supply-chain`, order 30) beside the existing Chat, Trajectory, and Summary tabs. Scenario controls cover the preset plus the numeric settings a user is most likely to move; each slider seeds from the selected preset's resolved config, which the host supplies through the `catalog` Remote so the browser holds no second copy of the defaults.

## Data path

The panel calls the seam's Typert Remotes — `simulate`, `run`, and `catalog` — rather than reading a session projection. A finished run is request/response data held in the browser for as long as the panel keeps it; it is not session history.

## Replay ownership

Replay state — the run, the continuous position, and whether playback is advancing — lives in [src/client/replayController.ts](src/client/replayController.ts), created in the plugin body and exposed to the component through the injected `hooks` compartment. The center-column tab unmounts whenever the user switches to Chat, so component state and effect timers cannot hold a replay; the controller keeps advancing and keeps redrawing the globe, which stays visible in its own column. Playback stops at the final day rather than looping, and pressing play at the end restarts from day 0.

`position` and `day` are separate published facts: charts and the day counter read the whole day, while the globe reads the continuous position so goods in transit interpolate between day boundaries.

## Globe overlay

The network is drawn into its own named Cesium layer through `ctx.earthOverlays`, the service `@deepseek-ai/dsh-client-ui-geo-earth` publishes. The agent's own "Drawings" layer is a separate data source and is never touched by this package. Marker size encodes the facility's echelon role, marker color whether it carries backlog that day, lane width its utilization, and lane color saturation or an active closure; goods in transit ride on top in their item's color. The in-panel legend and the overlay read one shared role-and-color table, so the two cannot disagree.

## Model Experience

None, as the panel registers no prompt, tool, or session event; it renders completed runs it reads over Typert Remotes, and `@deepseek-ai/dsh-tool-supply-chain` owns every model-visible projection of the same data.

#### KV Cache effect

No direct effect. A scenario run from this panel reaches a model request only when the agent separately calls a supply-chain tool, which owns the resulting prefix change.

## Known Limitations and Deferred Work

- **A user's run is invisible to the model** — the panel's Remotes are request/response, so nothing it runs enters the session log or the transcript. A user cannot ask the agent about a scenario they just ran without running it again through a tool.
- **The panel is empty after a host restart** — it renders only what the seam still retains in memory, and it does not restore a previous run on mount.
- **Reports are rendered natively, not from upstream figures** — the three views are SVG drawn here from raw series and are not the upstream simulator's Plotly figures; a chart the upstream map offers exists here only if this package draws it.
- **Only part of the config is reachable from the panel** — the sliders expose the commonly moved settings; the remaining `SimulationConfig` fields are reachable only through the tools.
- **Lane geometry is rebuilt per day** — draped ground primitives load asynchronously, so lanes are redrawn only on a day boundary while goods move every frame; a very short horizon can show lanes still loading as the replay passes.
