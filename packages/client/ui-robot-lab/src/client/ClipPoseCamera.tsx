/** Pose-authoring camera with explicit recording lock and canvas-local controls. */
import { useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { MOUSE, TOUCH } from 'three'
import type { Box3, PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fitCamera } from './viewer-framing.ts'
import type { ClipStageSettings } from './clip-stage-settings.ts'

/**
 * Fit standing bounds on scene/size/view/reset changes; zoom preserves manual position and target.
 * @param props - reset refits the selected view at the current zoom; recording defers changes until unlock.
 * @returns no DOM; controls and their canvas listeners are disposed on unmount.
 */
export function ClipPoseCamera({ bounds, reset, locked, cameraView = 'perspective', cameraMode = 'pose', cameraZoom = 1 }: {
  bounds: Box3
  reset: number
  locked: boolean
  cameraView?: ClipStageSettings['cameraView']
  cameraMode?: ClipStageSettings['cameraMode']
  cameraZoom?: number
}) {
  const { camera, gl, invalidate, size } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const framed = useRef<{
    bounds: Box3
    reset: number
    width: number
    height: number
    view: ClipStageSettings['cameraView']
    zoom: number
  } | null>(null)
  useLayoutEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    controls.current = orbit
    framed.current = null
    orbit.minPolarAngle = 0.0001
    orbit.maxPolarAngle = Math.PI / 2 - 0.035
    orbit.rotateSpeed = 0.65
    orbit.zoomSpeed = 0.7
    const redraw = () => { invalidate() }
    orbit.addEventListener('change', redraw)
    return () => {
      orbit.removeEventListener('change', redraw)
      orbit.dispose()
      controls.current = null
    }
  }, [camera, gl, invalidate])
  useLayoutEffect(() => {
    const orbit = controls.current as OrbitControls
    orbit.enabled = !locked
    orbit.enablePan = cameraMode === 'pan'
    orbit.enableRotate = cameraMode !== 'pan'
    orbit.mouseButtons.LEFT = cameraMode === 'pan' ? MOUSE.PAN : MOUSE.ROTATE
    orbit.touches.ONE = cameraMode === 'pan' ? TOUCH.PAN : TOUCH.ROTATE
    orbit.touches.TWO = cameraMode === 'pan' ? TOUCH.DOLLY_PAN : TOUCH.DOLLY_ROTATE
  }, [locked, cameraMode, camera, gl, invalidate])
  useLayoutEffect(() => {
    const previous = framed.current
    if (previous !== null && locked) return
    const refit = previous === null || previous.bounds !== bounds || previous.reset !== reset
      || previous.width !== size.width || previous.height !== size.height || previous.view !== cameraView
    if (!refit && previous.zoom === cameraZoom) return
    const orbit = controls.current as OrbitControls
    const perspective = camera as PerspectiveCamera
    perspective.zoom = cameraZoom
    if (refit) {
      const fit = fitCamera(bounds, size.width / Math.max(size.height, 1), cameraView, perspective.fov)
      camera.position.copy(fit.position)
      camera.near = fit.near
      camera.far = fit.far
      orbit.target.copy(fit.target)
      orbit.minDistance = fit.size * 0.5
      orbit.maxDistance = fit.distance * 8
      orbit.update()
    }
    camera.updateProjectionMatrix()
    framed.current = { bounds, reset, width: size.width, height: size.height, view: cameraView, zoom: cameraZoom }
    invalidate()
  }, [camera, gl, invalidate, bounds, reset, locked, cameraView, cameraZoom, size.width, size.height])
  return null
}
