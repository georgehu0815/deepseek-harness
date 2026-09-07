// @vitest-environment jsdom
import { useState, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { defineStore, type PersistNotice } from '@deepseek-ai/dsh-client-store'
import { DanceGuideLibrary } from '../src/client/DanceGuideLibrary.tsx'
import { createDanceGuideStore } from '../src/client/dance-guide-store.ts'
import type { DanceGuideProps } from '../src/client/clip-gen-props.ts'
import { clipEn, clipZh } from '../src/client/clip-gen-locales.ts'
import { parseClipSequence } from '../src/client/clip-sequence.ts'
import { fixtureProfile } from './fixtures.client.ts'

afterEach(cleanup)

function mount(initialPrompt = '', dictionary: typeof clipEn | typeof clipZh = clipEn, notice: PersistNotice = { state: 'empty' }) {
  const declaration = createDanceGuideStore(262144)
  // Persistence has its own store tests; this fixture drives declared UI actions without browser writes.
  const store = defineStore({ init: () => ({ ...declaration.spec.init(), persistence: notice }),
    actions: declaration.spec.actions }).create()
  const onUse = vi.fn<DanceGuideProps['onUse']>()
  const onSequenceByAI = vi.fn<DanceGuideProps['onSequenceByAI']>()
  function Harness({ disabled = false, aiDisabled = false, aiPending = false }) {
    const [prompt, setPrompt] = useState(initialPrompt)
    const props = {
      prompt, disabled, aiDisabled, aiPending, onSequenceByAI,
      onUse: (...args: Parameters<DanceGuideProps['onUse']>) => { onUse(...args); setPrompt(args[0]) }, actions: store.actions,
      useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
      t: (key, params) => {
        const text = dictionary[key as keyof typeof clipEn]
        return params === undefined ? text
          : text.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
      },
    } as DanceGuideProps
    return <><DanceGuideLibrary {...props} /><textarea aria-label="Activity plan" value={prompt} onChange={(event) => { setPrompt(event.target.value) }} /></>
  }
  const view = render(<Harness />)
  return { ...view, store, declaration, onUse, onSequenceByAI, disable: () => { view.rerender(<Harness disabled />) },
    setControls: (controls: { disabled?: boolean; aiDisabled?: boolean; aiPending?: boolean }) => {
      view.rerender(<Harness {...controls} />)
    },
    choose: (value: string) => { fireEvent.change(view.getByRole('combobox', { name: dictionary['guide.choose'] }), { target: { value } }) } }
}

function addGuide(view: ReturnType<typeof mount>, name: string, prompt: string) {
  fireEvent.click(view.getByRole('button', { name: clipEn['guide.add'] }))
  fireEvent.change(view.getByRole('textbox', { name: clipEn['guide.name'] }), { target: { value: name } })
  fireEvent.change(view.getByRole('textbox', { name: clipEn['guide.description'] }), { target: { value: prompt } })
  fireEvent.click(view.getByRole('button', { name: clipEn['guide.save'] }))
}

function sequence() {
  return parseClipSequence({ version: 1, modelSha256: 'a'.repeat(64), jointNames: fixtureProfile.joints.map(joint => joint.name), bpm: 120,
    clip: { version: 1, name: '夜舞 🦆', duration: 2, loop: true, keys: [
      { t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
      { t: 0.375, joints: Array<number>(14).fill(0.2), rootPitch: 0.1 },
      { t: 2, joints: Array<number>(14).fill(0), rootPitch: 0 },
    ] } })
}

describe('Clip Gen dance guide library', () => {
  it('starts AI authoring only on an explicit click and supplies the library-owned save callback', () => {
    const prompt = '  跳舞 🦆\nHold the final pose.  '
    const view = mount(prompt)
    const button = view.getByRole('button', { name: clipEn.sequenceByAI }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(view.onSequenceByAI).not.toHaveBeenCalled()
    expect(view.store.getSnapshot().guides).toEqual([])
    fireEvent.click(button)
    expect(view.onSequenceByAI).toHaveBeenCalledExactlyOnceWith(view.store.actions.saveSequence)
    expect(view.store.getSnapshot().guides).toEqual([])
    const generated = sequence()
    act(() => { view.onSequenceByAI.mock.calls[0]![0](prompt, generated) })
    expect(view.store.getSnapshot().guides).toEqual([{ id: 1, name: generated.clip.name, prompt, sequence: generated }])
    const label = clipEn['guide.sequenceName'].replace('{name}', generated.clip.name)
    expect(view.getByRole('option', { name: label })).toBeTruthy()
    expect(view.onUse).not.toHaveBeenCalled()
    const persistence = view.declaration.spec.persist!
    if (typeof persistence === 'string') throw new Error('Expected protected guide persistence')
    const restored = persistence.restore(persistence.select(view.store.getSnapshot()), view.declaration.spec.init())
    expect(restored.guides[0]?.sequence).toEqual(generated)
    view.choose('saved-1')
    expect(view.onUse).toHaveBeenCalledExactlyOnceWith(prompt, generated)
    expect(view.getByRole('textbox', { name: 'Activity plan' })).toHaveProperty('value', prompt)
  })

  it.each(['disabled', 'aiDisabled', 'aiPending'] as const)('does not request AI authoring while %s', (control) => {
    const view = mount('My prompt')
    view.setControls({ [control]: true })
    const button = view.getByRole('button', { name: clipEn.sequenceByAI }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(view.onSequenceByAI).not.toHaveBeenCalled()
    expect(view.store.getSnapshot().guides).toEqual([])
  })

  it('localizes sequence labels while passing the original saved text and keys unchanged', () => {
    const view = mount('', clipZh)
    const generated = sequence()
    const prompt = '  Original English 🦆\n  '
    act(() => { view.store.actions.saveSequence(prompt, generated) })
    expect(view.getByRole('button', { name: clipZh.sequenceByAI })).toBeTruthy()
    expect(view.getByRole('option', { name: clipZh['guide.sequenceName'].replace('{name}', generated.clip.name) })).toBeTruthy()
    view.choose('saved-1')
    expect(view.onUse).toHaveBeenCalledExactlyOnceWith(prompt, generated)
  })

  it('offers three starters without filling or running anything on mount', () => {
    const view = mount('My existing plan')
    expect(view.getAllByRole('option')).toHaveLength(4)
    expect(view.getByRole('textbox', { name: 'Activity plan' })).toHaveProperty('value', 'My existing plan')
    expect(view.onUse).not.toHaveBeenCalled()
    expect(view.getByRole('status').textContent).toBe(clipEn['guide.storage.empty'])
  })

  it('fills the exact supplied example and keeps manual edits independent of the guide', () => {
    const view = mount('Replace this plan')
    view.choose('starter-bounce')
    const exact = 'The duck begins with a lively rhythm, bouncing twice on its left leg, then twice on its right. It follows the jumps with a graceful neck motion—lifting its neck high in a single upward pose before dipping it back down in one gentle nod.'
    expect(view.onUse).toHaveBeenCalledExactlyOnceWith(exact)
    const input = view.getByRole('textbox', { name: 'Activity plan' }) as HTMLTextAreaElement
    expect(input.value).toBe(exact)
    fireEvent.change(input, { target: { value: 'My edit' } })
    expect(view.getByRole('combobox')).toHaveProperty('value', '')
    view.choose('starter-bounce')
    expect(input.value).toBe(exact)
    view.choose('')
    expect(view.onUse).toHaveBeenCalledTimes(2)
  })

  it('prefills a new case from the current plan, saves it, and reuses its unchanged description', () => {
    const view = mount('Current activity')
    fireEvent.click(view.getByRole('button', { name: clipEn['guide.add'] }))
    expect(view.getByRole('textbox', { name: clipEn['guide.description'] })).toHaveProperty('value', 'Current activity')
    const description = '  我的舞步 🦆\nLeft leg, then a neck nod.  '
    fireEvent.change(view.getByRole('textbox', { name: clipEn['guide.name'] }), { target: { value: 'My dance 🦆' } })
    fireEvent.change(view.getByRole('textbox', { name: clipEn['guide.description'] }), { target: { value: description } })
    fireEvent.click(view.getByRole('button', { name: clipEn['guide.save'] }))
    expect(view.queryByRole('textbox', { name: clipEn['guide.name'] })).toBeNull()
    expect(view.getByRole('option', { name: 'My dance 🦆' })).toBeTruthy()
    expect(view.onUse).not.toHaveBeenCalled()
    view.choose('saved-1')
    expect(view.getByRole('textbox', { name: 'Activity plan' })).toHaveProperty('value', description)
    addGuide(view, 'Another guide', 'Head turn, then stand.')
    expect(view.store.getSnapshot().guides).toHaveLength(2)
    view.choose('saved-2')
    expect(view.onUse).toHaveBeenLastCalledWith('Head turn, then stand.')
  })

  it('keeps an invalid or duplicate editor open and cancels without adding a case', () => {
    const view = mount()
    addGuide(view, '', '')
    expect(view.getByRole('alert').textContent).toBe(clipEn['guide.error.name'])
    fireEvent.click(view.getByRole('button', { name: clipEn['guide.cancel'] }))
    expect(view.store.getSnapshot().guides).toEqual([])
    addGuide(view, 'My guide', 'Neck nod')
    addGuide(view, 'MY GUIDE', 'Different description')
    expect(view.getByRole('alert').textContent).toBe(clipEn['guide.error.duplicate'])
    expect(view.store.getSnapshot().guides).toHaveLength(1)
  })

  it('does not apply or save guides while the owning clip is exporting', () => {
    const view = mount('Keep this')
    fireEvent.click(view.getByRole('button', { name: clipEn['guide.add'] }))
    view.disable()
    expect(view.getByRole('combobox')).toHaveProperty('disabled', true)
    expect(view.getByRole('group', { name: clipEn['guide.editor'] }).hasAttribute('disabled')).toBe(true)
    view.choose('starter-hello')
    fireEvent.submit(view.getByRole('button', { name: clipEn['guide.save'] }).closest('form')!)
    expect(view.onUse).not.toHaveBeenCalled()
    expect(view.store.getSnapshot().guides).toEqual([])
  })

  it('localizes starters while preserving custom text', () => {
    const view = mount('', clipZh)
    expect(view.getByRole('region', { name: clipZh['guide.title'] })).toBeTruthy()
    view.choose('starter-sway')
    expect(view.onUse).toHaveBeenLastCalledWith(clipZh['guide.sway.prompt'])
    act(() => { view.store.actions.startAdd('Custom English description'); view.store.actions.name('自定义 🦆'); view.store.actions.save() })
    view.choose('saved-1')
    expect(view.onUse).toHaveBeenLastCalledWith('Custom English description')
  })

  it.each(['restored', 'pending', 'saved'] as const)('reports %s persistence accurately', (state) => {
    const view = mount('', clipEn, { state })
    expect(view.getByRole('status').textContent).toBe(clipEn[`guide.storage.${state}`])
  })

  it.each(['invalid', 'unsupported-version', 'too-large', 'unavailable', 'quota', 'conflict', 'locking-unavailable'] as const)(
    'keeps guides usable and warns when persistence is blocked by %s', (reason) => {
      const view = mount('', clipEn, { state: 'blocked', reason })
      expect(view.getByRole('status').textContent).toContain(clipEn[`guide.reason.${reason}`])
      expect(view.getByRole('status').textContent).toBe(clipEn['guide.storageBlocked'].replace('{reason}', clipEn[`guide.reason.${reason}`]))
      view.choose('starter-hello')
      expect(view.onUse).toHaveBeenLastCalledWith(clipEn['guide.hello.prompt'])
    })
})
