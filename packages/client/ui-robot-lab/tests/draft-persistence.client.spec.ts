// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistNotice } from '@deepseek-ai/dsh-client-store'
import { createRobotStore } from '../src/client/store.ts'
import { selectAuthoringDraft } from '../src/client/draft-file.ts'
import { fixtureProfile, fixtureTemplate } from './fixtures.client.ts'
import { partialV2DanceReport } from './dance-fixtures.client.ts'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const LIMIT = 262144
const key = (scope = SESSION) => `dsh.store.protected:${JSON.stringify(['dsh.robot-lab.authoring', scope])}`
const tick = () => new Promise<void>((resolve) => { queueMicrotask(resolve) })
const instances: Array<ReturnType<ReturnType<typeof createRobotStore>['create']>> = []
const pending: Promise<void>[] = []
const grants: Array<() => void> = []
const request = vi.fn((_name: string, options: { signal: AbortSignal }, callback: () => void) => {
  const promise = new Promise<void>((resolve, reject) => {
    const abort = () => { reject(new DOMException('Cancelled', 'AbortError')) }
    options.signal.addEventListener('abort', abort, { once: true })
    grants.push(() => {
      options.signal.removeEventListener('abort', abort)
      if (options.signal.aborted) return
      try { callback(); resolve() } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
    })
  })
  pending.push(promise)
  return promise
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('navigator', { locks: { request } })
})
afterEach(async () => {
  for (const instance of instances.splice(0)) instance.dispose()
  await Promise.allSettled(pending.splice(0))
  grants.length = 0
  localStorage.clear()
  vi.unstubAllGlobals(); vi.clearAllMocks()
})
function store(scope = SESSION, maximum = LIMIT) {
  const instance = createRobotStore(4, 8, { maxBytes: maximum }).create(scope)
  instances.push(instance)
  return instance
}
function authoring() {
  const source = createRobotStore().create()
  source.actions.chooseTemplate(fixtureProfile, fixtureTemplate)
  source.actions.projectName('恢复 🦆')
  source.actions.brief({ goal: 'Keep my unfinished goal', prediction: '', plannedChange: '', evidence: '' })
  source.actions.trainingBackend('rlx'); source.actions.steps('-'); source.actions.envs('')
  source.actions.reflection({ observation: 'Do not persist reflection text' })
  source.actions.addDuck(); source.actions.page('perform')
  const draft = selectAuthoringDraft(source.getSnapshot())
  source.dispose()
  return draft
}
function record(data: unknown = authoring(), version = 1, scopeKey = SESSION) {
  return JSON.stringify({ format: 1, version, scopeKey, revision: '33333333-3333-4333-8333-333333333333', data })
}
function notice(instance: ReturnType<typeof store>): PersistNotice | null { return instance.getSnapshot().persistence }
function grant() {
  const next = grants.shift()
  if (next === undefined) throw new Error('No queued persistence lock')
  next()
}

