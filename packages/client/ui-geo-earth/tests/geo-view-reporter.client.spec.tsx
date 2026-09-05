// @vitest-environment jsdom
/**
 * The invisible geo view reporter: it subscribes to earthController camera
 * settles and rebinds that subscription whenever the controller's state changes
 * (a viewer attaching), reporting once on each bind so bounds populate as soon
 * as a globe mounts. Each settle is debounced and the current view state is
 * read, tagged `source: 'user'`, and handed to the injected `reportView`
 * callback. The controller subscribe/onCameraChanged/getViewState are stubbed,
 * and the debounce timer is driven with fake timers. The component renders null
 * and calls no ctx or RPC — only the injected callback.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { earthController } from '../src/client/earthController.ts'
import { GeoViewReporter } from '../src/client/GeoViewReporter.tsx'
import type { GeoViewReporterProps } from '../src/client/GeoViewReporter.tsx'
import type { GeoView } from '@deepseek-ai/dsh-geo-view/client'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

/** Build reporter props carrying the given injected callback. */
function props(reportView?: (view: GeoView) => void): GeoViewReporterProps {
  return { reportView } as unknown as GeoViewReporterProps
}

describe('GeoViewReporter', () => {
  it('reports the debounced view as source=user after a camera settle', () => {
    let settle = (): void => {}
    const sub = vi.spyOn(earthController, 'onCameraChanged').mockImplementation((fn) => {
      settle = fn
      return () => {}
    })
    vi.spyOn(earthController, 'subscribe').mockReturnValue(() => {})
    const state = { pose: { lat: 40, lon: -105, height: 12000 }, bbox: { west: -105.1, south: 39.9, east: -104.9, north: 40.1 } }
    vi.spyOn(earthController, 'getViewState').mockReturnValue(state)
    const reportView = vi.fn()

    const { container } = render(<GeoViewReporter {...props(reportView)} />)
    expect(container.firstChild).toBeNull()

    settle()
    expect(reportView).not.toHaveBeenCalled() // still within debounce window
    vi.advanceTimersByTime(300)
    expect(reportView).toHaveBeenCalledTimes(1)
    expect(reportView).toHaveBeenCalledWith({ source: 'user', pose: state.pose, bbox: state.bbox })
    sub.mockRestore()
  })

  it('reports once on bind so bounds populate as soon as a viewer is present', () => {
    vi.spyOn(earthController, 'onCameraChanged').mockReturnValue(() => {})
    vi.spyOn(earthController, 'subscribe').mockReturnValue(() => {})
    const state = { pose: { lat: 5, lon: 6, height: 700 }, bbox: { west: 5.9, south: 4.9, east: 6.1, north: 5.1 } }
    vi.spyOn(earthController, 'getViewState').mockReturnValue(state)
    const reportView = vi.fn()

    render(<GeoViewReporter {...props(reportView)} />)
    // No manual settle: the on-bind settle alone reports after the debounce.
    vi.advanceTimersByTime(300)
    expect(reportView).toHaveBeenCalledTimes(1)
    expect(reportView).toHaveBeenCalledWith({ source: 'user', pose: state.pose, bbox: state.bbox })
  })

  it('rebinds the camera listener when the controller state changes (viewer attaches)', () => {
    const cameraDispose = vi.fn()
    let stateChange = (): void => {}
    const onCamera = vi.spyOn(earthController, 'onCameraChanged').mockReturnValue(cameraDispose)
    vi.spyOn(earthController, 'subscribe').mockImplementation((fn) => { stateChange = fn; return () => {} })
    vi.spyOn(earthController, 'getViewState').mockReturnValue({ pose: { lat: 1, lon: 2, height: 3 } })
    render(<GeoViewReporter {...props(vi.fn())} />)
    expect(onCamera).toHaveBeenCalledTimes(1) // initial bind

    stateChange() // a viewer attaches
    expect(cameraDispose).toHaveBeenCalledTimes(1) // old listener released
    expect(onCamera).toHaveBeenCalledTimes(2) // rebound to the new viewer
  })

  it('collapses a burst of settles into a single report', () => {
    let settle = (): void => {}
    vi.spyOn(earthController, 'onCameraChanged').mockImplementation((fn) => { settle = fn; return () => {} })
    vi.spyOn(earthController, 'subscribe').mockReturnValue(() => {})
    vi.spyOn(earthController, 'getViewState').mockReturnValue({ pose: { lat: 1, lon: 2, height: 3 } })
    const reportView = vi.fn()
    render(<GeoViewReporter {...props(reportView)} />)
    settle()
    vi.advanceTimersByTime(100)
    settle()
    vi.advanceTimersByTime(100)
    settle()
    vi.advanceTimersByTime(300)
    expect(reportView).toHaveBeenCalledTimes(1)
    expect(reportView).toHaveBeenCalledWith({ source: 'user', pose: { lat: 1, lon: 2, height: 3 } })
  })

  it('does not report when getViewState yields nothing', () => {
    let settle = (): void => {}
    vi.spyOn(earthController, 'onCameraChanged').mockImplementation((fn) => { settle = fn; return () => {} })
    vi.spyOn(earthController, 'subscribe').mockReturnValue(() => {})
    vi.spyOn(earthController, 'getViewState').mockReturnValue(undefined)
    const reportView = vi.fn()
    render(<GeoViewReporter {...props(reportView)} />)
    settle()
    vi.advanceTimersByTime(300)
    expect(reportView).not.toHaveBeenCalled()
  })

  it('releases the camera listener, the state subscription, and the pending timer on unmount', () => {
    const cameraDispose = vi.fn()
    const stateDispose = vi.fn()
    let settle = (): void => {}
    vi.spyOn(earthController, 'onCameraChanged').mockImplementation((fn) => { settle = fn; return cameraDispose })
    vi.spyOn(earthController, 'subscribe').mockReturnValue(stateDispose)
    vi.spyOn(earthController, 'getViewState').mockReturnValue({ pose: { lat: 1, lon: 2, height: 3 } })
    const reportView = vi.fn()
    const { unmount } = render(<GeoViewReporter {...props(reportView)} />)
    settle()
    unmount()
    expect(cameraDispose).toHaveBeenCalledTimes(1)
    expect(stateDispose).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(reportView).not.toHaveBeenCalled()
  })

  it('subscribes to nothing without an injected callback', () => {
    const sub = vi.spyOn(earthController, 'onCameraChanged')
    const stateSub = vi.spyOn(earthController, 'subscribe')
    render(<GeoViewReporter {...props(undefined)} />)
    expect(sub).not.toHaveBeenCalled()
    expect(stateSub).not.toHaveBeenCalled()
    sub.mockRestore()
  })
})
