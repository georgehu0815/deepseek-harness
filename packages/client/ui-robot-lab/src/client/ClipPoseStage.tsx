/** Live native authoring viewport over the installed MicroDuck meshes; no policies, RPC, or hardware control. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, Quaternion, Vector3 } from 'three'
import type { Group } from 'three'
import type { RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { buildBodyGeometries } from './body-geometry.ts'
import type { BodyGeometry } from './body-geometry.ts'
import { createClipSkinGeometryCache } from './clip-skin-geometry.ts'
import type { ClipSkinId } from './clip-skins.ts'
import { Ground } from './RobotViewer.tsx'
import { ClipPoseCamera } from './ClipPoseCamera.tsx'
import { ClipDuckLabel } from './ClipDuckLabel.tsx'
import { clipDuckPositions, type ClipDuckPose } from './clip-ducks.ts'
import { createClipStageSettings } from './clip-stage-settings.ts'
import type { ClipStageSettings } from './clip-stage-settings.ts'
import { stageDimensions } from './viewer-framing.ts'
import { clipJointForBody, clipPoseBounds, clipPoseFloorOffset, clipPoseMatrices } from './clip-pose-kinematics.ts'
import { bindClipPoseGestures } from './clip-pose-gestures.ts'
import type { ClipPoseGestures } from './clip-pose-gestures.ts'
import css from './RobotLab.module.css'

/** Props for a Cordis-free primitive composed inside the Clip Gen right-hand component. */
export interface ClipPoseStageProps extends ClipPoseGestures {
  scene: RobotScene
  /** Primary actor's visual finish; omission preserves the installed model's original colors. */
  skinId?: ClipSkinId
  /** Fourteen absolute radians in scene.jointNames order. */
  joints: number[]
  rootPitch: number
  /** Optional authored heading about world +Z, in radians; omitted training references face forward. */
  rootYaw?: number
  /** Explicit native-world translation enables fixed-floor walking previews. */
  rootPosition?: number[]
  /** Root-local roll for authored body sway, not a servo target. */
  rootRoll?: number
  /** -1 selects the free-root pitch; null clears the highlight. */
  selectedJoint: number | null
  maxDpr: number
  /** Omitted settings resolve to a fresh studio/pose default. */
  settings?: ClipStageSettings
  /** Increment to refit the standing pose at the selected view and zoom; defaults to zero. */
  cameraReset?: number
  /** Suppress orbit, zoom, selection and pose dragging while recording; defaults to false. */
  cameraLocked?: boolean
  /** Enable body selection and dragging independently of orbit; defaults to true. */
  editing?: boolean
  /** Complete localized accessible name supplied by the owning UI. */
  label: string
  /** Additional controlled actors share geometry, floor, camera and capture; they are not gesture targets. */
  ensemble?: { primaryLabel: string; companions: ClipDuckPose[] }
  /** Local component-tree callback only; never put the canvas in slots, injected props, or store state. */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void
  /** Local PNG readback callback; renders the current camera synchronously and releases on unmount. */
  onCaptureReady?: (capture: (() => string) | null) => void
}

/**
 * Render authored poses with real body-local meshes and model-derived forward kinematics.
 * @param props - validated scene and controlled pose; the parent owns draft mutation and joint limits.
 * @returns native Three objects; geometry, pointer capture and canvas exposure are released on unmount.
 */
