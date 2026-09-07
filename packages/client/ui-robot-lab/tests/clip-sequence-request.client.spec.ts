import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionFace, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createClipSequenceDefinitions, createClipSequenceView } from '../src/client/clip-sequence-events.ts'
import type { ClipSequence } from '../src/client/clip-sequence.ts'
import type { ClipSequenceRequestId } from '../src/client/clip-sequence-agent.ts'
import type { ClipSequenceReply } from '../src/client/clip-sequence-events.ts'
import { requestClipSequence, ClipSequenceRequestError } from '../src/client/clip-sequence-request.ts'
import { fixtureCatalog, fixtureProfile } from './fixtures.client.ts'

const id = '11111111-1111-4111-8111-111111111111' as ClipSequenceRequestId
const otherId = '22222222-2222-4222-8222-222222222222' as ClipSequenceRequestId
const profile = { ...fixtureProfile, modelSha256: 'a'.repeat(64) }
type Admission = Awaited<ReturnType<SessionFace['prompt']>>
const accepted: Admission = { ok: true, value: { accepted: true } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function sequence(): ClipSequence {
  return { version: 1, modelSha256: profile.modelSha256, jointNames: profile.joints.map(joint => joint.name), bpm: 120,
    clip: { version: 1, name: '舞步 🦆', duration: 2, loop: true, keys: [
      { t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
      { t: 0.3, joints: Array<number>(14).fill(0.2), rootPitch: 0.1 },
      { t: 2, joints: Array<number>(14).fill(0), rootPitch: 0 },
    ] } }
}
const guide = [{ start: 0, end: 1, description: '缓缓点头，双脚保持着地。' },
  { start: 1, end: 2, description: '颈部回到中立位置，停稳。' }]
const guideText = '0–1 s: 缓缓点头，双脚保持着地。\n1–2 s: 颈部回到中立位置，停稳。'
function reply(change: Partial<ClipSequenceReply> = {}): ClipSequenceReply {
  return { requestId: id, turn: 1, seq: 10, status: 'complete',
    text: JSON.stringify({ kind: 'microduck-sequence', requestId: id, guide, sequence: sequence() }), ...change }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  vi.restoreAllMocks()
})

function fixture() {
  const admission = deferred<Admission>()
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  let snapshot: ClipSequenceReply | null | undefined
  const unsubscribe = vi.fn()
  const replies = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener); unsubscribe() }
    }),
  }
  const abandon = vi.fn()
  const submissionId = '33333333-3333-4333-8333-333333333333' as ReturnType<SessionFace['beginSubmission']>['requestId']
  const beginSubmission = vi.fn<SessionFace['beginSubmission']>(() => ({ requestId: submissionId, abandon }))
  const prompt = vi.fn<SessionFace['prompt']>(() => admission.promise)
  const cancel = vi.fn<SessionFace['cancel']>().mockResolvedValue(accepted)
  const session = { beginSubmission, prompt, cancel } as unknown as SessionFace
  const request = { session, replies, requestId: id, instruction: '  Gentle neck nod 🦆\n', bpm: 120, profile,
    limits: fixtureCatalog.limits, maxBytes: 262144, signal: controller.signal }
  const outcomes: Promise<unknown>[] = []
  const start = () => {
    const promise = requestClipSequence(request)
    outcomes.push(promise.then(value => value, (error: unknown) => error))
    return promise
  }
  cleanups.push(async () => {
    controller.abort()
    admission.resolve(accepted)
    await Promise.all(outcomes)
    await Promise.allSettled([admission.promise])
  })
  return { request, start, admission, controller, beginSubmission, prompt, cancel, abandon, submissionId,
    replies, unsubscribe, listeners,
    publish: (value: ClipSequenceReply | null | undefined) => {
      snapshot = value
      for (const listener of [...listeners]) listener()
    },
    admit: async () => { admission.resolve(accepted); await admission.promise },
  }
}

