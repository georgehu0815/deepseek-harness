/** One soundtrack selection and timing plan shared by audition, motion preview and MP4 capture. */
import { danceAudio, type DanceAudioId } from './dance-audio.ts'
import clubmix from './dance-audio/soundhelix-17.json'
import chillout from './dance-audio/soundhelix-8.json'
import songOne from './dance-audio/soundhelix-1.json'

/** Curated excerpts, not chart rankings; source titles and attribution remain verbatim. */
export const alternativeMusic = { 'soundhelix-17': clubmix, 'soundhelix-8': chillout, 'soundhelix-1': songOne } as const

/** The original rhythm follows the loaded dance; alternatives remain explicit through edits. */
export type ClipMusicChoice = 'original' | keyof typeof alternativeMusic

/** Credit accompanies completed MP4 downloads independently of later selection changes. */
export interface ClipMusicCredit {
  title: string
  artist: string
  source: string
  licenseUrl: string
}

/** Embedded audio and its source-seconds-per-motion-second rate; repeat loops only the music bed. */
export interface ClipSoundtrack {
  src: string
  duration: number
  rate: number
  repeat: boolean
  credit?: ClipMusicCredit
}

/**
 * Resolve the chosen recording for the current authored timeline, without changing any keyframes.
 * @param original - Loaded dance's original recording, or no original audio for custom clips.
 * @param choice - User's exclusive choice; loading a different clip resets it to original.
 * @param bpm - Current authored tempo, including duration retiming.
 * @param duration - Current clip duration in seconds.
 * @returns Original full-cycle audio, a tempo-scaled repeating excerpt, or no soundtrack.
 */
export function resolveClipSoundtrack(
  original: DanceAudioId | null, choice: ClipMusicChoice, bpm: number, duration: number,
): ClipSoundtrack | null {
  if (choice === 'original') {
    if (original === null) return null
    const music = danceAudio[original]
    return { src: music.src, duration: music.duration, rate: music.duration / duration, repeat: false }
  }
  const music = alternativeMusic[choice]
  return { src: music.src, duration: music.duration, rate: bpm / music.bpm, repeat: true,
    credit: { title: music.title, artist: music.artist, source: music.source, licenseUrl: music.licenseUrl } }
}
