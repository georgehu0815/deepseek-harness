/** Exclusive soundtrack choice with independent, mutually exclusive audition controls. */
import { useEffect, useId, useMemo, useRef } from 'react'
import type { ClipGenDraft } from './clip-gen-store.ts'
import type { ClipGenProps } from './clip-gen-props.ts'
import { alternativeMusic, resolveClipSoundtrack, type ClipMusicChoice } from './clip-soundtrack.ts'
import css from './ClipGen.module.css'

const choices: ClipMusicChoice[] = ['original', 'soundhelix-17', 'soundhelix-8', 'soundhelix-1']

function silence(audio: HTMLAudioElement): void {
  if (!audio.paused) audio.pause()
}

/**
 * Audition without selecting; radio selection pauses motion and invalidates the reviewed revision.
 * @param props - Controlled draft, localized labels and declared actions.
 * @returns Original rhythm plus three credited excerpts; no remote media requests.
 */
export function ClipMusicPicker({ state, actions, t }: { state: ClipGenDraft } & Pick<ClipGenProps, 'actions' | 't'>) {
  const group = useId()
  const players = useRef(new Map<ClipMusicChoice, HTMLAudioElement>())
  const refs = useMemo(() => new Map(choices.map((choice) => {
    let previous: HTMLAudioElement | null = null
    return [choice, (audio: HTMLAudioElement | null) => {
      if (previous !== null) silence(previous)
      previous = audio
      if (audio === null) players.current.delete(choice)
      else players.current.set(choice, audio)
    }] as const
  })), [])
  useEffect(() => {
    const owned = players.current
    const hidden = () => { if (document.hidden) for (const audio of owned.values()) silence(audio) }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden) }
  }, [])
  useEffect(() => {
    for (const audio of players.current.values()) silence(audio)
  }, [state.audioId, state.musicChoice, state.exporting])
  useEffect(() => {
    if (state.playing) for (const audio of players.current.values()) silence(audio)
  }, [state.playing])
  useEffect(() => {
    for (const audio of players.current.values()) { audio.volume = state.audioVolume; audio.muted = state.audioMuted }
  }, [state.audioVolume, state.audioMuted, state.audioId])
  if (state.clip === null) return null
  const duration = state.clip.duration
  return <fieldset className={css.musicPicker} disabled={state.exporting}>
    <legend>{t('audio.title', { bpm: Number(state.bpm.toFixed(2)) })}</legend>
    <p className={css.note}>{t('audio.chooseHint')}</p>
    <div className={css.musicOptions}>{choices.map((choice) => {
      const track = choice === 'original' ? null : alternativeMusic[choice]
      const name = track?.title ?? t('audio.original')
      const music = resolveClipSoundtrack(state.audioId, choice, state.bpm, duration)
      return <div className={css.musicOption} key={choice} data-selected={state.musicChoice === choice}>
        <label className={css.check}><input type="radio" name={group} value={choice} checked={state.musicChoice === choice}
          onChange={() => { actions.chooseMusic(choice) }} />{name}</label>
        {track !== null && <small>{track.artist} · <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer">{t('audio.creditLink')}</a></small>}
        {music === null ? <small>{t('export.noAudio')}</small> : <audio controls={!state.exporting} preload="none"
          aria-label={t('audio.audition', { name })} src={music.src}
          ref={refs.get(choice)} onError={() => { if (!state.exporting && !state.playing) actions.failure('audio') }}
          onPlay={(event) => {
            const audio = event.currentTarget
            if (state.exporting) { audio.pause(); return }
            for (const other of players.current.values()) if (other !== audio) silence(other)
            try { audio.playbackRate = music.rate }
            catch { audio.pause(); actions.failure('audio'); return }
            audio.preservesPitch = false; audio.volume = state.audioVolume; audio.muted = state.audioMuted
            actions.playing(false)
          }} />}
      </div>
    })}</div>
    {(state.audioId !== null || state.musicChoice !== 'original') && <div className={css.controls}>
      <label className={css.check}><input type="checkbox" checked={state.audioMuted}
        onChange={(event) => { actions.audioSettings({ muted: event.target.checked }) }} />{t('audio.mute')}</label>
      <label>{t('audio.volume')}<input type="range" min={0} max={1} step={0.05} value={state.audioVolume}
        onChange={(event) => { actions.audioSettings({ volume: Number(event.target.value) }) }} /></label>
    </div>}
    <p className={css.note}>{t('audio.hint')}</p>
    <p className={css.note}>{t('audio.timingHint')}</p>
    {state.musicChoice !== 'original' && <p className={css.note}>{t('audio.shareCredit')}</p>}
  </fieldset>
}
