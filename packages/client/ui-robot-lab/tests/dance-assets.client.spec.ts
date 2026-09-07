import { describe, expect, it } from 'vitest'
import { dancePresets } from '../src/client/dance-presets.ts'
import { danceAudio } from '../src/client/dance-audio.ts'

describe('bundled dance and soundtrack pairing', () => {
  it('pairs each original and v2 selection with one matching embedded Ogg rhythm', () => {
    expect(Object.keys(danceAudio)).toEqual(dancePresets.map(dance => dance.id))
    expect(new Set(dancePresets.map(dance => dance.id)).size).toBe(12)
    for (const dance of dancePresets) {
      const audio = danceAudio[dance.id]
      expect(audio.bpm).toBe(dance.bpm)
      expect(audio.duration).toBe(dance.clip.duration)
      expect(audio.src).toMatch(/^data:audio\/ogg;base64,/)
      const bytes = Buffer.from(audio.src.split(',')[1]!, 'base64')
      expect(bytes.subarray(0, 4).toString()).toBe('OggS')
      expect(bytes.includes(Buffer.from('OpusHead'))).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(dance.clip, null, 2) + '\n')).toBeLessThanOrEqual(262144)
    }
  })
})
