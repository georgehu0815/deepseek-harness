/** Derived registration props for the two session-shared Clip Gen entries. */
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LabSnapshot } from './lab-client.ts'
import type { createClipGenStore, ClipVideoOutput } from './clip-gen-store.ts'
import type { createDanceGuideStore } from './dance-guide-store.ts'
import type { ClipSequence } from './clip-sequence.ts'

/** Captured editor values; the receiving action checks the edit epoch before replacing a timeline. */
export interface ClipSequenceInput { prompt: string; bpm: number; editEpoch: number }
/** Library-owned write callback; its persistence notice remains authoritative. */
export type SaveClipSequence = (prompt: string, sequence: ClipSequence) => void
import type {} from './clip-gen-locales.ts'

/** Deployment-owned browser capture limits. */
export interface ClipGenOptions {
  maxDpr: number
  defaultBpm: number
  frameRate: number
  videoBitsPerSecond: number
  finalizeTimeoutMs: number
  maxFileBytes: number
  maxDucks: number
}
/** The apply closure owns object URL retention and downloads; components receive serializable values. */
export interface ClipGenInjected extends ClipGenOptions {
  hooks: { lab: ObservableSnapshot<LabSnapshot> }
  refresh: () => void
  openWorkspace: () => void
  openTraining: () => void
  saveText: (text: string, filename: string) => void
  publishVideo: (video: ClipVideoOutput, withAudio: boolean) => void
  generateSequence: (input: ClipSequenceInput, save: SaveClipSequence) => void
  cancelSequence: () => void
}
/** Central authoring entry bound to its session's interaction store. */
export type ClipGenProps = PropsRuntime<'conversation.view'> & PropsLocale<'clip-gen'>
  & PropsStore<ReturnType<typeof createClipGenStore>> & InjectFace<ClipGenInjected>
  & PropsRenderSlots<'conversation.clip-gen.guides'>
/** Browser-wide guide collection; the owner callback targets only the currently rendered activity plan. */
export type DanceGuideProps = PropsRuntime<'conversation.clip-gen.guides'> & PropsLocale<'clip-gen'>
  & PropsStore<ReturnType<typeof createDanceGuideStore>>
/** Right viewport receives the same clip, playhead, selection and export state. */
export type ClipSimulationProps = PropsRuntime<'robot-lab.clip.player'> & PropsLocale<'clip-gen'>
  & PropsStore<ReturnType<typeof createClipGenStore>> & InjectFace<ClipGenInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Reusable browser-local instructions and validated sequences, independent of the session draft. */
    'conversation.clip-gen.guides': {
      kind: 'single'
      scope: 'root'
      owner: {
        prompt: string
        disabled: boolean
        onUse: (prompt: string, sequence?: ClipSequence) => void
        aiDisabled: boolean
        aiPending: boolean
        onSequenceByAI: (save: SaveClipSequence) => void
      }
    }
    /** Session-scoped authored preview; the visual entry supplies no owner arguments. */
    'robot-lab.clip.player': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
  }
}
