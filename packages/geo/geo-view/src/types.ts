/**
 * Pure types and declaration merges of the geo view-report domain: the ONE home
 * of the `geo/view` session event and the `geoView` projection key. The browser
 * reports the real Cesium camera view (pose + on-screen bbox); this event makes
 * that report durable and model-visible, so the agent reasons about — and
 * segments — what is actually on screen, not a pose the agent itself commanded.
 * Free of value imports so both the host (`./index.ts`) and the client aggregate
 * (`./client`) can project these declarations.
 * @module @deepseek-ai/dsh-geo-view/types
 */

/** A camera pose reported from the live 3D Earth viewer, in WGS84 degrees/meters. */
export interface GeoViewPose {
  /** Camera target latitude in WGS84 degrees. */
  readonly lat: number
  /** Camera target longitude in WGS84 degrees. */
  readonly lon: number
  /** Camera height above the ellipsoid in meters. */
  readonly height: number
  /** Camera heading in degrees, when the viewer reports it. */
  readonly heading?: number | undefined
  /** Camera pitch in degrees, when the viewer reports it. */
  readonly pitch?: number | undefined
}

/** The on-screen geographic rectangle currently framed by the viewer. */
export interface GeoViewBBox {
  /** Western longitude bound in degrees. */
  readonly west: number
  /** Southern latitude bound in degrees. */
  readonly south: number
  /** Eastern longitude bound in degrees. */
  readonly east: number
  /** Northern latitude bound in degrees. */
  readonly north: number
}

/** One reported view of the live 3D Earth: who reported it, the pose, and bounds. */
export interface GeoView {
  /**
   * Origin of the report: `user` when a person panned/zoomed the globe by hand,
   * `agent` when it echoes a camera the agent commanded. The two are logged the
   * same way so the session log reconstructs the real camera regardless.
   */
  readonly source: 'user' | 'agent'
  /** The reported camera pose. */
  readonly pose: GeoViewPose
  /** The on-screen rectangle, absent when the viewer cannot compute one (oblique/space view). */
  readonly bbox?: GeoViewBBox | undefined
}

/**
 * The latest reported view plus a monotonically increasing counter. Last-wins:
 * a freshly mounted reader takes the newest reported view, and replay converges
 * on the final camera without re-firing intermediate reports.
 */
export interface GeoViewState {
  /** Per-session view-report counter; starts at 0 (no view reported yet). */
  readonly seq: number
  /** The most recent reported view, or null before the first report. */
  readonly view: GeoView | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One reported view of the live 3D Earth camera: a hand pan/zoom (`user`) or
     * an echo of an agent camera command (`agent`), carrying the pose and, when
     * available, the on-screen bbox.
     * @mode Log-only for the model directly; surfaced to the model through the
     *   geo-viewcontext pre-step injection and the `get_current_view` tool, both
     *   of which read this event. Whole-value: each event is a complete view.
     * @param source who reported the view: `user` or `agent`.
     * @param pose the reported camera pose (lat, lon, height, optional heading/pitch).
     * @param bbox the on-screen rectangle, when the viewer could compute one.
     * Marked ignorable so a build without this package still reads geo sessions.
     */
    'geo/view': GeoView
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The latest reported view and a per-session sequence number; a zero-seq
     * null view before the first `geo/view`. Last-wins for `view`.
     */
    geoView: GeoViewState
  }
}
