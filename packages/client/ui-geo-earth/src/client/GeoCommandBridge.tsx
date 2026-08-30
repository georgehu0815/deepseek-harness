/**
 * Invisible session-scoped bridge: reads the `geoCommand` projection and drives
 * the shared {@link earthController} so the agent's `control_camera` / `set_basemap`
 * tool calls move the live globe. Registered into a session-scoped slot so the
 * framework `useProjection` hook is available; it re-applies a command only
 * when the projection sequence advances, so re-render or replay converges on
 * the last commanded view without re-firing intermediate moves. It also
 * reconciles the accumulated drawn features (points/lines/polygons with
 * optional text labels) into the globe whenever that set changes — separate
 * from the seq-gated one-shot command path, since `features` is whole-set
 * accumulated state, not a one-shot command.
 */
import * as React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the session header utilities entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: contributes the geoCommand key to SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-geo-command/client'
import { earthController } from './earthController.ts'

/** Props for the bridge: the session-scoped runtime share (carries useProjection). */
export type GeoBridgeProps = PropsRuntime<'conversation.session.header.utilities'>

/**
 * Apply the latest geo command to the globe whenever the projection sequence
 * advances, and reconcile the accumulated drawn features whenever that set
 * changes. Renders nothing.
 * @param props - session runtime share with the projection reader.
 * @returns null (no visible output).
 */
export function GeoCommandBridge(props: GeoBridgeProps): React.JSX.Element | null {
  const state = props.useProjection('geoCommand')
  const lastSeq = React.useRef(0)

  React.useEffect(() => {
    if (!state || state.command === null) return
    if (state.seq <= lastSeq.current) return
    lastSeq.current = state.seq
    const command = state.command
    if (command.kind === 'camera') {
      earthController.flyTo({ lat: command.lat, lon: command.lon, height: command.height })
    } else if (command.kind === 'basemap') {
      earthController.setBaseMap(command.id)
    }
  }, [state])

  React.useEffect(() => {
    earthController.renderFeatures(state?.features ?? [])
  }, [state?.features])

  return null
}
