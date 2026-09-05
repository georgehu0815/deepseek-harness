/** The opt-in Studio responder substitutes external Robot RPC only, never a live carrier. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFixtureFaces, FixtureApiClient } from '../src/client/fixture.ts'

function timing() {
  return (globalThis as typeof globalThis & {
    __fxTiming: { setRobotLabResponder: (responder: (sessionId: string, request: unknown) => unknown) => void }
  }).__fxTiming
}
const payload = { args: { agentId: 'fx-alpha', request: { operation: 'readiness' } } }

afterEach(() => { vi.unstubAllGlobals() })

describe('Robot Studio fixture transport', () => {
  it('preserves generic and empty fixtures as unavailable Robot endpoints', async () => {
    for (const options of [{}, { empty: true }]) {
      const { rpc } = createFixtureFaces(options)
      expect(() => { timing().setRobotLabResponder(() => ({})) }).toThrow('Robot Studio scenario is not enabled')
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
