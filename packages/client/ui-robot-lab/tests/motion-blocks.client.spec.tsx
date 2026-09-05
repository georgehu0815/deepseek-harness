// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { MicroDuckPanel } from '../src/client/MicroDuckPanel.tsx'
import { fixtureSecondTemplate, readySnapshot } from './fixtures.client.ts'
import { studioFixture } from './studio-fixtures.tsx'

afterEach(cleanup)

function mount(maxBlocks = 8, maxSeconds = 60) {
  const snapshot = readySnapshot()
  snapshot.catalog = { ...snapshot.catalog!, templates: [...snapshot.catalog!.templates, fixtureSecondTemplate],
    limits: { ...snapshot.catalog!.limits, maxProjectBlocks: maxBlocks, maxClipSeconds: maxSeconds } }
  const fixture = studioFixture(snapshot)
  const view = render(<MicroDuckPanel {...fixture.props} />)
  fireEvent.click(view.getByRole('button', { name: /Gentle sway/ }))
  fireEvent.click(view.getByRole('button', { name: 'Build with motion blocks' }))
  return { ...fixture, ...view }
}

describe('motion block authoring', () => {
  it('edits ordered motion and relative sizes while publishing total beats to music and the timeline', () => {
    const view = mount()
    expect((view.getByLabelText('Total length') as HTMLInputElement).value).toBe('8 beats · 4.0 seconds')
    fireEvent.click(view.getByRole('button', { name: 'Add a move' }))
    fireEvent.change(view.getByLabelText('Block 2 move'), { target: { value: fixtureSecondTemplate.id } })
    fireEvent.change(view.getByLabelText('Block 1 length'), { target: { value: '4' } })
    fireEvent.change(view.getByLabelText('Block 2 length'), { target: { value: '8' } })
    fireEvent.change(view.getByLabelText('Block 2 move size'), { target: { value: '0.5' } })
    fireEvent.change(view.getByLabelText('Move size'), { target: { value: '0.6' } })
    fireEvent.change(view.getByLabelText('Tempo (BPM)'), { target: { value: '90' } })
    expect((view.getByLabelText('Total length') as HTMLInputElement).value).toBe('12 beats · 8.0 seconds')
    expect(within(view.getByLabelText('Routine beat timeline')).getByText('1–4')).toBeTruthy()
    expect(within(view.getByLabelText('Routine beat timeline')).getByText('5–12')).toBeTruthy()
    expect(view.store.getSnapshot().dance).toMatchObject({ parameters: { bpm: 90, beats: 12, moveSize: 0.6 },
      music: { bpm: 90, beats: 12 }, blocks: [{ beats: 4, moveSize: 1 },
        { templateId: fixtureSecondTemplate.id, beats: 8, moveSize: 0.5 }] })
    fireEvent.click(within(view.getByLabelText('Motion block 2')).getByRole('button', { name: 'Move up' }))
    expect((view.getByLabelText('Block 1 move') as HTMLSelectElement).value).toBe(fixtureSecondTemplate.id)
    expect(view.store.getSnapshot().dance!.templateId).toBe(fixtureSecondTemplate.id)
    fireEvent.click(within(view.getByLabelText('Motion block 1')).getByRole('button', { name: 'Move down' }))
    expect((view.getByLabelText('Block 2 move') as HTMLSelectElement).value).toBe(fixtureSecondTemplate.id)
    fireEvent.click(within(view.getByLabelText('Motion block 2')).getByRole('button', { name: 'Duplicate' }))
    expect(view.getAllByRole('article')).toHaveLength(3)
    fireEvent.change(view.getByLabelText('Block 3 move size'), { target: { value: '0.2' } })
    expect((view.getByLabelText('Block 2 move size') as HTMLInputElement).value).toBe('0.5')
    fireEvent.click(within(view.getByLabelText('Motion block 1')).getByRole('button', { name: 'Remove' }))
    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(view.store.getSnapshot().dance).toMatchObject({ templateId: fixtureSecondTemplate.id,
      parameters: { beats: 16 }, music: { beats: 16 } })
    fireEvent.click(view.getByRole('button', { name: 'Save revision' }))
    expect(view.saveProject).toHaveBeenCalledExactlyOnceWith(view.store.getSnapshot().dance, view.store.getSnapshot().editVersion, false)
  })

  it('disables impossible reorders, the final removal and additions at the catalog block cap', () => {
    const view = mount(2)
    const first = within(view.getByLabelText('Motion block 1'))
    for (const name of ['Move up', 'Move down', 'Remove']) {
      expect(first.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true)
    }
    fireEvent.click(view.getByRole('button', { name: 'Add a move' }))
    expect((view.getByRole('button', { name: 'Add a move' }) as HTMLButtonElement).disabled).toBe(true)
    for (const button of view.getAllByRole('button', { name: 'Duplicate' })) expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(view.getByLabelText('Motion block 2')).getByRole('button', { name: 'Remove' }))
    expect((view.getByRole('button', { name: 'Add a move' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks save and preview above the total-duration cap and recovers when shortened', () => {
    const view = mount(8, 4)
    fireEvent.click(view.getByRole('button', { name: 'Add a move' }))
    expect(view.getByText(/Shorten the routine to fit the configured duration limit/)).toBeTruthy()
    expect((view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: 'Preview target in Studio' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(view.getByLabelText('Block 1 length'), { target: { value: '4' } })
    expect((view.getByRole('button', { name: 'Save revision' }) as HTMLButtonElement).disabled).toBe(false)
    expect(view.saveProject).not.toHaveBeenCalled()
  })

  it('returns to a single template with synchronized music length and no hidden block list', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: 'Add a move' }))
    fireEvent.click(view.getByRole('button', { name: 'Use one template' }))
    expect(view.queryByLabelText('Motion block 1')).toBeNull()
    expect((view.getByLabelText('Length') as HTMLSelectElement).value).toBe('8')
    expect(view.store.getSnapshot().dance!.blocks).toBeUndefined()
    expect(view.store.getSnapshot().dance).toMatchObject({ parameters: { beats: 8 }, music: { beats: 8 } })
  })
})
