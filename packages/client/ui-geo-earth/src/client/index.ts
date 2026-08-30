/**
 * Geo Earth plugin, browser half. Adds an "Earth 3D" action to the sidebar
 * foot; clicking it opens an interactive CesiumJS globe in the shell's
 * first-class earth grid column (ui-layout's fourth track), driven through
 * ctx.layout. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (sidebar seats).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: contributes the 'earth' SlotMap entry + the ctx.layout face.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ui-conversation SlotMap merge (the session header utilities seat the bridge rides).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ctx.remote.geoView.report Remote namespace this apply calls.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the GeoView report payload the reporter emits.
import type { GeoView } from '@deepseek-ai/dsh-geo-view/client'
// Type-only: the branded session id the session-scoped inject factory receives.
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { EarthSidebarButton, EarthColumnPanel } from './EarthLauncher.tsx'
import { GeoCommandBridge } from './GeoCommandBridge.tsx'
import { GeoViewReporter } from './GeoViewReporter.tsx'
import { SummaryTable } from './SummaryTable.tsx'
import { earthController } from './earthController.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'layout', 'remote']

/**
 * Register the sidebar footer action and the earth grid-column occupant that
 * hosts the globe, plus the session-scoped command bridge that lets the agent
 * drive it. The button and the close control reach the shell's earth track
 * through ctx.layout, injected as plain callbacks.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'geo-earth-3d',
    order: 11,
    label: () => 'Earth 3D',
    inject: () => ({ toggleEarth: () => { ctx.layout.toggleEarth() } }),
  }, EarthSidebarButton))

  ctx.slots.inject('earth', () => ctx.slots.register({
    name: 'earth',
    inject: () => ({ closeEarth: () => { ctx.layout.closeEarth() } }),
  }, EarthColumnPanel))

  // Invisible per-session bridge: reads the geoCommand projection and drives
  // the globe. Rides a session-scoped seat so the useProjection hook is bound.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'geo-earth-3d-bridge',
    order: 100,
  }, GeoCommandBridge))

  // Invisible per-session reporter: on each camera settle it appends a geo/view
  // event through the host Remote so the agent reads the real on-screen camera.
  // The injected callback is the only ctx/RPC path; the component never sees ctx.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'geo-earth-3d-reporter',
    order: 101,
    inject: (sessionId: SessionId) => ({
      reportView: (view: GeoView) => {
        void ctx.remote.geoView.report(sessionId, view)
      },
    }),
  }, GeoViewReporter))

  // A "Summary" tab in the center column: a table of the session's drawn
  // features (segmentation polygons and other annotations) with type, area, and
  // location. Row hover highlights the polygon on the globe (shared controller
  // hover state); Focus flies the local globe to the feature; Export downloads
  // GeoJSON. Registers as a conversation.view tab beside Chat.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'geo-summary',
    order: 20,
    label: () => 'Summary',
    inject: () => ({
      flyTo: (lon: number, lat: number) => { earthController.flyTo({ lat, lon, height: 1500 }) },
    }),
  }, SummaryTable))
}
