/** Presentation-only MicroDuck finishes; colors are sRGB hex values, never joint or physics settings. */

/** Stable selection ids; original retains the installed model's unmodified colors and finish. */
export type ClipSkinId = 'original' | 'velocity' | 'varsity' | 'weekend' | 'sakura' | 'candy'
  | 'punk' | 'cyber' | 'explorer' | 'nautical' | 'disco'

/** Coordinated shell, linkage and trim colors; protected optical and mechanical parts keep source colors. */
export type ClipSkinPalette = Readonly<Record<'torso' | 'head' | 'neck' | 'hip' | 'thigh' | 'shin'
  | 'foot' | 'joint' | 'accent', string>>

/** A custom visual finish. Labels and descriptions belong to the owning UI's locale dictionary. */
export interface ClipSkin {
  readonly id: Exclude<ClipSkinId, 'original'>
  readonly palette: ClipSkinPalette
  readonly roughness?: number
  readonly metalness?: number
}

/** Ten custom finishes, excluding the untouched original model. */
export const clipSkins: readonly ClipSkin[] = [
  { id: 'velocity', palette: { torso: '#2858bd', head: '#edf4f5', neck: '#536778', hip: '#224ca1',
    thigh: '#e0ecf0', shin: '#2858bd', foot: '#d4e0e6', joint: '#697985', accent: '#c8e45a' }, roughness: 0.28, metalness: 0.28 },
  { id: 'varsity', palette: { torso: '#843749', head: '#f1e6cd', neck: '#233c56', hip: '#b79a68',
    thigh: '#f1e6cd', shin: '#233c56', foot: '#843749', joint: '#697c8f', accent: '#c4ad7c' }, roughness: 0.5, metalness: 0.12 },
  { id: 'weekend', palette: { torso: '#91a99b', head: '#eee7d8', neck: '#b1a48b', hip: '#8c9b84',
    thigh: '#d8ceb7', shin: '#788e80', foot: '#eee7d8', joint: '#919a93', accent: '#bd8265' }, roughness: 0.64, metalness: 0.06 },
  { id: 'sakura', palette: { torso: '#f0e7e5', head: '#e4aec1', neck: '#b5a1c9', hip: '#c9b5d6',
    thigh: '#f4e9e4', shin: '#d6a2b6', foot: '#e4aec1', joint: '#aea0b8', accent: '#ac5b7c' }, roughness: 0.4, metalness: 0.2 },
  { id: 'candy', palette: { torso: '#b6a2d9', head: '#b6dced', neck: '#a68bc5', hip: '#8fbcd5',
    thigh: '#d0c0e8', shin: '#a1cfe4', foot: '#e8def1', joint: '#858498', accent: '#eddb79' }, roughness: 0.32, metalness: 0.08 },
  { id: 'punk', palette: { torso: '#35343e', head: '#494650', neck: '#aaa9ae', hip: '#7e4567',
    thigh: '#68616f', shin: '#35343e', foot: '#494650', joint: '#969ba4', accent: '#e167a7' }, roughness: 0.46, metalness: 0.35 },
  { id: 'cyber', palette: { torso: '#263d59', head: '#324963', neck: '#7283b5', hip: '#71629a',
    thigh: '#52758d', shin: '#263d59', foot: '#415878', joint: '#6c8296', accent: '#64ded9' }, roughness: 0.22, metalness: 0.48 },
  { id: 'explorer', palette: { torso: '#516c55', head: '#ded0ad', neck: '#917d59', hip: '#9da77f',
    thigh: '#c3b58d', shin: '#516c55', foot: '#665445', joint: '#929787', accent: '#c97f43' }, roughness: 0.68, metalness: 0.1 },
  { id: 'nautical', palette: { torso: '#2e506c', head: '#edf0e8', neck: '#8ba6b6', hip: '#395e77',
    thigh: '#edf0e8', shin: '#2e506c', foot: '#dce5e4', joint: '#96a4ab', accent: '#dc857b' }, roughness: 0.38, metalness: 0.22 },
  { id: 'disco', palette: { torso: '#d2b888', head: '#ebe4da', neck: '#907397', hip: '#b49775',
    thigh: '#ded3ca', shin: '#654765', foot: '#c8ac7a', joint: '#aaa2ad', accent: '#775478' }, roughness: 0.2, metalness: 0.58 },
]

/**
 * Map the nearest movable joint to its visible body region, independent of body indices or pose.
 * @param jointName - installed joint name; undefined denotes the free root or its fixed attachments.
 * @returns the palette region shared by live geometry and schematic previews.
 */
export function clipSkinRegion(jointName: string | undefined): keyof ClipSkinPalette {
  if (jointName === undefined) return 'torso'
  if (jointName === 'neck_pitch' || jointName === 'head_pitch') return 'neck'
  if (jointName === 'head_roll') return 'head'
  if (jointName.endsWith('_hip_roll')) return 'hip'
  if (jointName.endsWith('_hip_pitch')) return 'thigh'
  if (jointName.endsWith('_knee')) return 'shin'
  if (jointName.endsWith('_ankle')) return 'foot'
  return 'joint'
}
