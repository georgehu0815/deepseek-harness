/**
 * Realistic 3D human organ explorer. Loads real, textured glTF/GLB anatomical
 * models (Sketchfab-authored) with three.js: PBR materials, environment-style
 * lighting, orbit camera, auto-centering/scaling, and a clinical info panel.
 * Each catalogue entry maps to a served /models/*.glb asset; picking a model
 * loads it into the shared scene without rebuilding the renderer.
 */
import * as React from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/* ------------------------------ catalogue ------------------------------- */

interface OrganInfo { region: string; function: string; composition: string; clinical: string }
interface Organ {
  id: string
  label: string
  icon: string
  /** URL of the served GLB asset. */
  url: string
  info: OrganInfo
}

/** Assets are copied to apps/web/public/models and served at /models/*.glb. */
const ORGANS: Organ[] = [
  {
    id: 'body', label: 'Full Body', icon: '🧍', url: '/models/divide_within_-_medical.glb',
    info: {
      region: 'Whole body',
      function: 'Anatomical overview of the human form and its external surface.',
      composition: 'Integumentary surface over the musculoskeletal frame.',
      clinical: 'Reference model for surface anatomy and regional landmarks.',
    },
  },
  {
    id: 'heart', label: 'Heart', icon: '🫀', url: '/models/heart.glb',
    info: {
      region: 'Mediastinum (thorax)',
      function: 'Four-chambered muscular pump driving the pulmonary and systemic circuits.',
      composition: 'Myocardium with four valves; supplied by the coronary arteries.',
      clinical: 'Myocardial infarction from coronary occlusion; murmurs signal valve disease.',
    },
  },
  {
    id: 'lung', label: 'Lungs', icon: '🫁', url: '/models/lung.glb',
    info: {
      region: 'Thoracic cavity',
      function: 'Gas exchange — oxygen in, carbon dioxide out — across the alveoli.',
      composition: 'Right lung 3 lobes, left 2 (cardiac notch); bronchial tree and pleura.',
      clinical: 'Pneumonia, COPD, asthma; aspiration favors the right main bronchus.',
    },
  },
  {
    id: 'liver', label: 'Liver', icon: '🟤', url: '/models/liver.glb',
    info: {
      region: 'Right upper quadrant',
      function: 'Metabolism, detoxification, bile production, and plasma-protein synthesis.',
      composition: 'Largest internal organ; lobes with hepatic artery, portal vein, gallbladder.',
      clinical: 'Cirrhosis and hepatitis; uniquely regenerates after partial resection.',
    },
  },
  {
    id: 'kidney', label: 'Kidney', icon: '🫘', url: '/models/kidney.glb',
    info: {
      region: 'Retroperitoneum',
      function: 'Filters blood, balances fluids and electrolytes, regulates blood pressure.',
      composition: '~1 million nephrons across cortex and medulla; renal pelvis and ureter.',
      clinical: 'Kidney stones, chronic kidney disease; the left sits slightly higher.',
    },
  },
  {
    id: 'stomach', label: 'Stomach', icon: '🍽️', url: '/models/stomach.glb',
    info: {
      region: 'Left upper quadrant',
      function: 'Mechanical and chemical digestion; secretes acid and pepsin.',
      composition: 'Fundus, body, and pylorus; rugae folds; luminal pH ~1.5–3.5.',
      clinical: 'Peptic ulcers (H. pylori), gastritis, and reflux disease.',
    },
  },
]

/* ------------------------------- styles --------------------------------- */

const CSS = `
.hb3d-wrap{display:flex;gap:16px;flex-wrap:wrap;font:13px/1.5 system-ui,sans-serif;color:var(--dsh-color-text,#e8e8ea)}
.hb3d-stagewrap{flex:1 1 400px;min-width:320px;display:flex;flex-direction:column;gap:8px}
.hb3d-stage{position:relative;height:580px;border-radius:12px;overflow:hidden;background:radial-gradient(circle at 50% 34%,#232734,#0b0c10);border:1px solid var(--dsh-color-border,#2a2c33)}
.hb3d-stage canvas{display:block;width:100%;height:100%;touch-action:none}
.hb3d-tag{position:absolute;top:8px;left:10px;font-size:11px;color:#9fb4d0;background:rgba(0,0,0,.5);padding:2px 8px;border-radius:6px;pointer-events:none}
.hb3d-overlaymsg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c7d3e6;font-size:13px;pointer-events:none;text-align:center;padding:20px}
.hb3d-bar{position:absolute;bottom:0;left:0;right:0;height:4px;background:rgba(255,255,255,.08)}
.hb3d-bar > i{display:block;height:100%;background:linear-gradient(90deg,#3f8cff,#7fd3ff);transition:width .15s}
.hb3d-panel{flex:0 0 300px;min-width:260px;display:flex;flex-direction:column;gap:10px}
.hb3d-h{font-size:16px;font-weight:700;margin:0}
.hb3d-list{display:flex;flex-wrap:wrap;gap:6px}
.hb3d-btn{border:1px solid var(--dsh-color-border,#2a2c33);background:var(--dsh-color-surface-2,#22242b);color:inherit;padding:6px 11px;border-radius:999px;cursor:pointer;font-size:12.5px;display:inline-flex;align-items:center;gap:6px}
.hb3d-btn.on{background:#2d6cdf;border-color:#2d6cdf;color:#fff}
.hb3d-card{background:var(--dsh-color-surface-2,#1d1f26);border:1px solid var(--dsh-color-border,#2a2c33);border-radius:10px;padding:14px;min-height:170px}
.hb3d-card h4{margin:0 0 4px;font-size:15px}
.hb3d-cardtag{display:inline-block;font-size:11px;color:#9fb4d0;background:#1b2740;border:1px solid #24406b;padding:1px 8px;border-radius:999px;margin-bottom:8px}
.hb3d-row{display:flex;gap:8px;margin:6px 0;font-size:12.5px}
.hb3d-row b{color:#8fb7ff;flex:0 0 74px}
.hb3d-hint{font-size:11px;color:#8a8d97;margin:2px 0}
.hb3d-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:#8a8d97}
`

