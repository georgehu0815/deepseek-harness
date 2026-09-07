// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry } from 'three'
import { bindClipPoseGestures } from '../src/client/clip-pose-gestures.ts'
import type { ClipPoseGestures } from '../src/client/clip-pose-gestures.ts'

function harness(axis = [0, 0, 1], body = 2) {
  const canvas = document.createElement('canvas')
  const captures = new Set<number>()
  canvas.setPointerCapture = vi.fn((id: number) => { captures.add(id) })
  canvas.hasPointerCapture = vi.fn((id: number) => captures.has(id))
  canvas.releasePointerCapture = vi.fn((id: number) => { captures.delete(id) })
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 400 } as DOMRect)
  const robot = new Group()
  robot.add(new Group(), new Group(), new Group())
  const geometry = new PlaneGeometry(2, 2)
  const material = new MeshBasicMaterial()
  robot.children[body]!.add(new Mesh(geometry, material))
  const camera = new PerspectiveCamera(45, 1, 0.01, 100)
  camera.position.z = 5
  camera.updateMatrixWorld()
  const rig = { rootBody: 1, rootPosition: [0, 0, 0], bodies: [0, 0, 1].map(parent => ({ parent, pos: [0, 0, 0], quat: [1, 0, 0, 0] })),
    joints: [{ body: 2, pos: [0, 0, 0], axis, reference: 0 }] }
  let callbacks: ClipPoseGestures = { onJointSelect: vi.fn(), onPoseDrag: vi.fn() }
  const dispose = bindClipPoseGestures(canvas, camera, robot, rig, () => callbacks)
  const emit = (type: string, x: number, y: number, extra: Partial<PointerEvent> = {}) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true,
      ...(extra.shiftKey === undefined ? {} : { shiftKey: extra.shiftKey }),
      ...(extra.button === undefined ? {} : { button: extra.button }) })
    Object.defineProperty(event, 'pointerId', { value: extra.pointerId ?? 1 })
    canvas.dispatchEvent(event)
    return event
  }
  return { canvas, emit, callbacks, captures, replace: (next: ClipPoseGestures) => { callbacks = next },
    dispose, cleanup: () => { dispose(); geometry.dispose(); material.dispose() } }
}
afterEach(() => { vi.restoreAllMocks() })

describe('canvas-local pose gestures', () => {
  it('selects real hit geometry, emits axis-geared radians, and preserves a gesture across callback changes', () => {
    const h = harness()
    try {
      const orbit = vi.fn()
      h.canvas.addEventListener('pointerdown', orbit)
      h.canvas.style.cursor = 'crosshair'
      expect(h.emit('pointerdown', 260, 220).defaultPrevented).toBe(true)
      expect(h.callbacks.onJointSelect).toHaveBeenCalledWith(0)
      expect(orbit).not.toHaveBeenCalled()
      expect(h.captures.has(1)).toBe(true)
      h.emit('pointermove', 210, 270)
      expect(h.callbacks.onPoseDrag).toHaveBeenCalledWith(0, expect.closeTo(-Math.PI / 2))
      const current = { onJointSelect: vi.fn(), onPoseDrag: vi.fn() }
      h.replace(current)
      h.emit('pointermove', 160, 220, { shiftKey: true })
      expect(current.onPoseDrag).toHaveBeenCalledWith(0, expect.closeTo(-Math.PI / 8))
      h.emit('pointerup', 160, 220)
      expect(h.captures.size).toBe(0)
      expect(h.canvas.style.cursor).toBe('crosshair')
      h.emit('pointermove', 210, 170)
      expect(current.onPoseDrag).toHaveBeenCalledTimes(1)
    } finally { h.cleanup() }
  })

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('releases only its own pointer on %s', (type) => {
    const h = harness()
    try {
      h.emit('pointerdown', 260, 220)
      h.emit('pointerdown', 260, 220, { pointerId: 2 })
      h.emit('pointermove', 210, 270, { pointerId: 2 })
      h.emit(type, 210, 270, { pointerId: 2 })
      expect(h.callbacks.onPoseDrag).not.toHaveBeenCalled()
      expect(h.captures.has(1)).toBe(true)
      if (type === 'lostpointercapture') h.captures.clear()
      h.emit(type, 210, 270)
      expect(h.captures.size).toBe(0)
    } finally { h.cleanup() }
  })

  it('ignores misses, world bodies and secondary buttons; selection-only mode permits camera gestures', () => {
    const h = harness()
    try {
      h.emit('pointerdown', 260, 220, { button: 2 })
      h.emit('pointerdown', 999, 999)
      expect(h.callbacks.onJointSelect).not.toHaveBeenCalled()
      h.replace({ onJointSelect: h.callbacks.onJointSelect })
      const orbit = vi.fn()
      h.canvas.addEventListener('pointerdown', orbit)
      h.emit('pointerdown', 260, 220)
      expect(h.callbacks.onJointSelect).toHaveBeenCalledWith(0)
      expect(orbit).toHaveBeenCalledOnce()
      expect(h.captures.size).toBe(0)
    } finally { h.cleanup() }
    const world = harness([0, 0, 1], 0)
    try {
      world.emit('pointerdown', 260, 220)
      expect(world.callbacks.onJointSelect).not.toHaveBeenCalled()
    } finally { world.cleanup() }
  })

  it('keeps the near-pivot dead zone quiet, reverses rear-facing axes and wraps screen angles', () => {
    const h = harness([0, 0, -1])
    try {
      h.emit('pointerdown', 210, 220)
      h.emit('pointermove', 160, 219)
      expect(h.callbacks.onPoseDrag).not.toHaveBeenCalled()
      h.emit('pointermove', 160, 221)
      expect(h.callbacks.onPoseDrag).toHaveBeenLastCalledWith(0, expect.closeTo(-2 * Math.atan(1 / 50)))
      h.emit('pointermove', 210, 220)
      h.emit('pointermove', 260, 220)
      expect(h.callbacks.onPoseDrag).toHaveBeenCalledTimes(1)
    } finally { h.cleanup() }
  })

  it('preserves the sign of a nearly edge-on rear-facing axis', () => {
    const h = harness([0, Math.sqrt(0.99), -0.1])
    try {
      h.emit('pointerdown', 260, 220)
      h.emit('pointermove', 210, 270)
      expect(h.callbacks.onPoseDrag).toHaveBeenCalledWith(0, expect.closeTo(Math.PI / 2 / 0.22))
    } finally { h.cleanup() }
  })

  it('selects root pitch, bounds edge-on gearing, and cancels capture and listeners on disposal', () => {
    const h = harness([0, 0, 1], 1)
    try {
      h.emit('pointerdown', 260, 220)
      h.emit('pointermove', 210, 270)
      expect(h.callbacks.onJointSelect).toHaveBeenCalledWith(-1)
      expect(h.callbacks.onPoseDrag).toHaveBeenCalledWith(-1, expect.closeTo(-Math.PI / 2 / 0.22))
      h.dispose()
      expect(h.captures.size).toBe(0)
      expect(h.canvas.style.cursor).toBe('')
      h.emit('pointerdown', 260, 220)
      h.emit('pointermove', 210, 170)
      expect(h.callbacks.onJointSelect).toHaveBeenCalledOnce()
      expect(h.callbacks.onPoseDrag).toHaveBeenCalledOnce()
    } finally { h.cleanup() }
  })
})
