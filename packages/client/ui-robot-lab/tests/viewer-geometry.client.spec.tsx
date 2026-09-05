// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot, extend } from '@react-three/fiber'
import type { LocalState, ThreeEvent } from '@react-three/fiber'
import type { GroupTrack } from '../src/client/group-playback.ts'
import * as THREE from 'three'
import type { RobotPolicyId, RobotScene, RobotSimulation } from '@deepseek-ai/dsh-robot-lab/types'
import { Studio } from '../src/client/RobotViewer.tsx'
import { fixturePhysics, sourceFrame } from './fixtures.client.ts'

extend(THREE)
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const scene: RobotScene = {
  bodies: ['body'], meshes: [{ v: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0.2], f: [0, 1, 2] }],
  geoms: [{ mesh: 0, body: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], mat: 'shell', rgba: [1, 0.5, 0, 1] }],
  defaultJoints: [], jointNames: [],
}
const recording: RobotSimulation = {
  mode: 'recorded-simulation', policyId: 'policy' as RobotPolicyId, policyHash: 'first', observationProfile: 'microduck-standard-61',
  controlHz: 50, physics: fixturePhysics, bamSettings: {},
  frames: [sourceFrame({ step: 0, time: 0, bodies: [[0, 0, 0, 1, 0, 0, 0]] })],
}

function robotGeometry(world: THREE.Scene): THREE.BufferGeometry {
  let result: THREE.BufferGeometry | undefined
  world.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && mesh.geometry.getAttribute('color') !== undefined) result = mesh.geometry
  })
  if (result === undefined) throw new Error('The real reconciler did not attach the robot geometry.')
  return result
}

