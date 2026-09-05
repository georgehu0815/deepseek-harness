# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: four-column AppFrame and the `ctx.layout` panel-geometry service. It registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, `visual.workspace.view`, and `shell.overlay`. Tracks are `sidebar | center | details | visual`. The sidebar resize boundary is an invisible hit strip; details and visual boundaries have floating pills. The concession chain shrinks visual, shrinks details, auto-closes visual, then auto-closes details to preserve the center floor. The sidebar never concedes; a closed sidebar retains its 56px rail.

## Visual workspace

`visual.workspace.view` is a list slot with `session-maybe` scope. Plugins contribute independent entries with `id`, `order`, and `label`; the shell derives tab metadata through a framework-bound observable and renders only the selected entry. `ctx.layout.openVisual(id)` selects a view and opens the column without resetting an open width. `toggleVisual(id)` closes only when that same view is already open; otherwise it selects and opens the requested view. `closeVisual()` closes the column and retains selection. An unavailable selected entry produces a visible message instead of silently selecting another plugin. Registrants receive the rendered `width` owner prop and standard session hooks; business actions come from their own inject faces.

The visual column preference and selected tab are root viewing state and survive session switches. The selected view receives the current optional session. Closing the column or switching tabs unmounts its viewer; consumers own any data or server operations that must survive that unmount. The shell contains no Earth or Robot-specific renderer imports.

## Geometry and theme

The transient layout store starts with the default sidebar width, details closed and visual closed; it never reads or writes `localStorage`. Conversation and details retain their fixed tree positions. Hero and other unselected states derive zero details width without changing the stored preference. The first Session remains closed; an explicit details action opens the default width, returning to the same Session preserves it, and selecting a different Session closes details before paint. Sidebar owner props are `collapsed` and `width`; conversation and details owner shares are empty.

The theme presenter projects resolved `ctx.theme` snapshots onto the document: `html { color-scheme }`, `body[data-ds-dark-theme]`, inline alias tokens on body, and an owned `<meta name="theme-color">` derived from the computed body background after token application. Disposal removes the metadata node and other owned global writes.

The `/client` exports contain plugin loading symbols, `LayoutController`, and public type contracts. AppFrame, the viewing store, tab metadata adapter and concession solver remain internal.

## Model Experience

None: layout manages browser viewing state and injects no model context.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- Panel geometry and visual selection are transient; reload restores closed optional columns. Switching distinct Session ids also closes details and forgets its dragged width.
- Concession-chain auto-close does not change preferred width. Visual and details recover when the window widens; stored width is not rendered width.
- Only one visual view renders at a time. A plugin requiring background data must own that data outside its component lifecycle.
- Layout changes can move the reading viewport; squeeze reflow has no scroll anchoring.
