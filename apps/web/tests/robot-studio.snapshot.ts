// @vitest-environment jsdom
// Native built AppWebEntry/Loader/slot registrations run against the in-memory
// fixture transport. External Robot RPC replies and selected file reads are authored;
// jsdom does not validate rendered WebGL pixels or real MuJoCo/PPO outcomes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'
import { robotRpcFixture } from './snapshots/robot-studio/rpc-fixture.ts'
import type { RobotScene, RobotStudioCatalog } from '@deepseek-ai/dsh-robot-lab/types'
import type { ClipSequence } from '../../../packages/client/ui-robot-lab/lib/types/client/clip-sequence.js'
import { clipPartScene } from '../../../packages/client/ui-robot-lab/tests/clip-part-fixture.ts'

const SNAPSHOTS = join(process.cwd(), 'apps/web/tests/snapshots/robot-studio')
const network = vi.fn(() => { throw new Error('Robot assembled snapshots must never use network transport') })

installAssembledBootEnv()
beforeEach(() => {
  network.mockClear()
  vi.stubGlobal('innerWidth', 1920)
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('WebSocket', network)
  vi.stubGlobal('AudioContext', undefined)
  vi.stubGlobal('__fxTiming', undefined)
})
afterEach(() => { expect(network).not.toHaveBeenCalled() })

function text(element: Element): string { return element.textContent?.replace(/\s+/g, ' ').trim() ?? '' }

const clipJointNames = ['left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
  'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll', 'right_hip_yaw', 'right_hip_roll',
  'right_hip_pitch', 'right_knee', 'right_ankle']

function clipRpcFixture(sessionIds: readonly string[] = ['fx-alpha']) {
  const fixture = robotRpcFixture({ sessionIds })
  const respond: typeof fixture.respond = (sessionId, request) => {
    const result = fixture.respond(sessionId, request)
    if (result.operation === 'studio') {
      result.catalog.profiles[0]!.joints.forEach((joint, index) => { joint.name = clipJointNames[index]!; joint.index = index + 1 })
    } else if (result.operation === 'scene') result.scene.jointNames = [...clipJointNames]
    return result
  }
  return { ...fixture, respond }
}

/** Record native copy and form state, excluding CSS hashes and unrelated session history. */
function panelText(panel: HTMLElement, stage: string): string {
  const name = (element: Element) => element.getAttribute('aria-label')
    ?? element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => text(document.getElementById(id)!)).join(' ')
    ?? null
  const rows = [`[${stage}]`, `${panel.getAttribute('role') === 'tabpanel' ? 'tabpanel' : 'region'}=${name(panel)}`]
  for (const element of panel.querySelectorAll('section[aria-label], [role="tablist"], [role="tabpanel"], h1, h2, h3, h4, strong, p, li, [role="status"], [role="alert"], label, button, small, summary, dt, dd, th, td')) {
    if (element.closest('[hidden]') !== null) continue
    const role = element.getAttribute('role')
    if (role === 'tablist' || role === 'tabpanel') {
      rows.push(`${role}=${name(element)}`)
    } else if (element.tagName === 'SUMMARY') {
      rows.push(`summary=${text(element)} open=${(element.parentElement as HTMLDetailsElement).open}`)
    } else if (element.tagName === 'SECTION') {
      rows.push(`region=${element.getAttribute('aria-label')}`)
    } else if (element instanceof HTMLButtonElement) {
      const pressed = element.hasAttribute('aria-pressed') ? ` pressed=${element.getAttribute('aria-pressed')}` : ''
      const current = element.hasAttribute('aria-current') ? ` current=${element.getAttribute('aria-current')}` : ''
      const selected = element.hasAttribute('aria-selected') ? ` selected=${element.getAttribute('aria-selected')}` : ''
      rows.push(`${role ?? 'button'}=${text(element)} disabled=${element.disabled}${pressed}${current}${selected}`)
    } else if (element instanceof HTMLLabelElement) {
      const control = element.querySelector('input, select, textarea')
      const label = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
      rows.push(`label=${control?.getAttribute('aria-label') ?? label}`)
      if (control instanceof HTMLSelectElement) {
        rows.push(`select=${control.value} disabled=${control.disabled} options=${[...control.options].map(option => text(option)).join(' | ')}`)
      } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        const checked = control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio') ? ` checked=${control.checked}` : ''
        rows.push(`input=${control.value} disabled=${control.disabled}${checked}`)
        if (control.placeholder !== '') rows.push(`placeholder=${control.placeholder}`)
      }
    } else {
      rows.push(`${element.getAttribute('role') ?? element.tagName.toLowerCase()}=${text(element)}`)
    }
  }
  return rows.join('\n')
}

function partControlText(panel: HTMLElement, stage: string): string {
  const rows = [`[${stage}]`]
  for (const input of panel.querySelectorAll<HTMLInputElement>('input[type="range"][aria-describedby]')) {
    const label = input.closest('label')!
    const description = input.getAttribute('aria-describedby')!.split(' ').map(id => text(document.getElementById(id)!)).join(' | ')
    rows.push(`control=${input.getAttribute('aria-label')} · ${text(label.querySelector('strong')!)}`,
      `value=${input.getAttribute('aria-valuetext')} output=${text(label.querySelector('output')!)}`,
      `help=${description}`)
  }
  return rows.join('\n')
}

function assertDecorativeParts(panel: HTMLElement, count: number, geometry: boolean): void {
  const wardrobe = within(panel).queryByRole('region', { name: 'Skin wardrobe' })
  const icons = [...panel.querySelectorAll('svg')].filter(icon => !wardrobe?.contains(icon))
  expect(icons).toHaveLength(count)
  for (const icon of icons) {
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('focusable')).toBe('false')
    expect(icon.hasAttribute('tabindex')).toBe(false)
    expect(icon.querySelector('title, text, a, button, input, [tabindex]')).toBeNull()
    expect(icon.textContent).toBe('')
    expect(icon.querySelectorAll('circle')).toHaveLength(geometry ? 0 : 2)
    if (geometry) {
      const groups = icon.querySelectorAll('g')
      expect(groups).toHaveLength(2)
      expect(groups[0]!.querySelectorAll('path')).toHaveLength(15)
      expect(groups[1]!.querySelectorAll('path').length).toBeGreaterThan(0)
    }
  }
  expect(within(panel).queryByRole('img')).toBeNull()
}

async function golden(name: string, rows: string[]): Promise<void> {
  const expected = join(SNAPSHOTS, `${name}.expected.txt`)
  const output = `${rows.join('\n\n')}\n`
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(expected), { recursive: true })
    writeFileSync(expected, output)
  }
  await expect(output).toMatchFileSnapshot(expected)
}

async function openSession(): Promise<void> {
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  fireEvent.click(await screen.findByRole('tab', { name: 'RL Training' }))
}

function openDetails(panel: HTMLElement, name: string): HTMLDetailsElement {
  const summary = within(panel).getByText(name, { selector: 'summary' })
  const details = summary.parentElement as HTMLDetailsElement
  if (!details.open) fireEvent.click(summary)
  expect(details.open).toBe(true)
  return details
}

function trainingPanels(panel: HTMLElement): { train: HTMLElement; evaluate: HTMLElement } {
  const tablist = within(panel).getByRole('tablist', { name: 'Training and evaluation' })
  const [train, evaluate] = ['Train', 'Evaluate'].map((name) => {
    const tab = within(tablist).getByRole('tab', { name })
    const content = document.getElementById(tab.getAttribute('aria-controls')!)!
    expect(content.getAttribute('role')).toBe('tabpanel')
    expect(content.getAttribute('aria-labelledby')).toBe(tab.id)
    expect(content.hidden).toBe(tab.getAttribute('aria-selected') !== 'true')
    return content
  })
  expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1)
  expect(train!.compareDocumentPosition(evaluate!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(panel).queryByRole('navigation', { name: 'Dance workflow' })).toBeNull()
  expect(within(panel).queryByRole('button', { name: /^Next/ })).toBeNull()
  expect(within(panel).queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
  return { train: train!, evaluate: evaluate! }
}

function selectTrainingTab(panel: HTMLElement, name: 'Train' | 'Evaluate'): HTMLElement {
  fireEvent.click(within(panel).getByRole('tab', { name }))
  expect(within(panel).getByRole('tab', { name, selected: true })).toBeTruthy()
  return within(panel).getByRole('tabpanel', { name })
}

function setValue(panel: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(panel).getByLabelText(label, { selector: 'input, select, textarea' }), { target: { value } })
}

async function idle(panel: HTMLElement): Promise<void> {
  await waitFor(() => { expect(within(panel).getByText('Local robot lab connected').getAttribute('role')).toBe('status') })
}

function installPersistenceLocks(): void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
  const pending: Promise<void>[] = []
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_name: string, options: { signal: AbortSignal }, callback: () => void) => {
      const operation = Promise.resolve().then(() => {
        if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        callback()
      })
      pending.push(operation)
      return operation
    },
  } })
  onTestFinished(async () => {
    await Promise.allSettled(pending)
    if (descriptor === undefined) Reflect.deleteProperty(navigator, 'locks')
    else Object.defineProperty(navigator, 'locks', descriptor)
  })
}

