# @deepseek-ai/dsh-geo-command

English | [中文](README.zh.md)

The agent→Earth command channel: the `geo/command` session event and the `geoCommand` session projection that carries the latest desired globe view to the browser. Part of the Terra geo port (Phase 2).

## What it does

Declares the `geo/command` session event (a camera or base-map command) and registers the `geoCommand` projection — a last-wins fold that holds the most recent command plus a per-session sequence number. `@deepseek-ai/dsh-tool-geo-control` appends the events; the client bridge in `@deepseek-ai/dsh-client-ui-geo-earth` reads the projection through `useProjection('geoCommand')` and drives the globe, applying a command only when the sequence advances.

## Session projection

`geoCommand` initial value is `{ seq: 0, command: null }`. Each `geo/command` event increments `seq` and replaces `command`; any other event returns the same state reference (no spurious frames). Because the projection is the desired-view state, replay converges on the last commanded view without re-firing intermediate camera moves.

## Export shape

Default-exports the projection-registering plugin. `./types` is the single home for `GeoCameraCommand`, `GeoBaseMapCommand`, `GeoCommand`, and `GeoCommandState`, and declares the `SessionEventMap` and `SessionProjectionMap` members. `./client` re-exports those types for the browser side.

## Model Experience

### Command channel (no direct model surface)

#### What the model sees

Nothing directly. The `geo/command` event and `geoCommand` projection are UI and replay state, never a model message. The model acts through `@deepseek-ai/dsh-tool-geo-control`, whose results are documented there.

#### Token effect

None from this package.

#### KV Cache effect

None from this package; the command events are not part of the model request.

## Known Limitations and Deferred Work

- **Camera and base-map commands only** — domain-toggle and draw commands are deferred with their tools; see the [proposed note](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md).
- **Last-wins, not a queue** — the projection keeps only the latest command; a client that reconnects or replays converges on the final view and does not observe intermediate ones.
