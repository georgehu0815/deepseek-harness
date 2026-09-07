/** Dropdown entries keep original training-reference clips distinct from contact-constrained dance revisions. */
import { danceClips } from './dance-clips.ts'
import { danceClipsV2 } from './dance-clips-v2.ts'
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipDuckDance } from './clip-ducks.ts'
import { validateClipSequence } from './clip-sequence.ts'
import { validateWalkingClip } from './clip-walking.ts'

/** One explicit selection also identifies its matching original rhythm recording. */
export const dancePresets = [
  ...danceClips.map(dance => ({ ...dance, kind: 'reference' as const, style: dance.id, revision: 1,
    bpm: dance.sequence.bpm, clip: dance.sequence.clip })),
  ...danceClipsV2.map(dance => ({ ...dance, kind: 'walking' as const, revision: 2 })),
]

/**
 * Admit the same preset bytes for the primary timeline or a companion duck.
 * @param dance - selected bundled preset; editable labels never identify a model.
 * @param profile - installed joint order, fingerprint and limits.
 * @param scene - native kinematics required for contact-constrained presets.
 * @param limits - current authored-motion limits.
 * @param maxFileBytes - complete serialized clip byte budget.
 * @returns validated independent selection or a localized failure identifier, without mutating the current draft.
 */
export function resolveDancePreset(dance: typeof dancePresets[number], profile: RobotProfile,
  scene: RobotScene | null, limits: RobotStudioCatalog['limits'], maxFileBytes: number,
): { dance: ClipDuckDance } | { error: 'danceClip' | 'fileSize' } {
  let clip: ClipDuckDance['clip']
  try {
    if (dance.kind === 'reference') clip = validateClipSequence(dance.sequence, profile, limits).clip
    else {
      if (scene === null || dance.bpm < limits.minBpm || dance.bpm > limits.maxBpm) return { error: 'danceClip' }
      clip = validateWalkingClip(dance.clip, profile, scene, limits)
    }
  } catch { return { error: 'danceClip' } }
  if (new TextEncoder().encode(JSON.stringify(clip, null, 2) + '\n').byteLength > maxFileBytes) return { error: 'fileSize' }
  return { dance: { id: dance.id, clip, bpm: dance.bpm, modelSha256: profile.modelSha256 } }
}
