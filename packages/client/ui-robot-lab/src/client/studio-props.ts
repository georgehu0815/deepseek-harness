/** Plain session-bound data and actions shared by the control panel and the player. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RobotEvaluationSpec, RobotLabRequest, RobotMusicRecipe, RobotProjectRecipe, RobotTrialRecipe, RobotReflection, RobotReflectionRequest } from '@deepseek-ai/dsh-robot-lab/types'
import type { LabSnapshot } from './lab-client.ts'
import type { DuckMember } from './group-playback.ts'
import type { RosterFile } from './roster-file.ts'
import type { PlaybackSnapshot } from './playback-transport.ts'
import type { createRobotStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Provide the session player inside Robot Studio; the owner passes no arguments.
     * The component receives session-scoped runtime props plus its declared store and injections.
     * The selected registration replaces the default player; no registration leaves the player area empty.
     */
    'robot-lab.visual.player': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Session-owned trial planning section; the parent passes no owner arguments. */
    'conversation.micro-duck.learning-plan': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Session-owned assessment and reflection section; the parent passes no owner arguments. */
    'conversation.micro-duck.learning-review': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
  }
}

/** The renderer binds both sources; components receive callbacks rather than service objects. */
export interface StudioInjected {
  hooks: { lab: ObservableSnapshot<LabSnapshot>; playback: ObservableSnapshot<PlaybackSnapshot> }
  refresh: () => void
  execute: (request: RobotLabRequest) => void
  simulateGroup: (members: DuckMember[], steps: number, seed: number) => void
  maxGroupMembers: number
  saveRoster: (value: RosterFile) => void
  loadRoster: (text: string) => void
  saveProject: (recipe: RobotProjectRecipe, editVersion: number, preview: boolean) => void
  saveTrial: (recipe: RobotTrialRecipe, start: boolean) => void
  saveReflection: (reflection: RobotReflectionRequest) => void
  reviewImprovement: (reflection: RobotReflection) => void
  openStudio: () => void
  readTime: () => number
  play: () => void
  pause: () => void
  restartPlayback: () => void
  seek: (seconds: number) => void
  volume: (value: number) => void
  mute: (value: boolean) => void
  setPlaybackRate: (value: number) => void
  playWithoutMusic: () => void
  downloadMusic: (recipe: RobotMusicRecipe) => void
  maxDpr: number
  simulationSteps: number
  quickCheckSteps: number
  evaluation: Omit<RobotEvaluationSpec, 'policyId'>
}

/** Center tab owns rendering authorization for its two session-scoped learning sections. */
export type MicroDuckProps = PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'conversation.micro-duck.learning-plan' | 'conversation.micro-duck.learning-review'>
  & PropsStore<ReturnType<typeof createRobotStore>> & InjectFace<StudioInjected>
/** Planning receives its own framework bindings over the center tab's session-owned store and controller. */
export type LearningPlanProps = PropsRuntime<'conversation.micro-duck.learning-plan'>
  & PropsStore<ReturnType<typeof createRobotStore>> & InjectFace<StudioInjected>
/** Review receives its own framework bindings over the same session-owned store and controller. */
export type LearningReviewProps = PropsRuntime<'conversation.micro-duck.learning-review'>
  & PropsStore<ReturnType<typeof createRobotStore>> & InjectFace<StudioInjected>
/** The session-scoped player shares exactly the center tab's store handle. */
export type StudioPlayerProps = PropsRuntime<'robot-lab.visual.player'> & PropsStore<ReturnType<typeof createRobotStore>> & InjectFace<StudioInjected>
