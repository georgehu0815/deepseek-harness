// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LearningPlan } from '../src/client/LearningPlan.tsx'
import { LearningReview } from '../src/client/LearningReview.tsx'
import { en, zh } from '../src/client/locales.ts'
import { studioFixture } from './studio-fixtures.client.tsx'
import { readySnapshot } from './fixtures.client.ts'
import { binding, evaluation, learningSnapshot, reflection, trial } from './learning-fixtures.client.ts'

const fixtures: ReturnType<typeof studioFixture>[] = []
afterEach(() => {
  cleanup()
  for (const fixture of fixtures.splice(0)) fixture.store.dispose()
})

function fixture(snapshot = learningSnapshot(), messages: Record<keyof typeof en, string> = en) {
  const result = studioFixture(snapshot, undefined, messages)
  fixtures.push(result)
  return { ...result, snapshot }
}

describe('localized learning controls', () => {
  it.each([{ locale: 'English', messages: en, trialPrefix: 'Trial' }, { locale: 'Chinese', messages: zh, trialPrefix: '试验' }])(
    'renders $locale controls while preserving saved identities and student text', ({ messages, trialPrefix }) => {
      const view = fixture(learningSnapshot(), messages)
      view.store.actions.page('train')
      const plan = render(<LearningPlan {...view.props} />)
      fireEvent.change(plan.getByLabelText(messages['plan.goal']), { target: { value: 'My goal · 我的目标' } })
      expect(view.store.getSnapshot().brief.goal).toBe('My goal · 我的目标')
      fireEvent.change(plan.getByLabelText(messages['plan.savedTrial']), { target: { value: trial.id } })
      expect(plan.getByText(`${trialPrefix} ${trial.id} · SHA-256 ${trial.sha256}`)).toBeTruthy()
      expect(plan.getByRole('option', { name: new RegExp(trial.recipe.brief.goal) })).toBeTruthy()
      fireEvent.click(plan.getByRole('button', { name: messages['plan.evaluatePolicy'] }))
      expect(view.store.getSnapshot()).toMatchObject({ policyId: evaluation.policyId, page: 'evaluate' })
      plan.unmount()
      const review = render(<LearningReview {...view.props} />)
      fireEvent.change(review.getByLabelText(messages['review.evaluationReport']), { target: { value: evaluation.id } })
      expect(review.getByRole('article', { name: messages['review.selectedEvidence'] })).toBeTruthy()
      expect(review.getByRole('button', { name: messages['review.evaluateTrial'] })).toBeTruthy()
      expect(review.getByText(reflection.nextChange)).toBeTruthy()
      expect(review.container.textContent).toContain(evaluation.id)
      expect(review.container.textContent).toContain(evaluation.policyHash)
      expect(review.container.textContent).not.toMatch(/\{(?:id|hash|episodes|steps|firstSeed|lastSeed)\}/)
      fireEvent.click(review.getByRole('button', { name: messages['review.evaluateTrial'] }))
      expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'evaluate_trial', trialId: trial.id })
      if (messages === zh) {
        expect(review.queryByLabelText('Trained policy')).toBeNull()
        expect(review.queryByRole('button', { name: 'Evaluate trial' })).toBeNull()
      }
    })
})

