/** Stable slot metadata snapshots for the shell's visual workspace tabs. */
import type { ClientContext, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'

/** Serializable navigation metadata; no renderer crosses the slot boundary. */
export interface VisualView { id: string; label: string }

/**
 * Read contributed views through the renderer's observable-hook adapter.
 * @param slots - the declaring shell's slot registry.
 * @returns stable snapshots until the registry revision changes.
 */
export function visualViews(slots: ClientContext['slots']): ObservableSnapshot<readonly VisualView[]> {
  let version = -1
  let snapshot: readonly VisualView[] = []
  return {
    getSnapshot: () => {
      const nextVersion = slots.getVersion('visual.workspace.view')
      if (nextVersion !== version) {
        snapshot = slots.entries('visual.workspace.view').map((entry) => {
          const id = entry.options.id
          if (id === undefined) throw new Error('Visual workspace list entry has no id')
          return { id, label: resolveSlotLabel(entry.options.label) ?? id }
        })
        version = nextVersion
      }
      return snapshot
    },
    subscribe: listener => slots.subscribe('visual.workspace.view', listener),
  }
}
