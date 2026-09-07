import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readyCaptureSurface } from '../src/client/clip-capture-surface.ts'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => { callback(performance.now()) }, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
function canvas() {
  return { width: 38, height: 280, getBoundingClientRect: () => ({ width: 446, height: 280 }) } as HTMLCanvasElement
}
it('waits for the renderer buffer and two stable samples, then removes all pending work', async () => {
  const target = canvas(), controller = new AbortController()
  const finished = vi.fn()
  const result = readyCaptureSurface(target, controller.signal, 100).then(finished)
  await vi.advanceTimersByTimeAsync(32)
  expect(finished).not.toHaveBeenCalled()
  target.width = 446
  await vi.advanceTimersByTimeAsync(16)
  expect(finished).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(16)
  await result
  expect(finished).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  controller.abort()
  expect(finished).toHaveBeenCalledOnce()
})
it('times out when a viewport never catches up', async () => {
  const result = readyCaptureSurface(canvas(), new AbortController().signal, 100)
  const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(100)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
it.each([true, false])('cancels pending and already-cancelled layout waits: %s', async (already) => {
  const controller = new AbortController()
  if (already) controller.abort()
  const assertion = expect(readyCaptureSurface(canvas(), controller.signal, 100)).rejects.toMatchObject({ code: 'aborted' })
  controller.abort()
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
