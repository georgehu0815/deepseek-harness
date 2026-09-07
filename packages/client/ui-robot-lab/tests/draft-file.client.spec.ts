import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotProjectId, RobotProjectRevisionId, RobotReflectionId } from '@deepseek-ai/dsh-robot-lab/types'
import { createRobotStore } from '../src/client/store.ts'
import { DraftFileError, encodeDraftFile, parseAuthoringDraft, parseDraftFile,
  restoreAuthoringDraft, selectAuthoringDraft } from '../src/client/draft-file.ts'
import { fixtureProfile, fixtureTemplate } from './fixtures.client.ts'

const SESSION = '11111111-1111-4111-8111-111111111111' as SessionId
const LIMIT = 262144

function editor() {
  const store = createRobotStore().create()
  store.actions.chooseTemplate(fixtureProfile, fixtureTemplate)
  store.actions.projectName('🦆 练习')
  store.actions.brief({ goal: 'Try this\nthen observe 🦆', prediction: '' })
  store.actions.steps('-')
  store.actions.envs('')
  store.actions.trainingBackend('rlx')
  return store
}

function completeDraft() {
  const value = structuredClone(selectAuthoringDraft(editor().getSnapshot()))
  if (value.dance === null) throw new Error('Expected authored fixture.')
  value.dance = { ...value.dance, projectId: 'project-11111111-1111-4111-8111-111111111111' as RobotProjectId,
    blocks: [{ templateId: fixtureTemplate.id, templateVersion: 1, beats: 0, moveSize: -0.1 }] }
  value.parentReflectionId = 'reflection-11111111-1111-4111-8111-111111111111' as RobotReflectionId
  value.trainingWeights = { pose: 1, travel: 0, draftOnly: -1 }
  value.assessment = { episodes: 0, stepsPerEpisode: -1, seed: 1.5, maxTerminations: 0, minMeanUprightFraction: 2,
    dance: { version: 1, requiredCycles: 0, minPassedEpisodeFraction: 2, maxJointRmseRad: Array<number>(14).fill(-0.1),
      maxRootOrientationRmseRad: -1, movingJointIndices: [0, 13], minReferenceExcursionRad: 0,
      minAmplitudeRatio: 2, maxAmplitudeRatio: 1, minReferenceGainRatio: -1, maxHorizontalDriftMeters: -1 } }
  return value
}
function replace(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let row = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
  row[keys.at(-1)!] = replacement
}
function remove(value: unknown, path: string): void {
  const keys = path.split('.')
  let row = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
  Reflect.deleteProperty(row, keys.at(-1)!)
}

