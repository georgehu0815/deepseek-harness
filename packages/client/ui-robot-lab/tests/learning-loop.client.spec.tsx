// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MicroDuckProps } from '../src/client/studio-props.ts'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { createRobotStore } from '../src/client/store.ts'
import { assessmentSummary, compareAssessments, validAssessment } from '../src/client/evaluation-evidence.ts'
import { trialRecipe } from '../src/client/trial-draft.ts'
import { reviewEvidence } from '../src/client/review-evidence.ts'
import { studioFixture } from './studio-fixtures.tsx'
import { fixtureProject } from './fixtures.client.ts'
import { brief, trial, evaluation, reflection, entry, learningSnapshot } from './learning-fixtures.client.ts'

afterEach(cleanup)

function mount(page: 'train' | 'evaluate' | 'perform' = 'evaluate') {
  const snapshot = learningSnapshot()
  const fixture = studioFixture(snapshot)
  fixture.store.actions.loadProject(fixtureProject)
  fixture.store.actions.page(page)
  fixture.store.actions.policy(evaluation.policyId)
  fixture.store.actions.evaluation(evaluation.id)
  return { ...fixture, snapshot, ...render(<MicroDuckPanel {...fixture.props} />) }
}

describe('student learning loop', () => {
  it('renders only its authorized learning section with empty owner arguments', () => {
    const fixture = studioFixture()
    const renderSlot = vi.fn<MicroDuckProps['renderSlot']>(() => null)
    const view = render(<MicroDuckPanel {...fixture.props} renderSlot={renderSlot} />)
    expect(renderSlot).toHaveBeenLastCalledWith('conversation.micro-duck.learning-plan', {})
    expect(view.queryByLabelText('Learning goal')).toBeNull()
    act(() => { fixture.store.actions.page('evaluate') })
    expect(renderSlot).toHaveBeenLastCalledWith('conversation.micro-duck.learning-review', {})
    expect(view.queryByLabelText('Trained policy')).toBeNull()
  })

  it('requires a real plan and saves assessment inputs independently of exploratory duration', () => {
    const view = mount('train')
    const start = view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    for (const [label, value] of [['Learning goal', brief.goal], ['Prediction', brief.prediction],
      ['Planned change', brief.plannedChange], ['Evidence to examine', brief.evidence]]) {
      fireEvent.change(view.getByLabelText(label!), { target: { value } })
    }
    fireEvent.change(view.getByLabelText('Assessment seed'), { target: { value: '17' } })
    fireEvent.change(view.getByLabelText('Assessment horizon (steps)'), { target: { value: '125' } })
    act(() => { view.store.actions.simulationSteps(1500) })
    fireEvent.click(view.getByRole('button', { name: 'Save trial' }))
    const [savedRecipe, shouldStart] = view.saveTrial.mock.calls.at(-1)!
    expect(savedRecipe).toMatchObject({ brief, evaluation: { seed: 17, stepsPerEpisode: 125 },
      spec: { clip: null, projectRevisionId: fixtureProject.id } })
    expect(shouldStart).toBe(false)
    fireEvent.click(start)
    expect(view.saveTrial).toHaveBeenLastCalledWith(expect.anything(), true)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('shows frozen trial criteria and evaluates that trial rather than editable performance settings', () => {
    const view = mount()
    act(() => { view.store.actions.simulationSteps(1500); view.store.actions.assessment({ ...trial.recipe.evaluation, seed: 999 }) })
    expect(view.getByText(/Frozen assessment for trial trial-one/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Evaluate trial' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'evaluate_trial', trialId: trial.id })
    expect(view.queryByLabelText('Simulation duration')).toBeNull()
    expect(view.queryByLabelText('Assessment seed')).toBeNull()
  })

  it('edits independent exploratory criteria for an unlinked policy without changing frozen trials', () => {
    const view = mount()
    view.snapshot.trials = []
    view.rerender(<MicroDuckPanel {...view.props} />)
    fireEvent.click(view.getByText('Exploratory assessment settings'))
    fireEvent.change(view.getByLabelText('Assessment episodes'), { target: { value: '2' } })
    fireEvent.change(view.getByLabelText('Assessment horizon (steps)'), { target: { value: '125' } })
    fireEvent.change(view.getByLabelText('Assessment seed'), { target: { value: '41' } })
    fireEvent.change(view.getByLabelText('Maximum terminations'), { target: { value: '1' } })
    fireEvent.change(view.getByLabelText('Minimum mean upright fraction'), { target: { value: '0.8' } })
    act(() => { view.store.actions.simulationSteps(1500) })
    fireEvent.click(view.getByRole('button', { name: 'Check this policy' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'evaluate', spec: { policyId: evaluation.policyId,
      episodes: 2, stepsPerEpisode: 125, seed: 41, maxTerminations: 1, minMeanUprightFraction: 0.8 } })
    expect(trial.recipe.evaluation.seed).toBe(17)
    fireEvent.change(view.getByLabelText('Assessment episodes'), { target: { value: '0' } })
    expect((view.getByRole('button', { name: 'Check this policy' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('re-simulates failed episodes by report identity, without changing measured evidence or starting playback', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: 'Re-simulate episode 1' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
    expect(view.openStudio).toHaveBeenCalledOnce()
    expect(view.play).not.toHaveBeenCalled()
    expect(view.getByText('Needs more practice under these criteria')).toBeTruthy()
    expect(view.getByText(/not the original evaluation recording and does not change report metrics/)).toBeTruthy()
  })

  it('persists interpretation explicitly, then opens a saved reflection as an unsaved parent-linked draft', () => {
    const view = mount()
    for (const [label, value] of [['Observation', reflection.observation], ['Interpretation', reflection.interpretation],
      ['Next change', reflection.nextChange]]) fireEvent.change(view.getByLabelText(label!), { target: { value } })
    fireEvent.click(view.getByRole('button', { name: 'Save reflection' }))
    expect(view.saveReflection).toHaveBeenCalledExactlyOnceWith({ trialId: trial.id, evaluationId: evaluation.id,
      observation: reflection.observation, interpretation: reflection.interpretation, nextChange: reflection.nextChange })
    expect(view.reviewImprovement).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Review improvement draft' }))
    expect(view.reviewImprovement).toHaveBeenCalledExactlyOnceWith(reflection)
    act(() => { view.store.actions.improvement(fixtureProject, trial, reflection) })
    expect(view.store.getSnapshot()).toMatchObject({ page: 'customize', trialId: null, parentReflectionId: reflection.id,
      savedEditVersion: -1, brief: { ...brief, plannedChange: reflection.nextChange }, assessment: trial.recipe.evaluation })
    expect(view.getByText(/Unsaved changes must be reviewed and saved/)).toBeTruthy()
    expect(view.saveTrial).not.toHaveBeenCalled()
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('opens historical improvement without retaining an unrelated individual-duck training banner', () => {
    const view = mount()
    act(() => {
      view.store.actions.trainDuck(1, fixtureProject)
      view.store.actions.page('evaluate')
    })
    expect(view.getByText(/Individual training for/)).toBeTruthy()
    const members = view.store.getSnapshot().ducks
    act(() => { view.store.actions.improvement(fixtureProject, trial, reflection) })
    expect(view.queryByText(/Individual training for/)).toBeNull()
    expect(view.store.getSnapshot()).toMatchObject({ trainingDuck: null, parentReflectionId: reflection.id, ducks: members })
    expect(view.execute).not.toHaveBeenCalled()
    expect(view.saveTrial).not.toHaveBeenCalled()
  })

  it('does not borrow replay eligibility from a different policy with identical bytes', () => {
    const view = mount()
    const other = { ...view.snapshot.policies[0]!, id: 'run:other' as typeof evaluation.policyId,
      runId: 'other-run' as typeof reflection.runId }
    view.snapshot.policies.push(other)
    act(() => { view.store.actions.policy(other.id); view.store.actions.evaluation(evaluation.id) })
    expect(view.getByText(/Matching current executable policy metadata is unavailable/)).toBeTruthy()
    const replay = view.getByRole('button', { name: 'Re-simulate episode 1' }) as HTMLButtonElement
    expect(replay.disabled).toBe(true)
    fireEvent.click(replay)
    expect(view.execute).not.toHaveBeenCalled()
    act(() => { view.store.actions.policy(evaluation.policyId); view.store.actions.evaluation(evaluation.id) })
    expect(view.queryByText(/Matching current executable policy metadata is unavailable/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Re-simulate episode 1' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
  })

  it('keeps historical evidence and reflection inspectable without runtime readiness', () => {
    const view = mount()
    view.snapshot.readiness = null
    view.snapshot.policies = []
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect(view.getByText(/Matching current executable policy metadata is unavailable/)).toBeTruthy()
    expect(view.getByText('Needs more practice under these criteria')).toBeTruthy()
    expect((view.getByRole('button', { name: 'Re-simulate episode 1' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: 'Review improvement draft' }) as HTMLButtonElement).disabled).toBe(false)
    expect((view.getByRole('button', { name: 'Activate hardware (unavailable)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains shipped-policy replay denial without disabling exploratory performance', () => {
    const view = mount('perform')
    view.snapshot.policies = view.snapshot.policies.map(policy => ({ ...policy, runId: null }))
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect((view.getByRole('button', { name: 'Re-simulate episode 1' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.getByText(/Shipped policies have no owned run/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Re-simulate episode 1' }))
    expect(view.execute).not.toHaveBeenCalled()
    expect((view.getByRole('button', { name: 'Generate learned performance' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('labels tracking means with the number of measured episodes', () => {
    const view = mount()
    view.snapshot.evaluations = [{ ...evaluation, spec: { ...evaluation.spec, episodes: 2 },
      episodes: [...evaluation.episodes, { ...evaluation.episodes[0]!, seed: 18, poseRmse: null }] }]
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect(view.getByText(/Mean available-episode joint tracking error:.*1\/2 episodes with tracking measurements/)).toBeTruthy()
  })

  it('compares explicit reports with criteria mismatches instead of declaring improvement', () => {
    const view = mount()
    const other = { ...evaluation, id: 'baseline' as typeof evaluation.id, spec: { ...evaluation.spec, seed: 55 } }
    view.snapshot.evaluations.push(other)
    view.rerender(<MicroDuckPanel {...view.props} />)
    fireEvent.change(view.getByLabelText('Baseline report'), { target: { value: other.id } })
    expect(view.getByText('Not a like-for-like assessment.')).toBeTruthy()
    expect(view.queryByText(/Selected minus baseline upright fraction/)).toBeNull()
    expect(view.getByRole('article', { name: 'Baseline evidence' })).toBeTruthy()
  })
})

describe('learning evidence projections', () => {
  it('does not average missing tracking measurements as zero', () => {
    expect(assessmentSummary({ ...evaluation, episodes: [{ ...evaluation.episodes[0]!, poseRmse: null }] }).poseDegrees).toBeNull()
    expect(assessmentSummary(evaluation).terminations).toBe(1)
  })

  it('qualifies changed targets and learners and omits tracking deltas for a different target', () => {
    const run = entry.run!
    const otherRun = { ...run, spec: { ...run.spec, backend: 'mlx' as const, steps: 200, seed: 1, envs: 8, weights: { pose: 3 },
      projectSnapshot: { ...fixtureProject, sha256: 'different-target' } } }
    const compared = compareAssessments(evaluation, evaluation, run, otherRun)
    expect(compared.likeForLike).toBe(true)
    expect(compared.poseDelta).toBeNull()
    expect(compared.differences).toHaveLength(6)
    expect(compareAssessments(evaluation, evaluation, run, run).poseDelta).toBe(0)
    expect(compareAssessments(evaluation, evaluation).differences).toContain('Complete training provenance is not loaded for both reports.')
  })

  it.each([{ seed: -1 }, { episodes: 0 }, { stepsPerEpisode: 0 }, { maxTerminations: 2 }, { minMeanUprightFraction: 2 },
    { seed: 2147483647 }])('rejects invalid criteria %j', (change) => {
    expect(validAssessment({ ...trial.recipe.evaluation, ...change })).toBe(false)
  })

  it.each([{ episodes: 2 }, { stepsPerEpisode: 125 }, { seed: 41 }, { maxTerminations: 1 }, { minMeanUprightFraction: 0.8 }])(
    'suppresses comparison deltas when assessment settings differ: %j', (change) => {
      const compared = compareAssessments(evaluation, { ...evaluation, spec: { ...evaluation.spec, ...change } }, entry.run!, entry.run!)
      expect(compared.likeForLike).toBe(false)
      expect(compared.uprightDelta).toBeNull()
      expect(compared.poseDelta).toBeNull()
      expect(compared.differences).toContain('Assessment criteria, seeds, or requested horizon differ.')
    })

  it.each([{ source: 'different-source' }, { sha256: 'different-hash' }, { parameters: { kt: 0.4 } }])(
    'suppresses comparison deltas when frozen BAM physics differ: %j', (change) => {
      const compared = compareAssessments(evaluation, { ...evaluation,
        physics: { ...evaluation.physics, bam: { ...evaluation.physics.bam, ...change } } }, entry.run!, entry.run!)
      expect(compared.likeForLike).toBe(false)
      expect(compared.uprightDelta).toBeNull()
      expect(compared.poseDelta).toBeNull()
      expect(compared.differences).toContain('Frozen assessment physics differ.')
    })

  it('suppresses deltas across different observation semantics', () => {
    const compared = compareAssessments(evaluation, { ...evaluation, observationProfile: 'microduck-standard-61' }, entry.run!, entry.run!)
    expect(compared.likeForLike).toBe(false)
    expect(compared.uprightDelta).toBeNull()
    expect(compared.poseDelta).toBeNull()
    expect(compared.differences).toContain('Observation semantics differ.')
  })

  it.each([
    { ...evaluation, spec: { ...evaluation.spec, seed: 41 } },
    { ...evaluation, observationProfile: 'microduck-standard-61' as const },
    { ...evaluation, physics: { ...evaluation.physics, bam: { ...evaluation.physics.bam, sha256: 'different-bam' } } },
  ])('refuses reflection when report criteria or semantics differ from its trial/run', (report) => {
    const snapshot = learningSnapshot()
    snapshot.evaluations = [report]
    const store = createRobotStore().create()
    store.actions.policy(evaluation.policyId); store.actions.evaluation(evaluation.id)
    expect(reviewEvidence(snapshot, store.getSnapshot()).canReflect).toBe(false)
  })

  it('qualifies runtime-source and training-actuator differences', () => {
    const run = entry.run!
    const changed = { ...run, sourceFingerprint: 'different-source', spec: { ...run.spec, actuator: 'xml' as const } }
    const compared = compareAssessments(evaluation, evaluation, run, changed)
    expect(compared.likeForLike).toBe(false)
    expect(compared.uprightDelta).toBeNull()
    expect(compared.poseDelta).toBeNull()
    expect(compared.differences).toContain('Frozen runtime source fingerprints differ.')
    expect(compared.differences).toContain('Training actuator models differ.')
    expect(compareAssessments(evaluation, evaluation).likeForLike).toBe(false)
  })

  it.each(['mujoco', 'onnxruntime', 'numpy', 'numba'])('withholds comparison across different %s runtime versions', (dependency) => {
    const run = entry.run!
    const changed = { ...run, provenance: { ...run.provenance,
      dependencyVersions: { ...run.provenance.dependencyVersions, [dependency]: 'different-version' } } }
    const compared = compareAssessments(evaluation, evaluation, run, changed)
    expect(compared).toMatchObject({ likeForLike: false, uprightDelta: null, poseDelta: null })
    expect(compared.differences).toContain('Frozen evaluation runtime versions differ.')
  })

  it('withholds comparison across bridge changes or unavailable provenance', () => {
    const run = entry.run!
    const changed = { ...run, provenance: { ...run.provenance, bridgeSha256: 'different-bridge' } }
    const compared = compareAssessments(evaluation, evaluation, run, changed)
    expect(compared).toMatchObject({ likeForLike: false, uprightDelta: null, poseDelta: null })
    expect(compared.differences).toContain('Frozen evaluation bridges differ.')
    for (const [left, right] of [[undefined, run], [run, undefined], [undefined, undefined]]) {
      expect(compareAssessments(evaluation, evaluation, left, right)).toMatchObject({
        likeForLike: false, uprightDelta: null, poseDelta: null,
      })
    }
  })

  it('keeps trainer devices and dependencies separate from the evaluation runtime', () => {
    const run = entry.run!
    const changed = { ...run, spec: { ...run.spec, backend: 'mlx' as const }, provenance: { ...run.provenance,
      environment: { ...run.provenance.environment, updateDevice: 'metal' as const },
      trainer: { ...run.provenance.trainer, backend: 'mlx' as const, learnerDevice: 'metal' as const, dependencyVersions: { mlx: '0.30' } } } }
    const compared = compareAssessments(evaluation, evaluation, run, changed)
    expect(compared).toMatchObject({ likeForLike: true, uprightDelta: 0, poseDelta: 0 })
    expect(compared.differences).toEqual(['Training learners differ.', 'Training learner devices differ.', 'Training learner dependencies differ.'])
  })

  it('compares tracking only across the same measured episode cohort, not equal sample counts', () => {
    const episode = evaluation.episodes[0]!
    const left = { ...evaluation, spec: { ...evaluation.spec, episodes: 2 },
      episodes: [episode, { ...episode, seed: 18, poseRmse: null }] }
    const matching = { ...left, episodes: [{ ...episode, poseRmse: 0.4 }, { ...episode, seed: 18, poseRmse: null }] }
    const different = { ...left, episodes: [{ ...episode, poseRmse: null }, { ...episode, seed: 18, poseRmse: 0.4 }] }
    const full = { ...left, episodes: [episode, { ...episode, seed: 18 }] }
    expect(assessmentSummary(left)).toMatchObject({ trackingEpisodes: 1, episodeCount: 2 })
    expect(compareAssessments(left, matching, entry.run!, entry.run!).poseDelta).toBeCloseTo(0.2 * 180 / Math.PI)
    for (const right of [different, full]) {
      const compared = compareAssessments(left, right, entry.run!, entry.run!)
      expect(compared).toMatchObject({ likeForLike: true, uprightDelta: 0, poseDelta: null })
      expect(compared.differences).toContain('Tracking measurements cover different episode cohorts; tracking-error deltas are withheld.')
    }
  })

  it('refuses dirty project admissions and selects only exact policy evidence', () => {
    const snapshot = learningSnapshot()
    const store = createRobotStore().create()
    store.actions.loadProject(fixtureProject); store.actions.brief(brief)
    const behavior = snapshot.behaviors[0]
    expect(trialRecipe(store.getSnapshot(), undefined, behavior, trial.recipe.evaluation)).toBeNull()
    expect(trialRecipe(store.getSnapshot(), fixtureProject, behavior, trial.recipe.evaluation)?.spec.clip).toBeNull()
    store.actions.policy(evaluation.policyId)
    snapshot.evaluation = { ...evaluation, policyHash: 'different-bytes' }
    expect(reviewEvidence(snapshot, store.getSnapshot()).report).toBeNull()
    store.actions.evaluation(evaluation.id)
    expect(reviewEvidence(snapshot, store.getSnapshot()).report).toBe(evaluation)
  })
})
