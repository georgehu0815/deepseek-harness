import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { alternativeMusic, resolveClipSoundtrack } from '../src/client/clip-soundtrack.ts'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { compileClip } from '../src/client/clip-motion.ts'
import { fixtureProfile } from './fixtures.client.ts'

describe('frozen soundtrack plans', () => {
  it('keeps original full-cycle timing and leaves custom clips silent unless an alternative is selected', () => {
    expect(resolveClipSoundtrack(null, 'original', 120, 30)).toBeNull()
    expect(resolveClipSoundtrack('bachata', 'original', 65, 60)).toMatchObject({ duration: 30, rate: 0.5, repeat: false })
    expect(resolveClipSoundtrack(null, 'soundhelix-1', 90, 30)).toMatchObject({ duration: 16, rate: 0.75, repeat: true })
  })

  it.each(Object.entries(alternativeMusic))('bundles a nonempty credited 32-beat excerpt: %s', (_id, music) => {
    expect(music.bpm).toBe(120)
    expect(music.duration).toBe(music.beats * 60 / music.bpm)
    const bytes = Buffer.from(music.src.split(',')[1]!, 'base64')
    expect(bytes.subarray(0, 4).toString()).toBe('OggS')
    expect(bytes.length).toBeGreaterThan(100_000)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(music.audioSha256)
    expect(music.artist).toBe('T. Schürger / SoundHelix')
    expect(music.source).toMatch(/^https:\/\/www\.soundhelix\.com\/examples\/mp3\//)
    expect(music.license).toContain('must give credit')
  })

  it('retimes the beat grid with duration edits without stretching the entire song into one clip', () => {
    const store = createClipGenStore(130, 8).create()
    const clip = compileClip(fixtureProfile, [{ action: 'stand', beats: 65 }], 130, 0.5, 'Dance', true)
    store.actions.loadDance('Dance', 130, clip, 'bachata')
    store.actions.chooseMusic('soundhelix-8')
    store.actions.meta({ duration: 60 })
    const state = store.getSnapshot()
    expect(state.bpm).toBe(65)
    expect(state.musicChoice).toBe('soundhelix-8')
    expect(resolveClipSoundtrack(state.audioId, state.musicChoice, state.bpm, state.clip!.duration))
      .toMatchObject({ rate: 65 / 120, repeat: true })
    store.actions.previewReady(true); store.actions.verify(true); store.actions.generate()
    store.actions.chooseMusic('original')
    expect(store.getSnapshot().musicChoice).toBe('soundhelix-8')
    store.actions.failure('aborted')
    store.actions.load(clip)
    expect(store.getSnapshot()).toMatchObject({ musicChoice: 'original', audioId: null })
  })
})
