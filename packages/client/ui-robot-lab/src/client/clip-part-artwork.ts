/** Compact SVG silhouettes projected from installed body meshes at the model's STAND pose. */
import { Vector3 } from 'three'
import type { Matrix4 } from 'three'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { buildBodyGeometries } from './body-geometry.ts'
import { clipJointForBody, clipPoseMatrices } from './clip-pose-kinematics.ts'

/** JSON-compatible artwork shared by every part icon for one scene. */
export interface ClipPartArtwork {
  viewBox: string
  /** Back-to-front silhouettes; joint -1 owns the trunk and its fixed attachments. */
  bodies: Array<{ body: number; joint: number | null; path: string }>
}

type Point = readonly [number, number]

function turn(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function hull(points: Point[]): Point[] {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, index, all) => {
      const previous = all[index - 1] as Point
      return index === 0 || point[0] !== previous[0] || point[1] !== previous[1]
    })
  const half = (vertices: Point[]) => {
    const result: Point[] = []
    for (const point of vertices) {
      while (result.length >= 2 && turn(result[result.length - 2] as Point, result[result.length - 1] as Point, point) <= 0) {
        result.pop()
      }
      result.push(point)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/**
 * Project actual body vertices into quarter-pixel convex silhouettes in a fixed oblique view.
 * @param scene - validated installed scene; defaultJoints supplies its STAND pose.
 * @returns reusable JSON artwork, or null without kinematics or nondegenerate body geometry.
 * All temporary geometries are disposed before return or throw.
 */
export function buildClipPartArtwork(scene: RobotScene): ClipPartArtwork | null {
  const rig = scene.kinematics
  if (rig === undefined || scene.meshes.length === 0 || scene.geoms.length === 0) return null
  const bodies = buildBodyGeometries(scene)
  try {
    const matrices = clipPoseMatrices(rig, scene.defaultJoints, 0)
    const projected: Array<{ body: number; joint: number | null; points: Point[]; depth: number }> = []
    const point = new Vector3()
    const elevation = Math.PI / 10
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const [body, { geometry }] of bodies.entries()) {
      if (body === 0 || geometry === null) continue
      const vertices = geometry.getAttribute('position')
      if (vertices.count < 3) continue
      const points: Point[] = []
      let depth = 0
      for (let index = 0; index < vertices.count; index++) {
        point.fromBufferAttribute(vertices, index).applyMatrix4(matrices[body] as Matrix4)
        const diagonal = (point.x + point.y) * Math.SQRT1_2
        const x = (point.x - point.y) * Math.SQRT1_2
        const y = diagonal * Math.sin(elevation) - point.z * Math.cos(elevation)
        points.push([x, y])
        depth += diagonal * Math.cos(elevation) + point.z * Math.sin(elevation)
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      projected.push({ body, joint: clipJointForBody(rig, body), points, depth: depth / vertices.count })
    }
    const extent = Math.max(maxX - minX, maxY - minY)
    if (!(extent > 0)) return null
    const scale = 56 / extent
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const silhouettes: ClipPartArtwork['bodies'] = []
    for (const body of projected.sort((a, b) => a.depth - b.depth || a.body - b.body)) {
      const outline = hull(body.points.map(([x, y]) => [
        Math.round((32 + (x - centerX) * scale) * 4) / 4,
        Math.round((32 + (y - centerY) * scale) * 4) / 4,
      ]))
      if (outline.length < 3) continue
      silhouettes.push({ body: body.body, joint: body.joint,
        path: `M${outline.map(([x, y]) => `${x},${y}`).join('L')}Z` })
    }
    return silhouettes.length === 0 ? null : { viewBox: '0 0 64 64', bodies: silhouettes }
  } finally { for (const body of bodies) body.geometry?.dispose() }
}
