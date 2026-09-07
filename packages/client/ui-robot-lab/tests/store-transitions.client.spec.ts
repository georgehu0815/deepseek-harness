import { afterEach, describe, expect, it } from 'vitest'
import { createRobotStore } from '../src/client/store.ts'
import { fixtureProject } from './fixtures.client.ts'
import { evaluation, reflection, trial } from './learning-fixtures.client.ts'

const stores: ReturnType<ReturnType<typeof createRobotStore>['create']>[] = []
afterEach(() => { for (const store of stores.splice(0)) store.dispose() })

function createStore() {
  const store = createRobotStore().create()
  stores.push(store)
  return store
}

describe('robot viewing and authoring transitions', () => {
  it('keeps joint selection independent of body inspection and clears the body when selecting a duck', () => {
    const store = createStore()
    store.actions.selectedJoint(3)
    expect(store.getSnapshot()).toMatchObject({ selectedJoint: 3, selectedBody: null, inspector: false })
    store.actions.selectedBody(7)
    expect(store.getSnapshot()).toMatchObject({ selectedJoint: 3, selectedBody: 7, inspector: true })
    store.actions.inspector(false)
    expect(store.getSnapshot()).toMatchObject({ selectedJoint: 3, selectedBody: 7, inspector: false })
    store.actions.inspector(true)
    store.actions.addDuck()
    store.actions.selectDuck(2)
    expect(store.getSnapshot()).toMatchObject({ selectedDuck: 2, selectedJoint: 3, selectedBody: null, inspector: true })
  })

  it('centers a single circle member and ignores edits arriving after a member was removed', () => {
    const store = createStore()
    store.actions.arrangeDucks('circle', 0.8)
    expect(store.getSnapshot().ducks).toEqual([{ id: 1, name: 'Duck 1', policyId: null, projectRevisionId: null, x: 0, z: 0 }])
    store.actions.addDuck()
    store.actions.removeDuck(2)
    const before = store.getSnapshot()
    store.actions.updateDuck(2, { name: 'Removed member' })
    store.actions.trainDuck(2, fixtureProject)
    expect(store.getSnapshot()).toBe(before)
    expect(store.getSnapshot()).toMatchObject({ trainingDuck: null, dance: null, selectedDuck: 1 })
  })

  it('does not create an authoring draft from controls before a template is selected', () => {
    const store = createStore()
    const before = store.getSnapshot()
    store.actions.parameters({ bpm: 96 })
    store.actions.projectName('Unselected routine')
    store.actions.musicStyle('lofi')
    store.actions.musicVariation()
    store.actions.savedProject(0, fixtureProject.projectId, fixtureProject.id)
    expect(store.getSnapshot()).toBe(before)
  })

  it('opens an optional-backend historical trial as a CPU improvement without mutating its saved settings', () => {
    const store = createStore()
    const { backend: _backend, ...spec } = trial.recipe.spec
    const historical = { ...trial, recipe: { ...trial.recipe, spec } }
    store.actions.trainingBackend('mlx')
    store.actions.improvement(fixtureProject, historical, reflection)
    expect(store.getSnapshot()).toMatchObject({ trainingBackend: 'cpu', page: 'customize', savedEditVersion: -1,
      parentReflectionId: reflection.id, brief: { plannedChange: reflection.nextChange },
      steps: String(spec.steps), envs: String(spec.envs), seed: String(spec.seed) })
    expect(historical.recipe.spec).not.toHaveProperty('backend')
  })

  it('clears stale report, reflection and performance duration when the selected policy changes', () => {
    const store = createStore()
    store.actions.evaluation(evaluation.id)
    store.actions.reflection({ observation: 'Old observation', interpretation: 'Old interpretation', nextChange: 'Old change' })
    store.actions.simulationSteps(500)
    store.actions.policy(evaluation.policyId)
    expect(store.getSnapshot()).toMatchObject({ policyId: evaluation.policyId, evaluationId: null, simulationSteps: null,
      reflection: { observation: '', interpretation: '', nextChange: '' } })
    store.actions.evaluation(evaluation.id)
    store.actions.trial(trial.id)
    expect(store.getSnapshot()).toMatchObject({ trialId: trial.id, evaluationId: null })
  })
})
