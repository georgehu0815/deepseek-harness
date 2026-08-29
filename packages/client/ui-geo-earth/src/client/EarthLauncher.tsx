/**
 * The sidebar footer button that opens the Earth 3D column and the grid-column
 * occupant that hosts the globe. Both drive the shell's first-class earth grid
 * track through `ctx.layout` (openEarth/closeEarth/toggleEarth), injected as
 * plain callbacks — the panel is a real layout column, not a floating overlay.
 * An in-column visibility toggle hides the globe while keeping the Cesium
 * engine mounted, so toggling back is instant.
 */
import * as React from 'react'
import { EarthPanel } from './EarthPanel.tsx'

/**
 * In-column globe visibility, local to the page. The dock's open/close state
 * is owned by the layout store (the earth grid track); this observable only
 * carries whether the globe is shown or hidden while the column stays open, so
 * the engine is not torn down on a hide.
 */
class VisibilityStore {
  private visible = true
  private readonly listeners = new Set<() => void>()

  getVisible(): boolean { return this.visible }

  toggleVisible(): void {
    this.visible = !this.visible
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

/** Process-wide single instance (one globe per page). */
const visibility = new VisibilityStore()

/** React hook returning whether the globe view is shown. */
function useVisible(): boolean {
  return React.useSyncExternalStore(visibility.subscribe, () => visibility.getVisible(), () => true)
}

const CSS = `
.geo3d-navbtn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:transparent;border:none;color:var(--dsh-color-text,#cfd2da);padding:8px 10px;border-radius:8px;cursor:pointer;font:13px/1.4 system-ui,sans-serif;text-align:left}
.geo3d-navbtn:hover{background:var(--dsh-color-surface-2,rgba(255,255,255,.06))}
.geo3d-navbtn.rail{justify-content:center;padding:8px 0}
.geo3d-navbtn.rail .lb{display:none}
.geo3d-navbtn .ic{font-size:16px;line-height:1;flex:0 0 auto}
.geo3d-col{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsh-color-surface,#16171b)}
.geo3d-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--dsh-color-surface,#16171b);border-bottom:1px solid var(--dsh-color-border,#2a2c33)}
.geo3d-bar h2{margin:0;font:600 14px/1.3 system-ui,sans-serif;color:var(--dsh-color-text,#e8e8ea)}
.geo3d-close{background:var(--dsh-color-surface-2,#22242b);border:1px solid var(--dsh-color-border,#2a2c33);color:inherit;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1}
.geo3d-close:hover{filter:brightness(1.3)}
.geo3d-actions{display:flex;align-items:center;gap:8px}
.geo3d-toggle{display:inline-flex;align-items:center;gap:6px;background:var(--dsh-color-surface-2,#22242b);border:1px solid var(--dsh-color-border,#2a2c33);color:inherit;height:28px;padding:0 10px;border-radius:8px;cursor:pointer;font:12px/1 system-ui,sans-serif}
.geo3d-toggle:hover{filter:brightness(1.3)}
.geo3d-toggle.off{color:#9aa0ac}
.geo3d-body{flex:1 1 auto;min-height:0;position:relative}
.geo3d-body.hidden{display:none}
.geo3d-hidden-msg{flex:1 1 auto;display:flex;align-items:center;justify-content:center;color:#8a8d97;font:13px/1.5 system-ui,sans-serif}
`

/** Sidebar footer button owner props: injected layout callback + rail flag. */
interface SidebarActionProps {
  wide?: boolean
  toggleEarth?: () => void
}

/** Sidebar footer button that toggles the Earth 3D grid column. */
export function EarthSidebarButton(props: SidebarActionProps): React.JSX.Element {
  const rail = props.wide === false
  let cls = 'geo3d-navbtn'
  if (rail) cls += ' rail'
  return (
    <button
      className={cls}
      title="Earth 3D"
      onClick={() => props.toggleEarth?.()}
    >
      <style>{CSS}</style>
      <span className="ic">🌍</span>
      <span className="lb">Earth 3D</span>
    </button>
  )
}

/** Earth grid-column owner props: injected layout close callback + column width. */
interface EarthColumnProps {
  width?: number
  closeEarth?: () => void
}

/**
 * Earth grid-column occupant: the globe plus its header. Renders nothing while
 * the column is closed (width 0) so the collapsed track paints empty; the
 * viewer stays mounted whenever the column is open.
 */
export function EarthColumnPanel(props: EarthColumnProps): React.JSX.Element | null {
  const visible = useVisible()
  if (!props.width) return null
  return (
    <div className="geo3d-col" role="region" aria-label="Earth 3D">
      <style>{CSS}</style>
      <div className="geo3d-bar">
        <h2>🌍 Earth 3D</h2>
        <div className="geo3d-actions">
          <button
            className={visible ? 'geo3d-toggle' : 'geo3d-toggle off'}
            title={visible ? 'Hide globe' : 'Show globe'}
            aria-pressed={visible}
            onClick={() => visibility.toggleVisible()}
          >
            <span>{visible ? '👁' : '🚫'}</span>
            <span>{visible ? 'Hide' : 'Show'}</span>
          </button>
          <button className="geo3d-close" title="Close" onClick={() => props.closeEarth?.()}>✕</button>
        </div>
      </div>
      {/* The viewer stays mounted while hidden so toggling back is instant and
          the Cesium engine is not torn down and rebuilt. */}
      <div className={visible ? 'geo3d-body' : 'geo3d-body hidden'}>
        <EarthPanel />
      </div>
      {visible ? null : <div className="geo3d-hidden-msg">Globe hidden — press Show to bring it back.</div>}
    </div>
  )
}
