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

/** Show or hide one domain data layer on the globe. */
export interface GeoDomainToggleCommand {
  readonly kind: 'domain-toggle'
  /** Domain layer id (one of the known domain layers). */
  readonly domain: string
  /** True to show the layer, false to hide it. */
  readonly on: boolean
}

/** Geometry of a drawn annotation feature; coordinates are WGS84 `[lon, lat]`. */
export type GeoDrawnGeometry =
  | { readonly type: 'point'; readonly coordinates: readonly [number, number] }
  | { readonly type: 'polyline'; readonly coordinates: ReadonlyArray<readonly [number, number]> }
  | { readonly type: 'polygon'; readonly coordinates: ReadonlyArray<readonly [number, number]> }

/** Draw one annotation feature into the "Drawings" layer with a minted id. */
export interface GeoDrawFeatureCommand {
  readonly kind: 'draw-feature'
  /** Feature id minted by the drawing tool; stable across replay. */
  readonly id: string
  /** The feature geometry. */
  readonly geometry: GeoDrawnGeometry
  /** Semantic type of the feature (e.g. the segmentation prompt: house, road). */
  readonly featureType?: string | undefined
}

/** Shift an existing drawn feature by a `[lon, lat]` degree delta. */
export interface GeoMoveFeatureCommand {
  readonly kind: 'move-feature'
  /** Id of the drawn feature to move. */
  readonly id: string
  /** Longitude delta in degrees. */
  readonly dLon: number
  /** Latitude delta in degrees. */
  readonly dLat: number
}

/** Set the display name of a drawn feature. */
export interface GeoSetFeaturePropsCommand {
  readonly kind: 'set-feature-props'
  /** Id of the drawn feature to update. */
  readonly id: string
  /** New display name. */
  readonly name: string
}

/** Remove drawn features by id. */
export interface GeoDeleteFeaturesCommand {
  readonly kind: 'delete-features'
  /** Ids of the drawn features to remove. */
  readonly ids: readonly string[]
}

/** Remove the most recently drawn feature. */
export interface GeoUndoDrawCommand {
  readonly kind: 'undo-draw'
}

/** One geo view command the agent issues to the 3D Earth panel. */
export type GeoCommand =
  | GeoCameraCommand
  | GeoBaseMapCommand
  | GeoDomainToggleCommand
  | GeoDrawFeatureCommand
  | GeoMoveFeatureCommand
  | GeoSetFeaturePropsCommand
  | GeoDeleteFeaturesCommand
  | GeoUndoDrawCommand

/** An accumulated drawn feature in the "Drawings" layer, keyed by id. */
export interface GeoDrawnFeature {
  /** Feature id minted by the drawing tool. */
  readonly id: string
  /** The feature geometry, with any moves applied. */
  readonly geometry: GeoDrawnGeometry
  /** Display name, when set. */
  readonly name?: string | undefined
  /** Semantic type carried from the draw command (e.g. the segmentation prompt). */
  readonly featureType?: string | undefined
}

/**
 * The latest geo command plus accumulated view state and a monotonically
 * increasing counter. The client bridge re-applies the latest `command` only
 * when `seq` advances (so replay converges on the last commanded view without
 * re-firing intermediate camera moves), while `enabledDomains` and `features`
 * let a freshly mounted viewer reconstruct the full domain-layer visibility and
 * the "Drawings" layer from the log alone.
 */
export interface GeoCommandState {
  /** Per-session command counter; starts at 0 (no command issued yet). */
  readonly seq: number
  /** The most recent command, or null before the first command. */
  readonly command: GeoCommand | null
  /** Domain layer ids currently toggled on, in first-enabled order. */
  readonly enabledDomains: readonly string[]
  /** Accumulated drawn features in draw order, with moves/edits/deletes applied. */
  readonly features: readonly GeoDrawnFeature[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One geo view command from a control tool: fly the camera, switch the base
     * map, toggle a domain layer, or draw/move/edit/delete an annotation
     * feature. Log-only for the model (`deriveMessages` ignores it); the client
     * bridge folds it via the `geoCommand` projection and drives the live
     * Cesium viewer. Whole-value: each event carries a complete command.
     */
    'geo/command': GeoCommand
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The latest geo view command, the accumulated enabled domain layers and
     * drawn features, and a per-session sequence number; a zero-seq empty state
     * before the first `geo/command`. Last-wins for `command`, accumulating for
     * `enabledDomains` and `features`.
     */
    geoCommand: GeoCommandState
  }
}
