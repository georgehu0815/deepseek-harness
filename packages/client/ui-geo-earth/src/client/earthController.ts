/**
 * Imperative controller shared between the Cesium panel (which owns the live
 * viewer) and command sources: the in-panel base-map switcher, the agent
 * command bridge, and the drawn-feature reconciler. A module-level singleton so
 * a slot component and a runtime service can drive one globe without prop
 * wiring. When no viewer is mounted, the desired base map and the drawn-feature
 * set are remembered and applied on mount.
 */
import {
  Viewer,
  UrlTemplateImageryProvider,
  Credit,
  Cartesian3,
  Cartesian2,
  Color,
  CustomDataSource,
  LabelStyle,
  Math as CesiumMath,
  VerticalOrigin,
  type Entity,
} from 'cesium'
import type { GeoDrawnFeature, GeoDrawnGeometry } from '@deepseek-ai/dsh-geo-command/client'

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

/** A reported camera pose in WGS84 degrees/meters, mirroring the geo/view pose. */
export interface ViewStatePose {
  readonly lat: number
  readonly lon: number
  readonly height: number
  readonly heading?: number
  readonly pitch?: number
}

/** The on-screen geographic rectangle in degrees, mirroring the geo/view bbox. */
export interface ViewStateBBox {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

/** A snapshot of the live camera: the pose plus an optional on-screen rectangle. */
export interface ViewState {
  readonly pose: ViewStatePose
  readonly bbox?: ViewStateBBox
}

/** Controller state observers subscribe to (the current base-map id). */
interface ControllerState {
  readonly baseMapId: string
}

/** Name of the single Cesium data source that holds all drawn annotations. */
const DRAWINGS_SOURCE_NAME = 'Drawings'

/** Pixel size of a drawn point graphic. */
const POINT_PIXEL_SIZE = 10

/** Width in pixels of a drawn polyline graphic. */
const POLYLINE_WIDTH = 3

/** Flatten a list of `[lon, lat]` pairs to `[lon, lat, lon, lat, …]` degrees. */
function flattenLonLat(coords: ReadonlyArray<readonly [number, number]>): number[] {
  const flat: number[] = []
  for (const [lon, lat] of coords) flat.push(lon, lat)
  return flat
}

/**
 * Build a Cesium label options object for a feature name anchored at a position.
 * `disableDepthTestDistance` is infinite so the text is never occluded by the
 * globe when the anchor rotates to the far side or sits below the horizon.
 * @param text - the feature display name.
 * @returns Cesium `LabelGraphics`-shaped options.
 */
function labelOptions(text: string): Record<string, unknown> {
  return {
    text,
    font: '14px sans-serif',
    fillColor: Color.WHITE,
    outlineColor: Color.BLACK,
    outlineWidth: 3,
    style: LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: VerticalOrigin.BOTTOM,
    pixelOffset: new Cartesian2(0, -12),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  }
}

/** Find a preset by id, falling back to the default. */
function presetOf(id: string): BaseMapPreset {
  return BASE_MAPS.find(b => b.id === id) ?? DEFAULT_PRESET
}

/**
 * Build the Cesium `Entity` options for one drawn feature: a graphic per
 * geometry type plus an optional label when the feature carries a name. The
 * label anchors at the point position or the first vertex of a line/ring.
 * @param feature - the drawn feature to render.
 * @returns Cesium `Entity.ConstructorOptions`-shaped options with `id`/`name`.
 */
function entityOptionsOf(feature: GeoDrawnFeature, highlighted: boolean): Record<string, unknown> {
  const geometry: GeoDrawnGeometry = feature.geometry
  const hasName = typeof feature.name === 'string' && feature.name.length > 0
  const options: Record<string, unknown> = { id: feature.id, name: feature.name }
  switch (geometry.type) {
    case 'point': {
      const [lon, lat] = geometry.coordinates
      options.position = Cartesian3.fromDegrees(lon, lat)
      options.point = highlighted
        ? { pixelSize: POINT_PIXEL_SIZE + 4, color: Color.ORANGE, outlineColor: Color.WHITE, outlineWidth: 3 }
        : { pixelSize: POINT_PIXEL_SIZE, color: Color.CYAN, outlineColor: Color.BLACK, outlineWidth: 2 }
      if (hasName) options.label = labelOptions(feature.name as string)
      return options
    }
    case 'polyline': {
      options.polyline = {
        positions: Cartesian3.fromDegreesArray(flattenLonLat(geometry.coordinates)),
        width: highlighted ? POLYLINE_WIDTH + 3 : POLYLINE_WIDTH,
        material: highlighted ? Color.ORANGE : Color.YELLOW,
      }
      anchorLabel(options, feature, geometry.coordinates)
      return options
    }
    case 'polygon': {
      options.polygon = {
        hierarchy: Cartesian3.fromDegreesArray(flattenLonLat(geometry.coordinates)),
        material: highlighted ? Color.ORANGE.withAlpha(0.5) : Color.CYAN.withAlpha(0.3),
        outline: true,
        outlineColor: highlighted ? Color.ORANGE : Color.CYAN,
      }
      anchorLabel(options, feature, geometry.coordinates)
      return options
    }
  }
}

/**
 * Attach a name label anchored at the first vertex of a line or ring, when the
 * feature carries a non-empty name and has at least one vertex.
 * @param options - the entity options being built, mutated in place.
 * @param feature - the drawn feature whose name is rendered.
 * @param coords - the geometry vertices in `[lon, lat]` degrees.
 * @returns nothing.
 */
function anchorLabel(options: Record<string, unknown>, feature: GeoDrawnFeature, coords: ReadonlyArray<readonly [number, number]>): void {
  const first = coords[0]
  /* v8 ignore next -- coords always has vertices (polyline ≥2, polygon ≥3); the empty guard only satisfies noUncheckedIndexedAccess. */
  if (!first || typeof feature.name !== 'string' || feature.name.length === 0) return
  options.position = Cartesian3.fromDegrees(first[0], first[1])
  options.label = labelOptions(feature.name)
}

/**
 * The single globe controller. The panel calls {@link attach}/{@link detach}
 * around the viewer lifecycle; UI and the agent bridge call the imperative
 * commands, which apply immediately when a viewer is attached and are
 * otherwise remembered as desired state. {@link renderFeatures} reconciles the
 * accumulated drawn-annotation set into a dedicated data source.
 */
class EarthController {
  private viewer: Viewer | undefined
  private state: ControllerState = { baseMapId: DEFAULT_BASE_MAP_ID }
  private readonly listeners = new Set<() => void>()
  /** Desired drawn features, remembered so a viewer mounted later rebuilds them. */
  private features: readonly GeoDrawnFeature[] = []
  /** The live "Drawings" data source, held while a viewer owns it. */
  private drawings: CustomDataSource | undefined
  /** Last commanded camera target, remembered so a viewer mounted later flies to it. */
  private cameraTarget: FlyTarget | undefined
  /** Id of the drawn feature currently hovered in the summary table, or null. */
  private hoveredId: string | null = null

