/** Session-scoped authoring state shared by Clip Gen and its Simulation workspace. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RobotProfile } from '@deepseek-ai/dsh-robot-lab/types'
import { rootYawLimit, type AuthoredClip } from './clip-preview.ts'
import { defaultClipPose, sampleAuthoredClip, rootPitchLimit } from './clip-motion.ts'
import type { ClipPose, ClipStep, ClipRig } from './clip-motion.ts'
import type { clipEn } from './clip-gen-locales.ts'
import type { ClipSequence } from './clip-sequence.ts'
import type { ClipSequenceRequestId } from './clip-sequence-agent.ts'
import type { DanceAudioId } from './dance-audio.ts'
import type { ClipDuck, ClipDuckDance } from './clip-ducks.ts'
import type { ClipSkinId } from './clip-skins.ts'
import type { ClipMusicChoice, ClipMusicCredit } from './clip-soundtrack.ts'
import { createClipStageSettings, type ClipStageSettings } from './clip-stage-settings.ts'

/** A live request may import only over the exact draft that the user submitted. */
export type ClipSequenceState =
  | { status: 'idle' }
  | { status: 'pending'; requestId: ClipSequenceRequestId; prompt: string; editEpoch: number }
  | { status: 'ready'; requestId: ClipSequenceRequestId; prompt: string; guide: string; sequence: ClipSequence; applied: boolean }

/** Stable localized failure identifiers shared by authoring and capture. */
export type ClipGenError = keyof typeof clipEn extends infer Key ? Key extends `error.${infer Code}` ? Code : never : never

/** Browser-owned media reference; URLs are released by the plugin, never persisted as draft data. */
export interface ClipVideoOutput {
  url: string
  filename: string
  clipJson: string
  revision: number
  bytes: number
  /** Soundtrack-bearing counterpart from the same reviewed capture, independent of later draft changes. */
  audio?: { url: string; bytes: number }
  /** Attribution for the recording actually captured, not the current draft choice. */
  musicCredit?: ClipMusicCredit
  /** Present for a multi-duck capture; clipJson still contains only Duck 1's training/reference data. */
  duckCount?: number
}
/** Shared editable controls, distinct from host training records. */
export interface ClipGenDraft {
  prompt: string
  steps: ClipStep[]
  bpm: number
  moveSize: number
  clip: AuthoredClip | null
  pose: ClipPose | null
  time: number
  playing: boolean
  unkeyed: boolean
  selectedJoint: number
  mode: 'joints' | 'rig'
  rig: ClipRig
  revision: number
  editEpoch: number
  ai: ClipSequenceState
  verifiedRevision: number | null
  cameraReset: number
  stage: ClipStageSettings
  ducks: ClipDuck[]
  /** Appearance targets are independent of Duck 1's joint editor and motion data. */
  skinDuckNumber: number
  duckSkins: Record<number, ClipSkinId> & { 1: ClipSkinId }
  nextDuckNumber: number
  playbackSpeed: number
  audioId: DanceAudioId | null
  musicChoice: ClipMusicChoice
  audioVolume: number
  audioMuted: boolean
  exportWithAudio: boolean
  previewReady: boolean
  exportRequest: number
  exporting: boolean
  video: ClipVideoOutput | null
  error: ClipGenError | null
}

function edited(draft: ClipGenDraft): void {
  draft.playing = false
  draft.verifiedRevision = null
  draft.revision += 1
  draft.editEpoch += 1
  draft.error = null
}

function loadSequence(draft: ClipGenDraft, prompt: string, sequence: ClipSequence): void {
  edited(draft)
  const clip = { ...sequence.clip, keys: sequence.clip.keys.map(key => ({ ...key, joints: [...key.joints] })) }
  draft.prompt = prompt; draft.bpm = sequence.bpm; draft.steps = []; draft.moveSize = 0.5; draft.audioId = null; draft.musicChoice = 'original'
  draft.clip = clip; draft.time = 0; draft.pose = sampleAuthoredClip(clip, 0); draft.unkeyed = false
}

