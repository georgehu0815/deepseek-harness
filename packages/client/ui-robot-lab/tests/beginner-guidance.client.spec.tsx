// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type { RobotTemplateId } from '@deepseek-ai/dsh-robot-lab/types'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { emptyLabSnapshot } from '../src/client/lab-client.ts'
import { en } from '../src/client/locales.ts'
import { fixtureProject, fixtureRunningRun, fixtureTemplate, fixtureUnavailableReadiness, readySnapshot } from './fixtures.client.ts'
import { brief, entry, trial } from './learning-fixtures.client.ts'
import { studioFixture } from './studio-fixtures.client.tsx'

afterEach(cleanup)

describe('beginner training and evaluation guidance', () => {
  it('explains each subtab without submitting work or inventing evidence', () => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    for (const [name, key] of [['Train', 'train'], ['Evaluate', 'evaluate']] as const) {
      fireEvent.click(view.getByRole('tab', { name: name === 'Train' ? /^Train$/ : /^Evaluate$/ }))
      const panel = within(view.getByRole('tabpanel', { name }))
      expect(panel.getByText(en[`guide.${key}`])).toBeTruthy()
      expect(panel.getByText(en[`guide.${key}Body`])).toBeTruthy()
    }
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.saveTrial).not.toHaveBeenCalled()
  })

  it('recommends only an installed Head Bob target and opens its draft', () => {
    const snapshot = readySnapshot()
    const headBob = { ...fixtureTemplate, id: 'head-bob' as RobotTemplateId, label: 'Head Bob' }
    snapshot.catalog = { ...snapshot.catalog!, templates: [fixtureTemplate, headBob] }
    const fixture = studioFixture(snapshot)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    const card = view.getByRole('button', { name: /Head Bob/ })
    expect(within(card).getByText('Suggested first target')).toBeTruthy()
    expect(within(view.getByRole('button', { name: /Gentle sway/ })).queryByText('Suggested first target')).toBeNull()
    fireEvent.click(card)
    expect(fixture.store.getSnapshot().dance?.templateId).toBe(headBob.id)
    expect(fixture.store.getSnapshot().page).toBe('customize')
    expect(fixture.saveProject).not.toHaveBeenCalled()
  })

  it('keeps connection recovery simple with optional raw diagnostics', () => {
    const snapshot = { ...emptyLabSnapshot(), readiness: fixtureUnavailableReadiness }
    const fixture = studioFixture(snapshot)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    expect(view.getByText(en['guide.readiness'])).toBeTruthy()
    const diagnostic = view.getByText('Setup diagnostic').closest('details')!
    expect(diagnostic.open).toBe(false)
    expect(within(diagnostic).getByText('Python backend missing')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Check connection' }))
    expect(fixture.refresh).toHaveBeenCalledOnce()
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('explains a missing brief on the start action and distinguishes a setup check', () => {
    const snapshot = readySnapshot()
    snapshot.projects = [fixtureProject]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.page('train')
    fixture.store.actions.steps(String(fixture.props.quickCheckSteps))
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const start = view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toBe(en['guide.trainBrief'])
    expect(view.getByText(en['guide.quickCheck'])).toBeTruthy()
    act(() => { fixture.store.actions.brief(brief) })
    expect(start.disabled).toBe(false)
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toBe(en['guide.trainReady'])
    fireEvent.click(start)
    expect(fixture.saveTrial).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ brief }), true)
  })

  it('keeps assessment tuning optional and leaves a selected saved trial immutable', () => {
    const snapshot = readySnapshot()
    snapshot.projects = [fixtureProject]
    snapshot.trials = [{ ...entry, binding: null, run: null }]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.page('train')
    fixture.store.actions.trial(trial.id)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const disclosure = view.getByText('Advanced: edit assessment criteria').closest('details')!
    expect(disclosure.open).toBe(false)
    expect(view.getAllByText('Assessment episodes')).toHaveLength(2)
    expect(view.getByText('Maximum early terminations')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Assessment episodes'), { target: { value: '3' } })
    expect(fixture.store.getSnapshot().assessment?.episodes).toBe(3)
    expect(view.getByText(/1 assessment episodes · 100 steps each/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Start saved trial' }))
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'train_trial', trialId: trial.id })
    expect(trial.recipe.evaluation.episodes).toBe(1)
  })

  it('distinguishes unsaved revisions and trials from browser authoring recovery without starting work', () => {
    const snapshot = readySnapshot()
    snapshot.projects = [fixtureProject]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.loadProject(fixtureProject)
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.queryByText(en['draft.unsaved'])).toBeNull()
    fireEvent.change(view.getByLabelText('Project name'), { target: { value: 'Unsaved routine' } })
    expect(view.getByText(en['draft.unsaved']).textContent).toContain('not a saved revision')
    expect(view.getByText(en['brief.unsaved']).textContent).toContain('not a saved trial')
    expect(view.getByText(en['draft.unsaved']).textContent).not.toMatch(/lost|lose|reload/i)
    expect(view.getByText(en['brief.unsaved']).textContent).not.toMatch(/lost|lose|reload/i)
    fireEvent.click(view.getByRole('button', { name: 'Save revision' }))
    expect(fixture.saveProject).toHaveBeenCalledExactlyOnceWith(
      fixture.store.getSnapshot().dance, fixture.store.getSnapshot().editVersion, false)
    expect(fixture.saveTrial).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('labels active progress as training rather than assessment and offers Stop', () => {
    const snapshot = readySnapshot()
    snapshot.runs = [fixtureRunningRun]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.page('train')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    expect(view.getByRole('heading', { name: 'Training progress · not assessment results' })).toBeTruthy()
    expect(view.getByText(en['guide.trainActive'])).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Stop training' }))
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'stop', runId: fixtureRunningRun.id })
  })
})
