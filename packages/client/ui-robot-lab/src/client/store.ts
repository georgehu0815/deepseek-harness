/** Viewing and authoring preferences; server experiment data belongs to LabClient. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { RobotPolicyId, RobotTrainingBackend, RobotProjectRecipe, RobotProjectId, RobotProjectRevision,
  RobotProfile, RobotTemplate, RobotStudioParameters, RobotMusicRecipe, RobotProjectRevisionId, RobotMotionBlock,
  RobotTrialId, RobotTrial, RobotLearningBrief, RobotReflectionId, RobotReflection, RobotEvaluationId, RobotEvaluationCriteria } from '@deepseek-ai/dsh-robot-lab/types'
import type { ViewerCameraView, ViewerSurface } from './viewer-presets.ts'
import type { DuckMember } from './group-playback.ts'
import type { RosterFile } from './roster-file.ts'

/** Guided center-panel stages. */
export type DancePage = 'choose' | 'customize' | 'train' | 'evaluate' | 'perform'

/** Shared interaction state, never a replacement for committed learning records. */
export type RobotDraft = {
  page: DancePage
  brief: RobotLearningBrief
  assessment: RobotEvaluationCriteria | null
  trialId: RobotTrialId | null
  parentReflectionId: RobotReflectionId | null
  evaluationId: RobotEvaluationId | null
  baselineId: RobotEvaluationId | null
  reflection: { observation: string; interpretation: string; nextChange: string }
  dance: RobotProjectRecipe | null
  editVersion: number
  savedEditVersion: number
  savedRevisionId: RobotProjectRevisionId | null
  selectedJoint: number
  selectedBody: number | null
  inspector: boolean
  customTraining: boolean
  behaviorId: string
  trainingWeights: Record<string, number> | null
  trainingBackend: RobotTrainingBackend
  policyId: RobotPolicyId | null
  name: string
  steps: string
  envs: string
  seed: string
  clipJson: string
  simulationSteps: number | null
  surface: ViewerSurface
  cameraView: ViewerCameraView
  cameraReset: number
  expandedViewer: boolean
  ducks: DuckMember[]
  nextDuckId: number
  selectedDuck: number
  trainingDuck: number | null
  formation: 'line' | 'grid' | 'circle'
  groupSpacing: number
}

function firstDuck(members: readonly DuckMember[]): DuckMember {
  const first = members[0]
  if (first === undefined) throw new Error('Duck roster must contain at least one member.')
  return first
}

function arrange(draft: RobotDraft): void {
  const count = draft.ducks.length
  const columns = Math.ceil(Math.sqrt(count))
  for (const [index, duck] of draft.ducks.entries()) {
    const spacing = draft.groupSpacing
    switch (draft.formation) {
      case 'line': duck.x = (index - (count - 1) / 2) * spacing; duck.z = 0; break
      case 'grid':
        duck.x = (index % columns - (columns - 1) / 2) * spacing
        duck.z = (Math.floor(index / columns) - (Math.ceil(count / columns) - 1) / 2) * spacing
        break
      case 'circle': {
        const radius = count === 1 ? 0 : spacing / (2 * Math.sin(Math.PI / count))
        duck.x = Math.cos(index * 2 * Math.PI / count) * radius
        duck.z = Math.sin(index * 2 * Math.PI / count) * radius
        break
      }
      default: { const unexpected: never = draft.formation; throw new Error(`Unknown formation: ${String(unexpected)}`) }
    }
  }
}

/**
 * Create the session panel's draft store.
 * @param defaultEnvCount - configured initial parallel environment count.
 * @param maxGroupMembers - configured roster ceiling, enforced by add and duplicate actions.
 * @returns framework-owned view state with explicit mutation actions.
 */