export function ClipPoseScene(props: ClipPoseStageProps) {
  const rig = props.scene.kinematics
  if (rig === undefined) throw new Error('Clip pose authoring requires scene kinematics metadata')
  const { camera, gl, scene, invalidate } = useThree()
  const defaults = useMemo(createClipStageSettings, [])
  const settings = props.settings ?? defaults
  const robot = useRef<Group>(null)
  const callbacks = useRef<ClipPoseGestures>(props)
  useLayoutEffect(() => { callbacks.current = props }, [props])
  const geometries = useMemo(() => buildBodyGeometries(props.scene), [props.scene])
  useEffect(() => () => { for (const body of geometries) body.geometry?.dispose() }, [geometries])
  const skins = useMemo(() => createClipSkinGeometryCache(props.scene, rig, geometries), [props.scene, rig, geometries])
  useEffect(() => () => { skins.dispose() }, [skins])
  const standingBounds = useMemo(() => clipPoseBounds(geometries, clipPoseMatrices(rig, props.scene.defaultJoints, 0)),
    [geometries, rig, props.scene.defaultJoints])
  const singleBounds = useMemo(() => standingBounds.isEmpty() ? standingBounds.clone()
    : standingBounds.clone().translate(new Vector3(0, -standingBounds.min.y, 0)), [standingBounds])
  const count = 1 + (props.ensemble?.companions.length ?? 0)
  const layout = useMemo(() => {
    const size = singleBounds.getSize(new Vector3())
    const positions = clipDuckPositions(count, size.length() * 1.5)
    const bounds = singleBounds.clone()
    for (const [x, z] of positions) bounds.union(singleBounds.clone().translate(new Vector3(x, 0, z)))
    if (count > 1) bounds.max.y += size.y * 0.35
    return { positions, bounds, labelHeight: singleBounds.isEmpty() ? 0 : singleBounds.max.y + size.y * 0.2, labelSize: size.y * 0.65 }
  }, [singleBounds, count])
  const stage = useMemo(() => stageDimensions(layout.bounds, []), [layout.bounds])
  const poses = useMemo(() => {
    const actors = [{ number: 1, label: props.ensemble?.primaryLabel, pose: props, skinId: props.skinId },
      ...(props.ensemble?.companions ?? [])]
    return actors.map(({ number, label, pose, skinId }) => {
      const skin = skins.get(skinId ?? 'original')
      const matrices = clipPoseMatrices(rig, pose.joints, pose.rootPitch, pose.rootYaw, pose.rootPosition, pose.rootRoll)
      const offset = pose.rootPosition === undefined ? clipPoseFloorOffset(geometries, matrices)
        : standingBounds.isEmpty() ? 0 : -standingBounds.min.y
      return { number, label, offset, roughness: skin.roughness, metalness: skin.metalness, bodies: matrices.map((matrix, index) => {
        const position = new Vector3()
        const quaternion = new Quaternion()
        matrix.decompose(position, quaternion, new Vector3())
        return { position: position.toArray(), quaternion: quaternion.toArray(), body: skin.bodies[index] as BodyGeometry }
      }) }
    })
  }, [rig, geometries, skins, props.skinId, props.joints, props.rootPitch, props.rootYaw, props.rootPosition,
    props.rootRoll, props.ensemble, standingBounds])
  useLayoutEffect(() => { invalidate() }, [poses, props.selectedJoint, invalidate])
  useEffect(() => {
    props.onCanvas?.(gl.domElement)
    return () => { props.onCanvas?.(null) }
  }, [gl, props.onCanvas])
  useEffect(() => {
    props.onCaptureReady?.(() => {
      // Read in the render's task: WebGL may clear the default drawing buffer after compositing.
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    })
    return () => { props.onCaptureReady?.(null) }
  }, [gl, scene, camera, props.onCaptureReady])
  const editing = props.editing !== false && props.cameraLocked !== true && settings.cameraMode === 'pose'
  useEffect(() => {
    if (!editing) return
    return bindClipPoseGestures(gl.domElement, camera, robot.current as Group, rig, () => callbacks.current)
  }, [gl, camera, rig, editing])
  return <>
    <color attach="background" args={[settings.background]} />
    <hemisphereLight args={['#e9f2ff', '#88939e']} intensity={1.5 * settings.lightIntensity} />
    <directionalLight position={[2, 3.5, 2]} intensity={3 * settings.lightIntensity} />
    <directionalLight position={[-2, 1.5, -2]} intensity={1.3 * settings.lightIntensity} />
    {settings.ground && <Ground surface={settings.surface} stage={stage} />}
    {settings.grid && <gridHelper args={[stage.floorSize, stage.floorSize * 10, '#536d83', '#a7b6c4']}
      position={[stage.center.x, 0.0006, stage.center.z]} />}
    {settings.axes && <axesHelper args={[0.3]} position={[0, 0.001, 0]} />}
    <ClipPoseCamera bounds={layout.bounds} reset={props.cameraReset ?? 0} locked={props.cameraLocked === true}
      cameraView={settings.cameraView} cameraMode={settings.cameraMode} cameraZoom={settings.cameraZoom} />
    {poses.map((pose, actorIndex) => <group key={pose.number} name={`clip-duck-${pose.number}`}
      position={[(layout.positions[actorIndex] as [number, number])[0], 0, (layout.positions[actorIndex] as [number, number])[1]]}>
      {pose.label !== undefined && <group position={[0, layout.labelHeight, 0]}>
        <ClipDuckLabel label={pose.label} size={layout.labelSize} />
      </group>}
      <group position={[0, pose.offset, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]} ref={actorIndex === 0 ? robot : null}>
          {pose.bodies.map(({ body, position, quaternion }, index) => <group key={index} position={position} quaternion={quaternion}>
            {index !== 0 && body.geometry !== null && <mesh geometry={body.geometry}>
              <meshStandardMaterial vertexColors wireframe={settings.wireframe} roughness={pose.roughness} metalness={pose.metalness}
                emissive={actorIndex === 0 && props.selectedJoint !== null && clipJointForBody(rig, index) === props.selectedJoint ? '#876200' : '#000000'}
                emissiveIntensity={0.22} />
            </mesh>}
          </group>)}
        </group>
      </group>
    </group>)}
  </>
}

/**
 * Mount a stage-local native canvas, exposing it only to the same component tree for recording.
 * @param props - complete localized label, scene metadata, pose and local callbacks.
 * @returns a focusable viewport; the parent must provide height and handle scenes without kinematics before mounting.
 */
export function ClipPoseStage(props: ClipPoseStageProps) {
  return <div className={css.viewport} tabIndex={0} role="region" aria-label={props.label}
    onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }) }}>
    <Canvas camera={{ position: [0.65, 0.4, 0.65], fov: 36, near: 0.001, far: 100 }}
      dpr={[1, props.maxDpr]} frameloop={props.cameraLocked === true ? 'always' : 'demand'}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
      <ClipPoseScene {...props} />
    </Canvas>
  </div>
}
