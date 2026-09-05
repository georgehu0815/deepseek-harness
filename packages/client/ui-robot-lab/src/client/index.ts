/** Native Micro Duck authoring and a session-shared Robot Studio player. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LabClient } from './lab-client.ts'
import { RobotLab } from './RobotLab.tsx'
import { MicroDuckPanel } from './MicroDuckPanel.tsx'
import { LearningPlan } from './LearningPlan.tsx'
import { LearningReview } from './LearningReview.tsx'
import { StudioPlayer } from './StudioPlayer.tsx'
import type { StudioInjected } from './studio-props.ts'
import type {} from './studio-props.ts'
import { createRobotStore } from './store.ts'
import { SidebarButton } from './SidebarButton.tsx'
import { PlaybackTransport, validatePlaybackOptions } from './playback-transport.ts'
import { encodeMusicWav, generateMusic } from './music.ts'
import { encodeRosterFile, parseRosterFile } from './roster-file.ts'

/** Browser resource, local music and evaluation settings, validated at plugin activation. */
export interface Config {
  pollIntervalMs?: number
  maxDpr?: number
  simulationSteps?: number
  defaultEnvCount?: number
  evaluationEpisodes?: number
  evaluationSeed?: number
  maxTerminations?: number
  minMeanUprightFraction?: number
  quickCheckSteps?: number
  musicSampleRate?: 22050 | 44100
  maxMusicSeconds?: number
  maxMusicSamples?: number
  playbackHudIntervalMs?: number
  maxGroupMembers?: number
}

/** Remote methods and layout navigation are explicit service dependencies. */
export const inject = ['slots', 'layout', 'remote', 'remote.robotLab']