/* ------------------------------ component ------------------------------- */

function organById(id: string): Organ {
  return ORGANS.find(o => o.id === id) ?? (ORGANS[1] as Organ)
}

function disposeObject3DResources(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else if (material) material.dispose()
  })
}

/**
 * Render the interactive Three.js anatomy explorer.
 * @returns the anatomy explorer element.
 */
export function AnatomySection(): React.JSX.Element {
  const mountRef = React.useRef<HTMLDivElement | null>(null)
  const [organId, setOrganId] = React.useState<string>('heart')
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [autorotate, setAutorotate] = React.useState<boolean>(true)

  const three = React.useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    controls?: OrbitControls
    loader?: GLTFLoader
    current?: THREE.Object3D
    raf?: number
    token: number
    autorotate: boolean
  }>({ token: 0, autorotate: true })
  three.current.autorotate = autorotate

  /* ---- one-time renderer/scene ---- */
  React.useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const width = mount.clientWidth || 480
    const height = mount.clientHeight || 580

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100)
    camera.position.set(0, 0, 3)

    // Image-based lighting from a synthetic room for realistic PBR shading.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 0.6
    controls.maxDistance = 12

    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key)
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.7); rim.position.set(-4, 2, -3); scene.add(rim)

    three.current.renderer = renderer
    three.current.scene = scene
    three.current.camera = camera
    three.current.controls = controls
    three.current.loader = new GLTFLoader()

    const onResize = (): void => {
      const w = mount.clientWidth || width, h = mount.clientHeight || height
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    const loop = (): void => {
      three.current.raf = requestAnimationFrame(loop)
      if (three.current.autorotate && three.current.current) three.current.current.rotation.y += 0.004
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      if (three.current.raf) cancelAnimationFrame(three.current.raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      pmrem.dispose()
      envTex.dispose()
      disposeObject3DResources(scene)
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  /* ---- load the selected model ---- */
  React.useEffect(() => {
    const t = three.current
    if (!t.scene || !t.loader || !t.camera || !t.controls) return
    const { scene, loader, camera, controls } = t
    const organ = organById(organId)
    const token = ++t.token
    setStatus('loading'); setProgress(0)

    loader.load(
      organ.url,
      (gltf) => {
        if (token !== t.token) return // superseded by a newer selection
        // remove previous
        if (t.current) {
          scene.remove(t.current)
          disposeObject3DResources(t.current)
        }
        const model = gltf.scene
        // center + scale to a unit-ish size, then frame the camera
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3(); box.getSize(size)
        const center = new THREE.Vector3(); box.getCenter(center)
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const scale = 1.6 / maxDim
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))
        scene.add(model)
        t.current = model

        // frame
        const cam = camera
        const dist = 1.6 / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 1.6
        cam.position.set(0, 0.15, Math.max(1.2, dist))
        controls.target.set(0, 0, 0)
        controls.update()
        setStatus('ready')
      },
      (ev) => {
        if (token !== t.token) return
        if (ev.total > 0) setProgress(Math.round((ev.loaded / ev.total) * 100))
      },
      () => {
        if (token !== t.token) return
        setStatus('error')
      },
    )
  }, [organId])

  const organ = organById(organId)
  const i = organ.info

  return (
    <div>
      <style>{CSS}</style>
      <div className="hb3d-wrap">
        <div className="hb3d-stagewrap">
          <div className="hb3d-stage" ref={mountRef}>
            <div className="hb3d-tag">{`${organ.icon} ${organ.label} · drag to orbit · scroll to zoom`}</div>
            {status === 'loading' ? <div className="hb3d-overlaymsg">{`Loading ${organ.label}…  ${progress}%`}</div> : null}
            {status === 'error' ? <div className="hb3d-overlaymsg">{`Could not load ${organ.label}. The model asset may be missing from /models.`}</div> : null}
            {status === 'loading' ? <div className="hb3d-bar"><i style={{ width: `${progress}%` }} /></div> : null}
          </div>
          <div className="hb3d-ctl">
            <label><input type="checkbox" checked={autorotate} onChange={e => setAutorotate(e.target.checked)} /> Auto-rotate</label>
            <span>· High-resolution textured models</span>
          </div>
        </div>
        <div className="hb3d-panel">
          <h3 className="hb3d-h">🫀 Human Body 3D — Organs</h3>
          <div className="hb3d-list">
            {ORGANS.map(o => (
              <button
                key={o.id}
                className={`hb3d-btn${o.id === organId ? ' on' : ''}`}
                onClick={() => setOrganId(o.id)}
              ><span>{o.icon}</span>{o.label}</button>
            ))}
          </div>
          <div className="hb3d-card">
            <span className="hb3d-cardtag">{organ.label}</span>
            <h4>{`${organ.icon} ${organ.label}`}</h4>
            <div className="hb3d-row"><b>Region</b><span>{i.region}</span></div>
            <div className="hb3d-row"><b>Function</b><span>{i.function}</span></div>
            <div className="hb3d-row"><b>Structure</b><span>{i.composition}</span></div>
            <div className="hb3d-row"><b>Clinical</b><span>{i.clinical}</span></div>
          </div>
          <p className="hb3d-hint">Real textured 3D models · drag to rotate · scroll to zoom · pick an organ above.</p>
        </div>
      </div>
    </div>
  )
}
