/**
 * The sidebar footer button that opens the Earth 3D column and the grid-column
 * occupant that hosts the globe. Both drive the shell's first-class earth grid
 * track through `ctx.layout` (openEarth/closeEarth/toggleEarth), injected as
 * plain callbacks — the panel is a real layout column, not a floating overlay.
 * A header maximize toggle full-screens the globe over the whole shell while
 * keeping the Cesium engine mounted, so toggling back is instant. While
 * maximized, the globe reserves a bottom band and a `document.body` class lifts
 * the conversation composer into it, so the user can keep typing over the globe.
 */
import * as React from 'react'
import { EarthPanel } from './EarthPanel.tsx'

/**
 * In-column maximize state, local to the page. The dock's open/close state is
 * owned by the layout store (the earth grid track); this observable only
 * carries whether the globe is expanded to cover the whole shell while the
 * column stays open, so the engine is not torn down on a toggle.
 */
class MaximizeStore {
  private maximized = false
  private readonly listeners = new Set<() => void>()

  getMaximized(): boolean { return this.maximized }

  toggleMaximized(): void {
    this.setMaximized(!this.maximized)
  }

  /**
   * Set the maximized flag and mirror it onto a `document.body` class. The
   * conversation composer seat lives in the center column's own stacking
   * context, below the globe's fixed overlay; the body class lets a global
   * rule lift that seat above the globe so the user can keep typing while the
   * globe is maximized.
   */
  setMaximized(next: boolean): void {
    if (this.maximized === next) return
    this.maximized = next
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('geo3d-earth-maximized', next)
    }
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

/** Process-wide single instance (one globe per page). */
const maximize = new MaximizeStore()

/** React hook returning whether the globe view is maximized over the shell. */
function useMaximized(): boolean {
  return React.useSyncExternalStore(maximize.subscribe, () => maximize.getMaximized(), () => false)
}

const CSS = `
.geo3d-navbtn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:transparent;border:none;color:var(--dsh-color-text,#cfd2da);padding:8px 10px;border-radius:8px;cursor:pointer;font:13px/1.4 system-ui,sans-serif;text-align:left}
.geo3d-navbtn:hover{background:var(--dsh-color-surface-2,rgba(255,255,255,.06))}
.geo3d-navbtn.rail{justify-content:center;padding:8px 0}
.geo3d-navbtn.rail .lb{display:none}
.geo3d-navbtn .ic{font-size:16px;line-height:1;flex:0 0 auto}
.geo3d-col{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsh-color-surface,#16171b)}
.geo3d-col.max{position:fixed;left:0;right:0;top:0;bottom:var(--geo3d-composer-band,168px);z-index:9000}
/* While maximized, lift the conversation composer above the globe and dock it
   in the reserved bottom band so the user can keep typing. The seat normally
   lives in the center column's own stacking context, below the globe overlay. */
body.geo3d-earth-maximized [data-composer-seat]{position:fixed;left:0;right:0;bottom:0;z-index:9001;box-sizing:border-box;display:flex;justify-content:center;padding:10px 16px}
.geo3d-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--dsh-color-surface,#16171b);border-bottom:1px solid var(--dsh-color-border,#2a2c33)}
.geo3d-bar h2{margin:0;font:600 14px/1.3 system-ui,sans-serif;color:var(--dsh-color-text,#e8e8ea)}
.geo3d-close{display:inline-flex;align-items:center;justify-content:center;background:var(--dsh-color-surface-2,#2c2f38);border:1px solid var(--dsh-color-border,#3a3d46);color:var(--dsh-color-text,#e8e8ea);height:32px;min-width:32px;padding:0 10px;border-radius:8px;cursor:pointer;font:600 15px/1 system-ui,sans-serif}
.geo3d-close:hover{background:#3a3d46;border-color:#4a4d57}
.geo3d-actions{display:flex;align-items:center;gap:8px}
.geo3d-toggle{display:inline-flex;align-items:center;gap:6px;background:var(--dsh-color-surface-2,#2c2f38);border:1px solid var(--dsh-color-border,#3a3d46);color:var(--dsh-color-text,#e8e8ea);height:32px;padding:0 12px;border-radius:8px;cursor:pointer;font:600 13px/1 system-ui,sans-serif}
.geo3d-toggle:hover{background:#3a3d46;border-color:#4a4d57}
.geo3d-body{flex:1 1 auto;min-height:0;position:relative}
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
  const maximized = useMaximized()
  const open = Boolean(props.width)

  // Closing the column (or unmounting the panel) exits maximize, so the body
  // class and the docked composer never linger without a globe behind them.
  React.useEffect(() => {
    if (!open) maximize.setMaximized(false)
    return () => { maximize.setMaximized(false) }
  }, [open])

  if (!open) return null
  return (
    <div className={maximized ? 'geo3d-col max' : 'geo3d-col'} role="region" aria-label="Earth 3D">
      <style>{CSS}</style>
      <div className="geo3d-bar">
        <h2>🌍 Earth 3D</h2>
        <div className="geo3d-actions">
          <button
            className="geo3d-toggle"
            title={maximized ? 'Restore view' : 'Maximize view'}
            aria-pressed={maximized}
            onClick={() => maximize.toggleMaximized()}
          >
            <span>{maximized ? '🗗' : '🗖'}</span>
            <span>{maximized ? 'Restore' : 'Maximize'}</span>
          </button>
          <button className="geo3d-close" title="Close" onClick={() => props.closeEarth?.()}>✕</button>
        </div>
      </div>
      {/* The viewer stays mounted across maximize/restore so toggling is
          instant and the Cesium engine is not torn down and rebuilt. */}
      <div className="geo3d-body">
        <EarthPanel />
      </div>
    </div>
  )
}
