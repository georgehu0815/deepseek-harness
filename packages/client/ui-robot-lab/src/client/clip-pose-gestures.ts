/** Canvas-scoped hinge dragging adapted from Microduck Lab PoseDuck.tsx (Apache-2.0; see NOTICE). */
import { Raycaster, Vector2, Vector3 } from 'three'
import type { Camera, Group, Object3D } from 'three'
import type { RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import { clipJointForBody } from './clip-pose-kinematics.ts'

/** Component-local callbacks; deltas are radians and the editor owns limits and draft mutation. */
export interface ClipPoseGestures {
  onJointSelect: (index: number) => void
  onPoseDrag?: (index: number, deltaRad: number) => void
}

/**
 * Select real mesh bodies and capture hinge gestures before OrbitControls receives them.
 * @param canvas - this stage's canvas, never a document-wide event target.
 * @param camera - the stage camera, used for raycasting and projected hinge gearing.
 * @param robot - Z-up group whose ordered children correspond to the model's bodies.
 * @param rig - validated local hinge axes and pivots.
 * @param callbacks - current component callbacks; identity changes do not interrupt a drag.
 * @returns a disposer that cancels capture, restores the cursor, and removes every listener.
 */
export function bindClipPoseGestures(canvas: HTMLCanvasElement, camera: Camera, robot: Group,
  rig: RobotSceneKinematics, callbacks: () => ClipPoseGestures): () => void {
  const raycaster = new Raycaster()
  let drag: { pointer: number; joint: number; body: number; angle: number | null; cursor: string } | null = null
  const screenHinge = (body: number, joint: number, event: PointerEvent) => {
    const object = robot.children[body] as Object3D
    object.updateWorldMatrix(true, false)
    const hinge = joint === -1 ? { pos: [0, 0, 0], axis: [0, 1, 0] }
      : rig.joints[joint] as RobotSceneKinematics['joints'][number]
    const pivot = new Vector3().fromArray(hinge.pos).applyMatrix4(object.matrixWorld).project(camera)
    const axis = new Vector3().fromArray(hinge.axis).transformDirection(object.matrixWorld)
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left - (pivot.x + 1) * rect.width / 2
    const y = event.clientY - rect.top - (1 - pivot.y) * rect.height / 2
    const facing = axis.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion))
    return { angle: Math.hypot(x, y) < 18 ? null : Math.atan2(y, x),
      gearing: Math.abs(facing) < 0.22 ? (facing < 0 ? -0.22 : 0.22) : facing }
  }
  const stop = () => {
    if (drag === null) return
    const { pointer, cursor } = drag
    drag = null
    canvas.style.cursor = cursor
    if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag !== null) return
    const rect = canvas.getBoundingClientRect()
    camera.updateMatrixWorld()
    robot.updateWorldMatrix(true, true)
    raycaster.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2), camera)
    const hit = raycaster.intersectObjects(robot.children, true)[0]
    if (hit === undefined) return
    const body = robot.children.indexOf(hit.object.parent as Object3D)
    const joint = clipJointForBody(rig, body)
    if (joint === null) return
    if (callbacks().onPoseDrag !== undefined) {
      const driver = joint === -1 ? rig.rootBody : (rig.joints[joint] as RobotSceneKinematics['joints'][number]).body
      drag = { pointer: event.pointerId, joint, body: driver, angle: screenHinge(driver, joint, event).angle, cursor: canvas.style.cursor }
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    callbacks().onJointSelect(joint)
  }
  const move = (event: PointerEvent) => {
    if (drag === null || drag.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    const { angle, gearing } = screenHinge(drag.body, drag.joint, event)
    const previous = drag.angle
    drag.angle = angle
    if (angle !== null && previous !== null) {
      const difference = angle - previous
      const delta = -Math.atan2(Math.sin(difference), Math.cos(difference)) / gearing
      callbacks().onPoseDrag?.(drag.joint, delta * (event.shiftKey ? 0.25 : 1))
    }
  }
  const up = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    stop()
  }
  canvas.addEventListener('pointerdown', down, true)
  canvas.addEventListener('pointermove', move, true)
  canvas.addEventListener('pointerup', up, true)
  canvas.addEventListener('pointercancel', up, true)
  canvas.addEventListener('lostpointercapture', up, true)
  return () => {
    canvas.removeEventListener('pointerdown', down, true)
    canvas.removeEventListener('pointermove', move, true)
    canvas.removeEventListener('pointerup', up, true)
    canvas.removeEventListener('pointercancel', up, true)
    canvas.removeEventListener('lostpointercapture', up, true)
    stop()
  }
}
