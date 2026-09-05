// @vitest-environment jsdom
// Native built AppWebEntry/Loader/slot registrations run against the in-memory
// fixture transport. Only external Robot RPC replies are authored; jsdom does not
// validate rendered WebGL pixels or real MuJoCo/PPO outcomes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'
import { robotRpcFixture } from './snapshots/robot-studio/rpc-fixture.ts'

const SNAPSHOTS = join(process.cwd(), 'apps/web/tests/snapshots/robot-studio')
const PAGES = ['Choose', 'Customize', 'Train', 'Evaluate', 'Perform'] as const
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

/** Record native copy and form state, excluding CSS hashes and unrelated session history. */
function panelText(panel: HTMLElement, stage: string): string {
  const rows = [`[${stage}]`, `region=${panel.getAttribute('aria-label')}`]
  for (const element of panel.querySelectorAll('h1, h2, h3, strong, p, [role="status"], [role="alert"], label, button, small, summary, dt, dd, th, td')) {
    if (element instanceof HTMLButtonElement) {
      const pressed = element.hasAttribute('aria-pressed') ? ` pressed=${element.getAttribute('aria-pressed')}` : ''
      const current = element.hasAttribute('aria-current') ? ` current=${element.getAttribute('aria-current')}` : ''
      rows.push(`button=${text(element)} disabled=${element.disabled}${pressed}${current}`)
    } else if (element instanceof HTMLLabelElement) {
      const control = element.querySelector('input, select, textarea')
      const label = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
      rows.push(`label=${control?.getAttribute('aria-label') ?? label}`)
      if (control instanceof HTMLSelectElement) {
        rows.push(`select=${control.value} disabled=${control.disabled} options=${[...control.options].map(option => text(option)).join(' | ')}`)
      } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        const checked = control instanceof HTMLInputElement && control.type === 'checkbox' ? ` checked=${control.checked}` : ''
        rows.push(`input=${control.value} disabled=${control.disabled}${checked}`)
      }
    } else {
      rows.push(`${element.getAttribute('role') ?? element.tagName.toLowerCase()}=${text(element)}`)
    }
  }
  return rows.join('\n')
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
  fireEvent.click(await screen.findByRole('tab', { name: 'Micro Duck' }))
}

function page(panel: HTMLElement, name: typeof PAGES[number]): void {
  fireEvent.click(within(within(panel).getByRole('navigation', { name: 'Dance workflow' })).getByRole('button', { name: new RegExp(name) }))
}

function setValue(panel: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(panel).getByLabelText(label), { target: { value } })
}

async function idle(panel: HTMLElement): Promise<void> {
  await waitFor(() => { expect(within(panel).getByRole('status').textContent).toContain('Local robot lab connected') })
}

