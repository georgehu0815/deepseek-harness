// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipDuckLabel } from '../src/client/ClipDuckLabel.tsx'
import { ClipDuckControls } from '../src/client/ClipDuckControls.tsx'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { dancePresets, resolveDancePreset } from '../src/client/dance-presets.ts'
import type { WalkingClip } from '../src/client/clip-walking.ts'
import { clipEn } from '../src/client/clip-gen-locales.ts'
import type { ClipSimulationProps } from '../src/client/clip-gen-props.ts'
import { danceV2Model as model } from './dance-v2-fixture.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const t: ClipSimulationProps['t'] = (key, params) => clipEn[key as keyof typeof clipEn].replace(/\{(\w+)\}/g,
  (match, name: string) => params !== undefined && name in params ? String(params[name]) : match)

function mount(maxFileBytes = 262144, available = true) {
  const store = createClipGenStore(120, 3).create()
  const preset = dancePresets.find(dance => dance.id === 'cumbia_v2')!
  const clip: WalkingClip = preset.clip as WalkingClip
  store.actions.loadDance(preset.guide, preset.bpm, clip, 'cumbia_v2')
  function View() {
    const state = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
    return <ClipDuckControls state={state} profile={available ? model.profile : undefined} scene={model.scene}
      limits={model.limits} maxDucks={3} maxFileBytes={maxFileBytes} actions={store.actions} t={t} />
  }
  return { ...render(<View />), store }
}

describe('Cumbia v2 companion controls', () => {
  it('reports unavailable canvas text instead of publishing unlabeled companion sprites', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<ClipDuckLabel label="Duck 1" size={0.2} />)).toThrow('Duck labels require a canvas drawing context')
  })

  it('adds default followers, independently chooses a validated dance and returns to following', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: 'Add duck' }))
    const selection = view.getByRole('combobox', { name: 'Duck 2 dance' }) as HTMLSelectElement
    expect(selection.value).toBe('follow')
    expect(selection.options).toHaveLength(13)
    fireEvent.change(selection, { target: { value: '' } })
    expect(view.store.getSnapshot().ducks[0]!.dance).toBeNull()
    act(() => { view.store.actions.verify(true) })
    fireEvent.change(selection, { target: { value: 'salsa_v2' } })
    expect(view.store.getSnapshot()).toMatchObject({ verifiedRevision: null, playing: false,
      ducks: [{ number: 2, dance: { id: 'salsa_v2', modelSha256: model.profile.modelSha256 } }] })
    expect(view.store.getSnapshot().clip!.name).toBe('MicroDuck Cumbia v2')
    fireEvent.change(selection, { target: { value: 'follow' } })
    expect(view.store.getSnapshot().ducks[0]!.dance).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Add duck' }))
    expect(view.getByRole('button', { name: 'Add duck' })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: 'Remove Duck 2' }))
    expect(view.queryByRole('combobox', { name: 'Duck 2 dance' })).toBeNull()
    expect(view.getByRole('combobox', { name: 'Duck 3 dance' })).toBeTruthy()
  })

  it('retains the previous choice when validation fails and locks native controls during capture', () => {
    const view = mount(10)
    fireEvent.click(view.getByRole('button', { name: 'Add duck' }))
    const selection = view.getByRole('combobox', { name: 'Duck 2 dance' }) as HTMLSelectElement
    fireEvent.change(selection, { target: { value: 'salsa_v2' } })
    expect(selection.value).toBe('follow')
    expect(view.store.getSnapshot().error).toBe('fileSize')
    act(() => { view.store.actions.previewReady(true); view.store.actions.verify(true); view.store.actions.generate() })
    expect(selection.matches(':disabled')).toBe(true)
    expect(view.getByRole('button', { name: 'Remove Duck 2' }).matches(':disabled')).toBe(true)
    expect(view.getByText(clipEn['ducks.captureHint'])).toBeTruthy()
  })

  it('disables additions without installed metadata but lets an existing companion be removed', () => {
    const view = mount(262144, false)
    expect(view.getByRole('button', { name: 'Add duck' })).toHaveProperty('disabled', true)
    act(() => { view.store.actions.addDuck() })
    fireEvent.change(view.getByRole('combobox', { name: 'Duck 2 dance' }), { target: { value: 'salsa_v2' } })
    expect(view.store.getSnapshot().ducks[0]!.dance).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Remove Duck 2' }))
    expect(view.store.getSnapshot().ducks).toEqual([])
  })

  it('rejects mismatched native models and unavailable or out-of-range v2 tempo before committing', () => {
    const preset = dancePresets.find(dance => dance.id === 'cumbia_v2')!
    expect(resolveDancePreset(preset, model.profile, null, model.limits, 262144)).toEqual({ error: 'danceClip' })
    expect(resolveDancePreset(preset, { ...model.profile, modelSha256: 'wrong-model' }, model.scene, model.limits, 262144))
      .toEqual({ error: 'danceClip' })
    expect(resolveDancePreset(preset, model.profile, model.scene, { ...model.limits, maxBpm: 50 }, 262144))
      .toEqual({ error: 'danceClip' })
  })
})
