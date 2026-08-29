/**
 * CesiumJS globe mounted into a host div, plus an in-panel base-map switcher.
 * Ported from Terra's CesiumEarth bootstrap (src/earth/CesiumEarth.ts):
 * ellipsoid terrain, every Cesium widget disabled. Static engine assets
 * (Workers, Assets, Widgets, ThirdParty) are served from `/cesium`;
 * CESIUM_BASE_URL is set before the engine reads it. The live viewer is handed
 * to the shared {@link earthController}, which owns imagery and camera
 * commands so both this switcher and the Phase 2 agent bridge drive one globe.
 */
import * as React from 'react'

// The engine resolves Workers/Assets relative to this global; it must be set
// before any Cesium module that touches asset URLs is used. apps/web serves
// the copied engine build at /cesium (see the plugin README).
;(globalThis as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL ??= '/cesium'

import { Viewer, EllipsoidTerrainProvider } from 'cesium'
import { BASE_MAPS, earthController } from './earthController.ts'

/** Cesium's widget stylesheet, served from the copied engine tree at /cesium. */
const WIDGETS_CSS_HREF = '/cesium/Widgets/widgets.css'

/**
 * Inject Cesium's widget stylesheet once via a served <link>, rather than a
 * build-time CSS import: the DSH client bundle's CSS pipeline resolves only
 * relative stylesheets, and the engine's own CSS already ships under /cesium.
 */
function ensureWidgetsCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[data-geo3d-cesium-css]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = WIDGETS_CSS_HREF
  link.dataset.geo3dCesiumCss = ''
  document.head.appendChild(link)
}

const CSS = `
.geo3d-cesium{position:absolute;inset:0;background:#05070c}
.geo3d-cesium .cesium-viewer,.geo3d-cesium .cesium-widget,.geo3d-cesium .cesium-widget canvas{width:100%;height:100%}
.geo3d-cesium .cesium-widget-credits{font-size:10px;opacity:.6}
.geo3d-basemaps{position:absolute;top:10px;left:10px;z-index:2;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100% - 20px)}
.geo3d-chip{background:rgba(12,14,20,.78);border:1px solid var(--dsh-color-border,#2a2c33);color:#cfd2da;padding:5px 10px;border-radius:999px;cursor:pointer;font:12px/1 system-ui,sans-serif}
.geo3d-chip:hover{filter:brightness(1.25)}
.geo3d-chip.on{background:rgba(45,108,223,.85);border-color:#2d6cdf;color:#fff}
.geo3d-err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c7d3e6;font:13px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
`

/** React hook returning the controller's live base-map id. */
function useBaseMapId(): string {
  return React.useSyncExternalStore(
    earthController.subscribe,
    () => earthController.getBaseMapId(),
    () => earthController.getBaseMapId(),
  )
}

/** In-panel base-map chips; selection drives the shared controller. */
function BaseMapSwitcher(): React.JSX.Element {
  const active = useBaseMapId()
  return (
    <div className="geo3d-basemaps" role="group" aria-label="Base map">
      {BASE_MAPS.map(b => (
        <button
          key={b.id}
          className={b.id === active ? 'geo3d-chip on' : 'geo3d-chip'}
          aria-pressed={b.id === active}
          onClick={() => earthController.setBaseMap(b.id)}
        >{b.label}</button>
      ))}
    </div>
  )
}

/**
 * Render the CesiumJS globe and own its lifecycle for the panel's mount.
 * @returns the globe element.
 */
export function EarthPanel(): React.JSX.Element {
  const mountRef = React.useRef<HTMLDivElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    ensureWidgetsCss()
    let viewer: Viewer | undefined
    try {
      viewer = new Viewer(mount, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        timeline: false,
        animation: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
      })
      viewer.scene.globe.showGroundAtmosphere = true
      // The controller applies the current/desired base map on attach.
      earthController.attach(viewer)
      setReady(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }

    const attached = viewer
    return () => {
      if (attached) earthController.detach(attached)
      if (attached && !attached.isDestroyed()) attached.destroy()
    }
  }, [])

  return (
    <div className="geo3d-cesium" ref={mountRef}>
      <style>{CSS}</style>
      {ready ? <BaseMapSwitcher /> : null}
      {error !== null
        ? <div className="geo3d-err">{`Could not start the globe: ${error}. Engine assets may be missing from /cesium.`}</div>
        : null}
    </div>
  )
}
