// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ClipPoseCamera } from '../src/client/ClipPoseCamera.tsx'
import { ClipPoseScene, ClipPoseStage } from '../src/client/ClipPoseStage.tsx'
import { poseFixture } from './clip-pose-fixture.ts'
import { fitCamera } from '../src/client/viewer-framing.ts'
import type { ViewerCameraView } from '../src/client/viewer-presets.ts'

const state = vi.hoisted(() => ({ current: {}, canvas: vi.fn() }))
vi.mock('@react-three/fiber', () => ({
  Canvas: (props: unknown) => { state.canvas(props); return null }, useFrame: vi.fn(), useThree: () => state.current,
}))
afterEach(() => { cleanup(); vi.restoreAllMocks(); state.canvas.mockClear() })

describe('pose-stage focus and recording lock', () => {
  it('uses localized props and the configured DPR in a focusable viewport', () => {
    render(<ClipPoseStage scene={poseFixture.scene} joints={poseFixture.scene.defaultJoints} rootPitch={0}
      selectedJoint={null} maxDpr={1.5} label="姿态预览" onJointSelect={vi.fn()} />)
    const region = screen.getByRole('region', { name: '姿态预览' })
    fireEvent.pointerDown(region)
    expect(document.activeElement).toBe(region)
    expect(state.canvas).toHaveBeenCalledWith(expect.objectContaining({ dpr: [1, 1.5], frameloop: 'demand' }))
  })

  it('refuses a recorded-only scene instead of guessing a robot skeleton', () => {
    const { kinematics: _, ...scene } = poseFixture.scene
    expect(() => ClipPoseScene({ scene, joints: scene.defaultJoints, rootPitch: 0, selectedJoint: null,
      maxDpr: 1, label: 'Pose', onJointSelect: vi.fn() })).toThrow('requires scene kinematics metadata')
  })

  it('applies presets and projection zoom, preserves manual framing, and defers settings and resize while locked', () => {
    const camera = new PerspectiveCamera(36, 1, 0.001, 100)
    const canvas = document.createElement('canvas')
    const size = { width: 500, height: 500 }
    state.current = { camera, gl: { domElement: canvas }, invalidate: vi.fn(), size }
    const bounds = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(0.1, 0.3, 0.1))
    const { rerender } = render(<ClipPoseCamera bounds={bounds} reset={0} locked={false} />)
    for (const cameraView of ['front', 'side', 'top', 'perspective'] satisfies ViewerCameraView[]) {
      rerender(<ClipPoseCamera bounds={bounds} reset={0} locked={false} cameraView={cameraView} />)
      expect(camera.position.distanceTo(fitCamera(bounds, 1, cameraView, 36).position)).toBeLessThan(0.0001)
    }
    const projection = camera.projectionMatrix.elements[0]!
    camera.position.set(1, 2, 3)
    rerender(<ClipPoseCamera bounds={bounds} reset={0} locked={false} cameraZoom={2} />)
    expect(camera.position.toArray()).toEqual([1, 2, 3])
    expect(camera.zoom).toBe(2)
    expect(camera.projectionMatrix.elements[0]).toBeCloseTo(projection * 2)
    size.width = 200
    rerender(<ClipPoseCamera bounds={bounds} reset={1} locked cameraView="front" cameraZoom={0.5} />)
    expect(camera.position.toArray()).toEqual([1, 2, 3])
    expect(camera.zoom).toBe(2)
    rerender(<ClipPoseCamera bounds={bounds} reset={1} locked={false} cameraView="front" cameraZoom={0.5} />)
    expect(camera.position.distanceTo(fitCamera(bounds, 0.4, 'front', 36).position)).toBeLessThan(1e-12)
    expect(camera.zoom).toBe(0.5)
    size.width = 500
    rerender(<ClipPoseCamera bounds={bounds} reset={1} locked={false} cameraView="front" cameraZoom={0.5} />)
    const fit = fitCamera(bounds, 1, 'front', 36)
    expect(camera.position.distanceTo(fit.position)).toBeLessThan(1e-12)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    expect(camera.position.distanceTo(fit.position)).toBeGreaterThan(0)
    rerender(<ClipPoseCamera bounds={bounds} reset={2} locked={false} cameraView="front" cameraZoom={0.5} />)
    expect(camera.position.distanceTo(fit.position)).toBeLessThan(1e-12)
    expect(camera.zoom).toBe(0.5)
  })

  it('pans with left drag without rotation, restores orbit, and blocks both while recording', () => {
    const camera = new PerspectiveCamera(36, 1, 0.001, 100)
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    Object.defineProperty(canvas, 'clientHeight', { value: 500 })
    state.current = { camera, gl: { domElement: canvas }, invalidate: vi.fn(), size: { width: 500, height: 500 } }
    const bounds = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(0.1, 0.3, 0.1))
    const drag = () => {
      for (const [type, x] of [['pointerdown', 200], ['pointermove', 250], ['pointerup', 250]] as const) {
        const event = new MouseEvent(type, { clientX: x, clientY: 200, button: 0 })
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
        canvas.dispatchEvent(event)
      }
    }
    const { rerender } = render(<ClipPoseCamera bounds={bounds} reset={0} locked={false} cameraMode="pan" />)
    const initial = camera.position.clone()
    const orientation = camera.quaternion.clone()
    drag()
    expect(camera.position.distanceTo(initial)).toBeGreaterThan(0)
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    const panned = camera.position.clone()
    rerender(<ClipPoseCamera bounds={bounds} reset={0} locked={false} cameraMode="orbit" />)
    expect(camera.position.toArray()).toEqual(panned.toArray())
    drag()
    expect(camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.01)
    rerender(<ClipPoseCamera bounds={bounds} reset={0} locked={false} cameraMode="pose" />)
    const orbited = camera.quaternion.clone()
    drag()
    expect(camera.quaternion.angleTo(orbited)).toBeGreaterThan(0.01)
    for (const cameraMode of ['pan', 'orbit', 'pose'] as const) {
      rerender(<ClipPoseCamera bounds={bounds} reset={0} locked cameraMode={cameraMode} />)
      const locked = camera.position.clone()
      drag()
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
      expect(camera.position.toArray()).toEqual(locked.toArray())
    }
  })

  it('locks real OrbitControls without moving the camera and refocuses only on reset', () => {
    const camera = new PerspectiveCamera(36, 1, 0.001, 100)
    const canvas = document.createElement('canvas')
    state.current = { camera, gl: { domElement: canvas }, invalidate: vi.fn(), size: { width: 500, height: 500 } }
    const bounds = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(0.1, 0.3, 0.1))
    const dispose = vi.spyOn(OrbitControls.prototype, 'dispose')
    const { rerender, unmount } = render(<ClipPoseCamera bounds={bounds} reset={0} locked={false} />)
    const initial = camera.position.clone()
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    const moved = camera.position.clone()
    expect(moved.distanceTo(initial)).toBeGreaterThan(0)
    rerender(<ClipPoseCamera bounds={bounds} reset={0} locked />)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    expect(camera.position.toArray()).toEqual(moved.toArray())
    rerender(<ClipPoseCamera bounds={bounds} reset={0} locked={false} />)
    expect(camera.position.toArray()).toEqual(moved.toArray())
    rerender(<ClipPoseCamera bounds={bounds} reset={1} locked={false} />)
    expect(camera.position.distanceTo(initial)).toBeLessThan(1e-12)
    unmount()
    expect(dispose).toHaveBeenCalledOnce()
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    expect(camera.position.distanceTo(initial)).toBeLessThan(1e-12)
  })
})
