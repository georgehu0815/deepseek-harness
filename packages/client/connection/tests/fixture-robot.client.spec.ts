/** Opt-in Studio fixtures substitute external Robot RPC and authored model text, never a live carrier. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFixtureFaces, FixtureApiClient } from '../src/client/fixture.ts'

function timing() {
  return (globalThis as typeof globalThis & {
    __fxTiming: {
      setRobotLabResponder: (responder: (sessionId: string, request: unknown) => unknown) => void
      setPromptResponder: (responder: (sessionId: string, prompt: string) => string) => void
    }
  }).__fxTiming
}
const payload = { args: { agentId: 'fx-alpha', request: { operation: 'readiness' } } }

afterEach(() => { vi.unstubAllGlobals() })

describe('Robot Studio fixture transport', () => {
  it('preserves generic and empty fixtures as unavailable Robot endpoints', async () => {
    for (const options of [{}, { empty: true }]) {
      const { rpc } = createFixtureFaces(options)
      expect(() => { timing().setRobotLabResponder(() => ({})) }).toThrow('Robot Studio scenario is not enabled')
      expect(() => { timing().setPromptResponder(() => 'reply') }).toThrow('Robot Studio scenario is not enabled')
      await expect(rpc.call('/api', 'robotLab/request', payload)).rejects.toThrow('endpoint "robotLab/request" is unavailable')
    }
  })

  it('rejects a missing responder and unrelated channels and endpoints', async () => {
    const { rpc } = createFixtureFaces({ robotStudio: true })
    await expect(rpc.call('/api', 'robotLab/request', payload)).rejects.toThrow('is unavailable')
    const respond = vi.fn(() => ({ operation: 'readiness' }))
    timing().setRobotLabResponder(respond)
    await expect(rpc.call('/other', 'robotLab/request', payload)).rejects.toThrow('channel "/other" is unavailable')
    await expect(rpc.call('/api', 'robotLab/other', payload)).rejects.toThrow('endpoint "robotLab/other" is unavailable')
    expect(respond).not.toHaveBeenCalled()
  })

  it('carries the captured session and raw request without importing Robot business logic', async () => {
    const { rpc } = createFixtureFaces({ robotStudio: true })
    const reply = { operation: 'readiness', readiness: { ready: true } }
    const respond = vi.fn(() => reply)
    timing().setRobotLabResponder(respond)
    await expect(rpc.call('/api', 'robotLab/request', payload)).resolves.toEqual({ ok: true, value: reply })
    expect(respond).toHaveBeenCalledWith('fx-alpha', payload.args.request)
    timing().setRobotLabResponder(() => Promise.reject(new Error('fixture robot failed')))
    await expect(rpc.call('/api', 'robotLab/request', payload)).rejects.toThrow('fixture robot failed')
  })

  it('substitutes authored model output through the ordinary queued prompt and committed history', async () => {
    vi.stubGlobal('__fxTiming', undefined)
    vi.useFakeTimers()
    try {
      const { rpc } = createFixtureFaces({ robotStudio: true })
      const responder = vi.fn(() => 'authored sequence')
      timing().setPromptResponder(responder)
      expect(responder).not.toHaveBeenCalled()
      await expect(rpc.call('/api', 'session/prompt', { args: { request: {
        sessionId: 'fx-alpha', mode: 'queue', content: [{ type: 'text', text: 'author this motion' }],
      } } })).resolves.toEqual({ ok: true, value: { accepted: true } })
      expect(responder).toHaveBeenCalledExactlyOnceWith('fx-alpha', 'author this motion')
      await vi.runAllTimersAsync()
      const history = await rpc.call('/api', 'session/page', { args: { request: {
        address: { kind: 'session', sessionId: 'fx-alpha' }, maxMessages: 100,
      } } })
      expect(JSON.stringify(history)).toContain('authored sequence')
      expect(JSON.stringify(history)).toContain('"kind":"completed"')
    } finally {
      await vi.runOnlyPendingTimersAsync()
      vi.useRealTimers()
    }
  })

  it('selects the scenario explicitly from the browser query without network fallback', async () => {
    vi.stubGlobal('location', { search: '?fixture&fixtureRobot=studio' })
    const fetch = vi.fn(() => { throw new Error('unexpected network') })
    vi.stubGlobal('fetch', fetch)
    const client = new FixtureApiClient()
    timing().setRobotLabResponder(() => ({ operation: 'projects', projects: [] }))
    await expect(client.rpc.call('/api', 'robotLab/request', payload)).resolves.toEqual({ ok: true, value: { operation: 'projects', projects: [] } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
