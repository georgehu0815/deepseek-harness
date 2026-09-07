import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineStore, type PersistNotice, type ProtectedPersistence } from '../src/index.ts'

type State = { text: string; transient: number; notice: PersistNotice }
const initial = (): State => ({ text: '', transient: 0, notice: { state: 'empty' } })
const key = (name = 'draft', scope: string | null = 's1') => `dsh.store.protected:${JSON.stringify([name, scope])}`
const encoded = (data: unknown = { text: 'recovered' }, scopeKey: string | null = 's1') => JSON.stringify({
  format: 1, version: 1, scopeKey, revision: '11111111-1111-4111-8111-111111111111', data,
})
const tick = () => new Promise<void>((resolve) => { queueMicrotask(resolve) })

function environment() {
  const records = new Map<string, string>()
  const storage = {
    getItem: vi.fn((name: string) => records.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { records.set(name, value) }),
    removeItem: vi.fn((name: string) => { records.delete(name) }),
  }
  type Ticket = { name: string; signal: AbortSignal; callback: () => void; grant(): void }
  const tickets: Ticket[] = []
  const pending: Promise<void>[] = []
  const locks = { request: vi.fn((name: string, options: { mode: string; signal: AbortSignal }, callback: () => void) => {
    const promise = new Promise<void>((resolve, reject) => {
      const abort = () => { reject(new DOMException('Cancelled', 'AbortError')) }
      options.signal.addEventListener('abort', abort, { once: true })
      tickets.push({ name, signal: options.signal, callback, grant: () => {
        options.signal.removeEventListener('abort', abort)
        if (options.signal.aborted) return
        try { callback(); resolve() } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      } })
    })
    pending.push(promise)
    return promise
  }) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { locks })
  return { records, storage, locks, tickets, pending,
    grant: () => {
      const ticket = tickets.find(ticket => !ticket.signal.aborted)
      if (ticket === undefined) throw new Error('No pending Web Lock request')
      tickets.splice(tickets.indexOf(ticket), 1); ticket.grant()
    } }
}
const instances: Array<{ dispose(): void }> = []
const worlds: ReturnType<typeof environment>[] = []
afterEach(async () => {
  for (const instance of instances.splice(0)) instance.dispose()
  await Promise.allSettled(worlds.splice(0).flatMap(world => world.pending))
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})
function world() { const value = environment(); worlds.push(value); return value }
function codec(overrides: Partial<ProtectedPersistence<State>> = {}): ProtectedPersistence<State> {
  return { name: 'draft', version: 1, maxBytes: 1024, scopeDisposal: 'retain',
    select: value => ({ text: value.text }),
    restore: (payload, defaults) => {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 1 || !('text' in payload) || typeof payload.text !== 'string') throw new Error('Invalid draft')
      return { ...defaults, text: payload.text }
    },
    status: (draft, notice) => { draft.notice = notice }, ...overrides }
}
function make(overrides: Partial<ProtectedPersistence<State>> = {}, scope: string | undefined = 's1') {
  const instance = defineStore({ init: initial, persist: codec(overrides), actions: {
    text: (draft, value: string) => { draft.text = value }, transient: (draft, value: number) => { draft.transient = value },
  } }).create(scope)
  instances.push(instance)
  return instance
}

