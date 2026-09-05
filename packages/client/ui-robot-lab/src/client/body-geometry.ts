/**
 * Body-local mesh merging adapted from Microduck Lab's Duck.tsx (Apache-2.0).
 * Modified for explicit inputs, backend material colors, and owned disposal;
 * upstream attribution and license are included in NOTICE and LICENSE.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'

/** Body-local geometry, matching the order of backend frame bodies. */
export interface BodyGeometry { name: string; geometry: BufferGeometry | null }

/**
 * Merge each body's colored geoms; callers own all returned GPU resources.
 * @param scene - backend-validated MuJoCo scene in Z-up coordinates.
 * @returns one optional geometry per body.
 */
export function buildBodyGeometries(scene: RobotScene): BodyGeometry[] {
  const meshes = scene.meshes.map((mesh) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(mesh.v, 3))
    geometry.setIndex(mesh.f)
    return geometry
  })
  const result: BodyGeometry[] = []
  try {
    for (const [body, name] of scene.bodies.entries()) {
      const parts: BufferGeometry[] = []
      try {
        for (const geom of scene.geoms.filter(item => item.body === body)) {
          const source = meshes[geom.mesh]
          if (source === undefined) throw new Error(`Missing robot mesh ${geom.mesh}`)
          const geometry = source.clone()
          parts.push(geometry)
          const quaternion = new Quaternion().fromArray(geom.quat)
          quaternion.set(quaternion.y, quaternion.z, quaternion.w, quaternion.x)
          geometry.applyMatrix4(new Matrix4().compose(
            new Vector3().fromArray(geom.pos), quaternion, new Vector3(1, 1, 1),
          ))
          const color = new Color().fromArray(geom.rgba).convertSRGBToLinear()
          const colors = new Float32Array(geometry.getAttribute('position').count * 3)
          for (let index = 0; index < colors.length; index += 3) color.toArray(colors, index)
          geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
        }
        const geometry = parts.length === 0 ? null : mergeGeometries(parts, false)
        if (parts.length > 0 && geometry === null) throw new Error(`Cannot merge robot body ${name}`)
        geometry?.computeVertexNormals()
        result.push({ name, geometry })
      } finally { for (const part of parts) part.dispose() }
    }
    return result
  } catch (error) {
    for (const body of result) body.geometry?.dispose()
    throw error
  } finally { for (const mesh of meshes) mesh.dispose() }
}