/**
 * Mount the center workflow and right player over one captured-session controller.
 * @param ctx - declared client services.
 * @param config - bounded renderer, music and training preferences.
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const options = { pollIntervalMs: 2000, maxDpr: 1.5, simulationSteps: 1000, defaultEnvCount: 4,
    evaluationEpisodes: 5, evaluationSeed: 0, maxTerminations: 0, minMeanUprightFraction: 0.9,
    quickCheckSteps: 1024, musicSampleRate: 22050 as const, maxMusicSeconds: 120, maxMusicSamples: 2646000,
    playbackHudIntervalMs: 50, maxGroupMembers: 8, ...config }
  if (!Number.isSafeInteger(options.maxGroupMembers) || options.maxGroupMembers < 1) {
    throw new Error('Robot Lab config requires a positive integer maxGroupMembers.')
  }
  if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 250
    || !Number.isFinite(options.maxDpr) || options.maxDpr < 1 || options.maxDpr > 3
    || !Number.isSafeInteger(options.simulationSteps) || options.simulationSteps < 1 || options.simulationSteps > 3000) {
    throw new Error('Robot Lab config requires pollIntervalMs >= 250, maxDpr 1..3 and simulationSteps 1..3000.')
  }
  if (!Number.isSafeInteger(options.defaultEnvCount) || options.defaultEnvCount < 1
    || !Number.isSafeInteger(options.evaluationEpisodes) || options.evaluationEpisodes < 1
    || !Number.isSafeInteger(options.evaluationSeed) || options.evaluationSeed < 0
    || !Number.isSafeInteger(options.maxTerminations) || options.maxTerminations < 0
    || !Number.isFinite(options.minMeanUprightFraction) || options.minMeanUprightFraction < 0 || options.minMeanUprightFraction > 1
    || !Number.isSafeInteger(options.quickCheckSteps) || options.quickCheckSteps < 1) {
    throw new Error('Robot Lab config requires positive environment/episode/quick-check counts, nonnegative integer seed/terminations and upright fraction 0..1.')
  }
  const playbackOptions = validatePlaybackOptions({ sampleRate: options.musicSampleRate,
    maxDurationSeconds: options.maxMusicSeconds, maxSamples: options.maxMusicSamples, hudIntervalMs: options.playbackHudIntervalMs })
  const store = createRobotStore(options.defaultEnvCount, options.maxGroupMembers)
  const clients = new Map<SessionId, { lab: LabClient; playback: PlaybackTransport }>()
  const downloads = new Map<ReturnType<typeof setTimeout>, string>()
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(timer) }, 0)
    downloads.set(timer, url)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = filename; anchor.click()
  }
  ctx.effect(() => async () => {
    for (const client of clients.values()) client.lab.dispose()
    const closing = [...clients.values()].map(client => client.playback.dispose())
    clients.clear()
    for (const [timer, url] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url) }
    downloads.clear()
    await Promise.all(closing)
  }, 'robot-lab: session clients and audio')

  const bind = (sessionId: SessionId, actions: PropsStore<ReturnType<typeof createRobotStore>>['actions']): StudioInjected => {
    let client = clients.get(sessionId)
    if (client === undefined) {
      const playback = new PlaybackTransport(playbackOptions)
      const lab = new LabClient(sessionId, async (id, request) => {
        const reply = await ctx.remote.robotLab.request(id, request)
        if (!reply.ok) throw new Error(reply.error.message)
        return reply.value
      }, options.pollIntervalMs, (recording, music, durationOverride) => {
        playback.load({ id: recording.mode === 'kinematic-reference' ? recording.projectSha256 : recording.policyHash,
          duration: durationOverride ?? recording.frames.at(-1)?.time ?? 0, music })
      })
      client = { lab, playback }; clients.set(sessionId, client)
      void lab.refresh()
    }
    const owner = client
    return {
      hooks: { lab: owner.lab, playback: owner.playback },
      refresh: () => { void owner.lab.refresh() },
      execute: (request) => {
        void owner.lab.execute(request).then((result) => {
          if (result?.operation === 'evaluate' || result?.operation === 'evaluate_trial') actions.evaluation(result.evaluation.id)
        })
      },
      maxGroupMembers: options.maxGroupMembers,
      saveRoster: (value) => {
        void owner.lab.localAction('save_roster', () => {
          download(new Blob([encodeRosterFile(value)], { type: 'application/json' }), 'duck-dance-group.json')
        })
      },
      loadRoster: (text) => {
        void owner.lab.localAction('load_roster', () => { actions.replaceRoster(parseRosterFile(text, options.maxGroupMembers)) })
      },
      simulateGroup: (members, steps, seed) => {
        if (members.length > options.maxGroupMembers) return
        owner.playback.pause()
        void owner.lab.simulateGroup(members, steps, seed)
      },
      saveProject: (recipe, editVersion, preview) => {
        if (preview) ctx.layout.openVisual('robot-lab')
        void owner.lab.saveProject(recipe, preview).then((project) => {
          if (project !== null) actions.savedProject(editVersion, project.projectId, project.id)
        })
      },
      saveTrial: (recipe, start) => {
        void owner.lab.saveTrial(recipe, start).then((trial) => { if (trial !== null) actions.trial(trial.id) })
      },
      saveReflection: (reflection) => { void owner.lab.saveReflection(reflection) },
      reviewImprovement: (reflection) => {
        void owner.lab.improvementSource(reflection).then((source) => {
          if (source !== null) actions.improvement(source.project, source.trial, reflection)
        })
      },
      openStudio: () => { ctx.layout.openVisual('robot-lab') },
      readTime: owner.playback.getTime,
      play: () => { void owner.playback.play() },
      pause: () => { owner.playback.pause() },
      restartPlayback: () => { void owner.playback.restart() },
      seek: (time) => { owner.playback.seek(time) },
      volume: (value) => { owner.playback.setVolume(value) },
      mute: (value) => { owner.playback.setMuted(value) },
      setPlaybackRate: (value) => { owner.playback.setRate(value) },
      playWithoutMusic: () => {
        const state = owner.playback.getSnapshot()
        if (state.id === null) return
        owner.playback.load({ id: state.id, duration: state.duration, music: null })
        owner.playback.seek(state.time)
        void owner.playback.play()
      },
      downloadMusic: (recipe) => {
        void owner.lab.localAction('generate_music', () => {
          const wav = encodeMusicWav(generateMusic(recipe, playbackOptions))
          download(new Blob([wav], { type: 'audio/wav' }), `micro-duck-${recipe.style}-${recipe.bpm}bpm.wav`)
        })
      },
      maxDpr: options.maxDpr, simulationSteps: options.simulationSteps, quickCheckSteps: options.quickCheckSteps,
      evaluation: { episodes: options.evaluationEpisodes, stepsPerEpisode: options.simulationSteps,
        seed: options.evaluationSeed, maxTerminations: options.maxTerminations, minMeanUprightFraction: options.minMeanUprightFraction },
    }
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'robot-lab', order: 12, label: () => 'Robot Studio',
    inject: () => ({ open: () => { ctx.layout.toggleVisual('robot-lab') } }),
  }, SidebarButton))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'micro-duck', order: 40, label: () => 'Micro Duck', store, inject: bind,
    children: {
      'conversation.micro-duck.learning-plan': { kind: 'single', scope: 'session' },
      'conversation.micro-duck.learning-review': { kind: 'single', scope: 'session' },
    },
  }, MicroDuckPanel))
  ctx.slots.inject('conversation.micro-duck.learning-plan', () => ctx.slots.register({
    name: 'conversation.micro-duck.learning-plan', store, inject: bind,
  }, LearningPlan))
  ctx.slots.inject('conversation.micro-duck.learning-review', () => ctx.slots.register({
    name: 'conversation.micro-duck.learning-review', store, inject: bind,
  }, LearningReview))
  ctx.slots.inject('visual.workspace.view', () => ctx.slots.register({
    name: 'visual.workspace.view', id: 'robot-lab', order: 20, label: () => 'MicroDuck',
    children: { 'robot-lab.visual.player': { kind: 'single', scope: 'session' } },
  }, RobotLab))
  ctx.slots.inject('robot-lab.visual.player', () => ctx.slots.register({ name: 'robot-lab.visual.player', store, inject: bind }, StudioPlayer))
}