describe('protected draft recovery', () => {
  it('saves selected data under a scoped versioned envelope without persisting notices or transient state', async () => {
    const env = world(); const first = make()
    first.actions.text('鸭🦆'); first.actions.transient(9)
    expect(first.getSnapshot().notice).toEqual({ state: 'pending' })
    expect(env.storage.setItem).not.toHaveBeenCalled()
    await tick(); env.grant(); await tick()
    const raw = env.records.get(key())!
    expect(JSON.parse(raw)).toMatchObject({ format: 1, version: 1, scopeKey: 's1', data: { text: '鸭🦆' } })
    expect(first.getSnapshot().notice).toEqual({ state: 'saved' })
    expect(env.storage.setItem).toHaveBeenCalledOnce()
    const restored = make()
    expect(restored.getSnapshot()).toEqual({ text: '鸭🦆', transient: 0, notice: { state: 'restored' } })
    restored.actions.transient(12); await tick()
    expect(env.storage.setItem).toHaveBeenCalledOnce()
  })
  it('isolates session and root keys and preserves legacy namespace records', async () => {
    const env = world(); env.records.set('draft.s1', '{"text":"legacy"}')
    const first = make(); const second = make({}, 's2')
    const root = defineStore({ init: initial, persist: codec(),
      actions: { text: (draft, text: string) => { draft.text = text } } }).create()
    instances.push(root)
    first.actions.text('one'); second.actions.text('two'); root.actions.text('root')
    await tick(); env.grant(); env.grant(); env.grant(); await tick()
    expect(JSON.parse(env.records.get(key())!) as unknown).toMatchObject({ data: { text: 'one' } })
    expect(JSON.parse(env.records.get(key('draft', 's2'))!) as unknown).toMatchObject({ data: { text: 'two' } })
    expect(JSON.parse(env.records.get(key('draft', null))!) as unknown).toMatchObject({ data: { text: 'root' } })
    expect(env.records.get('draft.s1')).toBe('{"text":"legacy"}')
  })
  it.each([
    ['broken JSON', '{', 'invalid'], ['array', '[]', 'invalid'], ['null', 'null', 'invalid'],
    ['future version', encoded().replace('"version":1', '"version":2'), 'unsupported-version'],
    ['future envelope', encoded().replace('"format":1', '"format":2'), 'unsupported-version'],
    ['missing version', encoded().replace('"version":1,', ''), 'invalid'],
    ['invalid version', encoded().replace('"version":1', '"version":true'), 'invalid'],
    ['zero version', encoded().replace('"version":1', '"version":0'), 'invalid'],
    ['extra envelope key', encoded().replace('"format":1', '"extra":true,"format":1'), 'invalid'],
    ['foreign scope', encoded({ text: 'foreign' }, 's2'), 'invalid'],
    ['bad revision', encoded().replace('11111111-1111-4111-8111-111111111111', '../bad'), 'invalid'],
    ['bad payload', encoded({ text: 1 }), 'invalid'], ['extra payload key', encoded({ text: 'x', server: {} }), 'invalid'],
  ])('preserves %s bytes, exposes %s, and never autosaves defaults over them', async (_name, raw, failure) => {
    const env = world(); env.records.set(key(), raw)
    const value = make(); value.actions.text('local changes')
    await tick()
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: failure })
    expect(value.getSnapshot().text).toBe('local changes')
    expect(env.records.get(key())).toBe(raw)
    expect(env.locks.request).not.toHaveBeenCalled()
  })
  it('keeps initial state when a recovered JSON number overflows the finite selected-data domain', () => {
    const env = world(); const raw = encoded({ count: 1 }).replace('"count":1', '"count":1e999')
    env.records.set(key(), raw)
    const value = defineStore({ init: () => ({ count: 0, notice: { state: 'empty' } as PersistNotice }),
      persist: { name: 'draft', version: 1, maxBytes: 1024, scopeDisposal: 'retain',
        select: state => ({ count: state.count }),
        restore: (data, initial) => {
          if (data === null || typeof data !== 'object' || !('count' in data) || typeof data.count !== 'number') throw new Error('Invalid count')
          return { ...initial, count: data.count }
        },
        status: (draft, notice) => { draft.notice = notice },
      }, actions: {} }).create('s1')
    instances.push(value)
    expect(value.getSnapshot()).toEqual({ count: 0, notice: { state: 'blocked', reason: 'invalid' } })
    expect(env.records.get(key())).toBe(raw)
  })
  it('bounds complete stored UTF-8 envelopes before parsing', () => {
    const env = world(); const raw = encoded({ text: '🦆'.repeat(10) })
    env.records.set(key(), raw)
    expect(make({ maxBytes: raw.length }).getSnapshot().notice).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(make({ maxBytes: new TextEncoder().encode(raw).byteLength }).getSnapshot().text).toBe('🦆'.repeat(10))
    expect(make({ maxBytes: 5 }).getSnapshot().notice).toEqual({ state: 'blocked', reason: 'too-large' })
  })
  it.each(['missing', 'throwing'])('reports %s storage without blocking local edits', (kind) => {
    const env = world()
    if (kind === 'missing') vi.stubGlobal('localStorage', undefined)
    else env.storage.getItem.mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    const value = make(); value.actions.text('local only')
    expect(value.getSnapshot().text).toBe('local only')
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'unavailable' })
  })
  it.each([undefined, {}])('restores read-only with explicit notice when Web Locks are unavailable', async (navigator) => {
    const env = world(); env.records.set(key(), encoded()); vi.stubGlobal('navigator', navigator)
    const value = make(); expect(value.getSnapshot().text).toBe('recovered')
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'locking-unavailable' })
    value.actions.text('not saved'); await tick()
    expect(env.storage.setItem).not.toHaveBeenCalled()
  })
  it.each([{ version: 0 }, { maxBytes: 0 }, { name: '' }])('rejects invalid persistence configuration %s', (configuration) => {
    world(); expect(() => make(configuration)).toThrow('requires a name')
  })
})

