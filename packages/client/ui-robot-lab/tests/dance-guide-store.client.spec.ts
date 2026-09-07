// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDanceGuideStore } from '../src/client/dance-guide-store.ts'
import type { ClipSequence } from '../src/client/clip-sequence.ts'
import { fixtureProfile } from './fixtures.client.ts'

const LIMIT = 262144
const KEY = 'dsh.store.protected:["dsh.clip-gen.dance-guides",null]'
const tick = () => new Promise<void>((resolve) => { queueMicrotask(resolve) })
const instances: Array<ReturnType<ReturnType<typeof createDanceGuideStore>['create']>> = []
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
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
  localStorage.clear()
})
function store(maximum = LIMIT) {
  const instance = createDanceGuideStore(maximum).create()
  instances.push(instance)
  return instance
}
function grant() {
  const next = grants.shift()
  if (next === undefined) throw new Error('No queued persistence lock')
  next()
}
function add(instance: ReturnType<typeof store>, name = 'Groove', prompt = 'Step then bow') {
  instance.actions.startAdd(prompt); instance.actions.name(name); instance.actions.save()
}
const guide = { id: 1, name: '恢复 🦆', prompt: '  向左跳舞\n🦆 e\u0301\t ' }
const library = { guides: [guide], nextId: 2 }
function record(data: unknown = library, version = 1, scopeKey: string | null = null) {
  return JSON.stringify({ format: 1, version, scopeKey, revision: '33333333-3333-4333-8333-333333333333', data })
}

const closedEditor = { adding: false, name: '', prompt: '', error: null }

