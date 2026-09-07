/** Attribution follows the captured soundtrack even after the draft selection changes. */
import type { ClipMusicCredit as Credit } from './clip-soundtrack.ts'
import type { ClipGenProps } from './clip-gen-props.ts'
import css from './ClipGen.module.css'

/**
 * Expose the immutable soundtrack credit and a companion file for sharing an exported MP4.
 * @param props - Captured credit, download filename, localized copy and download callback.
 * @returns The credit controls, or nothing for an original synthesized rhythm.
 */
export function ClipMusicCredit({ credit, filename, t, saveText }: {
  credit: Credit | undefined
  filename: string
} & Pick<ClipGenProps, 't' | 'saveText'>) {
  if (credit === undefined) return null
  return <div className={css.note}>
    <p>{t('audio.captured', { title: credit.title, artist: credit.artist })}</p>
    <p>{t('audio.shareCredit')}</p>
    <button type="button" onClick={() => { saveText(JSON.stringify(credit, null, 2) + '\n', filename.replace(/\.mp4$/i, '-music-credits.json')) }}>{t('audio.saveCredit')}</button>
  </div>
}
