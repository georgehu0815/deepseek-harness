// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { LearningReview } from '../src/client/LearningReview.tsx'
import { DanceEvidence } from '../src/client/DanceEvidence.tsx'
import { compareAssessments, sameAssessment } from '../src/client/evaluation-evidence.ts'
import { reviewEvidence } from '../src/client/review-evidence.ts'
import { en, zh } from '../src/client/locales.ts'
import { studioFixture } from './studio-fixtures.client.tsx'
import { danceReport, partialV2DanceReport } from './dance-fixtures.client.ts'
import { entry, evaluation, learningSnapshot } from './learning-fixtures.client.ts'
import type { RobotEvaluation } from '@deepseek-ai/dsh-robot-lab/types'

const t = (key: string) => en[key as keyof typeof en]
afterEach(cleanup)

function mount(report: RobotEvaluation) {
  const snapshot = learningSnapshot()
  snapshot.evaluations = [report]
  const fixture = studioFixture(snapshot)
  fixture.store.actions.page('evaluate')
  fixture.store.actions.policy(report.policyId)
  fixture.store.actions.evaluation(report.id)
  return { ...fixture, ...render(<LearningReview {...fixture.props} />) }
}

function openCycle(view: ReturnType<typeof render>, status: string, cycle: number) {
  const region = within(view.getByRole('region', { name: 'Choreography assessment' }))
  fireEvent.click(region.getByText(`Episode 1 · ${status}`))
  const summary = region.getByText(`Cycle ${cycle} · ${status}`)
  fireEvent.click(summary)
  return within(summary.parentElement!)
}

