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
import { Math as CesiumMath } from 'cesium'

interface FakeViewer {
  isDestroyed: () => boolean
  camera: { flyTo: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> }
  imageryLayers: { removeAll: ReturnType<typeof vi.fn>; addImageryProvider: ReturnType<typeof vi.fn> }
  dataSources: { add: ReturnType<typeof vi.fn> }
}

function fakeViewer(destroyed = false): FakeViewer {
  return {
    isDestroyed: () => destroyed,
    camera: { flyTo: vi.fn(), setView: vi.fn() },
    imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
    dataSources: { add: vi.fn() },
  }
}

/** The "Drawings" CustomDataSource the controller added to a fake viewer. */
function drawingsOf(viewer: FakeViewer): { entities: { values: unknown[] } } {
  const call = viewer.dataSources.add.mock.calls.at(-1)
  return call![0] as { entities: { values: unknown[] } }
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

  it('remembers the last camera target with no viewer and snaps to it on attach', () => {
    // Command a fly-to while nothing is mounted: it is a no-op now but remembered.
    earthController.flyTo({ lat: 48.85, lon: 2.35, height: 4000 })
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    // attach snaps instantly (setView), not an animated flyTo, so a reload lands at once.
    expect(viewer.camera.setView).toHaveBeenCalledTimes(1)
    expect(viewer.camera.flyTo).not.toHaveBeenCalled()
    earthController.detach(viewer as never)
  })
})

/** A camera fake whose radian inputs convert to known degrees. */
function cameraViewer(rect: { west: number; south: number; east: number; north: number } | undefined) {
  const changed = { listeners: new Set<() => void>() }
  return {
    isDestroyed: () => false,
    imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
    dataSources: { add: vi.fn() },
    camera: {
      flyTo: vi.fn(),
      setView: vi.fn(),
      positionCartographic: {
        latitude: CesiumMath.toRadians(40),
        longitude: CesiumMath.toRadians(-105),
        height: 12000,
      },
      heading: CesiumMath.toRadians(30),
      pitch: CesiumMath.toRadians(-45),
      percentageChanged: 0.5,
      changed: {
        addEventListener: (fn: () => void) => changed.listeners.add(fn),
        removeEventListener: (fn: () => void) => changed.listeners.delete(fn),
      },
      computeViewRectangle: () => rect
        ? {
          west: CesiumMath.toRadians(rect.west),
          south: CesiumMath.toRadians(rect.south),
          east: CesiumMath.toRadians(rect.east),
          north: CesiumMath.toRadians(rect.north),
        }
        : undefined,
    },
    _changed: changed,
  }
}

describe('earthController.getViewState', () => {
  it('returns undefined without a viewer', () => {
    expect(earthController.getViewState()).toBeUndefined()
  })

  it('converts the live camera pose and rectangle to degrees', () => {
    const viewer = cameraViewer({ west: -105.1, south: 39.9, east: -104.9, north: 40.1 })
    earthController.attach(viewer as never)
    const state = earthController.getViewState()
    expect(state?.pose.lat).toBeCloseTo(40, 6)
    expect(state?.pose.lon).toBeCloseTo(-105, 6)
    expect(state?.pose.height).toBe(12000)
    expect(state?.pose.heading).toBeCloseTo(30, 6)
    expect(state?.pose.pitch).toBeCloseTo(-45, 6)
    expect(state?.bbox?.west).toBeCloseTo(-105.1, 6)
    expect(state?.bbox?.south).toBeCloseTo(39.9, 6)
    expect(state?.bbox?.east).toBeCloseTo(-104.9, 6)
    expect(state?.bbox?.north).toBeCloseTo(40.1, 6)
    earthController.detach(viewer as never)
  })

  it('omits the bbox when the viewer cannot compute a rectangle', () => {
    const viewer = cameraViewer(undefined)
    earthController.attach(viewer as never)
    const state = earthController.getViewState()
    expect(state?.pose).toBeDefined()
    expect(state?.bbox).toBeUndefined()
    earthController.detach(viewer as never)
  })
})

