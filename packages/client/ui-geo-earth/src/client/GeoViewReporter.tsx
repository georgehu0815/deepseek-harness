/**
 * Invisible session-scoped bridge that reports the live 3D Earth camera to the
 * host. It mirrors {@link GeoCommandBridge}: a session-scoped seat so the
 * framework shares (here `sessionId`) are bound. It subscribes to
 * {@link earthController} camera-settle events and rebinds that subscription
 * whenever a viewer attaches (the controller's state subscription fires on
 * attach/detach), reporting once on each bind so on-screen bounds populate as
 * soon as a globe is mounted. Each settle is debounced (~300ms) and the current
 * {@link earthController.getViewState} is read, tagged `source: 'user'` (a
 * person moved the globe by hand), and handed to the injected `reportView`
 * callback, which appends a `geo/view` event through the host Remote. Renders
 * nothing. It calls no ctx and no RPC directly — only the injected callback
 * (client ctx discipline).
 */
import * as React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the session header utilities entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the GeoView report payload the reporter emits.
import type { GeoView } from '@deepseek-ai/dsh-geo-view/client'
import { earthController } from './earthController.ts'

/** Debounce window (ms) collapsing a burst of camera settles into one report. */
const REPORT_DEBOUNCE_MS = 300

/**
 * Props for the reporter: the session runtime share plus the injected
 * `reportView` callback threaded from apply's ctx closure. The apply-side
 * `inject(sessionId)` factory already closed over the session id, so the
 * component hands it only the view.
 */
export type GeoViewReporterProps = PropsRuntime<'conversation.session.header.utilities'> & {
  /** Append one reported view to the session through the host Remote. */
  reportView?: (view: GeoView) => void
}

/**
 * Subscribe to camera settles and report the debounced live view as `user`.
 * Renders nothing.
 * @param props - session runtime share plus the injected report callback.
 * @returns null (no visible output).
 */
export function GeoViewReporter(props: GeoViewReporterProps): React.JSX.Element | null {
  const { reportView } = props

  React.useEffect(() => {
    if (!reportView) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let cameraOff: (() => void) | undefined
    const settle = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const state = earthController.getViewState()
        if (!state) return
        const view: GeoView = { source: 'user', pose: state.pose, ...state.bbox ? { bbox: state.bbox } : {} }
        reportView(view)
      }, REPORT_DEBOUNCE_MS)
    }
    // onCameraChanged binds to the viewer that exists right now, and is a no-op
    // until one mounts. The controller's state subscription fires on viewer
    // attach/detach, so rebind the camera listener there — otherwise a reporter
    // that mounted before the globe would never report, and get_current_view
    // would keep falling back to the last commanded camera.
    const rebind = (): void => {
      cameraOff?.()
      cameraOff = earthController.onCameraChanged(settle)
      // Report the current view once on (re)bind so on-screen bounds populate as
      // soon as a viewer is available, not only after the next manual move.
      settle()
    }
    rebind()
    const stateOff = earthController.subscribe(rebind)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      cameraOff?.()
      stateOff()
    }
  }, [reportView])

  return null
}