describe('serialized revision-checked writes', () => {
  it('coalesces edits while waiting for the lock and ignores unrelated state changes', async () => {
    const env = world(); const value = make()
    value.actions.text('first'); value.actions.text('second'); await tick()
    expect(env.locks.request).toHaveBeenCalledOnce()
    value.actions.text('latest'); value.actions.transient(2)
    env.grant(); await tick()
    expect(env.storage.setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(env.records.get(key())!) as unknown).toMatchObject({ data: { text: 'latest' } })
  })
  it('rejects a stale tab without changing the stored winner or local edits', async () => {
    const env = world(); const first = make(); const second = make()
    first.actions.text('winner'); second.actions.text('stale'); await tick()
    env.grant(); await tick(); const winner = env.records.get(key())
    env.grant(); await tick()
    expect(second.getSnapshot()).toMatchObject({ text: 'stale', notice: { state: 'blocked', reason: 'conflict' } })
    second.actions.text('still local'); await tick()
    expect(env.records.get(key())).toBe(winner)
    expect(env.storage.setItem).toHaveBeenCalledOnce()
  })
  it('compares revisions even when another writer restores the original payload', async () => {
    const env = world(); env.records.set(key(), encoded())
    const stale = make(); const fresh = make()
    fresh.actions.text('changed'); await tick(); env.grant(); await tick()
    fresh.actions.text('recovered'); await tick(); env.grant(); await tick()
    stale.actions.text('stale change'); await tick(); env.grant(); await tick()
    expect(stale.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'conflict' })
  })
  it('continues saving edits made by subscribers during successful commit notification', async () => {
    const env = world(); const value = make()
    value.subscribe(() => { if (value.getSnapshot().notice.state === 'saved' && value.getSnapshot().text === 'one') value.actions.text('two') })
    value.actions.text('one'); await tick(); env.grant(); await tick()
    env.grant(); await tick()
    expect(JSON.parse(env.records.get(key())!) as unknown).toMatchObject({ data: { text: 'two' } })
  })
  it.each([false, true])('reports actual stored state when queued edits revert (existing record: %s)', async (exists) => {
    const env = world(); if (exists) env.records.set(key(), encoded())
    const value = make(); const original = value.getSnapshot().text
    value.actions.text('temporary'); await tick(); value.actions.text(original)
    env.grant(); await tick()
    expect(env.storage.setItem).not.toHaveBeenCalled()
    expect(env.records.has(key())).toBe(exists)
    expect(value.getSnapshot().notice).toEqual({ state: exists ? 'saved' : 'empty' })
  })
  it.each([false, true])('rejects stale revisions even when local edits revert (existing record: %s)', async (exists) => {
    const env = world(); if (exists) env.records.set(key(), encoded())
    const value = make(); const original = value.getSnapshot().text
    value.actions.text('temporary'); await tick(); value.actions.text(original)
    const winner = encoded({ text: 'Other tab won' }); env.records.set(key(), winner)
    env.grant(); await tick()
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'conflict' })
    expect(env.records.get(key())).toBe(winner)
    expect(env.storage.setItem).not.toHaveBeenCalled()
  })
  it.each(['QuotaExceededError', 'SecurityError'])('reports %s without discarding the local draft', async (name) => {
    const env = world(); const value = make()
    env.storage.setItem.mockImplementation(() => { throw new DOMException('Rejected', name) })
    value.actions.text('unsaved'); await tick(); env.grant(); await tick()
    expect(value.getSnapshot()).toMatchObject({ text: 'unsaved', notice: { state: 'blocked', reason: name === 'QuotaExceededError' ? 'quota' : 'unavailable' } })
    expect(env.records.has(key())).toBe(false)
  })
  it('bounds envelope overhead in addition to the selected payload', async () => {
    const env = world(); const value = make({ maxBytes: 40 })
    value.actions.text('small'); await tick(); env.grant(); await tick()
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'too-large' })
    expect(env.storage.setItem).not.toHaveBeenCalled()
  })
  it('bounds selected data and refuses nonfinite or non-JSON encoding', () => {
    world()
    const oversized = make({ maxBytes: 40 }); oversized.actions.text('x'.repeat(100))
    expect(oversized.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'too-large' })
    for (const invalid of [NaN, Infinity, undefined, 1n, () => {}, Symbol('x')]) {
      expect(make({ select: () => invalid }).getSnapshot().notice).toEqual({ state: 'blocked', reason: 'invalid' })
    }
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
    expect(make({ select: () => cyclic }).getSnapshot().notice).toEqual({ state: 'blocked', reason: 'invalid' })
  })
})