describe('saved trial selection', () => {
  it.each(['choose', 'customize', 'train', 'evaluate', 'perform'] as const)(
    'keeps the complete learning plan available for legacy page %s', (page) => {
      const view = fixture()
      view.store.actions.page(page)
      const ui = render(<LearningPlan {...view.props} />)
      const brief = ui.getByLabelText('Learning goal').closest('details')!
      expect(brief.open).toBe(false)
      fireEvent.click(ui.getByText(en['plan.briefTitle']))
      expect(brief.open).toBe(true)
      expect(ui.getByText(en['plan.assessmentTitle'])).toBeTruthy()
      expect(ui.getByLabelText('Assessment seed')).toBeTruthy()
      expect(ui.getByLabelText('Saved trial')).toBeTruthy()
      expect(view.execute).not.toHaveBeenCalled()
    })

  it('opens an immutable completed trial and moves its exact policy to Evaluate', () => {
    const view = fixture()
    view.store.actions.page('train')
    view.store.actions.evaluation(evaluation.id)
    const ui = render(<LearningPlan {...view.props} />)
    fireEvent.change(ui.getByLabelText('Saved trial'), { target: { value: '' } })
    expect(view.store.getSnapshot().trialId).toBeNull()
    fireEvent.change(ui.getByLabelText('Saved trial'), { target: { value: trial.id } })
    expect(view.store.getSnapshot()).toMatchObject({ trialId: trial.id, evaluationId: null })
    expect(ui.getByText(/This trial cannot start a second run/)).toBeTruthy()
    expect(ui.queryByRole('button', { name: 'Start saved trial' })).toBeNull()
    fireEvent.click(ui.getByRole('button', { name: 'Evaluate this policy' }))
    expect(view.store.getSnapshot()).toMatchObject({ page: 'evaluate', policyId: evaluation.policyId })
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('preserves the binding when a saved trial run is unavailable and permits inspecting the empty picker', () => {
    const view = fixture()
    view.snapshot.trials = [{ trial, binding, run: null }]
    view.snapshot.runs = []
    view.store.actions.page('train')
    const ui = render(<LearningPlan {...view.props} />)
    expect(ui.getByRole('option', { name: /run unavailable/ })).toBeTruthy()
    fireEvent.change(ui.getByLabelText('Saved trial'), { target: { value: trial.id } })
    expect(ui.getByText(/Run unavailable/)).toBeTruthy()
    expect(ui.queryByRole('button', { name: 'Start saved trial' })).toBeNull()
    expect(ui.queryByRole('button', { name: 'Evaluate this policy' })).toBeNull()
    fireEvent.change(ui.getByLabelText('Saved trial'), { target: { value: '' } })
    expect(view.store.getSnapshot().trialId).toBe(trial.id)
    expect(view.execute).not.toHaveBeenCalled()
  })
})

describe('learning review user interactions', () => {
  it('selects completed evidence and a baseline, reports like-for-like deltas, and clears the baseline', () => {
    const view = fixture()
    const baseline = { ...evaluation, id: 'baseline-report' as typeof evaluation.id, passed: true,
      episodes: [{ ...evaluation.episodes[0]!, uprightFraction: 1, poseRmse: 0.1, terminated: false }] }
    view.snapshot.evaluations.push(baseline)
    view.snapshot.incompleteEvaluations = 2
    view.store.actions.page('evaluate')
    const ui = render(<LearningReview {...view.props} />)
    fireEvent.change(ui.getByLabelText('Trained policy'), { target: { value: '' } })
    expect(view.store.getSnapshot().policyId).toBeNull()
    fireEvent.change(ui.getByLabelText('Evaluation report'), { target: { value: '' } })
    expect(view.store.getSnapshot().evaluationId).toBeNull()
    fireEvent.change(ui.getByLabelText('Evaluation report'), { target: { value: evaluation.id } })
    expect(view.store.getSnapshot()).toMatchObject({ policyId: evaluation.policyId, evaluationId: evaluation.id })
    expect(ui.getByText('2 incomplete assessment admissions are not completed reports.')).toBeTruthy()
    fireEvent.change(ui.getByLabelText('Baseline report'), { target: { value: baseline.id } })
    expect(ui.getByText('Matching assessment settings, observation semantics and frozen physics.')).toBeTruthy()
    expect(ui.getByText('Selected minus baseline upright fraction: -30.0 percentage points.')).toBeTruthy()
    expect(ui.getByText('Selected minus baseline tracking error: 5.7°.')).toBeTruthy()
    expect(ui.getByRole('article', { name: 'Baseline evidence' })).toBeTruthy()
    fireEvent.change(ui.getByLabelText('Baseline report'), { target: { value: '' } })
    expect(view.store.getSnapshot().baselineId).toBeNull()
    expect(ui.queryByRole('article', { name: 'Baseline evidence' })).toBeNull()
    expect(ui.queryByRole('heading', { name: 'Descriptive trial comparison' })).toBeNull()
    expect(view.execute).not.toHaveBeenCalled()
  })

  it.each(['choose', 'customize', 'train', 'evaluate', 'perform'] as const)(
    'shows frozen evaluation instead of performance controls for legacy page %s', (page) => {
      const view = fixture()
      view.store.actions.page(page)
      view.store.actions.policy(evaluation.policyId)
      view.store.actions.simulationSteps(500)
      const ui = render(<LearningReview {...view.props} />)
      expect(ui.getByRole('heading', { name: en['assessment.title'] })).toBeTruthy()
      expect(ui.queryByLabelText('Simulation duration')).toBeNull()
      expect(ui.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
      expect(ui.queryByRole('button', { name: 'Observe and improve in Evaluate' })).toBeNull()
      fireEvent.click(ui.getByRole('button', { name: 'Evaluate trial' }))
      expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'evaluate_trial', trialId: trial.id })
      expect(view.openStudio).not.toHaveBeenCalled()
      expect(view.play).not.toHaveBeenCalled()
      expect(view.store.getSnapshot()).toMatchObject({ page, simulationSteps: 500 })
      expect(trial.recipe.evaluation.stepsPerEpisode).toBe(100)
    })

  it('saves a complete interpretation and queries blockers without activating hardware', () => {
    const view = fixture()
    view.snapshot.deploymentReasons = ['Prototype policies cannot activate hardware.', 'No physical deployment target is configured.']
    view.store.actions.page('evaluate')
    view.store.actions.policy(evaluation.policyId)
    view.store.actions.evaluation(evaluation.id)
    const ui = render(<LearningReview {...view.props} />)
    const save = ui.getByRole('button', { name: 'Save reflection' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(ui.getByLabelText('Observation'), { target: { value: reflection.observation } })
    fireEvent.change(ui.getByLabelText('Interpretation'), { target: { value: reflection.interpretation } })
    fireEvent.change(ui.getByLabelText('Next change'), { target: { value: '  ' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(ui.getByLabelText('Next change'), { target: { value: reflection.nextChange } })
    fireEvent.click(save)
    expect(view.saveReflection).toHaveBeenCalledExactlyOnceWith({ trialId: trial.id, evaluationId: evaluation.id,
      observation: reflection.observation, interpretation: reflection.interpretation, nextChange: reflection.nextChange })
    fireEvent.click(ui.getByText('Hardware deployment remains blocked'))
    fireEvent.click(ui.getByRole('button', { name: 'Show deployment blockers' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'prepare', policyId: evaluation.policyId })
    for (const reason of view.snapshot.deploymentReasons) expect(ui.getByText(reason)).toBeTruthy()
    const activate = ui.getByRole('button', { name: 'Activate hardware (unavailable)' }) as HTMLButtonElement
    expect(activate.disabled).toBe(true)
    fireEvent.click(activate)
    expect(view.execute).toHaveBeenCalledOnce()
  })

  it('evaluates a policy without a saved project and disables assessment while busy', () => {
    const view = fixture(readySnapshot())
    view.store.actions.page('perform')
    const ui = render(<LearningReview {...view.props} />)
    fireEvent.change(ui.getByLabelText('Trained policy'), { target: { value: evaluation.policyId } })
    fireEvent.click(ui.getByRole('button', { name: 'Check this policy' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'evaluate',
      spec: { ...view.props.evaluation, policyId: evaluation.policyId } })
    view.snapshot.busy = 'evaluate'
    ui.rerender(<LearningReview {...view.props} />)
    expect((ui.getByLabelText('Trained policy') as HTMLSelectElement).disabled).toBe(true)
    expect((ui.getByRole('button', { name: 'Check this policy' }) as HTMLButtonElement).disabled).toBe(true)
    expect(ui.queryByRole('button', { name: 'Generate learned performance' })).toBeNull()
  })
})
