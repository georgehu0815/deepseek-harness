// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createSnapshotStore, type PersistNotice } from '@deepseek-ai/dsh-client-store'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { LearningReview } from '../src/client/LearningReview.tsx'
import { selectAuthoringDraft } from '../src/client/draft-file.ts'
import type { RobotDraft } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
import { bindStudioStore, studioFixture } from './studio-fixtures.client.tsx'
import { fixtureProject, fixtureTemplate } from './fixtures.client.ts'
import { brief, evaluation, learningSnapshot, reflection, trial } from './learning-fixtures.client.ts'

afterEach(cleanup)

function fileRead(contents: string, read: () => Promise<string>) {
  const file = new File([contents], 'authoring.json', { type: 'application/json' })
  const text = vi.fn(read)
  Object.defineProperty(file, 'text', { value: text })
  return { file, text }
}

function deferredText() {
  let resolve!: (text: string) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function importInput(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByText(en['workspace.target']))
  fireEvent.click(view.getByText(en['draft.files']))
  return view.getByLabelText(en['draft.import'])
}

const notices: Array<[PersistNotice | null, keyof typeof en]> = [
  [null, 'draft.disabled'], [{ state: 'empty' }, 'draft.empty'], [{ state: 'restored' }, 'draft.restored'],
  [{ state: 'pending' }, 'draft.pending'], [{ state: 'saved' }, 'draft.saved'],
  ...(['invalid', 'unsupported-version', 'too-large', 'unavailable', 'quota', 'conflict', 'locking-unavailable'] as const)
    .map(reason => [{ state: 'blocked', reason }, `draft.blocked.${reason}`] as [PersistNotice, keyof typeof en]),
]

describe('authoring draft recovery presentation', () => {
  it.each(notices)('shows the recorded recovery notice %j without claiming a committed revision', (notice, key) => {
    const fixture = studioFixture()
    const source = createSnapshotStore({ ...fixture.store.getSnapshot(), persistence: notice })
    const view = render(<MicroDuckPanel {...fixture.props} useStore={bindStudioStore(source)} />)
    fireEvent.click(view.getByText(en['workspace.target']))
    const recovery = within(view.getByRole('region', { name: en['draft.label'] }))
    expect(recovery.getByRole('status').textContent).toBe(en[key])
    expect(recovery.getByText(en['draft.scope'])).toBeTruthy()
    expect(recovery.getByText(en['draft.retention'])).toBeTruthy()
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.saveProject).not.toHaveBeenCalled()
    expect(fixture.saveTrial).not.toHaveBeenCalled()
  })

  it('updates pending to saved through the framework test binding and localizes recovery copy', () => {
    const fixture = studioFixture()
    const source = createSnapshotStore<RobotDraft>({ ...fixture.store.getSnapshot(), persistence: { state: 'pending' } })
    const view = render(<MicroDuckPanel {...fixture.props} useStore={bindStudioStore(source)}
      t={key => zh[key as keyof typeof zh]} />)
    fireEvent.click(view.getByText(zh['workspace.target']))
    const recovery = within(view.getByRole('region', { name: zh['draft.label'] }))
    expect(recovery.getByRole('status').textContent).toBe(zh['draft.pending'])
    act(() => { source.set({ ...source.getSnapshot(), persistence: { state: 'saved' } }) })
    expect(recovery.getByRole('status').textContent).toBe(zh['draft.saved'])
    expect(recovery.getByText(zh['draft.scope'])).toBeTruthy()
    expect(recovery.getByText(zh['draft.retention'])).toBeTruthy()
  })

  it('exports only the authoring payload, excluding reflection notes, selection, rosters and saved-state markers', () => {
    const fixture = studioFixture(learningSnapshot())
    fixture.store.actions.loadProject(fixtureProject)
    fixture.store.actions.brief(brief)
    fixture.store.actions.assessment(trial.recipe.evaluation)
    fixture.store.actions.trainingBackend('rlx')
    fixture.store.actions.steps('unfinished step count')
    fixture.store.actions.reflection({ observation: 'Private unsaved reflection notes' })
    fixture.store.actions.policy(evaluation.policyId)
    fixture.store.actions.evaluation(evaluation.id)
    fixture.store.actions.baseline(evaluation.id)
    fixture.store.actions.addDuck()
    fixture.store.actions.surface('grass')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    importInput(view)
    fireEvent.click(view.getByRole('button', { name: en['draft.export'] }))
    const value = fixture.saveDraft.mock.calls[0]![0]
    expect(Object.keys(value).sort()).toEqual(['dance', 'brief', 'assessment', 'parentReflectionId', 'customTraining',
      'behaviorId', 'trainingWeights', 'trainingBackend', 'name', 'steps', 'envs', 'seed', 'clipJson'].sort())
    expect(value).toMatchObject({ dance: fixture.store.getSnapshot().dance, brief,
      assessment: trial.recipe.evaluation, trainingBackend: 'rlx', steps: 'unfinished step count' })
    expect(JSON.stringify(value)).not.toContain('Private unsaved reflection notes')
    expect(fixture.saveDraft).toHaveBeenCalledTimes(1)
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.saveProject).not.toHaveBeenCalled()
    expect(fixture.saveTrial).not.toHaveBeenCalled()
  })

  it.each(['en', 'zh'] as const)('warns that reflection notes are excluded from recovery in %s', (language) => {
    const fixture = studioFixture(learningSnapshot())
    fixture.store.actions.page('evaluate')
    fixture.store.actions.policy(evaluation.policyId)
    fixture.store.actions.evaluation(evaluation.id)
    const dictionary = language === 'en' ? en : zh
    const view = render(<LearningReview {...fixture.props} t={key => dictionary[key as keyof typeof dictionary]} />)
    expect(view.getByText(dictionary['draft.reflectionNotice'])).toBeTruthy()
  })
})

