/** Group camera and ground measurements use recorded poses plus frozen Y-up stage offsets. */
import { Box3, Vector3 } from 'three'
import type { BodyGeometry } from './body-geometry.ts'
import type { GroupTrack } from './group-playback.ts'
import { frameBounds, stageDimensions } from './viewer-framing.ts'

/**
 * Frame all initial poses and cover each track's complete recorded travel.
 * @param bodies - shared body-local geometry, borrowed without mutation.
 * @param tracks - recordings and the stage placements captured when they were requested.
 * @returns first-pose camera bounds and ground measurements in Three.js Y-up coordinates.
 */
export function groupViewerFraming(bodies: readonly BodyGeometry[], tracks: readonly GroupTrack[]): {
  bounds: Box3
  stage: ReturnType<typeof stageDimensions>
} {
  const bounds = new Box3()
  const floor = new Box3()
  for (const { member, simulation } of tracks) {
    const initial = frameBounds(bodies, simulation.frames[0])
    const offset = new Vector3(member.x, 0, member.z)
    bounds.union(initial.clone().translate(offset))
    if (simulation.frames.length === 0) continue
    const stage = stageDimensions(initial, simulation.frames)
    const center = stage.center.add(offset)
    const half = stage.floorSize / 2
    floor.expandByPoint(new Vector3(center.x - half, 0, center.z - half))
    floor.expandByPoint(new Vector3(center.x + half, 0, center.z + half))
  }
  const stage = stageDimensions(bounds, [])
  if (!floor.isEmpty()) {
    const span = Math.max(Math.abs(floor.min.x - stage.center.x), Math.abs(floor.max.x - stage.center.x),
      Math.abs(floor.min.z - stage.center.z), Math.abs(floor.max.z - stage.center.z))
    stage.floorSize = Math.max(stage.floorSize, span * 2)
  }
  return { bounds, stage }
}
