// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { selectAuthoringDraft } from '../src/client/draft-file.ts'
import { en, zh } from '../src/client/locales.ts'
import { studioFixture, pausedPlayback } from './studio-fixtures.client.tsx'
import { fixtureBlockProject, fixtureProject, fixtureRunningRun, fixtureSecondTemplate, readySnapshot } from './fixtures.client.ts'
import { brief } from './learning-fixtures.client.ts'

afterEach(cleanup)

describe('Micro Duck project and training controls', () => {
  it('keeps target authoring in a collapsed Train disclosure beside the Evaluate tab', () => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const train = within(view.getByRole('tabpanel', { name: 'Train' }))
    const target = train.getByText('Training target').closest('details')!
    expect(target.open).toBe(false)
    expect(train.getByRole('button', { name: 'Save and start trial' })).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Evaluate$/ }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(train.getByText('Training target'))
    expect(target.open).toBe(true)
    fireEvent.click(within(target).getByRole('button', { name: /Gentle sway/ }))
    fireEvent.change(within(target).getByLabelText('Project name'), { target: { value: 'Training target draft' } })
    expect(fixture.store.getSnapshot().dance?.name).toBe('Training target draft')
    fireEvent.click(train.getByText('Training target'))
    expect(target.open).toBe(false)
    expect(view.getByRole('tab', { name: /^Evaluate$/ }).getAttribute('aria-selected')).toBe('false')
    expect(train.getByLabelText('Learning goal')).toBeTruthy()
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.saveProject).not.toHaveBeenCalled()
  })

  it('edits the training budget, environments and seed before freezing a trial', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.projects = [fixtureProject]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.brief(brief)
    fixture.store.actions.page('train')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    fireEvent.click(view.getByText('Advanced training settings'))
    fireEvent.change(view.getByLabelText('Training steps'), { target: { value: '350' } })
    fireEvent.change(view.getByLabelText('Parallel environments'), { target: { value: '2' } })
    fireEvent.change(view.getByLabelText('Random seed'), { target: { value: '17' } })
    expect((view.getByLabelText('Practice budget') as HTMLSelectElement).value).toBe('350')
    expect(view.getByRole('option', { name: 'Custom · 350 steps' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Save trial' }))
    expect(fixture.saveTrial).toHaveBeenCalledTimes(1)
    const [recipe, start] = fixture.saveTrial.mock.calls[0]!
    expect(recipe.spec).toMatchObject({ steps: 350, envs: 2, seed: 17 })
    expect(start).toBe(false)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('trains an explicitly pasted custom clip with the selected reward terms without a saved project', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.behaviors[0]!.terms = [{ key: 'pose', label: 'Pose', weight: 2, penalty: false },
      { key: 'travel', label: 'Travel', weight: 1, penalty: false }]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.page('train')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    fireEvent.click(view.getByText('Advanced: custom joint experiment'))
    fireEvent.click(view.getByLabelText('Use a custom joint clip for training'))
    const copy = view.getByRole('button', { name: 'Copy saved target into editor' }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    fireEvent.click(copy)
    expect(fixture.store.getSnapshot().clipJson).toBe('')
    fireEvent.change(view.getByLabelText('Custom reward recipe'), { target: { value: 'imitate' } })
    fireEvent.change(view.getByLabelText('Custom experiment ID'), { target: { value: 'pasted-joint-clip' } })
    fireEvent.change(view.getByLabelText('Custom clip JSON'), { target: { value: JSON.stringify(fixtureProject.clip) } })
    expect(fixture.execute).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Start custom experiment' }))
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'train', spec: {
      name: 'pasted-joint-clip', behaviorId: 'imitate', backend: 'cpu', steps: 100, envs: 4, seed: 0,
      actuator: 'bam', weights: { pose: 2, travel: 1 }, clip: fixtureProject.clip,
    } })
    expect(fixture.saveTrial).not.toHaveBeenCalled()
  })

  it('keeps an explicit budget visible when its reward recipe is unavailable', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.behaviors = []
    const fixture = studioFixture(snapshot)
    fixture.store.actions.page('train')
    fixture.store.actions.steps('350')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.getByRole('option', { name: 'Custom · 350 steps' })).toBeTruthy()
    expect((view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens a completed run for review and preserves a failed run diagnostic verbatim', () => {
    const snapshot = structuredClone(readySnapshot())
    const policy = snapshot.policies[0]!
    snapshot.runs = [
      { ...fixtureRunningRun, state: 'completed', finishedAt: '2026-09-04T00:01:00.000Z',
        policyId: policy.id, policySha256: policy.sha256 },
      { ...fixtureRunningRun, id: 'failed-run' as typeof fixtureRunningRun.id, state: 'failed',
        finishedAt: '2026-09-04T00:02:00.000Z', error: 'Training process exited before export' },
    ]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.page('train')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.getByRole('alert').textContent).toBe('Training process exited before export')
    fireEvent.click(view.getByRole('button', { name: 'Review this run' }))
    expect(fixture.store.getSnapshot()).toMatchObject({ page: 'evaluate', policyId: policy.id })
    expect(view.getByRole('heading', { name: en['assessment.title'] })).toBeTruthy()
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('renders a matching frozen block target during playback and previews that same revision', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.catalog!.templates.push(fixtureSecondTemplate)
    snapshot.projects = [fixtureBlockProject]
    snapshot.recordingProject = fixtureBlockProject
    const fixture = studioFixture(snapshot, { ...pausedPlayback, time: 3, duration: 4 })
    fixture.store.actions.loadProject(fixtureBlockProject)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    const timeline = within(view.getByLabelText('Routine beat timeline'))
    expect(timeline.getByText('1–4')).toBeTruthy()
    expect(timeline.getByText('5–8')).toBeTruthy()
    expect(timeline.getByText(fixtureSecondTemplate.label)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Preview target in Studio' }))
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'reference_preview', projectRevisionId: fixtureBlockProject.id })
    expect(fixture.saveProject).not.toHaveBeenCalled()
  })

  it('shows an empty compatible template catalog and disables cards without a robot adapter', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.catalog!.profiles = []
    const fixture = studioFixture(snapshot)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    const choose = view.getByRole('button', { name: /Gentle sway/ }) as HTMLButtonElement
    expect(choose.disabled).toBe(true)
    fireEvent.click(choose)
    expect(fixture.store.getSnapshot().dance).toBeNull()
    snapshot.catalog!.templates = []
    view.rerender(<MicroDuckPanel {...fixture.props} />)
    expect(view.getByText('No compatible motion templates are installed.')).toBeTruthy()
  })

  it('converts an unsupported block length to the first installed block length', () => {
    const fixture = studioFixture()
    fixture.store.actions.loadProject(fixtureProject)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    fireEvent.change(view.getByLabelText('Length'), { target: { value: '32' } })
    fireEvent.click(view.getByRole('button', { name: 'Build with motion blocks' }))
    expect(fixture.store.getSnapshot().dance?.blocks).toEqual([{ templateId: fixtureProject.template.id,
      templateVersion: 1, beats: 4, moveSize: 1 }])
    expect((view.getByLabelText('Block 1 length') as HTMLSelectElement).value).toBe('4')
  })

  it.each([fixtureProject, fixtureBlockProject])('keeps restored editor data when the catalog cannot be loaded: $id', (project) => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.catalog = null
    const fixture = studioFixture(snapshot)
    fixture.store.actions.restoreAuthoring({ ...selectAuthoringDraft(fixture.store.getSnapshot()), dance: project.recipe })
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.getByText(en['draft.sourceMissing'])).toBeTruthy()
    expect((view.getByLabelText('Project name') as HTMLInputElement).value).toBe(project.recipe.name)
    for (const label of project.recipe.blocks === undefined ? ['Build with motion blocks'] : ['Use one template', 'Add a move']) {
      expect((view.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect((view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('leaves the authored draft intact when the saved-project or reward placeholder is chosen', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.projects = [fixtureProject]
    const fixture = studioFixture(snapshot)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    fireEvent.change(view.getByLabelText('Saved revision'), { target: { value: fixtureProject.id } })
    const before = fixture.store.getSnapshot().dance
    act(() => { fixture.store.actions.page('choose') })
    fireEvent.change(view.getByLabelText('Saved revision'), { target: { value: '' } })
    expect(fixture.store.getSnapshot().dance).toBe(before)
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    act(() => { fixture.store.actions.page('train'); fixture.store.actions.customTraining(true) })
    fireEvent.change(view.getByLabelText('Custom reward recipe'), { target: { value: '' } })
    expect(fixture.store.getSnapshot().dance).toBe(before)
    expect(fixture.execute).toHaveBeenCalledTimes(1)
  })

  it('refuses empty native selections without changing the authored block, music or backend', () => {
    const fixture = studioFixture()
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.blocks([{ templateId: fixtureProject.template.id, templateVersion: 1, beats: 4, moveSize: 1 }])
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    const before = fixture.store.getSnapshot()
    for (const label of ['Block 1 move', 'Music style']) {
      const select = view.getByLabelText(label) as HTMLSelectElement
      select.selectedIndex = -1
      expect(select.value).toBe('')
      fireEvent.change(select)
      expect(fixture.store.getSnapshot()).toBe(before)
    }
    act(() => { fixture.store.actions.page('train') })
    const training = fixture.store.getSnapshot()
    const backend = view.getByLabelText(en['backend.label']) as HTMLSelectElement
    backend.selectedIndex = -1
    fireEvent.change(backend)
    expect(fixture.store.getSnapshot()).toBe(training)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it.each([en, zh])('localizes budget options and labels the behavior default as unqualified', (dictionary) => {
    const fixture = studioFixture()
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.page('train')
    fixture.store.actions.steps('350')
    const view = render(<MicroDuckPanel {...fixture.props} t={key => dictionary[key as keyof typeof dictionary]} />)
    const budget = within(view.getByLabelText('Practice budget'))
    for (const [key, value] of [['budget.quick', 32], ['budget.default', 100], ['budget.longer', 200], ['budget.custom', 350]] as const) {
      expect(budget.getByRole('option', { name: `${dictionary[key]} · ${value} steps` })).toBeTruthy()
    }
    expect(view.queryByRole('option', { name: /Practice — recommended/ })).toBeNull()
  })

  it('shows generic progress while a group simulation owns the session operation', () => {
    const snapshot = structuredClone(readySnapshot())
    snapshot.busy = 'simulate_group'
    const fixture = studioFixture(snapshot)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.getByText('Working…').getAttribute('role')).toBe('status')
    expect((view.getByRole('button', { name: 'Refresh library' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
