import { describe, expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { createClipSequenceDefinitions, createClipSequenceView, type ClipSequenceReply } from '../src/client/clip-sequence-events.ts'

const id = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const output = (requestId = id, version = 2) => JSON.stringify({ kind: 'microduck-sequence', requestId,
  ...(version === 2 ? { guide: [{ start: 0, end: 1, description: '缓缓点头，然后回正。' }] } : {}), sequence: {} })
function event(seq: number, type: string, data: unknown, surfaceOp = 'append'): SessionEventLikeEntry {
  return { type: 'event', event: { seq, time: seq, type, data,
    ...['user/message', 'assistant/message', 'tool/result'].includes(type) ? { surfaceOp } : {},
  } as SessionEvent }
}
function user(seq: number, requestId = id, source = 'user', version = 2): SessionEventLikeEntry {
  return event(seq, 'user/message', { id: `message-${seq}`, role: 'user', source: { kind: source },
    content: [{ type: 'text', text: `MICRODUCK_SEQUENCE_REQUEST_V${version} ${requestId}\nActivity JSON: "nod"` }] })
}
function assistant(seq: number, turn = 0, text = output(), extra: Record<string, unknown> = {}): SessionEventLikeEntry {
  return event(seq, 'assistant/message', { turn, step: 0, stream: [],
    message: { id: `assistant-${seq}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }] }, ...extra })
}
function harness(maxBytes = 10000) {
  const definitions = createClipSequenceDefinitions(maxBytes)
  const view = createClipSequenceView()
  const assembler = new ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => undefined }, { entries: () => [view] })
  assembler.activateTarget('clip-gen')
  return {
    assembler,
    append: (...events: SessionEventLikeEntry[]) => {
      for (const entry of events) { assembler.append(entry); assembler.flush() }
      return assembler.snapshot('clip-gen') as ClipSequenceReply | null
    },
    read: () => assembler.snapshot('clip-gen') as ClipSequenceReply | null,
  }
}
function opening(turn = 0, base = 0): SessionEventLikeEntry[] {
  return [event(base, 'turn/start', { turn }), event(base + 1, 'step/start', { turn, step: 0 }), user(base + 2)]
}
function end(seq = 4, turn = 0, reason: unknown = { kind: 'completed' }) {
  return event(seq, 'turn/end', { turn, reason })
}

describe('sequence replies through Conversation assembly', () => {
  it('starts empty and contributes no shell activity', () => {
    const h = harness()
    expect(h.read()).toBeNull()
    expect(createClipSequenceView()).toMatchObject({ supportsBlankSession: true })
    expect(h.assembler.activityTargets()).toEqual(new Set())
    expect(() => createClipSequenceDefinitions(0)).toThrow()
  })

  it('joins an admitted request with final text only after the matching successful turn ends', () => {
    const h = harness()
    expect(h.append(...opening(), assistant(3))).toBeNull()
    expect(h.append(end())).toEqual({ requestId: id, turn: 0, seq: 4, status: 'complete', text: output() })
    const snapshot = h.read()
    h.append(event(5, 'turn/start', { turn: 1 }))
    expect(h.read()).toBe(snapshot)
    expect(h.assembler.activityTargets()).toEqual(new Set())
  })

  it('projects historical V1 requests and three-field replies without requiring a new guide', () => {
    const events = [event(0, 'turn/start', { turn: 0 }), event(1, 'step/start', { turn: 0, step: 0 }),
      user(2, id, 'user', 1), assistant(3, 0, output(id, 1)), end()]
    const h = harness()
    h.assembler.replaceWindow(events, false); h.assembler.flush()
    expect(h.read()).toMatchObject({ requestId: id, status: 'complete', text: output(id, 1) })
  })

  it('keeps ownership across a skill tool-call step and settles the later final only on turn end', () => {
    const h = harness()
    const events = [...opening(), assistant(3, 0, '', { message: { content: [
      { type: 'text', text: '先加载编舞技能。' },
      { type: 'tool-call', id: 'skill-1', name: 'skill', arguments: '{"name":"microduck-choreography"}' },
    ] } }), event(4, 'tool/call', { turn: 0, step: 0, id: 'skill-1', name: 'skill', arguments: '{"name":"microduck-choreography"}' }),
    event(5, 'tool/result', { turn: 0, step: 0, toolCallId: 'skill-1', content: [{ type: 'text', text: 'Loaded choreography skill' }] }),
    event(6, 'step/end', { turn: 0, step: 0 }), event(7, 'step/start', { turn: 0, step: 1 }),
    assistant(8, 0, output(), { step: 1 }), event(9, 'step/end', { turn: 0, step: 1 })]
    expect(h.append(...events)).toBeNull()
    expect(h.append(end(10))).toEqual({ requestId: id, turn: 0, seq: 10, status: 'complete', text: output() })
    const replay = harness()
    replay.assembler.replaceWindow([...events, end(10)], false); replay.assembler.flush()
    expect(replay.read()).toEqual(h.read())
  })

  it('recovers the same request ownership after an older turn start is paged into final-only history', () => {
    const h = harness()
    h.assembler.replaceWindow([assistant(3), end()], true); h.assembler.flush()
    expect(h.read()).toBeNull()
    h.assembler.prepend(opening(), false); h.assembler.flush()
    expect(h.read()).toEqual({ requestId: id, turn: 0, seq: 4, status: 'complete', text: output() })
  })

  it.each(['aborted', 'error', 'interrupted', 'blocked', 'max-tokens', 'future-reason'])('rejects %s termination despite valid JSON', (kind) => {
    const h = harness()
    h.append(...opening(), assistant(3), end(4, 0, { kind }))
    expect(h.read()).toMatchObject({ requestId: id, status: 'error', text: null })
  })

  it('rejects interrupted assistant text even if the turn closes completed', () => {
    const h = harness()
    h.append(...opening(), assistant(3, 0, output(), { interrupted: true }), end())
    expect(h.read()).toMatchObject({ status: 'error', text: null })
  })

  it.each(['ordinary prose', '', output(other), JSON.stringify({ kind: 'other', requestId: id, sequence: {} })])('settles malformed final reply %s as an error', (text) => {
    const h = harness()
    h.append(...opening(), assistant(3, 0, text), end())
    expect(h.read()).toMatchObject({ requestId: id, status: 'error', text: null })
  })

  it('does not import partial streams, tool results, reasoning or replacement copies', () => {
    const h = harness()
    h.append(...opening(), event(3, 'tool/result', { turn: 0, step: 0, text: output() }),
      assistant(4, 0, output(), { message: { content: [{ type: 'reasoning', text: output() }] } }),
      event(5, 'assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'text', text: output() }] } }, 'replace'), end(6))
    expect(h.read()).toMatchObject({ status: 'error', text: null })
  })

  it('uses the last committed assistant message, never concatenates answers across steps', () => {
    const h = harness()
    h.append(...opening(), assistant(3), assistant(4, 0, 'not JSON'), end(5))
    expect(h.read()).toMatchObject({ status: 'error' })
    const second = harness()
    second.append(...opening(), assistant(3, 0, 'not JSON'), assistant(4), end(5))
    expect(second.read()).toMatchObject({ status: 'complete', text: output() })
  })

  it('rejects a final assistant message with a tool call rather than a pure answer', () => {
    const h = harness()
    h.append(...opening(), assistant(3, 0, output(), { message: { content: [
      { type: 'text', text: output() }, { type: 'tool-call', toolCallId: 'call', name: 'robot_lab', arguments: '{}' },
    ] } }), end())
    expect(h.read()).toMatchObject({ status: 'error' })
  })

  it('bounds complete UTF-8 text and does not cap request admission by reply size', () => {
    const text = output().replace('{}', '{"name":"舞"}')
    const bytes = new TextEncoder().encode(text).byteLength
    const exact = harness(bytes)
    exact.append(...opening(), assistant(3, 0, text), end())
    expect(exact.read()).toMatchObject({ status: 'complete' })
    const small = harness(bytes - 1)
    small.append(...opening(), assistant(3, 0, text), end())
    expect(small.read()).toMatchObject({ status: 'error', text: null })
    const tiny = harness(1)
    tiny.append(...opening(), assistant(3), end())
    expect(tiny.read()).toMatchObject({ status: 'error', requestId: id })
  })

  it('rejects ambiguous requests in one turn and ignores synthetic or unrelated user messages', () => {
    const h = harness()
    const ambiguous = [...opening(), user(3, other), assistant(4), end(5)]
    h.append(...ambiguous)
    expect(h.read()).toEqual({ requestId: id, turn: 0, seq: 5, status: 'error', text: null,
      ambiguousRequestIds: [id, other] })
    const replay = harness()
    replay.assembler.replaceWindow(ambiguous, false); replay.assembler.flush()
    expect(replay.read()).toEqual(h.read())
    const unrelated = harness()
    unrelated.append(event(0, 'turn/start', { turn: 0 }), event(1, 'step/start', { turn: 0, step: 0 }),
      user(2, id, 'system'), user(3, 'not-uuid'), assistant(4), end(5))
    expect(unrelated.read()).toBeNull()
  })

  it('replays loaded history deterministically and keeps separate session builders independent', () => {
    const events = [...opening(), assistant(3), end()]
    const live = harness(); live.append(...events)
    const replay = harness(); replay.assembler.replaceWindow(events, false); replay.assembler.flush()
    expect(replay.read()).toEqual(live.read())
    const empty = harness(); expect(empty.read()).toBeNull()
    replay.assembler.replaceWindow([], false); replay.assembler.flush()
    expect(replay.read()).toBeNull()
  })

  it('retains newest completed request when earlier turns are rebuilt or unrelated turns finish', () => {
    const h = harness()
    h.append(...opening(), assistant(3), end(), ...opening(1, 5), assistant(8, 1), end(9, 1))
    expect(h.read()).toMatchObject({ seq: 9, turn: 1 })
    h.append(event(10, 'turn/start', { turn: 2 }), assistant(11, 2), end(12, 2))
    expect(h.read()).toMatchObject({ seq: 9, turn: 1 })
  })
})
