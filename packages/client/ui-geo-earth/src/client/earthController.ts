/**
 * Imperative controller shared between the Cesium panel (which owns the live
 * viewer) and command sources: the in-panel base-map switcher now, the agent
 * command bridge in Phase 2. A module-level singleton so a slot component and
 * a runtime service can drive one globe without prop wiring. When no viewer is
 * mounted, commands are remembered as the desired state and applied on mount.
 */
import {
  Viewer,
  UrlTemplateImageryProvider,
  Credit,
  Cartesian3,
} from 'cesium'

/** One selectable base-map imagery preset (mirrors the ctx.geo seam presets). */
export interface BaseMapPreset {
  readonly id: string
  readonly label: string
  readonly urlTemplate: string
  readonly attribution: string
  readonly maxZoom: number
}

/** The default base-map preset, always present as the first {@link BASE_MAPS} entry. */
const OSM_PRESET: BaseMapPreset = { id: 'osm', label: 'OpenStreetMap', urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 }

/** Static base-map presets, kept in sync with `@deepseek-ai/dsh-geo`. */
export const BASE_MAPS: readonly BaseMapPreset[] = [
  OSM_PRESET,
  { id: 'carto-dark', label: 'Carto Dark', urlTemplate: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 20 },
  { id: 'carto-light', label: 'Carto Light', urlTemplate: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 20 },
  { id: 'esri-satellite', label: 'Esri Satellite', urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery © Esri', maxZoom: 19 },
]

/** Default base-map id used at first mount. */
export const DEFAULT_BASE_MAP_ID = OSM_PRESET.id

/** The default preset used before any base-map command. */
const DEFAULT_PRESET: BaseMapPreset = OSM_PRESET

/** A camera fly-to target in WGS84 degrees plus an altitude in meters. */
export interface FlyTarget {
  readonly lat: number
  readonly lon: number
  /** Camera height above the ellipsoid in meters (default 2,000,000). */
  readonly height?: number
}

/** Controller state observers subscribe to (the current base-map id). */
interface ControllerState {
  readonly baseMapId: string
}

/** Find a preset by id, falling back to the default. */
function presetOf(id: string): BaseMapPreset {
  return BASE_MAPS.find(b => b.id === id) ?? DEFAULT_PRESET
}

/**
 * The single globe controller. The panel calls {@link attach}/{@link detach}
 * around the viewer lifecycle; UI and the agent bridge call the imperative
 * commands, which apply immediately when a viewer is attached and are
 * otherwise remembered as desired state.
 */
class EarthController {
  private viewer: Viewer | undefined
  private state: ControllerState = { baseMapId: DEFAULT_BASE_MAP_ID }
  private readonly listeners = new Set<() => void>()

  /** Bind the live viewer and apply the remembered base map. */
  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.applyBaseMap(this.state.baseMapId)
  }

  /** Unbind on unmount; the viewer is destroyed by its owner. */
  detach(viewer: Viewer): void {
    if (this.viewer === viewer) this.viewer = undefined
  }

  /** Current base-map id (desired state, valid with or without a viewer). */
  getBaseMapId(): string { return this.state.baseMapId }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Switch the base-map imagery. Unknown ids fall back to the default. */
  setBaseMap(id: string): void {
    const preset = presetOf(id)
    this.state = { baseMapId: preset.id }
    this.applyBaseMap(preset.id)
    for (const l of this.listeners) l()
  }

  /** Fly the camera to a geographic target. No-op without a viewer. */
  flyTo(target: FlyTarget): void {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(target.lon, target.lat, target.height ?? 2_000_000),
      duration: 1.5,
    })
  }

  private applyBaseMap(id: string): void {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return
    const preset = presetOf(id)
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
      url: preset.urlTemplate,
      credit: new Credit(preset.attribution, false),
      maximumLevel: preset.maxZoom,
    }))
  }
}

/** Process-wide single controller (one globe per page). */
export const earthController = new EarthController()
