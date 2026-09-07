import { describe, expect, it } from 'vitest'
import { eligibleViewTabs, isBlankSessionView, resolveActiveView } from '../src/client/view-selection.ts'
import type { ViewTab } from '../src/client/contract/views.ts'

describe('resolveActiveView', () => {
  it('keeps blank Chat navigation but excludes unsupported View bodies', () => {
    const tabs: readonly ViewTab[] = [
      { id: 'chat', label: 'Chat', supportsBlankSession: true },
      { id: 'trajectory', label: 'Trajectory' },
      { id: 'disabled', label: 'Disabled', supportsBlankSession: false },
      { id: 'studio', label: 'Studio', supportsBlankSession: true },
    ]
    const blankTabs = eligibleViewTabs(tabs, true)
    expect(blankTabs.map(tab => tab.id)).toEqual(['chat', 'studio'])
    expect(blankTabs.map(isBlankSessionView)).toEqual([false, true])
    expect(resolveActiveView(blankTabs, 'trajectory')?.id).toBe('chat')
    expect(eligibleViewTabs(tabs, false)).toBe(tabs)
  })

  it('resolves the preferred registered View and Chat fallback', () => {
    const tabs: readonly ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'custom', label: 'Custom' },
    ]

    expect(resolveActiveView(tabs, 'custom')?.id).toBe('custom')
    expect(resolveActiveView(tabs, 'removed')?.id).toBe('chat')
    expect(resolveActiveView(tabs, null)?.id).toBe('chat')
  })

  it('does not choose an arbitrary registered View', () => {
    expect(resolveActiveView([{ id: 'custom', label: 'Custom' }], null)).toBeUndefined()
  })
})
