/** Wait for rendered canvas dimensions to catch up with its laid-out viewport before encoding. */
import { ClipVideoError } from './clip-video.ts'

/**
 * Observe two matching layout/buffer samples without retaining an animation loop after settlement.
 * @param canvas - The visible rendering owner's canvas, with its parent size locked for capture.
 * @param signal - Generation cancellation; an aborted wait acquires no recording resources.
 * @param timeoutMs - Deployment-owned startup deadline.
 * @returns A settled layout, or a capture timeout/cancellation after removing listeners and frames.
 */
export function readyCaptureSurface(canvas: HTMLCanvasElement, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let previous = ''
    let frame: number | undefined
    const finish = (error?: ClipVideoError) => {
      clearTimeout(timer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = () => { finish(new ClipVideoError('aborted', signal.reason)) }
    const timer = setTimeout(() => { finish(new ClipVideoError('timeout')) }, timeoutMs)
    const sample = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const identity = `${width}:${height}:${canvas.width}:${canvas.height}`
      // Integer framebuffer rounding permits one pixel on each axis, not an old viewport aspect ratio.
      const matches = width > 0 && height > 0 && canvas.width > 0 && canvas.height > 0
        && Math.abs(canvas.width * height - canvas.height * width) <= width + height
      if (matches && previous === identity) finish()
      else { previous = matches ? identity : ''; frame = requestAnimationFrame(sample) }
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else frame = requestAnimationFrame(sample)
  })
}
