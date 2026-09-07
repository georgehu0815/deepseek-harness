import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { MicroDuckProps, StudioPlayerProps, StudioInjected } from '../src/client/studio-props.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'
import type { PlaybackSnapshot } from '../src/client/playback-transport.ts'
import { createRobotStore, type RobotDraft } from '../src/client/store.ts'
import { readySnapshot } from './fixtures.client.ts'
import { LearningPlan } from '../src/client/LearningPlan.tsx'
import { en } from '../src/client/locales.ts'
import { LearningReview } from '../src/client/LearningReview.tsx'

export const pausedPlayback: PlaybackSnapshot = {
  id: null, state: 'paused', time: 0, duration: 2, rate: 1, volume: 0.5, muted: false, mode: 'silent', error: null,
}

type Callbacks = Pick<StudioInjected, 'refresh' | 'execute' | 'saveProject' | 'openStudio' | 'readTime' | 'play' | 'pause'
  | 'restartPlayback' | 'seek' | 'volume' | 'mute' | 'playWithoutMusic' | 'downloadMusic' | 'setPlaybackRate'
  | 'saveTrial' | 'saveReflection' | 'reviewImprovement' | 'simulateGroup' | 'saveRoster' | 'loadRoster' | 'saveDraft' | 'loadDraft'>
type StudioFixture = { [K in keyof Callbacks]: Mock<Callbacks[K]> } & {
  store: ReturnType<ReturnType<typeof createRobotStore>['create']>
  props: MicroDuckProps & StudioPlayerProps
}

/**
 * Bind the renderer-owned store hook in this component fixture.
 * @param source - controlled view snapshot or the declared Robot store.
 * @returns the fixture's selector hook.
 */
export function bindStudioStore(source: ObservableSnapshot<RobotDraft>): MicroDuckProps['useStore'] {
  return selector => selector(useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot()))
}

/** Real declared store with plain fixtures for renderer-owned hook bindings. */
export function studioFixture(snapshot: LabSnapshot = readySnapshot(), playback: PlaybackSnapshot = pausedPlayback,
  messages: Record<keyof typeof en, string> = en): StudioFixture {
  const store = createRobotStore().create()
  const actions = { refresh: vi.fn(), execute: vi.fn(), saveProject: vi.fn(), openStudio: vi.fn(), simulateGroup: vi.fn(),
    saveTrial: vi.fn(), saveReflection: vi.fn(), reviewImprovement: vi.fn(), saveRoster: vi.fn(), loadRoster: vi.fn(),
    saveDraft: vi.fn(), loadDraft: vi.fn(),
    readTime: vi.fn(() => playback.time), play: vi.fn(), pause: vi.fn(), restartPlayback: vi.fn(),
    seek: vi.fn(), volume: vi.fn(), mute: vi.fn(), playWithoutMusic: vi.fn(), downloadMusic: vi.fn(), setPlaybackRate: vi.fn() }
  const props = {
    sessionId: 'session-one' as SessionId,
    t: (key, params) => {
      const template = messages[key as keyof typeof en]
      return params === undefined ? template
        : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
    },
    renderSlot: key => key === 'conversation.micro-duck.learning-plan' ? <LearningPlan {...props} /> : <LearningReview {...props} />,
    useLab: selector => selector(snapshot), usePlayback: selector => selector(playback),
    useStore: bindStudioStore(store),
    actions: store.actions,
    ...actions, draftMaxBytes: 4096, maxDpr: 1, maxGroupMembers: 8, simulationSteps: 1000, quickCheckSteps: 32,
    evaluation: { episodes: 5, stepsPerEpisode: 1000, seed: 0, maxTerminations: 0, minMeanUprightFraction: 0.9 },
  } as MicroDuckProps & StudioPlayerProps
  return { store, props, ...actions }
}
