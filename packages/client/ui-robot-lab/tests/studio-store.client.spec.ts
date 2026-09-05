import { describe, expect, it } from 'vitest'
import { createRobotStore } from '../src/client/store.ts'
import { fixtureProfile, fixtureProject, fixtureTemplate, fixtureBlockProject, fixtureSecondTemplate } from './fixtures.client.ts'

describe('session authoring state', () => {
  it('publishes block ordering, total length, soundtrack length and first template atomically', () => {
    const store = createRobotStore().create()
    store.actions.loadProject(fixtureBlockProject)
    const before = store.getSnapshot().editVersion
    const observations: Array<ReturnType<typeof store.getSnapshot>> = []
    const off = store.subscribe(() => { observations.push(store.getSnapshot()) })
    const blocks = [...fixtureBlockProject.recipe.blocks!].reverse().map((block, index) => ({ ...block, beats: index === 0 ? 8 : 4 }))
    store.actions.blocks(blocks)
    off()
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({ editVersion: before + 1, dance: {
      templateId: fixtureSecondTemplate.id, templateVersion: 1, blocks, parameters: { beats: 12 }, music: { beats: 12 },
    } })
    expect(fixtureBlockProject.recipe.parameters.beats).toBe(8)
    expect(fixtureBlockProject.recipe.blocks![0]!.templateId).toBe(fixtureTemplate.id)
  })

  it('uses the master size without changing relative block sizes and restores single-template timing', () => {
    const store = createRobotStore().create()
    store.actions.loadProject(fixtureBlockProject)
    const blocks = store.getSnapshot().dance!.blocks
    store.actions.parameters({ moveSize: 0.8, bpm: 90 })
    expect(store.getSnapshot().dance).toMatchObject({ blocks, parameters: { moveSize: 0.8, bpm: 90, beats: 8 },
      music: { bpm: 90, beats: 8 } })
    store.actions.singleTemplate(16)
    expect(store.getSnapshot().dance!.blocks).toBeUndefined()
    expect(store.getSnapshot().dance).toMatchObject({ templateId: fixtureTemplate.id, parameters: { beats: 16 }, music: { beats: 16 } })
  })

  it('does not publish an empty-block edit or edit a missing draft', () => {
    const store = createRobotStore().create()
    const before = store.getSnapshot()
    store.actions.blocks(fixtureBlockProject.recipe.blocks!)
    store.actions.singleTemplate(8)
    expect(store.getSnapshot()).toBe(before)
    store.actions.loadProject(fixtureBlockProject)
    const loaded = store.getSnapshot()
    store.actions.blocks([])
    expect(store.getSnapshot()).toBe(loaded)
  })

  it('synchronizes authoring tempo and beat count with the music recipe', () => {
    const store = createRobotStore().create()
    store.actions.chooseTemplate(fixtureProfile, fixtureTemplate)
    store.actions.parameters({ bpm: 90, beats: 16, moveSize: 0.5 })
    expect(store.getSnapshot().dance).toMatchObject({ parameters: { bpm: 90, beats: 16, moveSize: 0.5 },
      music: { bpm: 90, beats: 16, seed: 0 } })
    expect(store.getSnapshot()).toMatchObject({ page: 'customize', editVersion: 2, savedRevisionId: null })
  })

  it('does not mark a newer edit saved when an earlier admission finishes', () => {
    const store = createRobotStore().create()
    store.actions.chooseTemplate(fixtureProfile, fixtureTemplate)
    const admittedVersion = store.getSnapshot().editVersion
    store.actions.projectName('Newer edit')
    store.actions.savedProject(admittedVersion, fixtureProject.projectId, fixtureProject.id)
    expect(store.getSnapshot()).toMatchObject({ savedRevisionId: null, savedEditVersion: -1, dance: { name: 'Newer edit' } })
    const currentVersion = store.getSnapshot().editVersion
    store.actions.savedProject(currentVersion, fixtureProject.projectId, fixtureProject.id)
    expect(store.getSnapshot()).toMatchObject({ savedRevisionId: fixtureProject.id, savedEditVersion: currentVersion,
      dance: { projectId: fixtureProject.projectId } })
  })

  it('starts a new template without retaining the previous saved revision or training budget', () => {
    const store = createRobotStore().create()
    store.actions.loadProject(fixtureProject)
    store.actions.customTraining(true)
    store.actions.steps('4096')
    store.actions.chooseTemplate(fixtureProfile, fixtureTemplate)
    expect(store.getSnapshot()).toMatchObject({ savedRevisionId: null, savedEditVersion: -1, steps: '', customTraining: false,
      dance: { projectId: null, name: fixtureTemplate.label } })
  })

  it('restores project training mode when loading a saved revision', () => {
    const store = createRobotStore().create()
    store.actions.customTraining(true)
    store.actions.loadProject(fixtureProject)
    expect(store.getSnapshot()).toMatchObject({ customTraining: false, savedRevisionId: fixtureProject.id, page: 'customize' })
  })

  it('isolates sessions and preserves a frozen project when draft actions change nested fields', () => {
    const handle = createRobotStore()
    const first = handle.create('one')
    const second = handle.create('two')
    first.actions.loadProject(fixtureProject)
    first.actions.parameters({ bpm: 80 })
    first.actions.musicVariation()
    expect(first.getSnapshot().dance).toMatchObject({ parameters: { bpm: 80 }, music: { seed: 1 } })
    expect(second.getSnapshot().dance).toBeNull()
    expect(fixtureProject.recipe.parameters.bpm).toBe(120)
    expect(fixtureProject.recipe.music.seed).toBe(0)
  })
})
