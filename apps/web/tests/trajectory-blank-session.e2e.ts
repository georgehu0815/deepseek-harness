// @vitest-environment jsdom
/** Blank-session navigation through the built Web plugin graph and fixture transport. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('offers Trajectory before the first message without changing the Chat default', async () => {
  mountAssembledApp()
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  await within(tree).findByRole('treeitem', { name: 'New Session', selected: true })

  const chat = await screen.findByRole('tab', { name: 'Chat', selected: true })
  const trajectory = screen.getByRole('tab', { name: 'Trajectory', selected: false })
  fireEvent.click(trajectory)
  expect(await screen.findByRole('toolbar', { name: 'Trajectory toolbar' })).toBeTruthy()
  expect(screen.getByText('No timing data')).toBeTruthy()
  expect(trajectory.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('[data-composer-input]')).toBeTruthy()

  fireEvent.click(chat)
  expect(chat.getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByRole('toolbar', { name: 'Trajectory toolbar' })).toBeNull()

  const history = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(history)
  await waitFor(() => { expect(history.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true') })
  const start = within(tree).getByRole('button', { name: 'New session in fixture', hidden: true })
  fireEvent.click(start)
  await within(tree).findByRole('treeitem', { name: 'New Session', selected: true })
  await screen.findByRole('tab', { name: 'Chat', selected: true })
  fireEvent.click(screen.getByRole('tab', { name: 'Trajectory' }))
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'Trajectory', selected: true })).toBeTruthy()
    expect(screen.getByText('No timing data')).toBeTruthy()
  })
})
