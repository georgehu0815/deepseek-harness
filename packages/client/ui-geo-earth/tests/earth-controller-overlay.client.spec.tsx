// @vitest-environment jsdom
/**
 * Named overlay layers on the shared globe controller: deferred apply when no
 * viewer is mounted, full replacement per layer, independence from the agent's
 * "Drawings" layer, and removal. A hand-built fake viewer records the Cesium
 * data-source calls; entity construction runs against the real cesium module
 * resolved in Node.
 */
import { describe, expect, it, vi } from 'vitest'
import { earthController } from '../src/client/earthController.ts'
import type { OverlayItem } from '../src/client/earthController.ts'

interface FakeSource { name: string; entities: { values: unknown[] } }

interface FakeViewer {
  isDestroyed: () => boolean
  camera: { flyTo: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> }
  imageryLayers: { removeAll: ReturnType<typeof vi.fn>; addImageryProvider: ReturnType<typeof vi.fn> }
  dataSources: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
}

function fakeViewer(): FakeViewer {
  return {
    isDestroyed: () => false,
    camera: { flyTo: vi.fn(), setView: vi.fn() },
    imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
    dataSources: { add: vi.fn(), remove: vi.fn() },
  }
}

/** Every data source the controller added to a fake viewer, by name. */
function sourcesOf(viewer: FakeViewer): Map<string, FakeSource> {
  const found = new Map<string, FakeSource>()
  for (const [source] of viewer.dataSources.add.mock.calls) found.set((source as FakeSource).name, source as FakeSource)
  return found
}

const NODES: readonly OverlayItem[] = [
  { kind: 'point', id: 'n:NewYork', lon: -74.006, lat: 40.7128, color: '#ff8800', pixelSize: 12, label: 'NewYork' },
  { kind: 'point', id: 'n:Chicago', lon: -87.6298, lat: 41.8781, color: '#00aaff', pixelSize: 8 },
]

const LANE: readonly OverlayItem[] = [
  { kind: 'line', id: 'e:Chicago->NewYork', coordinates: [[-87.6298, 41.8781], [-74.006, 40.7128]], color: '#888888', width: 3 },
]

describe('earthController overlays', () => {
  it('is empty for a layer that was never set', () => {
    expect(earthController.getOverlay('never-set')).toEqual([])
  })

  it('remembers a layer with no viewer and builds it on attach', () => {
    earthController.setOverlay('supply-chain', NODES)
    expect(earthController.getOverlay('supply-chain')).toEqual(NODES)

    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    const source = sourcesOf(viewer).get('Overlay:supply-chain')
    expect(source).toBeDefined()
    expect(source!.entities.values).toHaveLength(2)

    earthController.detach(viewer as never)
    earthController.clearOverlay('supply-chain')
  })

  it('drapes a lane on the surface so it is not hidden by the globe', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.setOverlay('supply-chain', LANE)

    const source = sourcesOf(viewer).get('Overlay:supply-chain')!
    const entity = source.entities.values[0] as unknown as {
      polyline: { clampToGround: { getValue: () => boolean } }
    }
    // An un-clamped polyline sits exactly on the ellipsoid at height 0, where
    // it z-fights the globe surface and disappears at most camera angles.
    expect(entity.polyline.clampToGround.getValue()).toBe(true)

    earthController.detach(viewer as never)
    earthController.clearOverlay('supply-chain')
  })

  it('replaces a layer\'s whole contents on each set', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.setOverlay('supply-chain', NODES)
    earthController.setOverlay('supply-chain', LANE)

    const source = sourcesOf(viewer).get('Overlay:supply-chain')!
    expect(source.entities.values).toHaveLength(1)
    expect(earthController.getOverlay('supply-chain')).toEqual(LANE)

    earthController.detach(viewer as never)
    earthController.clearOverlay('supply-chain')
  })

  it('keeps separate layers independent', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.setOverlay('nodes', NODES)
    earthController.setOverlay('lanes', LANE)

    const sources = sourcesOf(viewer)
    expect(sources.get('Overlay:nodes')!.entities.values).toHaveLength(2)
    expect(sources.get('Overlay:lanes')!.entities.values).toHaveLength(1)

    earthController.detach(viewer as never)
    earthController.clearOverlay('nodes')
    earthController.clearOverlay('lanes')
  })

  it('does not disturb the agent drawings layer', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.renderFeatures([
      { id: 'f1', geometry: { type: 'point', coordinates: [1, 2] } },
    ])
    earthController.setOverlay('supply-chain', NODES)

    const sources = sourcesOf(viewer)
    expect(sources.get('Drawings')!.entities.values).toHaveLength(1)
    expect(sources.get('Overlay:supply-chain')!.entities.values).toHaveLength(2)

    earthController.detach(viewer as never)
    earthController.clearOverlay('supply-chain')
    earthController.renderFeatures([])
  })

  it('removes the layer and its data source on clear', () => {
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.setOverlay('supply-chain', NODES)
    const source = sourcesOf(viewer).get('Overlay:supply-chain')

    earthController.clearOverlay('supply-chain')
    expect(viewer.dataSources.remove).toHaveBeenCalledWith(source, true)
    expect(earthController.getOverlay('supply-chain')).toEqual([])

    earthController.detach(viewer as never)
  })

  it('drops live sources on detach so a remount rebuilds them', () => {
    const first = fakeViewer()
    earthController.attach(first as never)
    earthController.setOverlay('supply-chain', NODES)
    earthController.detach(first as never)

    const second = fakeViewer()
    earthController.attach(second as never)
    expect(sourcesOf(second).get('Overlay:supply-chain')!.entities.values).toHaveLength(2)

    earthController.detach(second as never)
    earthController.clearOverlay('supply-chain')
  })
})
