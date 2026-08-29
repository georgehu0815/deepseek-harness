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
import { EarthSidebarButton, EarthColumnPanel } from './EarthLauncher.tsx'
import { GeoCommandBridge } from './GeoCommandBridge.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'layout']

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
}
