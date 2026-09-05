// @vitest-environment jsdom
/**
 * The shared globe controller's hover state: getHoveredId starts null,
 * setHovered notifies subscribers and is a no-op when unchanged, and the
 * hovered feature is restyled differently from a non-hovered one when features
 * are rebuilt on a mounted viewer. The controller is a module singleton, so the
 * hover state is cleared at the end of each test to avoid leaking into siblings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { earthController } from '../src/client/earthController.ts'

interface FakeViewer {
  isDestroyed: () => boolean
  camera: { flyTo: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> }
  imageryLayers: { removeAll: ReturnType<typeof vi.fn>; addImageryProvider: ReturnType<typeof vi.fn> }
  dataSources: { add: ReturnType<typeof vi.fn> }
}

function fakeViewer(): FakeViewer {
  return {
    isDestroyed: () => false,
    camera: { flyTo: vi.fn(), setView: vi.fn() },
    imageryLayers: { removeAll: vi.fn(), addImageryProvider: vi.fn() },
    dataSources: { add: vi.fn() },
  }
}

function drawingsOf(viewer: FakeViewer): { entities: { values: unknown[] } } {
  const call = viewer.dataSources.add.mock.calls.at(-1)
  return call![0] as { entities: { values: unknown[] } }
}

afterEach(() => {
  earthController.setHovered(null)
})

describe('earthController hover state', () => {
  it('starts with no hovered id', () => {
    expect(earthController.getHoveredId()).toBeNull()
  })

  it('notifies once on change and is a no-op when the id is unchanged', () => {
    const fn = vi.fn()
    const off = earthController.subscribe(fn)
    earthController.setHovered('x')
    expect(earthController.getHoveredId()).toBe('x')
    expect(fn).toHaveBeenCalledTimes(1)
    // Same id: no notification.
    earthController.setHovered('x')
    expect(fn).toHaveBeenCalledTimes(1)
    // Clearing notifies again.
    earthController.setHovered(null)
    expect(earthController.getHoveredId()).toBeNull()
    expect(fn).toHaveBeenCalledTimes(2)
    off()
  })

  it('restyles the hovered point, polyline, and polygon differently from non-hovered', () => {
    const point = { id: 'pt', geometry: { type: 'point', coordinates: [10, 20] } } as const
    const line = { id: 'ln', geometry: { type: 'polyline', coordinates: [[0, 0], [1, 1]] } } as const
    const polygon = { id: 'pg', geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] } } as const
    const viewer = fakeViewer()
    earthController.attach(viewer as never)
    earthController.renderFeatures([point, line, polygon])
    const before = (drawingsOf(viewer).entities.values as Record<string, unknown>[]).map(o => ({ ...o }))

    earthController.setHovered('pt')
    expect(drawingsOf(viewer).entities.values[0]).not.toEqual(before[0])

    earthController.setHovered('ln')
    expect(drawingsOf(viewer).entities.values[1]).not.toEqual(before[1])

    earthController.setHovered('pg')
    expect(drawingsOf(viewer).entities.values[2]).not.toEqual(before[2])

    earthController.detach(viewer as never)
    earthController.renderFeatures([])
  })
})