describe('Robot authoring store recovery', () => {
  it('restores only validated authoring inputs in the same session and exposes a typed restored notice', () => {
    const draft = authoring(); const saved = record(draft); localStorage.setItem(key(), saved)
    const recovered = store()
    expect(selectAuthoringDraft(recovered.getSnapshot())).toEqual(draft)
    expect(notice(recovered)).toEqual({ state: 'restored' })
    expect(recovered.getSnapshot()).toMatchObject({ page: 'customize', trialId: null, policyId: null, savedRevisionId: null,
      savedEditVersion: -1, editVersion: 1, trainingDuck: null, evaluationId: null, baselineId: null,
      reflection: { observation: '', interpretation: '', nextChange: '' }, expandedViewer: false })
    expect(recovered.getSnapshot().ducks).toHaveLength(1)
    expect(localStorage.getItem(key())).toBe(saved)
    expect(request).not.toHaveBeenCalled()
    expect(store(OTHER).getSnapshot().dance).toBeNull()
    expect(localStorage.getItem(key(OTHER))).toBeNull()
  })

  it.each([1, 2] as const)('restores v%s criteria and keeps the protected authoring envelope at version 1', async (version) => {
    const draft = authoring()
    draft.assessment = partialV2DanceReport().dancePlan!.evaluation
    draft.assessment.dance!.version = version
    localStorage.setItem(key(), record(draft))
    const recovered = store()
    expect(notice(recovered)).toEqual({ state: 'restored' })
    expect(recovered.getSnapshot().assessment).toEqual(draft.assessment)
    recovered.actions.brief({ goal: 'Review partial-coverage criteria before admission' })
    await tick(); grant(); await tick()
    expect(notice(recovered)).toEqual({ state: 'saved' })
    expect(JSON.parse(localStorage.getItem(key())!) as unknown).toMatchObject({ format: 1, version: 1,
      data: { assessment: { dance: { version } } } })
    expect(store().getSnapshot()).toMatchObject({ assessment: draft.assessment, savedRevisionId: null, trialId: null, policyId: null })
  })

  it('blocks future criteria without changing the version-1 protected record', () => {
    const draft = authoring()
    const assessment = partialV2DanceReport().dancePlan!.evaluation
    const saved = record({ ...draft, assessment: { ...assessment, dance: { ...assessment.dance, version: 3 } } })
    localStorage.setItem(key(), saved)
    expect(notice(store())).toEqual({ state: 'blocked', reason: 'invalid' })
    expect(localStorage.getItem(key())).toBe(saved)
    expect(request).not.toHaveBeenCalled()
  })

  it('retains a recovered draft on disposal and recovers it in a new instance', () => {
    const saved = record(); localStorage.setItem(key(), saved)
    const first = store(); first.dispose()
    first.actions.projectName('Late response changes only detached memory')
    expect(localStorage.getItem(key())).toBe(saved)
    expect(store().getSnapshot().dance?.name).toBe('恢复 🦆')
  })

  it('persists a later edit through the composed projection, excluding display state and recovery notices', async () => {
    localStorage.setItem(key(), record())
    const value = store()
    value.actions.projectName('Saved later 🦆'); value.actions.page('perform'); value.actions.expandedViewer(true)
    expect(notice(value)).toEqual({ state: 'pending' })
    await tick(); grant(); await tick()
    expect(notice(value)).toEqual({ state: 'saved' })
    const saved = localStorage.getItem(key())!
    expect(JSON.parse(saved) as unknown).toMatchObject({ data: { dance: { name: 'Saved later 🦆' } } })
    for (const excluded of ['persistence', 'expandedViewer', 'reflection', 'savedRevisionId', 'policyId', 'ducks']) {
      expect(saved).not.toContain(`"${excluded}"`)
    }
    expect(store().getSnapshot()).toMatchObject({ page: 'customize', expandedViewer: false, savedRevisionId: null })
  })

  it.each([
    ['malformed JSON', '{', 'invalid'], ['future version', record(authoring(), 2), 'unsupported-version'],
    ['foreign scope', record(authoring(), 1, OTHER), 'invalid'],
    ['missing draft fields', record({ brief: {} }), 'invalid'],
    ['server-owned extra field', record({ ...authoring(), runs: [] }), 'invalid'],
    ['saved-state extra field', record({ ...authoring(), savedRevisionId: 'revision-33333333-3333-4333-8333-333333333333' }), 'invalid'],
    ['nested malformed recipe', record({ ...authoring(), dance: { templateVersion: 2 } }), 'invalid'],
  ])('preserves %s bytes and local edits without overwriting the stored record', async (_label, saved, reason) => {
    localStorage.setItem(key(), saved)
    const value = store()
    expect(notice(value)).toEqual({ state: 'blocked', reason })
    value.actions.brief({ goal: 'New local text is not silently lost' })
    await tick()
    expect(value.getSnapshot().brief.goal).toBe('New local text is not silently lost')
    expect(localStorage.getItem(key())).toBe(saved)
    expect(request).not.toHaveBeenCalled()
  })

  it('bounds the complete UTF-8 storage envelope before applying a valid draft', () => {
    const saved = record(); const bytes = new TextEncoder().encode(saved).byteLength
    localStorage.setItem(key(), saved)
    expect(notice(store(SESSION, bytes))).toEqual({ state: 'restored' })
    expect(notice(store(SESSION, bytes - 1))).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(notice(store(SESSION, 1))).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(localStorage.getItem(key())).toBe(saved)
  })

  it('keeps validated recovery readable without silently enabling unlocked writes', async () => {
    localStorage.setItem(key(), record()); vi.stubGlobal('navigator', {})
    const value = store()
    expect(value.getSnapshot().dance?.name).toBe('恢复 🦆')
    expect(notice(value)).toEqual({ state: 'blocked', reason: 'locking-unavailable' })
    value.actions.projectName('Local only'); await tick()
    expect(request).not.toHaveBeenCalled()
    expect(localStorage.getItem(key())).toBe(record())
  })
})
