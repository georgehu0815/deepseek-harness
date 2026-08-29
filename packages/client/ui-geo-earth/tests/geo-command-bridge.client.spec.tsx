// @vitest-environment jsdom
/**
 * The invisible geo command bridge: it applies the latest geoCommand projection
 * to the shared earthController only when the projection sequence advances, so a
 * re-render with the same value fires nothing and replay converges on the last
 * commanded view. The controller methods are spied; the bridge renders null.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { earthController } from '../src/client/earthController.ts'
import { GeoCommandBridge } from '../src/client/GeoCommandBridge.tsx'
import type { GeoBridgeProps } from '../src/client/GeoCommandBridge.tsx'

afterEach(cleanup)

/** Build bridge props whose useProjection returns the given geoCommand value. */
function props(value: unknown): GeoBridgeProps {
  return { useProjection: () => value } as unknown as GeoBridgeProps
}

describe('GeoCommandBridge', () => {
  it('flies the camera when a camera command first appears', () => {
    const fly = vi.spyOn(earthController, 'flyTo').mockImplementation(() => {})
    const { container } = render(
      <GeoCommandBridge {...props({ seq: 1, command: { kind: 'camera', lat: 35.68, lon: 139.65, height: 500000 } })} />,
    )
    expect(container.firstChild).toBeNull()
    expect(fly).toHaveBeenCalledWith({ lat: 35.68, lon: 139.65, height: 500000 })
    fly.mockRestore()
  })

  it('switches the base map when a basemap command first appears', () => {
    const set = vi.spyOn(earthController, 'setBaseMap').mockImplementation(() => {})
    render(<GeoCommandBridge {...props({ seq: 1, command: { kind: 'basemap', id: 'esri-satellite' } })} />)
    expect(set).toHaveBeenCalledWith('esri-satellite')
    set.mockRestore()
  })

  it('does nothing before the first command or with a null command', () => {
    const fly = vi.spyOn(earthController, 'flyTo').mockImplementation(() => {})
    const set = vi.spyOn(earthController, 'setBaseMap').mockImplementation(() => {})
    render(<GeoCommandBridge {...props({ seq: 0, command: null })} />)
    render(<GeoCommandBridge {...props(undefined)} />)
    expect(fly).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    fly.mockRestore()
    set.mockRestore()
  })

  it('re-applies only when the sequence advances', () => {
    const fly = vi.spyOn(earthController, 'flyTo').mockImplementation(() => {})
    const cmd = { kind: 'camera', lat: 1, lon: 2, height: 3 }
    const { rerender } = render(<GeoCommandBridge {...props({ seq: 5, command: cmd })} />)
    expect(fly).toHaveBeenCalledTimes(1)
    // Same seq on re-render: no re-fire.
    rerender(<GeoCommandBridge {...props({ seq: 5, command: cmd })} />)
    expect(fly).toHaveBeenCalledTimes(1)
    // Advanced seq: fires again.
    rerender(<GeoCommandBridge {...props({ seq: 6, command: { kind: 'camera', lat: 7, lon: 8, height: 9 } })} />)
    expect(fly).toHaveBeenCalledTimes(2)
    fly.mockRestore()
  })
})