describe('persistence teardown and explicit deletion', () => {
  it('cancels coalesced work before it requests a lock but leaves local actions usable', async () => {
    const env = world(); const value = make(); value.actions.text('queued'); value.dispose(); value.dispose()
    value.actions.text('after disposal'); await tick()
    expect(value.getSnapshot().text).toBe('after disposal')
    expect(env.locks.request).not.toHaveBeenCalled()
  })
  it('aborts queued locks and rejects late callbacks before I/O or status publication', async () => {
    const env = world(); const value = make(); value.actions.text('queued'); await tick()
    const ticket = env.tickets[0]!; const notice = value.getSnapshot().notice
    value.dispose(); ticket.callback(); await tick()
    expect(ticket.signal.aborted).toBe(true)
    expect(env.storage.setItem).not.toHaveBeenCalled()
    expect(value.getSnapshot().notice).toBe(notice)
    await expect(value.clearPersisted()).rejects.toThrow('disposed')
  })
  it('clears only the observed revision and cannot resurrect queued writes', async () => {
    const env = world(); env.records.set(key(), encoded())
    const value = make(); value.actions.text('queued'); await tick()
    const clearing = value.clearPersisted(); env.grant(); await clearing; await tick()
    expect(env.records.has(key())).toBe(false)
    expect(value.getSnapshot().notice).toEqual({ state: 'empty' })
    value.actions.text('local after clear'); await tick()
    expect(env.records.has(key())).toBe(false)
    expect(env.storage.setItem).not.toHaveBeenCalled()
  })
  it('rejects deletion rather than deleting a concurrent winner', async () => {
    const env = world(); env.records.set(key(), encoded())
    const value = make(); const winner = encoded({ text: 'other tab' }); env.records.set(key(), winner)
    const clearing = value.clearPersisted(); env.grant()
    await expect(clearing).rejects.toThrow('conflict')
    expect(env.records.get(key())).toBe(winner)
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'conflict' })
  })
  it('rejects deletion failures with an observable notice', async () => {
    const env = world(); env.records.set(key(), encoded()); const value = make()
    env.storage.removeItem.mockImplementation(() => { throw new DOMException('Rejected', 'SecurityError') })
    const clearing = value.clearPersisted(); env.grant()
    await expect(clearing).rejects.toThrow('Rejected')
    expect(value.getSnapshot().notice).toEqual({ state: 'blocked', reason: 'unavailable' })
    expect(env.records.get(key())).toBe(encoded())
  })
  it('guards a late deletion callback after disposal', async () => {
    const env = world(); env.records.set(key(), encoded()); const value = make()
    const clearing = value.clearPersisted(); const ticket = env.tickets[0]!
    value.dispose()
    expect(() => { ticket.callback() }).toThrow('disposed before deletion')
    await expect(clearing).rejects.toThrow('Cancelled')
    expect(env.storage.removeItem).not.toHaveBeenCalled()
  })
  it('disposal cancels a pending deletion without deleting data or publishing another notice', async () => {
    const env = world(); env.records.set(key(), encoded()); const value = make()
    const before = value.getSnapshot().notice
    const clearing = value.clearPersisted(); value.dispose()
    await expect(clearing).rejects.toThrow('Cancelled')
    expect(env.records.get(key())).toBe(encoded())
    expect(value.getSnapshot().notice).toBe(before)
  })
})
