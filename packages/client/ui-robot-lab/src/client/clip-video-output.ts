/** Select an immutable captured variant rather than combining an old video with the current draft's music. */
import type { ClipVideoOutput } from './clip-gen-store.ts'

/**
 * Resolve a download and playback source for the user's audio preference.
 * @param video - Completed silent capture and its optional soundtrack-bearing counterpart.
 * @param withAudio - Shared default-on export preference; absent audio still yields video only.
 * @returns The selected URL, bytes and filename, without creating or retaining media resources.
 */
export function clipVideoDownload(video: ClipVideoOutput, withAudio: boolean): { url: string; bytes: number; filename: string } {
  if (withAudio && video.audio !== undefined) return { ...video.audio, filename: video.filename }
  return { url: video.url, bytes: video.bytes,
    filename: video.audio === undefined ? video.filename : video.filename.replace(/\.mp4$/i, '-silent.mp4') }
}
