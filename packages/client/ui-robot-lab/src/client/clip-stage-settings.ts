/** Clip Gen viewing settings; these affect rendering only, not authored motion or physics. */
import type { ViewerCameraView, ViewerSurface } from './viewer-presets.ts'

/** Controlled environment and navigation settings for the native Clip Gen stage. */
export interface ClipStageSettings {
  surface: ViewerSurface
  ground: boolean
  grid: boolean
  axes: boolean
  background: string
  lightIntensity: number
  wireframe: boolean
  cameraView: ViewerCameraView
  cameraMode: 'orbit' | 'pan' | 'pose'
  /** Positive perspective projection multiplier; one is the fitted field of view. */
  cameraZoom: number
}

/**
 * Create independent default viewing settings for a Clip Gen editor.
 * @returns a mutable settings object with pose editing and studio ground enabled.
 */
export function createClipStageSettings(): ClipStageSettings {
  return { surface: 'studio', ground: true, grid: false, axes: false, background: '#dce5ed',
    lightIntensity: 1, wireframe: false, cameraView: 'perspective', cameraMode: 'pose', cameraZoom: 1 }
}
