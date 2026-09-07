import { describe, expect, it } from 'vitest'
import { parseClipSequence, validateClipSequence } from '../src/client/clip-sequence.ts'
import type { ClipSequence } from '../src/client/clip-sequence.ts'
import { rootPitchLimit } from '../src/client/clip-motion.ts'
import { fixtureCatalog, fixtureProfile } from './fixtures.client.ts'

const profile = { ...fixtureProfile, modelSha256: 'a'.repeat(64) }
const limits = fixtureCatalog.limits
function sequence(): ClipSequence {
  return { version: 1, modelSha256: profile.modelSha256, jointNames: profile.joints.map(joint => joint.name), bpm: 96,
    clip: { version: 1, name: '  月光 🦆 e\u0301  ', duration: 4, loop: false, keys: [
      { t: 0, joints: Array<number>(14).fill(0), rootPitch: -0.1 },
      { t: 0.75, joints: Array<number>(14).fill(0.4), rootPitch: 0.2 },
      { t: 4, joints: Array<number>(14).fill(-0.2), rootPitch: 0 },
    ] } }
}

describe('Saved clip sequence structural decoding', () => {
  it('preserves exact keyed motion, tempo and Unicode text in independent arrays', () => {
    const original = sequence()
    const copy = parseClipSequence(JSON.parse(JSON.stringify(original)))
    expect(copy).toEqual(original)
    expect(copy).not.toBe(original)
    copy.jointNames[0] = 'other'
    copy.clip.keys[1]!.joints[0] = 0.9
    expect(original.jointNames[0]).toBe('joint_0')
    expect(original.clip.keys[1]!.joints[0]).toBe(0.4)
  })

  it.each([null, [], 'sequence', {}, { ...sequence(), extra: true }, { ...sequence(), version: 2 },
    { ...sequence(), modelSha256: 'a'.repeat(63) }, { ...sequence(), modelSha256: 'A'.repeat(64) },
    { ...sequence(), modelSha256: 1 }, { ...sequence(), modelSha256: 'g'.repeat(64) },
    { ...sequence(), jointNames: null }, { ...sequence(), jointNames: [] },
    { ...sequence(), jointNames: Array<string>(14).fill('same') },
    ...['', ' ', 1, 'a'.repeat(161)].map(name => ({ ...sequence(), jointNames: [name, ...sequence().jointNames.slice(1)] })),
    ...[0, -1, NaN, Infinity, '96'].map(bpm => ({ ...sequence(), bpm })),
  ])('rejects malformed sequence identity and fields %#', (value) => {
    expect(() => parseClipSequence(value)).toThrow()
  })

  it.each([null, [], 'clip', {}, { ...sequence().clip, extra: true },
    ...[2, '1'].map(version => ({ ...sequence().clip, version })),
    ...['', '  ', 'a'.repeat(161), null].map(name => ({ ...sequence().clip, name })),
    ...[0, -1, NaN, Infinity, '4'].map(duration => ({ ...sequence().clip, duration })),
    { ...sequence().clip, loop: 'true' },
    ...[null, [], [sequence().clip.keys[0]]].map(keys => ({ ...sequence().clip, keys })),
  ])('rejects malformed clip fields %#', (clip) => {
    expect(() => parseClipSequence({ ...sequence(), clip })).toThrow()
  })

  it.each([null, [], 'key', {}, { ...sequence().clip.keys[1], extra: true },
    ...[0, -1, 5, NaN, Infinity, '0.75'].map(t => ({ ...sequence().clip.keys[1], t })),
    ...[NaN, Infinity, rootPitchLimit + 0.001, -rootPitchLimit - 0.001, null].map(rootPitch => ({ ...sequence().clip.keys[1], rootPitch })),
    ...[null, [], Array<number>(13).fill(0), Array<number>(15).fill(0),
      Array<number>(14).fill(NaN), Array<number>(14).fill(Infinity), Array<string>(14).fill('0')]
      .map(joints => ({ ...sequence().clip.keys[1], joints })),
  ])('rejects malformed or out-of-order keyed motion %#', (key) => {
    const value = sequence()
    expect(() => parseClipSequence({ ...value, clip: { ...value.clip, keys: [value.clip.keys[0], key, value.clip.keys[2]] } })).toThrow()
  })

  it('requires both timeline endpoints and strictly increasing keys', () => {
    const value = sequence()
    expect(() => parseClipSequence({ ...value, clip: { ...value.clip, keys: value.clip.keys.slice(1) } })).toThrow()
    expect(() => parseClipSequence({ ...value, clip: { ...value.clip, keys: value.clip.keys.slice(0, 2) } })).toThrow('Incomplete')
    const reversed = { ...value.clip, keys: [value.clip.keys[0], value.clip.keys[2], value.clip.keys[1]] }
    expect(() => parseClipSequence({ ...value, clip: reversed })).toThrow()
  })

  it('accepts exact name/root bounds without imposing catalog tempo or joint limits during recovery', () => {
    const value = sequence()
    value.clip.name = '🦆'.repeat(80)
    value.bpm = 1000
    value.clip.duration = 1000
    value.clip.keys[2]!.t = 1000
    value.clip.keys[0]!.rootPitch = -rootPitchLimit
    value.clip.keys[1]!.rootPitch = rootPitchLimit
    value.clip.keys[1]!.joints[0] = 1000
    expect(parseClipSequence(value)).toEqual(value)
    value.bpm = 0.001
    expect(parseClipSequence(value).bpm).toBe(0.001)
  })
})

