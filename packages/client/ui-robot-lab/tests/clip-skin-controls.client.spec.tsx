// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ClipSkinPanel } from '../src/client/ClipSkinPanel.tsx'
import { createClipGenStore } from '../src/client/clip-gen-store.ts'
import { compileClip } from '../src/client/clip-motion.ts'
import { clipSkins } from '../src/client/clip-skins.ts'
import { clipEn, clipZh } from '../src/client/clip-gen-locales.ts'
import type { ClipGenProps } from '../src/client/clip-gen-props.ts'
import { fixtureProfile } from './fixtures.client.ts'
import { clipPartScene } from './clip-part-fixture.ts'

afterEach(cleanup)
const clip = () => compileClip(fixtureProfile, [{ action: 'stand', beats: 4 }], 120, 0.5, 'Wardrobe dance', true)
function mount(chinese = false, model = true) {
  const store = createClipGenStore(120, 4).create()
  store.actions.load(clip())
  const scene = model ? clipPartScene() : null
  const copy: Partial<Record<Parameters<ClipGenProps['t']>[0], string>> = chinese ? clipZh : clipEn
  const t: ClipGenProps['t'] = (key, params) => {
    const template = copy[key]
    if (template === undefined) throw new Error(`Wardrobe requested unprovided copy: ${key}`)
    return template.replace(/\{(\w+)\}/g,
      (match: string, name: string) => params !== undefined && name in params ? String(params[name]) : match)
  }
  function View() {
    const state = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
    return <ClipSkinPanel state={state} scene={scene} actions={store.actions} t={t} />
  }
  return { ...render(<View />), store }
}

describe('MicroDuck appearance selection', () => {
  it('keeps browsing separate from application and changes all ten designs without touching motion or playback', () => {
    const view = mount()
    const cards = within(view.getByRole('group', { name: 'Browse skins' })).getAllByRole('button')
    expect(cards).toHaveLength(10)
    act(() => { view.store.actions.seek(0.4); view.store.actions.playing(true) })
    const initial = view.store.getSnapshot()
    for (const skin of clipSkins) {
      act(() => { view.store.actions.verify(true) })
      const before = view.store.getSnapshot()
      fireEvent.click(view.getByRole('button', { name: clipEn[`skin.${skin.id}`] }))
      expect(view.store.getSnapshot()).toBe(before)
      expect(view.getByRole('region', { name: 'Design preview' }).textContent).toContain(clipEn[`skin.${skin.id}.description`])
      expect(view.getByRole('region', { name: 'Design preview' }).querySelectorAll('dd')).toHaveLength(9)
      fireEvent.click(view.getByRole('button', { name: /^Apply to Duck 1$/ }))
      const applied = view.store.getSnapshot()
      expect(applied.duckSkins[1]).toBe(skin.id)
      expect(applied).toMatchObject({ playing: true, time: 0.4, verifiedRevision: null, editEpoch: initial.editEpoch })
      expect(applied.revision).toBe(before.revision + 1)
      expect(applied.clip).toEqual(initial.clip)
      expect(applied.pose).toEqual(initial.pose)
      expect(view.getByRole('status').textContent).toContain(clipEn[`skin.${skin.id}`])
    }
  })

  it('targets stable duck numbers, inherits Duck 1, applies all and resets a removed target', () => {
    const view = mount()
    act(() => { view.store.actions.applySkin('velocity', 'current'); view.store.actions.addDuck(); view.store.actions.addDuck() })
    expect(view.store.getSnapshot().duckSkins).toEqual({ 1: 'velocity', 2: 'velocity', 3: 'velocity' })
    fireEvent.change(view.getByRole('combobox', { name: 'Current duck · appearance' }), { target: { value: '2' } })
    fireEvent.click(view.getByRole('button', { name: /^Sakura Mochi$/ }))
    fireEvent.click(view.getByRole('button', { name: /^Apply to Duck 2$/ }))
    expect(view.store.getSnapshot().duckSkins).toEqual({ 1: 'velocity', 2: 'sakura', 3: 'velocity' })
    fireEvent.click(view.getByRole('button', { name: 'Apply to all 3 ducks' }))
    expect(view.store.getSnapshot().duckSkins).toEqual({ 1: 'sakura', 2: 'sakura', 3: 'sakura' })
    fireEvent.click(view.getByRole('button', { name: 'Original factory finish' }))
    fireEvent.click(view.getByRole('button', { name: 'Apply to all 3 ducks' }))
    expect(view.store.getSnapshot().duckSkins).toEqual({ 1: 'original', 2: 'original', 3: 'original' })
    act(() => { view.store.actions.removeDuck(2); view.store.actions.addDuck() })
    expect(view.store.getSnapshot()).toMatchObject({ skinDuckNumber: 1, duckSkins: { 1: 'original', 3: 'original', 4: 'original' } })
    expect(view.store.getSnapshot().duckSkins[2]).toBeUndefined()
    expect(view.getByRole('combobox', { name: 'Current duck · appearance' })).toHaveProperty('value', '1')
  })

  it('locks appearance throughout capture and does not stale review for identical applications or target selection', () => {
    const view = mount()
    act(() => { view.store.actions.addDuck(); view.store.actions.verify(true) })
    const reviewed = view.store.getSnapshot()
    act(() => { view.store.actions.applySkin('original', 'all'); view.store.actions.selectSkinDuck(99) })
    expect(view.store.getSnapshot()).toBe(reviewed)
    act(() => { view.store.actions.selectSkinDuck(2) })
    expect(view.store.getSnapshot().verifiedRevision).toBe(reviewed.verifiedRevision)
    act(() => { view.store.actions.previewReady(true); view.store.actions.generate() })
    const captured = view.store.getSnapshot()
    for (const button of view.getAllByRole('button')) expect(button.matches(':disabled')).toBe(true)
    act(() => { view.store.actions.applySkin('punk', 'all'); view.store.actions.selectSkinDuck(1) })
    expect(view.store.getSnapshot()).toBe(captured)
  })

  it('renders localized descriptions and a palette fallback without model artwork', () => {
    const view = mount(true, false)
    expect(view.getByRole('region', { name: '皮肤衣橱' })).toBeTruthy()
    expect(view.getByText(clipZh['skin.noModel'])).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /^叛逆电压$/ }))
    expect(view.getByText(clipZh['skin.punk.description'])).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /^应用到鸭子 1$/ }))
    expect(view.getByRole('status').textContent).toBe('鸭子 1 当前穿着：叛逆电压')
  })

  it('ignores application before a clip exists and keeps appearance across replacement motion', () => {
    const store = createClipGenStore(120, 3).create()
    const empty = store.getSnapshot()
    store.actions.applySkin('cyber', 'all')
    expect(store.getSnapshot()).toBe(empty)
    store.actions.load(clip()); store.actions.applySkin('cyber', 'current')
    store.actions.load({ ...clip(), name: 'New motion' })
    expect(store.getSnapshot().duckSkins).toEqual({ 1: 'cyber' })
    expect(JSON.stringify(store.getSnapshot().clip)).not.toContain('cyber')
  })
})
