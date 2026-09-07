/** Session-addressed authoring drafts; committed records and playback are never embedded. */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RobotDraft } from './store.ts'
import { CHOREOGRAPHY_FIELDS } from './choreography-draft.ts'

const FIELDS = ['dance', 'brief', 'assessment', 'parentReflectionId', 'customTraining', 'behaviorId',
  'trainingWeights', 'trainingBackend', 'name', 'steps', 'envs', 'seed', 'clipJson'] as const

/** Editable authoring and learning-plan inputs, not evidence or a saved revision. */
export type AuthoringDraft = Pick<RobotDraft, typeof FIELDS[number] | 'choreography'>

/** Localized by the file consumer; storage recovery reports its own typed notice. */
export class DraftFileError extends Error {
  constructor(readonly code: 'fields' | 'text' | 'numeric' | 'reference' | 'version' | 'recipe' | 'assessment' | 'training' | 'size' | 'session') {
    super(code)
    this.name = 'DraftFileError'
  }
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new DraftFileError('fields')
  return value as Record<string, unknown>
}

function strings(row: Record<string, unknown>, keys: readonly string[]): void {
  if (keys.some(key => typeof row[key] !== 'string')) throw new DraftFileError('text')
}

function numbers(row: Record<string, unknown>, keys: readonly string[]): void {
  if (keys.some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]))) throw new DraftFileError('numeric')
}

function reference(value: unknown, prefix: string): void {
  if (value !== null && (typeof value !== 'string' || value.length !== prefix.length + 37
    || !new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'i').test(value))) {
    throw new DraftFileError('reference')
  }
}

function recipe(value: unknown): void {
  if (value === null) return
  const row = object(value, ['projectId', 'name', 'profileId', 'templateId', 'templateVersion', 'parameters', 'music'], ['blocks'])
  strings(row, ['name', 'profileId', 'templateId'])
  reference(row.projectId, 'project')
  if (row.templateVersion !== 1) throw new DraftFileError('version')
  numbers(object(row.parameters, ['bpm', 'beats', 'moveSize']), ['bpm', 'beats', 'moveSize'])
  const music = object(row.music, ['version', 'style', 'bpm', 'beats', 'seed'])
  if (music.version !== 1 || typeof music.style !== 'string' || !['disco', 'electronic', 'lofi', 'chiptune'].includes(music.style)) {
    throw new DraftFileError('recipe')
  }
  numbers(music, ['bpm', 'beats', 'seed'])
  if (row.blocks !== undefined) {
    if (!Array.isArray(row.blocks)) throw new DraftFileError('recipe')
    for (const item of row.blocks as unknown[]) {
      const block = object(item, ['templateId', 'templateVersion', 'beats', 'moveSize'])
      strings(block, ['templateId']); numbers(block, ['beats', 'moveSize'])
      if (block.templateVersion !== 1) throw new DraftFileError('version')
    }
  }
}

function assessment(value: unknown): void {
  if (value === null) return
  const fields = ['episodes', 'stepsPerEpisode', 'seed', 'maxTerminations', 'minMeanUprightFraction']
  const row = object(value, fields, ['dance'])
  numbers(row, fields)
  if (row.dance !== undefined) {
    const numeric = ['requiredCycles', 'minPassedEpisodeFraction', 'maxRootOrientationRmseRad',
      'minReferenceExcursionRad', 'minAmplitudeRatio', 'maxAmplitudeRatio', 'minReferenceGainRatio', 'maxHorizontalDriftMeters']
    const dance = object(row.dance, ['version', ...numeric, 'maxJointRmseRad', 'movingJointIndices'])
    numbers(dance, numeric)
    if ((dance.version !== 1 && dance.version !== 2) || !Array.isArray(dance.maxJointRmseRad) || dance.maxJointRmseRad.length !== 14
      || dance.maxJointRmseRad.some((item: unknown) => typeof item !== 'number' || !Number.isFinite(item))
      || !Array.isArray(dance.movingJointIndices) || dance.movingJointIndices.length > 14
      || dance.movingJointIndices.some((item: unknown) => typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 13)) {
      throw new DraftFileError('assessment')
    }
  }
}

/**
 * Select editable inputs without copying server records, UI selections, or completion markers.
 * @param draft - current declared store state.
 * @returns authoring fields for the protected store or a portable file.
 */
export function selectAuthoringDraft(draft: RobotDraft): AuthoringDraft {
  return { dance: draft.dance, brief: draft.brief, assessment: draft.assessment, parentReflectionId: draft.parentReflectionId,
    customTraining: draft.customTraining, behaviorId: draft.behaviorId, trainingWeights: draft.trainingWeights,
    trainingBackend: draft.trainingBackend, name: draft.name, steps: draft.steps,
    envs: draft.envs, seed: draft.seed, clipJson: draft.clipJson,
    ...(draft.choreography === undefined ? {} : { choreography: draft.choreography }) }
}

