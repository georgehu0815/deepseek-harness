/** Shared presentation for the audio preference at generation and completed-file controls. */
import css from './ClipGen.module.css'

/**
 * Keep a default-on preference visible even when a clip has no soundtrack.
 * @param props - Localized copy and plain controlled values; the parent owns state and media.
 * @returns The checkbox and an explicit video-only hint when audio is absent.
 */
export function ClipAudioExport(props: {
  checked: boolean
  available: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
  emptyHint: string
}) {
  return <span><label className={css.check}><input type="checkbox" checked={props.checked}
    disabled={props.disabled || !props.available} onChange={(event) => { props.onChange(event.target.checked) }} />{props.label}</label>
  {!props.available && <small className={css.note}>{props.emptyHint}</small>}</span>
}
