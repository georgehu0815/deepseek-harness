// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { applyProps } from '@react-three/fiber'
import { Box3, DataTexture, Group, Vector3 } from 'three'
import { Ground } from '../src/client/RobotViewer.tsx'
import { stageDimensions } from '../src/client/viewer-framing.ts'
import type { ViewerSurface } from '../src/client/viewer-presets.ts'

// Production bundles can minify independently carried Three constructors to different names.
class BundledVector3 extends Vector3 {}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ground renderer transforms', () => {
  it('supplies finite Y=0 world transforms through actual r3f prop application across Three constructors', () => {
    const stage = stageDimensions(new Box3(new Vector3(2.9, 0, -1.15), new Vector3(3.1, 0.3, -0.85)), [])
    const { result } = renderHook(() => Ground({ surface: 'studio', stage }))
    const props = result.current.props as { position: [number, number, number] }
    expect(props.position).toEqual([3, 0, -1])
    const group = new Group()
    Object.defineProperty(group, 'position', { value: new BundledVector3() })
    applyProps(group, { position: props.position })
    group.updateMatrixWorld(true)
    expect(group.matrixWorld.elements.every(Number.isFinite)).toBe(true)
    expect(group.getWorldPosition(new Vector3()).toArray()).toEqual([3, 0, -1])
    expect(stage.center.toArray()).toEqual([3, 0, -1])
  })

  it('disposes replaced ground textures and the final texture on unmount', () => {
    const dispose = vi.spyOn(DataTexture.prototype, 'dispose')
    const stage = stageDimensions(new Box3(), [])
    const { rerender, unmount } = renderHook(({ surface }: { surface: ViewerSurface }) => Ground({ surface, stage }),
      { initialProps: { surface: 'studio' as ViewerSurface } })
    expect(dispose).not.toHaveBeenCalled()
    for (const [index, surface] of (['concrete', 'sand', 'grass'] as const).entries()) {
      rerender({ surface })
      expect(dispose).toHaveBeenCalledTimes(index + 1)
    }
    unmount()
    expect(dispose).toHaveBeenCalledTimes(4)
  })
})
