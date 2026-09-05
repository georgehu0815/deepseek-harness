// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CameraControls } from '../src/client/RobotViewer.tsx'

const state = vi.hoisted(() => ({ current: {} }))
vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: vi.fn(), useThree: () => state.current }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('viewport camera lifecycle', () => {
  it('preserves manual framing on unrelated renders, and refits on reset, view, or new bounds', () => {
    const camera = new PerspectiveCamera(36, 1, 0.001, 100)
    const canvas = document.createElement('canvas')
    const invalidate = vi.fn()
    state.current = { camera, gl: { domElement: canvas }, invalidate, size: { width: 500, height: 500 } }
    const bounds = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(0.1, 0.3, 0.1))
    const { rerender } = render(<CameraControls bounds={bounds} cameraView="perspective" cameraReset={0} />)
    const original = camera.position.clone()
    camera.position.set(1, 2, 3)
    rerender(<CameraControls bounds={bounds} cameraView="perspective" cameraReset={0} />)
    expect(camera.position.toArray()).toEqual([1, 2, 3])
    rerender(<CameraControls bounds={bounds} cameraView="perspective" cameraReset={1} />)
    expect(camera.position.distanceTo(original)).toBeLessThan(1e-10)
    rerender(<CameraControls bounds={bounds} cameraView="top" cameraReset={1} />)
    expect(camera.position.x).toBeCloseTo(0)
    expect(camera.position.y).toBeGreaterThan(original.y)
    const translated = bounds.clone().translate(new Vector3(3, 0, 0))
    rerender(<CameraControls bounds={translated} cameraView="front" cameraReset={1} />)
    expect(camera.position.x).toBeGreaterThan(3)
    expect(invalidate).toHaveBeenCalled()
  })

  it('disposes the actual OrbitControls and never registers a window keyboard listener', () => {
    const dispose = vi.spyOn(OrbitControls.prototype, 'dispose')
    const addWindow = vi.spyOn(window, 'addEventListener')
    state.current = { camera: new PerspectiveCamera(36), gl: { domElement: document.createElement('canvas') },
      invalidate: vi.fn(), size: { width: 300, height: 400 } }
    const { unmount } = render(<CameraControls bounds={new Box3()} cameraView="side" cameraReset={0} />)
    expect(addWindow.mock.calls.filter(([type]) => type === 'keydown')).toEqual([])
    unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
