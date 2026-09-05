import { describe, expect, it } from 'vitest'
import { Box3, BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Vector3 } from 'three'
import type { RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'
import { fitCamera, frameBounds, stageDimensions } from '../src/client/viewer-framing.ts'
import { CAMERA_VIEWS } from '../src/client/viewer-presets.ts'

import { sourceFrame } from './fixtures.client.ts'

function frame(pose: number[]): RobotFrame {
  return sourceFrame({ step: 0, time: 0, bodies: [pose] })
}

describe('recorded mesh bounds', () => {
  it('applies the recorded quaternion then converts Z-up to Y-up without editing inputs', () => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([1, 0, 0, 0, 1, 2], 3))
    const recording = frame([3, 4, 5, Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    Object.freeze(recording.bodies[0])
    Object.freeze(recording.bodies)
    Object.freeze(recording)
    const bounds = frameBounds([{ name: 'robot', geometry }], recording)
    expect(bounds.min.x).toBeCloseTo(2)
    expect(bounds.max.x).toBeCloseTo(3)
    expect(bounds.min.y).toBeCloseTo(5)
    expect(bounds.max.y).toBeCloseTo(7)
    expect(bounds.min.z).toBeCloseTo(-5)
    expect(bounds.max.z).toBeCloseTo(-4)
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([1, 0, 0, 0, 1, 2])
    geometry.dispose()
  })

  it('does not invent body poses for empty recordings or geometry-free bodies', () => {
    expect(frameBounds([], undefined).isEmpty()).toBe(true)
    expect(frameBounds([{ name: 'world', geometry: null }], frame([0, 0, 0, 1, 0, 0, 0])).isEmpty()).toBe(true)
    const geometry = new BufferGeometry()
    expect(frameBounds([{ name: 'unposed', geometry }], { ...frame([]), bodies: [] }).isEmpty()).toBe(true)
    geometry.dispose()
  })
})

describe('camera composition', () => {
  const bounds = new Box3(new Vector3(2.9, 0, -1.15), new Vector3(3.1, 0.35, -0.85))
  it.each(CAMERA_VIEWS)('fits all first-pose corners in $label for narrow and wide panels', ({ id }) => {
    for (const aspect of [0.5, 1, 2]) {
      const fit = fitCamera(bounds, aspect, id, 36)
      const camera = new PerspectiveCamera(36, aspect, fit.near, fit.far)
      camera.position.copy(fit.position)
      camera.lookAt(fit.target)
      camera.updateMatrixWorld()
      let occupied = 0
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera)
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.81)
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.81)
          expect(projected.z).toBeGreaterThan(-1)
          expect(projected.z).toBeLessThan(1)
          occupied = Math.max(occupied, Math.abs(projected.x), Math.abs(projected.y))
        }
      }
      expect(occupied).toBeGreaterThan(0.6)
      expect(camera.position.y).toBeGreaterThan(0)
    }
  })

  it('sizes the ground for recorded travel without fitting the robot to its full path', () => {
    const before = fitCamera(bounds, 1, 'perspective', 36)
    const stage = stageDimensions(bounds, [frame([3, 1, 0.15, 1, 0, 0, 0]), frame([20, 1, 0.15, 1, 0, 0, 0])])
    expect(stage.center.toArray()).toEqual([3, 0, -1])
    expect(stage.floorSize).toBeGreaterThan(34)
    expect(stage.shadowRadius).toBeLessThanOrEqual(2)
    expect(fitCamera(bounds, 1, 'perspective', 36)).toEqual(before)
  })

  it('keeps an empty stage finite without synthesizing a robot', () => {
    const fit = fitCamera(new Box3(), 1, 'perspective', 36)
    expect(fit.distance).toBeGreaterThan(0.8)
    expect(fit.target.toArray()).toEqual([0, 0, 0])
    expect(fit.position.y).toBeGreaterThan(0)
    expect(fit.position.toArray().every(Number.isFinite)).toBe(true)
    expect(fitCamera(new Box3(), 0.5, 'perspective', 36).distance).toBeGreaterThan(fit.distance)
    expect(stageDimensions(new Box3(), []).floorSize).toBe(12)
  })
})