describe('assembled opt-in Micro Duck workflow', () => {
  it('guides a user with no session before mounting session-owned controls', async () => {
    mountAssembledApp('?fixture=empty', ['robot-lab'])
    const launcher = await screen.findByRole('button', { name: 'Robot Studio' }, { timeout: 10_000 })
    fireEvent.click(launcher)
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(player).getByRole('status').textContent).toBe('Select an existing session, or send your first message to create one.')
    expect(within(player).queryByLabelText('Visual surface')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Micro Duck control panel' })).toBeNull()
    await golden('no-session', [`launcher=${launcher.getAttribute('title')}`, panelText(player, 'No session')])
  }, 15_000)

  it('keeps native authoring and player controls honest when Robot RPC is unavailable', async () => {
    mountAssembledApp('?fixture', ['robot-lab'])
    await openSession()
    const panel = await screen.findByRole('region', { name: 'Micro Duck control panel' })
    await waitFor(() => {
      expect(within(panel).getByRole('alert').textContent).toBe(['trials', 'evaluations', 'reflections', 'readiness']
        .map(operation => `${operation}: client api: robotLab/request failed: fixture connection RPC endpoint "robotLab/request" is unavailable`).join('\n'))
      expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Check connection' }).disabled).toBe(false)
    })
    const workflow = within(panel).getByRole('navigation', { name: 'Dance workflow' })
    expect(within(workflow).getAllByRole('button').map(button => text(button).replace(/^\d/, ''))).toEqual(PAGES)
    fireEvent.click(within(panel).getByRole('button', { name: 'Open Studio ↗' }))
    const player = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(player).getByRole<HTMLButtonElement>('button', { name: 'Preview standing policy' }).disabled).toBe(true)
    expect(within(player).getByRole<HTMLButtonElement>('button', { name: 'Play recording' }).disabled).toBe(true)
    expect(within(player).getByRole('region', { name: 'Robot simulation stage' }).querySelector('canvas')).not.toBeNull()
    const transcript = [panelText(panel, 'Choose / unavailable'), panelText(player, 'Player / unavailable')]
    setValue(player, 'Visual surface', 'grass')
    setValue(player, 'Camera', 'top')
    fireEvent.click(within(player).getByRole('button', { name: 'Expand view' }))
    expect(within(player).getByRole('button', { name: 'Compact view' }).getAttribute('aria-pressed')).toBe('true')
    transcript.push(panelText(player, 'Player / visual preferences'))
    for (const stage of ['Customize', 'Train', 'Evaluate', 'Perform'] as const) {
      page(panel, stage)
      if (stage === 'Train') {
        expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
        setValue(panel, 'Training backend', 'mlx')
      }
      if (stage === 'Perform') expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Activate hardware (unavailable)' }).disabled).toBe(true)
      transcript.push(panelText(panel, `${stage} / unavailable`))
    }
    await golden('stage-unavailable', transcript)
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
    const transcript = [panelText(panel, 'Choose / connected')]
    fireEvent.click(within(panel).getByRole('button', { name: 'Open Studio ↗' }))
    const initialPlayer = await screen.findByRole('region', { name: 'Robot Studio player' })
    expect(within(initialPlayer).getByRole('region', { name: 'Robot simulation stage' }).querySelector('canvas')).not.toBeNull()
    expect(within(initialPlayer).getByRole<HTMLButtonElement>('button', { name: 'Play recording' }).disabled).toBe(true)
    expect(fixture.requests.some(({ request }) => request.operation === 'simulate' || request.operation === 'reference_preview')).toBe(false)
    transcript.push(panelText(initialPlayer, 'Player / default grid'))
    setValue(panel, 'Learning goal', 'Stay upright through the eight-beat routine.')
    setValue(panel, 'Prediction', 'The small routine will remain upright in both episodes.')
    setValue(panel, 'Planned change', 'Begin with a half-size groove and wave.')
    setValue(panel, 'Evidence to examine', 'Inspect terminations, upright fraction and joint tracking error.')
    transcript.push(panelText(panel, 'Choose / planned learning brief'))
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
    transcript.push(panelText(panel, 'Customize / ordered blocks and music'))
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
    transcript.push(panelText(panel, 'Customize / saved target'), panelText(player, 'Target / second block at 2×'))
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

    page(panel, 'Train')
    setValue(panel, 'Training backend', 'mlx')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    transcript.push(panelText(panel, 'Train / unavailable MLX'))
    setValue(panel, 'Training backend', 'cpu')
    setValue(panel, 'Practice budget', '1024')
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

    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate this policy' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate trial' }))
    await within(panel).findByRole('heading', { name: 'Needs more practice under these criteria' })
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
    expect(fixture.history().trials).toHaveLength(1)
    expect(fixture.requests.slice(beforeImprovement).some(item => item.request.operation === 'save_trial'
      || item.request.operation === 'train_trial' || item.request.operation === 'train')).toBe(false)
    transcript.push(panelText(panel, 'Customize / improvement draft does not train'))

    page(panel, 'Customize')
    setValue(panel, 'Project name', '新节拍 🌙')
    setValue(panel, 'Tempo (BPM)', '100')
    page(panel, 'Train')
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    page(panel, 'Customize')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save revision' }))
    await idle(panel)
    transcript.push(panelText(panel, 'Customize / newer saved revision'))
    within(player).getByText('月光鸭 🦆 · frozen revision')
    within(player).getByText('120 BPM')

    page(panel, 'Perform')
    within(panel).getByRole('heading', { name: '月光鸭 🦆' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Generate learned performance' }))
    await within(player).findByText('Recorded simulation · Not live hardware')
    await idle(panel)
    within(player).getByText('月光鸭 🦆 · frozen revision')
    within(player).getByText('120 BPM')
    within(player).getByText('0.100 m/s')
    within(player).getByText('11.5°/s')
    expect(within(player).queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(within(player).getByLabelText<HTMLSelectElement>('Replay speed').value).toBe('2')
    expect(within(player).getByLabelText<HTMLInputElement>('Performance time').max).toBe('3')
    setValue(player, 'Performance time', '2.5')
    transcript.push(panelText(panel, 'Perform / frozen run'), panelText(player, 'Recorded / measured physics and early termination'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Show deployment blockers' }))
    await within(panel).findByText('No hardware activation API.')
    transcript.push(panelText(panel, 'Perform / hardware remains blocked'))
    expect(within(panel).getByRole<HTMLButtonElement>('button', { name: 'Activate hardware (unavailable)' }).disabled).toBe(true)
    page(panel, 'Train')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save and start trial' }))
    await idle(panel)
    expect(fixture.history().trials[1]?.trial.recipe).toMatchObject({ parentReflectionId: 'reflection-1',
      spec: { projectRevisionId: 'revision-2', clip: null },
      brief: { plannedChange: 'Reduce tempo to 100 BPM while preserving the motion blocks.' },
      evaluation: { stepsPerEpisode: 200, seed: 17 } })
    transcript.push(panelText(panel, 'Train / parent-linked second trial'))
    page(panel, 'Evaluate')
    setValue(panel, 'Trained policy', 'run:fixture-child')
    fireEvent.click(within(panel).getByRole('button', { name: 'Evaluate trial' }))
    await within(panel).findByRole('heading', { name: 'Passed the recorded simulation criteria' })
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
    await within(panel).findByRole('heading', { name: 'Needs more practice under these criteria' })
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
