import { describe, expect, it } from 'vitest'
import type { RobotClip } from '@deepseek-ai/dsh-robot-lab/types'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import type { ClipVideoOutput } from '../src/client/clip-gen-store.ts'
import { defaultClipPose, rootPitchLimit } from '../src/client/clip-motion.ts'
import { fixtureProfile, fixtureProject } from './fixtures.client.ts'
import { parseClipSequence } from '../src/client/clip-sequence.ts'
import type { ClipSequenceRequestId } from '../src/client/clip-sequence-agent.ts'

function clip(): RobotClip {
  return { ...structuredClone(fixtureProject.clip), keys: [
    { t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
    { t: 2, joints: Array<number>(14).fill(0.2), rootPitch: 0.4 },
    { t: 4, joints: Array<number>(14).fill(0), rootPitch: 0 },
  ] }
}
function editor() {
  const store = createClipGenStore(96, 8).create()
  store.actions.load(clip())
  return store
}
function video(revision: number): ClipVideoOutput {
  return { url: 'blob:owned-recording', filename: '舞蹈.mp4', clipJson: JSON.stringify(clip()), revision, bytes: 128 }
}
const generatedGuide = '0–2 s: 左右轻摆头。\n2–4 s: 回到自然站姿。'
const requestId = '11111111-1111-4111-8111-111111111111' as ClipSequenceRequestId
const secondRequestId = '22222222-2222-4222-8222-222222222222' as ClipSequenceRequestId
function sequence() {
  const authored = clip()
  authored.name = '精确 🦆 timeline'
  authored.loop = true
  authored.keys.splice(1, 0, { t: 0.375, joints: Array<number>(14).fill(0.1234), rootPitch: -0.2 })
  return parseClipSequence({ version: 1, modelSha256: 'a'.repeat(64), jointNames: fixtureProfile.joints.map(joint => joint.name),
    bpm: 123.5, clip: authored })
}

describe('Clip Gen correlated sequence imports', () => {
  it('loads exact keys and tempo as a dirty independent timeline without restoring recipe or evidence', () => {
    const store = editor()
    store.actions.parameters(90, 0.9, [{ action: 'stand', beats: 8 }], clip())
    store.actions.seek(2)
    store.actions.verify(true)
    store.actions.playing(true)
    const oldVideo = video(store.getSnapshot().revision)
    store.actions.generated(oldVideo)
    const before = store.getSnapshot()
    const saved = sequence()
    const original = structuredClone(saved)
    store.actions.loadSequence('  Exact prompt 🦆\n', saved)
    expect(store.getSnapshot()).toMatchObject({ prompt: '  Exact prompt 🦆\n', bpm: 123.5, steps: [], moveSize: 0.5,
      clip: original.clip, pose: { joints: original.clip.keys[0]!.joints, rootPitch: original.clip.keys[0]!.rootPitch },
      time: 0, playing: false, unkeyed: false, verifiedRevision: null, revision: before.revision + 1,
      editEpoch: before.editEpoch + 1, video: oldVideo, exporting: false, ai: { status: 'idle' } })
    saved.clip.keys[1]!.joints[0] = 0.9
    expect(store.getSnapshot().clip).toEqual(original.clip)
    store.actions.seek(0.375); store.actions.joint(fixtureProfile, 0, 0.8); store.actions.key(100)
    expect(store.getSnapshot().clip?.keys[1]?.joints[0]).toBe(0.8)
    expect(original.clip.keys[1]?.joints[0]).toBe(0.1234)
    expect(saved.clip.keys[1]?.joints[0]).toBe(0.9)
  })

  it('autoapplies one matching reply only while its captured edit epoch remains current', () => {
    const store = editor()
    store.actions.prompt('Submitted dance')
    store.actions.verify(true)
    store.actions.playing(true)
    const before = store.getSnapshot()
    const result = sequence()
    store.actions.aiStart(requestId, before.prompt, before.editEpoch)
    expect(store.getSnapshot()).toMatchObject({ ai: { status: 'pending', requestId, prompt: 'Submitted dance',
      editEpoch: before.editEpoch }, revision: before.revision, error: null })
    store.actions.aiReceive(requestId, result, generatedGuide)
    const applied = store.getSnapshot()
    expect(applied).toMatchObject({ prompt: generatedGuide, clip: result.clip, bpm: result.bpm,
      revision: before.revision + 1, editEpoch: before.editEpoch + 1, time: 0, playing: false,
      unkeyed: false, verifiedRevision: null, ai: { status: 'ready', requestId, prompt: 'Submitted dance', guide: generatedGuide, sequence: result, applied: true } })
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    store.actions.aiFailure(requestId, 'aiResponse')
    expect(store.getSnapshot()).toEqual(applied)
    store.actions.seek(0.375); store.actions.joint(fixtureProfile, 0, 0.8); store.actions.key(100)
    expect(result.clip.keys[1]!.joints[0]).toBe(0.1234)
    const ai = store.getSnapshot().ai
    expect(ai.status).toBe('ready')
    if (ai.status !== 'ready') throw new Error('Missing ready sequence')
    expect(ai.sequence.clip.keys[1]!.joints[0]).toBe(0.1234)
  })

  it('keeps a reply as a candidate after the prompt changes away and back', () => {
    const store = editor()
    store.actions.prompt('Original prompt')
    const before = store.getSnapshot()
    store.actions.aiStart(requestId, before.prompt, before.editEpoch)
    store.actions.prompt('Different prompt')
    store.actions.prompt('Original prompt')
    expect(store.getSnapshot().editEpoch).toBe(before.editEpoch + 2)
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    expect(store.getSnapshot()).toMatchObject({ prompt: before.prompt, clip: before.clip, revision: before.revision,
      ai: { status: 'ready', applied: false } })
    store.actions.verify(true)
    store.actions.playing(true)
    store.actions.aiApply()
    expect(store.getSnapshot()).toMatchObject({ clip: sequence().clip, prompt: generatedGuide, bpm: 123.5,
      revision: before.revision + 1, editEpoch: before.editEpoch + 3,
      verifiedRevision: null, playing: false, time: 0, ai: { status: 'ready', applied: true } })
  })

  it('retains a manually edited pose and keys when a pending reply arrives', () => {
    const store = editor()
    store.actions.aiStart(requestId, 'Generated prompt', store.getSnapshot().editEpoch)
    store.actions.seek(1)
    store.actions.joint(fixtureProfile, 0, 0.7)
    store.actions.key(100)
    store.actions.joint(fixtureProfile, 1, 0.6)
    const edited = store.getSnapshot()
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    expect(store.getSnapshot()).toMatchObject({ clip: edited.clip, pose: edited.pose, time: 1, unkeyed: true,
      revision: edited.revision, editEpoch: edited.editEpoch, ai: { status: 'ready', applied: false } })
    store.actions.aiApply()
    expect(store.getSnapshot()).toMatchObject({ clip: sequence().clip, prompt: generatedGuide, time: 0,
      unkeyed: false, verifiedRevision: null, revision: edited.revision + 1 })
  })

  it('does not treat viewing controls as authoring edits while waiting', () => {
    const store = editor()
    const epoch = store.getSnapshot().editEpoch
    store.actions.aiStart(requestId, 'Generated prompt', epoch)
    store.actions.select(2); store.actions.mode('joints'); store.actions.rig('lean')
    store.actions.seek(2); store.actions.focus(); store.actions.previewReady(true); store.actions.verify(true)
    expect(store.getSnapshot().editEpoch).toBe(epoch)
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    expect(store.getSnapshot()).toMatchObject({ ai: { status: 'ready', applied: true }, time: 0, verifiedRevision: null })
  })

  it('ignores old request replies and failures after a newer request starts', () => {
    const store = editor()
    const epoch = store.getSnapshot().editEpoch
    store.actions.aiStart(requestId, 'Old prompt', epoch)
    store.actions.aiStart(secondRequestId, 'New prompt', epoch)
    const waiting = store.getSnapshot()
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    store.actions.aiFailure(requestId, 'aiSend')
    expect(store.getSnapshot()).toEqual(waiting)
    store.actions.aiReceive(secondRequestId, sequence(), generatedGuide)
    expect(store.getSnapshot()).toMatchObject({ prompt: generatedGuide, ai: { status: 'ready', requestId: secondRequestId, prompt: 'New prompt', guide: generatedGuide, applied: true } })
  })

  it('cancels pending or retained candidates and ignores their late deliveries', () => {
    const store = editor()
    const before = store.getSnapshot()
    store.actions.aiApply()
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    store.actions.aiFailure(requestId, 'aiResponse')
    expect(store.getSnapshot()).toEqual(before)
    store.actions.aiStart(requestId, 'Cancelled prompt', before.editEpoch)
    store.actions.aiApply()
    expect(store.getSnapshot().clip).toEqual(before.clip)
    store.actions.aiCancel()
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    store.actions.aiFailure(requestId, 'aiSend')
    expect(store.getSnapshot()).toEqual(before)
    store.actions.aiStart(secondRequestId, 'Candidate prompt', before.editEpoch)
    store.actions.prompt('Edited locally')
    store.actions.aiReceive(secondRequestId, sequence(), generatedGuide)
    store.actions.aiCancel()
    store.actions.aiApply()
    expect(store.getSnapshot()).toMatchObject({ ai: { status: 'idle' }, prompt: 'Edited locally', clip: before.clip })
  })

  it('settles only matching pending failures and keeps the authored clip unchanged', () => {
    const store = editor()
    const before = store.getSnapshot()
    store.actions.aiStart(requestId, 'Failed prompt', before.editEpoch)
    store.actions.aiFailure(requestId, 'aiResponse')
    expect(store.getSnapshot()).toMatchObject({ ai: { status: 'idle' }, clip: before.clip, revision: before.revision,
      editEpoch: before.editEpoch, error: 'aiResponse' })
    store.actions.aiStart(secondRequestId, 'Retry', before.editEpoch)
    expect(store.getSnapshot().error).toBeNull()
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    expect(store.getSnapshot().ai).toMatchObject({ status: 'pending', requestId: secondRequestId })
  })

  it('preserves the captured clip during export and requires explicit candidate application afterward', () => {
    const store = editor()
    store.actions.aiStart(requestId, 'Generated prompt', store.getSnapshot().editEpoch)
    store.actions.previewReady(true); store.actions.verify(true); store.actions.generate()
    const capturing = store.getSnapshot()
    store.actions.loadSequence('Library prompt', sequence())
    expect(store.getSnapshot()).toEqual(capturing)
    store.actions.aiReceive(requestId, sequence(), generatedGuide)
    expect(store.getSnapshot()).toMatchObject({ clip: capturing.clip, exporting: true, revision: capturing.revision,
      verifiedRevision: capturing.verifiedRevision, ai: { status: 'ready', applied: false } })
    const candidate = store.getSnapshot()
    store.actions.aiApply()
    expect(store.getSnapshot()).toEqual(candidate)
    store.actions.generated(video(capturing.revision))
    expect(store.getSnapshot().clip).toEqual(capturing.clip)
    store.actions.aiApply()
    expect(store.getSnapshot()).toMatchObject({ clip: sequence().clip, exporting: false, verifiedRevision: null,
      revision: capturing.revision + 1, ai: { status: 'ready', applied: true } })
  })

  it('keeps library imports and agent requests isolated between session stores', () => {
    const handle = createClipGenStore(96, 8)
    const first = handle.create(); const second = handle.create()
    first.actions.loadSequence('First prompt', sequence())
    const original = first.getSnapshot()
    second.actions.aiStart(requestId, 'Second prompt', second.getSnapshot().editEpoch)
    second.actions.aiReceive(requestId, sequence(), generatedGuide)
    second.actions.meta({ name: 'Edited second timeline' })
    expect(first.getSnapshot()).toEqual(original)
    expect(second.getSnapshot()).toMatchObject({ prompt: generatedGuide, clip: { name: 'Edited second timeline' } })
  })
})

describe('Clip Gen session-scoped authoring store', () => {
  it('keeps independent session stores and caller-provided tempo defaults', () => {
    const handle = createClipGenStore(110, 8)
    const first = handle.create()
    const second = handle.create()
    first.actions.prompt('left step')
    expect(first.getSnapshot()).toMatchObject({ prompt: 'left step', bpm: 110, clip: null, pose: null,
      revision: 0, verifiedRevision: null, playing: false, previewReady: false, exporting: false, video: null })
    expect(second.getSnapshot().prompt).toBe('')
  })

  it('builds, recompiles and loads clips as dirty independent authoring revisions', () => {
    const store = createClipGenStore(96, 8).create()
    const steps = [{ action: 'left-step' as const, beats: 2 }]
    store.actions.sequence(steps, clip())
    expect(store.getSnapshot()).toMatchObject({ steps, revision: 1, time: 0, pose: defaultClipPose(fixtureProfile), unkeyed: false })
    store.actions.verify(true)
    store.actions.playing(true)
    store.actions.parameters(120, 0.8, steps, clip())
    expect(store.getSnapshot()).toMatchObject({ bpm: 120, moveSize: 0.8, revision: 2, verifiedRevision: null, playing: false })
    store.actions.load({ ...clip(), name: 'Imported 🦆' })
    expect(store.getSnapshot()).toMatchObject({ steps: [], revision: 3, clip: { name: 'Imported 🦆' }, time: 0 })
  })

  it('requires a keyed current revision and explicit verification before video generation', () => {
    const store = createClipGenStore(96, 8).create()
    store.actions.previewReady(true)
    store.actions.verify(true)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ verifiedRevision: null, exportRequest: 0, exporting: false })
    store.actions.load(clip())
    store.actions.generate()
    expect(store.getSnapshot().exportRequest).toBe(0)
    store.actions.joint(fixtureProfile, 0, 0.3)
    store.actions.verify(true)
    expect(store.getSnapshot().verifiedRevision).toBeNull()
    store.actions.generate()
    expect(store.getSnapshot().exporting).toBe(false)
    store.actions.key(10)
    store.actions.verify(true)
    const revision = store.getSnapshot().revision
    expect(store.getSnapshot().verifiedRevision).toBe(revision)
    store.actions.seek(2)
    store.actions.playing(true)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ exporting: true, exportRequest: 1, playing: false, time: 0,
      revision, verifiedRevision: revision, error: null })
    expect(store.getSnapshot().pose?.joints[0]).toBe(0.3)
    store.actions.generate()
    expect(store.getSnapshot().exportRequest).toBe(1)
  })

  it('refuses generation until a usable preview exists and after that preview is removed', () => {
    const store = editor()
    store.actions.verify(true)
    const revision = store.getSnapshot().revision
    expect(store.getSnapshot().previewReady).toBe(false)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ exporting: false, exportRequest: 0 })
    store.actions.previewReady(true)
    store.actions.previewReady(false)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ revision, verifiedRevision: revision, exporting: false, exportRequest: 0 })
    store.actions.previewReady(true)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ exporting: true, exportRequest: 1 })
    store.actions.generated(video(revision))
    store.actions.previewReady(false)
    store.actions.generate()
    expect(store.getSnapshot()).toMatchObject({ previewReady: false, exporting: false, exportRequest: 1 })
  })

  it('invalidates verification for changed prompts, metadata and target poses', () => {
    const store = editor()
    store.actions.verify(true)
    store.actions.prompt('A different request')
    expect(store.getSnapshot().verifiedRevision).toBeNull()
    store.actions.verify(true)
    store.actions.verify(false)
    expect(store.getSnapshot().verifiedRevision).toBeNull()
    store.actions.verify(true)
    store.actions.meta({ name: 'New', loop: true })
    expect(store.getSnapshot()).toMatchObject({ verifiedRevision: null, revision: 2, clip: { name: 'New', loop: true } })
    store.actions.verify(true)
    store.actions.pose({ joints: Array<number>(14).fill(0.1), rootPitch: 0.2 })
    expect(store.getSnapshot()).toMatchObject({ verifiedRevision: null, revision: 3, unkeyed: true })
  })

  it('retimes all keys and the current playhead without changing the current pose', () => {
    const store = editor()
    store.actions.seek(1)
    const pose = store.getSnapshot().pose
    store.actions.meta({ duration: 8 })
    expect(store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 4, 8])
    expect(store.getSnapshot()).toMatchObject({ time: 2, pose, clip: { duration: 8 } })
  })

  it('clamps joint and root edits and restores a standing unkeyed pose', () => {
    const store = editor()
    store.actions.joint(fixtureProfile, 0, 100)
    expect(store.getSnapshot().pose?.joints[0]).toBe(1)
    store.actions.joint(fixtureProfile, 0, -100)
    expect(store.getSnapshot().pose?.joints[0]).toBe(-1)
    store.actions.joint(fixtureProfile, -1, 100)
    expect(store.getSnapshot().pose?.rootPitch).toBe(rootPitchLimit)
    store.actions.joint(fixtureProfile, -1, -100)
    expect(store.getSnapshot().pose?.rootPitch).toBe(-rootPitchLimit)
    store.actions.defaultPose(fixtureProfile)
    expect(store.getSnapshot()).toMatchObject({ pose: defaultClipPose(fixtureProfile), unkeyed: true })
    store.actions.playing(true)
    expect(store.getSnapshot().playing).toBe(false)
  })

  it('inserts keys in time order, replaces an existing key and respects the full key limit', () => {
    const store = editor()
    store.actions.seek(1)
    store.actions.joint(fixtureProfile, 0, 0.7)
    store.actions.key(4)
    expect(store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 1, 2, 4])
    expect(store.getSnapshot().clip?.keys[1]?.joints[0]).toBe(0.7)
    expect(store.getSnapshot().unkeyed).toBe(false)
    store.actions.joint(fixtureProfile, 0, 0.8)
    store.actions.key(4)
    expect(store.getSnapshot().clip?.keys).toHaveLength(4)
    expect(store.getSnapshot().clip?.keys[1]?.joints[0]).toBe(0.8)
    store.actions.seek(3)
    store.actions.joint(fixtureProfile, 0, 0.9)
    const revision = store.getSnapshot().revision
    store.actions.key(4)
    expect(store.getSnapshot()).toMatchObject({ revision, error: 'keyLimit', unkeyed: true })
    expect(store.getSnapshot().clip?.keys).toHaveLength(4)
  })

  it('protects time zero and the minimum key count while removing an interior key', () => {
    const store = editor()
    store.actions.removeKey()
    expect(store.getSnapshot().clip?.keys).toHaveLength(3)
    store.actions.seek(1)
    store.actions.removeKey()
    expect(store.getSnapshot().clip?.keys).toHaveLength(3)
    store.actions.seek(2)
    store.actions.removeKey()
    expect(store.getSnapshot()).toMatchObject({ unkeyed: false, revision: 2, pose: defaultClipPose(fixtureProfile) })
    expect(store.getSnapshot().clip?.keys.map(key => key.t)).toEqual([0, 4])
    store.actions.seek(4)
    store.actions.removeKey()
    expect(store.getSnapshot().clip?.keys).toHaveLength(2)
  })

  it('clamps seeks, discards unkeyed edits and restarts playback from the endpoint', () => {
    const store = editor()
    store.actions.joint(fixtureProfile, 0, 0.8)
    store.actions.seek(-10)
    expect(store.getSnapshot()).toMatchObject({ time: 0, unkeyed: false, pose: defaultClipPose(fixtureProfile) })
    store.actions.seek(100)
    expect(store.getSnapshot().time).toBe(4)
    store.actions.playing(true)
    expect(store.getSnapshot()).toMatchObject({ time: 0, playing: true })
    store.actions.tick(1, true)
    expect(store.getSnapshot()).toMatchObject({ time: 1, playing: true, pose: { rootPitch: 0.2, joints: Array<number>(14).fill(0.1) } })
    store.actions.playing(false)
    expect(store.getSnapshot().playing).toBe(false)
  })

  it('ignores authoring, playback-control and repeated generation commands during capture', () => {
    const store = editor()
    store.actions.previewReady(true)
    store.actions.verify(true)
    store.actions.generate()
    const before = store.getSnapshot()
    store.actions.prompt('replacement')
    store.actions.sequence([{ action: 'stand', beats: 1 }], clip())
    store.actions.parameters(120, 1, [], clip())
    store.actions.load(clip())
    store.actions.meta({ name: 'replacement', duration: 1, loop: true })
    store.actions.pose(defaultClipPose(fixtureProfile))
    store.actions.joint(fixtureProfile, 0, 1)
    store.actions.defaultPose(fixtureProfile)
    store.actions.key(100)
    store.actions.removeKey()
    store.actions.seek(2)
    store.actions.playing(true)
    store.actions.generate()
    expect(store.getSnapshot()).toEqual(before)
    store.actions.tick(1, true)
    expect(store.getSnapshot()).toMatchObject({ exporting: true, time: 1, playing: true })
  })

  it('keeps viewing controls separate from authoring revisions and publishes completed media', () => {
    const store = editor()
    store.actions.select(3)
    store.actions.mode('joints')
    store.actions.rig('lean')
    store.actions.focus()
    expect(store.getSnapshot()).toMatchObject({ revision: 1, selectedJoint: 3, mode: 'joints', rig: 'lean', cameraReset: 1 })
    store.actions.previewReady(true)
    store.actions.verify(true)
    store.actions.generate()
    const result = video(store.getSnapshot().revision)
    store.actions.generated(result)
    expect(store.getSnapshot()).toMatchObject({ video: result, exporting: false, playing: false, error: null })
    store.actions.generate()
    expect(store.getSnapshot().exportRequest).toBe(2)
    store.actions.failure('unavailable')
    expect(store.getSnapshot()).toMatchObject({ video: result, exporting: false, playing: false, error: 'unavailable' })
    store.actions.clearError()
    expect(store.getSnapshot().error).toBeNull()
  })

  it('ignores clip-dependent editing commands before a clip is loaded', () => {
    const store = createClipGenStore(96, 8).create()
    const before = store.getSnapshot()
    store.actions.meta({ name: 'absent' })
    store.actions.pose(defaultClipPose(fixtureProfile))
    store.actions.joint(fixtureProfile, 0, 1)
    store.actions.defaultPose(fixtureProfile)
    store.actions.key(10)
    store.actions.removeKey()
    store.actions.seek(1)
    store.actions.playing(true)
    store.actions.tick(1, true)
    expect(store.getSnapshot()).toEqual(before)
  })
})
