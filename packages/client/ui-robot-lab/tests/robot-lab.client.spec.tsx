// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type { RobotEvaluationId } from '@deepseek-ai/dsh-robot-lab/types'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { emptyLabSnapshot } from '../src/client/lab-client.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'
import { fixtureIncompatibleRuns, fixturePhysics, fixtureProject, fixtureRunningRun, readySnapshot } from './fixtures.client.ts'
import { studioFixture } from './studio-fixtures.client.tsx'
import { brief } from './learning-fixtures.client.ts'

afterEach(cleanup)

function mount(snapshot: LabSnapshot = readySnapshot(), saved = false) {
  const fixture = studioFixture(snapshot)
  fixture.store.actions.brief(brief)
  if (saved) {
    snapshot.projects = [fixtureProject]
    fixture.store.actions.loadProject(fixtureProject)
  }
  const view = render(<MicroDuckPanel {...fixture.props} />)
  fireEvent.click(view.getByText('Training target'))
  return { ...fixture, ...view }
}

function expectEnglishPresentation(container: HTMLElement) {
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u)
  for (const element of container.querySelectorAll('[aria-label], [title], [placeholder]')) {
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      expect(element.getAttribute(attribute) ?? '').not.toMatch(/\p{Script=Han}/u)
    }
  }
}