export function createRobotStore(defaultEnvCount = 4, maxGroupMembers = 8): EngineStoreHandle<RobotDraft, {
  replaceRoster: (draft: RobotDraft, value: RosterFile) => void
  addDuck: (draft: RobotDraft) => void
  duplicateDuck: (draft: RobotDraft, id: number) => void
  removeDuck: (draft: RobotDraft, id: number) => void
  selectDuck: (draft: RobotDraft, id: number) => void
  updateDuck: (draft: RobotDraft, id: number, value: Partial<Omit<DuckMember, 'id'>>) => void
  arrangeDucks: (draft: RobotDraft, formation: RobotDraft['formation'], spacing: number) => void
  trainDuck: (draft: RobotDraft, id: number, project: RobotProjectRevision) => void
  finishDuckEditing: (draft: RobotDraft) => void
  page: (draft: RobotDraft, value: DancePage) => void
  brief: (draft: RobotDraft, value: Partial<RobotLearningBrief>) => void
  assessment: (draft: RobotDraft, value: RobotEvaluationCriteria) => void
  trial: (draft: RobotDraft, value: RobotTrialId) => void
  evaluation: (draft: RobotDraft, value: RobotEvaluationId) => void
  baseline: (draft: RobotDraft, value: RobotEvaluationId | null) => void
  reflection: (draft: RobotDraft, value: Partial<RobotDraft['reflection']>) => void
  improvement: (draft: RobotDraft, project: RobotProjectRevision, trial: RobotTrial, reflection: RobotReflection) => void
  chooseTemplate: (draft: RobotDraft, profile: RobotProfile, template: RobotTemplate) => void
  parameters: (draft: RobotDraft, value: Partial<RobotStudioParameters>) => void
  blocks: (draft: RobotDraft, value: RobotMotionBlock[]) => void
  singleTemplate: (draft: RobotDraft, beats: number) => void
  projectName: (draft: RobotDraft, value: string) => void
  musicStyle: (draft: RobotDraft, value: RobotMusicRecipe['style']) => void
  musicVariation: (draft: RobotDraft) => void
  loadProject: (draft: RobotDraft, value: RobotProjectRevision) => void
  savedProject: (draft: RobotDraft, editVersion: number, id: RobotProjectId, revisionId: RobotProjectRevisionId) => void
  selectedJoint: (draft: RobotDraft, value: number) => void
  selectedBody: (draft: RobotDraft, value: number) => void
  inspector: (draft: RobotDraft, value: boolean) => void
  customTraining: (draft: RobotDraft, value: boolean) => void
  behavior: (draft: RobotDraft, id: string, steps: number) => void
  trainingBackend: (draft: RobotDraft, value: RobotTrainingBackend) => void
  policy: (draft: RobotDraft, id: RobotPolicyId) => void
  name: (draft: RobotDraft, value: string) => void
  steps: (draft: RobotDraft, value: string) => void
  envs: (draft: RobotDraft, value: string) => void
  seed: (draft: RobotDraft, value: string) => void
  clip: (draft: RobotDraft, value: string) => void
  simulationSteps: (draft: RobotDraft, value: number) => void
  surface: (draft: RobotDraft, value: ViewerSurface) => void
  cameraView: (draft: RobotDraft, value: ViewerCameraView) => void
  resetCamera: (draft: RobotDraft) => void
  expandedViewer: (draft: RobotDraft, value: boolean) => void
}> {
  return defineStore({
    init: () => ({ page: 'choose' as DancePage, dance: null as RobotProjectRecipe | null, editVersion: 0,
      brief: { goal: '', prediction: '', plannedChange: '', evidence: '' }, assessment: null as RobotEvaluationCriteria | null,
      trialId: null as RobotTrialId | null, parentReflectionId: null as RobotReflectionId | null,
      evaluationId: null as RobotEvaluationId | null, baselineId: null as RobotEvaluationId | null,
      reflection: { observation: '', interpretation: '', nextChange: '' },
      savedEditVersion: -1, savedRevisionId: null as RobotProjectRevisionId | null,
      selectedJoint: 0, selectedBody: null as number | null, inspector: false, customTraining: false,
      behaviorId: '', trainingWeights: null as Record<string, number> | null, policyId: null as RobotPolicyId | null,
      name: 'duck-groove', steps: '', envs: String(defaultEnvCount), seed: '0', clipJson: '', simulationSteps: null,
      surface: 'studio' as ViewerSurface, cameraView: 'perspective' as ViewerCameraView, cameraReset: 0, expandedViewer: false,
      trainingBackend: 'cpu' as RobotTrainingBackend,
      ducks: [{ id: 1, name: 'Duck 1', policyId: null, projectRevisionId: null, x: 0, z: 0 }] as DuckMember[],
      nextDuckId: 2, selectedDuck: 1, trainingDuck: null as number | null,
      formation: 'line' as RobotDraft['formation'], groupSpacing: 0.6 }),
    actions: {
      replaceRoster: (draft, value: RosterFile) => {
        draft.ducks = value.members; draft.nextDuckId = Math.max(...value.members.map(duck => duck.id)) + 1
        draft.selectedDuck = firstDuck(value.members).id; draft.trainingDuck = null; draft.selectedBody = null
        draft.formation = value.formation; draft.groupSpacing = value.spacing
      },
      addDuck: (draft) => {
        if (draft.ducks.length >= maxGroupMembers) return
        const id = draft.nextDuckId++
        draft.ducks.push({ id, name: `Duck ${id}`, policyId: null, projectRevisionId: null, x: 0, z: 0 })
        draft.selectedDuck = id; arrange(draft)
      },
      duplicateDuck: (draft, id: number) => {
        const source = draft.ducks.find(duck => duck.id === id)
        if (source === undefined || draft.ducks.length >= maxGroupMembers) return
        const next = draft.nextDuckId++
        draft.ducks.push({ ...source, id: next, name: `${Array.from(source.name).slice(0, 75).join('')} copy` })
        draft.selectedDuck = next; arrange(draft)
      },
      removeDuck: (draft, id: number) => {
        if (draft.ducks.length <= 1) return
        draft.ducks = draft.ducks.filter(duck => duck.id !== id)
        if (draft.selectedDuck === id) draft.selectedDuck = firstDuck(draft.ducks).id
        if (draft.trainingDuck === id) draft.trainingDuck = null
        arrange(draft)
      },
      selectDuck: (draft, id: number) => { draft.selectedDuck = id; draft.selectedBody = null },
      updateDuck: (draft, id: number, value: Partial<Omit<DuckMember, 'id'>>) => {
        const duck = draft.ducks.find(item => item.id === id)
        if (duck !== undefined) Object.assign(duck, value)
      },
      arrangeDucks: (draft, formation: RobotDraft['formation'], spacing: number) => {
        draft.formation = formation; draft.groupSpacing = spacing; arrange(draft)
      },
      trainDuck: (draft, id: number, project: RobotProjectRevision) => {
        const duck = draft.ducks.find(item => item.id === id)
        if (duck === undefined) return
        duck.projectRevisionId = project.id
        draft.trainingDuck = id; draft.selectedDuck = id
        draft.dance = { ...project.recipe, projectId: project.projectId }; draft.editVersion += 1
        draft.savedRevisionId = project.id; draft.savedEditVersion = draft.editVersion
        draft.customTraining = false; draft.trainingWeights = null; draft.steps = ''
        draft.parentReflectionId = null; draft.trialId = null; draft.page = 'train'
        draft.brief = { goal: '', prediction: '', plannedChange: '', evidence: '' }
        draft.assessment = null
      },
      finishDuckEditing: (draft) => { draft.trainingDuck = null },
      page: (draft, value: DancePage) => { draft.page = value },
      brief: (draft, value: Partial<RobotLearningBrief>) => { Object.assign(draft.brief, value) },
      assessment: (draft, value: RobotEvaluationCriteria) => { draft.assessment = value },
      trial: (draft, value: RobotTrialId) => { draft.trialId = value; draft.evaluationId = null },
      evaluation: (draft, value: RobotEvaluationId) => {
        draft.evaluationId = value; draft.reflection = { observation: '', interpretation: '', nextChange: '' }
      },
      baseline: (draft, value: RobotEvaluationId | null) => { draft.baselineId = value },
      reflection: (draft, value: Partial<RobotDraft['reflection']>) => { Object.assign(draft.reflection, value) },
      improvement: (draft, project: RobotProjectRevision, trial: RobotTrial, reflection: RobotReflection) => {
        draft.dance = { ...project.recipe, projectId: project.projectId }
        draft.editVersion += 1; draft.savedRevisionId = project.id; draft.savedEditVersion = -1
        draft.brief = { ...trial.recipe.brief, plannedChange: reflection.nextChange }
        draft.assessment = trial.recipe.evaluation; draft.parentReflectionId = reflection.id
        draft.trainingBackend = trial.recipe.spec.backend ?? 'cpu'
        draft.steps = String(trial.recipe.spec.steps)
        draft.envs = String(trial.recipe.spec.envs); draft.seed = String(trial.recipe.spec.seed)
        draft.behaviorId = trial.recipe.spec.behaviorId; draft.trainingWeights = trial.recipe.spec.weights; draft.customTraining = false
        draft.trialId = null; draft.trainingDuck = null; draft.page = 'customize'
      },
      chooseTemplate: (draft, profile: RobotProfile, template: RobotTemplate) => {
        draft.dance = { projectId: null, name: template.label, profileId: profile.id, templateId: template.id,
          templateVersion: template.version, parameters: { ...template.defaultParameters },
          music: { version: 1, style: 'disco', bpm: template.defaultParameters.bpm, beats: template.defaultParameters.beats, seed: 0 } }
        draft.editVersion += 1; draft.page = 'customize'; draft.steps = ''; draft.savedRevisionId = null; draft.savedEditVersion = -1
        draft.customTraining = false; draft.parentReflectionId = null; draft.trialId = null; draft.trainingWeights = null
      },
      parameters: (draft, value: Partial<RobotStudioParameters>) => {
        if (draft.dance === null) return
        Object.assign(draft.dance.parameters, value)
        draft.dance.music.bpm = draft.dance.parameters.bpm
        draft.dance.music.beats = draft.dance.parameters.beats
        draft.editVersion += 1
      },
      blocks: (draft, value: RobotMotionBlock[]) => {
        const first = value[0]
        if (draft.dance === null || first === undefined) return
        draft.dance.blocks = value
        draft.dance.templateId = first.templateId; draft.dance.templateVersion = first.templateVersion
        draft.dance.parameters.beats = value.reduce((total, block) => total + block.beats, 0)
        draft.dance.music.beats = draft.dance.parameters.beats
        draft.editVersion += 1
      },
      singleTemplate: (draft, beats: number) => {
        if (draft.dance === null) return
        delete draft.dance.blocks
        draft.dance.parameters.beats = beats; draft.dance.music.beats = beats
        draft.editVersion += 1
      },
      projectName: (draft, value: string) => { if (draft.dance !== null) { draft.dance.name = value; draft.editVersion += 1 } },
      musicStyle: (draft, value: RobotMusicRecipe['style']) => { if (draft.dance !== null) { draft.dance.music.style = value; draft.editVersion += 1 } },
      musicVariation: (draft) => {
        if (draft.dance !== null) { draft.dance.music.seed = (draft.dance.music.seed + 1) % 2147483648; draft.editVersion += 1 }
      },
      loadProject: (draft, value: RobotProjectRevision) => {
        draft.dance = { ...value.recipe, projectId: value.projectId }; draft.editVersion += 1; draft.page = 'customize'
        draft.savedRevisionId = value.id; draft.savedEditVersion = draft.editVersion; draft.customTraining = false
        draft.parentReflectionId = null; draft.trialId = null; draft.trainingWeights = null
      },
      savedProject: (draft, editVersion: number, id: RobotProjectId, revisionId: RobotProjectRevisionId) => {
        if (draft.dance !== null && draft.editVersion === editVersion) {
          draft.dance.projectId = id; draft.savedRevisionId = revisionId; draft.savedEditVersion = editVersion
        }
      },
      selectedJoint: (draft, value: number) => { draft.selectedJoint = value },
      selectedBody: (draft, value: number) => { draft.selectedBody = value; draft.inspector = true },
      inspector: (draft, value: boolean) => { draft.inspector = value },
      customTraining: (draft, value: boolean) => { draft.customTraining = value; draft.steps = '' },
      behavior: (draft, id: string, steps: number) => { draft.behaviorId = id; draft.steps = String(steps) },
      trainingBackend: (draft, value: RobotTrainingBackend) => { draft.trainingBackend = value },
      policy: (draft, id: RobotPolicyId) => {
        draft.policyId = id; draft.simulationSteps = null; draft.evaluationId = null
        draft.reflection = { observation: '', interpretation: '', nextChange: '' }
      },
      name: (draft, value: string) => { draft.name = value },
      steps: (draft, value: string) => { draft.steps = value },
      envs: (draft, value: string) => { draft.envs = value },
      seed: (draft, value: string) => { draft.seed = value },
      clip: (draft, value: string) => { draft.clipJson = value },
      simulationSteps: (draft, value: number) => { draft.simulationSteps = value },
      surface: (draft, value: ViewerSurface) => { draft.surface = value },
      cameraView: (draft, value: ViewerCameraView) => { draft.cameraView = value },
      resetCamera: (draft) => { draft.cameraReset += 1 },
      expandedViewer: (draft, value: boolean) => { draft.expandedViewer = value },
    },
  })
}
