// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

describe('Markdown MP3 links', () => {
  it.each([
    'https://example.com/music.mp3',
    'http://localhost:3082/music.MP3',
    'HTTPS://example.com/music.Mp3?token=one%20two&download=1#t=20',
    'https://example.com/music%20track.mp3?format=wav',
  ])('retains the named link and adds native controls for %s', (url) => {
    const { container } = render(<MarkdownText text={`[Evening **mix**](<${url}>)`} />)
    const link = screen.getByRole('link', { name: 'Evening mix' })
    const audio = container.querySelector('audio')
    expect(link.getAttribute('href')).toBe(url)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(audio?.getAttribute('src')).toBe(url)
    expect(audio?.controls).toBe(true)
    expect(audio?.preload).toBe('none')
    expect(audio?.autoplay).toBe(false)
    expect(audio?.hasAttribute('autoplay')).toBe(false)
    expect(audio?.getAttribute('aria-label')).toBe('Evening mix')
    expect(link.querySelector('strong')?.textContent).toBe('mix')
    expect(audio?.parentElement).toBe(link.parentElement)
    expect(audio?.closest('a')).toBeNull()
  })

  it('recognizes resolved references, CommonMark autolinks, and GFM bare URLs', () => {
    const url = 'https://example.com/track.mp3?token=1#t=10'
    const source = [
      '[Reference][music]',
      '',
      `[music]: ${url}`,
      '',
      '<http://example.com/autolink.MP3>',
      '',
      'https://example.com/bare.mp3?token=2',
    ].join('\n')
    for (const streaming of [false, true]) {
      const view = render(<MarkdownText text={source} streaming={streaming} />)
      expect([...view.container.querySelectorAll('audio')].map(audio => audio.getAttribute('src')))
        .toEqual([url, 'http://example.com/autolink.MP3', 'https://example.com/bare.mp3?token=2'])
      expect([...view.container.querySelectorAll('audio')].map(audio => audio.getAttribute('aria-label')))
        .toEqual(['Reference', 'http://example.com/autolink.MP3', 'https://example.com/bare.mp3?token=2'])
      view.unmount()
    }
  })

  it.each([
    'javascript:alert%281%29.mp3',
    'data:audio/mpeg;base64,music.mp3',
    'blob:https://example.com/music.mp3',
    'file:///tmp/music.mp3',
    'ftp://example.com/music.mp3',
    '//example.com/music.mp3',
    '/music.mp3',
    './music.mp3',
    '#music.mp3',
    'https://',
    'https://[invalid]/music.mp3',
  ])('does not create an anchor or player for unsafe destination %s', (url) => {
    const { container } = render(<MarkdownText text={`[Track](<${url}>)`} />)
    expect(container.textContent).toBe('Track')
    expect(container.querySelector('a, audio, source')).toBeNull()
  })

  it.each([
    'https://example.com/',
    'https://example.com/listen?file=music.mp3',
    'https://example.com/listen#music.mp3',
    'https://example.com/music.mp3/',
    'https://example.com/music.mp3.exe',
    'https://example.com/music.wav',
    'https://example.com/music%2Emp3',
    'https://example.com/image.png',
    'https://example.com/movie.mp4',
    'mailto:music@example.com.mp3',
    'https://user:password@example.com/music.mp3',
    'https://user@example.com/music.mp3',
    'https://:password@example.com/music.mp3',
    'https:example.com/music.mp3',
  ])('preserves the ordinary anchor without a player for %s', (url) => {
    const { container } = render(<MarkdownText text={`[Original **label**](<${url}>)`} />)
    expect(screen.getByRole('link', { name: 'Original label' }).getAttribute('href')).toBe(url)
    expect(container.querySelector('strong')?.textContent).toBe('label')
    expect(container.querySelector('audio, source')).toBeNull()
  })

  it('uses authored plain text for accessible names, with a URL for an empty label', () => {
    const url = 'https://example.com/music.mp3'
    const source = [
      `[**夜曲** *mix* ~~old~~ \`v2\` &amp; $x$](<${url}>)`,
      `[![Cover](https://example.com/cover.png)](<${url}>)`,
      `[](<${url}>)`,
      `[Line  \n  two](<${url}>)`,
      `[Track[^n]](<${url}>)`,
      '',
      '[^n]: Note',
    ].join('\n\n')
    const { container } = render(<MarkdownText text={source} />)
    expect([...container.querySelectorAll('audio')].map(audio => audio.getAttribute('aria-label')))
      .toEqual(['夜曲 mix old v2 & x', 'Cover', url, 'Line two', 'Track'])
  })

  it('keeps phrasing markup inside paragraphs, emphasis, headings, lists and table cells', () => {
    const link = '[Music](https://example.com/music.mp3)'
    const { container } = render(<MarkdownText text={[
      `Before ${link} after.`,
      `**${link}**`,
      `# ${link}`,
      `- ${link}`,
      `| Track |\n| --- |\n| ${link} |`,
    ].join('\n\n')} />)
    for (const selector of ['p > span > audio', 'strong > span > audio', 'h1 > span > audio', 'li > span > audio', 'td > span > audio']) {
      expect(container.querySelector(selector)).not.toBeNull()
    }
    expect(container.querySelector('p div, strong div, a audio')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('Before Music after.')
  })

  it('leaves MP3 source text, inline code, images, and raw HTML out of audio rendering', () => {
    const source = [
      '`https://example.com/code.mp3`',
      '```text\nhttps://example.com/fenced.mp3\n```',
      '![Image](https://example.com/image.mp3)',
      '<audio controls src="https://example.com/raw.mp3"></audio>',
    ].join('\n\n')
    const { container } = render(<MarkdownText text={source} />)
    expect(container.querySelector('audio, source')).toBeNull()
    expect(container.querySelector('code a')?.getAttribute('href')).toBe('https://example.com/code.mp3')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/image.mp3')
    expect(container.textContent).toContain('<audio controls src="https://example.com/raw.mp3"></audio>')
  })

  it('keeps player identity and playback position across tail growth, freezing, and settlement', () => {
    let source = '[Track](https://example.com/music.mp3)'
    const view = render(<MarkdownText text={source} streaming />)
    const audio = view.container.querySelector('audio')!
    audio.currentTime = 17
    for (const chunk of [' with more text.', '\n\nSecond.', '\n\nThird.', '\n\nFourth.']) {
      source += chunk
      view.rerender(<MarkdownText text={source} streaming />)
      expect(view.container.querySelector('audio')).toBe(audio)
      expect(audio.currentTime).toBe(17)
      expect(audio.getAttribute('src')).toBe('https://example.com/music.mp3')
    }
    view.rerender(<MarkdownText text={source} />)
    expect(view.container.querySelector('audio')).toBe(audio)
    expect(audio.currentTime).toBe(17)
  })

  it('waits for a parsed destination and resolves a late reference on settlement', () => {
    const view = render(<MarkdownText text="[Track](https://example.com/music.mp" streaming />)
    expect(view.container.querySelector('audio')).toBeNull()
    view.rerender(<MarkdownText text="[Track](https://example.com/music.mp3)" streaming />)
    expect(view.container.querySelectorAll('audio')).toHaveLength(1)
    const source = '[Track][music]\n\nSecond.\n\nThird.\n\nFourth.'
    view.rerender(<MarkdownText text={source} streaming />)
    expect(view.container.querySelector('audio')).toBeNull()
    const settled = `${source}\n\n[music]: https://example.com/reference.mp3`
    view.rerender(<MarkdownText text={settled} />)
    expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('https://example.com/reference.mp3')
  })
})
