import { describe, expect, it, vi } from 'vitest'
import { Color } from 'three'
import type { BufferGeometry } from 'three'
import { buildBodyGeometries } from '../src/client/body-geometry.ts'
import { createClipSkinGeometryCache } from '../src/client/clip-skin-geometry.ts'
import { clipSkinRegion, clipSkins } from '../src/client/clip-skins.ts'
import { clipJointForBody, clipPoseMatrices } from '../src/client/clip-pose-kinematics.ts'
import { clipPartScene } from './clip-part-fixture.ts'

function rgb(geometry: BufferGeometry, vertex = 0): number[] {
  const colors = geometry.getAttribute('color')
  return [colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)]
}
function expectColor(geometry: BufferGeometry, hex: string, vertex = 0): void {
  const expected = new Color(hex).toArray()
  rgb(geometry, vertex).forEach((value, index) => { expect(value).toBeCloseTo(expected[index]!, 6) })
}

describe('MicroDuck skin catalog and owned geometry', () => {
  it('defines ten complete, distinct coordinated palettes and maps every installed joint semantically', () => {
    const scene = clipPartScene()
    expect(clipSkins.map(skin => skin.id)).toEqual(['velocity', 'varsity', 'weekend', 'sakura', 'candy',
      'punk', 'cyber', 'explorer', 'nautical', 'disco'])
    expect(new Set(clipSkins.map(skin => JSON.stringify(skin.palette))).size).toBe(10)
    for (const skin of clipSkins) {
      expect(Object.keys(skin.palette).sort()).toEqual(['accent', 'foot', 'head', 'hip', 'joint', 'neck', 'shin', 'thigh', 'torso'])
      for (const color of Object.values(skin.palette)) expect(color).toMatch(/^#[a-f0-9]{6}$/)
      expect(new Set(Object.values(skin.palette)).size).toBeGreaterThanOrEqual(5)
      expect(skin.roughness).toBeGreaterThan(0); expect(skin.roughness).toBeLessThan(1)
      expect(skin.metalness).toBeGreaterThan(0); expect(skin.metalness).toBeLessThan(1)
    }
    expect(scene.jointNames.map(clipSkinRegion)).toEqual(['joint', 'hip', 'thigh', 'shin', 'foot',
      'neck', 'neck', 'joint', 'head', 'joint', 'hip', 'thigh', 'shin', 'foot'])
    expect(clipSkinRegion(undefined)).toBe('torso')
  })

  it('colors all fourteen driven bodies and fixed attachments without changing topology, source bytes or kinematics', () => {
    const scene = clipPartScene()
    const rig = scene.kinematics!
    scene.bodies.push('fixed-trim')
    rig.bodies.push({ parent: 10, pos: [0, 0, 0], quat: [1, 0, 0, 0] })
    scene.geoms.push({ ...scene.geoms[0]!, body: 16 })
    const sourceScene = structuredClone(scene)
    const source = buildBodyGeometries(scene)
    const cache = createClipSkinGeometryCache(scene, rig, source)
    const originalColors = source.map(body => body.geometry?.getAttribute('color').array.slice())
    const matrices = clipPoseMatrices(rig, scene.defaultJoints, 0.2)
    try {
      for (const skin of clipSkins) {
        const variant = cache.get(skin.id)
        expect(variant.bodies[0]!.geometry).toBeNull()
        for (let body = 1; body < source.length; body++) {
          const geometry = variant.bodies[body]!.geometry!
          const original = source[body]!.geometry!
          const joint = clipJointForBody(rig, body)!
          expectColor(geometry, skin.palette[clipSkinRegion(joint < 0 ? undefined : scene.jointNames[joint])])
          expect(geometry).not.toBe(original)
          for (const attribute of ['position', 'normal']) {
            expect(geometry.getAttribute(attribute).array).toEqual(original.getAttribute(attribute).array)
            expect(geometry.getAttribute(attribute).array).not.toBe(original.getAttribute(attribute).array)
          }
          expect(geometry.index!.array).toEqual(original.index!.array)
          expect(variant.bodies[body]!.name).toBe(source[body]!.name)
        }
        expect(variant.roughness).toBe(skin.roughness)
        expect(variant.metalness).toBe(skin.metalness)
      }
      expect(source.map(body => body.geometry?.getAttribute('color').array)).toEqual(originalColors)
      expect(scene).toEqual(sourceScene)
      expect(clipPoseMatrices(rig, scene.defaultJoints, 0.2)).toEqual(matrices)
      expect(clipJointForBody(rig, 16)).toBe(8)
    } finally { cache.dispose(); for (const body of source) body.geometry?.dispose() }
  })

  it('preserves real optical and dark mechanical colors while coordinating existing trim and bearing parts', () => {
    const scene = clipPartScene()
    // Material ids and source RGB come from the installed robot_walk.xml, not body-name heuristics.
    const materials: Array<[string, number[]]> = [
      ['top_head_shell_material', [0.851, 0.851, 0.8392, 1]],
      ['noenoeil_material', [0.9569, 0.6863, 0.1373, 1]],
      ['lens_material', [0.2627, 0.2824, 0.302, 1]],
      ['xl330_material', [0.2863, 0.2863, 0.2863, 1]],
      ['np_f970_material', [0.302, 0.302, 0.302, 1]],
      ['elec_rpi_robot_hat_pcb_material', [0.3137, 0.4863, 0.4118, 1]],
      ['speaker_material', [0.2941, 0.2902, 0.2902, 1]],
      ['motor_support_material', [0.1294, 0.1529, 0.1294, 1]],
      ['bottom_head_shell_material', [1, 0.4039, 0.1216, 1]],
      ['soft_mouth_top_material', [0.851, 0.7569, 0.8667, 1]],
      ['sole_left_material', [0.9569, 0.6863, 0.1373, 1]],
      ['upper_leg_rigidity_plate_material', [0.6745, 0.6392, 0.6039, 1]],
      ['seeed_bearing__configuration_default_material', [0.8118, 0.8588, 0.898, 1]],
    ]
    scene.geoms = materials.map(([mat, rgba]) => ({ ...scene.geoms[0]!, body: 10, mat, rgba }))
    const source = buildBodyGeometries(scene)
    const cache = createClipSkinGeometryCache(scene, scene.kinematics!, source)
    try {
      const skin = clipSkins[0]!
      const original = source[10]!.geometry!
      const geometry = cache.get(skin.id).bodies[10]!.geometry!
      const stride = scene.meshes[0]!.v.length / 3
      expectColor(geometry, skin.palette.head)
      for (let part = 1; part <= 7; part++) expect(rgb(geometry, part * stride)).toEqual(rgb(original, part * stride))
      for (let part = 8; part <= 11; part++) expectColor(geometry, skin.palette.accent, part * stride)
      expectColor(geometry, skin.palette.joint, 12 * stride)
    } finally { cache.dispose(); for (const body of source) body.geometry?.dispose() }
  })

  it('keeps original identity and independent actor selections, caches requested skins and disposes only owned variants', () => {
    const scene = clipPartScene()
    const source = buildBodyGeometries(scene)
    const cache = createClipSkinGeometryCache(scene, scene.kinematics!, source)
    const originalDisposed = vi.fn()
    source[1]!.geometry!.addEventListener('dispose', originalDisposed)
    try {
      const original = cache.get('original')
      expect(original.bodies).toBe(source)
      expect(original.roughness).toBe(0.36); expect(original.metalness).toBe(0.16)
      const first = cache.get('candy')
      const second = cache.get('cyber')
      const firstColors = first.bodies[1]!.geometry!.getAttribute('color').array.slice()
      const firstDisposed = vi.fn(); const secondDisposed = vi.fn()
      first.bodies[1]!.geometry!.addEventListener('dispose', firstDisposed)
      second.bodies[1]!.geometry!.addEventListener('dispose', secondDisposed)
      expect(first.bodies[1]!.geometry).not.toBe(second.bodies[1]!.geometry)
      expect(firstColors).not.toEqual(second.bodies[1]!.geometry!.getAttribute('color').array)
      expect(cache.get('candy')).toBe(first)
      expect(cache.get('original')).toBe(original)
      expect(cache.get('cyber')).toBe(second)
      expect(first.bodies[1]!.geometry!.getAttribute('color').array).toEqual(firstColors)
      expect(firstDisposed).not.toHaveBeenCalled()
      cache.dispose(); cache.dispose()
      expect(firstDisposed).toHaveBeenCalledOnce(); expect(secondDisposed).toHaveBeenCalledOnce()
      expect(originalDisposed).not.toHaveBeenCalled()
    } finally { cache.dispose(); for (const body of source) body.geometry?.dispose() }
  })
})