describe('Current-session clip sequence request', () => {
  it('queues one logged prompt with the registered submission identity and imports only after admission', async () => {
    const value = fixture()
    const result = value.start()
    await Promise.resolve()
    expect(value.beginSubmission).toHaveBeenCalledTimes(1)
    const submission = value.beginSubmission.mock.calls[0]![0]
    expect(submission).toMatchObject({ mode: 'queue', attachments: [] })
    expect(submission.text).toContain(`MICRODUCK_SEQUENCE_REQUEST_V2 ${id}\n`)
    expect(submission.text).toContain(`Activity JSON: ${JSON.stringify(value.request.instruction)}`)
    expect(value.prompt).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: submission.text }],
      'queue', value.controller.signal, value.submissionId)
    expect(value.replies.subscribe.mock.invocationCallOrder[0]).toBeLessThan(value.beginSubmission.mock.invocationCallOrder[0]!)
    expect(value.beginSubmission.mock.invocationCallOrder[0]).toBeLessThan(value.prompt.mock.invocationCallOrder[0]!)
    await value.admit()
    value.publish(reply())
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.cancel).not.toHaveBeenCalled()
    expect(value.abandon).not.toHaveBeenCalled()
  })

  it('ignores missing snapshots and unrelated request ids until the matching reply arrives', async () => {
    const value = fixture()
    const result = value.start()
    const settled = vi.fn()
    void result.then(settled, settled)
    await value.admit()
    value.publish(undefined); value.publish(null); value.publish(reply({ requestId: otherId }))
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(value.listeners.size).toBe(1)
    value.publish(reply())
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('waits for admission even when the complete matching reply is already published', async () => {
    const value = fixture()
    const result = value.start()
    const settled = vi.fn()
    void result.then(settled, settled)
    value.publish(reply())
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(value.unsubscribe).not.toHaveBeenCalled()
    await value.admit()
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('rejects failed admission even if an early reply claims success', async () => {
    const value = fixture()
    const result = value.start()
    value.publish(reply())
    value.admission.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Rejected admission', {}) })
    await expect(result).rejects.toMatchObject({ kind: 'send' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
  })

  it('contains an asynchronous prompt rejection, abandons its echo and removes subscriptions', async () => {
    const value = fixture()
    const result = value.start()
    value.admission.reject(new Error('Transport disconnected'))
    await expect(result).rejects.toBeInstanceOf(ClipSequenceRequestError)
    await expect(result).rejects.toMatchObject({ kind: 'send' })
    expect(value.abandon).toHaveBeenCalledTimes(1)
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it.each(['beginSubmission', 'prompt'] as const)('cleans up and classifies a synchronous %s throw', async (method) => {
    const value = fixture()
    value[method].mockImplementation(() => { throw new Error('Synchronous admission failure') })
    await expect(value.start()).rejects.toMatchObject({ kind: 'send' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.abandon).toHaveBeenCalledTimes(method === 'prompt' ? 1 : 0)
  })

  it.each([
    reply({ status: 'error' }), reply({ text: null }), reply({ text: '{invalid' }),
    reply({ text: JSON.stringify({ kind: 'microduck-sequence', requestId: id, sequence: sequence() }) }),
    reply({ text: JSON.stringify({ kind: 'microduck-sequence', requestId: id, guide: [], sequence: sequence() }) }),
    reply({ text: JSON.stringify({ kind: 'microduck-sequence', requestId: otherId, guide, sequence: sequence() }) }),
    reply({ text: JSON.stringify({ kind: 'microduck-sequence', requestId: id, guide,
      sequence: { ...sequence(), modelSha256: 'b'.repeat(64) } }) }),
  ])('rejects an unsuccessful or invalid final reply %# without retaining its listener', async (response) => {
    const value = fixture()
    const result = value.start()
    await value.admit()
    value.publish(response)
    await expect(result).rejects.toMatchObject({ kind: 'reply' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it('settles the active second request when two admitted requests share one ambiguous turn', async () => {
    const value = fixture()
    value.request.requestId = otherId
    const result = value.start()
    await value.admit()
    const definitions = createClipSequenceDefinitions(value.request.maxBytes)
    const view = createClipSequenceView()
    const assembler = new ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => undefined },
      { entries: () => [view] })
    assembler.activateTarget('clip-gen')
    const event = (seq: number, type: string, data: unknown): SessionEventLikeEntry => ({ type: 'event',
      event: { seq, time: seq, type, data,
        ...(['user/message', 'assistant/message'].includes(type) ? { surfaceOp: 'append' } : {}),
      } as SessionEvent })
    const events = [event(0, 'turn/start', { turn: 0 }), event(1, 'step/start', { turn: 0, step: 0 }),
      ...[id, otherId].map((requestId, index) => event(index + 2, 'user/message', {
        id: `message-${index}`, role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: `MICRODUCK_SEQUENCE_REQUEST_V2 ${requestId}\nActivity JSON: "nod"` }],
      })),
      event(4, 'assistant/message', { turn: 0, step: 0, stream: [], message: { id: 'assistant-4', role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text: JSON.stringify({ kind: 'microduck-sequence', requestId: otherId, guide, sequence: sequence() }) }],
      } }), event(5, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
    ]
    for (const entry of events) {
      assembler.append(entry); assembler.flush()
      value.publish(assembler.snapshot('clip-gen') as ClipSequenceReply | null)
    }
    await expect(result).rejects.toMatchObject({ kind: 'reply' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it('imports the guide and motion after the skill step and final JSON complete the admitted turn', async () => {
    const value = fixture()
    const result = value.start()
    const definitions = createClipSequenceDefinitions(value.request.maxBytes)
    const view = createClipSequenceView()
    const assembler = new ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => undefined },
      { entries: () => [view] })
    assembler.activateTarget('clip-gen')
    const append = (seq: number, type: string, data: unknown) => {
      assembler.append({ type: 'event', event: { seq, time: seq, type, data,
        ...(['user/message', 'assistant/message', 'tool/result'].includes(type) ? { surfaceOp: 'append' } : {}),
      } as SessionEvent }); assembler.flush()
      value.publish(assembler.snapshot('clip-gen') as ClipSequenceReply | null)
    }
    await value.admit()
    append(0, 'turn/start', { turn: 0 })
    append(1, 'step/start', { turn: 0, step: 0 })
    append(2, 'user/message', { id: 'request', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: value.beginSubmission.mock.calls[0]![0].text }] })
    append(3, 'assistant/message', { turn: 0, step: 0, stream: [], message: { id: 'skill-load', role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: 'skill-1', name: 'skill', arguments: '{"name":"microduck-choreography"}' }] } })
    append(4, 'tool/result', { turn: 0, step: 0, toolCallId: 'skill-1', content: [{ type: 'text', text: 'Loaded choreography skill' }] })
    append(5, 'step/end', { turn: 0, step: 0 })
    append(6, 'step/start', { turn: 0, step: 1 })
    append(7, 'assistant/message', { turn: 0, step: 1, stream: [], message: { id: 'final', role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: reply().text }] } })
    append(8, 'step/end', { turn: 0, step: 1 })
    expect(value.listeners.size).toBe(1)
    append(9, 'turn/end', { turn: 0, reason: { kind: 'completed' } })
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(value.listeners.size).toBe(0)
    expect(value.prompt).toHaveBeenCalledTimes(1)
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it('ignores an ambiguous error that does not include the pending request', async () => {
    const value = fixture()
    const result = value.start()
    await value.admit()
    value.publish(reply({ requestId: otherId, status: 'error', text: null, ambiguousRequestIds: [otherId] }))
    expect(value.listeners.size).toBe(1)
    value.publish(reply())
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
  })

  it('rejects an otherwise valid response that changes the requested tempo', async () => {
    const value = fixture()
    const result = value.start()
    await value.admit()
    const differentTempo = { ...sequence(), bpm: 140 }
    value.publish(reply({ text: JSON.stringify({ kind: 'microduck-sequence', requestId: id, guide, sequence: differentTempo }) }))
    await expect(result).rejects.toMatchObject({ kind: 'reply' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
  })

  it('applies the complete reply byte budget before import', async () => {
    const value = fixture()
    value.request.maxBytes = new TextEncoder().encode(reply().text!).byteLength - 1
    const result = value.start()
    await value.admit()
    value.publish(reply())
    await expect(result).rejects.toMatchObject({ kind: 'reply' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe or submit when already cancelled', async () => {
    const value = fixture()
    value.controller.abort()
    await expect(value.start()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(value.replies.subscribe).not.toHaveBeenCalled()
    expect(value.beginSubmission).not.toHaveBeenCalled()
    expect(value.prompt).not.toHaveBeenCalled()
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it('unsubscribes without submitting when cancellation precedes the queued admission microtask', async () => {
    const value = fixture()
    const result = value.start()
    value.controller.abort()
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    expect(value.beginSubmission).not.toHaveBeenCalled()
    expect(value.prompt).not.toHaveBeenCalled()
  })

  it.each([false, true])('cancels local import without cancelling the shared session, admitted=%s', async (admitted) => {
    const value = fixture()
    const result = value.start()
    await Promise.resolve()
    if (admitted) await value.admit()
    value.controller.abort()
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.listeners.size).toBe(0)
    value.publish(reply())
    await value.admit()
    expect(value.cancel).not.toHaveBeenCalled()
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('contains a late prompt rejection after disposal without changing the cancellation outcome', async () => {
    const value = fixture()
    const result = value.start()
    await Promise.resolve()
    value.controller.abort()
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    value.admission.reject(new Error('Late transport rejection'))
    await Promise.allSettled([value.admission.promise])
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    expect(value.abandon).toHaveBeenCalledTimes(1)
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.cancel).not.toHaveBeenCalled()
  })

  it('removes cancellation and reply listeners after successful settlement', async () => {
    const value = fixture()
    const removed = vi.spyOn(value.controller.signal, 'removeEventListener')
    const result = value.start()
    await value.admit()
    value.publish(reply())
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    value.controller.abort(); value.publish(reply({ status: 'error' }))
    await expect(result).resolves.toEqual({ guide: guideText, sequence: sequence() })
    expect(value.unsubscribe).toHaveBeenCalledTimes(1)
    expect(value.cancel).not.toHaveBeenCalled()
  })
})
