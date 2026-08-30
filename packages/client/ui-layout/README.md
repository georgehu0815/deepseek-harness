# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: four-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, `earth`, and `shell.overlay`. The grid tracks are `sidebar | center | details | earth`. The sidebar resize boundary is an invisible hit strip, while the details and earth boundaries retain a floating pill each. The concession chain keeps `center` above its floor by conceding in order: shrink `earth`, shrink `details`, auto-close `earth`, auto-close `details`, then let `center` absorb any remaining deficit — the sidebar never concedes (a closed sidebar retains a 56px control rail). `earth` is the optional right-side 3D globe column, closed by default and opened through `ctx.layout`. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation, details, and earth columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width, details closed, and earth closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The earth column is `root`-scoped: it is not tied to the current Session and stays open across Session switches until `ctx.layout` closes it. The conversation owner share is empty, the sidebar owner share contains only `collapsed` and `width`, and the earth owner share contains only `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default with details and earth closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — earth and details restore themselves when the window widens; consumers must not read the stored details or earth width as the rendered truth.
- **The earth column is a single root-scoped seat** — one occupant renders the globe; opening it is a `ctx.layout` action with no per-Session memory.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
