/**
 * Anatomy 3D plugin, browser half. Adds a "Human Body 3D" action to the
 * sidebar foot (beside Settings); clicking it opens the interactive 3D human
 * body emulator in a frame-wide overlay panel.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (sidebar + overlay seats).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: contributes the 'shell.overlay' SlotMap entry (frame-wide layer).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AnatomySidebarButton, AnatomyOverlay } from './AnatomyLauncher.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots']

/**
 * Register the sidebar footer action and the overlay that hosts the emulator,
 * once each slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'human-body-3d',
    order: 10,
    label: () => 'Human Body 3D',
  }, AnatomySidebarButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'human-body-3d-panel',
    order: 0,
  }, AnatomyOverlay))
}
