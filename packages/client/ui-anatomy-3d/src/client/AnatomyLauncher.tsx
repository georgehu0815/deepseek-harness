/**
 * Shared open/close state for the Human Body 3D viewer, plus the sidebar
 * footer button that toggles it and the frame-wide overlay panel that hosts
 * the emulator. The store is a tiny module-level observable so the button and
 * the overlay (registered in different slots) stay in sync without prop wiring.
 */
import * as React from 'react'
import { AnatomySection } from './AnatomySection.tsx'

/** Minimal observable boolean: the viewer's open state, shared across slots. */
class OpenStore {
  private value = false
  private readonly listeners = new Set<() => void>()

  get(): boolean { return this.value }

  set(next: boolean): void {
    if (this.value === next) return
    this.value = next
    for (const l of this.listeners) l()
  }

  toggle(): void { this.set(!this.value) }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

/** Process-wide single instance (one viewer per page). */
const store = new OpenStore()

/** React hook returning the live open state. */
function useOpen(): boolean {
  return React.useSyncExternalStore(store.subscribe, () => store.get(), () => false)
}

const BTN_CSS = `
.hb3d-navbtn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:transparent;border:none;color:var(--dsh-color-text,#cfd2da);padding:8px 10px;border-radius:8px;cursor:pointer;font:13px/1.4 system-ui,sans-serif;text-align:left}
.hb3d-navbtn:hover{background:var(--dsh-color-surface-2,rgba(255,255,255,.06))}
.hb3d-navbtn.on{background:rgba(45,108,223,.22);color:#bcd6ff}
.hb3d-navbtn .ic{font-size:16px;line-height:1;flex:0 0 auto}
.hb3d-navbtn.rail{justify-content:center;padding:8px 0}
.hb3d-navbtn.rail .lb{display:none}
.hb3d-overlay{position:fixed;inset:0;z-index:60;pointer-events:auto;display:flex;align-items:stretch;justify-content:center;background:rgba(6,8,12,.55);backdrop-filter:blur(2px)}
.hb3d-sheet{margin:auto;width:min(960px,94vw);max-height:92vh;overflow:auto;background:var(--dsh-color-surface,#16171b);border:1px solid var(--dsh-color-border,#2a2c33);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.55)}
.hb3d-bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--dsh-color-surface,#16171b);border-bottom:1px solid var(--dsh-color-border,#2a2c33)}
.hb3d-bar h2{margin:0;font:600 15px/1.3 system-ui,sans-serif;color:var(--dsh-color-text,#e8e8ea)}
.hb3d-close{background:var(--dsh-color-surface-2,#22242b);border:1px solid var(--dsh-color-border,#2a2c33);color:inherit;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1}
.hb3d-close:hover{filter:brightness(1.3)}
.hb3d-body{padding:12px}
`

interface SidebarActionProps { wide?: boolean }

/** Sidebar footer button that opens/closes the Human Body 3D overlay. */
export function AnatomySidebarButton(props: SidebarActionProps): React.JSX.Element {
  const open = useOpen()
  const rail = props.wide === false
  let cls = 'hb3d-navbtn'
  if (open) cls += ' on'
  if (rail) cls += ' rail'
  return (
    <button
      className={cls}
      title="Human Body 3D"
      aria-pressed={open}
      onClick={() => store.toggle()}
    >
      <style>{BTN_CSS}</style>
      <span className="ic">🫀</span>
      <span className="lb">Human Body 3D</span>
    </button>
  )
}

/** Frame-wide overlay hosting the emulator; renders nothing while closed. */
export function AnatomyOverlay(): React.JSX.Element | null {
  const open = useOpen()
  if (!open) return null
  return (
    <div
      className="hb3d-overlay"
      role="dialog"
      aria-label="Human Body 3D"
      onClick={() => store.set(false)}
    >
      <style>{BTN_CSS}</style>
      <div className="hb3d-sheet" onClick={e => e.stopPropagation()}>
        <div className="hb3d-bar">
          <h2>🫀 Human Body 3D Emulator</h2>
          <button className="hb3d-close" title="Close" onClick={() => store.set(false)}>✕</button>
        </div>
        <div className="hb3d-body">
          <AnatomySection />
        </div>
      </div>
    </div>
  )
}