describe('authoring draft files', () => {
  it('preserves Unicode, incomplete forms and the explicitly selected backend', () => {
    const original = editor()
    const value = selectAuthoringDraft(original.getSnapshot())
    const text = encodeDraftFile(SESSION, value, LIMIT)
    expect(parseDraftFile(text, SESSION, LIMIT)).toEqual(value)
    expect(text).not.toContain('savedRevisionId')
    expect(text).not.toContain('persistence')
    const restored = restoreAuthoringDraft(parseDraftFile(text, SESSION, LIMIT), createRobotStore().create().getSnapshot())
    expect(restored.trainingBackend).toBe('rlx')
    expect(restored.steps).toBe('-')
    expect(restored.envs).toBe('')
    expect(restored.page).toBe('customize')
    expect(restored.savedRevisionId).toBeNull()
    expect(restored.savedEditVersion).not.toBe(restored.editVersion)
    expect(restored.trialId).toBeNull()
    expect(restored.policyId).toBeNull()
    expect(restored.reflection).toEqual({ observation: '', interpretation: '', nextChange: '' })
  })

  it('does not persist reflection notes, rosters, playback or saved-state markers', () => {
    const store = editor()
    const before = selectAuthoringDraft(store.getSnapshot())
    store.actions.reflection({ observation: 'Unsaved reflection' })
    store.actions.addDuck()
    store.actions.page('perform')
    store.actions.expandedViewer(true)
    expect(selectAuthoringDraft(store.getSnapshot())).toEqual(before)
  })

  it('allows finite unfinished assessment and recipe values without admitting them for training', () => {
    const store = editor()
    store.actions.assessment({ episodes: 0, stepsPerEpisode: -1, seed: 1.5, maxTerminations: 0, minMeanUprightFraction: 2 })
    const value = selectAuthoringDraft(store.getSnapshot())
    if (value.dance === null) throw new Error('Expected authored fixture.')
    const input = { ...value, dance: { ...value.dance, parameters: { ...value.dance.parameters, bpm: 0 } } }
    expect(parseDraftFile(encodeDraftFile(SESSION, input, LIMIT), SESSION, LIMIT)).toEqual(input)
  })

  it('counts the full UTF-8 file and rejects another session without changing the editor', () => {
    const store = editor()
    const value = selectAuthoringDraft(store.getSnapshot())
    const text = encodeDraftFile(SESSION, value, LIMIT)
    const bytes = new TextEncoder().encode(text).byteLength
    expect(encodeDraftFile(SESSION, value, bytes)).toBe(text)
    expect(() => encodeDraftFile(SESSION, value, bytes - 1)).toThrow(DraftFileError)
    expect(() => parseDraftFile(text, SESSION, text.length)).toThrow(DraftFileError)
    expect(() => parseDraftFile(text, '22222222-2222-4222-8222-222222222222' as SessionId, LIMIT)).toThrow(DraftFileError)
    expect(selectAuthoringDraft(store.getSnapshot())).toEqual(value)
  })

  it.each([
    { trainingBackend: ['cpu'] }, { trainingBackend: 'future' }, { customTraining: 'yes' },
    { brief: { goal: 1, prediction: '', plannedChange: '', evidence: '' } }, { trainingWeights: [] },
    { trainingWeights: { unknown: null } }, { policyId: 'run:foreign' }, { savedEditVersion: 1 },
    { parentReflectionId: 'reflection-other-session' }, { clipJson: {} }, { assessment: [] },
  ])('rejects unsupported durable fields: %j', (fields) => {
    expect(() => parseAuthoringDraft({ ...selectAuthoringDraft(editor().getSnapshot()), ...fields })).toThrow(DraftFileError)
  })

  it('rejects malformed nested recipes and future file versions', () => {
    const value = selectAuthoringDraft(editor().getSnapshot())
    if (value.dance === null) throw new Error('Expected authored fixture.')
    const dance = value.dance
    expect(() => parseAuthoringDraft({ ...value, dance: { ...dance, music: { ...dance.music, style: ['disco'] } } })).toThrow(DraftFileError)
    expect(() => parseAuthoringDraft({ ...value, dance: { ...dance, blocks: [{ templateVersion: 2 }] } })).toThrow(DraftFileError)
    expect(() => parseDraftFile(JSON.stringify({ version: 2, sessionId: SESSION, draft: value }), SESSION, LIMIT)).toThrow(DraftFileError)
    expect(() => parseDraftFile('{', SESSION, LIMIT)).toThrow(SyntaxError)
  })

  it('roundtrips every optional authoring field without claiming admission validity', () => {
    const value = completeDraft()
    expect(parseAuthoringDraft(value)).toBe(value)
    expect(parseDraftFile(encodeDraftFile(SESSION, value, LIMIT), SESSION, LIMIT)).toEqual(value)
    expect(restoreAuthoringDraft(value, createRobotStore().create().getSnapshot())).toMatchObject({
      parentReflectionId: value.parentReflectionId, assessment: value.assessment, trainingWeights: value.trainingWeights,
      savedRevisionId: null, trialId: null, policyId: null, page: 'customize',
    })
  })

  it.each([1, 2] as const)('roundtrips criteria v%s inside an unchanged version-1 authoring file', (version) => {
    const draft = completeDraft()
    draft.assessment!.dance!.version = version
    const text = encodeDraftFile(SESSION, draft, LIMIT)
    expect(JSON.parse(text) as unknown).toMatchObject({ version: 1, draft: { assessment: { dance: { version } } } })
    expect(parseDraftFile(text, SESSION, LIMIT)).toEqual(draft)
    const restored = restoreAuthoringDraft(parseAuthoringDraft(draft), createRobotStore().create().getSnapshot())
    expect(restored.assessment).toEqual(draft.assessment)
  })

  it('restores an empty authoring target on the chooser without saved-state evidence', () => {
    const initial = createRobotStore().create().getSnapshot()
    const value = selectAuthoringDraft(initial)
    expect(parseAuthoringDraft(value)).toBe(value)
    expect(restoreAuthoringDraft(value, initial)).toMatchObject({ page: 'choose', dance: null, savedRevisionId: null })
  })

  it.each([
    ['dance.templateVersion', 2], ['dance.music.version', 2], ['dance.music.style', 'unknown'],
    ['dance.profileId', null], ['dance.parameters', []], ['dance.parameters.bpm', Infinity], ['dance.music.seed', NaN],
    ['dance.blocks', {}], ['dance.blocks.0.templateVersion', 2], ['dance.blocks.0.beats', '4'],
    ['dance.blocks.0.templateId', 1], ['dance.blocks.0.extra', true], ['dance.extra', true],
    ['dance.projectId', 2], ['dance.projectId', 'project-gggggggg-1111-4111-8111-111111111111'],
    ['dance.projectId', 'project-11111111-1111-4111-8111-111111111111\n'],
    ['parentReflectionId', 'reflection-11111111-1111-4111-8111-111111111111\n'],
    ['assessment.stepsPerEpisode', Infinity], ['assessment.dance.version', 3], ['assessment.dance.requiredCycles', NaN],
    ['assessment.dance.maxJointRmseRad', []], ['assessment.dance.maxJointRmseRad', null],
    ['assessment.dance.maxJointRmseRad.0', Infinity], ['assessment.dance.movingJointIndices', {}],
    ['assessment.dance.movingJointIndices', Array<number>(15).fill(0)], ['assessment.dance.movingJointIndices', [-1]],
    ['assessment.dance.movingJointIndices', [14]], ['assessment.dance.movingJointIndices', [0.5]],
    ['assessment.dance.movingJointIndices', ['0']], ['assessment.dance.extra', true],
    ['trainingWeights.pose', Infinity], ['trainingWeights.pose', '1'], ['trainingWeights', true], ['brief', null],
  ])('rejects malformed nested draft field %s', (path, replacement) => {
    const value = completeDraft(); replace(value, path, replacement)
    expect(() => parseAuthoringDraft(value)).toThrow(DraftFileError)
  })

  it.each([
    'dance', 'brief', 'assessment', 'parentReflectionId', 'customTraining', 'behaviorId', 'trainingWeights', 'trainingBackend',
    'name', 'steps', 'envs', 'seed', 'clipJson', 'dance.parameters', 'dance.music.bpm', 'dance.blocks.0.beats',
    'assessment.dance.maxAmplitudeRatio', 'assessment.dance.movingJointIndices', 'brief.evidence',
  ])('rejects missing durable field %s', (path) => {
    const value = completeDraft(); remove(value, path)
    expect(() => parseAuthoringDraft(value)).toThrow(DraftFileError)
  })

  it('preserves an empty movement selection and typed finite values as unfinished input', () => {
    const value = completeDraft(); value.assessment!.dance!.movingJointIndices = []
    expect(parseAuthoringDraft(value)).toBe(value)
  })

  it('checks complete UTF-8 import bounds at exact, below-exact, and tiny limits', () => {
    const value = completeDraft(); const text = encodeDraftFile(SESSION, value, LIMIT)
    const bytes = new TextEncoder().encode(text).byteLength
    expect(parseDraftFile(text, SESSION, bytes)).toEqual(value)
    expect(() => parseDraftFile(text, SESSION, bytes - 1)).toThrow(DraftFileError)
    expect(() => parseDraftFile(text, SESSION, 1)).toThrow(DraftFileError)
    expect(() => encodeDraftFile(SESSION, value, 1)).toThrow(DraftFileError)
  })

  it.each([null, [], 1, { version: 1 }, { version: 1, sessionId: SESSION, draft: null },
    { version: 1, sessionId: SESSION, draft: {}, serverCache: [] }])('rejects malformed import envelope %j', (value) => {
    expect(() => parseDraftFile(JSON.stringify(value), SESSION, LIMIT)).toThrow(DraftFileError)
  })

  it('keeps edit generations monotonic so a late save cannot mark an imported target saved', () => {
    const store = editor()
    const oldVersion = store.getSnapshot().editVersion
    const value = selectAuthoringDraft(store.getSnapshot())
    store.actions.restoreAuthoring(value)
    expect(store.getSnapshot().editVersion).toBe(oldVersion + 1)
    store.actions.savedProject(oldVersion, 'project-11111111-1111-4111-8111-111111111111' as RobotProjectId,
      'revision-11111111-1111-4111-8111-111111111111' as RobotProjectRevisionId)
    expect(store.getSnapshot().savedRevisionId).toBeNull()
    expect(store.getSnapshot().dance?.projectId).toBeNull()
  })
})
