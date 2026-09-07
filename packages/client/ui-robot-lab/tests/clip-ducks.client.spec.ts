import { describe, expect, it } from 'vitest'
import { clipDuckPositions, sampleClipDuck, type ClipDuckDance } from '../src/client/clip-ducks.ts'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { compileClip, sampleAuthoredClip } from '../src/client/clip-motion.ts'
import { danceV2Model } from './dance-v2-fixture.ts'
const fixtureProfile = danceV2Model.profile

const clip = () => compileClip(fixtureProfile, [{ action: 'left-step', beats: 4 }, { action: 'stand', beats: 4 }], 120, 0.4, 'Duck 1', true)
const dance = (): ClipDuckDance => ({ id: 'independent', modelSha256: fixtureProfile.modelSha256, bpm: 60, clip: clip() })

describe('shared-clock companion ducks', () => {
  it('adds followers within the declared limit, retains stable ordinals and stops playback for review', () => {
    const store = createClipGenStore(120, 3).create()
    store.actions.addDuck()
    expect(store.getSnapshot().ducks).toEqual([])
    store.actions.load(clip()); store.actions.verify(true); store.actions.playing(true)
    store.actions.addDuck(); store.actions.addDuck(); store.actions.addDuck()
    expect(store.getSnapshot()).toMatchObject({ playing: false, verifiedRevision: null,
      ducks: [{ number: 2, dance: null }, { number: 3, dance: null }] })
    const before = store.getSnapshot()
    store.actions.removeDuck(1); store.actions.duckDance(100, dance())
    expect(store.getSnapshot()).toBe(before)
    store.actions.removeDuck(2); store.actions.addDuck()
    expect(store.getSnapshot().ducks.map(duck => duck.number)).toEqual([3, 4])
  })

  it('follows the live primary pose or independently samples the primary beat position', () => {
    const primary = sampleAuthoredClip(clip(), 1)
    expect(sampleClipDuck({ number: 2, dance: null }, primary, 1, 120)).toBe(primary)
    const independent = dance()
    expect(sampleClipDuck({ number: 3, dance: independent }, primary, 3, 120))
      .toEqual(sampleAuthoredClip(independent.clip, 2))
    expect(sampleClipDuck({ number: 3, dance: independent }, primary, 6, 60))
      .toEqual(sampleAuthoredClip(independent.clip, 2))
    independent.clip.loop = false
    expect(sampleClipDuck({ number: 3, dance: independent }, primary, 3, 120))
      .toEqual(sampleAuthoredClip(independent.clip, 4))
  })

  it('freezes a chosen preset independently, follows replacement primary clips by default, and locks recording mutations', () => {
    const store = createClipGenStore(120, 4).create()
    store.actions.duckDance(2, dance())
    store.actions.load(clip()); store.actions.addDuck(); store.actions.addDuck()
    const independent = dance()
    store.actions.duckDance(3, independent)
    independent.clip.name = 'Changed external object'
    expect(store.getSnapshot().ducks[1]!.dance!.clip.name).toBe('Duck 1')
    store.actions.load({ ...clip(), name: 'Replacement primary' })
    expect(store.getSnapshot().ducks[0]!.dance).toBeNull()
    expect(store.getSnapshot().ducks[1]!.dance!.clip.name).toBe('Duck 1')
    store.actions.previewReady(true); store.actions.verify(true); store.actions.generate()
    const captured = store.getSnapshot()
    store.actions.addDuck(); store.actions.removeDuck(2); store.actions.duckDance(3, null)
    expect(store.getSnapshot()).toBe(captured)
    store.actions.failure('aborted'); store.actions.duckDance(3, null)
    expect(store.getSnapshot().ducks.every(duck => duck.dance === null)).toBe(true)
    const following = store.getSnapshot()
    store.actions.duckDance(3, null)
    expect(store.getSnapshot()).toBe(following)
  })

  it('spaces centered rows without coincident actors and leaves a single duck at the origin', () => {
    expect(clipDuckPositions(1, 0.4)).toEqual([[0, 0]])
    expect(clipDuckPositions(3, 0.4)).toEqual([[-0.2, 0.2], [0.2, 0.2], [0, -0.2]])
    const positions = clipDuckPositions(8, 0.4)
    expect(new Set(positions.map(position => position.join(','))).size).toBe(8)
    expect(positions.flat().every(Number.isFinite)).toBe(true)
  })
})
