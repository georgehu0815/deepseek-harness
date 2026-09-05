---
description: "Shell layout for the Web GUI: the four-column AppFrame, shared visual workspace, drag handles, concession behavior, panel geometry, and theme presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides the Web GUI shell: a four-column AppFrame with resizable sidebar, details, and visual panels; a shared visual workspace for independently contributed tabs; a concession chain that preserves the center floor; and the `ctx.layout` panel-geometry service. It also seats the theme presenter, which projects the resolved color scheme, alias tokens, content font size, and `theme-color` metadata onto the document. Choose it for standard window chrome and shared Earth or Robot Lab views; panel geometry and visual selection are transient and reset on reload.

## Table of Contents

- [Use this package](#use-this-package)
- [Visual workspace](#visual-workspace)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin at the root slot; it renders the app frame around the sidebar, conversation, details, and shared visual workspace. Users resize the sidebar through its invisible hit strip and resize details or visual through floating pills. When the window narrows, the concession chain shrinks visual, shrinks details, auto-closes visual, then auto-closes details to preserve the center floor. A closed sidebar retains a 56px control rail; optional columns close to zero width.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="visual-workspace"></a>
## Visual workspace

`visual.workspace.view` is a `session-maybe` list slot. Plugins contribute entries with `id`, `order`, and `label`; the shell derives tab metadata and renders only the selected entry. `ctx.layout.openVisual(id)` selects a view and opens the column without resetting an open width. `toggleVisual(id)` closes the column only when that same view is already open; otherwise it selects and opens the requested view. `closeVisual()` closes the column and retains selection. An unavailable selected entry produces a visible message instead of silently selecting another plugin.

The visual preference and selected tab are root viewing state that survive Session switches. The selected view receives the current optional Session and rendered `width` owner prop. Closing the column or switching tabs unmounts its viewer, so consumers own data or server operations that must survive that unmount. The shell contains no Earth- or Robot-specific renderer imports.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `register()` call contributes `AppFrame` into the runtime's built-in `'root'` slot, declares the five child slots (`sidebar`, `conversation`, `details`, `visual.workspace.view`, `shell.overlay`), seats the viewing store, and wires the `ctx.layout` panel-action service. The transient store starts with the default sidebar width and closed details and visual columns, and never reads or writes `localStorage`. AppFrame keeps conversation and details at fixed tree positions and renders only the selected visual entry. A connected Session renders through `SessionProvider`; visual selection remains root viewing state while the selected entry receives the current optional Session. The theme presenter remains a separate effect: pure DOM writes from resolved snapshots, initial state through the getter once and then event-driven, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `conversation` and `details` columns.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [ui-geo-earth](../ui-geo-earth/README.md) — contributes the Earth tab to the shared visual workspace.
- [ui-robot-lab](../ui-robot-lab/README.md) — contributes the Robot Lab tab to the shared visual workspace.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current layout behavior. They are current package constraints, not a general window-manager comparison or a task backlog.

- **Panel geometry and visual selection are transient** — reload restores the sidebar default and closes optional columns; switching between distinct Session ids also closes details and forgets its dragged width.
- **Concession-chain auto-close does not change preferred widths** — visual and details recover when the window widens; consumers must not read stored widths as rendered truth.
- **Only one visual view renders at a time** — a plugin that requires background data must own it outside the component lifecycle.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind `ctx.layout` emits no Cordis events; column clamps, visual selection, and concession sequencing are asserted directly by this package's service and column specs.
