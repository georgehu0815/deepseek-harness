// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three'
import { ClipPoseScene } from '../src/client/ClipPoseStage.tsx'
import { clipSkins } from '../src/client/clip-skins.ts'
import { createClipStageSettings } from '../src/client/clip-stage-settings.ts'
import { poseFixture } from './clip-pose-fixture.ts'
import type { ClipDuckPose } from '../src/client/clip-ducks.ts'

extend(THREE)
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function meshes(actor: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] {
  const result: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = []
  actor.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    if (mesh.isMesh && mesh.geometry.getAttribute('color') !== undefined) result.push(mesh)
  })
  return result
}

describe('actor-local skins in the real Three reconciler', () => {
  it('updates materials and buffers independently without moving actors or the camera, and restores the original finish', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D)
    const scene = { ...poseFixture.scene,
      meshes: [{ v: [0, 0, 0, 0.02, 0, 0, 0, 0.02, 0.03], f: [0, 1, 2] }],
      geoms: [1, 2].map(body => ({ body, mesh: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], rgba: [1, 0.5, 0, 1], mat: 'shell' })),
    }
    const canvas = document.createElement('canvas')
    canvas.hasPointerCapture = vi.fn(() => false)
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 400 } as DOMRect)
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl,
      frameloop: 'never', size: { width: 600, height: 400, top: 0, left: 0 }, dpr: 1 })
    const props = { scene, joints: scene.defaultJoints, rootPitch: 0, selectedJoint: -1, maxDpr: 1,
      label: 'Skinned ducks', onJointSelect: vi.fn(), settings: { ...createClipStageSettings(), ground: false } }
    const companions: ClipDuckPose[] = [
      { number: 2, label: 'Duck 2', skinId: 'candy', pose: { joints: scene.defaultJoints, rootPitch: 0 } },
      { number: 3, label: 'Duck 3', skinId: 'cyber', pose: { joints: scene.defaultJoints, rootPitch: 0.2 } },
    ]
    const ensemble = { primaryLabel: 'Duck 1', companions }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<ClipPoseScene {...props} ensemble={ensemble} />) })
      const { scene: world, camera } = store.getState()
      const ducks = [1, 2, 3].map(number => world.getObjectByName(`clip-duck-${number}`)!)
      const [first, second, third] = ducks.map(duck => meshes(duck)[0]!)
      const original = first!.geometry
      const candy = second!.geometry
      const cyber = third!.geometry
      const originalColors = original.getAttribute('color').array.slice()
      const candyColors = candy.getAttribute('color').array.slice()
      const cyberColors = cyber.getAttribute('color').array.slice()
      expect(new Set([original, candy, cyber]).size).toBe(3)
      expect(originalColors).not.toEqual(candyColors)
      expect(candyColors).not.toEqual(cyberColors)
      expect(first!.material.roughness).toBe(0.36)
      expect(second!.material.roughness).toBe(clipSkins.find(skin => skin.id === 'candy')!.roughness)
      expect(third!.material.metalness).toBe(clipSkins.find(skin => skin.id === 'cyber')!.metalness)
      expect(first!.material.emissive.getHexString()).toBe('876200')
      expect(second!.material.emissive.getHexString()).toBe('000000')
      expect(first!.material).not.toBe(second!.material)
      const transforms = ducks.map(duck => meshes(duck).map(mesh => mesh.matrixWorld.clone()))
      const cameraPosition = camera.position.clone()
      const disposed = [original, candy, cyber].map((geometry) => {
        const spy = vi.fn(); geometry.addEventListener('dispose', spy); return spy
      })
      await act(async () => { root.render(<ClipPoseScene {...props} ensemble={ensemble} skinId="candy" />) })
      expect(first!.geometry).toBe(candy)
      expect(second!.geometry).toBe(candy)
      expect(third!.geometry).toBe(cyber)
      expect(first!.material.roughness).toBe(second!.material.roughness)
      expect(first!.material).not.toBe(second!.material)
      expect(first!.material.emissive.getHexString()).toBe('876200')
      expect(second!.material.emissive.getHexString()).toBe('000000')
      expect(ducks.map(duck => meshes(duck).map(mesh => mesh.matrixWorld))).toEqual(transforms)
      expect(camera.position).toEqual(cameraPosition)
      expect(original.getAttribute('color').array).toEqual(originalColors)
      expect(candy.getAttribute('color').array).toEqual(candyColors)
      expect(cyber.getAttribute('color').array).toEqual(cyberColors)

      // The same actual triangle remains a gesture target after its color-buffer replacement.
      world.updateMatrixWorld(true); camera.updateMatrixWorld()
      const point = first!.localToWorld(new THREE.Vector3(0.02 / 3, 0.02 / 3, 0.01)).project(camera)
      const event = new MouseEvent('pointerdown', { clientX: (point.x + 1) * 300, clientY: (1 - point.y) * 200, button: 0 })
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
      canvas.dispatchEvent(event)
      expect(props.onJointSelect).toHaveBeenCalledWith(-1)

      await act(async () => { root.render(<ClipPoseScene {...props} ensemble={ensemble} skinId="original" />) })
      expect(first!.geometry).toBe(original)
      expect(first!.material.roughness).toBe(0.36)
      expect(first!.material.metalness).toBe(0.16)
      await act(async () => { root.render(<ClipPoseScene {...props} skinId="candy"
        ensemble={{ ...ensemble, companions: [{ ...companions[0]!, skinId: 'original' }] }} />) })
      expect(first!.geometry).toBe(candy)
      expect(second!.geometry).toBe(original)
      expect(world.getObjectByName('clip-duck-3')).toBeUndefined()
      for (const spy of disposed) expect(spy).not.toHaveBeenCalled()
      await act(async () => { root.render(<ClipPoseScene {...props} scene={{ ...scene }} skinId="cyber" />) })
      for (const spy of disposed) expect(spy).toHaveBeenCalledOnce()
      const replacement = meshes(world)[0]!.geometry
      const replacementDisposed = vi.fn()
      replacement.addEventListener('dispose', replacementDisposed)
      await act(async () => { root.render(null) })
      expect(replacementDisposed).toHaveBeenCalledOnce()
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })
})