describe('recorded choreography evidence', () => {
  it('labels old balance reports as choreography-unassessed', () => {
    const view = mount(evaluation)
    const selected = within(view.getByRole('article', { name: 'Selected evidence' }))
    expect(selected.getByRole('heading', { name: 'Balance criteria failed' })).toBeTruthy()
    expect(selected.getByText(en['dance.unassessed'])).toBeTruthy()
    expect(selected.getByText(en['assessment.balanceOnly'])).toBeTruthy()
    expect(selected.queryByText(en['dance.passed'])).toBeNull()
  })

  it('keeps a passing balance verdict distinct from a failed completed choreography', () => {
    const report = danceReport()
    const view = mount(report)
    expect(view.getByRole('heading', { name: 'Balance criteria passed' })).toBeTruthy()
    expect(view.getByText('Choreography criteria failed', { selector: 'strong' })).toBeTruthy()
    expect(view.getByText(/these fragment failures alone do not prove a whole-window violation/)).toBeTruthy()
    expect(view.queryByText(en['dance.scopeV2'])).toBeNull()
    expect(view.queryByText(en['dance.boundExplanation'])).toBeNull()
    expect(view.getByText(/Frozen choreography plan SHA-256: 4444/)).toBeTruthy()
    expect(view.getByText(/Simulator minus authored cycle duration \(s\): 0.001000/)).toBeTruthy()
    const cycle = openCycle(view, 'Choreography criteria failed', 2)
    expect(view.getByText(/Elapsed\/requested reference cycles: 2\/2/)).toBeTruthy()
    expect(cycle.getAllByText(/Finite measurements\/expected control steps: 50\/50/)).toHaveLength(1)
    expect(cycle.getAllByText(/Largest joint RMSE \(rad\): 0.0200/)).toHaveLength(3)
    expect(cycle.getAllByText('reference-gain')).toHaveLength(2)
    const joints = cycle.getAllByText('Per-joint measurements')[0]!
    fireEvent.click(joints)
    const table = within(joints.parentElement!).getByRole('table')
    expect(within(table).getByRole('row', { name: /joint-1 / }).textContent).toContain('-0.2000')
    expect(within(table).getByRole('row', { name: /joint-2 / }).textContent).toBe('joint-20.0200Not recordedNot recorded')
    const block = cycle.getByText('Authored block 1 · Choreography criteria passed').parentElement!
    fireEvent.click(within(block).getByText('Authored block 1 · Choreography criteria passed'))
    fireEvent.click(within(block).getByText('Per-joint measurements'))
    expect(within(block).getByRole('row', { name: /joint-1 / }).textContent).toContain('Not assessed for this joint')
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('keeps v2 fragment RMSE above the limit incomplete and labels cycle/block bounds as derived', () => {
    const report = partialV2DanceReport()
    const before = structuredClone(report)
    const view = mount(report)
    expect(view.getByText(en['dance.scopeV2'])).toBeTruthy()
    expect(view.queryByText(en['dance.scope'])).toBeNull()
    const criteria = view.getByText(en['dance.frozenCriteria'])
    fireEvent.click(criteria)
    expect(within(criteria.parentElement!).getByText(/Maximum root orientation RMSE \(rad\): 0.2/)).toBeTruthy()
    const cycle = openCycle(view, 'Choreography assessment incomplete', 1)
    expect(view.getByText(/Elapsed\/requested reference cycles: 1\/1/)).toBeTruthy()
    expect(cycle.getByText(/Finite measurements\/expected control steps: 1\/100/)).toBeTruthy()
    expect(cycle.getByText('Largest derived joint RMSE lower bound (rad): 0.0300 · Derived root RMSE lower bound (rad): 0.0300')).toBeTruthy()
    const first = cycle.getByText('Authored block 1 · Choreography assessment incomplete')
    fireEvent.click(first)
    const block = within(first.parentElement!)
    expect(block.getByText(en['dance.observedSamples'])).toBeTruthy()
    expect(block.getByText(en['dance.boundExplanation'])).toBeTruthy()
    expect(block.getByText(/Largest joint RMSE \(rad\): 0.3000 · Root orientation RMSE \(rad\): 0.3000/)).toBeTruthy()
    expect(block.getByText('Largest derived joint RMSE lower bound (rad): 0.0424 · Derived root RMSE lower bound (rad): 0.0424')).toBeTruthy()
    const absent = cycle.getByText('Authored block 2 · Choreography assessment incomplete')
    fireEvent.click(absent)
    expect(within(absent.parentElement!).getByText('Largest derived joint RMSE lower bound (rad): Not recorded · Derived root RMSE lower bound (rad): Not recorded')).toBeTruthy()
    expect(view.getByText('Choreography assessment incomplete', { selector: 'strong' })).toBeTruthy()
    expect(report).toEqual(before)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('localizes v2 partial-coverage semantics and derived bounds without changing measurements', () => {
    const report = partialV2DanceReport()
    const view = render(<DanceEvidence report={report} t={key => zh[key as keyof typeof zh]} />)
    expect(view.getByText(zh['dance.scopeV2'])).toBeTruthy()
    fireEvent.click(view.getByText(`${zh['dance.episode']} 1 · ${zh['dance.incomplete']}`))
    fireEvent.click(view.getByText(`${zh['dance.cycle']} 1 · ${zh['dance.incomplete']}`))
    expect(view.getAllByText(zh['dance.observedSamples'])).toHaveLength(3)
    expect(view.getAllByText(zh['dance.boundExplanation'])).toHaveLength(3)
    expect(view.getByText(`${zh['dance.jointBound']}: 0.0300 · ${zh['dance.rootBound']}: 0.0300`)).toBeTruthy()
  })

  it('treats otherwise identical v1 and v2 criteria as different assessments', () => {
    const current = partialV2DanceReport().spec
    const legacy = { ...current, dance: { ...current.dance!, version: 1 as const } }
    expect(sameAssessment(current, current)).toBe(true)
    expect(sameAssessment(current, legacy)).toBe(false)
    expect(sameAssessment(legacy, current)).toBe(false)
  })

  it('shows the frozen experimental limits without adopting later editor settings', () => {
    const report = danceReport()
    const view = mount(report)
    act(() => { view.store.actions.assessment({ ...report.dancePlan!.evaluation,
      dance: { ...report.dancePlan!.evaluation.dance, maxJointRmseRad: Array<number>(14).fill(9),
        maxRootOrientationRmseRad: 9, maxHorizontalDriftMeters: 9 } }) })
    const summary = view.getByText(en['dance.frozenCriteria'])
    fireEvent.click(summary)
    const frozen = within(summary.parentElement!)
    expect(frozen.getByText(/Required consecutive cycles: 2/)).toBeTruthy()
    expect(frozen.getByText(/Minimum passing episode fraction: 1/)).toBeTruthy()
    expect(frozen.getByText(/Maximum root orientation RMSE \(rad\): 0.1/)).toBeTruthy()
    expect(frozen.getByText(/Maximum horizontal displacement \(m\): 0.1/)).toBeTruthy()
    expect(frozen.getByText(/Allowed centered amplitude ratio: 0.5–1.5/)).toBeTruthy()
    expect(frozen.getByText(/Minimum zero-lag reference gain: 0.5/)).toBeTruthy()
    expect(frozen.getByText(/Minimum reference excursion \(rad\): 0.1/)).toBeTruthy()
    expect(frozen.getByRole('row', { name: /joint-0 / }).textContent).toBe('joint-00.3Required when reference-active')
    expect(frozen.getByRole('row', { name: /joint-2 / }).textContent).toBe('joint-20.3Position only')
    expect(frozen.getByRole('table').textContent).not.toContain('joint-09')
    expect(view.getByText(en['dance.scope'])).toBeTruthy()
    expect(view.getByText(en['dance.unmeasured'])).toBeTruthy()
    expect(frozen.getByText(en['dance.precision'])).toBeTruthy()
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('shows recorded cycle ratios for target-active joints outside the requested criteria subset', () => {
    const report = danceReport()
    expect(report.dancePlan!.evaluation.dance.movingJointIndices).not.toContain(2)
    report.dancePlan!.reference.blocks[1]!.activeJointIndices.push(2)
    for (const cycle of report.episodes[0]!.dance!.cycles) {
      cycle.amplitudeRatio[2] = 0.7; cycle.referenceGainRatio[2] = 0.6
      cycle.blocks[1]!.amplitudeRatio[2] = 0.7; cycle.blocks[1]!.referenceGainRatio[2] = 0.6
    }
    const view = mount(report)
    const cycle = openCycle(view, 'Choreography criteria failed', 2)
    const joints = cycle.getAllByText('Per-joint measurements')[0]!
    fireEvent.click(joints)
    const row = within(joints.parentElement!).getByRole('row', { name: /joint-2 / })
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0.0200', '0.7000', '0.6000'])
    expect(row.textContent).not.toContain('Not assessed for this joint')
  })

  it('shows missing full-rate measurements at a complete nonterminated horizon without substituting zero', () => {
    const report = danceReport()
    report.danceStatus = 'incomplete'
    const dance = report.episodes[0]!.dance!
    dance.status = 'incomplete'; dance.reasons = ['incomplete-window', 'missing-measurements']
    const cycle = dance.cycles[1]!
    for (const window of [cycle, ...cycle.blocks]) {
      Object.assign(window, { status: 'incomplete', measuredSteps: 0, complete: false,
        jointRmseRad: null, rootOrientationRmseRad: null, maxHorizontalDriftMeters: null,
        amplitudeRatio: Array(14).fill(null), referenceGainRatio: Array(14).fill(null),
        reasons: ['incomplete-window', 'missing-measurements'] })
    }
    const view = mount(report)
    const window = openCycle(view, 'Choreography assessment incomplete', 2)
    expect(view.getByText(/Elapsed\/requested reference cycles: 2\/2/)).toBeTruthy()
    expect(window.getByText(/Finite measurements\/expected control steps: 0\/50/)).toBeTruthy()
    const metrics = window.getAllByText(/Largest joint RMSE/)[0]!
    expect(metrics.textContent).toContain('Root orientation RMSE (rad): Not recorded')
    expect(metrics.textContent).toContain('Maximum horizontal drift (m): Not recorded')
    expect(metrics.textContent).not.toContain('0.0000')
    expect(window.getAllByText('missing-measurements')).toHaveLength(3)
    const joints = window.getAllByText('Per-joint measurements')[0]!
    fireEvent.click(joints)
    expect(within(joints.parentElement!).getByRole('row', { name: /joint-0 / }).textContent)
      .toBe('joint-0Not recordedNot recordedNot recorded')
  })

  it('displays termination even when the same step reaches the time limit', () => {
    const report = danceReport()
    report.passed = false
    const episode = report.episodes[0]!
    episode.terminated = true
    const dance = episode.dance!
    dance.terminated = true
    dance.truncated = true
    dance.reasons.push('terminated')
    const last = dance.cycles[1]!
    for (const window of [last, last.blocks[1]!]) {
      window.complete = false
      window.reasons.push('terminated')
    }
    const view = mount(report)
    fireEvent.click(view.getByText('Episode 1 · Choreography criteria failed'))
    expect(view.getByText(/Terminated: Yes/)).toBeTruthy()
    expect(view.getByText(/Truncated: Yes/)).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Balance criteria failed' })).toBeTruthy()
  })

  it('does not invent an episode assessment or verdict when optional measurements are absent', () => {
    const report = danceReport()
    delete report.episodes[0]!.dance
    delete report.danceStatus
    const view = render(<DanceEvidence report={report} t={t} />)
    fireEvent.click(view.getByText('Episode 1 · Not recorded'))
    expect(view.getByText(en['dance.missingEpisode'])).toBeTruthy()
    expect(view.queryByText(/Elapsed\/requested reference cycles/)).toBeNull()
  })

  it('uses the supplied locale for choreography outcomes and metric labels', () => {
    const report = danceReport()
    report.danceStatus = 'passed'
    const dance = report.episodes[0]!.dance!
    dance.status = 'passed'; dance.reasons = []
    for (const cycle of dance.cycles) {
      for (const window of [cycle, ...cycle.blocks]) {
        window.status = 'passed'; window.reasons = []
        window.referenceGainRatio = window.referenceGainRatio.map(value => value === null ? null : 0.8)
      }
    }
    const view = render(<DanceEvidence report={report} t={key => zh[key as keyof typeof zh]} />)
    expect(view.getByRole('region', { name: '编舞评估' })).toBeTruthy()
    expect(view.getByText('编舞标准通过', { selector: 'strong' })).toBeTruthy()
    expect(view.getByText(zh['dance.unmeasured'])).toBeTruthy()
    fireEvent.click(view.getByText(zh['dance.frozenCriteria']))
    expect(view.getByRole('columnheader', { name: '关节 RMSE 上限（rad）' })).toBeTruthy()
    expect(view.getAllByText('参考活跃时必须满足')).toHaveLength(2)
    expect(view.getByText(/仿真与编排周期时长之差（秒）：?/)).toBeTruthy()
  })

  it('qualifies existing comparisons by plan hash and withholds deltas for missing or different plans', () => {
    const selected = danceReport()
    const matching = compareAssessments(selected, structuredClone(selected), entry.run!, entry.run!)
    expect(matching).toMatchObject({ dancePlanMatch: 'matching', likeForLike: true, uprightDelta: 0 })
    const changed = structuredClone(selected)
    changed.dancePlan!.sha256 = '5'.repeat(64)
    expect(compareAssessments(selected, changed, entry.run!, entry.run!)).toMatchObject({
      dancePlanMatch: 'different', likeForLike: false, uprightDelta: null, poseDelta: null,
    })
    expect(compareAssessments(evaluation, selected, entry.run!, entry.run!)).toMatchObject({
      dancePlanMatch: 'missing', likeForLike: false, uprightDelta: null,
    })
    expect(compareAssessments(evaluation, evaluation).dancePlanMatch).toBe('unassessed')
    const view = mount(selected)
    const baseline = { ...changed, id: 'baseline-dance' as RobotEvaluation['id'] }
    const snapshot = learningSnapshot()
    snapshot.evaluations = [selected, baseline]
    act(() => { view.store.actions.baseline(baseline.id) })
    view.rerender(<LearningReview {...view.props} useLab={selector => selector(snapshot)} />)
    expect(view.getByText(en['dance.compareDifferent'])).toBeTruthy()
  })

  it('requires matching choreography criteria and run-plan identity for reflection eligibility', () => {
    const report = danceReport()
    const changed = structuredClone(report.spec)
    expect(sameAssessment(report.spec, changed)).toBe(true)
    changed.dance!.minReferenceGainRatio = 0.75
    expect(sameAssessment(report.spec, changed)).toBe(false)
    const differentJoints = structuredClone(report.spec)
    differentJoints.dance!.movingJointIndices = [1]
    expect(sameAssessment(report.spec, differentJoints)).toBe(false)
    const differentLimits = structuredClone(report.spec)
    differentLimits.dance!.maxJointRmseRad[0] = 0.4
    expect(sameAssessment(report.spec, differentLimits)).toBe(false)
    expect(sameAssessment(report.spec, evaluation.spec)).toBe(false)
    const snapshot = learningSnapshot()
    const linked = { ...entry, trial: { ...entry.trial, recipe: { ...entry.trial.recipe,
      evaluation: report.dancePlan!.evaluation } }, run: { ...entry.run!, dancePlan: report.dancePlan! } }
    snapshot.evaluations = [report]; snapshot.trials = [linked]; snapshot.runs = [linked.run]
    const fixture = studioFixture(snapshot)
    fixture.store.actions.policy(report.policyId); fixture.store.actions.evaluation(report.id)
    expect(reviewEvidence(snapshot, fixture.store.getSnapshot()).canReflect).toBe(true)
    snapshot.evaluations = [{ ...report, dancePlan: { ...report.dancePlan!, sha256: '6'.repeat(64) } }]
    expect(reviewEvidence(snapshot, fixture.store.getSnapshot()).canReflect).toBe(false)
  })
})
