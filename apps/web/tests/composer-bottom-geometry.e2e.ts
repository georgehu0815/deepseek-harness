// Browser layout coverage for the conversation shell's empty and populated scrollport.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.each([
  { phase: 'hero', contentHeight: 0 },
  { phase: 'active', contentHeight: 0 },
  { phase: 'active', contentHeight: 120 },
  { phase: 'active', contentHeight: 1600 },
])('docks the $phase composer with $contentHeight px of history', async ({ phase, contentHeight }) => {
  const css = await readFile(new URL('../../../packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.setContent(`
      <style>
        ${css}
        html, body { height: 100%; margin: 0; }
        [data-slot] { display: contents; }
        .header { height: 60px; padding: 0; }
        [data-test-input] { height: 120px; flex: none; }
      </style>
      <div class="root" data-phase="${phase}">
        <header class="header"></header>
        <div class="body">
          <div class="scrollBody" data-conversation-scroll>
            <div data-slot="conversation.session">${contentHeight === 0 ? '' : `<div class="viewArea"><div style="height: ${contentHeight}px; flex: none"></div></div>`}</div>
            <div class="composerSeat" data-composer-seat>
              <div class="composerStack ${phase === 'hero' ? 'composerHero' : ''}"><div data-test-input></div></div>
            </div>
          </div>
        </div>
      </div>
    `)
    for (const height of [800, 420]) {
      await page.setViewportSize({ width: 1280, height })
      for (const scrollTop of [0, 600, 1600]) {
        const metrics = await page.locator('[data-conversation-scroll]').evaluate((host, top) => {
          host.scrollTop = top
          const seat = host.querySelector('[data-composer-seat]')!
          const input = host.querySelector('[data-test-input]')!
          return { seat: seat.getBoundingClientRect().bottom, input: input.getBoundingClientRect().bottom }
        }, scrollTop)
        expect(metrics, `viewport ${height}, scroll ${scrollTop}`).toEqual({ seat: height, input: height })
      }
    }
  } finally {
    await browser.close()
  }
})
