/** Native, viewport-scoped Three.js studio for recorded MuJoCo motion; never sends motor commands. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, Object3D } from 'three'
import type { Box3, Group, PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { RobotScene, RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'
import { buildBodyGeometries } from './body-geometry.ts'
import type { BodyGeometry } from './body-geometry.ts'
import { playbackFrame } from './playback-frame.ts'
import { fitCamera, frameBounds, stageDimensions } from './viewer-framing.ts'
import { groupViewerFraming } from './group-viewer-framing.ts'
import type { GroupTrack } from './group-playback.ts'
import type { ViewerCameraView, ViewerSurface } from './viewer-presets.ts'
import { createSurfaceTexture } from './viewer-surface.ts'
import css from './RobotLab.module.css'

interface PlaybackProps {
  scene: RobotScene | null
  frames: RobotFrame[]
  /** When supplied, only these frozen recordings are rendered; frames remains the single-duck input. */
  groupTracks?: GroupTrack[]
  selectedDuck?: number | null
  onDuckSelect?: (id: number) => void
  playing: boolean
  time: number
  readTime: () => number
  selectedBody: number | null
  onBodySelect: (index: number) => void
  onHidden: () => void
}

interface ViewProps {
  surface: ViewerSurface
  cameraView: ViewerCameraView
  cameraReset: number
}

/**
 * Own canvas-local orbit controls and reframe on explicit camera inputs.
 * @param props - first-pose bounds, selected direction and reset revision.
 * @returns no DOM; all listeners are removed on unmount.
 */
export function CameraControls({ bounds, cameraView, cameraReset }: { bounds: Box3; cameraView: ViewerCameraView; cameraReset: number }) {
  const { camera, gl, invalidate, size } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useLayoutEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    controls.current = orbit
    orbit.enablePan = false
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
    const orbit = controls.current
    if (orbit === null) throw new Error('Camera controls must be mounted before framing.')
    // Canvas explicitly owns a perspective camera; resizing may require a new fit.
    const perspective = camera as PerspectiveCamera
    const fit = fitCamera(bounds, size.width / Math.max(size.height, 1), cameraView, perspective.fov)
    camera.position.copy(fit.position)
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    orbit.target.copy(fit.target)
    orbit.minDistance = fit.size * 0.5
    orbit.maxDistance = fit.distance * 8
    orbit.update()
    invalidate()
  }, [camera, bounds, cameraView, cameraReset, size.width, size.height, gl, invalidate])
  return null
}

function Playback({ geometries, frames, playing, time, readTime, selectedBody, onBodySelect, onHidden }: Omit<PlaybackProps, 'scene'> & { geometries: BodyGeometry[] }) {
  const bodies = useRef<Array<Group | null>>([])
  const { invalidate, size } = useThree()
  useLayoutEffect(() => { invalidate() }, [frames, time, playing, invalidate])
  useEffect(() => { if (size.width === 0 || size.height === 0) onHidden() }, [size.width, size.height, onHidden])
  useFrame(() => {
    if (playing) invalidate()
    const frame = playbackFrame(frames, readTime())
    if (frame === undefined) return
    for (const [index, body] of bodies.current.entries()) {
      if (body === null) continue
      const pose = frame.bodies[index]
      body.visible = pose !== undefined
      if (pose === undefined) continue
      body.position.fromArray(pose)
      const quaternion = body.quaternion.fromArray(pose, 3)
      quaternion.set(quaternion.y, quaternion.z, quaternion.w, quaternion.x)
    }
  })
  return <group rotation={[-Math.PI / 2, 0, 0]} visible={frames.length > 0}>
    {geometries.map((body, index) => <group key={body.name} visible={frames[0]?.bodies[index] !== undefined}
      ref={(value) => { bodies.current[index] = value }}>
      {body.geometry !== null && <mesh geometry={body.geometry} castShadow receiveShadow
        onClick={(event) => { event.stopPropagation(); onBodySelect(index) }}>
        <meshStandardMaterial vertexColors roughness={0.36} metalness={0.16} emissive={selectedBody === index ? '#876200' : '#000000'} emissiveIntensity={0.22} />
      </mesh>}
    </group>)}
  </group>
}

/**
 * Render flat ground with owned textures and constructor-independent transform props.
 * @param props - selected appearance and recorded stage measurements in meters.
 * @returns the Y=0 ground and optional half-meter studio ruler.
 */
