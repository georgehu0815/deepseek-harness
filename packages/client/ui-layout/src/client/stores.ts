/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed), plus the selected visual view. Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  VISUAL_DEFAULT, VISUAL_MAX, VISUAL_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

type LayoutState = {
  sidebar: number
  details: number
  visual: number
  visualView: string | null
  narrow: boolean
  narrowExpanded: boolean
}

type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  setVisual: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openVisual: (draft: LayoutState, viewId: string) => void
  closeVisual: (draft: LayoutState) => void
  toggleVisual: (draft: LayoutState, viewId: string) => void
}

/**
 * Create viewing preferences; close forgets width but retains visual selection.
 * @returns a root-entry store handle whose actions are the complete mutation API.
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({ sidebar: SIDEBAR_DEFAULT, details: 0, visual: 0, visualView: null, narrow: false, narrowExpanded: false }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      setVisual: (d, px: number) => { d.visual = clampWidth(px, VISUAL_MIN, VISUAL_MAX) },
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      openVisual: (d, viewId: string) => {
        d.visualView = viewId
        if (d.visual === 0) d.visual = VISUAL_DEFAULT
      },
      closeVisual: (d) => { d.visual = 0 },
      toggleVisual: (d, viewId: string) => {
        d.visual = d.visual > 0 && d.visualView === viewId ? 0 : VISUAL_DEFAULT
        d.visualView = viewId
      },
    },
  })
}
