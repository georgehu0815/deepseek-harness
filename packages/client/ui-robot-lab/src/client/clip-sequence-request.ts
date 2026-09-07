/** One current-agent admission and its correlated, committed authoring reply. */
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RobotProfile, RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import { buildClipSequencePrompt, decodeClipSequenceReply } from './clip-sequence-agent.ts'
import type { ClipChoreographyResult, ClipSequenceRequestId } from './clip-sequence-agent.ts'
import type { ClipSequenceReply } from './clip-sequence-events.ts'

/** Local cancellation drops result import; it does not interrupt the shared agent. */
export class ClipSequenceRequestError extends Error {
  constructor(readonly kind: 'send' | 'reply' | 'cancelled') { super(`Clip sequence ${kind}`) }
}

/** Frozen user request and installed model metadata for one agent turn. */
export interface ClipSequenceRequest {
  session: SessionFace
  replies: ObservableSnapshot<ClipSequenceReply | null | undefined>
  requestId: ClipSequenceRequestId
  instruction: string
  bpm: number
  profile: RobotProfile
  limits: RobotStudioCatalog['limits']
  scene?: RobotScene
  maxBytes: number
  signal: AbortSignal
}

/**
 * Submit through the ordinary logged user-message path and wait for the identified turn's final reply.
 * @param request - Captured session, reply source, model metadata and local cancellation signal.
 * @returns A validated timed guide and keyed sequence at the requested tempo; failed admission, invalid reply or cancellation rejects.
 */
export function requestClipSequence(request: ClipSequenceRequest): Promise<ClipChoreographyResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let admitted = false
    let unsubscribe = () => {}
    const finish = (result: ClipChoreographyResult | ClipSequenceRequestError) => {
      if (settled) return
      settled = true
      unsubscribe()
      request.signal.removeEventListener('abort', cancel)
      if (result instanceof ClipSequenceRequestError) reject(result)
      else resolve(result)
    }
    const cancel = () => { finish(new ClipSequenceRequestError('cancelled')) }
    const receive = () => {
      if (settled || !admitted) return
      const reply = request.replies.getSnapshot()
      if (reply == null || (reply.requestId !== request.requestId
        && !(reply.status === 'error' && reply.ambiguousRequestIds?.includes(request.requestId)))) return
      if (reply.status !== 'complete' || reply.text === null) { finish(new ClipSequenceRequestError('reply')); return }
      let choreography: ClipChoreographyResult
      try {
        choreography = decodeClipSequenceReply(reply.text, request.requestId, request.profile, request.limits, request.maxBytes)
      } catch {
        // The decoder accepts untrusted model text; invalid output never changes the draft.
        finish(new ClipSequenceRequestError('reply')); return
      }
      if (choreography.sequence.bpm !== request.bpm) { finish(new ClipSequenceRequestError('reply')); return }
      finish(choreography)
    }
    if (request.signal.aborted) { cancel(); return }
    request.signal.addEventListener('abort', cancel, { once: true })
    unsubscribe = request.replies.subscribe(receive)
    let submission: ReturnType<SessionFace['beginSubmission']> | undefined
    void Promise.resolve().then(() => {
      if (settled) return null
      const text = buildClipSequencePrompt(request.requestId, request.instruction, request.profile,
        request.limits, request.bpm, request.scene)
      submission = request.session.beginSubmission({ mode: 'queue', text, attachments: [] })
      return request.session.prompt([{ type: 'text', text }], 'queue', request.signal, submission.requestId)
    }).then((result) => {
      if (result === null) return
      if (!result.ok) { finish(new ClipSequenceRequestError('send')); return }
      admitted = true
      receive()
    }, () => { submission?.abandon(); finish(new ClipSequenceRequestError('send')) })
  })
}