describe('earthController.onCameraChanged', () => {
  it('registers a listener, lowers the change threshold, and unsubscribes', () => {
    const viewer = cameraViewer(undefined)
    earthController.attach(viewer as never)
    const fn = vi.fn()
    const off = earthController.onCameraChanged(fn)
    expect(viewer.camera.percentageChanged).toBe(0.01)
    viewer._changed.listeners.forEach(l => l())
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    viewer._changed.listeners.forEach(l => l())
    expect(fn).toHaveBeenCalledTimes(1)
    earthController.detach(viewer as never)
  })

  it('returns a no-op disposer without a viewer', () => {
    const off = earthController.onCameraChanged(vi.fn())
    expect(() => off()).not.toThrow()
  })

  it('skips removeEventListener when the viewer was destroyed before disposal', () => {
    let destroyed = false
    const removeEventListener = vi.fn()
    const viewer = {
      isDestroyed: () => destroyed,
      imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
      dataSources: { add: vi.fn() },
      camera: {
        flyTo: vi.fn(),
        setView: vi.fn(),
        percentageChanged: 0,
        changed: { addEventListener: vi.fn(), removeEventListener },
      },
    }
    earthController.attach(viewer as never)
    const off = earthController.onCameraChanged(vi.fn())
    destroyed = true // the viewer is torn down before the disposer runs
    off()
    expect(removeEventListener).not.toHaveBeenCalled()
    earthController.detach(viewer as never)
  })
})

describe('earthController.renderFeatures', () => {
  const point = { id: 'p1', geometry: { type: 'point', coordinates: [139.65, 35.68] }, name: 'Tokyo' } as const
  const line = { id: 'l1', geometry: { type: 'polyline', coordinates: [[0, 0], [1, 1]] } } as const
  const namedLine = { id: 'l2', geometry: { type: 'polyline', coordinates: [[0, 0], [1, 1]] }, name: 'Route' } as const
  const polygon = { id: 'g1', geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] }, name: 'Area' } as const
  const bareArea = { id: 'g2', geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] } } as const

  it('is a no-op without a viewer and rebuilds remembered features on attach', () => {
    earthController.renderFeatures([point])
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    expect(viewer.dataSources.add).toHaveBeenCalledTimes(1)
    expect(drawingsOf(viewer).entities.values.length).toBe(1)
    earthController.detach(viewer as never)
    earthController.renderFeatures([])
    earthController.setBaseMap(DEFAULT_BASE_MAP_ID)
  })

  it('renders point, polyline, and polygon each as one entity with labels only when named', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    const barePoint = { id: 'p0', geometry: { type: 'point', coordinates: [10, 20] } } as const
    earthController.renderFeatures([point, barePoint, line, namedLine, polygon, bareArea])
    const entities = drawingsOf(viewer).entities.values as Array<{
      point?: unknown
      polyline?: unknown
      polygon?: unknown
      label?: unknown
    }>
    expect(entities.length).toBe(6)
    const [e0, e1, e2, e3, e4, e5] = entities as [
      typeof entities[number], typeof entities[number], typeof entities[number],
      typeof entities[number], typeof entities[number], typeof entities[number],
    ]
    // point: named has a label, bare does not.
    expect(e0.point).toBeDefined()
    expect(e0.label).toBeDefined()
    expect(e1.point).toBeDefined()
    expect(e1.label).toBeUndefined()
    // polyline: bare has no label, named does.
    expect(e2.polyline).toBeDefined()
    expect(e2.label).toBeUndefined()
    expect(e3.polyline).toBeDefined()
    expect(e3.label).toBeDefined()
    // polygon: named has a label, bare does not.
    expect(e4.polygon).toBeDefined()
    expect(e4.label).toBeDefined()
    expect(e5.polygon).toBeDefined()
    expect(e5.label).toBeUndefined()
    earthController.detach(viewer as never)
    earthController.renderFeatures([])
  })

  it('full-reconciles and adds the data source only once across calls', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    // attach already created and added the "Drawings" source once.
    expect(viewer.dataSources.add).toHaveBeenCalledTimes(1)
    const source = drawingsOf(viewer)
    earthController.renderFeatures([point, line])
    expect(viewer.dataSources.add).toHaveBeenCalledTimes(1)
    expect(source.entities.values.length).toBe(2)
    // Second render: same source (not re-added), rebuilt from the new list.
    earthController.renderFeatures([polygon])
    expect(viewer.dataSources.add).toHaveBeenCalledTimes(1)
    expect(source.entities.values.length).toBe(1)
    earthController.detach(viewer as never)
    earthController.renderFeatures([])
  })

  it('is a no-op with a destroyed viewer', () => {
    const destroyed = fakeViewer(true)
    earthController.attach(destroyed as never)
    earthController.renderFeatures([point])
    expect(destroyed.dataSources.add).not.toHaveBeenCalled()
    earthController.detach(destroyed as never)
    earthController.renderFeatures([])
  })
})
