/** Stage-owned color-buffer variants retain the merged model's topology and body order for ray picking. */
import { Color } from 'three'
import type { BufferGeometry } from 'three'
import type { RobotScene, RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import type { BodyGeometry } from './body-geometry.ts'
import { clipJointForBody } from './clip-pose-kinematics.ts'
import { clipSkinRegion, clipSkins } from './clip-skins.ts'
import type { ClipSkin, ClipSkinId, ClipSkinPalette } from './clip-skins.ts'

/** Borrowed render data; the cache, not an individual actor, owns custom geometry disposal. */
export interface ClipSkinGeometry {
  bodies: readonly BodyGeometry[]
  roughness: number
  metalness: number
}

type Region = keyof ClipSkinPalette

type ColorRange = { start: number; count: number; region: Region }

function geomRegion(geom: RobotScene['geoms'][number], region: Region): Region | null {
  // Optical elements, electronics and dark mechanical inserts retain the installed model's detail.
  if (/noenoeil|lens|xl330|np_f970|pcb|speaker/.test(geom.mat)
    || Math.max(...geom.rgba.slice(0, 3)) <= 0.33) return null
  if (/sole_|jaw|mouth|face_part|bottom_head_shell|rigidity_plate/.test(geom.mat)) return 'accent'
  if (/bearing/.test(geom.mat)) return 'joint'
  return region
}

function colorRanges(scene: RobotScene, rig: RobotSceneKinematics): ColorRange[][] {
  return scene.bodies.map((_, body) => {
    const joint = clipJointForBody(rig, body)
    const region = clipSkinRegion(joint === null || joint < 0 ? undefined : scene.jointNames[joint])
    const ranges: ColorRange[] = []
    let start = 0
    for (const geom of scene.geoms.filter(geom => geom.body === body)) {
      const count = (scene.meshes[geom.mesh] as RobotScene['meshes'][number]).v.length / 3
      const part = geomRegion(geom, region)
      if (body !== 0 && part !== null) ranges.push({ start, count, region: part })
      start += count
    }
    return ranges
  })
}

function paint(geometry: BufferGeometry, ranges: readonly ColorRange[], palette: ClipSkinPalette): BufferGeometry {
  const copy = geometry.clone()
  const colors = copy.getAttribute('color')
  for (const range of ranges) {
    const color = new Color(palette[range.region])
    for (let vertex = range.start; vertex < range.start + range.count; vertex++) colors.setXYZ(vertex, color.r, color.g, color.b)
  }
  return copy
}

/**
 * Cache only requested finishes; actors using one skin share immutable geometry, not mutable materials.
 * @param scene - the exact validated scene used to merge the source; geom order defines color-buffer ranges.
 * @param rig - that scene's kinematics, used to resolve fixed attachments to movable ancestors.
 * @param source - borrowed original geometry; neither recolored nor disposed by this cache.
 * @returns lazy per-skin lookup and idempotent disposal of every owned clone; discard the cache with its scene.
 */
export function createClipSkinGeometryCache(scene: RobotScene, rig: RobotSceneKinematics, source: readonly BodyGeometry[]) {
  const ranges = colorRanges(scene, rig)
  const original: ClipSkinGeometry = { bodies: source, roughness: 0.36, metalness: 0.16 }
  const variants = new Map<ClipSkinId, ClipSkinGeometry>()
  return {
    get(id: ClipSkinId): ClipSkinGeometry {
      if (id === 'original') return original
      const cached = variants.get(id)
      if (cached !== undefined) return cached
      const skin = clipSkins.find(skin => skin.id === id) as ClipSkin
      const bodies = source.map((body, index) => ({ name: body.name,
        geometry: body.geometry === null ? null : paint(body.geometry, ranges[index] as ColorRange[], skin.palette) }))
      const variant = { bodies, roughness: skin.roughness ?? original.roughness, metalness: skin.metalness ?? original.metalness }
      variants.set(id, variant)
      return variant
    },
    dispose(): void {
      for (const variant of variants.values()) for (const body of variant.bodies) body.geometry?.dispose()
      variants.clear()
    },
  }
}
