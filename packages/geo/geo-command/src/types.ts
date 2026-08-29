/**
 * Pure types and declaration merges of the geo command domain: the ONE home of
 * the `geo/command` session event and the `geoCommand` projection key. Free of
 * value imports so both the host (`./index.ts`) and the client aggregate
 * (`./client`) can project these declarations.
 * @module @deepseek-ai/dsh-geo-command/types
 */

/** Fly the camera to a geographic target. */
export interface GeoCameraCommand {
  readonly kind: 'camera'
  /** Latitude in WGS84 degrees. */
  readonly lat: number
  /** Longitude in WGS84 degrees. */
  readonly lon: number
  /** Camera height above the ellipsoid in meters. */
  readonly height: number
}

/** Switch the globe base-map imagery. */
export interface GeoBaseMapCommand {
  readonly kind: 'basemap'
  /** Base-map preset id (see the ctx.geo presets). */
  readonly id: string
}

/** One geo view command the agent issues to the 3D Earth panel. */
export type GeoCommand = GeoCameraCommand | GeoBaseMapCommand

/**
 * The latest geo command plus a monotonically increasing counter. The client
 * bridge re-applies a command only when `seq` advances, so replay converges on
 * the last commanded view without re-firing intermediate camera moves.
 */
export interface GeoCommandState {
  /** Per-session command counter; starts at 0 (no command issued yet). */
  readonly seq: number
  /** The most recent command, or null before the first command. */
  readonly command: GeoCommand | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One geo view command from a control tool: fly the camera or switch the
     * base map. Log-only for the model (`deriveMessages` ignores it); the
     * client bridge folds it via the `geoCommand` projection and drives the
     * live Cesium viewer. Whole-value: each event carries a complete command.
     */
    'geo/command': GeoCommand
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The latest geo view command and its per-session sequence number, or a
     * zero-seq null command before the first `geo/command`. Last-wins fold.
     */
    geoCommand: GeoCommandState
  }
}