describe('bounded draft file selection', () => {
  it('checks byte size before File.text and accepts a file exactly at the configured ceiling', async () => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} draftMaxBytes={4} />)
    const input = importInput(view)
    const over = fileRead('🦆a', () => Promise.resolve('🦆a'))
    fireEvent.change(input, { target: { files: [over.file] } })
    expect(over.file.size).toBe(5)
    expect(over.text).not.toHaveBeenCalled()
    expect(fixture.loadDraft).toHaveBeenCalledExactlyOnceWith({ error: 'size' })
    const exact = fileRead('🦆', () => Promise.resolve('🦆'))
    fireEvent.change(input, { target: { files: [exact.file] } })
    await waitFor(() => { expect(fixture.loadDraft).toHaveBeenLastCalledWith({ text: '🦆' }) })
    expect(exact.text).toHaveBeenCalledOnce()
    expect(fixture.loadDraft).toHaveBeenCalledTimes(2)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('reports a read failure without forwarding exception text or replacing authoring', async () => {
    const fixture = studioFixture()
    const before = fixture.store.getSnapshot()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const input = importInput(view)
    const failed = fileRead('{}', () => Promise.reject(new Error('private filesystem detail')))
    fireEvent.change(input, { target: { files: [failed.file] } })
    await waitFor(() => { expect(fixture.loadDraft).toHaveBeenCalledExactlyOnceWith({ error: 'read' }) })
    expect(fixture.store.getSnapshot()).toBe(before)
    expect(view.queryByText('private filesystem detail')).toBeNull()
  })

  it('ignores an empty file selection', () => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.change(importInput(view), { target: { files: [] } })
    expect(fixture.loadDraft).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('ignores an older file %s after a newer selection finishes', async (settle) => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const input = importInput(view)
    const pending = deferredText()
    const old = fileRead('stale draft', () => pending.promise)
    const next = fileRead('newer draft', () => Promise.resolve('newer draft'))
    fireEvent.change(input, { target: { files: [old.file] } })
    fireEvent.change(input, { target: { files: [next.file] } })
    await waitFor(() => { expect(fixture.loadDraft).toHaveBeenCalledExactlyOnceWith({ text: 'newer draft' }) })
    await act(async () => {
      if (settle === 'resolve') pending.resolve('stale draft')
      else pending.reject(new Error('stale error'))
      await Promise.resolve()
    })
    expect(fixture.loadDraft).toHaveBeenCalledExactlyOnceWith({ text: 'newer draft' })
  })

  it.each(['resolve', 'reject'] as const)('ignores a late file %s after the panel unmounts', async (settle) => {
    const fixture = studioFixture()
    const view = render(<MicroDuckPanel {...fixture.props} />)
    const pending = deferredText()
    const file = fileRead('late draft', () => pending.promise)
    fireEvent.change(importInput(view), { target: { files: [file.file] } })
    view.unmount()
    await act(async () => {
      if (settle === 'resolve') pending.resolve('late draft')
      else pending.reject(new Error('late error'))
      await Promise.resolve()
    })
    expect(fixture.loadDraft).not.toHaveBeenCalled()
  })
})

