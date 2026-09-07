import type { ViewTab } from './contract/views.ts'

const DEFAULT_VIEW_ID = 'chat'

/**
 * Identify an opted-in non-Chat View whose controls work without Conversation activity.
 * @param tab - registered View capability.
 * @returns whether its body can render on a blank Session.
 */
export function isBlankSessionView(tab: ViewTab): boolean {
  return tab.id !== DEFAULT_VIEW_ID && tab.supportsBlankSession === true
}

/**
 * Keep blank Chat as the default composer and expose only explicitly supported additional Views.
 * @param tabs - registered Views and their definition capabilities.
 * @param blank - whether this Session has no Conversation activity.
 * @returns eligible navigation entries; blank Chat itself has no View body.
 */
export function eligibleViewTabs(tabs: readonly ViewTab[], blank: boolean): readonly ViewTab[] {
  return blank ? tabs.filter(tab => tab.id === DEFAULT_VIEW_ID || isBlankSessionView(tab)) : tabs
}

/**
 * Resolve a preferred registered View, then Chat, without choosing another View.
 * @param tabs - currently registered Views.
 * @param selectedId - preferred View identity, when one is stored.
 * @returns the selected View, Chat fallback, or undefined when neither is registered.
 */
export function resolveActiveView(
  tabs: readonly ViewTab[],
  selectedId: string | null,
): ViewTab | undefined {
  const selected = selectedId === null ? undefined : tabs.find(view => view.id === selectedId)
  return selected ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}
