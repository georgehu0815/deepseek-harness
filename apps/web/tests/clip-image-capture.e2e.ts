/** Decode real PNG downloads from the native simulation workspace, including idle WebGL readback. */
import { fileURLToPath } from 'node:url'
import { buffer } from 'node:stream/consumers'
import { chromium, type Browser } from 'playwright'
import { build } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { clipPartScene } from '../../../packages/client/ui-robot-lab/tests/clip-part-fixture.ts'

interface BrowserFixture extends Window {
  clipImageTest: { mount(scene: ReturnType<typeof clipPartScene>): () => void }
  disposeClipImage: () => void
}

let browser: Browser | undefined
let script: string
let styles: string
beforeAll(async () => {
  const result = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', jsxDev: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, minify: false, lib: {
      entry: fileURLToPath(new URL('./fixtures/clip-image-browser.tsx', import.meta.url)), name: 'clipImageTest', formats: ['iife'],
    } } })
  const files = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : [])
  const chunk = files.find(file => file.type === 'chunk')
  if (chunk === undefined) throw new Error('Missing browser image fixture bundle')
  script = chunk.code
  styles = files.flatMap(file => file.type === 'asset' && file.fileName.endsWith('.css')
    ? [String(file.source)] : []).join('\n')
  browser = await chromium.launch()
})
afterAll(async () => { await browser?.close() })

it('downloads opaque, nonblank canvas-sized PNGs with the current camera and environment after idle frames', async () => {
  if (browser === undefined) throw new Error('Browser is not initialized')
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent('<div id="root" style="width:760px;height:900px"></div>')
    await page.addStyleTag({ content: styles })
    await page.addScriptTag({ content: script })
    expect(errors).toEqual([])
    await page.evaluate((scene) => {
      const host = window as unknown as BrowserFixture
      host.disposeClipImage = host.clipImageTest.mount(scene)
    }, clipPartScene())
    const capture = page.getByRole('button', { name: 'Capture view (PNG)' })
    await capture.waitFor()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[title^="Save the current view"]')!.disabled)
    const downloadView = async () => {
      // Two frames permit compositing to discard an unpreserved WebGL drawing buffer before the click.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
      const dimensions = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }))
      const pending = page.waitForEvent('download')
      await capture.click()
      const download = await pending
      expect(download.suggestedFilename()).toBe('microduck-clip-cover-0.00s.png')
      expect(await download.failure()).toBeNull()
      const bytes = await buffer(await download.createReadStream())
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const pixels = await page.evaluate(async (base64) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, image.width, image.height).data
        let opaque = 0
        const colors = new Set<number>()
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] === 255) opaque++
          colors.add(data[index]! << 16 | data[index + 1]! << 8 | data[index + 2]!)
        }
        return { width: image.width, height: image.height, opaque, colors: colors.size, corner: [...data.slice(0, 4)] }
      }, bytes.toString('base64'))
      expect(pixels).toMatchObject(dimensions)
      expect(pixels.opaque).toBe(dimensions.width * dimensions.height)
      expect(pixels.colors).toBeGreaterThan(20)
      return pixels
    }
    const first = await downloadView()
    expect(first.width).toBeGreaterThan(760)
    await page.getByRole('button', { name: 'Top', exact: true }).click()
    await page.getByLabel('Show floor', { exact: true }).uncheck()
    await page.getByLabel('Background color').fill('#ff0000')
    const second = await downloadView()
    expect(second.corner).not.toEqual(first.corner)
    expect(second.corner[0]).toBeGreaterThan(second.corner[1]!)
    expect(errors).toEqual([])
    await page.evaluate(() => { (window as unknown as BrowserFixture).disposeClipImage() })
    expect(await page.locator('canvas').count()).toBe(0)
  } finally { await page.close() }
})