describe('Saved clip sequence installed-model admission', () => {
  it('accepts exact model identity, joint order and catalog bounds without recompiling', () => {
    const value = sequence()
    value.clip.keys[0]!.joints = profile.joints.map(joint => joint.lower)
    value.clip.keys[1]!.joints = profile.joints.map(joint => joint.upper)
    for (const bpm of [limits.minBpm, limits.maxBpm]) {
      value.bpm = bpm
      expect(validateClipSequence(value, profile, { ...limits, maxClipKeys: 3, maxClipSeconds: 4 })).toEqual(value)
    }
    const copy = validateClipSequence(value, profile, limits)
    copy.clip.keys[0]!.joints[0] = 0
    expect(value.clip.keys[0]!.joints[0]).toBe(-1)
  })

  it('rejects changed model bytes, joint order, names or installed joint count', () => {
    expect(() => validateClipSequence(sequence(), { ...profile, modelSha256: 'b'.repeat(64) }, limits)).toThrow('Incompatible')
    expect(() => validateClipSequence(sequence(), { ...profile, joints: [...profile.joints].reverse() }, limits)).toThrow('Incompatible')
    expect(() => validateClipSequence(sequence(), { ...profile, joints: profile.joints.slice(1) }, limits)).toThrow('Incompatible')
    expect(() => validateClipSequence(sequence(), { ...profile, joints: profile.joints.map(joint => ({ ...joint, name: `${joint.name}-new` })) }, limits)).toThrow('Incompatible')
  })

  it('rejects current tempo, duration, key count and servo-limit violations', () => {
    const value = sequence()
    expect(() => validateClipSequence({ ...value, bpm: limits.minBpm - 0.1 }, profile, limits)).toThrow('Incompatible')
    expect(() => validateClipSequence({ ...value, bpm: limits.maxBpm + 0.1 }, profile, limits)).toThrow('Incompatible')
    expect(() => validateClipSequence(value, profile, { ...limits, maxClipSeconds: 3.9 })).toThrow()
    expect(() => validateClipSequence(value, profile, { ...limits, maxClipKeys: 2 })).toThrow()
    value.clip.keys[1]!.joints[0] = profile.joints[0]!.upper + 0.001
    expect(() => validateClipSequence(value, profile, limits)).toThrow()
    value.clip.keys[1]!.joints[0] = profile.joints[0]!.lower - 0.001
    expect(() => validateClipSequence(value, profile, limits)).toThrow()
  })
})
