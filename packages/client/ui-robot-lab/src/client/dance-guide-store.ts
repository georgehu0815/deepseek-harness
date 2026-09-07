/** Browser-local dance instructions and exact keyed sequences; built-in guides belong to the parent's locale. */
import { defineStore, type EngineStoreHandle, type PersistNotice } from '@deepseek-ai/dsh-client-store'
import { parseClipSequence } from './clip-sequence.ts'
import type { ClipSequence } from './clip-sequence.ts'

/** A reusable prompt, optionally accompanied by a model-bound editable timeline. */
export interface DanceGuide { id: number; name: string; prompt: string; sequence?: ClipSequence }
type GuideState = {
  guides: DanceGuide[]
  nextId: number
  persistence: PersistNotice
  adding: boolean
  name: string
  prompt: string
  error: null | 'name' | 'prompt' | 'duplicate'
}

function textValid(value: string, maximum: number): boolean {
  return value.trim().length > 0 && value.length <= maximum
}

function fields(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid dance guide fields')
  }
  return value as Record<string, unknown>
}

/** The append-only library has contiguous ids starting at one; restoration rejects gaps or a skipped nextId. */
function restore(payload: unknown, initial: GuideState): GuideState {
  const data = fields(payload, ['guides', 'nextId'])
  if (!Array.isArray(data.guides) || typeof data.nextId !== 'number'
    || !Number.isSafeInteger(data.nextId) || data.nextId !== data.guides.length + 1) throw new Error('Invalid dance guide library')
  const names = new Set<string>()
  const nextId = data.nextId
  const guides = data.guides.map((value: unknown, index): DanceGuide => {
    const guide = fields(value, ['id', 'name', 'prompt'], ['sequence'])
    if (guide.id !== index + 1 || typeof guide.name !== 'string' || guide.name !== guide.name.trim()
      || !textValid(guide.name, 80) || names.has(guide.name.toLowerCase())
      || typeof guide.prompt !== 'string' || !textValid(guide.prompt, 2000)) throw new Error('Invalid dance guide')
    names.add(guide.name.toLowerCase())
    return { id: guide.id, name: guide.name, prompt: guide.prompt,
      ...(Object.hasOwn(guide, 'sequence') ? { sequence: parseClipSequence(guide.sequence) } : {}) }
  })
  return { ...initial, guides, nextId }
}

function resetEditor(draft: GuideState): void {
  draft.adding = false; draft.name = ''; draft.prompt = ''; draft.error = null
}

function shortName(value: string, maximum: number): string {
  let name = ''
  for (const character of value) {
    if (name.length + character.length > maximum) break
    name += character
  }
  return name.trimEnd()
}

function sequenceName(guides: DanceGuide[], displayName: string): string {
  const base = displayName.trim()
  let name = shortName(base, 80)
  let ordinal = 2
  const names = new Set(guides.map(guide => guide.name.toLowerCase()))
  while (names.has(name.toLowerCase())) {
    const suffix = ` (${ordinal++})`
    name = shortName(base, 80 - suffix.length) + suffix
  }
  return name
}

/**
 * Declare root-scoped guide editing and protected browser recovery, excluding the unsaved editor.
 * @param maxBytes - Configured positive safe-integer UTF-8 budget for the complete persisted envelope.
 * @returns Store handle for root registration; names are trimmed and prompts retain their exact Unicode text.
 */
export function createDanceGuideStore(maxBytes: number): EngineStoreHandle<GuideState, {
  startAdd: (draft: GuideState, prompt: string) => void
  name: (draft: GuideState, value: string) => void
  prompt: (draft: GuideState, value: string) => void
  cancelAdd: (draft: GuideState) => void
  saveSequence: (draft: GuideState, prompt: string, sequence: ClipSequence) => void
  save: (draft: GuideState) => void
}> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Dance guide maxBytes must be a positive safe integer')
  return defineStore({
    init: (): GuideState => ({ guides: [], nextId: 1, persistence: { state: 'empty' },
      adding: false, name: '', prompt: '', error: null }),
    persist: {
      name: 'dsh.clip-gen.dance-guides', version: 1, maxBytes, scopeDisposal: 'retain',
      select: (state: GuideState) => ({ guides: state.guides, nextId: state.nextId }),
      restore,
      status: (draft: GuideState, notice: PersistNotice) => { draft.persistence = notice },
    },
    actions: {
      startAdd: (draft, prompt: string) => { draft.adding = true; draft.name = ''; draft.prompt = prompt; draft.error = null },
      name: (draft, value: string) => { draft.name = value; draft.error = null },
      prompt: (draft, value: string) => { draft.prompt = value; draft.error = null },
      cancelAdd: resetEditor,
      /** Append a validated sequence under a unique clip-derived name without replacing an open prompt editor. */
      saveSequence: (draft, prompt: string, sequence: ClipSequence) => {
        if (!textValid(prompt, 2000)) { draft.error = 'prompt'; return }
        const name = sequenceName(draft.guides, sequence.clip.name)
        draft.guides.push({ id: draft.nextId++, name, prompt, sequence: structuredClone(sequence) })
      },
      save: (draft) => {
        const name = draft.name.trim()
        if (!textValid(name, 80)) { draft.error = 'name'; return }
        if (!textValid(draft.prompt, 2000)) { draft.error = 'prompt'; return }
        if (draft.guides.some(guide => guide.name.toLowerCase() === name.toLowerCase())) { draft.error = 'duplicate'; return }
        draft.guides.push({ id: draft.nextId++, name, prompt: draft.prompt })
        resetEditor(draft)
      },
    },
  })
}