export function Ground({ surface, stage }: { surface: ViewerSurface; stage: ReturnType<typeof stageDimensions> }) {
  const texture = useMemo(() => createSurfaceTexture(surface), [surface])
  useLayoutEffect(() => { texture.repeat.setScalar(stage.floorSize * 2) }, [texture, stage.floorSize])
  useEffect(() => () => { texture.dispose() }, [texture])
  // r3f v8 may carry another Three build; Vector3 props can fail its constructor identity check.
  return <group position={[stage.center.x, 0, stage.center.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[stage.floorSize, stage.floorSize]} />
      <meshStandardMaterial map={texture} roughness={surface === 'studio' ? 0.82 : 0.98} metalness={0} />
    </mesh>
    {/* A half-meter ruler, offset from the robot, stays flat above the ground to avoid z-fighting. */}
    {surface === 'studio' && <group position={[0, 0.0004, 0.45]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 0.003]} /><meshBasicMaterial color="#536d83" toneMapped={false} />
      </mesh>
      {[-0.25, -0.15, -0.05, 0.05, 0.15, 0.25].map(x => <mesh key={x} position={[x, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.002, 0.018]} /><meshBasicMaterial color="#536d83" toneMapped={false} />
      </mesh>)}
    </group>}
  </group>
}

/**
 * Show ground without scene assets or frames; own and dispose merged robot geometry when assets arrive.
 * @param props - recorded data and visual controls; meshes borrow shared geometry owned by this studio.
 * @returns the native scene; merged geometry is disposed on replacement or unmount.
 */
export function Studio(props: PlaybackProps & ViewProps) {
  const groupTime = useRef(props.time)
  useFrame(() => { if (props.groupTracks !== undefined) groupTime.current = props.readTime() }, -1)
  const geometries = useMemo(() => props.scene === null ? [] : buildBodyGeometries(props.scene), [props.scene])
  useEffect(() => () => { for (const body of geometries) body.geometry?.dispose() }, [geometries])
  const { bounds, stage } = useMemo(() => {
    if (props.groupTracks !== undefined) return groupViewerFraming(geometries, props.groupTracks)
    const bounds = frameBounds(geometries, props.frames[0])
    return { bounds, stage: stageDimensions(bounds, props.frames) }
  }, [geometries, props.frames, props.groupTracks])
  const lightTarget = useMemo(() => {
    const target = new Object3D()
    target.position.copy(stage.center)
    return target
  }, [stage])
  const r = stage.shadowRadius
  const lightHeight = props.groupTracks === undefined ? 3.5 : Math.max(3.5, r * 2)
  const fogDistance = props.groupTracks === undefined ? 16 : Math.max(16, stage.floorSize * 4)
  return <>
    <color attach="background" args={['#dce5ed']} />
    <fog attach="fog" args={['#dce5ed', fogDistance * 5 / 16, fogDistance]} />
    <hemisphereLight args={['#e9f2ff', '#88939e', 1.5]} />
    <primitive object={lightTarget} />
    <directionalLight position={[stage.center.x + 2, lightHeight, stage.center.z + 2]} target={lightTarget}
      intensity={3} color="#fff1dc" castShadow shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r}
      shadow-camera-near={0.1} shadow-camera-far={Math.max(12, lightHeight * 3)}
      shadow-normalBias={0.001} shadow-bias={-0.0001} shadow-radius={3} />
    <directionalLight position={[stage.center.x - 2, 1.5, stage.center.z - 2]} target={lightTarget} intensity={1.3} color="#d2e6ff" />
    <Ground surface={props.surface} stage={stage} />
    <CameraControls bounds={bounds} cameraView={props.cameraView} cameraReset={props.cameraReset} />
    {props.groupTracks === undefined ? <Playback {...props} geometries={geometries} /> : props.groupTracks.map(track =>
      <group key={track.member.id} name={`duck-${track.member.id}`} position={[track.member.x, 0, track.member.z]}>
        <Playback {...props} geometries={geometries} frames={track.simulation.frames} readTime={() => groupTime.current}
          selectedBody={props.selectedDuck === track.member.id ? props.selectedBody : null}
          onBodySelect={(index) => { props.onDuckSelect?.(track.member.id); props.onBodySelect(index) }} />
      </group>)}
  </>
}

/**
 * Render recorded physics with canvas-scoped navigation and flat visual ground.
 * @param props - explicit scene, recording, appearance, camera and local playback controls.
 * @returns the native robot viewport; surface changes preserve the user's camera.
 */
export function RobotViewer(props: PlaybackProps & ViewProps & { maxDpr: number; onTogglePlayback: () => void }) {
  const hasFrames = props.groupTracks === undefined ? props.frames.length > 0
    : props.groupTracks.some(track => track.simulation.frames.length > 0)
  return <div className={css.viewport} tabIndex={0} role="region" aria-label={hasFrames ? 'Robot simulation replay; press Space to pause or play' : 'Robot simulation stage'}
    onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }) }}
    onKeyDown={(event) => {
      if (!hasFrames || event.target !== event.currentTarget || event.code !== 'Space' || event.repeat) return
      event.preventDefault()
      event.stopPropagation()
      props.onTogglePlayback()
    }}>
    <Canvas camera={{ position: [0.65, 0.4, 0.65], fov: 36, near: 0.001, far: 100 }}
      dpr={[1, props.maxDpr]} shadows="soft" frameloop="demand"
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
      <Studio {...props} />
    </Canvas>
  </div>
}