/**
 * Decode a partial editor, preserving incomplete text and finite out-of-range inputs for review.
 * Training admission, catalog resolution, and record ownership remain server responsibilities.
 * @param value - parsed draft JSON, bounded by its storage or file reader.
 * @returns validated editable fields; unknown fields and unsupported versions throw.
 */
export function parseAuthoringDraft(value: unknown): AuthoringDraft {
  const row = object(value, FIELDS, ['choreography'])
  if (Object.hasOwn(row, 'choreography')) {
    const editor = object(row.choreography, ['enabled', 'version', 'fields', 'maxJointRmseRad', 'movingJointIndices'])
    strings(object(editor.fields, CHOREOGRAPHY_FIELDS), CHOREOGRAPHY_FIELDS)
    if (typeof editor.enabled !== 'boolean' || (editor.version !== 1 && editor.version !== 2)
      || !Array.isArray(editor.maxJointRmseRad) || editor.maxJointRmseRad.length !== 14
      || editor.maxJointRmseRad.some((value: unknown) => typeof value !== 'string')
      || !Array.isArray(editor.movingJointIndices) || editor.movingJointIndices.length > 14
      || editor.movingJointIndices.some((value: unknown) => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 13)
      || new Set(editor.movingJointIndices).size !== editor.movingJointIndices.length
      || (row.assessment !== null && Object.hasOwn(object(row.assessment, [], ['episodes', 'stepsPerEpisode', 'seed',
        'maxTerminations', 'minMeanUprightFraction', 'dance']), 'dance'))) throw new DraftFileError('assessment')
  }
  strings(row, ['behaviorId', 'name', 'steps', 'envs', 'seed', 'clipJson'])
  strings(object(row.brief, ['goal', 'prediction', 'plannedChange', 'evidence']), ['goal', 'prediction', 'plannedChange', 'evidence'])
  recipe(row.dance); assessment(row.assessment); reference(row.parentReflectionId, 'reflection')
  if (typeof row.customTraining !== 'boolean' || typeof row.trainingBackend !== 'string'
    || !['cpu', 'mlx', 'rlx'].includes(row.trainingBackend)) throw new DraftFileError('training')
  if (row.trainingWeights !== null) {
    if (typeof row.trainingWeights !== 'object' || Array.isArray(row.trainingWeights)) throw new DraftFileError('training')
    const weights = row.trainingWeights as Record<string, unknown>
    numbers(weights, Object.keys(weights))
  }
  // Every selected DTO field, including optional nested fields, is checked above.
  return row as unknown as AuthoringDraft
}

/**
 * Restore editable work as dirty authoring, never as a committed project or running operation.
 * @param value - validated authoring inputs.
 * @param initial - fresh store defaults for this deployment.
 * @returns restored editor with unpersisted fields left at their initial values.
 */
export function restoreAuthoringDraft(value: AuthoringDraft, initial: RobotDraft): RobotDraft {
  return { ...initial, ...value, page: value.dance === null ? 'choose' : 'customize',
    editVersion: initial.editVersion + 1, savedEditVersion: -1, savedRevisionId: null }
}

function bound(text: string, maxBytes: number): void {
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) throw new DraftFileError('size')
}

/**
 * Export the current editor without starting an operation or changing browser storage.
 * @param sessionId - owning session.
 * @param value - current authoring fields.
 * @param maxBytes - configured complete-file byte ceiling.
 * @returns readable versioned JSON.
 */
export function encodeDraftFile(sessionId: SessionId, value: AuthoringDraft, maxBytes: number): string {
  parseAuthoringDraft(value)
  const text = JSON.stringify({ version: 1, sessionId, draft: value }, null, 2) + '\n'
  bound(text, maxBytes)
  return text
}

/**
 * Import a bounded file only into its explicitly addressed session.
 * @param text - user-selected UTF-8 JSON text.
 * @param sessionId - currently bound session.
 * @param maxBytes - configured complete-file byte ceiling.
 * @returns editable inputs, never server caches or saved-state markers.
 */
export function parseDraftFile(text: string, sessionId: SessionId, maxBytes: number): AuthoringDraft {
  bound(text, maxBytes)
  const row = object(JSON.parse(text) as unknown, ['version', 'sessionId', 'draft'])
  if (row.version !== 1) throw new DraftFileError('version')
  if (row.sessionId !== sessionId) throw new DraftFileError('session')
  return parseAuthoringDraft(row.draft)
}