describe('Micro Duck beginner workflow', () => {
  it('preserves authored blocks, disclosure and scroll across tab switches', () => {
    const view = mount(readySnapshot(), true)
    const panel = view.getByRole('region', { name: 'Micro Duck control panel' })
    expect(panel.hasAttribute('data-conversation-composer-overlay')).toBe(true)
    panel.scrollTop = 480
    fireEvent.change(view.getByLabelText('Project name'), { target: { value: 'Edited routine' } })
    expect(panel.scrollTop).toBe(480)
    fireEvent.click(view.getByRole('button', { name: 'Build with motion blocks' }))
    expect(panel.scrollTop).toBe(480)
    fireEvent.click(view.getByRole('button', { name: 'Add a move' }))
    expect(panel.scrollTop).toBe(480)
    fireEvent.change(view.getByLabelText('Block 2 length'), { target: { value: '8' } })
    fireEvent.change(view.getByLabelText('Block 2 move size'), { target: { value: '0.5' } })
    expect(panel.scrollTop).toBe(480)
    const trainPanel = view.getByRole('tabpanel', { name: 'Train' })
    const body = trainPanel.lastElementChild!
    body.scrollTop = 240
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    expect(view.queryByRole('tabpanel', { name: 'Train' })).toBeNull()
    expect(within(view.getByRole('tabpanel', { name: 'Evaluate' })).getByLabelText('Trained policy')).toBeTruthy()
    expect(trainPanel.hidden).toBe(true)
    fireEvent.click(view.getByRole('tab', { name: /^Train$/ }))
    expect(view.getByRole('tabpanel', { name: 'Train' })).toBe(trainPanel)
    expect(body.scrollTop).toBe(240)
    expect(view.getByText('Training target').closest('details')!.open).toBe(true)
    expect(panel.scrollTop).toBe(480)
    expect(view.execute).not.toHaveBeenCalled()
    expect(view.queryByRole('navigation', { name: 'Dance workflow' })).toBeNull()
    expect(view.queryByRole('button', { name: /^Next:/ })).toBeNull()
    expect((view.getByLabelText('Block 2 move size') as HTMLInputElement).value).toBe('0.5')
  })

  it('supports roving keyboard focus and links tabs to their panels', () => {
    const view = mount()
    const tabs = within(view.getByRole('tablist', { name: 'Training and evaluation' }))
    const train = tabs.getByRole('tab', { name: /^Train$/ })
    const evaluate = tabs.getByRole('tab', { name: /^Evaluate$/ })
    expect(train.tabIndex).toBe(0)
    expect(evaluate.tabIndex).toBe(-1)
    expect(view.getByRole('tabpanel', { name: 'Train' }).id).toBe(train.getAttribute('aria-controls'))
    train.focus()
    fireEvent.keyDown(train, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(evaluate)
    expect(evaluate.getAttribute('aria-selected')).toBe('true')
    expect(evaluate.tabIndex).toBe(0)
    expect(train.tabIndex).toBe(-1)
    expect(view.getByRole('tabpanel', { name: 'Evaluate' }).id).toBe(evaluate.getAttribute('aria-controls'))
    fireEvent.keyDown(evaluate, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(train)
    fireEvent.keyDown(train, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(evaluate)
    fireEvent.keyDown(evaluate, { key: 'Home' })
    expect(document.activeElement).toBe(train)
    fireEvent.keyDown(train, { key: 'End' })
    expect(document.activeElement).toBe(evaluate)
    fireEvent.keyDown(evaluate, { key: 'Escape' })
    expect(evaluate.getAttribute('aria-selected')).toBe('true')
    expect(view.execute).not.toHaveBeenCalled()
    expect(view.refresh).not.toHaveBeenCalled()
    expect(view.saveTrial).not.toHaveBeenCalled()
  })

  it('explains disconnected state and cannot submit training', () => {
    const view = mount(emptyLabSnapshot())
    expect(view.getByText('Connect the local robot lab to begin').getAttribute('role')).toBe('status')
    fireEvent.click(view.getByRole('button', { name: 'Check connection' }))
    expect(view.refresh).toHaveBeenCalledOnce()
    expect((view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('chooses an authored target, customizes beat-aligned music, then saves or previews the captured draft', () => {
    const view = mount()
    expect(view.getByRole('heading', { name: 'Micro Duck', level: 1 })).toBeTruthy()
    expect(view.getByText(/Every card is an authored target, not a pre-trained skill/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /Gentle sway/ }))
    expect(view.store.getSnapshot().page).toBe('customize')
    fireEvent.change(view.getByLabelText('Project name'), { target: { value: 'My dance' } })
    fireEvent.change(view.getByLabelText('Tempo (BPM)'), { target: { value: '100' } })
    fireEvent.change(view.getByLabelText('Length'), { target: { value: '16' } })
    fireEvent.change(view.getByLabelText('Move size'), { target: { value: '0.5' } })
    fireEvent.change(view.getByLabelText('Music style'), { target: { value: 'chiptune' } })
    fireEvent.click(view.getByRole('button', { name: 'Try another variation' }))
    const state = view.store.getSnapshot()
    expect(state.dance).toMatchObject({ name: 'My dance', parameters: { bpm: 100, beats: 16, moveSize: 0.5 },
      music: { bpm: 100, beats: 16, style: 'chiptune', seed: 1 } })
    fireEvent.click(view.getByRole('button', { name: 'Generate music (WAV)' }))
    expect(view.downloadMusic).toHaveBeenCalledExactlyOnceWith(state.dance!.music)
    fireEvent.click(view.getByRole('button', { name: 'Save revision' }))
    expect(view.saveProject).toHaveBeenLastCalledWith(state.dance, state.editVersion, false)
    fireEvent.click(view.getByRole('button', { name: 'Preview target in Studio' }))
    expect(view.saveProject).toHaveBeenLastCalledWith(state.dance, state.editVersion, true)
    expect(view.execute).not.toHaveBeenCalled()
    expect(view.getByText(/Target preview uses forward kinematics/)).toBeTruthy()
    expectEnglishPresentation(view.container)
  })

  it.each(['0', '200', 'NaN'])('blocks saving a draft with invalid tempo %s', (tempo) => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /Gentle sway/ }))
    fireEvent.change(view.getByLabelText('Tempo (BPM)'), { target: { value: tempo } })
    const save = view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(view.saveProject).not.toHaveBeenCalled()
  })

  it('loads a saved revision and keeps user-authored names unchanged', () => {
    const snapshot = readySnapshot()
    snapshot.projects = [{ ...fixtureProject, recipe: { ...fixtureProject.recipe, name: '我的舞蹈' } }]
    const view = mount(snapshot)
    fireEvent.change(view.getByLabelText('Saved revision'), { target: { value: fixtureProject.id } })
    expect((view.getByLabelText('Project name') as HTMLInputElement).value).toBe('我的舞蹈')
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'project', projectRevisionId: fixtureProject.id })
    expect(view.getByLabelText('Saved revision')).toBeTruthy()
    expect(view.queryByText('Unsaved changes')).toBeNull()
  })

  it('replays an unchanged saved revision without creating another revision and refreshes connected libraries', () => {
    const view = mount(readySnapshot(), true)
    fireEvent.click(view.getByRole('button', { name: 'Refresh library' }))
    expect(view.refresh).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Preview target in Studio' }))
    expect(view.openStudio).toHaveBeenCalledOnce()
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'reference_preview', projectRevisionId: fixtureProject.id })
    expect(view.saveProject).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Project name'), { target: { value: 'A newer draft' } })
    fireEvent.click(view.getByRole('button', { name: 'Preview target in Studio' }))
    expect(view.saveProject).toHaveBeenCalledExactlyOnceWith(view.store.getSnapshot().dance, view.store.getSnapshot().editVersion, true)
    expect(view.execute).toHaveBeenCalledTimes(1)
  })

  it('uses the whole frozen composition behavior and overrides instead of the first block or current catalog', () => {
    const firstBlock = { ...fixtureProject.template, behaviorId: 'stand', trainingWeights: { travel: 99 } }
    const project = { ...fixtureProject, template: firstBlock,
      blocks: [{ template: firstBlock, beats: 4, moveSize: 0.25 }, { template: fixtureProject.template, beats: 4, moveSize: 0.25 }],
      training: { behaviorId: 'imitate', weights: { travel: 0, rhythm: 3 } } }
    const snapshot = readySnapshot()
    snapshot.projects = [project]
    snapshot.catalog = { ...snapshot.catalog!, templates: snapshot.catalog!.templates.map(item => ({
      ...item, behaviorId: 'catalog-other', trainingWeights: { travel: 100 },
    })) }
    snapshot.behaviors = [
      { id: 'imitate', label: 'Frozen composition reward', description: 'Track all blocks', defaultSteps: 120,
        terms: [{ key: 'travel', label: 'Travel', weight: 1, penalty: false },
          { key: 'pose', label: 'Pose', weight: 2, penalty: false }] },
      { id: 'stand', label: 'First block only', description: 'Standing', defaultSteps: 80, terms: [] },
      { id: 'catalog-other', label: 'New catalog reward', description: 'New recipe', defaultSteps: 999, terms: [] },
    ]
    const view = mount(snapshot)
    act(() => { view.store.actions.loadProject(project); view.store.actions.page('train') })
    fireEvent.click(view.getByRole('button', { name: 'Save and start trial' }))
    expect(view.saveTrial).toHaveBeenCalledExactlyOnceWith({ spec: {
      projectRevisionId: project.id, name: `project-${project.id}`, behaviorId: 'imitate', backend: 'cpu',
      steps: 120, envs: 4, seed: 0, actuator: 'bam', weights: { travel: 0, pose: 2, rhythm: 3 }, clip: null,
    }, brief, evaluation: view.props.evaluation, parentReflectionId: null }, true)
  })

  it.each(['cpu', 'mlx', 'rlx'] as const)('submits the frozen project with explicit %s learner selection', (backend) => {
    const snapshot = readySnapshot()
    snapshot.readiness!.backends[backend] = { available: true, reason: null,
      learnerDevice: backend === 'cpu' ? 'cpu' : 'metal', physicsDevice: 'cpu', versions: {} }
    const view = mount(snapshot, true)
    expect((view.getByLabelText('Training backend') as HTMLSelectElement).value).toBe('cpu')
    fireEvent.change(view.getByLabelText('Training backend'), { target: { value: backend } })
    if (backend === 'mlx') expect(view.getByText(/DSH MLX PPO: Apple Metal trains the policy and critic/)).toBeTruthy()
    else if (backend === 'rlx') expect(view.getByText(/RLX PPO trains the policy and critic on Apple Metal/)).toBeTruthy()
    else expect(view.getByText(/Stable-Baselines3 PPO learning/)).toBeTruthy()
    fireEvent.change(view.getByLabelText('Practice budget'), { target: { value: '32' } })
    fireEvent.click(view.getByRole('button', { name: 'Save and start trial' }))
    expect(view.saveTrial).toHaveBeenCalledExactlyOnceWith({ spec: {
      projectRevisionId: fixtureProject.id, name: `project-${fixtureProject.id}`, behaviorId: 'imitate', backend,
      steps: 32, envs: 4, seed: 0, actuator: 'bam', weights: {}, clip: null,
    }, brief, evaluation: view.props.evaluation, parentReflectionId: null }, true)
    expect(view.getByText(/Training completion is not skill completion/)).toBeTruthy()
  })

  it('keeps custom joint training explicitly separate from the saved project and its music', () => {
    const view = mount(readySnapshot(), true)
    fireEvent.click(view.getByText('Advanced: custom joint experiment'))
    fireEvent.click(view.getByLabelText('Use a custom joint clip for training'))
    expect(view.getByText('Custom joint experiment · not linked to your project or its soundtrack')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Custom experiment ID'), { target: { value: 'custom-sway' } })
    fireEvent.change(view.getByLabelText('Custom reward recipe'), { target: { value: 'imitate' } })
    expect((view.getByRole('button', { name: 'Start custom experiment' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Copy saved target into editor' }))
    const authored = { ...fixtureProject.clip, keys: fixtureProject.clip.keys.map(key => ({ ...key, rootPitch: 0.1 })) }
    fireEvent.change(view.getByLabelText('Custom clip JSON'), { target: { value: JSON.stringify(authored) } })
    fireEvent.click(view.getByRole('button', { name: 'Start custom experiment' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'train', spec: {
      name: 'custom-sway', behaviorId: 'imitate', backend: 'cpu', steps: 100, envs: 4, seed: 0,
      actuator: 'bam', weights: {}, clip: authored,
    } })
    expect(view.store.getSnapshot().dance).toMatchObject({ ...fixtureProject.recipe, projectId: fixtureProject.projectId })
    expect(fixtureProject.clip.keys[0]!.rootPitch).toBe(0)
    fireEvent.change(view.getByLabelText('Custom clip JSON'), { target: { value: '{' } })
    expect((view.getByRole('button', { name: 'Start custom experiment' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.getByRole('alert')).toBeTruthy()
    fireEvent.click(view.getByLabelText('Use a custom joint clip for training'))
    expect((view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('connects the numeric joint editor to custom JSON and submits only the edited clip', () => {
    const snapshot = readySnapshot()
    snapshot.scene = { bodies: [], meshes: [], geoms: [], defaultJoints: Array<number>(14).fill(0),
      jointNames: ['Left hip'] }
    const view = mount(snapshot, true)
    fireEvent.click(view.getByText('Advanced: custom joint experiment'))
    fireEvent.click(view.getByLabelText('Use a custom joint clip for training'))
    fireEvent.change(view.getByLabelText('Custom reward recipe'), { target: { value: 'imitate' } })
    fireEvent.click(view.getByRole('button', { name: 'Copy saved target into editor' }))
    fireEvent.change(view.getByLabelText('Current keyframe'), { target: { value: '1' } })
    fireEvent.change(view.getByLabelText('Left hip'), { target: { value: '0.25' } })
    fireEvent.click(view.getByRole('button', { name: 'Start custom experiment' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'train', spec: {
      name: 'duck-groove', behaviorId: 'imitate', backend: 'cpu', steps: 100, envs: 4, seed: 0, actuator: 'bam', weights: {},
      clip: { ...fixtureProject.clip, keys: [fixtureProject.clip.keys[0], {
        ...fixtureProject.clip.keys[1], joints: [0.25, ...Array<number>(13).fill(0)],
      }] },
    } })
    expect((view.getByLabelText('Custom clip JSON') as HTMLTextAreaElement).value).toContain('0.25')
    expect(fixtureProject.clip.keys[1]!.joints[0]).toBe(0)
    fireEvent.change(view.getByLabelText('Custom experiment ID'), { target: { value: '   ' } })
    expect((view.getByRole('button', { name: 'Start custom experiment' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('preserves a Unicode project label while using the stable ASCII training identifier', () => {
    const project = { ...fixtureProject, recipe: { ...fixtureProject.recipe, name: '我的小鸭舞蹈' },
      clip: { ...fixtureProject.clip, name: '我的小鸭舞蹈' } }
    const snapshot = readySnapshot()
    snapshot.projects = [project]
    snapshot.runs = [{ ...fixtureRunningRun, state: 'completed', policyId: snapshot.policies[0]!.id,
      policySha256: snapshot.policies[0]!.sha256, spec: { ...fixtureRunningRun.spec, projectSnapshot: project } }]
    const view = mount(snapshot)
    act(() => { view.store.actions.loadProject(project) })
    expect((view.getByLabelText('Project name') as HTMLInputElement).value).toBe(project.recipe.name)
    fireEvent.click(view.getByRole('button', { name: 'Save and start trial' }))
    expect(view.saveTrial).toHaveBeenCalledExactlyOnceWith({ spec: {
      projectRevisionId: project.id, name: `project-${project.id}`, behaviorId: 'imitate', backend: 'cpu',
      steps: 100, envs: 4, seed: 0, actuator: 'bam', weights: {}, clip: null,
    }, brief, evaluation: view.props.evaluation, parentReflectionId: null }, true)
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    fireEvent.change(view.getByLabelText('Trained policy'), { target: { value: 'policy-one' } })
    expect(view.getByRole('heading', { name: project.recipe.name })).toBeTruthy()
  })

  it('keeps the selected policy frozen target separate from current authoring edits', () => {
    const snapshot = readySnapshot()
    const frozen = { ...fixtureProject, clip: { ...fixtureProject.clip, duration: 12 } }
    snapshot.runs = [{ ...fixtureRunningRun, state: 'completed', policyId: snapshot.policies[0]!.id,
      policySha256: snapshot.policies[0]!.sha256,
      spec: { ...fixtureRunningRun.spec, projectSnapshot: frozen } }]
    const view = mount(snapshot, true)
    act(() => { view.store.actions.parameters({ bpm: 60, beats: 32 }) })
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    fireEvent.change(view.getByLabelText('Trained policy'), { target: { value: 'policy-one' } })
    expect(view.getByRole('heading', { name: frozen.recipe.name })).toBeTruthy()
    expect(view.store.getSnapshot().dance?.parameters).toMatchObject({ bpm: 60, beats: 32 })
    expect(view.queryByLabelText('Simulation duration')).toBeNull()
    expect(view.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
    expect(view.execute).not.toHaveBeenCalled()
  })

  it.each(['mlx', 'rlx'] as const)('keeps unavailable %s selected without falling back to CPU', (backend) => {
    const view = mount(readySnapshot(), true)
    fireEvent.change(view.getByLabelText('Training backend'), { target: { value: backend } })
    expect(view.getByText(`${backend.toUpperCase()} unavailable`)).toBeTruthy()
    const start = view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(view.store.getSnapshot().trainingBackend).toBe(backend)
    expect((view.getByLabelText('Training backend') as HTMLSelectElement).value).toBe(backend)
    expect(view.execute).not.toHaveBeenCalled()
    expect(view.saveTrial).not.toHaveBeenCalled()
  })

  it.each([
    ['cpu', 'SB3 PPO learner · CPU learning · CPU physics'],
    ['mlx', 'DSH MLX PPO learner · Apple GPU learning · CPU physics'],
    ['rlx', 'RLX PPO learner · Apple GPU learning · CPU physics'],
  ] as const)('labels the recorded %s learner without inferring CPU from an unknown GPU identity', (backend, label) => {
    const snapshot = readySnapshot()
    snapshot.runs = [{ ...fixtureRunningRun, spec: { ...fixtureRunningRun.spec, backend } }]
    const view = mount(snapshot)
    expect(view.getByText(label)).toBeTruthy()
    expect(view.getByRole('option', { name: 'RLX PPO — Apple GPU (CPU physics)' })).toBeTruthy()
    expect(view.getByRole('option', { name: 'DSH MLX PPO — Apple GPU (CPU physics)' })).toBeTruthy()
  })

  it.each(['no readiness', 'not ready', 'training unavailable', 'unsaved edit', 'missing behavior', 'running', 'starting', 'busy'])
  ('prevents training with %s', (blocker) => {
    const snapshot: LabSnapshot = readySnapshot()
    if (blocker === 'no readiness') snapshot.readiness = null
    if (blocker === 'not ready') snapshot.readiness!.ready = false
    if (blocker === 'training unavailable') snapshot.readiness!.capabilities.train.available = false
    if (blocker === 'missing behavior') snapshot.behaviors = []
    if (blocker === 'running' || blocker === 'starting') snapshot.runs = [{ ...fixtureRunningRun, state: blocker }]
    if (blocker === 'busy') snapshot.busy = 'refresh'
    const view = mount(snapshot, true)
    if (blocker === 'unsaved edit') fireEvent.change(view.getByLabelText('Project name'), { target: { value: 'Edited' } })
    const start = view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(view.execute).not.toHaveBeenCalled()
    if (['running', 'starting', 'busy'].includes(blocker)) {
      expect((view.getByLabelText('Training backend') as HTMLSelectElement).disabled).toBe(true)
    }
  })

  it('keeps unsupported records separate while stopping only the session-owned active run', () => {
    const snapshot = readySnapshot()
    snapshot.runs = [{ ...fixtureRunningRun, progress: { steps: 20, total: 100, elapsedSeconds: 1.5, reward: 1 } }]
    snapshot.incompatibleRuns = fixtureIncompatibleRuns
    const view = mount(snapshot, true)
    expect(view.getByText('Unsupported run records (2)')).toBeTruthy()
    for (const item of fixtureIncompatibleRuns) expect(view.getByText(`${item.id}: ${item.reason}`)).toBeTruthy()
    expect(view.getByRole('progressbar').getAttribute('value')).toBe('20')
    expect(view.getByText(/13 training steps\/s \(average\)/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Stop training' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'stop', runId: fixtureRunningRun.id })
  })

  it('requests evaluation without performance generation or hardware activation', () => {
    const view = mount()
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    fireEvent.change(view.getByLabelText('Trained policy'), { target: { value: 'policy-one' } })
    expect(view.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
    expect(view.openStudio).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Check this policy' }))
    expect(view.execute).toHaveBeenLastCalledWith({ operation: 'evaluate', spec: { ...view.props.evaluation,
      policyId: 'policy-one', stepsPerEpisode: 1000 } })
    const details = view.getByText('Hardware deployment remains blocked').closest('details')!
    fireEvent.click(within(details).getByText('Hardware deployment remains blocked'))
    const activation = within(details).getByRole('button', { name: 'Activate hardware (unavailable)' }) as HTMLButtonElement
    expect(activation.disabled).toBe(true)
    fireEvent.click(within(details).getByRole('button', { name: 'Show deployment blockers' }))
    expect(view.execute).toHaveBeenLastCalledWith({ operation: 'prepare', policyId: 'policy-one' })
  })

  it.each(['no readiness', 'not ready', 'unavailable', 'busy'])('blocks evaluation when %s', (blocker) => {
    const snapshot = readySnapshot()
    if (blocker === 'no readiness') snapshot.readiness = null
    if (blocker === 'not ready') snapshot.readiness!.ready = false
    if (blocker === 'unavailable') {
      snapshot.readiness!.capabilities.simulate.available = false
      snapshot.readiness!.capabilities.evaluate.available = false
    }
    if (blocker === 'busy') snapshot.busy = 'refresh'
    const view = mount(snapshot)
    act(() => { view.store.actions.page('perform'); view.store.actions.policy(snapshot.policies[0]!.id) })
    expect(view.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
    expect((view.getByRole('button', { name: 'Check this policy' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('keeps incompatible policies inspectable but disables execution', () => {
    const snapshot = readySnapshot()
    snapshot.policies[0]!.runtimeCompatibility = { available: false, reason: 'Frozen runtime differs' }
    const view = mount(snapshot)
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    fireEvent.change(view.getByLabelText('Trained policy'), { target: { value: 'policy-one' } })
    expect(view.getByText('Frozen runtime differs')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
    expect((view.getByRole('button', { name: 'Check this policy' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it.each([false, true])('qualifies a matching verdict and hides stale policy evidence, passed=%s', (passed) => {
    const snapshot: LabSnapshot = readySnapshot()
    snapshot.evaluation = { id: 'eval-one' as RobotEvaluationId, createdAt: '2026-09-04', evaluatedAt: '2026-09-04',
      policyId: snapshot.policies[0]!.id, policyHash: snapshot.policies[0]!.sha256, physics: fixturePhysics,
      observationProfile: 'microduck-lab-body-phase-61', passed, limitations: ['Simulation only'],
      spec: { policyId: snapshot.policies[0]!.id, episodes: 1, stepsPerEpisode: 100, seed: 0,
        maxTerminations: 0, minMeanUprightFraction: 0.9 },
      episodes: [{ seed: 0, steps: 100, terminated: false, reward: 1, uprightFraction: 0.95, poseRmse: 0.1, bamSettings: {} }] }
    const view = mount(snapshot)
    act(() => { view.store.actions.page('perform'); view.store.actions.policy(snapshot.policies[0]!.id) })
    const title = passed ? 'Balance criteria passed' : 'Balance criteria failed'
    expect(view.getByRole('heading', { name: title })).toBeTruthy()
    expect(view.getByText('95.0%')).toBeTruthy()
    expect(view.getByText(/Standing upright does not by itself prove choreography completion/)).toBeTruthy()
    snapshot.evaluation = { ...snapshot.evaluation, policyHash: 'other-bytes' }
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect(view.queryByText(title)).toBeNull()
  })

  it('presents every beginner page in English and preserves backend diagnostics verbatim', () => {
    const snapshot: LabSnapshot = readySnapshot()
    const view = mount(snapshot, true)
    for (const page of ['choose', 'customize', 'train', 'evaluate', 'perform'] as const) {
      act(() => { view.store.actions.page(page) })
      expectEnglishPresentation(view.container)
    }
    snapshot.error = '后端诊断'
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect(view.getByRole('alert').textContent).toBe('后端诊断')
  })
})
