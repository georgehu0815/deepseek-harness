// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { ClipPoseScene } from '../src/client/ClipPoseStage.tsx'
import { poseFixture } from './clip-pose-fixture.ts'
import { createClipStageSettings } from '../src/client/clip-stage-settings.ts'

extend(THREE)
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const scene: RobotScene = { ...poseFixture.scene,
  meshes: [{ v: [0, 0, 0, 0.02, 0, 0, 0, 0.02, 0.03], f: [0, 1, 2] }],
  geoms: [1, 2].map(body => ({ body, mesh: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [1, 0.5, 0, 1], mat: 'shell' })),
}
function coloredMeshes(world: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  world.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry.getAttribute('color') !== undefined) meshes.push(object as THREE.Mesh)
  })
  return meshes
}

describe('live pose scene in the real Three reconciler', () => {
  it('renders three independently posed ducks in one framed canvas and releases labels without disposing shared meshes', async () => {
    const text = vi.fn<CanvasRenderingContext2D['fillText']>()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), fillText: text } as unknown as CanvasRenderingContext2D)
    const canvas = document.createElement('canvas')
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 600, height: 400, top: 0, left: 0 }, dpr: 1 })
    const onCanvas = vi.fn()
    const props = { scene, joints: scene.defaultJoints, rootPitch: 0, selectedJoint: 0, maxDpr: 1,
      label: 'Authored ducks', onJointSelect: vi.fn(), onCanvas, settings: { ...createClipStageSettings(), ground: false } }
    const independent = [...scene.defaultJoints]; independent[0]! += 0.3
    const ensemble = { primaryLabel: 'Duck 1', companions: [
      { number: 2, label: 'Duck 2', pose: { joints: scene.defaultJoints, rootPitch: 0 } },
      { number: 3, label: 'Duck 3', pose: { joints: independent, rootPitch: 0 } },
    ] }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<ClipPoseScene {...props} ensemble={ensemble} />) })
      const { scene: world, camera } = store.getState()
      const ducks = [1, 2, 3].map(number => world.getObjectByName(`clip-duck-${number}`)!)
      expect(new Set(ducks.map(duck => duck.position.toArray().join(','))).size).toBe(3)
      expect(coloredMeshes(world)).toHaveLength(6)
      const [first, second, third] = ducks.map(coloredMeshes)
      expect(first![0]!.geometry).toBe(second![0]!.geometry)
      expect(first![0]!.geometry).toBe(third![0]!.geometry)
      expect(first![1]!.getWorldQuaternion(new THREE.Quaternion()).angleTo(second![1]!.getWorldQuaternion(new THREE.Quaternion())))
        .toBeCloseTo(0)
      expect(first![1]!.getWorldQuaternion(new THREE.Quaternion()).angleTo(third![1]!.getWorldQuaternion(new THREE.Quaternion())))
        .toBeCloseTo(0.3)
      expect(text.mock.calls.map(call => call[0])).toEqual(['Duck 1', 'Duck 2', 'Duck 3'])
      camera.updateMatrixWorld()
      for (const mesh of coloredMeshes(world)) {
        const projected = mesh.getWorldPosition(new THREE.Vector3()).project(camera)
        expect(Math.abs(projected.x)).toBeLessThan(1); expect(Math.abs(projected.y)).toBeLessThan(1)
      }
      const geometryDisposed = vi.fn()
      first![0]!.geometry.addEventListener('dispose', geometryDisposed)
      const label = ducks[2]!.children[0]!.children[0] as THREE.Sprite
      const labelDisposed = vi.fn()
      label.material.map!.addEventListener('dispose', labelDisposed)
      await act(async () => {
        root.render(<ClipPoseScene {...props} ensemble={{ ...ensemble, companions: ensemble.companions.slice(0, 1) }} />)
      })
      expect(world.getObjectByName('clip-duck-3')).toBeUndefined()
      expect(coloredMeshes(world)).toHaveLength(4)
      expect(labelDisposed).toHaveBeenCalledOnce()
      expect(geometryDisposed).not.toHaveBeenCalled()
      expect(onCanvas).toHaveBeenCalledTimes(1)
      await act(async () => { root.render(null) })
      expect(geometryDisposed).toHaveBeenCalledOnce()
      expect(onCanvas.mock.calls).toEqual([[canvas], [null]])
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })

  it('renders independent environment controls, preserves framing, and disposes removed helpers and textures', async () => {
    const canvas = document.createElement('canvas')
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 400, height: 400, top: 0, left: 0 }, dpr: 1 })
    const props = { scene, joints: scene.defaultJoints, rootPitch: 0, selectedJoint: null, maxDpr: 1,
      label: 'Authored pose', onJointSelect: vi.fn() }
    const settings = createClipStageSettings()
    const ground = (world: THREE.Scene) => {
      let result: THREE.Mesh | undefined
      world.traverse((object) => {
        if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry.type === 'PlaneGeometry'
          && ((object as THREE.Mesh).material as THREE.MeshStandardMaterial).map) result = object as THREE.Mesh
      })
      return result
    }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<ClipPoseScene {...props} />) })
      const { scene: world, camera } = store.getState()
      const initialTexture = (ground(world)!.material as THREE.MeshStandardMaterial).map!
      const textureDisposed = vi.fn()
      initialTexture.addEventListener('dispose', textureDisposed)
      expect(world.children.some(object => object.type === 'GridHelper')).toBe(false)
      expect(world.children.some(object => object.type === 'AxesHelper')).toBe(false)
      camera.position.set(1, 2, 3)
      await act(async () => { root.render(<ClipPoseScene {...props} settings={{ ...settings, surface: 'grass',
        grid: true, axes: true, background: '#123456', lightIntensity: 2, wireframe: true }} />) })
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      expect((world.background as THREE.Color).getHexString()).toBe('123456')
      expect(world.children.filter(object => (object as THREE.Light).isLight).map(object => (object as THREE.Light).intensity).sort())
        .toEqual([2.6, 3, 6])
      expect(coloredMeshes(world).every(mesh => (mesh.material as THREE.MeshStandardMaterial).wireframe)).toBe(true)
      expect((ground(world)!.material as THREE.MeshStandardMaterial).map).not.toBe(initialTexture)
      expect((ground(world)!.material as THREE.MeshStandardMaterial).roughness).toBe(0.98)
      expect(textureDisposed).toHaveBeenCalledOnce()
      const grid = world.children.find(object => object.type === 'GridHelper') as THREE.GridHelper
      const axes = world.children.find(object => object.type === 'AxesHelper') as THREE.AxesHelper
      expect(grid.geometry.getAttribute('position').count).toBeGreaterThan(0)
      expect(axes.geometry.getAttribute('position').count).toBe(6)
      const gridDisposed = vi.fn()
      const axesDisposed = vi.fn()
      grid.geometry.addEventListener('dispose', gridDisposed)
      axes.geometry.addEventListener('dispose', axesDisposed)
      const gridMaterialDisposed = vi.fn()
      const axesMaterialDisposed = vi.fn()
      ;(grid.material as THREE.Material).addEventListener('dispose', gridMaterialDisposed)
      ;(axes.material as THREE.Material).addEventListener('dispose', axesMaterialDisposed)
      const grassDisposed = vi.fn()
      ;(ground(world)!.material as THREE.MeshStandardMaterial).map!.addEventListener('dispose', grassDisposed)
      await act(async () => { root.render(<ClipPoseScene {...props} settings={{ ...settings, ground: false, grid: true }} />) })
      expect(ground(world)).toBeUndefined()
      expect(world.children).toContain(grid)
      expect(world.children).not.toContain(axes)
      expect(grassDisposed).toHaveBeenCalledOnce()
      await vi.waitFor(() => {
        expect(axesDisposed).toHaveBeenCalledOnce()
        expect(axesMaterialDisposed).toHaveBeenCalledOnce()
      })
      await act(async () => { root.render(<ClipPoseScene {...props} settings={{ ...settings, ground: false, axes: true }} />) })
      expect(ground(world)).toBeUndefined()
      expect(world.children).not.toContain(grid)
      expect(world.children.some(object => object.type === 'AxesHelper')).toBe(true)
      await vi.waitFor(() => {
        expect(gridDisposed).toHaveBeenCalledOnce()
        expect(gridMaterialDisposed).toHaveBeenCalledOnce()
      })
      expect(coloredMeshes(world).every(mesh => !(mesh.material as THREE.MeshStandardMaterial).wireframe)).toBe(true)
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      await act(async () => { root.render(null) })
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })

  it('updates real geometry and selection without refitting the camera, and releases canvas and geometry ownership', async () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.hasPointerCapture = vi.fn(() => false)
    canvas.releasePointerCapture = vi.fn()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect)
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 400, height: 400, top: 0, left: 0 }, dpr: 1 })
    const onCanvas = vi.fn()
    const onCaptureReady = vi.fn<(capture: (() => string) | null) => void>()
    const png = vi.spyOn(canvas, 'toDataURL').mockImplementation(() => {
      expect(gl.render).toHaveBeenCalledOnce()
      return 'data:image/png;base64,cGl4ZWxz'
    })
    const props = { scene, joints: scene.defaultJoints, rootPitch: 0, selectedJoint: null, maxDpr: 1,
      label: 'Authored pose', onJointSelect: vi.fn(), onCanvas, onCaptureReady }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<ClipPoseScene {...props} />) })
      const { camera, scene: world } = store.getState()
      const [trunk, hinge] = coloredMeshes(world)
      const geometry = trunk!.geometry
      const disposed = vi.fn()
      geometry.addEventListener('dispose', disposed)
      expect(onCanvas).toHaveBeenCalledWith(canvas)
      expect(coloredMeshes(world)).toHaveLength(2)
      camera.updateMatrixWorld()
      const point = trunk!.localToWorld(new THREE.Vector3(0.02 / 3, 0.02 / 3, 0.01)).project(camera)
      const pointer = new MouseEvent('pointerdown', { clientX: (point.x + 1) * 200, clientY: (1 - point.y) * 200, button: 0 })
      Object.defineProperties(pointer, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
      canvas.dispatchEvent(pointer)
      expect(props.onJointSelect).toHaveBeenCalled()
      for (const cameraMode of ['orbit', 'pan', 'pose'] as const) {
        await act(async () => { root.render(<ClipPoseScene {...props} cameraLocked={cameraMode === 'pose'}
          settings={{ ...createClipStageSettings(), cameraMode }} />) })
        props.onJointSelect.mockClear()
        canvas.dispatchEvent(pointer)
        expect(props.onJointSelect).not.toHaveBeenCalled()
      }
      await act(async () => { root.render(<ClipPoseScene {...props} />) })
      canvas.dispatchEvent(pointer)
      expect(props.onJointSelect).toHaveBeenCalled()
      const hingeBefore = hinge!.getWorldQuaternion(new THREE.Quaternion()).clone()
      camera.position.set(1, 2, 3)
      const joints = [...props.joints]
      joints[0] = joints[0]! + 0.3
      await act(async () => { root.render(<ClipPoseScene {...props} joints={joints} selectedJoint={0} />) })
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      gl.render.mockClear()
      expect(onCaptureReady.mock.calls[0]![0]!()).toBe('data:image/png;base64,cGl4ZWxz')
      expect(gl.render).toHaveBeenCalledWith(world, camera)
      expect(png).toHaveBeenCalledWith('image/png')
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      expect(hingeBefore.angleTo(hinge!.getWorldQuaternion(new THREE.Quaternion()))).toBeCloseTo(0.3)
      expect((hinge!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('876200')
      expect((trunk!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('000000')
      expect(coloredMeshes(world)[0]!.geometry).toBe(geometry)
      expect(disposed).not.toHaveBeenCalled()
      await act(async () => { root.render(<ClipPoseScene {...props} rootPitch={0.4} selectedJoint={-1} />) })
      expect((trunk!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('876200')
      expect(onCanvas).toHaveBeenCalledTimes(1)
      const beforeHeading = trunk!.getWorldQuaternion(new THREE.Quaternion())
      await act(async () => { root.render(<ClipPoseScene {...props} rootPitch={0.4} rootYaw={Math.PI / 2} />) })
      expect(beforeHeading.angleTo(trunk!.getWorldQuaternion(new THREE.Quaternion()))).toBeCloseTo(Math.PI / 2)
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      expect(coloredMeshes(world)[0]!.geometry).toBe(geometry)
      expect(onCanvas).toHaveBeenCalledTimes(1)
      await act(async () => { root.render(<ClipPoseScene {...props} />) })
      const standingPosition = trunk!.getWorldPosition(new THREE.Vector3())
      const rootPosition = [...scene.kinematics!.rootPosition]
      rootPosition[2]! += 0.02
      await act(async () => { root.render(<ClipPoseScene {...props} rootPosition={rootPosition} rootRoll={0.1} />) })
      expect(trunk!.getWorldPosition(new THREE.Vector3()).y - standingPosition.y).toBeCloseTo(0.02)
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      const before = structuredClone(scene)
      await act(async () => { root.render(<ClipPoseScene {...props} scene={{ ...scene }} />) })
      expect(disposed).toHaveBeenCalledOnce()
      const replacement = coloredMeshes(world)[0]!.geometry
      const disposedReplacement = vi.fn()
      replacement.addEventListener('dispose', disposedReplacement)
      await act(async () => { root.render(<ClipPoseScene {...props} scene={poseFixture.scene} editing={false} />) })
      expect(coloredMeshes(world)).toHaveLength(0)
      props.onJointSelect.mockClear()
      canvas.dispatchEvent(pointer)
      expect(props.onJointSelect).not.toHaveBeenCalled()
      await act(async () => { root.render(null) })
      expect(onCanvas.mock.calls).toEqual([[canvas], [null]])
      expect(onCaptureReady.mock.calls).toEqual([[expect.any(Function)], [null]])
      expect(disposedReplacement).toHaveBeenCalledOnce()
      expect(scene).toEqual(before)
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })
})
