import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Vector3 } from 'three'
import type { GroupTrack } from '../src/client/group-playback.ts'
import { groupViewerFraming } from '../src/client/group-viewer-framing.ts'
import { fitCamera, frameBounds, stageDimensions } from '../src/client/viewer-framing.ts'
import { fixtureSimulation, sourceFrame } from './fixtures.client.ts'

function track(id: number, x: number, z: number, travel = 0): GroupTrack {
  return { member: { id, name: `Duck ${id}`, policyId: fixtureSimulation.policyId, projectRevisionId: null, x, z },
    simulation: { ...fixtureSimulation, frames: [sourceFrame({ time: 0, bodies: [[1, 2, 0.3, 1, 0, 0, 0]] }),
      sourceFrame({ time: 2, bodies: [[travel + 1, 2, 0.3, 1, 0, 0, 0]] })] } }
}

describe('group viewer framing', () => {
  it('unions translated initial mesh poses and fits every duck without using future travel for the camera', () => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.1, 0.2, 0.4], 3))
    const bodies = [{ name: 'body', geometry }]
    const tracks = [track(1, -3, 4, 30), track(2, 5, -2, -20)]
    const before = structuredClone(tracks)
    const { bounds, stage } = groupViewerFraming(bodies, tracks)
    expect(bounds.min.toArray()).toEqual([-2, expect.closeTo(0.3), expect.closeTo(-4.2)])
    expect(bounds.max.toArray()).toEqual([expect.closeTo(6.1), expect.closeTo(0.7), expect.closeTo(2)])
    expect(stage.center.toArray()).toEqual([expect.closeTo(2.05), 0, expect.closeTo(-1.1)])
    const stationary = tracks.map(t => ({ ...t, simulation: { ...t.simulation, frames: t.simulation.frames.slice(0, 1) } }))
    expect(groupViewerFraming(bodies, stationary).bounds).toEqual(bounds)
    expect(stage.floorSize).toBeGreaterThan(groupViewerFraming(bodies, stationary).stage.floorSize)
    for (const t of tracks) {
      const local = stageDimensions(frameBounds(bodies, t.simulation.frames[0]), t.simulation.frames)
      expect(Math.abs(local.center.x + t.member.x - stage.center.x) + local.floorSize / 2).toBeLessThanOrEqual(stage.floorSize / 2)
      expect(Math.abs(local.center.z + t.member.z - stage.center.z) + local.floorSize / 2).toBeLessThanOrEqual(stage.floorSize / 2)
    }
    for (const view of ['perspective', 'front', 'side', 'top'] as const) {
      const fit = fitCamera(bounds, 0.5, view, 36)
      const camera = new PerspectiveCamera(36, 0.5, fit.near, fit.far)
      camera.position.copy(fit.position)
      camera.lookAt(fit.target)
      camera.updateMatrixWorld()
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera)
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.81)
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.81)
        }
      }
    }
    expect(tracks).toEqual(before)
    geometry.dispose()
  })

  it('leaves missing recordings empty rather than placing invented ducks at member positions', () => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
    const empty = track(1, 100, -100)
    empty.simulation.frames = []
    const { bounds, stage } = groupViewerFraming([{ name: 'body', geometry }], [empty])
    expect(bounds.isEmpty()).toBe(true)
    expect(stage.center.toArray()).toEqual([0, 0, 0])
    expect(stage.floorSize).toBe(12)
    expect(groupViewerFraming([], [])).toEqual({ bounds, stage })
    geometry.dispose()
  })
})
