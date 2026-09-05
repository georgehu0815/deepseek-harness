// @vitest-environment jsdom
/**
 * The Earth 3D column header controls: the in-shell maximize toggle and the
 * browser fullscreen toggle beside it. Fullscreen is driven through stubbed
 * `requestFullscreen`/`exitFullscreen` because jsdom implements neither.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EarthColumnPanel } from '../src/client/EarthLauncher.tsx'

vi.mock('../src/client/EarthPanel.tsx', () => ({ EarthPanel: (): null => null }))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'fullscreenElement')
  document.body.classList.remove('geo3d-earth-maximized')
})

/** Install fullscreen stubs on `column` that flip `document.fullscreenElement`. */
function stubFullscreen(column: HTMLElement): { request: () => void; exit: () => void } {
  const set = (value: Element | null): void => {
    Object.defineProperty(document, 'fullscreenElement', { value, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
  }
  const request = vi.fn(async () => { set(column) })
  const exit = vi.fn(async () => { set(null) })
  column.requestFullscreen = request
  document.exitFullscreen = exit
  return { request, exit }
}

describe('EarthColumnPanel header controls', () => {
  it('toggles the in-shell maximize state', () => {
    render(<EarthColumnPanel width={420} />)
    fireEvent.click(screen.getByTitle('Maximize view'))
    expect(screen.getByTitle('Restore view').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.classList.contains('geo3d-earth-maximized')).toBe(true)
    fireEvent.click(screen.getByTitle('Restore view'))
    expect(document.body.classList.contains('geo3d-earth-maximized')).toBe(false)
  })

  it('hands the column to the browser fullscreen API and back', async () => {
    render(<EarthColumnPanel width={420} />)
    const { request, exit } = stubFullscreen(screen.getByRole('region', { name: 'Earth 3D' }))

    fireEvent.click(screen.getByTitle('Full screen'))
    expect(request).toHaveBeenCalledOnce()
    expect(screen.getByTitle('Exit full screen').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTitle('Exit full screen'))
    expect(exit).toHaveBeenCalledOnce()
    expect(screen.getByTitle('Full screen').getAttribute('aria-pressed')).toBe('false')
  })

  it('reads as not fullscreen after the column opens from closed', () => {
    const view = render(<EarthColumnPanel width={0} />)
    view.rerender(<EarthColumnPanel width={420} />)
    expect(screen.getByTitle('Full screen').getAttribute('aria-pressed')).toBe('false')
  })

  it('renders nothing while the column is closed', () => {
    const { container } = render(<EarthColumnPanel width={0} />)
    expect(container.innerHTML).toBe('')
  })
})
