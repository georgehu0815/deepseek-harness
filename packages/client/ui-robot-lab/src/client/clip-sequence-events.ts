/** Incremental Conversation correlation for V1/V2 requests; guide and model validation belong to the importing request. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { clipSequenceRequestId, parseClipSequenceEnvelope, type ClipSequenceRequestId } from './clip-sequence-agent.ts'

/** Settled, correlated output; complete still requires installed-model validation before import. */
export interface ClipSequenceReply {
  requestId: ClipSequenceRequestId
  turn: number
  seq: number
  status: 'complete' | 'error'
  text: string | null
  /** Present only for an error settling every request admitted into an ambiguous shared turn. */
  ambiguousRequestIds?: ClipSequenceRequestId[]
}

type SequenceNodeData =
  | { kind: 'request'; turn: number; seq: number; requestId: ClipSequenceRequestId }
  | { kind: 'response'; turn: number; seq: number; text: string | null; status: 'complete' | 'error' }
/** Target-owned nodes; request placement comes from the engine, never a mutable last-turn cursor. */
export interface ClipSequenceNode extends ConversationViewNode { data: SequenceNodeData }
interface SequenceEventState {
  requestId: ClipSequenceRequestId | null
  turn: number | null
  seq: number
  text: string | null
  ended: boolean
  status: 'complete' | 'error'
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Latest correlated settled sequence reply in this session's loaded history. */
    'clip-gen': ClipSequenceReply | null
  }
}

function textOnly(content: readonly ContentBlock[], maxBytes: number): string | null {
  let text = ''
  for (const block of content) {
    if (block.type !== 'text') continue
    if (block.text.length > maxBytes - text.length) return null
    text += block.text
  }
  return new TextEncoder().encode(text).byteLength <= maxBytes ? text : null
}

function turnOf(match: ConversationMatch): number | null {
  return match.location.kind === 'turn' || match.location.kind === 'step' ? match.location.turn.turn : null
}

/**
 * Register separate request and turn definitions because user messages carry no turn coordinate.
 * @param maxBytes - Positive complete assistant-text UTF-8 budget.
 * @returns Pure definitions whose target builder joins engine-resolved turns without scanning event history.
 */
export function createClipSequenceDefinitions(maxBytes: number): readonly ConversationNodeDefinition<SequenceEventState>[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Sequence reply byte limit must be a positive integer')
  const request: ConversationNodeDefinition<SequenceEventState> = {
    kind: 'clip-sequence-request', target: 'clip-gen',
    match: event => event.type === 'user/message' && isAppendSurfaceEvent(event) && event.data.source.kind === 'user'
      ? { id: String(event.data.id), role: 'start' } : null,
    start: (_context, match) => ({
      requestId: match.event.type === 'user/message'
        ? clipSequenceRequestId(match.event.data.content.find(block => block.type === 'text')?.text ?? '') : null,
      turn: turnOf(match), seq: match.event.seq, text: null, ended: false, status: 'error',
    }),
    update: context => context.state,
    buildViewNode: (context) => {
      const state = context.state
      const turn = context.start === undefined ? null : turnOf(context.start)
      if (state?.requestId === null || state === undefined || turn === null) return null
      return { key: context.key, kind: context.kind, id: context.id, target: 'clip-gen',
        data: { kind: 'request', turn, seq: state.seq, requestId: state.requestId } }
    },
  }
  const response: ConversationNodeDefinition<SequenceEventState> = {
    kind: 'clip-sequence-turn', target: 'clip-gen',
    match: (event) => {
      if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
      if (event.type === 'turn/end' || (event.type === 'assistant/message' && isAppendSurfaceEvent(event))) {
        return { id: String(event.data.turn), role: 'update' }
      }
      return null
    },
    start: (_context, match) => ({ requestId: null,
      turn: match.event.type === 'turn/start' ? match.event.data.turn : null,
      seq: match.event.seq, text: null, ended: false, status: 'error' }),
    update: (context, match) => {
      if (match.event.type === 'assistant/message') {
        const text = match.event.data.interrupted === true
          || match.event.data.message.content.some(block => block.type === 'tool-call')
          ? null : textOnly(match.event.data.message.content, maxBytes)
        return { ...context.state, text, status: text === null || text.trim() === '' ? 'error' : 'complete' }
      }
      if (match.event.type === 'turn/end') return { ...context.state, seq: match.event.seq, ended: true,
        status: match.event.data.reason.kind === 'completed' ? context.state.status : 'error' }
      return context.state
    },
    buildViewNode: (context) => {
      const state = context.state
      if (state === undefined || !state.ended || state.turn === null) return null
      return { key: context.key, kind: context.kind, id: context.id, target: 'clip-gen',
        data: { kind: 'response', turn: state.turn, seq: state.seq, status: state.status,
          text: state.status === 'complete' ? state.text : null } }
    },
  }
  return [request, response]
}

type SequenceTurn = { requests: Map<string, ClipSequenceRequestId>; response?: Extract<SequenceNodeData, { kind: 'response' }> }

class SequenceViewBuilder implements ConversationViewBuilder<ClipSequenceNode, ClipSequenceReply | null> {
  readonly empty = null
  private turns = new Map<number, SequenceTurn>()
  private latest: ClipSequenceReply | null = null

  replace(input: Parameters<ConversationViewBuilder<ClipSequenceNode>['replace']>[0]): ClipSequenceReply | null {
    this.turns.clear(); this.latest = null
    return this.apply({ upserts: input.nodes, timeline: input.timeline })
  }

  apply(input: Parameters<ConversationViewBuilder<ClipSequenceNode>['apply']>[0]): ClipSequenceReply | null {
    const touched = new Set<number>()
    for (const node of input.upserts) {
      const data = node.data
      let turn = this.turns.get(data.turn)
      if (turn === undefined) { turn = { requests: new Map() }; this.turns.set(data.turn, turn) }
      if (data.kind === 'request') turn.requests.set(node.key, data.requestId)
      else turn.response = data
      touched.add(data.turn)
    }
    for (const turnId of touched) {
      const turn = this.turns.get(turnId) as SequenceTurn
      const response = turn.response
      if (response === undefined || turn.requests.size === 0 || (this.latest !== null && response.seq < this.latest.seq)) continue
      const ids = new Set(turn.requests.values())
      const requestId = ids.values().next().value as ClipSequenceRequestId
      let status = ids.size === 1 ? response.status : 'error' as const
      if (status === 'complete' && response.text !== null) {
        try { parseClipSequenceEnvelope(response.text, requestId, new TextEncoder().encode(response.text).byteLength) }
        catch { status = 'error' }
      }
      const text = status === 'complete' ? response.text : null
      const ambiguousRequestIds = ids.size > 1 ? [...ids] : undefined
      if (this.latest?.seq === response.seq && this.latest.requestId === requestId
        && this.latest.status === status && this.latest.text === text
        && JSON.stringify(this.latest.ambiguousRequestIds) === JSON.stringify(ambiguousRequestIds)) continue
      this.latest = { requestId, turn: turnId, seq: response.seq, status, text,
        ...(ambiguousRequestIds === undefined ? {} : { ambiguousRequestIds }) }
    }
    return this.latest
  }
}

/**
 * Create an event-backed Clip Gen view without contributing shell activity or starting work.
 * @returns Per-session incremental builders with a stable null empty snapshot.
 */
export function createClipSequenceView(): ConversationViewDefinition<ClipSequenceNode, ClipSequenceReply | null> {
  return { target: 'clip-gen', supportsBlankSession: true, isActive: () => false, create: () => new SequenceViewBuilder() }
}