function sequence(name = 'Exact timeline 🦆'): ClipSequence {
  return { version: 1, modelSha256: 'a'.repeat(64), jointNames: fixtureProfile.joints.map(joint => joint.name), bpm: 123.5,
    clip: { version: 1, name, duration: 3, loop: true, keys: [
      { t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
      { t: 0.375, joints: Array<number>(14).fill(0.1234), rootPitch: 0.45 },
      { t: 3, joints: Array<number>(14).fill(-0.3), rootPitch: -0.2 },
    ] } }
}

describe('Dance guide editor', () => {
  it('declares protected root recovery and starts with only the requested state', () => {
    const handle = createDanceGuideStore(LIMIT)
    expect(handle.spec.persist).toMatchObject({ name: 'dsh.clip-gen.dance-guides', version: 1,
      maxBytes: LIMIT, scopeDisposal: 'retain' })
    expect(store().getSnapshot()).toEqual({ guides: [], nextId: 1, persistence: { state: 'empty' }, ...closedEditor })
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid configured byte budget %s at factory creation', (maximum) => {
    expect(() => createDanceGuideStore(maximum)).toThrow('maxBytes must be a positive safe integer')
  })

  it('saves trimmed names, preserves Unicode prompts verbatim, and allocates increasing ids', () => {
    const value = store()
    add(value, '  我的 🦆  ', guide.prompt)
    expect(value.getSnapshot()).toEqual({ guides: [{ id: 1, name: '我的 🦆', prompt: guide.prompt }], nextId: 2,
      persistence: { state: 'pending' }, ...closedEditor })
    add(value, 'Second', 'Other dance')
    expect(value.getSnapshot().guides[1]).toEqual({ id: 2, name: 'Second', prompt: 'Other dance' })
    expect(value.getSnapshot().nextId).toBe(3)
  })

  it.each([
    ['empty name', '', 'dance', 'name'], ['blank name', ' \t\n ', 'dance', 'name'],
    ['long name', 'x'.repeat(81), 'dance', 'name'], ['UTF-16 name bound', '🦆'.repeat(41), 'dance', 'name'],
    ['empty prompt', 'Dance', '', 'prompt'], ['blank prompt', 'Dance', ' \n\t ', 'prompt'],
    ['long prompt', 'Dance', 'x'.repeat(2001), 'prompt'], ['UTF-16 prompt bound', 'Dance', '🦆'.repeat(1001), 'prompt'],
  ])('keeps typed inputs after rejecting %s', (_label, name, prompt, error) => {
    const value = store()
    add(value, name, prompt)
    expect(value.getSnapshot()).toEqual({ guides: [], nextId: 1, persistence: { state: 'empty' },
      adding: true, name, prompt, error })
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('accepts exact UTF-16 name and prompt limits without trimming the prompt', () => {
    const value = store(); const name = '🦆'.repeat(40); const prompt = ` ${'🦆'.repeat(999)} `
    add(value, name, prompt)
    expect(value.getSnapshot().guides).toEqual([{ id: 1, name, prompt }])
  })

  it('rejects duplicate names ignoring case and outer whitespace without consuming an id', () => {
    const value = store(); add(value, 'Dance'); add(value, ' dAnCe ', 'New prompt')
    expect(value.getSnapshot()).toMatchObject({ nextId: 2, adding: true, name: ' dAnCe ', prompt: 'New prompt', error: 'duplicate' })
    expect(value.getSnapshot().guides).toEqual([{ id: 1, name: 'Dance', prompt: 'Step then bow' }])
  })

  it('resets errors on either edit, resets the editor on cancel and reopening, and never persists unsaved input', async () => {
    const value = store(); add(value, '', 'First prompt')
    value.actions.name('First name'); expect(value.getSnapshot().error).toBeNull()
    value.actions.prompt(''); value.actions.save(); expect(value.getSnapshot().error).toBe('prompt')
    value.actions.prompt('Next prompt'); expect(value.getSnapshot().error).toBeNull()
    value.actions.name(''); value.actions.save(); value.actions.startAdd('Prefilled 🦆')
    expect(value.getSnapshot()).toMatchObject({ adding: true, name: '', prompt: 'Prefilled 🦆', error: null })
    value.actions.save(); value.actions.cancelAdd()
    expect(value.getSnapshot()).toMatchObject(closedEditor)
    value.actions.startAdd('New editor'); value.actions.name('Unfinished')
    await tick()
    expect(store().getSnapshot()).toMatchObject(closedEditor)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

})

describe('Dance guide saved keyed sequences', () => {
  it('snapshots the exact motion and preserves an open prompt editor', () => {
    const value = store()
    value.actions.startAdd('Unfinished prompt'); value.actions.name('Unfinished name')
    const source = sequence()
    const expected = structuredClone(source)
    value.actions.saveSequence(guide.prompt, source)
    source.clip.keys[1]!.joints[0] = 0.9
    source.jointNames[0] = 'changed'
    expect(value.getSnapshot()).toMatchObject({ adding: true, name: 'Unfinished name', prompt: 'Unfinished prompt',
      guides: [{ id: 1, name: expected.clip.name, prompt: guide.prompt, sequence: expected }], nextId: 2,
      persistence: { state: 'pending' } })
  })

  it('allocates unique case-insensitive names across text guides and repeat generations', () => {
    const value = store()
    add(value, 'DANCE')
    value.actions.saveSequence('Same prompt', sequence(' dance '))
    value.actions.saveSequence('Same prompt', sequence('Dance'))
    value.actions.saveSequence('Same prompt', sequence('Dance'))
    expect(value.getSnapshot().guides.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: 'DANCE' }, { id: 2, name: 'dance (2)' }, { id: 3, name: 'Dance (3)' }, { id: 4, name: 'Dance (4)' },
    ])
    expect(value.getSnapshot().guides[1]?.sequence?.clip.name).toBe(' dance ')
    expect(value.getSnapshot().nextId).toBe(5)
  })

  it('bounds generated names and suffixes without splitting Unicode characters', () => {
    const value = store()
    const source = sequence('🦆'.repeat(80))
    value.actions.saveSequence('First', source)
    value.actions.saveSequence('Second', source)
    expect(value.getSnapshot().guides.map(guide => guide.name)).toEqual(['🦆'.repeat(40), `${'🦆'.repeat(38)} (2)`])
    value.actions.saveSequence('Third', sequence(`${'x'.repeat(79)}🦆`))
    expect(value.getSnapshot().guides[2]?.name).toBe('x'.repeat(79))
    expect(value.getSnapshot().guides[0]?.sequence?.clip.name).toBe(source.clip.name)
  })

  it.each(['', ' \t\n ', 'x'.repeat(2001)])('rejects an invalid sequence prompt without consuming an id', (prompt) => {
    const value = store()
    value.actions.saveSequence(prompt, sequence())
    expect(value.getSnapshot()).toMatchObject({ guides: [], nextId: 1, error: 'prompt', persistence: { state: 'empty' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('restores legacy text and exact sequence records together without rewriting on read', async () => {
    const legacy = record()
    localStorage.setItem(KEY, legacy)
    const value = store()
    const source = sequence()
    expect(value.getSnapshot().guides).toEqual([guide])
    expect(localStorage.getItem(KEY)).toBe(legacy)
    value.actions.saveSequence('  AI dance 🦆\n', source)
    await tick(); grant(); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'saved' })
    const raw = localStorage.getItem(KEY)!
    const saved = { id: 2, name: source.clip.name, prompt: '  AI dance 🦆\n', sequence: source }
    expect(JSON.parse(raw) as unknown).toMatchObject({ format: 1, version: 1, scopeKey: null,
      data: { guides: [guide, saved], nextId: 3 } })
    value.dispose()
    const restored = store()
    expect(restored.getSnapshot()).toEqual({ guides: [guide, saved], nextId: 3,
      persistence: { state: 'restored' }, ...closedEditor })
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([null, {}, { ...sequence(), version: 2 }, { ...sequence(), extra: true },
    { ...sequence(), bpm: '120' }, { ...sequence(), jointNames: ['wrong'] },
    { ...sequence(), modelSha256: 'invalid' }, { ...sequence(), clip: { ...sequence().clip, version: 2 } },
    { ...sequence(), clip: { ...sequence().clip, extra: true } },
    { ...sequence(), clip: { ...sequence().clip, keys: sequence().clip.keys.slice(0, 2) } },
  ])('preserves stored bytes and refuses malformed sequence %#', (invalid) => {
    const raw = record({ guides: [{ ...guide, sequence: invalid }], nextId: 2 })
    localStorage.setItem(KEY, raw)
    const value = store()
    expect(value.getSnapshot()).toMatchObject({ guides: [], persistence: { state: 'blocked', reason: 'invalid' } })
    value.actions.saveSequence('Local timeline', sequence())
    expect(value.getSnapshot().guides).toHaveLength(1)
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an explicitly undefined optional sequence rather than treating it as a legacy guide', () => {
    const declaration = createDanceGuideStore(LIMIT)
    const persistence = declaration.spec.persist!
    if (typeof persistence === 'string') throw new Error('Expected protected persistence')
    expect(() => persistence.restore({ guides: [{ ...guide, sequence: undefined }], nextId: 2 }, declaration.spec.init())).toThrow()
  })

  it('bounds the complete sequence library envelope at exact UTF-8 bytes', async () => {
    const source = sequence()
    const data = { guides: [{ id: 1, name: source.clip.name, prompt: guide.prompt, sequence: source }], nextId: 2 }
    const raw = record(data)
    const bytes = new TextEncoder().encode(raw).byteLength
    const value = store(bytes)
    value.actions.saveSequence(guide.prompt, source)
    await tick(); grant(); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'saved' })
    const committed = localStorage.getItem(KEY)
    expect(new TextEncoder().encode(committed!).byteLength).toBe(bytes)
    expect(store(bytes).getSnapshot().guides).toEqual(data.guides)
    expect(store(bytes - 1).getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(localStorage.getItem(KEY)).toBe(committed)
  })

  it('keeps an oversized new sequence local without replacing a saved text library', async () => {
    const baseline = record()
    localStorage.setItem(KEY, baseline)
    const source = sequence()
    const bytes = new TextEncoder().encode(record({ guides: [guide,
      { id: 2, name: source.clip.name, prompt: guide.prompt, sequence: source }], nextId: 3 })).byteLength
    const value = store(bytes - 1)
    value.actions.saveSequence(guide.prompt, source)
    await tick(); grant(); await tick()
    expect(value.getSnapshot()).toMatchObject({ persistence: { state: 'blocked', reason: 'too-large' }, nextId: 3 })
    expect(value.getSnapshot().guides[1]?.sequence).toEqual(source)
    expect(localStorage.getItem(KEY)).toBe(baseline)
  })
})

describe('Dance guide browser recovery', () => {
  it('persists only guides and nextId across root disposal, remount and fresh factory recreation', async () => {
    const first = store(); add(first, guide.name, guide.prompt)
    expect(first.getSnapshot().persistence).toEqual({ state: 'pending' })
    await tick(); grant(); await tick()
    expect(first.getSnapshot().persistence).toEqual({ state: 'saved' })
    const raw = localStorage.getItem(KEY)!
    expect(JSON.parse(raw) as unknown).toEqual({ format: 1, version: 1, scopeKey: null,
      revision: expect.any(String) as unknown, data: library })
    first.actions.startAdd('Do not persist'); first.actions.name('Unfinished')
    first.dispose(); first.actions.save(); await tick()
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(store().getSnapshot()).toEqual({ ...library, persistence: { state: 'restored' }, ...closedEditor })
    const remounted = store(); remounted.dispose()
    expect(store().getSnapshot().guides).toEqual([guide])
    expect(request).toHaveBeenCalledTimes(1)
    expect(localStorage.length).toBe(1)
  })

  it('cancels a queued save on disposal and prevents its late grant from writing', async () => {
    const value = store(); add(value); await tick()
    expect(request).toHaveBeenCalledTimes(1)
    value.dispose(); grant(); await Promise.allSettled(pending)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(store().getSnapshot().guides).toEqual([])
  })

  it.each([
    ['malformed JSON', '{', 'invalid'], ['future version', record(library, 2), 'unsupported-version'],
    ['foreign scope', record(library, 1, 'session'), 'invalid'],
    ...[
      ['null library', null], ['array library', []], ['missing guides', { nextId: 1 }],
      ['extra persisted editor', { ...library, adding: true }], ['nonarray guides', { guides: {}, nextId: 2 }],
      ['string nextId', { ...library, nextId: '2' }], ['zero nextId', { ...library, nextId: 0 }],
      ['fractional nextId', { ...library, nextId: 2.5 }], ['unsafe nextId', { ...library, nextId: Number.MAX_SAFE_INTEGER + 1 }],
      ['nextId equal to id', { ...library, nextId: 1 }], ['nextId below id', { guides: [{ ...guide, id: 3 }], nextId: 2 }],
      ['exhausted nextId', { guides: [], nextId: Number.MAX_SAFE_INTEGER }],
      ['skipped nextId', { ...library, nextId: 3 }],
      ['nonsequential ids', { guides: [{ ...guide, id: 2 }, { ...guide, id: 1, name: 'Other' }], nextId: 3 }],
      ['duplicate ids', { guides: [guide, { ...guide, name: 'Other' }], nextId: 3 }],
      ['duplicate names', { guides: [guide, { ...guide, id: 2 }], nextId: 3 }],
      ['case duplicate names', { guides: [{ ...guide, name: 'Dance' }, { ...guide, id: 2, name: 'DANCE' }], nextId: 3 }],
      ...[
        ['null guide', null], ['array guide', []], ['missing prompt', { id: 1, name: 'Dance' }],
        ['extra clip', { ...guide, clip: {} }], ['string id', { ...guide, id: '1' }], ['zero id', { ...guide, id: 0 }],
        ['fractional id', { ...guide, id: 1.5 }], ['unsafe id', { ...guide, id: Number.MAX_SAFE_INTEGER + 1 }],
        ['nonstring name', { ...guide, name: 1 }], ['blank name', { ...guide, name: '' }],
        ['untrimmed name', { ...guide, name: ' Dance ' }], ['long name', { ...guide, name: 'x'.repeat(81) }],
        ['nonstring prompt', { ...guide, prompt: null }], ['blank prompt', { ...guide, prompt: ' \t\n' }],
        ['long prompt', { ...guide, prompt: 'x'.repeat(2001) }],
      ].map(([label, invalid]) => [label, { guides: [invalid], nextId: 2 }]),
    ].map(([label, data]) => [label, record(data), 'invalid']),
  ])('retains %s bytes and keeps new edits local without silent replacement', async (_label, raw, reason) => {
    localStorage.setItem(KEY, raw as string)
    const value = store()
    expect(value.getSnapshot().persistence).toEqual({ state: 'blocked', reason })
    expect(value.getSnapshot().guides).toEqual([])
    add(value, 'Local', 'Retain local text'); await tick()
    expect(value.getSnapshot().guides).toEqual([{ id: 1, name: 'Local', prompt: 'Retain local text' }])
    value.dispose()
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(request).not.toHaveBeenCalled()
  })

  it('accepts empty libraries and continues sequential ids after recovery', () => {
    localStorage.setItem(KEY, record({ guides: [], nextId: 1 }))
    expect(store().getSnapshot()).toMatchObject({ guides: [], nextId: 1, persistence: { state: 'restored' } })
    localStorage.setItem(KEY, record({ guides: [guide, { ...guide, id: 2, name: 'Other' }], nextId: 3 }))
    const value = store(); add(value)
    expect(value.getSnapshot().guides[2]?.id).toBe(3)
    expect(value.getSnapshot().nextId).toBe(4)
  })

  it('bounds complete UTF-8 recovery envelopes at the exact configured byte budget', () => {
    const raw = record(); const bytes = new TextEncoder().encode(raw).byteLength
    localStorage.setItem(KEY, raw)
    expect(store(bytes).getSnapshot().persistence).toEqual({ state: 'restored' })
    expect(store(bytes - 1).getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(store(1).getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(localStorage.getItem(KEY)).toBe(raw)
  })

  it('blocks writes exceeding the complete envelope budget without losing the local guide', async () => {
    const bytes = new TextEncoder().encode(record()).byteLength
    const value = store(bytes - 1); add(value, guide.name, guide.prompt)
    await tick(); grant(); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(value.getSnapshot().guides).toEqual([guide])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it.each(['QuotaExceededError', 'SecurityError'])('retains the saved baseline and local additions after %s', async (error) => {
    const raw = record(); localStorage.setItem(KEY, raw)
    const value = store()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Object.assign(new Error('Blocked storage'), { name: error }) })
    add(value); await tick(); grant(); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'blocked', reason: error === 'QuotaExceededError' ? 'quota' : 'unavailable' })
    expect(value.getSnapshot().guides).toHaveLength(2)
    expect(localStorage.getItem(KEY)).toBe(raw)
  })

  it('keeps local editing available when browser storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Disabled', 'SecurityError') })
    const value = store(); add(value); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'unavailable' })
    expect(value.getSnapshot().guides).toHaveLength(1)
    expect(request).not.toHaveBeenCalled()
  })

  it('restores readable records without Web Locks but never writes an unlocked replacement', async () => {
    const raw = record(); localStorage.setItem(KEY, raw); vi.stubGlobal('navigator', {})
    const value = store(); add(value); await tick()
    expect(value.getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'locking-unavailable' })
    expect(value.getSnapshot().guides[0]).toEqual(guide)
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(request).not.toHaveBeenCalled()
  })

  it('retains the winning root library when another instance commits before a queued save', async () => {
    const winner = store(); const stale = store()
    add(winner, 'Winner'); add(stale, 'Local loser'); await tick()
    expect(request).toHaveBeenCalledTimes(2)
    grant(); await tick()
    const raw = localStorage.getItem(KEY)
    grant(); await tick()
    expect(stale.getSnapshot().persistence).toEqual({ state: 'blocked', reason: 'conflict' })
    expect(stale.getSnapshot().guides[0]?.name).toBe('Local loser')
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(store().getSnapshot().guides[0]?.name).toBe('Winner')
  })
})