describe('restored authoring referents', () => {
  it.each(['profile', 'template', 'block'] as const)('requires the restored %s to exist in the current catalog', (missing) => {
    const fixture = studioFixture()
    const dance = structuredClone(fixtureProject.recipe)
    if (missing === 'profile') dance.profileId = 'missing-profile' as typeof dance.profileId
    if (missing === 'template') dance.templateId = 'missing-template' as typeof dance.templateId
    if (missing === 'block') dance.blocks = [{ templateId: 'missing-block' as typeof dance.templateId,
      templateVersion: 1, beats: 8, moveSize: 0.25 }]
    fixture.store.actions.restoreAuthoring({ ...selectAuthoringDraft(fixture.store.getSnapshot()), dance })
    const view = render(<MicroDuckPanel {...fixture.props} />)
    fireEvent.click(view.getByText('Training target'))
    expect(view.getByText(en['draft.sourceMissing'])).toBeTruthy()
    const save = view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement
    const preview = view.getByRole('button', { name: 'Preview target in Studio' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(preview.disabled).toBe(true)
    fireEvent.click(save); fireEvent.click(preview)
    expect(fixture.saveProject).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
    if (missing === 'profile') expect(view.queryByText('MicroDuck', { selector: 'div' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: new RegExp(fixtureTemplate.label) }))
    expect(view.queryByText(en['draft.sourceMissing'])).toBeNull()
    expect((view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks a restored improvement parent until it appears in current loaded history', () => {
    const snapshot = learningSnapshot()
    snapshot.reflections = []
    const fixture = studioFixture(snapshot)
    const parent = { ...reflection, id: 'reflection-11111111-1111-4111-8111-111111111111' as typeof reflection.id }
    fixture.store.actions.improvement(fixtureProject, trial, parent)
    fixture.store.actions.restoreAuthoring(selectAuthoringDraft(fixture.store.getSnapshot()))
    fixture.store.actions.savedProject(fixture.store.getSnapshot().editVersion, fixtureProject.projectId, fixtureProject.id)
    fixture.store.actions.page('train')
    const view = render(<MicroDuckPanel {...fixture.props} />)
    expect(view.getByText(en['draft.parentMissing'])).toBeTruthy()
    const start = view.getByRole('button', { name: 'Save and start trial' }) as HTMLButtonElement
    const save = view.getByRole('button', { name: 'Save trial' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(save.disabled).toBe(true)
    fireEvent.click(start); fireEvent.click(save)
    expect(fixture.saveTrial).not.toHaveBeenCalled()
    snapshot.reflections.push(parent)
    view.rerender(<MicroDuckPanel {...fixture.props} />)
    expect(view.queryByText(en['draft.parentMissing'])).toBeNull()
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    expect(fixture.saveTrial).toHaveBeenCalledWith(expect.objectContaining({ parentReflectionId: parent.id }), true)
  })
})
