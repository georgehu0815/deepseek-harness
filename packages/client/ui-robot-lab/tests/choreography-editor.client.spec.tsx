// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { choreographyDraft, CHOREOGRAPHY_FIELDS, hasChoreographyJoints, resolveAssessment, resolveChoreography, validChoreography } from '../src/client/choreography-draft.ts'
import { validAssessment } from '../src/client/evaluation-evidence.ts'
import { selectAuthoringDraft, parseAuthoringDraft, encodeDraftFile, parseDraftFile } from '../src/client/draft-file.ts'
import { createRobotStore } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
import { ChoreographyEditor } from '../src/client/ChoreographyEditor.tsx'
import { trialRecipe } from '../src/client/trial-draft.ts'
import { studioFixture } from './studio-fixtures.client.tsx'
import { fixtureProject } from './fixtures.client.ts'
import { brief, entry, evaluation, reflection, trial, learningSnapshot } from './learning-fixtures.client.ts'
import { partialV2DanceReport } from './dance-fixtures.client.ts'

afterEach(cleanup)
const criteria = partialV2DanceReport().spec.dance!
function emptyAuthoring() {
  const store = createRobotStore().create()
  const draft = selectAuthoringDraft(store.getSnapshot())
  store.dispose()
  return draft
}
function mount() {
  const snapshot = learningSnapshot()
  const fixture = studioFixture(snapshot)
  fixture.store.actions.loadProject(fixtureProject)
  fixture.store.actions.brief(brief)
  fixture.store.actions.assessment(trial.recipe.evaluation)
  fixture.store.actions.page('train')
  return { ...fixture, snapshot, ...render(<MicroDuckPanel {...fixture.props} />) }
}
function fill(view: ReturnType<typeof mount>) {
  for (const key of CHOREOGRAPHY_FIELDS) fireEvent.change(view.getByLabelText(en[`criteria.${key}`]), { target: { value: String(criteria[key]) } })
  fixtureProject.profile.joints.forEach((joint, index) => {
    fireEvent.change(view.getByLabelText(`${joint.name} · ${en['criteria.jointRmse']}`), { target: { value: String(criteria.maxJointRmseRad[index]) } })
  })
  fireEvent.click(view.getByLabelText(`${fixtureProject.profile.joints[13]!.name} · ${en['criteria.moving']}`))
  fireEvent.click(view.getByLabelText(`${fixtureProject.profile.joints[0]!.name} · ${en['criteria.moving']}`))
  fireEvent.click(view.getByLabelText(`${fixtureProject.profile.joints[13]!.name} · ${en['criteria.moving']}`))
}