describe('owned robot geometry in the real r3f reconciler', () => {
  it('renders independent group tracks with Y-up offsets, duck selection and one shared geometry owner', async () => {
    const canvas = document.createElement('canvas')
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 400, height: 400, top: 0, left: 0 }, dpr: 1 })
    const tracks: GroupTrack[] = [
      { member: { id: 1, name: 'First', policyId: recording.policyId, projectRevisionId: null, x: -2, z: 3 },
        simulation: { ...recording, frames: [sourceFrame({ time: 0, bodies: [[1, 2, 0.4, 1, 0, 0, 0]] }),
          sourceFrame({ time: 2, bodies: [[3, 4, 0.5, 1, 0, 0, 0]] })] } },
      { member: { id: 2, name: 'Second', policyId: recording.policyId, projectRevisionId: null, x: 5, z: -1 },
        simulation: { ...recording, frames: [sourceFrame({ time: 0, bodies: [[0, 1, 0.2, 1, 0, 0, 0]] }),
          sourceFrame({ time: 1, bodies: [[2, 3, 0.3, 1, 0, 0, 0]] })] } },
    ]
    const before = structuredClone(tracks)
    let time = 0
    const readTime = vi.fn(() => time)
    const onDuckSelect = vi.fn()
    const onBodySelect = vi.fn()
    const props = { scene, frames: recording.frames, groupTracks: tracks, playing: false, time: 0, readTime,
      selectedBody: 0, selectedDuck: 2, onDuckSelect, onBodySelect, onHidden: vi.fn(),
      surface: 'studio' as const, cameraView: 'perspective' as const, cameraReset: 0 }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<Studio {...props} />) })
      const state = store.getState()
      const robotMeshes = () => {
        const meshes: THREE.Mesh[] = []
        state.scene.traverseVisible((object) => {
          if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry.getAttribute('color') !== undefined) meshes.push(object as THREE.Mesh)
        })
        return meshes
      }
      const [first, second] = robotMeshes()
      expect(robotMeshes()).toHaveLength(2)
      expect(first!.geometry).toBe(second!.geometry)
      const dispose = vi.fn()
      first!.geometry.addEventListener('dispose', dispose)
      const worldPosition = (mesh: THREE.Mesh) => mesh.getWorldPosition(new THREE.Vector3()).toArray()
      await act(async () => { state.advance(1, true) })
      expect(readTime).toHaveBeenCalledOnce()
      expect(worldPosition(first!)).toEqual([-1, expect.closeTo(0.4), expect.closeTo(1)])
      expect(worldPosition(second!)).toEqual([5, expect.closeTo(0.2), expect.closeTo(-2)])
      time = 1.5
      await act(async () => { state.advance(99, true) })
      expect(worldPosition(first!)).toEqual([-1, expect.closeTo(0.4), expect.closeTo(1)])
      expect(worldPosition(second!)).toEqual([7, expect.closeTo(0.3), expect.closeTo(-4)])
      time = 2
      await act(async () => { state.advance(100, true) })
      expect(worldPosition(first!)).toEqual([1, expect.closeTo(0.5), expect.closeTo(-1)])
      expect((first!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('000000')
      expect((second!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('876200')
      // Invoke the real reconciler's registered raycast handler without requiring GPU rasterization.
      const click = (first as THREE.Mesh & { __r3f: LocalState }).__r3f.handlers.onClick!
      const stopPropagation = vi.fn()
      click({ stopPropagation } as unknown as ThreeEvent<MouseEvent>)
      expect(stopPropagation).toHaveBeenCalledOnce()
      expect(onDuckSelect).toHaveBeenCalledWith(1)
      expect(onBodySelect).toHaveBeenCalledWith(0)
      await act(async () => { root.render(<Studio {...props} selectedDuck={1} />) })
      expect((first!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('876200')
      expect((second!.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('000000')
      await act(async () => { root.render(<Studio {...props} groupTracks={[tracks[1]!]} />) })
      expect(robotMeshes()).toHaveLength(1)
      expect(robotMeshes()[0]!.geometry).toBe(first!.geometry)
      expect(dispose).not.toHaveBeenCalled()
      await act(async () => { root.render(<Studio {...props} groupTracks={[{ ...tracks[1]!,
        simulation: { ...recording, frames: [sourceFrame({ bodies: [] })] } }]} />) })
      await act(async () => { state.advance(101, true) })
      expect(robotMeshes()).toHaveLength(0)
      await act(async () => { root.render(<Studio {...props} groupTracks={[{ ...tracks[1]!,
        simulation: { ...recording, frames: [] } }]} />) })
      expect(robotMeshes()).toHaveLength(0)
      await act(async () => { root.render(<Studio {...props} groupTracks={[]} />) })
      expect(robotMeshes()).toHaveLength(0)
      expect(dispose).not.toHaveBeenCalled()
      expect(tracks).toEqual(before)
      await act(async () => { root.render(null) })
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })

  it('samples the shared clock instead of render deltas and pauses when the rendered column has no size', async () => {
    const canvas = document.createElement('canvas')
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 400, height: 400, top: 0, left: 0 }, dpr: 1 })
    let time = 0
    const onHidden = vi.fn()
    const props = { scene, frames: [sourceFrame({ time: 0, bodies: [[1, 0, 0, 1, 0, 0, 0]] }),
      sourceFrame({ time: 2, bodies: [[3, 0, 0, 1, 0, 0, 0]] })], playing: false, time: 0, readTime: () => time,
    selectedBody: null, onBodySelect: vi.fn(), onHidden,
    surface: 'studio' as const, cameraView: 'perspective' as const, cameraReset: 0 }
    try {
      let store!: ReturnType<typeof root.render>
      await act(async () => { store = root.render(<Studio {...props} scene={null} frames={[]} />) })
      const visibleMeshes = () => {
        const meshes: THREE.Mesh[] = []
        store.getState().scene.traverseVisible((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh) })
        return meshes
      }
      expect(visibleMeshes().length).toBeGreaterThan(0)
      expect(visibleMeshes().some(mesh => mesh.geometry.getAttribute('color') !== undefined)).toBe(false)
      await act(async () => { root.render(<Studio {...props} frames={[]} />) })
      expect(visibleMeshes().some(mesh => mesh.geometry.getAttribute('color') !== undefined)).toBe(false)
      await act(async () => { store = root.render(<Studio {...props} />) })
      expect(visibleMeshes().some(mesh => mesh.geometry.getAttribute('color') !== undefined)).toBe(true)
      const state = store.getState()
      let robot: THREE.Object3D | undefined
      state.scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry.getAttribute('color') !== undefined) robot = object.parent!
      })
      await act(async () => { state.advance(1, true) })
      expect(robot!.position.x).toBe(1)
      time = 2
      await act(async () => { state.advance(100, true) })
      expect(robot!.position.x).toBe(3)
      time = 0.5
      await act(async () => { state.advance(200, true) })
      expect(robot!.position.x).toBe(1)
      expect(onHidden).not.toHaveBeenCalled()
      await act(async () => { state.setSize(0, 400) })
      expect(onHidden).toHaveBeenCalledOnce()
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })

  it('preserves dispose methods, borrows geometry across replay changes and disposes each scene exactly once', async () => {
    const canvas = document.createElement('canvas')
    // Only rasterization is omitted; the real reconciler creates, attaches, replaces and removes Three objects.
    const gl = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn() }
    const root = createRoot(canvas)
    root.configure({ gl, frameloop: 'never', size: { width: 400, height: 400, top: 0, left: 0 }, dpr: 1 })
    const props = { scene, frames: recording.frames, playing: false, time: 0, readTime: () => 0,
      selectedBody: null, onBodySelect: vi.fn(), onHidden: vi.fn(),
      surface: 'studio' as const, cameraView: 'perspective' as const, cameraReset: 0 }
    let world: THREE.Scene | undefined
    try {
      await act(async () => { world = root.render(<Studio {...props} />).getState().scene })
      const first = robotGeometry(world!)
      const disposedFirst = vi.fn()
      first.addEventListener('dispose', disposedFirst)
      expect(typeof first.dispose).toBe('function')
      await act(async () => { root.render(<Studio {...props} frames={[...recording.frames]} />) })
      expect(robotGeometry(world!)).toBe(first)
      expect(disposedFirst).not.toHaveBeenCalled()

      await act(async () => { root.render(<Studio {...props} scene={{ ...scene }} />) })
      const second = robotGeometry(world!)
      const disposedSecond = vi.fn()
      second.addEventListener('dispose', disposedSecond)
      expect(second).not.toBe(first)
      expect(typeof second.dispose).toBe('function')
      expect(disposedFirst).toHaveBeenCalledTimes(1)

      await act(async () => { root.render(<Studio key="another-policy" {...props} />) })
      const third = robotGeometry(world!)
      const disposedThird = vi.fn()
      third.addEventListener('dispose', disposedThird)
      expect(typeof third.dispose).toBe('function')
      expect(disposedSecond).toHaveBeenCalledTimes(1)
      await act(async () => { root.render(null) })
      expect(disposedFirst).toHaveBeenCalledTimes(1)
      expect(disposedSecond).toHaveBeenCalledTimes(1)
      expect(disposedThird).toHaveBeenCalledTimes(1)
    } finally {
      vi.useFakeTimers()
      await act(async () => { root.unmount() })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
  })
})
