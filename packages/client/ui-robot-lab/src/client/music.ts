/** Original, deterministic mono instrument synthesis; only the recipe is durable, never the generated waveform. */
import type { RobotMusicRecipe } from '@deepseek-ai/dsh-robot-lab/types'

/** Deployment-controlled allocation and duration limits, supplied by plugin Config at apply. */
export interface MusicOptions {
  sampleRate: 22050 | 44100
  maxDurationSeconds: number
  maxSamples: number
}

/** Transient mono PCM; duration is musical time, with the final sample rounded up by less than one sample period. */
export interface MusicPcm {
  samples: Float32Array<ArrayBuffer>
  sampleRate: number
  duration: number
}

/**
 * Validate synthesis configuration before allocating audio or registering the plugin.
 * @param options - explicit deployment settings; no defaults are applied.
 * @returns an immutable copy; throws on invalid limits or unsupported sample rates.
 */
export function validateMusicOptions(options: MusicOptions): Readonly<MusicOptions> {
  if (![22050, 44100].includes(options.sampleRate)) throw new Error('Music sampleRate must be 22050 or 44100')
  if (!Number.isFinite(options.maxDurationSeconds) || options.maxDurationSeconds <= 0) {
    throw new Error('Music maxDurationSeconds must be positive and finite')
  }
  // RIFF's 32-bit chunk length includes 36 bytes beyond PCM data.
  if (!Number.isSafeInteger(options.maxSamples) || options.maxSamples < 1 || options.maxSamples > Math.floor((0xffffffff - 36) / 2)) {
    throw new Error('Music maxSamples must fit mono PCM16 RIFF')
  }
  return Object.freeze({ ...options })
}

function randomSequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const pentatonic = [0, 3, 5, 7, 10] as const
const frequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)
const sine = (phase: number): number => Math.sin(2 * Math.PI * phase)

function melodyVoice(style: RobotMusicRecipe['style'], phase: number): number {
  switch (style) {
    case 'disco': return sine(phase) * 0.75 + sine(phase * 2) * 0.25
    case 'electronic': return sine(phase + 0.3 * sine(phase * 2))
    case 'lofi': return sine(phase) * 0.85 + sine(phase * 3) * 0.15
    case 'chiptune': return phase % 1 < 0.25 ? 0.65 : -0.65
    default: return assertNever(style)
  }
}

function assertNever(style: never): never { throw new Error(`Unsupported music style: ${String(style)}`) }

/**
 * Synthesize original percussion, bass, and a seeded pentatonic melody in O(sample count) work and memory.
 * @param recipe - validated project recipe; bpm/beats define the exact musical duration.
 * @param options - explicit allocation limits and sample rate.
 * @returns fresh PCM, never an external asset; throws before allocation when a recipe exceeds configured limits.
 */
export function generateMusic(recipe: RobotMusicRecipe, options: MusicOptions): MusicPcm {
  const { sampleRate, maxDurationSeconds, maxSamples } = validateMusicOptions(options)
  const duration = recipe.beats * 60 / recipe.bpm
  const count = Math.ceil(duration * sampleRate)
  if (!Number.isFinite(duration) || duration <= 0 || duration > maxDurationSeconds || !Number.isSafeInteger(count) || count > maxSamples) {
    throw new Error('Music recipe exceeds configured duration or sample limit')
  }
  const samples = new Float32Array(count)
  const random = randomSequence(recipe.seed)
  const beatSeconds = 60 / recipe.bpm
  const subdivision = recipe.style === 'chiptune' ? 4 : 2
  let lastStep = -1
  let melody = 0
  let bass = 0
  let previousNoise = 0
  for (let index = 0; index < count; index++) {
    const time = index / sampleRate
    const beat = time / beatSeconds
    const step = Math.floor(beat * subdivision)
    if (step !== lastStep) {
      lastStep = step
      const root = ([36, 41, 39, 43] as const)[Math.floor(beat / 4) % 4 as 0 | 1 | 2 | 3]
      melody = frequency(root + 24 + pentatonic[Math.floor(random() * pentatonic.length) as 0 | 1 | 2 | 3 | 4])
      bass = frequency(root + (step % 4 === 3 ? 12 : 0))
    }
    const swung = recipe.style === 'lofi' && step % 2 === 1 ? beatSeconds * 0.07 : 0
    const noteTime = Math.max(0, time - step * beatSeconds / subdivision - swung)
    const attack = Math.min(1, noteTime / 0.006)
    const noteEnvelope = attack * Math.exp(-noteTime / (beatSeconds * 0.32))
    const bassVoice = sine(bass * noteTime) * noteEnvelope * 0.22
    const lead = melodyVoice(recipe.style, melody * noteTime) * noteEnvelope * (recipe.style === 'lofi' ? 0.12 : 0.17)
    const beatIndex = Math.floor(beat)
    const kickTime = (beat - beatIndex) * beatSeconds
    const kickEnabled = recipe.style !== 'lofi' || beatIndex % 4 === 0 || beatIndex % 4 === 2
    const kick = kickEnabled ? sine(48 * kickTime + 7 * (1 - Math.exp(-kickTime * 22))) * Math.exp(-kickTime * 18) * 0.34 : 0
    const noise = random() * 2 - 1
    const highNoise = noise - previousNoise
    previousNoise = noise
    const snare = beatIndex % 2 === 1 ? (noise * 0.15 + sine(180 * kickTime) * 0.06) * Math.exp(-kickTime * 28) : 0
    const hatTime = (beat * 2 - Math.floor(beat * 2)) * beatSeconds / 2
    const hat = highNoise * Math.exp(-hatTime * (recipe.style === 'disco' ? 45 : 85)) * 0.055
    const fade = Math.min(1, time / 0.005, (duration - time) / 0.015)
    samples[index] = Math.tanh((bassVoice + lead + kick + snare + hat) * 1.15) * fade
  }
  return { samples, sampleRate, duration }
}

/**
 * Encode generated mono PCM as a standard little-endian PCM16 WAV without retaining an object URL.
 * @param pcm - locally generated waveform; caller owns its lifetime.
 * @returns downloadable RIFF bytes; the caller may wrap them in an audio/wav Blob and revoke its own URL.
 */
export function encodeMusicWav(pcm: MusicPcm): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + pcm.samples.length * 2)
  const view = new DataView(bytes)
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, pcm.sampleRate, true)
  view.setUint32(28, pcm.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, pcm.samples.length * 2, true)
  for (const [index, sample] of pcm.samples.entries()) {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}
