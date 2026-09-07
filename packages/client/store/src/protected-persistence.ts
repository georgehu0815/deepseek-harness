/** Versioned browser draft recovery; every write is revision-checked inside a synchronous Web Lock callback. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PersistNotice, ProtectedPersistence } from './contract.ts'
import type { SnapshotStore } from './index.ts'

type Reason = Extract<PersistNotice, { state: 'blocked' }>['reason']
class PersistenceFailure extends Error {
  constructor(readonly reason: Reason) { super(`Protected store persistence: ${reason}`) }
}
function reason(error: unknown): Reason {
  if (error instanceof PersistenceFailure) return error.reason
  return error instanceof Error && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable'
}
function json(value: unknown): string {
  try {
    const encoded = JSON.stringify(value, (_key, value: unknown) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
        || (typeof value === 'number' && !Number.isFinite(value))) throw new PersistenceFailure('invalid')
      return value
    })
    return encoded
  } catch {
    throw new PersistenceFailure('invalid')
  }
}
function bounded(raw: string, maximum: number): string {
  if (raw.length > maximum || new TextEncoder().encode(raw).byteLength > maximum) throw new PersistenceFailure('too-large')
  return raw
}
function envelope(raw: string, version: number, scopeKey: string | null): unknown {
  let parsed: unknown
  try { parsed = JSON.parse(raw) as unknown } catch { throw new PersistenceFailure('invalid') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PersistenceFailure('invalid')
  const row = parsed as Record<string, unknown>
  const keys = ['format', 'version', 'scopeKey', 'revision', 'data']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))
    || !Number.isSafeInteger(row.format) || !Number.isSafeInteger(row.version)
    || (row.format as number) < 1 || (row.version as number) < 1) throw new PersistenceFailure('invalid')
  if (row.format !== 1 || row.version !== version) throw new PersistenceFailure('unsupported-version')
  if (row.scopeKey !== scopeKey || typeof row.revision !== 'string' || row.revision.length !== 36
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.revision)) throw new PersistenceFailure('invalid')
  return row.data
}

/**
 * Attach protected partial-state persistence without changing the public snapshot-store API.
 * @param store - Owning mutable store.
 * @param spec - Explicit codec, byte limit and notice projection.
 * @param scopeKey - Exact renderer session identity, absent only for root stores.
 * @returns Synchronous cancellation and an explicit revision-checked deletion operation.
 */
export function attachProtectedPersistence<T>(store: SnapshotStore<T>, spec: ProtectedPersistence<T>, scopeKey?: string): {
  dispose(): void
  clearPersisted(): Promise<void>
} {
  if (!spec.name.trim() || !Number.isSafeInteger(spec.version) || spec.version < 1
    || !Number.isSafeInteger(spec.maxBytes) || spec.maxBytes < 1) {
    throw new Error('Protected persistence requires a name, positive version/byte limit, and scopeDisposal:retain')
  }
  const scope = scopeKey ?? null
  const key = `dsh.store.protected:${JSON.stringify([spec.name, scope])}`
  let phase: 'active' | 'blocked' | 'clearing' | 'cleared' | 'closed' = 'active'
  let baseline: string | null = null
  let committed = ''
  let storage: Storage
  let locks: LockManager
  let controller = new AbortController()
  let scheduled = false
  let busy = false
  let reporting = false
  let notice: PersistNotice | undefined
  let unsubscribe = () => {}

  function report(next: PersistNotice): void {
    if (phase === 'closed' || JSON.stringify(notice) === JSON.stringify(next)) return
    notice = next
    reporting = true
    try { store.update((draft) => { spec.status(draft, next) }) } finally { reporting = false }
  }
  function block(error: unknown): void {
    if (phase === 'closed') return
    phase = 'blocked'
    controller.abort()
    report({ state: 'blocked', reason: reason(error) })
  }
  function payload(state: T = store.getSnapshot()): string { return bounded(json(spec.select(state)), spec.maxBytes) }

  const initial = store.getSnapshot()
  try {
    storage = localStorage
    baseline = storage.getItem(key)
    if (baseline !== null) {
      const data = envelope(bounded(baseline, spec.maxBytes), spec.version, scope)
      let restored: T
      try { restored = spec.restore(data, initial) } catch { throw new PersistenceFailure('invalid') }
      committed = payload(restored)
      store.set(restored)
    } else committed = payload()
    report({ state: baseline === null ? 'empty' : 'restored' })
    const available = typeof navigator === 'undefined' ? undefined : (navigator as Partial<Navigator>).locks
    if (available === undefined) throw new PersistenceFailure('locking-unavailable')
    locks = available
    unsubscribe = store.subscribe(changed)
  } catch (error) { block(error) }

  function changed(): void {
    if (reporting || phase !== 'active') return
    try {
      if (payload() === committed) return
      report({ state: 'pending' })
      if (scheduled || busy) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (phase === 'active') void flush()
      })
    } catch (error) { block(error) }
  }
  async function flush(): Promise<void> {
    busy = true
    try {
      await locks.request(key, { mode: 'exclusive', signal: controller.signal }, () => {
        if (phase !== 'active') return
        const selected = payload()
        if (storage.getItem(key) !== baseline) throw new PersistenceFailure('conflict')
        if (selected === committed) { report({ state: baseline === null ? 'empty' : 'saved' }); return }
        const raw = bounded(json({ format: 1, version: spec.version, scopeKey: scope,
          revision: randomUUID(), data: JSON.parse(selected) as unknown }), spec.maxBytes)
        storage.setItem(key, raw)
        baseline = raw
        committed = selected
        report({ state: 'saved' })
      })
    } catch (error) {
      if (phase === 'active') block(error)
    } finally {
      busy = false
      changed()
    }
  }

  return {
    dispose: () => {
      phase = 'closed'
      controller.abort()
      unsubscribe()
    },
    clearPersisted: async () => {
      if (phase !== 'active') throw new Error('Protected persistence cannot clear a disposed, blocked or already-cleared instance')
      phase = 'clearing'
      unsubscribe()
      controller.abort()
      controller = new AbortController()
      try {
        await locks.request(key, { mode: 'exclusive', signal: controller.signal }, () => {
          if (phase !== 'clearing') throw new Error('Protected persistence was disposed before deletion')
          if (storage.getItem(key) !== baseline) throw new PersistenceFailure('conflict')
          storage.removeItem(key)
          baseline = null
          phase = 'cleared'
          report({ state: 'empty' })
        })
      } catch (error) {
        block(error)
        throw error
      }
    },
  }
}