/**
 * Declare shared controls without persisting media URLs or running operations.
 * @param defaultBpm - initial authoring tempo.
 * @param maxDucks - deployment-owned visible duck limit, including Duck 1.
 * @returns the renderer-owned, session-scoped store handle.
 */
export function createClipGenStore(defaultBpm: number, maxDucks: number): EngineStoreHandle<ClipGenDraft, {
  selectSkinDuck: (draft: ClipGenDraft, number: number) => void
  applySkin: (draft: ClipGenDraft, skin: ClipSkinId, scope: 'current' | 'all') => void
  addDuck: (draft: ClipGenDraft) => void
  removeDuck: (draft: ClipGenDraft, number: number) => void
  duckDance: (draft: ClipGenDraft, number: number, dance: ClipDuckDance | null) => void
  prompt: (draft: ClipGenDraft, value: string) => void
  sequence: (draft: ClipGenDraft, steps: ClipStep[], clip: AuthoredClip) => void
  parameters: (draft: ClipGenDraft, bpm: number, moveSize: number, steps: ClipStep[], clip: AuthoredClip) => void
  load: (draft: ClipGenDraft, clip: AuthoredClip) => void
  loadSequence: (draft: ClipGenDraft, prompt: string, sequence: ClipSequence) => void
  loadDance: (draft: ClipGenDraft, prompt: string, bpm: number, clip: AuthoredClip, audioId: DanceAudioId) => void
  chooseMusic: (draft: ClipGenDraft, choice: ClipMusicChoice) => void
  audioSettings: (draft: ClipGenDraft, settings: { volume?: number; muted?: boolean }) => void
  aiStart: (draft: ClipGenDraft, requestId: ClipSequenceRequestId, prompt: string, editEpoch: number) => void
  aiReceive: (draft: ClipGenDraft, requestId: ClipSequenceRequestId, sequence: ClipSequence, guide: string) => void
  aiFailure: (draft: ClipGenDraft, requestId: ClipSequenceRequestId, error: ClipGenError) => void
  aiCancel: (draft: ClipGenDraft) => void
  aiApply: (draft: ClipGenDraft) => void
  meta: (draft: ClipGenDraft, value: { name?: string; loop?: boolean; duration?: number }) => void
  select: (draft: ClipGenDraft, index: number) => void
  mode: (draft: ClipGenDraft, mode: ClipGenDraft['mode']) => void
  rig: (draft: ClipGenDraft, rig: ClipRig) => void
  pose: (draft: ClipGenDraft, pose: ClipPose) => void
  joint: (draft: ClipGenDraft, profile: RobotProfile, index: number, value: number) => void
  heading: (draft: ClipGenDraft, value: number) => void
  defaultPose: (draft: ClipGenDraft, profile: RobotProfile) => void
  key: (draft: ClipGenDraft, maxKeys: number) => void
  removeKey: (draft: ClipGenDraft) => void
  seek: (draft: ClipGenDraft, time: number) => void
  playing: (draft: ClipGenDraft, playing: boolean) => void
  tick: (draft: ClipGenDraft, time: number, playing: boolean) => void
  verify: (draft: ClipGenDraft, verified: boolean) => void
  focus: (draft: ClipGenDraft) => void
  stage: (draft: ClipGenDraft, settings: Partial<ClipStageSettings>) => void
  resetStage: (draft: ClipGenDraft) => void
  playbackSpeed: (draft: ClipGenDraft, speed: number) => void
  exportAudio: (draft: ClipGenDraft, checked: boolean) => void
  previewReady: (draft: ClipGenDraft, ready: boolean) => void
  generate: (draft: ClipGenDraft) => void
  generated: (draft: ClipGenDraft, video: ClipVideoOutput) => void
  failure: (draft: ClipGenDraft, code: ClipGenError) => void
  clearError: (draft: ClipGenDraft) => void
}> {
  return defineStore({
    init: (): ClipGenDraft => ({ prompt: '', steps: [], bpm: defaultBpm, moveSize: 0.5,
      clip: null, pose: null, time: 0, playing: false, unkeyed: false, selectedJoint: -1,
      mode: 'rig', rig: 'squat', revision: 0, editEpoch: 0, ai: { status: 'idle' }, verifiedRevision: null, cameraReset: 0, previewReady: false,
      stage: createClipStageSettings(), playbackSpeed: 1, audioId: null, musicChoice: 'original', audioVolume: 0.5, audioMuted: false, exportWithAudio: true,
      ducks: [], skinDuckNumber: 1, duckSkins: { 1: 'original' }, nextDuckNumber: 2,
      exportRequest: 0, exporting: false, video: null, error: null }),
    actions: {
      selectSkinDuck: (draft, number: number) => {
        if (!draft.exporting && (number === 1 || draft.ducks.some(duck => duck.number === number))) draft.skinDuckNumber = number
      },
      applySkin: (draft, skin: ClipSkinId, scope: 'current' | 'all') => {
        if (draft.exporting || draft.clip === null) return
        const targets = scope === 'all' ? [1, ...draft.ducks.map(duck => duck.number)] : [draft.skinDuckNumber]
        if (targets.every(number => draft.duckSkins[number] === skin)) return
        for (const number of targets) draft.duckSkins[number] = skin
        // Capture includes appearance; motion, transport and pending AI inputs are unchanged.
        draft.revision += 1; draft.verifiedRevision = null
      },
      addDuck: (draft) => {
        if (draft.exporting || draft.clip === null || draft.ducks.length + 1 >= maxDucks) return
        draft.duckSkins[draft.nextDuckNumber] = draft.duckSkins[1]
        edited(draft); draft.ducks.push({ number: draft.nextDuckNumber++, dance: null })
        draft.stage.cameraZoom = 1; draft.cameraReset += 1
      },
      removeDuck: (draft, number: number) => {
        if (draft.exporting || !draft.ducks.some(duck => duck.number === number)) return
        edited(draft); draft.ducks = draft.ducks.filter(duck => duck.number !== number)
        Reflect.deleteProperty(draft.duckSkins, number)
        if (draft.skinDuckNumber === number) draft.skinDuckNumber = 1
        draft.stage.cameraZoom = 1; draft.cameraReset += 1
      },
      duckDance: (draft, number: number, dance: ClipDuckDance | null) => {
        if (draft.exporting || draft.clip === null) return
        const duck = draft.ducks.find(duck => duck.number === number)
        if (duck === undefined || (duck.dance === null && dance === null)) return
        edited(draft); duck.dance = dance === null ? null : structuredClone(dance)
      },
      prompt: (draft, value: string) => {
        if (!draft.exporting) { draft.prompt = value; draft.editEpoch += 1; draft.verifiedRevision = null }
      },
      loadSequence: (draft, prompt: string, sequence: ClipSequence) => {
        if (!draft.exporting) loadSequence(draft, prompt, sequence)
      },
      loadDance: (draft, prompt: string, bpm: number, clip: AuthoredClip, audioId: DanceAudioId) => {
        if (draft.exporting) return
        edited(draft)
        draft.clip = structuredClone(clip)
        draft.prompt = prompt; draft.bpm = bpm; draft.steps = []; draft.moveSize = 0.5; draft.audioId = audioId; draft.musicChoice = 'original'
        draft.time = 0; draft.pose = sampleAuthoredClip(draft.clip, 0); draft.unkeyed = false
      },
      chooseMusic: (draft, choice: ClipMusicChoice) => {
        if (draft.exporting || draft.clip === null || draft.musicChoice === choice) return
        edited(draft); draft.musicChoice = choice
      },
      audioSettings: (draft, settings: { volume?: number; muted?: boolean }) => {
        if (draft.exporting) return
        if (settings.volume !== undefined) draft.audioVolume = Math.max(0, Math.min(1, settings.volume))
        if (settings.muted !== undefined) draft.audioMuted = settings.muted
      },
      aiStart: (draft, requestId: ClipSequenceRequestId, prompt: string, editEpoch: number) => {
        draft.ai = { status: 'pending', requestId, prompt, editEpoch }; draft.error = null
      },
      aiReceive: (draft, requestId: ClipSequenceRequestId, sequence: ClipSequence, guide: string) => {
        if (draft.ai.status !== 'pending' || draft.ai.requestId !== requestId) return
        const { prompt, editEpoch } = draft.ai
        const applied = !draft.exporting && draft.editEpoch === editEpoch
        if (applied) loadSequence(draft, guide, sequence)
        draft.ai = { status: 'ready', requestId, prompt, guide, sequence, applied }
      },
      aiFailure: (draft, requestId: ClipSequenceRequestId, error: ClipGenError) => {
        if (draft.ai.status !== 'pending' || draft.ai.requestId !== requestId) return
        draft.ai = { status: 'idle' }; draft.error = error
      },
      aiCancel: (draft) => { draft.ai = { status: 'idle' } },
      aiApply: (draft) => {
        if (draft.exporting || draft.ai.status !== 'ready') return
        loadSequence(draft, draft.ai.guide, draft.ai.sequence); draft.ai.applied = true
      },
      sequence: (draft, steps: ClipStep[], clip: AuthoredClip) => {
        if (draft.exporting) return
        edited(draft); draft.audioId = null; draft.musicChoice = 'original'; draft.steps = steps; draft.clip = clip; draft.pose = sampleAuthoredClip(clip, 0)
        draft.time = 0; draft.unkeyed = false
      },
      parameters: (draft, bpm: number, moveSize: number, steps: ClipStep[], clip: AuthoredClip) => {
        if (draft.exporting) return
        edited(draft); draft.audioId = null; draft.musicChoice = 'original'; draft.bpm = bpm; draft.moveSize = moveSize; draft.steps = steps
        draft.clip = clip; draft.time = 0; draft.pose = sampleAuthoredClip(clip, 0); draft.unkeyed = false
      },
      load: (draft, clip: AuthoredClip) => {
        if (draft.exporting) return
        edited(draft); draft.audioId = null; draft.musicChoice = 'original'; draft.clip = clip; draft.steps = []; draft.time = 0
        draft.pose = sampleAuthoredClip(clip, 0); draft.unkeyed = false
      },
      meta: (draft, value: { name?: string; loop?: boolean; duration?: number }) => {
        if (draft.exporting || draft.clip === null) return
        const clip = draft.clip
        edited(draft)
        if (value.name !== undefined) clip.name = value.name
        if (value.loop !== undefined) clip.loop = value.loop
        if (value.duration !== undefined) {
          const ratio = value.duration / clip.duration
          for (const key of clip.keys) key.t *= ratio
          if (clip.version === 3) for (const contact of clip.contacts) { contact.start *= ratio; contact.end *= ratio }
          draft.time *= ratio; draft.bpm /= ratio; clip.duration = value.duration
        }
      },
      select: (draft, index: number) => { draft.selectedJoint = index },
      mode: (draft, mode: ClipGenDraft['mode']) => { draft.mode = mode },
      rig: (draft, rig: ClipRig) => { draft.rig = rig },
      pose: (draft, pose: ClipPose) => {
        if (draft.exporting || draft.clip === null || draft.clip.version === 3) return
        edited(draft); draft.pose = pose; draft.unkeyed = true
      },
      joint: (draft, profile: RobotProfile, index: number, value: number) => {
        if (draft.exporting || draft.clip?.version === 3 || draft.pose === null) return
        edited(draft)
        if (index === -1) draft.pose.rootPitch = Math.max(-rootPitchLimit, Math.min(rootPitchLimit, value))
        else {
          const joint = profile.joints[index] as RobotProfile['joints'][number]
          draft.pose.joints[index] = Math.max(joint.lower, Math.min(joint.upper, value))
        }
        draft.unkeyed = true
      },
      heading: (draft, value: number) => {
        if (draft.exporting || draft.clip === null || draft.clip.version === 3 || draft.pose === null) return
        edited(draft)
        if (draft.clip.version === 1) draft.clip = { ...draft.clip, version: 2,
          keys: draft.clip.keys.map(key => ({ ...key, rootYaw: 0 })) }
        draft.pose.rootYaw = Math.max(-rootYawLimit, Math.min(rootYawLimit, value))
        draft.unkeyed = true
      },
      defaultPose: (draft, profile: RobotProfile) => {
        if (draft.exporting || draft.clip === null || draft.clip.version === 3) return
        edited(draft)
        draft.pose = { ...defaultClipPose(profile), ...(draft.clip.version === 2 ? { rootYaw: 0 } : {}) }
        draft.unkeyed = true
      },
      key: (draft, maxKeys: number) => {
        if (draft.exporting || draft.clip === null || draft.clip.version === 3 || draft.pose === null) return
        const index = draft.clip.keys.findIndex(key => Math.abs(key.t - draft.time) < 0.0001)
        if (index < 0 && draft.clip.keys.length >= maxKeys) { draft.error = 'keyLimit'; return }
        edited(draft)
        const key = { t: draft.time, joints: [...draft.pose.joints], rootPitch: draft.pose.rootPitch }
        if (draft.clip.version === 2) {
          const previewKey = { ...key, rootYaw: draft.pose.rootYaw ?? 0 }
          if (index >= 0) draft.clip.keys[index] = previewKey
          else draft.clip.keys.push(previewKey)
        } else if (index >= 0) draft.clip.keys[index] = key
        else draft.clip.keys.push(key)
        draft.clip.keys.sort((a, b) => a.t - b.t)
        draft.unkeyed = false
      },
      removeKey: (draft) => {
        if (draft.exporting || draft.clip === null || draft.clip.version === 3 || draft.time === 0 || draft.clip.keys.length <= 2) return
        const index = draft.clip.keys.findIndex(key => Math.abs(key.t - draft.time) < 0.0001)
        if (index < 0) return
        edited(draft); draft.clip.keys.splice(index, 1); draft.pose = sampleAuthoredClip(draft.clip, draft.time); draft.unkeyed = false
      },
      seek: (draft, time: number) => {
        if (draft.exporting || draft.clip === null) return
        draft.playing = false; draft.time = Math.max(0, Math.min(draft.clip.duration, time))
        draft.pose = sampleAuthoredClip(draft.clip, draft.time); draft.unkeyed = false
      },
      playing: (draft, playing: boolean) => {
        if (draft.exporting || draft.clip === null || draft.unkeyed) return
        if (playing && draft.time >= draft.clip.duration) { draft.time = 0; draft.pose = sampleAuthoredClip(draft.clip, 0) }
        if (playing && draft.error === 'audio') draft.error = null
        draft.playing = playing
      },
      tick: (draft, time: number, playing: boolean) => {
        if (draft.clip === null) return
        draft.time = time; draft.pose = sampleAuthoredClip(draft.clip, time); draft.playing = playing
      },
      verify: (draft, verified: boolean) => {
        draft.verifiedRevision = verified && !draft.unkeyed && draft.clip !== null ? draft.revision : null
      },
      focus: (draft) => { if (!draft.exporting) { draft.stage.cameraZoom = 1; draft.cameraReset += 1 } },
      stage: (draft, settings: Partial<ClipStageSettings>) => {
        if (!draft.exporting) Object.assign(draft.stage, settings)
      },
      resetStage: (draft) => {
        if (draft.exporting) return
        draft.stage = createClipStageSettings(); draft.cameraReset += 1
      },
      playbackSpeed: (draft, speed: number) => {
        if (!draft.exporting) draft.playbackSpeed = speed
      },
      exportAudio: (draft, checked: boolean) => { if (!draft.exporting) draft.exportWithAudio = checked },
      previewReady: (draft, ready: boolean) => { draft.previewReady = ready },
      generate: (draft) => {
        if (draft.exporting || !draft.previewReady || draft.clip === null || draft.unkeyed
          || draft.verifiedRevision !== draft.revision) return
        draft.exportRequest += 1; draft.exporting = true; draft.playing = false
        draft.time = 0; draft.pose = sampleAuthoredClip(draft.clip, 0); draft.error = null
      },
      generated: (draft, video: ClipVideoOutput) => {
        draft.exporting = false; draft.playing = false; draft.video = video; draft.error = null
      },
      failure: (draft, code: ClipGenError) => { draft.error = code; draft.exporting = false; draft.playing = false },
      clearError: (draft) => { draft.error = null },
    },
  })
}
