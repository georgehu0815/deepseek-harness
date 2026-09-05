import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MicroDuckProps, StudioPlayerProps, StudioInjected } from '../src/client/studio-props.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'
import type { PlaybackSnapshot } from '../src/client/playback-transport.ts'
import { createRobotStore } from '../src/client/store.ts'
import { readySnapshot } from './fixtures.client.ts'
import { LearningPlan } from '../src/client/LearningPlan.tsx'
import { LearningReview } from '../src/client/LearningReview.tsx'

export const pausedPlayback: PlaybackSnapshot = {
  id: null, state: 'paused', time: 0, duration: 2, rate: 1, volume: 0.5, muted: false, mode: 'silent', error: null,
}

type Callbacks = Pick<StudioInjected, 'refresh' | 'execute' | 'saveProject' | 'openStudio' | 'readTime' | 'play' | 'pause'
  | 'restartPlayback' | 'seek' | 'volume' | 'mute' | 'playWithoutMusic' | 'downloadMusic' | 'setPlaybackRate'
  | 'saveTrial' | 'saveReflection' | 'reviewImprovement' | 'simulateGroup' | 'saveRoster' | 'loadRoster'>
type StudioFixture = { [K in keyof Callbacks]: Mock<Callbacks[K]> } & {
  store: ReturnType<ReturnType<typeof createRobotStore>['create']>
  props: MicroDuckProps & StudioPlayerProps
}

/** Real declared store with plain fixtures for renderer-owned hook bindings. */
export function studioFixture(snapshot: LabSnapshot = readySnapshot(), playback: PlaybackSnapshot = pausedPlayback): StudioFixture {
  const store = createRobotStore().create()
  const actions = { refresh: vi.fn(), execute: vi.fn(), saveProject: vi.fn(), openStudio: vi.fn(), simulateGroup: vi.fn(),
    saveTrial: vi.fn(), saveReflection: vi.fn(), reviewImprovement: vi.fn(), saveRoster: vi.fn(), loadRoster: vi.fn(),
    readTime: vi.fn(() => playback.time), play: vi.fn(), pause: vi.fn(), restartPlayback: vi.fn(),
    seek: vi.fn(), volume: vi.fn(), mute: vi.fn(), playWithoutMusic: vi.fn(), downloadMusic: vi.fn(), setPlaybackRate: vi.fn() }
  const props = {
    sessionId: 'session-one' as SessionId,
    renderSlot: key => key === 'conversation.micro-duck.learning-plan' ? <LearningPlan {...props} /> : <LearningReview {...props} />,
    useLab: selector => selector(snapshot), usePlayback: selector => selector(playback),
    useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    actions: store.actions,
    ...actions, maxDpr: 1, maxGroupMembers: 8, simulationSteps: 1000, quickCheckSteps: 32,
    evaluation: { episodes: 5, stepsPerEpisode: 1000, seed: 0, maxTerminations: 0, minMeanUprightFraction: 0.9 },
  } as MicroDuckProps & StudioPlayerProps
  return { store, props, ...actions }
}
