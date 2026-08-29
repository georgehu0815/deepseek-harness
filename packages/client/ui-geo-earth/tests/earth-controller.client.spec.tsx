// @vitest-environment jsdom
/**
 * The shared globe controller's non-WebGL behavior: base-map selection with
 * fallback, observer notification, deferred-apply when no viewer is mounted,
 * and the camera/imagery calls it makes on a mounted viewer. A hand-built fake
 * viewer records the Cesium calls, so the seq-independent controller logic is
 * covered without a real WebGL context; the fly-to and imagery-provider
 * construction paths run against the real cesium module resolved in Node.
 */
import { describe, expect, it, vi } from 'vitest'
import { earthController, BASE_MAPS, DEFAULT_BASE_MAP_ID } from '../src/client/earthController.ts'

interface FakeViewer {
  isDestroyed: () => boolean
  camera: { flyTo: ReturnType<typeof vi.fn> }
  imageryLayers: { removeAll: ReturnType<typeof vi.fn>; addImageryProvider: ReturnType<typeof vi.fn> }
}

function fakeViewer(destroyed = false): FakeViewer {
  return {
    isDestroyed: () => destroyed,
    camera: { flyTo: vi.fn() },
    imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
  }
}

describe('earthController', () => {
  it('starts on the default base map', () => {
    expect(earthController.getBaseMapId()).toBe(DEFAULT_BASE_MAP_ID)
    expect(BASE_MAPS.some(b => b.id === DEFAULT_BASE_MAP_ID)).toBe(true)
  })

  it('remembers a base map with no viewer and applies it on attach', () => {
    earthController.setBaseMap('carto-dark')
    expect(earthController.getBaseMapId()).toBe('carto-dark')
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    expect(viewer.imageryLayers.removeAll).toHaveBeenCalledTimes(1)
    expect(viewer.imageryLayers.addImageryProvider).toHaveBeenCalledTimes(1)
    earthController.detach(viewer as never)
    earthController.setBaseMap(DEFAULT_BASE_MAP_ID)
  })

  it('falls back to the default preset for an unknown id', () => {
    earthController.setBaseMap('does-not-exist')
    expect(earthController.getBaseMapId()).toBe(DEFAULT_BASE_MAP_ID)
  })

  it('notifies subscribers on a base-map change and stops after unsubscribe', () => {
    const fn = vi.fn()
    const off = earthController.subscribe(fn)
    earthController.setBaseMap('carto-light')
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    earthController.setBaseMap('osm')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('applies imagery on a mounted viewer when the base map changes', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    viewer.imageryLayers.removeAll.mockClear()
    viewer.imageryLayers.addImageryProvider.mockClear()
    earthController.setBaseMap('esri-satellite')
    expect(viewer.imageryLayers.removeAll).toHaveBeenCalledTimes(1)
    expect(viewer.imageryLayers.addImageryProvider).toHaveBeenCalledTimes(1)
    earthController.detach(viewer as never)
    earthController.setBaseMap(DEFAULT_BASE_MAP_ID)
  })

  it('flies the camera on a mounted viewer', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.flyTo({ lat: 35.68, lon: 139.65, height: 500000 })
    expect(viewer.camera.flyTo).toHaveBeenCalledTimes(1)
    earthController.flyTo({ lat: 0, lon: 0 })
    expect(viewer.camera.flyTo).toHaveBeenCalledTimes(2)
    earthController.detach(viewer as never)
  })

  it('is a no-op fly-to without a viewer or with a destroyed viewer', () => {
    earthController.flyTo({ lat: 1, lon: 2 })
    const destroyed = fakeViewer(true)
    earthController.attach(destroyed as never)
    earthController.flyTo({ lat: 1, lon: 2 })
    expect(destroyed.camera.flyTo).not.toHaveBeenCalled()
    // A destroyed viewer also short-circuits imagery application.
    destroyed.imageryLayers.removeAll.mockClear()
    earthController.setBaseMap('carto-dark')
    expect(destroyed.imageryLayers.removeAll).not.toHaveBeenCalled()
    earthController.detach(destroyed as never)
    earthController.setBaseMap(DEFAULT_BASE_MAP_ID)
  })

  it('detach ignores a viewer that is not the mounted one', () => {
    const a = fakeViewer()
    const b = fakeViewer()
    earthController.attach(a as never)
    earthController.detach(b as never)
    // a is still mounted, so a fly-to still reaches it.
    earthController.flyTo({ lat: 5, lon: 6 })
    expect(a.camera.flyTo).toHaveBeenCalledTimes(1)
    earthController.detach(a as never)
  })
})
