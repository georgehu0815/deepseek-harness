/** Internal visual presets; none changes recorded motion or simulation physics. */

/** Flat ground appearance in the replay viewport. */
export type ViewerSurface = 'studio' | 'concrete' | 'sand' | 'grass'

/** Camera directions in the Y-up renderer, with MuJoCo +X as the robot front. */
export type ViewerCameraView = 'perspective' | 'front' | 'side' | 'top'

/** Ground choices shared by the viewport and its local controls. */
export const SURFACE_PRESETS = [
  { id: 'studio', label: 'Studio grid', description: 'A precision grid on a cool studio floor.' },
  { id: 'concrete', label: 'Concrete', description: 'Fine-grained, neutral architectural concrete.' },
  { id: 'sand', label: 'Sand', description: 'Warm, softly mottled sand coloration.' },
  { id: 'grass', label: 'Grass', description: 'A flat meadow-green, finely textured finish.' },
] as const satisfies readonly { id: ViewerSurface; label: string; description: string }[]

/** Camera choices shared by the viewport and its local controls. */
export const CAMERA_VIEWS = [
  { id: 'perspective', label: 'Perspective' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
] as const satisfies readonly { id: ViewerCameraView; label: string }[]
