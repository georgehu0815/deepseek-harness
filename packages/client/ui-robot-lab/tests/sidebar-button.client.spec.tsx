// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SidebarButton } from '../src/client/SidebarButton.tsx'

afterEach(cleanup)

it.each([false, true])('names the sidebar action Robot Studio when wide is %s', (wide) => {
  const open = vi.fn()
  const unusedSelector = vi.fn((): never => { throw new Error('The sidebar launcher does not read session or workspace data.') })
  const { getByRole } = render(
    <SidebarButton
      wide={wide}
      open={open}
      useSessions={unusedSelector}
      useSessionPendingInteraction={unusedSelector}
      useWorkspaces={unusedSelector}
    />,
  )
  const button = getByRole('button', { name: 'Robot Studio' })
  expect(button.title).toBe('Robot Studio')
  expect(button.textContent).toBe(wide ? '🦆Robot Studio' : '🦆')
  fireEvent.click(button)
  expect(open).toHaveBeenCalledOnce()
})