  /** Bind the live viewer and apply the remembered base map, camera, and drawn features. */
  attach(viewer: Viewer): void {
    this.viewer = viewer
    this.applyBaseMap(this.state.baseMapId)
    // Snap to the last commanded view on mount so a reload or late-mounting
    // globe converges on it, rather than sitting at the default full-Earth
    // camera because the command arrived before the viewer existed.
    if (this.cameraTarget) this.applyCamera(this.cameraTarget, false)
    this.applyFeatures()
  }

  /** Unbind on unmount; the viewer and its data source are dropped by their owner. */
  detach(viewer: Viewer): void {
    if (this.viewer === viewer) {
      this.viewer = undefined
      this.drawings = undefined
    }
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

  /** Fly the camera to a geographic target, remembering it for a later viewer. */
  flyTo(target: FlyTarget): void {
    this.cameraTarget = target
    this.applyCamera(target, true)
  }

  /**
   * Point the live viewer's camera at a target. No-op without a viewer (the
   * target stays remembered and {@link attach} applies it on the next mount).
   * @param target - the geographic destination.
   * @param animated - true to fly with the standard easing, false to snap
   *   instantly (used on attach so a reload lands on the last view at once).
   */
  private applyCamera(target: FlyTarget, animated: boolean): void {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return
    const destination = Cartesian3.fromDegrees(target.lon, target.lat, target.height ?? 2_000_000)
    if (animated) {
      viewer.camera.flyTo({ destination, duration: 1.5 })
    } else {
      viewer.camera.setView({ destination })
    }
  }

  /**
   * Read the live camera as a {@link ViewState}: lat/lon/height (from
   * `positionCartographic`, converted to degrees), heading/pitch in degrees, and
   * the on-screen rectangle from `computeViewRectangle` when the viewer can
   * frame one. The bbox is omitted for oblique or space views where Cesium
   * returns no rectangle. Returns undefined when no viewer is attached.
   * @returns the current camera view, or undefined without a live viewer.
   */
  getViewState(): ViewState | undefined {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return undefined
    const camera = viewer.camera
    const carto = camera.positionCartographic
    const pose: ViewStatePose = {
      lat: CesiumMath.toDegrees(carto.latitude),
      lon: CesiumMath.toDegrees(carto.longitude),
      height: carto.height,
      heading: CesiumMath.toDegrees(camera.heading),
      pitch: CesiumMath.toDegrees(camera.pitch),
    }
    const rect = camera.computeViewRectangle()
    if (!rect) return { pose }
    return {
      pose,
      bbox: {
        west: CesiumMath.toDegrees(rect.west),
        south: CesiumMath.toDegrees(rect.south),
        east: CesiumMath.toDegrees(rect.east),
        north: CesiumMath.toDegrees(rect.north),
      },
    }
  }

  /**
   * Subscribe to live camera settle events. Cesium fires `camera.changed` after
   * the camera moves past a small threshold; the threshold is lowered so ordinary
   * pans and zooms are reported. No-op (returns a no-op disposer) without a
   * viewer; the caller re-subscribes when a viewer mounts.
   * @param fn - called after each camera settle.
   * @returns a disposer that removes the listener.
   */
  onCameraChanged(fn: () => void): () => void {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return () => {}
    viewer.camera.percentageChanged = 0.01
    viewer.camera.changed.addEventListener(fn)
    return () => {
      if (!viewer.isDestroyed()) viewer.camera.changed.removeEventListener(fn)
    }
  }

  /**
   * Reconcile the accumulated drawn-feature set into the "Drawings" data source.
   * The features are remembered so a viewer mounted later rebuilds them. Each
   * call does a full reconcile — clear the source and rebuild every entity from
   * the list — which is the simplest correct approach for the small annotation
   * counts here. No-op on the viewer when none is attached or it is destroyed.
   * @param features - the drawn features in draw order.
   * @returns nothing.
   */
  renderFeatures(features: readonly GeoDrawnFeature[]): void {
    this.features = features
    this.applyFeatures()
  }

  /** Id of the feature currently highlighted from the summary table, or null. */
  getHoveredId(): string | null { return this.hoveredId }

  /**
   * Set (or clear with null) the drawn feature highlighted from the summary
   * table, restyling the globe so the hovered polygon stands out. Notifies
   * subscribers so a table can reflect the shared hover state. A no-op when the
   * id is unchanged, so repeated hover events over one row do not rerender.
   * @param id - the feature id to highlight, or null to clear.
   */
  setHovered(id: string | null): void {
    if (this.hoveredId === id) return
    this.hoveredId = id
    this.applyFeatures()
    for (const l of this.listeners) l()
  }

  private applyFeatures(): void {
    const viewer = this.viewer
    if (!viewer || viewer.isDestroyed()) return
    if (!this.drawings) {
      this.drawings = new CustomDataSource(DRAWINGS_SOURCE_NAME)
      viewer.dataSources.add(this.drawings)
    }
    const entities = this.drawings.entities
    entities.removeAll()
    for (const feature of this.features) {
      entities.add(entityOptionsOf(feature, feature.id === this.hoveredId) as unknown as Entity.ConstructorOptions)
    }
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