describe('explicit experimental choreography authoring', () => {
  it('starts balance-only and submits identical explicitly filled criteria through Save and Start', () => {
    const view = mount()
    const toggle = within(view.container).getByLabelText<HTMLInputElement>(en['criteria.enable'])
    expect(toggle.checked).toBe(false)
    expect(view.getByText(en['criteria.balanceOnly'])).toBeTruthy()
    fireEvent.click(view.getByText(en['criteria.title']))
    fireEvent.click(toggle)
    expect(view.getByText(en['criteria.version2'])).toBeTruthy()
    expect(within(view.container).getByLabelText<HTMLInputElement>(en['criteria.requiredCycles']).value).toBe('')
    expect(Object.values(view.store.getSnapshot().choreography!.fields)).toEqual(Array<string>(8).fill(''))
    expect(view.store.getSnapshot().choreography!.maxJointRmseRad).toEqual(Array<string>(14).fill(''))
    expect(view.store.getSnapshot().choreography!.movingJointIndices).toEqual([])
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(true)
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save and start trial' }).disabled).toBe(true)
    fireEvent.click(view.getByText(en['criteria.title']))
    expect(view.getByRole('alert').textContent).toBe(en['criteria.invalid'])
    expect(view.getByRole('alert').closest('details')).toBeNull()
    fireEvent.click(view.getByText(en['criteria.title']))
    fill(view)
    fireEvent.click(view.getByRole('button', { name: 'Save trial' }))
    fireEvent.click(view.getByRole('button', { name: 'Save and start trial' }))
    expect(view.saveTrial.mock.calls.map(call => call[1])).toEqual([false, true])
    expect(view.saveTrial.mock.calls[0]![0]).toEqual(view.saveTrial.mock.calls[1]![0])
    expect(view.saveTrial.mock.calls[0]![0]).toMatchObject({ brief, evaluation: { ...trial.recipe.evaluation, dance: criteria },
      spec: { projectRevisionId: fixtureProject.id, clip: null } })
    expect(view.store.getSnapshot().assessment).not.toHaveProperty('dance')
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('retains disabled and invalid inputs across navigation and file/store recovery without a balance fallback', () => {
    const view = mount()
    fireEvent.click(view.getByLabelText(en['criteria.enable']))
    fill(view)
    fireEvent.change(view.getByLabelText(en['criteria.requiredCycles']), { target: { value: '' } })
    fireEvent.click(view.getByLabelText(en['criteria.enable']))
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(false)
    const draft = selectAuthoringDraft(view.store.getSnapshot())
    expect(draft.choreography).toMatchObject({ enabled: false, fields: { requiredCycles: '' } })
    draft.dance = { ...draft.dance!, projectId: null }
    const session = view.props.sessionId
    const restored = parseDraftFile(encodeDraftFile(session, draft, 100000), session, 100000)
    const next = createRobotStore().create()
    next.actions.restoreAuthoring(restored)
    expect(next.getSnapshot().choreography).toEqual(draft.choreography)
    expect(next.getSnapshot().savedRevisionId).toBeNull()
    next.dispose()
    act(() => { view.store.actions.page('perform'); view.store.actions.page('train') })
    fireEvent.click(view.getByLabelText(en['criteria.enable']))
    expect(within(view.container).getByLabelText<HTMLInputElement>(en['criteria.requiredCycles']).value).toBe('')
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(true)
    expect(resolveAssessment(trial.recipe.evaluation, view.store.getSnapshot().choreography)).toBeNull()
    fireEvent.click(view.getByLabelText(`${fixtureProject.profile.joints[0]!.name} · ${en['criteria.moving']}`))
    expect(view.store.getSnapshot().choreography!.movingJointIndices).toEqual([])
  })

  it.each([1, 2] as const)('hydrates v%s without upgrade and keeps frozen saved trials independent of invalid drafts', (version) => {
    const view = mount()
    const frozen = { ...criteria, version }
    const saved = { ...entry, binding: null, run: null, trial: { ...trial, recipe: { ...trial.recipe,
      evaluation: { ...trial.recipe.evaluation, dance: frozen } } } }
    view.snapshot.trials = [saved]
    act(() => { view.store.actions.assessment(saved.trial.recipe.evaluation); view.store.actions.trial(saved.trial.id) })
    expect(view.getByText(en[`criteria.version${version}`])).toBeTruthy()
    expect(JSON.parse(view.getByText(en['criteria.frozen']).parentElement!.querySelector('pre')!.textContent)).toEqual(frozen)
    fireEvent.change(view.getByLabelText(en['criteria.requiredCycles']), { target: { value: '' } })
    expect(view.store.getSnapshot().choreography!.version).toBe(version)
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Start saved trial' }))
    expect(view.execute).toHaveBeenCalledExactlyOnceWith({ operation: 'train_trial', trialId: saved.trial.id })
    expect(saved.trial.recipe.evaluation.dance).toEqual(frozen)
    act(() => { view.store.actions.improvement(fixtureProject, saved.trial, reflection) })
    expect(view.store.getSnapshot().choreography).toBeUndefined()
    expect(view.store.getSnapshot().assessment!.dance).toEqual(frozen)
  })

  it('refuses editing without the selected target profile and does not invent joint names', () => {
    const view = mount()
    view.snapshot.catalog = null
    view.rerender(<MicroDuckPanel {...view.props} />)
    expect(view.getByText(en['criteria.profileMissing'])).toBeTruthy()
    expect(within(view.container).getByLabelText<HTMLInputElement>(en['criteria.enable']).disabled).toBe(true)
    expect(view.queryByLabelText(en['criteria.requiredCycles'])).toBeNull()
    act(() => { view.store.actions.choreography(choreographyDraft(), trial.recipe.evaluation) })
    expect(within(view.container).getByLabelText<HTMLInputElement>(en['criteria.enable']).disabled).toBe(false)
    fireEvent.click(view.getByLabelText(en['criteria.enable']))
    expect(view.store.getSnapshot().choreography!.enabled).toBe(false)
  })

  it('blocks invalid exploratory requests but evaluates frozen trial criteria independently', () => {
    const view = mount()
    view.snapshot.trials = []
    act(() => {
      view.store.actions.policy(evaluation.policyId)
      view.store.actions.choreography(choreographyDraft(), trial.recipe.evaluation)
      view.store.actions.page('evaluate')
    })
    const review = within(view.getByRole('tabpanel', { name: 'Evaluate' }))
    expect(review.getByRole<HTMLButtonElement>('button', { name: 'Check this policy' }).disabled).toBe(true)
    expect(review.getByRole('alert').textContent).toBe(en['criteria.invalid'])
    fireEvent.click(view.getByRole('tab', { name: /^Train$/ }))
    expect(within(view.getByRole('tabpanel', { name: 'Train' })).getByRole('alert').textContent).toBe(en['criteria.invalid'])
    fireEvent.click(view.getByRole('tab', { name: /^Evaluate$/ }))
    act(() => { view.store.actions.choreography(choreographyDraft(criteria), trial.recipe.evaluation) })
    fireEvent.change(review.getByLabelText('Assessment seed'), { target: { value: '81' } })
    expect(view.store.getSnapshot().choreography).toEqual(choreographyDraft(criteria))
    fireEvent.click(view.getByRole('button', { name: 'Check this policy' }))
    expect(view.execute).toHaveBeenLastCalledWith({ operation: 'evaluate', spec: {
      ...trial.recipe.evaluation, seed: 81, dance: criteria, policyId: evaluation.policyId } })
    view.snapshot.trials = [entry]
    act(() => { view.store.actions.choreography(choreographyDraft(), trial.recipe.evaluation) })
    fireEvent.click(view.getByRole('button', { name: 'Evaluate trial' }))
    expect(view.execute).toHaveBeenLastCalledWith({ operation: 'evaluate_trial', trialId: trial.id })
  })

  it('shows incomplete recovered criteria outside collapsed controls even without stored balance settings', () => {
    const view = mount()
    const recovered = { ...selectAuthoringDraft(view.store.getSnapshot()), assessment: null, choreography: choreographyDraft() }
    act(() => { view.store.actions.restoreAuthoring(recovered); view.store.actions.page('train') })
    expect(view.getByRole('alert').closest('details')).toBeNull()
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' }).disabled).toBe(true)
    view.snapshot.trials = []
    act(() => { view.store.actions.policy(evaluation.policyId); view.store.actions.page('evaluate') })
    expect(within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Check this policy' }).disabled).toBe(true)
    expect(view.execute).not.toHaveBeenCalled()
  })

  it('reports invalid imported numeric criteria and preserves their version when corrected', () => {
    const view = mount()
    act(() => { view.store.actions.assessment({ ...trial.recipe.evaluation, dance: { ...criteria, version: 1, requiredCycles: -1 } }) })
    expect(view.getByRole('alert').textContent).toBe(en['criteria.invalid'])
    fireEvent.click(view.getByText(en['criteria.title']))
    fireEvent.change(view.getByLabelText(en['criteria.requiredCycles']), { target: { value: '2' } })
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.store.getSnapshot().choreography!.version).toBe(1)
  })

  it('clears stale text on legacy import, explicit numeric replacement and per-duck training', () => {
    const store = createRobotStore().create()
    const legacy = selectAuthoringDraft(store.getSnapshot())
    for (const clear of [() => { store.actions.restoreAuthoring(legacy) },
      () => { store.actions.assessment({ ...trial.recipe.evaluation, dance: criteria }) },
      () => { store.actions.trainDuck(1, fixtureProject) }]) {
      store.actions.choreography(choreographyDraft(), trial.recipe.evaluation)
      clear()
      expect(store.getSnapshot().choreography).toBeUndefined()
    }
    store.dispose()
  })

  it('rejects malformed persisted editors and conflicting active numeric criteria', () => {
    const base = emptyAuthoring()
    const raw = choreographyDraft(criteria)
    for (const change of [{ enabled: 'yes' }, { version: 3 }, { fields: {} }, { fields: { ...raw.fields, requiredCycles: 1 } },
      { maxJointRmseRad: null }, { maxJointRmseRad: [] }, { maxJointRmseRad: Array<number>(14).fill(1) },
      { movingJointIndices: null }, { movingJointIndices: Array<number>(15).fill(0) }, { movingJointIndices: ['0'] },
      { movingJointIndices: [-1] }, { movingJointIndices: [14] }, { movingJointIndices: [0.5] }, { movingJointIndices: [0, 0] }]) {
      expect(() => parseAuthoringDraft({ ...base, choreography: { ...raw, ...change } })).toThrow()
    }
    expect(() => parseAuthoringDraft({ ...base, choreography: raw, assessment: { ...trial.recipe.evaluation, dance: criteria } })).toThrow()
    for (const version of [1, 2] as const) {
      expect(parseAuthoringDraft({ ...base, choreography: { ...raw, version } }).choreography!.version).toBe(version)
    }
  })

  it('uses the selected profile mapping and rejects incompatible target admission', () => {
    const view = mount()
    const short = { ...fixtureProject.profile, joints: fixtureProject.profile.joints.slice(1) }
    const unnamed = { ...fixtureProject.profile, joints: fixtureProject.profile.joints.map(joint => ({ ...joint, name: '' })) }
    const reordered = { ...fixtureProject.profile, joints: [...fixtureProject.profile.joints].reverse() }
    for (const profile of [short, unnamed, reordered]) expect(hasChoreographyJoints(profile)).toBe(false)
    expect(hasChoreographyJoints(undefined)).toBe(false)
    act(() => { view.store.actions.choreography(choreographyDraft(criteria), trial.recipe.evaluation) })
    expect(trialRecipe(view.store.getSnapshot(), { ...fixtureProject, profile: short },
      view.snapshot.behaviors[0], trial.recipe.evaluation)).toBeNull()
  })

  it('renders Chinese-owned labels and preserves all explicit joint bounds when temporarily disabled', () => {
    const raw = choreographyDraft(criteria)
    raw.maxJointRmseRad = Array.from({ length: 14 }, (_, index) => String(index / 10))
    let changed = raw
    const view = render(<ChoreographyEditor value={raw} criteria={undefined} profile={fixtureProject.profile} disabled={false}
      onChange={(value) => { changed = value }} t={key => zh[key as keyof typeof zh] ?? key} />)
    expect(view.getByText(zh['criteria.experimental'])).toBeTruthy()
    fixtureProject.profile.joints.forEach((joint, index) => {
      expect(within(view.container).getByLabelText<HTMLInputElement>(`${joint.name} · ${zh['criteria.jointRmse']}`).value).toBe(String(index / 10))
    })
    fireEvent.click(view.getByLabelText(zh['criteria.enable']))
    expect(changed).toEqual({ ...raw, enabled: false })
  })

  it.each([' 1 ', '0x1', '-'])('preserves restored raw text %j in both input types and keeps admission consistent', (text) => {
    const view = mount()
    const raw = choreographyDraft(criteria)
    raw.fields.requiredCycles = text
    raw.maxJointRmseRad[7] = text
    const payload = { ...emptyAuthoring(), brief, assessment: trial.recipe.evaluation, choreography: raw }
    const restored = parseDraftFile(encodeDraftFile(view.props.sessionId, payload, 100000), view.props.sessionId, 100000)
    act(() => {
      view.store.actions.restoreAuthoring(restored)
      view.store.actions.loadProject(fixtureProject)
      view.store.actions.page('train')
    })
    fireEvent.click(view.getByText(en['criteria.title']))
    const scalar = within(view.container).getByLabelText<HTMLInputElement>(en['criteria.requiredCycles'])
    const joint = within(view.container).getByLabelText<HTMLInputElement>(`${fixtureProject.profile.joints[7]!.name} · ${en['criteria.jointRmse']}`)
    for (const input of [scalar, joint]) {
      expect(input.type).toBe('text')
      expect(input.inputMode).toBe('decimal')
      expect(input.value).toBe(text)
    }
    const save = within(view.container).getByRole<HTMLButtonElement>('button', { name: 'Save trial' })
    expect(save.disabled).toBe(text === '-')
    if (text === '-') {
      fireEvent.change(scalar, { target: { value: '1' } })
      expect(save.disabled).toBe(true)
      expect(joint.value).toBe('-')
      fireEvent.change(joint, { target: { value: '1' } })
    }
    fireEvent.click(save)
    const numeric = view.saveTrial.mock.calls[0]![0].evaluation.dance!
    expect(numeric.requiredCycles).toBe(1)
    expect(numeric.maxJointRmseRad[7]).toBe(1)
  })

  it('distinguishes explicitly allowed zero limits from blank fields and strictly positive thresholds', () => {
    const raw = choreographyDraft(criteria)
    for (const key of ['requiredCycles', 'minPassedEpisodeFraction', 'minReferenceExcursionRad',
      'minAmplitudeRatio', 'maxAmplitudeRatio', 'minReferenceGainRatio'] as const) {
      expect(resolveChoreography({ ...raw, fields: { ...raw.fields, [key]: '0' } })).toBeNull()
    }
    raw.fields.maxRootOrientationRmseRad = '0'
    raw.fields.maxHorizontalDriftMeters = '0'
    raw.maxJointRmseRad.fill('0')
    expect(resolveChoreography(raw)).toMatchObject({ maxRootOrientationRmseRad: 0, maxHorizontalDriftMeters: 0,
      maxJointRmseRad: Array<number>(14).fill(0) })
    raw.maxJointRmseRad[7] = ''
    expect(resolveChoreography(raw)).toBeNull()
    raw.maxJointRmseRad[7] = '0'
    raw.fields.maxRootOrientationRmseRad = ''
    expect(resolveChoreography(raw)).toBeNull()
  })

  it('validates numeric limits independently of the balance-only settings', () => {
    expect(validChoreography(criteria)).toBe(true)
    expect(resolveAssessment(trial.recipe.evaluation, undefined)).toBe(trial.recipe.evaluation)
    for (const key of CHOREOGRAPHY_FIELDS) {
      const invalid = { ...criteria, [key]: -1 }
      expect(validChoreography(invalid)).toBe(false)
      expect(validAssessment({ ...trial.recipe.evaluation, dance: invalid })).toBe(false)
    }
    for (const change of [{ requiredCycles: 1.5 }, { minPassedEpisodeFraction: 1.1 }, { maxJointRmseRad: [] },
      { maxJointRmseRad: Array<number>(14).fill(-1) }, { movingJointIndices: [] }, { movingJointIndices: Array<number>(15).fill(0) },
      { movingJointIndices: [14] }, { movingJointIndices: [0.5] }, { movingJointIndices: [-1] }, { movingJointIndices: [0, 0] },
      { maxAmplitudeRatio: criteria.minAmplitudeRatio / 2 }, { minReferenceGainRatio: Infinity }]) {
      expect(validChoreography({ ...criteria, ...change })).toBe(false)
    }
    const raw = choreographyDraft(criteria)
    expect(resolveChoreography(raw)).toEqual(criteria)
    raw.fields.requiredCycles = 'Infinity'
    expect(resolveChoreography(raw)).toBeNull()
    raw.fields.requiredCycles = '-1'
    expect(resolveChoreography(raw)).toBeNull()
    expect(parseAuthoringDraft({ ...emptyAuthoring(), choreography: raw }).choreography).toEqual(raw)
  })
})
