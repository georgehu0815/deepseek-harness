import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry } from 'three'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { buildBodyGeometries } from '../src/client/body-geometry.ts'
import { parseClipDraft } from '../src/client/clip-draft.ts'

const scene: RobotScene = {
  bodies: ['world', 'trunk'], meshes: [{ v: [0, 0, 0, 1, 0, 0, 0, 1, 0], f: [0, 1, 2] }],
  geoms: [{ mesh: 0, body: 1, pos: [1, 2, 3], quat: [1, 0, 0, 0], mat: 'shell', rgba: [1, 1, 1, 1] }],
  defaultJoints: Array<number>(14).fill(0), jointNames: [],
}

describe('ported body geometry', () => {
  it('preserves body order, applies local geometry transforms and disposes temporary meshes', () => {
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    const geometries = buildBodyGeometries(scene)
    expect(geometries.map(body => body.name)).toEqual(['world', 'trunk'])
    expect(geometries[0]!.geometry).toBeNull()
    expect(geometries[1]!.geometry!.getAttribute('position').getX(0)).toBe(1)
    expect(geometries[1]!.geometry!.getAttribute('position').getY(0)).toBe(2)
    expect(geometries[1]!.geometry!.getAttribute('position').getZ(0)).toBe(3)
    expect(geometries[1]!.geometry!.getAttribute('color').count).toBe(3)
    expect(dispose).toHaveBeenCalledTimes(2)
    geometries[1]!.geometry!.dispose()
    expect(dispose).toHaveBeenCalledTimes(3)
    dispose.mockRestore()
  })
})

describe('reference motion draft parsing', () => {
  it('accepts empty template input and finite fourteen-joint keyframes', () => {
    expect(parseClipDraft('')).toEqual({ clip: null, error: null })
    const clip = { version: 1, name: 'dance', duration: 2, loop: false,
      keys: [0, 2].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) }
    expect(parseClipDraft(JSON.stringify(clip))).toEqual({ clip, error: null })
  })
  it.each(['not json', '{}', '[]', '{"version":1,"name":"x","duration":1,"loop":false,"keys":[{},{}]}'])('rejects invalid draft %s', (text) => {
    expect(parseClipDraft(text).error).not.toBeNull()
  })
  it.each([
    ['null', 'Motion clip must be a JSON object.'],
    ['{}', 'Requires version 1, a name, a positive duration, a loop flag, and at least two keyframes.'],
    [JSON.stringify({ version: 1, name: 'dance', duration: 2, loop: false, keys: [null, null] }), 'Keyframe must be an object.'],
    [JSON.stringify({ version: 1, name: 'dance', duration: 2, loop: false, keys: [{}, {}] }),
      'Keyframes must start at 0 seconds and increase strictly, with 14 finite joint angles and rootPitch.'],
  ])('explains invalid reference motion in English: %s', (text, error) => {
    expect(parseClipDraft(text)).toEqual({ clip: null, error })
  })
  it('preserves Chinese user-authored clip names', () => {
    const clip = { version: 1, name: '小鸭舞蹈', duration: 2, loop: false,
      keys: [0, 2].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) }
    expect(parseClipDraft(JSON.stringify(clip))).toEqual({ clip, error: null })
  })
  it('rejects duplicate times and wrong joint counts before submission', () => {
    const clip = { version: 1, name: 'dance', duration: 2, loop: true,
      keys: [0, 0].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) }
    expect(parseClipDraft(JSON.stringify(clip)).error).not.toBeNull()
    clip.keys[1]!.t = 1
    clip.keys[1]!.joints = [0]
    expect(parseClipDraft(JSON.stringify(clip)).error).not.toBeNull()
  })
})
