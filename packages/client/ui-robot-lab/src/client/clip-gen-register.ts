/** Native Clip Gen composition over one session-owned lab and one declared interaction store. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { clipEn, clipZh } from './clip-gen-locales.ts'
import { createClipGenStore } from './clip-gen-store.ts'
import { clipVideoDownload } from './clip-video-output.ts'
import type { ClipGenInjected, ClipGenOptions } from './clip-gen-props.ts'
import type { LabClient } from './lab-client.ts'
import { ClipGenPanel } from './ClipGenPanel.tsx'
import { DanceGuideLibrary } from './DanceGuideLibrary.tsx'
import { createDanceGuideStore } from './dance-guide-store.ts'
import { ClipSimulation, ClipSimulationEntry } from './ClipSimulation.tsx'
import { createClipSequenceDefinitions, createClipSequenceView } from './clip-sequence-events.ts'
import { requestClipSequence, ClipSequenceRequestError } from './clip-sequence-request.ts'
import type { ClipSequenceRequestId } from './clip-sequence-agent.ts'
import { validateClipSequence } from './clip-sequence.ts'

/**
 * Register the central authoring tab and right preview without starting training or a model turn.
 * @param ctx - enclosing plugin context with its declared services.
 * @param options - explicit capture and file limits.
 * @param labFor - enclosing plugin's session-owned Robot Lab client.
 */
export function registerClipGen(ctx: Context, options: ClipGenOptions, labFor: (id: SessionId) => LabClient): void {
  if (!Number.isFinite(options.defaultBpm) || options.defaultBpm <= 0
    || !Number.isSafeInteger(options.frameRate) || options.frameRate < 1 || options.frameRate > 60
    || !Number.isSafeInteger(options.videoBitsPerSecond) || options.videoBitsPerSecond < 1
    || !Number.isSafeInteger(options.finalizeTimeoutMs) || options.finalizeTimeoutMs < 1) {
    throw new Error('Clip Gen requires positive tempo, bitrate and recorder timeout, with integer frame rate 1..60.')
  }
  ctx.effect(() => ctx.locale.register('clip-gen', { en: clipEn, zh: clipZh }), 'clip-gen: dictionaries')
  const t = ctx.locale.bind('clip-gen')
  const store = createClipGenStore(options.defaultBpm, options.maxDucks)
  const guides = createDanceGuideStore(options.maxFileBytes)
  const requests = new Map<SessionId, AbortController>()
  const videos = new Map<SessionId, string[]>()
  const downloads = new Map<ReturnType<typeof setTimeout>, string>()
  let active = true
  ctx.effect(() => () => {
    active = false
    for (const controller of requests.values()) controller.abort()
    requests.clear()
    for (const urls of videos.values()) for (const url of urls) URL.revokeObjectURL(url)
    for (const [timer, url] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url) }
    videos.clear(); downloads.clear()
  }, 'clip-gen: browser video and download URLs')
  const bind = (id: SessionId, actions: PropsStore<ReturnType<typeof createClipGenStore>>['actions']): ClipGenInjected => ({
    ...options,
    hooks: { lab: labFor(id) },
    refresh: () => { void labFor(id).refresh() },
    generateSequence: (input, save) => {
      if (!active || requests.has(id)) return
      const binding = ctx.sessions.binding(id)
      const lab = labFor(id).getSnapshot()
      const profile = lab.catalog?.profiles[0]
      const limits = lab.catalog?.limits
      if (binding === undefined || profile === undefined || limits === undefined || profile.joints.length !== 14) {
        actions.failure('aiUnavailable'); return
      }
      if (!input.prompt.trim() || input.prompt.length > 2000 || !Number.isFinite(input.bpm)
        || input.bpm < limits.minBpm || input.bpm > limits.maxBpm) { actions.failure('limits'); return }
      const controller = new AbortController()
      requests.set(id, controller)
      const requestId = randomUUID() as ClipSequenceRequestId
      actions.aiStart(requestId, input.prompt, input.editEpoch)
      void requestClipSequence({ session: binding.session, replies: ctx.uiConversation.binding(binding).target('clip-gen'),
        requestId, instruction: input.prompt, bpm: input.bpm, profile, limits,
        ...(lab.scene === null ? {} : { scene: lab.scene }), maxBytes: options.maxFileBytes, signal: controller.signal,
      }).then(({ guide, sequence }) => {
        if (!active || controller.signal.aborted || requests.get(id) !== controller) return
        const current = labFor(id).getSnapshot().catalog
        if (current?.profiles[0] === undefined) { actions.aiFailure(requestId, 'aiProfile'); return }
        let compatible: typeof sequence
        try { compatible = validateClipSequence(sequence, current.profiles[0], current.limits) }
        catch { actions.aiFailure(requestId, 'aiProfile'); return }
        actions.aiReceive(requestId, compatible, guide)
        save(guide, compatible)
        if (ctx.sessions.list.getSnapshot().current === id) ctx.layout.openVisual('simulation-workspace')
      }).catch((error: unknown) => {
        if (!active || controller.signal.aborted || requests.get(id) !== controller) return
        actions.aiFailure(requestId, error instanceof ClipSequenceRequestError && error.kind === 'send' ? 'aiSend' : 'aiResponse')
      }).finally(() => { if (requests.get(id) === controller) requests.delete(id) })
    },
    cancelSequence: () => {
      requests.get(id)?.abort(); requests.delete(id); actions.aiCancel()
    },
    openWorkspace: () => { ctx.layout.openVisual('simulation-workspace') },
    openTraining: () => { ctx.uiConversation.selectView(id, 'micro-duck') },
    saveText: (text, filename) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(timer) }, 0)
      downloads.set(timer, url)
    },
    publishVideo: (video, withAudio) => {
      const urls = [video.url, ...(video.audio === undefined ? [] : [video.audio.url])]
      if (!active) { for (const url of urls) URL.revokeObjectURL(url); return }
      const previous = videos.get(id)
      videos.set(id, urls); actions.generated(video)
      if (previous !== undefined) for (const url of previous) URL.revokeObjectURL(url)
      const selected = clipVideoDownload(video, withAudio)
      const anchor = document.createElement('a'); anchor.href = selected.url; anchor.download = selected.filename; anchor.click()
    },
  })
  ctx.uiConversation.views.register(createClipSequenceView())
  for (const definition of createClipSequenceDefinitions(options.maxFileBytes)) ctx.uiConversation.events.register(definition)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'clip-gen', locale: 'clip-gen', order: 35, label: () => t('tab'), store, inject: bind,
    children: { 'conversation.clip-gen.guides': { kind: 'single', scope: 'root' } },
  }, ClipGenPanel))
  ctx.slots.inject('conversation.clip-gen.guides', () => ctx.slots.register({
    name: 'conversation.clip-gen.guides', locale: 'clip-gen', store: guides,
  }, DanceGuideLibrary))
  ctx.slots.inject('visual.workspace.view', () => ctx.slots.register({
    name: 'visual.workspace.view', id: 'simulation-workspace', locale: 'clip-gen', order: 15, label: () => t('workspace'),
    children: { 'robot-lab.clip.player': { kind: 'single', scope: 'session' } },
  }, ClipSimulationEntry))
  ctx.slots.inject('robot-lab.clip.player', () => ctx.slots.register({
    name: 'robot-lab.clip.player', locale: 'clip-gen', store, inject: bind,
  }, ClipSimulation))
}