describe('assembled opt-in Micro Duck workflow', () => {
  it('browses ten skin designs and applies current or ensemble appearance without robot operations', async () => {
    const fixture = clipRpcFixture()
    const respond: typeof fixture.respond = (sessionId, request) => {
      const result = fixture.respond(sessionId, request)
      if (result.operation === 'scene') result.scene = clipPartScene()
      return result
    }
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined(); timing?.setRobotLabResponder(respond)
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    fireEvent.click(within(panel).getByRole('button', { name: '360° left + right · 20 s preview' }))
    const wardrobe = within(panel).getByRole('region', { name: 'Skin wardrobe' })
    const before = fixture.requests.length
    expect(within(wardrobe).getByRole('group', { name: 'Browse skins' }).querySelectorAll('button')).toHaveLength(10)
    const transcript = [panelText(wardrobe, 'wardrobe / original')]
    fireEvent.click(within(wardrobe).getByRole('button', { name: /^Velocity Club$/ }))
    expect(within(wardrobe).getByRole('status').textContent).toBe('Duck 1 is wearing Original factory finish')
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'I reviewed this revision in the preview' }))
    fireEvent.click(within(wardrobe).getByRole('button', { name: /^Apply to Duck 1$/ }))
    expect(within(panel).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' }).checked).toBe(false)
    expect(within(wardrobe).getByRole('status').textContent).toBe('Duck 1 is wearing Velocity Club')
    const workspace = await screen.findByRole('region', { name: 'Simulation workspace' })
    openDetails(workspace, 'MicroDuck controls')
    fireEvent.click(within(workspace).getByRole('button', { name: 'Add duck' }))
    setValue(wardrobe, 'Current duck · appearance', '2')
    expect(within(wardrobe).getByRole('status').textContent).toBe('Duck 2 is wearing Velocity Club')
    fireEvent.click(within(wardrobe).getByRole('button', { name: /^Sakura Mochi$/ }))
    fireEvent.click(within(wardrobe).getByRole('button', { name: /^Apply to Duck 2$/ }))
    setValue(wardrobe, 'Current duck · appearance', '1')
    expect(within(wardrobe).getByRole('status').textContent).toBe('Duck 1 is wearing Velocity Club')
    fireEvent.click(within(wardrobe).getByRole('button', { name: /^Rebel Voltage$/ }))
    fireEvent.click(within(wardrobe).getByRole('button', { name: 'Apply to all 2 ducks' }))
    setValue(wardrobe, 'Current duck · appearance', '2')
    expect(within(wardrobe).getByRole('status').textContent).toBe('Duck 2 is wearing Rebel Voltage')
    transcript.push(panelText(wardrobe, 'wardrobe / all ducks in punk'))
    fireEvent.click(within(wardrobe).getByRole('button', { name: 'Original factory finish' }))
    fireEvent.click(within(wardrobe).getByRole('button', { name: 'Apply to all 2 ducks' }))
    expect(fixture.requests.slice(before)).toEqual([])
    transcript.push('browse-does-not-apply=true; current-duck-isolated=true; apply-all=true; original-restored=true; robot-operations=0')
    await golden('clip-gen-skin-wardrobe', transcript)
  })

  it('loads a larger v2 dance with a shared audio clock and retains the original choices', async () => {
    const model = JSON.parse(readFileSync(join(process.cwd(),
      'packages/client/ui-robot-lab/tests/fixtures/dance-v2-model.json'), 'utf8')) as {
      profile: RobotStudioCatalog['profiles'][number]
      limits: RobotStudioCatalog['limits']
      scene: RobotScene
    }
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    onTestFinished(() => { play.mockRestore(); pause.mockRestore() })
    const fixture = clipRpcFixture()
    const respond: typeof fixture.respond = (sessionId, request) => {
      const result = fixture.respond(sessionId, request)
      if (result.operation === 'studio') { result.catalog.profiles = [model.profile]; result.catalog.limits = model.limits }
      if (result.operation === 'scene') result.scene = model.scene
      return result
    }
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined(); timing?.setRobotLabResponder(respond)
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    const animate = within(panel).getByRole('region', { name: '3 · Animate & verify' })
    const before = fixture.requests.length
    setValue(animate, 'Load a generated dance', 'bachata_v2')
    expect(within(animate).getByLabelText<HTMLInputElement>('Clip name').value).toBe('MicroDuck Bachata v2')
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(401)
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Use for training' }).disabled).toBe(true)
    const workspace = await screen.findByRole('region', { name: 'Simulation workspace' })
    const audio = workspace.querySelector('audio')!
    expect(audio.src).toMatch(/^data:audio\/ogg;base64,/)
    expect(play).not.toHaveBeenCalled()
    const transcript = [panelText(within(animate).getByRole('group', { name: 'Original dance rhythm · 130 BPM' }),
      'v2 / original rhythm controls; platform media playback is mocked in this keyless fixture')]
    openDetails(workspace, 'Review & export')
    const exportAudio = within(workspace).getByRole<HTMLInputElement>('checkbox', { name: 'With audio' })
    expect(exportAudio.checked).toBe(true)
    expect(within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'With audio' }).checked).toBe(true)
    fireEvent.click(within(animate).getByRole('checkbox', { name: 'I reviewed this revision in the preview' }))
    fireEvent.click(exportAudio)
    expect(within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'With audio' }).checked).toBe(false)
    expect(within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' }).checked).toBe(true)
    fireEvent.click(within(animate).getByRole('checkbox', { name: 'With audio' }))
    expect(exportAudio.checked).toBe(true)
    transcript.push('export-with-audio-default=true; shared-toggle=true; review-retained=true')
    fireEvent.click(within(animate).getByRole('button', { name: 'Play sequence' }))
    audio.currentTime = 0.6
    await waitFor(() => { expect(Number(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value)).toBe(0.6) })
    expect(play).toHaveBeenCalledOnce()
    setValue(animate, 'Animation timeline', '12')
    expect(audio.currentTime).toBe(12)
    setValue(workspace, 'Playback speed', '0.5')
    fireEvent.click(within(animate).getByRole('button', { name: 'Play sequence' }))
    expect(audio.playbackRate).toBe(0.5)
    fireEvent.click(within(animate).getByRole('checkbox', { name: 'Mute dance audio' }))
    expect(audio.muted).toBe(true)
    setValue(animate, 'Dance audio volume', '0.25')
    expect(audio.volume).toBe(0.25)
    fireEvent.click(within(animate).getByRole('button', { name: 'Pause sequence' }))
    transcript.push('v2-schema=3; keys=401; training-disabled=true', 'audio-clock-drives-motion=true',
      'shared-seek=12; speed=0.5; muted=true; volume=0.25')
    setValue(animate, 'Load a generated dance', 'bachata')
    expect(within(animate).getByLabelText<HTMLInputElement>('Clip name').value).toBe('MicroDuck Bachata')
    expect(workspace.querySelector('audio')).not.toBe(audio)
    expect(within(animate).getByRole('button', { name: 'Play sequence' })).toBeTruthy()
    const picker = within(animate).getByRole<HTMLSelectElement>('combobox', { name: 'Load a generated dance' })
    expect(picker.options.length).toBe(13)
    expect(pause.mock.calls.length).toBeGreaterThan(0)
    expect(fixture.requests.slice(before)).toEqual([])
    transcript.push('original-options=6; v2-options=6', 'replacement-pauses-and-switches-audio=true', 'robot-operations-started=0')
    const originalSource = workspace.querySelector('audio')!.src
    const keyTimes = within(animate).getAllByRole('button', { name: /^Key at / }).map(button => button.getAttribute('aria-label'))
    expect(within(animate).getAllByRole('radio')).toHaveLength(4)
    for (const title of ['The Stationary Ark — Low pH Arktic Clubmix', 'Spy vs. Spy — Chill-out Acid Squeeze Mix', 'SoundHelix Song 1']) {
      fireEvent.click(within(animate).getByRole('checkbox', { name: 'I reviewed this revision in the preview' }))
      fireEvent.click(within(animate).getByRole('radio', { name: title }))
      expect(within(animate).getByRole<HTMLInputElement>('radio', { name: title }).checked).toBe(true)
      expect(within(animate).getAllByRole<HTMLInputElement>('radio').filter(radio => radio.checked)).toHaveLength(1)
      expect(within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' }).checked).toBe(false)
      expect(workspace.querySelector('audio')!.src).not.toBe(originalSource)
      fireEvent.click(within(animate).getByRole('button', { name: 'Play sequence' }))
      expect(workspace.querySelector('audio')!.playbackRate).toBeCloseTo(0.5 * 130 / 120)
      fireEvent.click(within(animate).getByRole('button', { name: 'Pause sequence' }))
      transcript.push(`music-selected=${title}; exclusive=true; review-cleared=true; preview-source-switched=true; tempo-rate=${130 / 120}`)
    }
    transcript.push(panelText(within(animate).getByRole('group', { name: 'Original dance rhythm · 130 BPM' }), 'selected third alternative'))
    fireEvent.click(within(animate).getByRole('radio', { name: 'Original dance rhythm' }))
    expect(workspace.querySelector('audio')!.src).toBe(originalSource)
    expect(within(animate).getAllByRole('button', { name: /^Key at / }).map(button => button.getAttribute('aria-label'))).toEqual(keyTimes)
    transcript.push('original-restored=true; motion-key-times-unchanged=true')
    await golden('clip-gen-dance-v2-audio', transcript)
  })

  it('loads all six bundled dance JSON sequences into Animate for editing and fresh review', async () => {
    const danceClips = ['bachata', 'breakdance', 'cumbia', 'martial_arts', 'robot', 'salsa'].map((id) => {
      const path = join(process.cwd(), 'packages/client/ui-robot-lab/src/client/dance-clips', `${id}.json`)
      const authored = JSON.parse(readFileSync(path, 'utf8')) as { sequence: ClipSequence; guide: string }
      return { id, ...authored }
    })
    const fixture = clipRpcFixture()
    const respond: typeof fixture.respond = (sessionId, request) => {
      const result = fixture.respond(sessionId, request)
      if (result.operation === 'studio') {
        result.catalog.profiles[0]!.modelSha256 = danceClips[0]!.sequence.modelSha256
        result.catalog.limits.maxClipKeys = 512
        result.catalog.limits.maxClipSeconds = 120
        result.catalog.limits.maxBpm = 200
      }
      return result
    }
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(respond)
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    const animate = within(panel).getByRole('region', { name: '3 · Animate & verify' })
    const picker = within(animate).getByRole<HTMLSelectElement>('combobox', { name: 'Load a generated dance' })
    const transcript = ['options=' + [...picker.options].map(option => option.text).join(' | ')]
    const before = fixture.requests.length
    for (const dance of danceClips) {
      fireEvent.change(picker, { target: { value: dance.id } })
      expect(within(animate).getByLabelText<HTMLInputElement>('Clip name').value).toBe(dance.sequence.clip.name)
      expect(within(animate).getByLabelText<HTMLInputElement>('Duration (seconds)').value).toBe(String(dance.sequence.clip.duration))
      expect(within(panel).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(dance.guide)
      expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(dance.sequence.clip.keys.length)
      expect(within(animate).getByRole('button', { name: 'Play sequence' })).toBeTruthy()
      const reviewed = within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' })
      expect(reviewed.checked).toBe(false)
      expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value).toBe('0')
      transcript.push(`${dance.id}: name=${dance.sequence.clip.name}; duration=${dance.sequence.clip.duration}; bpm=${dance.sequence.bpm}; keys=${dance.sequence.clip.keys.length}; guide=loaded; review=false; playing=false`)
      fireEvent.click(reviewed)
      fireEvent.click(within(animate).getByRole('button', { name: 'Joints', pressed: false }))
      setValue(animate, 'head_yaw', '0.2')
      expect(reviewed.checked).toBe(false)
      fireEvent.click(within(animate).getByRole('button', { name: '◆ Key this pose' }))
      expect(within(animate).getByRole('slider', { name: 'head_yaw' }).getAttribute('aria-valuetext')).toBe('0.200 rad · 11.5°')
      fireEvent.click(reviewed)
      fireEvent.click(within(animate).getByRole('button', { name: 'Rig', pressed: false }))
    }
    expect(fixture.requests.slice(before)).toEqual([])
    expect(fixture.history()).toEqual({ trials: [], runs: [], evaluations: [], reflections: [] })
    transcript.push('all-six-editable=true', 'edits-and-selections-clear-review=true', 'robot-operations-started=0')
    await golden('clip-gen-dance-picker', transcript)
  })

  it('offers full left/right heading turns as preview-only motion without starting training', async () => {
    const fixture = clipRpcFixture()
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    const before = fixture.requests.length
    fireEvent.click(within(panel).getByRole('button', { name: '360° left + right · 20 s preview' }))
    const heading = within(panel).getByRole('slider', { name: 'Heading · preview only' })
    const observed: string[] = []
    for (const time of [0, 2, 6, 10, 14, 18, 20]) {
      setValue(panel, 'Animation timeline', String(time))
      observed.push(`${time}s: ${heading.getAttribute('aria-valuetext')}`)
    }
    const training = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Use for training' })
    expect(training.disabled).toBe(true)
    fireEvent.click(training)
    expect(fixture.requests.slice(before).filter(({ request }) => !['readiness', 'studio', 'scene', 'behaviors', 'policies', 'runs', 'projects', 'trials', 'reflections', 'evaluations'].includes(request.operation))).toEqual([])
    const guide = within(panel).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value
    expect({ guide, heading: observed, trainingDisabled: training.disabled }).toMatchInlineSnapshot(`
      {
        "guide": "120 BPM · 0–2 s: knee pulses; 2–10 s: alternate legs while turning 360° left; 10–18 s: alternate legs while turning 360° right; 18–20 s: knee pulses and return to neutral. Heading is animated, not produced by simulated foot contact.",
        "heading": [
          "0s: 0.000 rad · 0.0°",
          "2s: 0.000 rad · 0.0°",
          "6s: 3.142 rad · 180.0°",
          "10s: 6.283 rad · 360.0°",
          "14s: 3.142 rad · 180.0°",
          "18s: 0.000 rad · 0.0°",
          "20s: 0.000 rad · 0.0°",
        ],
        "trainingDisabled": true,
      }
    `)
    fireEvent.click(within(panel).getByRole('button', { name: 'New clip' }))
    expect(training.disabled).toBe(false)
  })

  it('authors a Clip Gen sequence with fourteen mapped channels and revision-bound review', async () => {
    installPersistenceLocks()
    const names = clipJointNames
    const fixture = clipRpcFixture()
    const respond = fixture.respond
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(respond)
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    expect(screen.getByRole('tab', { name: 'Clip & Motion Gen' }).getAttribute('aria-selected')).toBe('true')
    const headings = ['1 · Activity plan', '2 · MicroDuck joint mapping', '3 · Animate & verify', '4 · Generated clip']
    expect([...panel.querySelectorAll('h2')].map(element => text(element))).toEqual(headings)
    const plan = within(panel).getByRole('region', { name: headings[0]! })
    const mapping = within(panel).getByRole('region', { name: headings[1]! })
    const animate = within(panel).getByRole('region', { name: headings[2]! })
    const transcript = [panelText(panel, 'Clip Gen / empty authoring')]
    expect(within(plan).getByRole<HTMLButtonElement>('button', { name: 'Design sequence' }).disabled).toBe(true)
    const beforeAuthoring = fixture.requests.length
    const guides = within(plan).getByRole('region', { name: 'Dance guide library' })
    const bounce = 'The duck begins with a lively rhythm, bouncing twice on its left leg, then twice on its right. '
      + 'It follows the jumps with a graceful neck motion—lifting its neck high in a single upward pose before '
      + 'dipping it back down in one gentle nod.'
    setValue(guides, 'Choose a dance guide', 'starter-bounce')
    expect(within(plan).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(bounce)
    expect(within(plan).queryByRole('combobox', { name: 'Action 1' })).toBeNull()
    expect(within(animate).queryByRole('button', { name: /^Key at / })).toBeNull()
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(true)
    expect(within(animate).queryByRole('button', { name: 'Generate MP4' })).toBeNull()
    expect(panel.querySelector('video')).toBeNull()
    transcript.push(panelText(plan, 'Guides / starter fills text without designing or exporting'))
    fireEvent.click(within(guides).getByRole('button', { name: 'Add guide' }))
    expect(within(guides).getByLabelText<HTMLTextAreaElement>('Guide description').value).toBe(bounce)
    expect(within(guides).getByLabelText<HTMLInputElement>('Guide name').value).toBe('')
    const customName = '月光 🦆 guide'
    const customPrompt = '  Dance left then right.\nNeck nod 🦆 e\u0301  '
    setValue(guides, 'Guide name', customName)
    setValue(guides, 'Guide description', customPrompt)
    transcript.push(panelText(guides, 'Guides / named custom description before save'))
    fireEvent.click(within(guides).getByRole('button', { name: 'Save guide' }))
    await waitFor(() => {
      expect(within(guides).getByRole('status').textContent).toBe(
        'Guides saved in this browser for next time. They are available across sessions here.')
    })
    const guideKey = 'dsh.store.protected:["dsh.clip-gen.dance-guides",null]'
    const persistedGuides = localStorage.getItem(guideKey)!
    expect(JSON.parse(persistedGuides) as unknown).toMatchObject({ version: 1, scopeKey: null,
      data: { guides: [{ id: 1, name: customName, prompt: customPrompt }], nextId: 2 } })
    expect(within(plan).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(bounce)
    setValue(guides, 'Choose a dance guide', 'saved-1')
    expect(within(plan).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(customPrompt)
    expect(within(plan).queryByRole('combobox', { name: 'Action 1' })).toBeNull()
    expect(panel.querySelector('video')).toBeNull()
    transcript.push(panelText(plan, 'Guides / saved text selected without designing'))
    setValue(plan, 'What should the duck do?', 'I would like to train the duck robot to dance at 120 BPM')
    fireEvent.click(within(plan).getByRole('button', { name: 'Design sequence' }))
    const workspace = await screen.findByRole('region', { name: 'Simulation workspace' })
    const captureView = within(workspace).getByRole<HTMLButtonElement>('button', { name: 'Capture view (PNG)' })
    expect(captureView.disabled).toBe(true)
    expect(captureView.title).toBe('Save the current view without controls as a PNG video cover.')
    expect(screen.getByRole('tab', { name: 'Simulation workspace' }).getAttribute('aria-selected')).toBe('true')
    expect(within(plan).getAllByRole<HTMLSelectElement>('combobox', { name: /^Action \d+$/ }).map(select => select.value)).toEqual([
      'left-step', 'right-step', 'neck-nod', 'head-turn', 'sway-left', 'sway-right', 'squat', 'stand',
    ])
    expect(within(plan).getByLabelText<HTMLInputElement>('Tempo (BPM)').value).toBe('120')
    expect(within(animate).getByLabelText<HTMLInputElement>('Duration (seconds)').value).toBe('8')
    transcript.push(['[Plan / supported dance recipe]', `prompt=${within(plan).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value}`,
      `tempo=${within(plan).getByLabelText<HTMLInputElement>('Tempo (BPM)').value}`,
      ...within(plan).getAllByRole<HTMLSelectElement>('combobox', { name: /^Action \d+$/ }).map((select, index) =>
        `action-${index + 1}=${text(select.selectedOptions[0]!)} beats=${within(plan).getByLabelText<HTMLInputElement>(`Beats for action ${index + 1}`).value}`),
    ].join('\n'))
    const mapped = within(mapping).getAllByRole('row').slice(1)
    expect(mapped).toHaveLength(14)
    expect(mapped.map(row => text(within(row).getAllByRole('cell')[1]!))).toEqual(names)
    transcript.push(panelText(mapping, 'Mapping / fourteen installed channels'))
    fireEvent.click(within(mapping).getByRole('button', { name: 'neck_pitch' }))
    for (const name of names) expect(within(animate).getByRole<HTMLInputElement>('slider', { name }).value).toBe('0')
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(17)
    transcript.push(panelText(animate, 'Animation / keyed recipe'))
    expect(animate.textContent).toContain('Part thumbnails are unavailable for this model. Mechanical symbols are shown instead')
    assertDecorativeParts(animate, 21, false)
    for (const name of names) {
      const slider = within(animate).getByRole<HTMLInputElement>('slider', { name })
      expect(slider.getAttribute('aria-valuetext')).toBe('0.000 rad · 0.0°')
      expect(slider.closest('label')!.querySelector('strong')!.textContent).not.toBe(name)
      expect(slider.closest('label')!.textContent).toContain('Range -1.000…1.000 rad · default 0.000 rad')
    }
    expect(within(animate).getByRole('button', { name: 'neck_pitch' }).textContent).toContain('Neck · nod')
    transcript.push(partControlText(animate, 'Animation / mechanical fallback and joint guidance'))
    fireEvent.click(within(animate).getByRole('button', { name: 'Rig', pressed: false }))
    assertDecorativeParts(animate, 30, false)
    expect(within(animate).getByRole('slider', { name: 'Squat · + crouch' }).getAttribute('aria-valuetext')).toBe('Amount 0.000')
    expect(animate.textContent).toContain('Amount is a coupled offset, not one joint’s angle')
    fireEvent.click(within(animate).getByRole('button', { name: 'Joints', pressed: false }))
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(17)
    const reviewed = within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' })
    const reviewState = (stage: string) => [`[${stage}]`, `status=${text(animate.querySelector('p[role="status"]')!)}`,
      `timeline=${within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value}`,
      `neck-pitch=${within(animate).getByRole<HTMLInputElement>('slider', { name: 'neck_pitch' }).value}`,
      `reviewed=${reviewed.checked} disabled=${reviewed.disabled}`,
      ...['Save clip JSON', 'Play sequence', 'Generate MP4'].map(name =>
        `button=${name} disabled=${within(animate).getByRole<HTMLButtonElement>('button', { name }).disabled}`),
      `keys=${within(animate).getAllByRole('button', { name: /^Key at / }).length}`,
      `generated-video=${panel.querySelector('video') !== null}`,
    ].join('\n')
    fireEvent.click(reviewed)
    expect(reviewed.checked).toBe(true)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Generate MP4' }).disabled).toBe(true)
    transcript.push(reviewState('Review / author acknowledgement cannot replace an available renderer'))
    setValue(animate, 'Animation timeline', '0.25')
    setValue(animate, 'neck_pitch', '0.2')
    expect(reviewed.checked).toBe(false)
    expect(reviewed.disabled).toBe(true)
    expect(within(animate).getByRole('slider', { name: 'neck_pitch' }).getAttribute('aria-valuetext')).toBe('0.200 rad · 11.5°')
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(true)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Play sequence' }).disabled).toBe(true)
    transcript.push(reviewState('Edit / unkeyed pose invalidates review'))
    fireEvent.click(within(animate).getByRole('button', { name: '◆ Key this pose' }))
    expect(reviewed.disabled).toBe(false)
    expect(reviewed.checked).toBe(false)
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(18)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(false)
    fireEvent.click(reviewed)
    expect(reviewed.checked).toBe(true)
    transcript.push(reviewState('Key / new reference revision acknowledged'))
    fireEvent.click(within(animate).getByRole('button', { name: 'Reset neck_pitch' }))
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'neck_pitch' }).value).toBe('0')
    expect(reviewed.checked).toBe(false)
    expect(reviewed.disabled).toBe(true)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Play sequence' }).disabled).toBe(true)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(true)
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(18)
    transcript.push(reviewState('Reset / default pose requires explicit keying'))
    setValue(workspace, 'Animation timeline', '0.5')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value).toBe('0.5')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'neck_pitch' }).value).toBe('0')
    setValue(workspace, 'Animation timeline', '0.25')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'neck_pitch' }).value).toBe('0.2')
    expect(workspace.querySelector('canvas')).toBeNull()
    expect(panel.querySelector('video')).toBeNull()
    setValue(workspace, 'Floor appearance', 'sand')
    fireEvent.click(within(workspace).getByRole('checkbox', { name: 'Show world axes' }))
    fireEvent.click(within(workspace).getByRole('button', { name: /^Top$/ }))
    fireEvent.click(within(workspace).getByRole('button', { name: /^Pan$/ }))
    setValue(workspace, 'Camera zoom', '1.5')
    setValue(workspace, 'Playback speed', '0.5')
    openDetails(workspace, 'MicroDuck controls')
    setValue(workspace, 'Exact angle: neck_pitch', '0.35')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'neck_pitch' }).value).toBe('0.35')
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Play sequence' }).disabled).toBe(true)
    fireEvent.click(within(workspace).getByRole('button', { name: '◆ Key this pose' }))
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Play sequence' }).disabled).toBe(false)
    openDetails(workspace, 'Review & export')
    expect(within(workspace).getByRole<HTMLButtonElement>('button', { name: 'Generate MP4' }).disabled).toBe(true)
    transcript.push(panelText(workspace, 'Simulation workspace / controls share draft; metadata unavailable, no rendered evidence'))
    expect(fixture.requests.slice(beforeAuthoring)).toEqual([])
    expect(fixture.requests.every(item => item.sessionId === 'fx-alpha')).toBe(true)
    expect(fixture.history()).toEqual({ trials: [], runs: [], evaluations: [], reflections: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(screen.queryByRole('region', { name: 'Dance guide library' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
    const remounted = await screen.findByRole('region', { name: 'Clip Gen' })
    const remountedGuides = within(remounted).getByRole('region', { name: 'Dance guide library' })
    expect(within(remountedGuides).getByRole('option', { name: customName })).toBeTruthy()
    expect(within(remountedGuides).queryByLabelText('Guide name')).toBeNull()
    expect(within(remounted).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(
      'I would like to train the duck robot to dance at 120 BPM')
    expect(within(remounted).getAllByRole('button', { name: /^Key at / })).toHaveLength(18)
    transcript.push(panelText(remountedGuides, 'Guides / library survives tab remount'))
    const tree = screen.getByRole('tree', { name: 'Sessions' })
    const otherSession = within(tree).getAllByRole('treeitem', { selected: false })[0]!
    fireEvent.click(otherSession)
    await waitFor(() => { expect(otherSession.getAttribute('aria-selected')).toBe('true') })
    fireEvent.click(await screen.findByRole('tab', { name: 'Clip & Motion Gen' }))
    const other = await screen.findByRole('region', { name: 'Clip Gen' })
    const otherGuides = within(other).getByRole('region', { name: 'Dance guide library' })
    expect(within(other).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe('')
    expect(within(otherGuides).getByRole('option', { name: customName })).toBeTruthy()
    setValue(otherGuides, 'Choose a dance guide', 'saved-1')
    expect(within(other).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(customPrompt)
    expect(within(other).queryByRole('combobox', { name: 'Action 1' })).toBeNull()
    expect(other.querySelector('video')).toBeNull()
    transcript.push(panelText(otherGuides, 'Guides / same library fills a different session only'),
      `other-session-prompt=${JSON.stringify(within(other).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value)}`)
    fireEvent.click(within(tree).getByText('Fixture 历史会话'))
    fireEvent.click(await screen.findByRole('tab', { name: 'Clip & Motion Gen' }))
    const original = await screen.findByRole('region', { name: 'Clip Gen' })
    expect(within(original).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(
      'I would like to train the duck robot to dance at 120 BPM')
    expect(within(original).getAllByRole('button', { name: /^Key at / })).toHaveLength(18)
    expect(localStorage.getItem(guideKey)).toBe(persistedGuides)
    expect(fixture.requests.some(({ request }) => ['save_project', 'save_trial', 'train', 'train_trial', 'simulate',
      'evaluate', 'evaluate_trial', 'save_reflection'].includes(request.operation))).toBe(false)
    transcript.push('original-session-prompt-and-18-keyframes-unchanged=true', 'saved-guide-browser-record-unchanged=true')
    await golden('clip-gen-workflow', transcript)
  }, 30_000)

  it('sends SequenceByAI through the current agent and reuses its exact editable sequence', async () => {
    installPersistenceLocks()
    const fixture = clipRpcFixture(['fx-alpha', 'fx-beta', 'fx-gamma'])
    const partScene = clipPartScene()
    const respond: typeof fixture.respond = (sessionId, request) => {
      const result = fixture.respond(sessionId, request)
      if (result.operation === 'scene') result.scene = structuredClone(partScene)
      if (result.operation === 'studio') {
        const profile = result.catalog.profiles[0]!
        const root = partScene.kinematics!.rootBody
        profile.rootBody = { index: root, name: partScene.bodies[root]! }
        profile.joints.forEach((joint, index) => { joint.defaultPosition = partScene.defaultJoints[index]! })
      }
      return result
    }
    const prompts: Array<{ sessionId: string; text: string }> = []
    const authored: ClipSequence[] = []
    const guide = [
      { start: 0, end: 1, description: 'Gently turn the left hip outward for the greeting, keeping the other joints neutral.' },
      { start: 1, end: 2, description: 'Bring the left hip back to the standing pose and settle.' },
    ]
    const generatedGuide = '0–1 s: Gently turn the left hip outward for the greeting, keeping the other joints neutral.\n'
      + '1–2 s: Bring the left hip back to the standing pose and settle.'
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    await waitFor(() => {
      const timing = (globalThis as unknown as { __fxTiming?: {
        setRobotLabResponder: (responder: typeof fixture.respond) => void
        setPromptResponder: (responder: (id: string, prompt: string) => string) => void
      } }).__fxTiming
      expect(timing).toBeDefined()
      timing!.setRobotLabResponder(respond)
      timing!.setPromptResponder((sessionId, prompt) => {
        prompts.push({ sessionId, text: prompt })
        const line = prompt.split('\n').find(line => line.startsWith('Required envelope JSON: '))!
        const reply = JSON.parse(line.slice('Required envelope JSON: '.length)) as { guide: typeof guide; sequence: ClipSequence }
        reply.guide = guide
        reply.sequence.clip.name = prompts.length === 1 ? 'AI greeting 🦆' : 'AI candidate 🦆'
        reply.sequence.clip.duration = 2
        const neutral = reply.sequence.clip.keys[0]!
        reply.sequence.clip.keys = [{ ...neutral, t: 0 },
          { t: 1, joints: neutral.joints.map((value, index) => index === 0 ? (prompts.length === 1 ? 0.2 : 0.3) : value), rootPitch: 0 },
          { ...neutral, t: 2 }]
        authored.push(reply.sequence)
        return JSON.stringify(reply)
      })
    })
    await openSession()
    await idle(await screen.findByRole('region', { name: 'Micro Duck control panel' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Clip & Motion Gen' }))
    const panel = await screen.findByRole('region', { name: 'Clip Gen' })
    const instruction = '  A friendly greeting at 120 BPM, then return to stand. 🦆  '
    const aiButton = within(panel).getByRole<HTMLButtonElement>('button', { name: 'SequenceByAI' })
    expect(aiButton.disabled).toBe(true)
    setValue(panel, 'What should the duck do?', instruction)
    const transcript = [panelText(within(panel).getByRole('region', { name: '1 · Activity plan' }), 'AI / explicit request ready')]
    fireEvent.click(aiButton)
    await waitFor(() => { expect(prompts).toHaveLength(1) })
    expect(prompts[0]!.sessionId).toBe('fx-alpha')
    expect(prompts[0]!.text).toContain(`Activity JSON: ${JSON.stringify(instruction)}`)
    expect(prompts[0]!.text).toContain('"channel":13')
    expect(prompts[0]!.text).toContain('First invoke skill(name: "microduck-choreography")')
    expect(prompts[0]!.text).toContain('create the timed guide before generating its motion keys')
    expect(prompts[0]!.text).toContain('No tools are permitted except that skill load')
    expect(prompts[0]!.text).toContain('do not start training, run simulations/evaluations, create subagents or other agents, or access hardware')
    expect(prompts[0]!.text.split('\n')[0]).toMatch(/^MICRODUCK_SEQUENCE_REQUEST_V2 /)
    const requestId = prompts[0]!.text.split('\n')[0]!.slice('MICRODUCK_SEQUENCE_REQUEST_V2 '.length)
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    transcript.push('AI / logged instruction (request UUID normalized)',
      prompts[0]!.text.replaceAll(requestId, '00000000-0000-4000-8000-000000000001'))
    expect(aiButton.disabled).toBe(true)
    expect(within(panel).queryByRole('button', { name: /^Key at / })).toBeNull()
    await waitFor(() => {
      expect(within(panel).getAllByRole('button', { name: /^Key at / })).toHaveLength(3)
    }, { timeout: 30_000 })
    const guides = within(panel).getByRole('region', { name: 'Dance guide library' })
    await waitFor(() => { expect(within(guides).getByRole('status').textContent).toContain('Guides saved in this browser') })
    expect(within(guides).getByRole('option', { name: 'AI greeting 🦆 · sequence' })).toBeTruthy()
    const animate = within(panel).getByRole('region', { name: '3 · Animate & verify' })
    const reviewed = within(animate).getByRole<HTMLInputElement>('checkbox', { name: 'I reviewed this revision in the preview' })
    expect(reviewed.checked).toBe(false)
    expect(within(panel).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(generatedGuide)
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value).toBe('0')
    expect(within(animate).getByRole('button', { name: 'Play sequence' })).toBeTruthy()
    expect(within(animate).queryByRole('button', { name: 'Pause sequence' })).toBeNull()
    expect(panel.querySelector('video')).toBeNull()
    expect(within(animate).getByLabelText<HTMLInputElement>('Duration (seconds)').value).toBe('2')
    expect(animate.textContent).toContain('Highlighted parts identify the control on the installed duck model at its default pose')
    expect(animate.textContent).not.toContain('Part thumbnails are unavailable')
    fireEvent.click(within(animate).getByRole('button', { name: 'Joints', pressed: false }))
    assertDecorativeParts(animate, 21, true)
    const selectedPaths = (name: string) => {
      const card = within(animate).getByRole('slider', { name }).closest('label')!
      return [...card.querySelectorAll('svg > g:last-child path')].map(path => path.getAttribute('d'))
    }
    expect(new Set(['left_hip_yaw', 'right_hip_yaw', 'head_yaw', 'Root pitch']
      .map(name => JSON.stringify(selectedPaths(name)))).size).toBe(4)
    for (const name of clipJointNames) {
      const control = within(animate).getByRole<HTMLInputElement>('slider', { name })
      expect(control.closest('label')!.querySelector('svg')).not.toBeNull()
      expect(control.getAttribute('aria-valuetext')).toMatch(/^-?\d+\.\d{3} rad · -?\d+\.\d°$/)
      expect(control.getAttribute('aria-describedby')!.split(' ').every(id => document.getElementById(id)?.textContent)).toBe(true)
    }
    expect(within(animate).getByRole('slider', { name: 'neck_pitch' }).getAttribute('aria-valuetext')).toBe('0.349 rad · 20.0°')
    transcript.push('part-icon-fixture=analytic cuboids on the MuJoCo STAND body tree; not duck photographs or rendered WebGL evidence',
      'decorative-model-part-icons=21', partControlText(animate, 'Animation / model-part icons and installed default angles'))
    fireEvent.click(within(animate).getByRole('button', { name: 'Rig', pressed: false }))
    assertDecorativeParts(animate, 30, true)
    const rigs = ['Squat · + crouch', 'Lean · + forward', 'L swing · + forward', 'R swing · + forward',
      'Sway · hips ±', 'Stance · + wide', 'Twist · hips ±', 'Toes · + outward', 'Look · + down']
    for (const name of rigs) {
      const control = within(animate).getByRole('slider', { name })
      expect(control.closest('label')!.querySelector('svg')).not.toBeNull()
      expect(control.getAttribute('aria-valuetext')).toBe('Amount 0.000')
    }
    transcript.push(partControlText(animate, 'Rig / nine illustrated coupled amounts, not joint angles'))
    setValue(animate, 'Squat · + crouch', '0.2')
    expect(within(animate).getByRole('slider', { name: 'Squat · + crouch' }).getAttribute('aria-valuetext')).toBe('Amount 0.200')
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Play sequence' }).disabled).toBe(true)
    fireEvent.click(within(animate).getByRole('button', { name: 'Reset Squat · + crouch' }))
    expect(Number(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Squat · + crouch' }).value)).toBeCloseTo(0)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(true)
    fireEvent.click(within(animate).getByRole('button', { name: 'Go to start' }))
    fireEvent.click(within(animate).getByRole('button', { name: 'Joints', pressed: false }))
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(3)
    const guideDetails = openDetails(panel, 'AI timed activity guide')
    expect(guideDetails.querySelector('p')!.textContent).toBe(generatedGuide)
    transcript.push(panelText(within(panel).getByRole('region', { name: '1 · Activity plan' }), 'AI / timed guide automatically fills activity box'))
    setValue(animate, 'Animation timeline', '1')
    fireEvent.click(within(animate).getByRole('button', { name: 'left_hip_yaw' }))
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'left_hip_yaw' }).value).toBe('0.2')
    fireEvent.click(reviewed)
    expect(reviewed.checked).toBe(true)
    const hipIcon = within(animate).getByRole('slider', { name: 'left_hip_yaw' }).closest('label')!.querySelector('svg')!
    const hipPaths = selectedPaths('left_hip_yaw')
    fireEvent.click(hipIcon)
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'left_hip_yaw' }).value).toBe('0.2')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value).toBe('1')
    expect(reviewed.checked).toBe(true)
    expect(within(animate).getByRole<HTMLButtonElement>('button', { name: 'Save clip JSON' }).disabled).toBe(false)
    expect(within(animate).getAllByRole('button', { name: /^Key at / })).toHaveLength(3)
    expect(selectedPaths('left_hip_yaw')).toEqual(hipPaths)
    transcript.push('decorative-icon-click-keeps-pose-keyframes-and-reviewed-revision=true')
    setValue(animate, 'left_hip_yaw', '0.4')
    fireEvent.click(within(animate).getByRole('button', { name: '◆ Key this pose' }))
    expect(reviewed.checked).toBe(false)
    const guideKey = 'dsh.store.protected:["dsh.clip-gen.dance-guides",null]'
    const saved = localStorage.getItem(guideKey)!
    const savedEntries = (JSON.parse(saved) as { data: { guides: Array<{ prompt: string; sequence: ClipSequence }> } }).data.guides
    expect(savedEntries).toHaveLength(1)
    expect(savedEntries[0]!.prompt).toBe(generatedGuide)
    expect(savedEntries[0]!.sequence).toEqual(authored[0])
    setValue(guides, 'Choose a dance guide', 'saved-1')
    setValue(animate, 'Animation timeline', '1')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'left_hip_yaw' }).value).toBe('0.2')
    expect(reviewed.checked).toBe(false)
    transcript.push(panelText(panel, 'AI / exact saved sequence restored after manual editing'))

    const blobs: Blob[] = []
    const downloads: Array<{ href: string; filename: string }> = []
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL(blob: Blob): string { blobs.push(blob); return `blob:clip-gen-download-${blobs.length}` }
      static override revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, filename: this.download })
    })
    onTestFinished(() => { click.mockRestore() })
    const downloadMotion = async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Download AI motion JSON' }))
      const blob = blobs.at(-1)!
      expect(blob.type).toBe('application/json')
      const reader = new FileReader()
      const read = new Promise<string>((resolve, reject) => {
        reader.onload = () => { resolve(reader.result as string) }
        reader.onerror = () => { reject(new Error('Downloaded motion JSON could not be read', { cause: reader.error })) }
      })
      reader.readAsText(blob)
      const contents = await read
      expect(downloads.at(-1)!.filename).toBe('microduck-motion-120bpm.json')
      await waitFor(() => { expect(revoke).toHaveBeenCalledWith(downloads.at(-1)!.href) })
      return JSON.parse(contents) as unknown
    }
    const downloaded = await downloadMotion()
    expect(downloaded).toEqual(authored[0]!.clip)
    expect(downloaded).not.toHaveProperty('sequence')
    expect(downloaded).not.toHaveProperty('guide')
    transcript.push('AI / downloaded bare motion JSON', JSON.stringify(downloaded))

    setValue(panel, 'What should the duck do?', 'Try a slightly wider greeting at 120 BPM.')
    fireEvent.click(aiButton)
    await waitFor(() => { expect(prompts).toHaveLength(2) })
    const newerPrompt = 'Keep my newer activity draft and edited hip target.'
    setValue(panel, 'What should the duck do?', newerPrompt)
    setValue(animate, 'left_hip_yaw', '0.45')
    fireEvent.click(within(animate).getByRole('button', { name: '◆ Key this pose' }))
    // Repeated accessibility-tree scans of the populated rig can delay the fixture's typewriter timers.
    await waitFor(() => { expect(panel.textContent).toContain('Replace activity plan and timeline') }, { timeout: 30_000 })
    expect(within(panel).getByRole('button', { name: 'Replace activity plan and timeline' })).toBeTruthy()
    expect(within(panel).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(newerPrompt)
    expect(within(animate).getByLabelText<HTMLInputElement>('Clip name').value).toBe('AI greeting 🦆')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'Animation timeline' }).value).toBe('1')
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'left_hip_yaw' }).value).toBe('0.45')
    expect(within(animate).getByRole('button', { name: 'Play sequence' })).toBeTruthy()
    expect(reviewed.checked).toBe(false)
    expect(await downloadMotion()).toEqual(authored[1]!.clip)
    expect(within(animate).getByRole<HTMLInputElement>('slider', { name: 'left_hip_yaw' }).value).toBe('0.45')
    await waitFor(() => { expect(within(guides).getByRole('status').textContent).toContain('Guides saved in this browser') })
    await waitFor(() => {
      expect((JSON.parse(localStorage.getItem(guideKey)!) as { data: { guides: unknown[] } }).data.guides).toHaveLength(2)
    })
    const savedWithCandidate = localStorage.getItem(guideKey)!
    const candidateEntries = (JSON.parse(savedWithCandidate) as {
      data: { guides: Array<{ prompt: string; sequence: ClipSequence }> }
    }).data.guides
    expect(candidateEntries).toHaveLength(2)
    expect(candidateEntries[0]).toEqual(savedEntries[0])
    expect(candidateEntries[1]).toMatchObject({ prompt: generatedGuide, sequence: authored[1] })
    transcript.push(panelText(within(panel).getByRole('region', { name: '1 · Activity plan' }), 'AI / newer edits keep returned guide and motion as a downloadable candidate'),
      'newer-hip-key=0.45', 'downloaded-candidate-hip-key=0.3', 'automatic-playback=false')
    const tree = screen.getByRole('tree', { name: 'Sessions' })
    const otherSession = within(tree).getAllByRole('treeitem', { selected: false })[0]!
    fireEvent.click(otherSession)
    await waitFor(() => { expect(otherSession.getAttribute('aria-selected')).toBe('true') })
    fireEvent.click(await screen.findByRole('tab', { name: 'Clip & Motion Gen' }))
    const other = await screen.findByRole('region', { name: 'Clip Gen' })
    await waitFor(() => {
      expect(within(other).getByRole<HTMLButtonElement>('button', { name: 'New clip' }).disabled).toBe(false)
    })
    setValue(other, 'Choose a dance guide', 'saved-1')
    expect(within(other).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value).toBe(generatedGuide)
    expect(within(other).getAllByRole('button', { name: /^Key at / })).toHaveLength(3)
    expect(localStorage.getItem(guideKey)).toBe(savedWithCandidate)
    expect(prompts).toHaveLength(2)
    expect(fixture.requests.some(({ request }) => ['save_project', 'save_trial', 'train', 'train_trial', 'simulate',
      'evaluate', 'evaluate_trial', 'save_reflection'].includes(request.operation))).toBe(false)
    transcript.push('current-agent-requests=2', 'joint-channels=14', 'saved-keyframes-reused-across-sessions=3',
      'saved-library-prompt-is-generated-guide=true', 'automatic-training-and-evaluation=false', 'saved-sequence-unchanged-by-manual-edits=true')
    await golden('clip-gen-ai-sequence', transcript)
  })

  it('guides a user with no session before mounting session-owned controls', async () => {
    mountAssembledApp('?fixture=empty', ['robot-lab'])
    const launcher = await screen.findByRole('button', { name: 'Robot Studio' }, { timeout: 10_000 })
    fireEvent.click(launcher)
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(player).getByRole('status').textContent).toBe('Start a Studio session, or select an existing one. No chat message or AI key is needed.')
    expect(within(player).queryByLabelText('Visual surface')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Micro Duck control panel' })).toBeNull()
    const start = within(player).getByRole<HTMLButtonElement>('button', { name: 'Start a Studio session' })
    await waitFor(() => { expect(start.disabled).toBe(false) })
    await golden('no-session', [`launcher=${launcher.getAttribute('title')}`, panelText(player, 'No session')])
    fireEvent.click(start)
    await screen.findByLabelText('Visual surface')
    expect((await screen.findByRole('tab', { name: 'RL Training' })).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('region', { name: 'Micro Duck control panel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start a Studio session' })).toBeNull()
  }, 15_000)

  it('opens an existing Studio session directly in Micro Duck and preserves a subsequent manual tab choice', async () => {
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture()
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    const tree = await screen.findByRole('tree', { name: 'Sessions' })
    await within(tree).findByRole('treeitem', { name: 'New Session', selected: true })
    // Row actions are hover-only; jsdom does not activate CSS :hover.
    const rowMenu = (await within(tree).findAllByRole('button', { name: 'Session actions for fixture', hidden: true }))[0]!
    const row = rowMenu.closest('[role="treeitem"]')!
    fireEvent.click(row)
    await waitFor(() => { expect(row.getAttribute('aria-selected')).toBe('true') })
    fireEvent.click(rowMenu)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive session' }))
    await waitFor(() => { expect(row.isConnected).toBe(false) })
    fireEvent.click(await screen.findByRole('button', { name: 'Robot Studio' }))
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    const existing = await within(player).findByRole<HTMLSelectElement>('combobox', { name: 'Existing session' })
    await waitFor(() => { expect(existing.disabled).toBe(false) })
    setValue(player, 'Existing session', 'fx-alpha')
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    const duck = screen.getByRole('tab', { name: 'RL Training' })
    expect(duck.getAttribute('aria-selected')).toBe('true')
    const transcript = [`opened-view=${text(duck)} selected=${duck.getAttribute('aria-selected')}`,
      `visible-panel=${panel.getAttribute('aria-label')}`]
    const chat = screen.getByRole('tab', { name: 'Chat' })
    fireEvent.click(chat)
    await waitFor(() => { expect(chat.getAttribute('aria-selected')).toBe('true') })
    expect(screen.queryByRole('region', { name: 'Micro Duck control panel' })).toBeNull()
    transcript.push(`manual-view=${text(chat)} selected=${chat.getAttribute('aria-selected')}`,
      `studio-view-selected=${duck.getAttribute('aria-selected')}`)
    await golden('studio-session-navigation', transcript)
  }, 30_000)

  it('recovers a portable authoring file without committing work and ignores a read after leaving the tab', async () => {
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture()
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    let panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    const sessionId = fixture.requests[0]!.sessionId
    const recoveredName = 'Recovered moon duck 🦆'
    const contents = fixture.draftFile(sessionId, recoveredName)
    const file = new File([contents], 'studio-authoring.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) })
    openDetails(panel, 'Training target')
    openDetails(panel, 'Learning brief · planned, not measured')
    openDetails(panel, 'Draft files and recovery details')
    const input = within(panel).getByLabelText('Import authoring draft — replaces current editor')
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => { expect(within(panel).getByLabelText<HTMLInputElement>('Project name').value).toBe(recoveredName) })
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save revision' }).disabled).toBe(false)
    expect(within(panel).getByText(/These edits are not a saved revision/)).toBeTruthy()
    const recovery = within(panel).getByRole('region', { name: 'Authoring draft recovery' })
    await waitFor(() => { expect(within(recovery).getByRole('status').textContent).not.toContain('save pending') })
    const transcript = ['## Portable authoring file · authored fixture, not a trained skill',
      `recovered-project=${within(panel).getByLabelText<HTMLInputElement>('Project name').value}`,
      panelText(recovery, 'Browser recovery notice')]
    expect(within(panel).getByLabelText<HTMLTextAreaElement>('Learning goal').value).toBe('Finish two authored cycles.')
    expect(within(panel).getByLabelText<HTMLSelectElement>('Practice budget').value).toBe('1024')
    const start = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' })
    expect(start.disabled).toBe(true)
    transcript.push(`recovered-goal=${within(panel).getByLabelText<HTMLTextAreaElement>('Learning goal').value}`,
      `recovered-practice-steps=${within(panel).getByLabelText<HTMLSelectElement>('Practice budget').value}`,
      `start-trial-disabled=${start.disabled}`, text(within(panel).getByText(/These edits are not a saved trial/)))
    openDetails(panel, 'Training target')
    const lateContents = fixture.draftFile(sessionId, 'Late file must not replace current work')
    const lateFile = new File([lateContents], 'late-authoring.json', { type: 'application/json' })
    let finishRead!: (value: string) => void
    const pendingRead = new Promise<string>((resolve) => { finishRead = resolve })
    Object.defineProperty(lateFile, 'text', { value: () => pendingRead })
    fireEvent.change(within(panel).getByLabelText('Import authoring draft — replaces current editor'), { target: { files: [lateFile] } })
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Micro Duck control panel' })).toBeNull() })
    await act(async () => { finishRead(lateContents); await pendingRead })
    fireEvent.click(screen.getByRole('tab', { name: 'RL Training' }))
    panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    expect(within(panel).getByLabelText<HTMLInputElement>('Project name').value).toBe(recoveredName)
    const readonly = new Set(['readiness', 'studio', 'projects', 'behaviors', 'policies', 'runs', 'trials', 'evaluations', 'reflections', 'scene'])
    const mutations = fixture.requests.filter(item => !readonly.has(item.request.operation))
    expect(mutations).toEqual([])
    transcript.push(`after-tab-remount=${within(panel).getByLabelText<HTMLInputElement>('Project name').value}`,
      `automatic-mutations=${JSON.stringify(mutations)}`)
    await golden('draft-import-recovery', transcript)
  }, 30_000)

  it('switches Train and Evaluate without operations or losing mounted authoring drafts', async () => {
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture()
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    const { train, evaluate } = trainingPanels(panel)
    expect(within(panel).getByRole('tabpanel', { name: 'Train' })).toBe(train)
    const requests = fixture.requests.length
    const target = openDetails(train, 'Training target')
    const brief = openDetails(train, 'Learning brief · planned, not measured')
    fireEvent.click(within(train).getByRole('button', { name: /Gentle groove/ }))
    setValue(train, 'Project name', 'Unsaved tab draft 🦆')
    setValue(train, 'Prediction', 'Small moves will preserve balance.')
    const projectName = within(train).getByLabelText<HTMLInputElement>('Project name')
    const prediction = within(train).getByLabelText<HTMLTextAreaElement>('Prediction')
    const transcript = [panelText(panel, 'Train / unsaved draft')]
    expect(transcript[0]).not.toContain('label=Evaluation report')
    expect(selectTrainingTab(panel, 'Evaluate')).toBe(evaluate)
    expect(train.hidden).toBe(true)
    expect(projectName.isConnected).toBe(true)
    expect(within(panel).queryByRole('tabpanel', { name: 'Train' })).toBeNull()
    expect(within(panel).getByRole('combobox', { name: 'Evaluation report' })).toBeTruthy()
    transcript.push(panelText(panel, 'Evaluate / Train remains mounted and hidden'))
    expect(transcript[1]).not.toContain('label=Project name')
    expect(transcript[1]).not.toContain('Small moves will preserve balance.')
    expect(selectTrainingTab(panel, 'Train')).toBe(train)
    expect(evaluate.hidden).toBe(true)
    expect(within(train).getByLabelText('Project name')).toBe(projectName)
    expect(within(train).getByLabelText('Prediction')).toBe(prediction)
    expect(projectName.value).toBe('Unsaved tab draft 🦆')
    expect(prediction.value).toBe('Small moves will preserve balance.')
    expect(target.open).toBe(true)
    expect(brief.open).toBe(true)
    trainingPanels(panel)
    expect(fixture.requests.slice(requests)).toEqual([])
    expect(fixture.history()).toEqual({ trials: [], runs: [], evaluations: [], reflections: [] })
    transcript.push(panelText(panel, 'Train / same mounted draft restored'), 'tab-navigation-operations=[]')
    await golden('training-tab-navigation', transcript)
  }, 30_000)

  it('keeps native authoring and player controls honest when Robot RPC is unavailable', async () => {
    mountAssembledApp('?fixture', ['robot-lab'])
    await openSession()
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await waitFor(() => {
      expect(within(panel).getByRole('alert').textContent).toBe(['trials', 'evaluations', 'reflections', 'readiness']
        .map(operation => `${operation}: client api: robotLab/request failed: fixture connection RPC endpoint "robotLab/request" is unavailable`).join('\n'))
      expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Check connection' }).disabled).toBe(false)
    })
    const { train, evaluate } = trainingPanels(panel)
    const target = within(train).getByText('Training target', { selector: 'summary' }).parentElement as HTMLDetailsElement
    const brief = within(train).getByText('Learning brief · planned, not measured', { selector: 'summary' }).parentElement as HTMLDetailsElement
    expect(target.open).toBe(false)
    expect(brief.open).toBe(false)
    const transcript = [panelText(panel, 'Train and Evaluate / unavailable / setup collapsed')]
    openDetails(train, 'Training target')
    fireEvent.click(within(train).getByRole('button', { name: 'Open Studio ↗' }))
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(player).getByRole<HTMLButtonElement>('button', { name: 'Preview standing policy' }).disabled).toBe(true)
    expect(within(player).getByRole<HTMLButtonElement>('button', { name: 'Play recording' }).disabled).toBe(true)
    expect(within(player).getByRole('region', { name: 'Robot simulation stage' }).querySelector('canvas')).not.toBeNull()
    transcript.push(panelText(train, 'Training target / unavailable'), panelText(player, 'Player / unavailable'))
    setValue(player, 'Visual surface', 'grass')
    setValue(player, 'Camera', 'top')
    fireEvent.click(within(player).getByRole('button', { name: 'Expand view' }))
    expect(within(player).getByRole('button', { name: 'Compact view' }).getAttribute('aria-pressed')).toBe('true')
    transcript.push(panelText(player, 'Player / visual preferences'))
    expect(within(train).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    setValue(train, 'Training backend', 'mlx')
    transcript.push(panelText(train, 'Train / unavailable learner'))
    selectTrainingTab(panel, 'Evaluate')
    openDetails(evaluate, 'Hardware deployment remains blocked')
    expect(within(evaluate).getByRole<HTMLButtonElement>('button', { name: 'Activate hardware (unavailable)' }).disabled).toBe(true)
    transcript.push(panelText(evaluate, 'Evaluate / unavailable'))
    await golden('stage-unavailable', transcript)
  }, 30_000)

  it('reads saved choreography evidence separately from balance without authoring or training', async () => {
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture({ savedDanceReports: true, savedRlxRuns: true })
    const [failedReport, incompleteReport, partialV2] = fixture.history().evaluations
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    expect(within(trainingPanels(panel).train).getByText('Open Training target to save your routine before starting a project-bound run.')).toBeTruthy()
    selectTrainingTab(panel, 'Evaluate')
    setValue(panel, 'Evaluation report', failedReport!.id)
    await within(panel).findByRole('heading', { name: 'Balance criteria passed' })
    const failed = within(panel).getByRole('article', { name: 'Selected evidence' })
    expect(within(failed).getByText('Choreography criteria failed', { selector: 'strong' })).toBeTruthy()
    expect(within(failed).getByText('Version 1 applies joint/root RMSE and movement thresholds to the observed fragment. With missing measurements, these fragment failures alone do not prove a whole-window violation. Excessive observed drift remains decisive. Historical verdicts are preserved.')).toBeTruthy()
    expect(within(failed).getByText('Not measured here: beat phase, frequency error, accumulated timing drift, foot slip or motor saturation. These nominal simulations do not assess robustness to disturbances.')).toBeTruthy()
    const criteriaSummary = within(failed).getByText('Criteria frozen before training — not the current editor settings')
    fireEvent.click(criteriaSummary)
    const criteriaDetails = criteriaSummary.closest('details')!
    expect(criteriaDetails.open).toBe(true)
    const criteria = within(criteriaDetails)
    const frozen = failedReport!.dancePlan!.evaluation.dance
    expect(criteria.getByText(`Required consecutive cycles: ${frozen.requiredCycles} · Minimum passing episode fraction: ${frozen.minPassedEpisodeFraction}`)).toBeTruthy()
    expect(criteria.getByText(`Maximum root orientation RMSE (rad): ${frozen.maxRootOrientationRmseRad} · Maximum horizontal displacement (m): ${frozen.maxHorizontalDriftMeters}`)).toBeTruthy()
    expect(criteria.getByText(`Allowed centered amplitude ratio: ${frozen.minAmplitudeRatio}–${frozen.maxAmplitudeRatio} · Minimum zero-lag reference gain: ${frozen.minReferenceGainRatio} · Minimum reference excursion (rad): ${frozen.minReferenceExcursionRad}`)).toBeTruthy()
    expect(criteria.getByText('Movement thresholds apply to the selected joints in each cycle and to reference-active blocks. Stationary blocks retain positional checks.')).toBeTruthy()
    expect(within(criteria.getByRole('row', { name: /^joint_1 / })).getAllByRole('cell').map(cell => text(cell)))
      .toEqual([String(frozen.maxJointRmseRad[0]), 'Required when reference-active'])
    expect(criteria.getByText('Measurements are displayed rounded; the stored verdict uses the full recorded precision. The displayed limits come from this report’s frozen plan.')).toBeTruthy()
    expect(within(failed).getByText(/Simulator minus authored cycle duration \(s\): 0.004000/)).toBeTruthy()
    fireEvent.click(within(failed).getByText('Episode 1 · Choreography criteria failed'))
    expect(within(failed).getByText(/Elapsed\/requested reference cycles: 2\/2/)).toBeTruthy()
    const cycle = within(failed).getByText('Cycle 2 · Choreography criteria failed')
    fireEvent.click(cycle)
    const joints = within(cycle.parentElement!).getAllByText('Per-joint measurements')[0]!
    fireEvent.click(joints)
    expect(within(joints.parentElement!).getByRole('row', { name: /joint_1 / }).textContent).toContain('-0.2000')
    const transcript = [panelText(failed, 'Saved balance pass / choreography failure')]

    setValue(panel, 'Evaluation report', incompleteReport!.id)
    const incomplete = within(panel).getByRole('article', { name: 'Selected evidence' })
    expect(within(incomplete).getByRole('heading', { name: 'Balance criteria passed' })).toBeTruthy()
    expect(within(incomplete).getByText('Choreography assessment incomplete', { selector: 'strong' })).toBeTruthy()
    fireEvent.click(within(incomplete).getByText('Episode 1 · Choreography assessment incomplete'))
    expect(within(incomplete).getByText(/Elapsed\/requested reference cycles: 2\/2/)).toBeTruthy()
    fireEvent.click(within(incomplete).getByText('Cycle 2 · Choreography assessment incomplete'))
    expect(within(incomplete).getByText(/Finite measurements\/expected control steps: 30\/240/)).toBeTruthy()
    const missingBlockSummary = within(incomplete).getByText('Authored block 2 · Choreography assessment incomplete')
    fireEvent.click(missingBlockSummary)
    const missingBlock = missingBlockSummary.parentElement!
    expect(within(missingBlock).getByText(/Largest joint RMSE \(rad\): Not recorded/)).toBeTruthy()
    setValue(panel, 'Baseline report', failedReport!.id)
    expect(within(panel).getByText('Choreography plan hashes differ; these are not like-for-like assessments.')).toBeTruthy()
    transcript.push(panelText(panel, 'Saved incomplete choreography / different-plan baseline'))

    setValue(panel, 'Evaluation report', partialV2!.id)
    const bounded = within(panel).getByRole('article', { name: 'Selected evidence' })
    expect(within(bounded).getByText('Choreography assessment incomplete', { selector: 'strong' })).toBeTruthy()
    expect(within(bounded).getByText('Version 2 uses whole-window RMSE lower bounds on partial coverage. Amplitude and reference gain are decisive only with all planned measurements; excessive observed drift remains decisive. A window with missing measurements cannot pass.')).toBeTruthy()
    const reveal = (summary: HTMLElement) => {
      const details = summary.closest('details')!
      if (!details.open) fireEvent.click(summary)
      expect(details.open).toBe(true)
      return within(details)
    }
    const boundedCriteria = reveal(within(bounded).getByText('Criteria frozen before training — not the current editor settings'))
    expect(boundedCriteria.getByText('Maximum root orientation RMSE (rad): 0.2 · Maximum horizontal displacement (m): 0.2')).toBeTruthy()
    reveal(within(bounded).getByText('Episode 1 · Choreography assessment incomplete'))
    expect(within(bounded).getByText(/Elapsed\/requested reference cycles: 1\/1/)).toBeTruthy()
    const boundedWindow = reveal(within(bounded).getByText('Cycle 1 · Choreography assessment incomplete'))
    expect(boundedWindow.getByText(/Finite measurements\/expected control steps: 1\/100/)).toBeTruthy()
    expect(boundedWindow.getByText('Largest derived joint RMSE lower bound (rad): 0.0300 · Derived root RMSE lower bound (rad): 0.0300')).toBeTruthy()
    const boundedBlock = reveal(boundedWindow.getByText('Authored block 1 · Choreography assessment incomplete'))
    expect(boundedBlock.getByText(/Largest joint RMSE \(rad\): 0.3000 · Root orientation RMSE \(rad\): 0.3000/)).toBeTruthy()
    expect(boundedBlock.getByText('Largest derived joint RMSE lower bound (rad): 0.0424 · Derived root RMSE lower bound (rad): 0.0424')).toBeTruthy()
    expect(boundedBlock.getByText('Derived, not additional measurements: observed RMSE × √(finite samples / planned control steps). A bound within its limit cannot establish a pass; recorded verdicts are not recomputed here.')).toBeTruthy()
    const missingV2 = reveal(boundedWindow.getByText('Authored block 2 · Choreography assessment incomplete'))
    expect(missingV2.getByText('Largest derived joint RMSE lower bound (rad): Not recorded · Derived root RMSE lower bound (rad): Not recorded')).toBeTruthy()
    transcript.push(panelText(bounded, 'Synthetic v2 / fragment RMSE above limit is not a whole-window failure'))
    expect(fixture.history().evaluations).toEqual([failedReport, incompleteReport, partialV2])

    selectTrainingTab(panel, 'Train')
    const observedRun = (name: string) => within(panel).getByText(name).closest('article')!
    const legacyRun = observedRun('Synthetic RLX legacy · stopped')
    const legacyObservations = reveal(within(legacyRun).getByText('RLX training observations'))
    expect(legacyObservations.getByText('No RLX observations were recorded for this run. Missing values are not zero.')).toBeTruthy()
    expect(legacyObservations.getAllByText('Not recorded')).toHaveLength(7)
    const zeroRun = observedRun('Synthetic RLX before completion · stopped')
    const zeroObservations = reveal(within(zeroRun).getByText('RLX training observations'))
    expect(zeroObservations.getByText('Counts and times cover fully completed reported phases only; ongoing, incomplete or failed phase work is excluded. Zero reported values do not mean no computation occurred.')).toBeTruthy()
    expect([...zeroRun.querySelectorAll('dd')].map(node => text(node)))
      .toEqual(['0', '0', 'Not recorded', '0.000', '0.000', 'Not recorded', 'Not recorded'])
    const completedRun = observedRun('Synthetic RLX completed · completed')
    const completedObservations = reveal(within(completedRun).getByText('RLX training observations'))
    expect([...completedRun.querySelectorAll('dd')].map(node => text(node)))
      .toEqual(['4', '8', '-0.1250', '3.250', '5.500', '0.125', '2.750'])
    expect(within(completedRun).getByText('100 / 100 steps · 10.0 seconds · 10 training steps/s (average)')).toBeTruthy()
    expect(completedObservations.getByText('Loss averages the weighted total minibatch objective from the last fully completed rollout/update pair. It is not a policy/value/entropy breakdown or a dance score.')).toBeTruthy()
    expect(completedObservations.getByText('Collection includes CPU environment calls and inference. Update includes GAE, deferred critic work and optimization, not isolated GPU compute. Transfer cost is not isolated.')).toBeTruthy()
    expect(completedObservations.getByText('The training elapsed clock excludes checkpoint and export. Checkpoint and export times are not recorded until those operations complete; export includes parity verification.')).toBeTruthy()
    transcript.push(panelText(legacyRun, 'Synthetic RLX history / absent observations are not zero'),
      panelText(zeroRun, 'Synthetic RLX history / zeros exclude ongoing work'),
      panelText(completedRun, 'Synthetic RLX history / training observations are not assessment'))
    expect(fixture.requests.some(({ request }) => ['save_trial', 'train_trial', 'evaluate_trial', 'train',
      'evaluate', 'simulate', 'replay_evaluation', 'save_project', 'save_reflection'].includes(request.operation))).toBe(false)
    await golden('saved-dance-evidence', transcript)
  }, 30_000)

  it('preserves explicit experimental choreography drafts and freezes a new trial without training', async () => {
    installPersistenceLocks()
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture()
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    let panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    const sessionId = fixture.requests[0]!.sessionId
    const importFile = (contents: string) => {
      const file = new File([contents], 'explicit-choreography.json', { type: 'application/json' })
      Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) })
      fireEvent.change(within(panel).getByLabelText('Import authoring draft — replaces current editor'), { target: { files: [file] } })
    }
    openDetails(panel, 'Training target')
    openDetails(panel, 'Learning brief · planned, not measured')
    openDetails(panel, 'Draft files and recovery details')
    importFile(fixture.draftFile(sessionId, '月光鸭 🦆'))
    await within(panel).findByLabelText('Project name')
    fireEvent.click(within(panel).getByText('Advanced training settings'))
    setValue(panel, 'Parallel environments', '4')
    setValue(panel, 'Random seed', '0')
    const title = 'Advanced experimental choreography criteria'
    const toggle = 'Include explicit choreography criteria in new trials'
    const cycles = 'Required consecutive reference cycles'
    fireEvent.click(within(panel).getByText(title))
    expect(within(panel).getByLabelText<HTMLInputElement>(toggle).checked).toBe(false)
    fireEvent.click(within(panel).getByLabelText(toggle))
    const editor = () => within(panel).getByText(title).parentElement!
    const inputs = [...editor().querySelectorAll<HTMLInputElement>('input[type="text"][inputmode="decimal"]')]
    expect(inputs.map(input => input.value)).toEqual(Array<string>(22).fill(''))
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(true)
    const transcript = ['## Explicit synthetic authoring inputs — uncalibrated, no training or measured dance result',
      panelText(editor(), 'Blank opt-in v2 / admission blocked'), `visible-validation=${text(within(panel).getByRole('alert'))}`]
    const scalarInputs = [[cycles, '2'], ['Minimum choreography passing episode fraction', '0.75'],
      ['Maximum root orientation RMSE (rad)', '0.3'], ['Minimum reference excursion (rad)', '0.12'],
      ['Minimum amplitude ratio', '0.45'], ['Maximum amplitude ratio', '1.65'],
      ['Minimum reference gain ratio', '0.55'], ['Maximum horizontal drift (m)', '0.2']] as const
    for (const [label, value] of scalarInputs) setValue(panel, label, value)
    const bounds = Array.from({ length: 14 }, (_, index) => (10 + index) / 100)
    const chosen = { version: 2, requiredCycles: 2, minPassedEpisodeFraction: 0.75,
      maxJointRmseRad: bounds, maxRootOrientationRmseRad: 0.3, movingJointIndices: [0, 3, 13], minReferenceExcursionRad: 0.12,
      minAmplitudeRatio: 0.45, maxAmplitudeRatio: 1.65, minReferenceGainRatio: 0.55, maxHorizontalDriftMeters: 0.2 }
    for (const [index, value] of bounds.entries()) setValue(panel, `joint_${index + 1} · Maximum joint RMSE (rad)`, String(value))
    for (const index of [13, 0, 3]) fireEvent.click(within(panel).getByLabelText(`joint_${index + 1} · Require movement when reference-active`))
    setValue(panel, cycles, '')
    fireEvent.click(within(panel).getByLabelText(toggle))
    const key = `dsh.store.protected:${JSON.stringify(['dsh.robot-lab.authoring', sessionId])}`
    const persisted = await waitFor(() => {
      const record = JSON.parse(localStorage.getItem(key) ?? 'null') as { data: Record<string, unknown> } | null
      expect(record?.data.choreography).toMatchObject({ enabled: false, version: 2, fields: { requiredCycles: '' },
        maxJointRmseRad: bounds.map(String), movingJointIndices: [0, 3, 13] })
      return record!
    })
    const portable = JSON.stringify({ version: 1, sessionId, draft: persisted.data })
    transcript.push(`durable-raw-editor=${JSON.stringify(persisted.data.choreography)}`)
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'RL Training' }))
    panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    openDetails(panel, title)
    expect(within(panel).getByLabelText<HTMLInputElement>(toggle).checked).toBe(false)
    fireEvent.click(within(panel).getByLabelText(toggle))
    expect(within(panel).getByLabelText<HTMLInputElement>(cycles).value).toBe('')
    setValue(panel, cycles, '9')
    openDetails(panel, 'Training target')
    const recovery = within(panel).getByText('Draft files and recovery details')
    if (!recovery.closest('details')!.open) fireEvent.click(recovery)
    const legacyDraft: Record<string, unknown> = { ...persisted.data,
      dance: { ...(persisted.data.dance as Record<string, unknown>), name: 'Legacy criteria draft' },
      assessment: { ...(persisted.data.assessment as Record<string, unknown>), dance: { ...chosen, version: 1 } } }
    delete legacyDraft.choreography
    importFile(JSON.stringify({ version: 1, sessionId, draft: legacyDraft }))
    await waitFor(() => { expect(within(panel).getByLabelText<HTMLInputElement>('Project name').value).toBe('Legacy criteria draft') })
    expect(within(panel).getByText(/^Criteria version 1 retained:/)).toBeTruthy()
    setValue(panel, cycles, '3')
    transcript.push(panelText(editor(), 'Legacy numeric v1 / editing retains its version'))
    expect(within(panel).getByText(/^Criteria version 1 retained:/)).toBeTruthy()
    openDetails(panel, 'Training target')
    importFile(portable)
    await waitFor(() => { expect(within(panel).getByLabelText<HTMLInputElement>('Project name').value).toBe('月光鸭 🦆') })
    await waitFor(() => { expect(within(panel).getByLabelText<HTMLInputElement>(toggle).checked).toBe(false) })
    fireEvent.click(within(panel).getByLabelText(toggle))
    expect(within(panel).getByLabelText<HTMLInputElement>(cycles).value).toBe('')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    transcript.push(panelText(editor(), 'File-recovered incomplete v2 / still blocked'))
    setValue(panel, cycles, '2')
    openDetails(panel, 'Training target')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save revision' }))
    await idle(panel)
    await waitFor(() => { expect(fixture.requests.filter(({ request }) => request.operation === 'save_project')).toHaveLength(1) })
    const save = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save trial' })
    await waitFor(() => { expect(save.disabled).toBe(false) })
    fireEvent.click(save)
    await waitFor(() => { expect(fixture.history().trials).toHaveLength(1) })
    await idle(panel)
    const frozen = fixture.history().trials[0]!.trial.recipe
    expect(frozen.evaluation.dance).toEqual(chosen)
    expect(frozen.spec.projectRevisionId).toBe('revision-1')
    expect(frozen.brief.prediction).toBe('The small motion should preserve balance.')
    expect(frozen.brief.evidence).toBe('Compare cycle tracking and terminations.')
    setValue(panel, cycles, '')
    expect(fixture.history().trials[0]!.trial.recipe).toEqual(frozen)
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Start saved trial' }).disabled).toBe(false)
    expect(fixture.requests.some(({ request }) => ['train', 'train_trial', 'evaluate', 'evaluate_trial', 'simulate'].includes(request.operation))).toBe(false)
    transcript.push(`frozen-new-trial=${JSON.stringify(frozen)}`, 'post-save-invalid-draft-does-not-change-frozen-trial=true', 'training-or-evaluation-requested=false')
    await golden('explicit-choreography-authoring', transcript)
  }, 30_000)

  it('renders Chinese learning sections through the built locale registration without training', async () => {
    const languages = Object.getOwnPropertyDescriptor(navigator, 'languages')!
    const language = Object.getOwnPropertyDescriptor(navigator, 'language')!
    try {
      Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] })
      Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' })
      mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
      const fixture = robotRpcFixture({ savedDanceReports: true })
      await waitFor(() => {
        const timing = (globalThis as typeof globalThis & {
          __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
        }).__fxTiming
        expect(timing).toBeDefined()
        timing?.setRobotLabResponder(fixture.respond)
      })
      fireEvent.click(await screen.findByText('Fixture 历史会话'))
      fireEvent.click(await screen.findByRole('tab', { name: 'RL Training' }))
      const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
      await idle(panel)
      expect(document.documentElement.lang).toBe('zh-CN')
      expect(within(panel).getByRole('tabpanel', { name: '训练' })).toBeTruthy()
      expect(within(panel).queryByRole('tabpanel', { name: '评估' })).toBeNull()
      expect(within(panel).getByRole('tab', { name: '训练', selected: true })).toBeTruthy()
      expect(within(panel).getByRole('tab', { name: '评估', selected: false })).toBeTruthy()
      openDetails(panel, '训练目标')
      openDetails(panel, '学习简报 · 计划，而非测量结果')
      openDetails(panel, '草稿文件与恢复说明')
      const contents = fixture.draftFile('fx-alpha', '月光鸭 🦆')
      const file = new File([contents], 'learning-plan.json', { type: 'application/json' })
      Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) })
      fireEvent.change(within(panel).getByLabelText('导入创作草稿——替换当前编辑内容'), { target: { files: [file] } })
      await within(panel).findByLabelText('Project name')
      fireEvent.click(within(panel).getByRole('button', { name: 'Save revision' }))
      await idle(panel)
      fireEvent.click(within(panel).getByText('Advanced training settings'))
      setValue(panel, 'Parallel environments', '4')
      setValue(panel, 'Random seed', '0')
      const save = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save trial' })
      await waitFor(() => { expect(save.disabled).toBe(false) })
      fireEvent.click(save)
      await waitFor(() => { expect(fixture.history().trials).toHaveLength(1) })
      await idle(panel)
      expect(within(panel).getByLabelText<HTMLTextAreaElement>('学习目标').value).toBe('Finish two authored cycles.')
      expect(within(panel).getByText('试验 trial-1 · SHA-256 ' + 'a'.repeat(64))).toBeTruthy()
      expect(within(panel).getByRole<HTMLButtonElement>('button', { name: '启动已保存的试验' }).disabled).toBe(false)
      expect(within(panel).getByText('上述已保存的试验设置不可变；编辑草稿会创建不同的试验。')).toBeTruthy()
      const brief = within(panel).getByText('学习简报 · 计划，而非测量结果').closest('details')!
      const assessment = within(panel).getByText('训练前规划的评估').parentElement!
      const frozen = within(panel).getByRole('heading', { name: '已保存的试验' }).parentElement!
      const transcript = [panelText(brief, 'Chinese brief / authored text unchanged'),
        panelText(assessment, 'Chinese pre-training assessment'), panelText(frozen, 'Frozen saved trial / no run')]
      fireEvent.click(within(panel).getByRole('tab', { name: '评估' }))
      expect(within(panel).getByRole('tabpanel', { name: '评估' })).toBeTruthy()
      const reports = within(panel).getByLabelText<HTMLSelectElement>('评估报告')
      const report = fixture.history().evaluations[0]!
      fireEvent.change(reports, { target: { value: report.id } })
      const selected = await within(panel).findByRole('article', { name: '所选证据' })
      expect(within(selected).getByText(`报告 ${report.id} · ${report.evaluatedAt}`)).toBeTruthy()
      expect(within(selected).getByText('平均直立比例')).toBeTruthy()
      expect(within(selected).getByRole<HTMLButtonElement>('button', { name: '重新仿真回合 1' }).disabled).toBe(true)
      openDetails(panel, '硬件部署仍被阻止')
      expect(within(panel).getByRole<HTMLButtonElement>('button', { name: '显示部署阻碍' }).disabled).toBe(true)
      transcript.push(panelText(selected, 'Chinese saved synthetic report / not the new trial'),
        panelText(within(panel).getByText('观察与改进').parentElement!, 'Chinese reflection controls'))
      const rollouts = ['train', 'train_trial', 'evaluate', 'evaluate_trial', 'simulate', 'replay_evaluation']
      expect(fixture.requests.some(({ request }) => rollouts.includes(request.operation))).toBe(false)
      await golden('chinese-learning', transcript)
    } finally {
      Object.defineProperty(navigator, 'languages', languages)
      Object.defineProperty(navigator, 'language', language)
    }
  }, 30_000)

  it('authors blocks, freezes training identity, and synchronizes target and recorded playback', async () => {
    mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
    const fixture = robotRpcFixture()
    await waitFor(() => {
      const timing = (globalThis as typeof globalThis & {
        __fxTiming?: { setRobotLabResponder: (responder: typeof fixture.respond) => void }
      }).__fxTiming
      expect(timing).toBeDefined()
      timing?.setRobotLabResponder(fixture.respond)
    })
    await openSession()
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await idle(panel)
    // ConversationRoot uses this public opt-in to constrain the view above its composer seat.
    expect(panel.hasAttribute('data-conversation-composer-overlay')).toBe(true)
    const { train, evaluate } = trainingPanels(panel)
    const target = within(train).getByText('Training target', { selector: 'summary' }).parentElement as HTMLDetailsElement
    const brief = within(train).getByText('Learning brief · planned, not measured', { selector: 'summary' }).parentElement as HTMLDetailsElement
    expect(target.open).toBe(false)
    expect(brief.open).toBe(false)
    const transcript = [panelText(panel, 'Train and Evaluate / connected / setup collapsed')]
    openDetails(train, 'Training target')
    openDetails(train, 'Learning brief · planned, not measured')
    fireEvent.click(within(train).getByRole('button', { name: 'Open Studio ↗' }))
    const initialPlayer = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(initialPlayer).getByRole('region', { name: 'Robot simulation stage' }).querySelector('canvas')).not.toBeNull()
    expect(within(initialPlayer).getByRole<HTMLButtonElement>('button', { name: 'Play recording' }).disabled).toBe(true)
    expect(fixture.requests.some(({ request }) => request.operation === 'simulate' || request.operation === 'reference_preview')).toBe(false)
    transcript.push(panelText(initialPlayer, 'Player / default grid'))
    setValue(panel, 'Learning goal', 'Stay upright through the eight-beat routine.')
    setValue(panel, 'Prediction', 'The small routine will remain upright in both episodes.')
    setValue(panel, 'Planned change', 'Begin with a half-size groove and wave.')
    setValue(panel, 'Evidence to examine', 'Inspect terminations, upright fraction and joint tracking error.')
    transcript.push(panelText(panel, 'Train / planned learning brief'))
    fireEvent.click(within(panel).getByRole('button', { name: /Gentle groove/ }))
    setValue(panel, 'Project name', '月光鸭 🦆')
    fireEvent.click(within(panel).getByRole('button', { name: 'Build with motion blocks' }))
    setValue(panel, 'Block 1 length', '4')
    fireEvent.click(within(panel).getByRole('button', { name: 'Duplicate' }))
    setValue(panel, 'Block 2 move', 'wave')
    setValue(panel, 'Block 2 move size', '0.75')
    const block = (index: number) => within(within(panel).getByRole('article', { name: `Motion block ${index}` }))
    fireEvent.click(block(2).getByRole('button', { name: 'Move up' }))
    expect(within(panel).getByLabelText<HTMLSelectElement>('Block 1 move').value).toBe('wave')
    fireEvent.click(block(1).getByRole('button', { name: 'Move down' }))
    fireEvent.click(block(2).getByRole('button', { name: 'Duplicate' }))
    fireEvent.click(block(3).getByRole('button', { name: 'Remove' }))
    setValue(panel, 'Music style', 'lofi')
    fireEvent.click(within(panel).getByRole('button', { name: 'Try another variation' }))
    expect(within(panel).getByLabelText<HTMLInputElement>('Total length').value).toBe('8 beats · 4.0 seconds')
    transcript.push(panelText(panel, 'Training target / ordered blocks and music'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview target in Studio' }))
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    await within(player).findByText('Target preview · Not physics-tested')
    await idle(panel)
    expect(within(player).getByRole<HTMLButtonElement>('button', { name: 'Play with soundtrack' }).disabled).toBe(false)
    expect(within(player).queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(player.querySelector('canvas')).not.toBeNull()
    expect(within(player).getAllByText('Not measured')).toHaveLength(4)
    const requestCount = fixture.requests.length
    for (const rate of ['0.5', '1', '1.5', '2']) {
      setValue(player, 'Replay speed', rate)
      expect(within(player).getByLabelText<HTMLSelectElement>('Replay speed').value).toBe(rate)
      expect(within(player).getByLabelText<HTMLInputElement>('Performance time').value).toBe('0')
    }
    setValue(player, 'Performance time', '2.5')
    within(player).getByText('Small wave', { selector: 'strong' })
    within(player).getByText('Move 2 / 2 · Beats 5–8')
    transcript.push(panelText(panel, 'Training target / saved target'), panelText(player, 'Target / second block at 2×'))
    expect(fixture.requests).toHaveLength(requestCount)
    fireEvent.click(within(player).getByRole('button', { name: 'Play with soundtrack' }))
    await within(player).findByRole('alert')
    expect(within(player).queryByRole('button', { name: 'Pause' })).toBeNull()
    within(player).getByRole('button', { name: 'Play without music' })
    transcript.push(panelText(player, 'Target / explicit audio-unavailable state'))
    fireEvent.click(within(player).getByRole('button', { name: 'Play without music' }))
    fireEvent.click(await within(player).findByRole('button', { name: 'Pause' }))
    setValue(player, 'Performance time', '2.5')
    transcript.push(panelText(player, 'Target / explicit silent playback paused'))

    expect(within(panel).getByRole<HTMLOptionElement>('option', {
      name: 'Practice — behavior default (unqualified) · 4,096 steps',
    }).value).toBe('4096')
    expect(within(panel).queryByRole('option', { name: /Practice — recommended/ })).toBeNull()
    setValue(panel, 'Training backend', 'mlx')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    transcript.push(panelText(panel, 'Train / unavailable MLX'))
    setValue(panel, 'Training backend', 'rlx')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    expect(within(panel).getByLabelText<HTMLSelectElement>('Training backend').value).toBe('rlx')
    within(panel).getByText('RLX is unavailable in this fixture.')
    transcript.push(panelText(panel, 'Train / unavailable RLX without fallback'))
    setValue(panel, 'Training backend', 'cpu')
    setValue(panel, 'Practice budget', '1024')
    openDetails(train, 'Advanced: edit assessment criteria')
    setValue(panel, 'Assessment episodes', '2')
    setValue(panel, 'Assessment horizon (steps)', '200')
    setValue(panel, 'Assessment seed', '17')
    setValue(panel, 'Maximum terminations', '0')
    setValue(panel, 'Minimum mean upright fraction', '0.9')
    transcript.push(panelText(panel, 'Train / criteria frozen before admission'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Save and start trial' }))
    await within(panel).findByRole('button', { name: 'Evaluate this policy' })
    await idle(panel)
    transcript.push(panelText(panel, 'Train / completed quick check is not skill completion'))
    const admitted = fixture.requests.find(item => item.request.operation === 'save_trial')
    expect(admitted?.request).toMatchObject({ operation: 'save_trial', recipe: {
      spec: { projectRevisionId: 'revision-1', clip: null }, parentReflectionId: null,
      brief: { goal: 'Stay upright through the eight-beat routine.', evidence: 'Inspect terminations, upright fraction and joint tracking error.' },
      evaluation: { episodes: 2, stepsPerEpisode: 200, seed: 17, maxTerminations: 0, minMeanUprightFraction: 0.9 },
    } })
    expect(fixture.requests.filter(item => item.request.operation === 'train_trial').map(item => item.request))
      .toEqual([{ operation: 'train_trial', trialId: 'trial-1' }])
    expect(fixture.requests.some(item => item.request.operation === 'evaluate_trial')).toBe(false)
    transcript.push(`[Trial admission RPC]\n${JSON.stringify(admitted, null, 2)}`)

    const beforeReview = fixture.requests.length
    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate this policy' }))
    expect(within(panel).getByRole('tabpanel', { name: 'Evaluate' })).toBe(evaluate)
    expect(within(panel).getByRole('tab', { name: 'Evaluate', selected: true })).toBeTruthy()
    expect(fixture.requests.slice(beforeReview)).toEqual([])
    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate trial' }))
    await within(panel).findByRole('heading', { name: 'Balance criteria failed' })
    await idle(panel)
    const firstEvidence = fixture.history()
    expect(firstEvidence.evaluations[0]).toMatchObject({ id: 'evaluation-1', policyId: 'run:fixture', passed: false,
      spec: { stepsPerEpisode: 200, seed: 17 }, episodes: [{ seed: 17, terminated: true }, { seed: 18, terminated: false }] })
    setValue(panel, 'Evaluation report', 'evaluation-1')
    within(panel).getByText('Mean available-episode joint tracking error: 14.3° · 2/2 episodes with tracking measurements')
    expect(firstEvidence.evaluations[0]?.observationProfile).toBe(firstEvidence.trials[0]?.run?.observationProfile)
    expect(firstEvidence.evaluations[0]?.physics.bam).toEqual(firstEvidence.trials[0]?.run?.provenance.bam)
    transcript.push(panelText(panel, 'Evaluate / first trial failed independently'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Re-simulate episode 1' }))
    await within(player).findByText('Evaluation episode · New re-simulation')
    await idle(panel)
    expect(fixture.requests.filter(item => item.request.operation === 'replay_evaluation').map(item => item.request))
      .toEqual([{ operation: 'replay_evaluation', evaluationId: 'evaluation-1', episodeIndex: 0 }])
    transcript.push(panelText(player, 'Evaluate / new simulation, not original evaluation frames'))
    setValue(panel, 'Observation', 'Episode 1 ended early; mean upright fraction was 60%.')
    setValue(panel, 'Interpretation', 'The target may be too fast for this quick-check policy.')
    setValue(panel, 'Next change', 'Reduce tempo to 100 BPM while preserving the motion blocks.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save reflection' }))
    await idle(panel)
    expect(fixture.history().reflections[0]).toMatchObject({ trialId: 'trial-1', evaluationId: 'evaluation-1',
      nextChange: 'Reduce tempo to 100 BPM while preserving the motion blocks.' })
    transcript.push(panelText(panel, 'Evaluate / persisted reflection on failed evidence'))
    const beforeImprovement = fixture.requests.length
    fireEvent.click(within(panel).getByRole('button', { name: 'Review improvement draft' }))
    await idle(panel)
    expect(within(panel).getByRole('tabpanel', { name: 'Train' })).toBe(train)
    expect(within(panel).getByRole('tab', { name: 'Train', selected: true })).toBeTruthy()
    expect(fixture.history().trials).toHaveLength(1)
    expect(fixture.requests.slice(beforeImprovement).some(item => item.request.operation === 'save_trial'
      || item.request.operation === 'train_trial' || item.request.operation === 'train')).toBe(false)
    transcript.push(panelText(panel, 'Training target / improvement draft does not train'))

    openDetails(panel, 'Training target')
    setValue(panel, 'Project name', '新节拍 🌙')
    setValue(panel, 'Tempo (BPM)', '100')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    openDetails(panel, 'Training target')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save revision' }))
    await idle(panel)
    transcript.push(panelText(panel, 'Training target / newer saved revision'))
    within(player).getByText('月光鸭 🦆 · frozen revision')
    within(player).getByText('120 BPM')

    within(player).getByText('0.100 m/s')
    within(player).getByText('11.5°/s')
    expect(within(player).queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(within(player).getByLabelText<HTMLSelectElement>('Replay speed').value).toBe('2')
    expect(within(player).getByLabelText<HTMLInputElement>('Performance time').max).toBe('3')
    setValue(player, 'Performance time', '2.5')
    transcript.push(panelText(player, 'Re-simulated episode / frozen identity after target edits'))
    selectTrainingTab(panel, 'Evaluate')
    openDetails(evaluate, 'Hardware deployment remains blocked')
    fireEvent.click(within(evaluate).getByRole('button', { name: 'Show deployment blockers' }))
    await within(evaluate).findByText('No hardware activation API.')
    transcript.push(panelText(evaluate, 'Evaluate / hardware remains blocked'))
    expect(within(evaluate).getByRole<HTMLButtonElement>('button', { name: 'Activate hardware (unavailable)' }).disabled).toBe(true)
    expect(fixture.requests.some(({ request }) => request.operation === 'simulate')).toBe(false)
    selectTrainingTab(panel, 'Train')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save and start trial' }))
    await idle(panel)
    expect(fixture.history().trials[1]?.trial.recipe).toMatchObject({ parentReflectionId: 'reflection-1',
      spec: { projectRevisionId: 'revision-2', clip: null },
      brief: { plannedChange: 'Reduce tempo to 100 BPM while preserving the motion blocks.' },
      evaluation: { stepsPerEpisode: 200, seed: 17 } })
    transcript.push(panelText(panel, 'Train / parent-linked second trial'))
    selectTrainingTab(panel, 'Evaluate')
    setValue(panel, 'Trained policy', 'run:fixture-child')
    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate trial' }))
    await within(panel).findByRole('heading', { name: 'Balance criteria passed' })
    await idle(panel)
    const secondEvidence = fixture.history()
    expect(secondEvidence.trials[0]).toEqual(firstEvidence.trials[0])
    expect(secondEvidence.evaluations[0]).toEqual(firstEvidence.evaluations[0])
    expect(secondEvidence.evaluations[1]).toMatchObject({ policyId: 'run:fixture-child', passed: true,
      spec: { stepsPerEpisode: 200, seed: 17 } })
    expect(secondEvidence.trials.map(entry => entry.run?.id)).toEqual(['fixture-run', 'fixture-child-run'])
    setValue(panel, 'Evaluation report', 'evaluation-2')
    setValue(panel, 'Baseline report', 'evaluation-1')
    within(panel).getByText('Matching assessment settings, observation semantics and frozen physics.')
    within(panel).getByText('Targets differ or are not linked; tracking errors are not directly comparable.')
    within(panel).getByText('Selected minus baseline upright fraction: 38.0 percentage points.')
    expect(within(panel).queryByText(/^Selected minus baseline tracking error:/)).toBeNull()
    expect(secondEvidence.trials[1]?.run?.sourceFingerprint).toBe(firstEvidence.trials[0]?.run?.sourceFingerprint)
    expect(secondEvidence.trials[1]?.run?.provenance.bridgeSha256).toBe(firstEvidence.trials[0]?.run?.provenance.bridgeSha256)
    expect(secondEvidence.trials[1]?.run?.provenance.dependencyVersions)
      .toEqual(firstEvidence.trials[0]?.run?.provenance.dependencyVersions)
    transcript.push(panelText(panel, 'Evaluate / two frozen reports compared without a winner'))
    const beforeRefresh = fixture.requests.length
    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh library' }))
    await idle(panel)
    expect(fixture.requests.slice(beforeRefresh).map(item => item.request.operation))
      .toEqual(['trials', 'evaluations', 'reflections', 'readiness', 'studio', 'projects', 'behaviors', 'policies', 'runs', 'scene'])
    expect(fixture.history()).toEqual(secondEvidence)
    setValue(panel, 'Trained policy', 'run:fixture')
    setValue(panel, 'Evaluation report', 'evaluation-1')
    await within(panel).findByRole('heading', { name: 'Balance criteria failed' })
    transcript.push(panelText(panel, 'Evaluate / persisted failed report and reflection after refresh'))
    fixture.publishExploratoryEvaluation()
    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh library' }))
    await idle(panel)
    setValue(panel, 'Trained policy', 'run:fixture-child')
    setValue(panel, 'Evaluation report', 'evaluation-exploratory')
    setValue(panel, 'Baseline report', 'evaluation-1')
    within(panel).getByText('Assessment criteria, seeds, or requested horizon differ.')
    within(panel).getByText('Not a like-for-like assessment.')
    within(panel).getByText('A reflection requires the exact report and frozen assessment recipe of a linked student trial.')
    expect(within(panel).getByLabelText('Observation').closest('fieldset')?.disabled).toBe(true)
    expect(within(panel).queryByText(/^Selected minus baseline upright fraction:/)).toBeNull()
    transcript.push(panelText(panel, 'Evaluate / different criteria prohibit like-for-like comparison'))
    expect(fixture.history().trials).toEqual(secondEvidence.trials)
    expect(fixture.history().evaluations.slice(0, 2)).toEqual(secondEvidence.evaluations)
    expect(fixture.requests.filter(item => item.request.operation === 'train_trial')).toHaveLength(2)
    expect(fixture.requests.some(item => item.request.operation === 'train')).toBe(false)
    expect(fixture.requests.every(item => item.sessionId === 'fx-alpha')).toBe(true)
    await golden('project-workflow', transcript)

    setValue(player, 'Duck 1 policy', 'run:fixture')
    fireEvent.click(within(player).getByRole('button', { name: '+ Add duck' }))
    setValue(player, 'Duck name', 'Partner 🦆')
    setValue(player, 'Duck 2 policy', 'run:fixture-child')
    setValue(player, 'Training project', 'revision-2')
    setValue(player, 'Formation', 'grid')
    setValue(player, 'Group recording steps', '200')
    const groupTranscript = [panelText(player, 'Group / two distinct policies')]
    const beforeGroup = fixture.requests.length
    fireEvent.click(within(player).getByRole('button', { name: 'Record group dance' }))
    await within(player).findByText('2 ducks · Independent group replay')
    await idle(panel)
    expect(fixture.requests.slice(beforeGroup).map(item => item.request)).toEqual([
      { operation: 'simulate', policyId: 'run:fixture', steps: 200, seed: 0, command: [0, 0, 0] },
      { operation: 'simulate', policyId: 'run:fixture-child', steps: 200, seed: 0, command: [0, 0, 0] },
    ])
    expect(within(player).getByLabelText<HTMLInputElement>('Performance time').max).toBe('3')
    setValue(player, 'Recorded duck', '2')
    groupTranscript.push(panelText(player, 'Group / frozen independent recordings'))
    fireEvent.click(within(player).getByRole('button', { name: 'Duplicate duck' }))
    await within(player).findByText(/Roster changed/)
    fireEvent.click(within(player).getByRole('button', { name: 'Remove duck' }))
    setValue(player, 'Duck name', 'Lead')
    groupTranscript.push(panelText(player, 'Group / edited roster leaves recording intact'))
    await golden('group-workflow', groupTranscript)
  }, 30_000)
})
