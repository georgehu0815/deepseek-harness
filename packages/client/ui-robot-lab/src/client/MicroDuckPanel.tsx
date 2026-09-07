/** Tabbed training and evaluation controls; playback remains in Robot Studio. */
import { useEffect, useId, useMemo, useRef } from 'react'
import clsx from 'clsx'
import type { RobotMusicRecipe, RobotMotionBlock, RobotProjectRecipe } from '@deepseek-ai/dsh-robot-lab/types'
import type { MicroDuckProps } from './studio-props.ts'
import { trialRecipe } from './trial-draft.ts'
import { ClipEditor } from './ClipEditor.tsx'
import { TrainingObservations } from './TrainingObservations.tsx'
import { parseClipDraft } from './clip-draft.ts'
import { selectAuthoringDraft } from './draft-file.ts'
import { routinePosition } from './routine-position.ts'
import css from './MicroDuck.module.css'

const ICONS = ['♫', '✦', '↔', '◈', '♩', '★', '◎', '◉', '↗']
const DIFFICULTY = { starter: 'Starter', intermediate: 'Intermediate', advanced: 'Advanced' }
const CATEGORY = { dance: 'Dance', action: 'Action' }
const ACTIVITY: Record<string, string> = {
  refresh: 'Refreshing the local library…', readiness: 'Checking the connection…', studio: 'Loading movement templates…',
  projects: 'Loading saved projects…', project: 'Loading a saved revision…', save_project: 'Saving your revision…',
  reference_preview: 'Preparing the target preview…', train: 'Starting practice…', stop: 'Stopping practice…',
  runs: 'Checking practice progress…', run: 'Checking practice progress…', simulate: 'Recording a policy simulation…',
  trials: 'Loading saved trials…', evaluations: 'Loading measured evidence…', reflections: 'Loading saved reflections…',
  save_trial: 'Saving the learning plan…', save_and_train_trial: 'Saving the trial before starting training…', train_trial: 'Starting the saved trial…',
  evaluate_trial: 'Evaluating the frozen trial recipe…', save_reflection: 'Saving your interpretation…', improvement_source: 'Loading the exact parent project…',
  replay_evaluation: 'Re-simulating an episode with saved inputs…',
  evaluate: 'Evaluating the policy…', prepare: 'Checking deployment blockers…', generate_music: 'Generating original music…',
}
const MUSIC: ReadonlyArray<{ id: RobotMusicRecipe['style']; label: string }> = [
  { id: 'disco', label: 'Disco' }, { id: 'electronic', label: 'Electronic' }, { id: 'lofi', label: 'Lo-fi' }, { id: 'chiptune', label: 'Chiptune' },
]

/**
 * Render the native Micro Duck control plane for one captured session.
 * @param props - framework-bound project data, declared view store and finite operations.
 * @returns Train and Evaluate tabs retaining mounted forms when inactive.
 */
export function MicroDuckPanel(props: MicroDuckProps) {
  const lab = props.useLab(value => value)
  const view = props.useStore(value => value)
  const activeTab = view.page === 'evaluate' || view.page === 'perform' ? 'evaluate' : 'train'
  const tabsId = useId()
  const tabButtons = useRef<Partial<Record<'train' | 'evaluate', HTMLButtonElement>>>({})
  const draftRead = useRef<AbortController | null>(null)
  useEffect(() => () => { draftRead.current?.abort() }, [])
  const draft = view.dance
  const motionBlocks = draft?.blocks
  const catalog = lab.catalog
  const choiceProfile = catalog?.profiles[0]
  const profile = draft === null ? choiceProfile : catalog?.profiles.find(item => item.id === draft.profileId)
  const template = catalog?.templates.find(item => item.id === draft?.templateId)
  const sourceKnown = draft === null || (profile !== undefined && template !== undefined
    && (motionBlocks === undefined || motionBlocks.every(block => catalog?.templates.some(item => item.id === block.templateId))))
  const project = lab.projects.find(item => item.id === view.savedRevisionId)
  const saved = project !== undefined && view.savedEditVersion === view.editVersion
  const clip = useMemo(() => parseClipDraft(view.clipJson), [view.clipJson])
  const customClip = clip.clip
  const behaviorId = view.customTraining ? view.behaviorId : project?.training.behaviorId ?? template?.behaviorId
  const behavior = lab.behaviors.find(item => item.id === behaviorId)
  const validSource = view.customTraining ? clip.clip !== null && clip.error === null && view.name.trim() !== '' : saved
  const activeRun = lab.runs.find(item => item.state === 'starting' || item.state === 'running')
  const busy = lab.busy !== null
  const ready = lab.readiness?.ready === true
  const backend = lab.readiness?.backends[view.trainingBackend]
  const budget = view.steps === '' ? behavior?.defaultSteps ?? 0 : Number(view.steps)
  const validTraining = Number.isSafeInteger(budget) && budget > 0 && Number.isSafeInteger(Number(view.envs)) && Number(view.envs) > 0
    && view.envs.trim() !== '' && view.seed.trim() !== '' && Number.isSafeInteger(Number(view.seed)) && Number(view.seed) >= 0
  const duration = draft === null ? 0 : draft.parameters.beats * 60 / draft.parameters.bpm
  const validDraft = draft !== null && catalog !== null && sourceKnown && draft.name.trim() !== '' && Number.isFinite(duration)
    && duration > 0 && duration <= catalog.limits.maxClipSeconds
    && draft.parameters.bpm >= catalog.limits.minBpm && draft.parameters.bpm <= catalog.limits.maxBpm
    && (motionBlocks === undefined ? catalog.limits.beatChoices.includes(draft.parameters.beats)
      : motionBlocks.length > 0 && motionBlocks.length <= catalog.limits.maxProjectBlocks)
  const parentKnown = view.parentReflectionId === null || lab.reflections.some(item => item.id === view.parentReflectionId)
  const plannedTrial = parentKnown ? trialRecipe(view, saved ? project : undefined, behavior, props.evaluation) : null
  const trainingHintId = useId()
  const briefComplete = (['goal', 'prediction', 'plannedChange', 'evidence'] as const)
    .every(key => view.brief[key].trim() !== '')
  const trainingHint = busy ? 'guide.trainBusy' : activeRun !== undefined ? 'guide.trainActive'
    : !validSource ? view.customTraining ? 'guide.customSource' : 'guide.trainSource'
      : !view.customTraining && !briefComplete ? 'guide.trainBrief'
        : !validTraining || behavior === undefined || (!view.customTraining && plannedTrial === null) ? 'guide.trainSettings'
          : !ready || !lab.readiness?.capabilities.train.available || !backend?.available ? 'guide.trainRuntime'
            : 'guide.trainReady'
  const followsDraft = saved && project.id === lab.recordingProject?.id
  const replayTime = props.usePlayback(value => followsDraft ? value.time : 0)
  const position = followsDraft ? routinePosition(project.blocks, project.recipe.parameters.bpm, replayTime) : null
  const blockChoices = catalog?.limits.blockBeatChoices ?? []
  const blockBeats = blockChoices[0]
  const maxBlocks = catalog?.limits.maxProjectBlocks ?? 0
  const reorder = (sequence: readonly RobotMotionBlock[], index: number, direction: -1 | 1) => {
    const blocks = [...sequence]
    blocks.splice(index + direction, 0, ...blocks.splice(index, 1))
    props.actions.blocks(blocks)
  }
  const save = (target: RobotProjectRecipe, preview: boolean) => {
    if (preview && saved) {
      props.openStudio(); props.execute({ operation: 'reference_preview', projectRevisionId: project.id })
    } else props.saveProject(target, view.editVersion, preview)
  }

  return <section className={css.panel} aria-label="Micro Duck control panel" data-conversation-composer-overlay="">
    <header className={css.hero}>
      <div><span className={css.eyebrow}>{props.t('workspace.eyebrow')}</span><h1>Micro Duck</h1>
        <p>{props.t('workspace.description')}</p></div>
      <div className={css.robotPill}>{profile?.label ?? 'Robot Studio'}</div>
    </header>
    <div className={css.connectionBar}>
      <div className={css.status} role="status">{lab.busy !== null ? ACTIVITY[lab.busy] ?? 'Working…' : ready ? 'Local robot lab connected' : 'Connect the local robot lab to begin'}</div>
      <button type="button" onClick={props.refresh} disabled={busy}>{ready ? 'Refresh library' : 'Check connection'}</button>
    </div>
    {!ready && !busy && <p className={css.status}>{props.t('guide.readiness')}</p>}
    {!ready && lab.readiness?.reason && <details><summary>{props.t('guide.diagnostics')}</summary>
      <p className={css.hash}>{lab.readiness.reason}</p>
    </details>}
    {lab.error !== null && <p role="alert" className={css.error}>{lab.error}</p>}
    <p className={css.safetyNote}>{props.t('workspace.safety')}</p>
    <div className={css.tabs} role="tablist" aria-label={props.t('workspace.tabs')}>
      {(['train', 'evaluate'] as const).map(tab => <button key={tab} type="button" role="tab" className={css.tab}
        id={`${tabsId}-${tab}-tab`} aria-controls={`${tabsId}-${tab}-panel`} aria-selected={activeTab === tab}
        tabIndex={activeTab === tab ? 0 : -1} ref={(button) => { if (button !== null) tabButtons.current[tab] = button }}
        onClick={() => { props.actions.page(tab) }} onKeyDown={(event) => {
          let next: 'train' | 'evaluate'
          switch (event.key) {
            case 'ArrowLeft': case 'ArrowRight': next = tab === 'train' ? 'evaluate' : 'train'; break
            case 'Home': next = 'train'; break
            case 'End': next = 'evaluate'; break
            default: return
          }
          event.preventDefault()
          props.actions.page(next)
          tabButtons.current[next]?.focus()
        }}>{props.t(`workspace.${tab}`)}</button>)}
    </div>
    <div className={css.workspace}>
      <section className={css.column} role="tabpanel" id={`${tabsId}-train-panel`}
        aria-labelledby={`${tabsId}-train-tab`} hidden={activeTab !== 'train'}>
        <header className={css.columnHeader}>
          <div><h2>{props.t('workspace.train')}</h2><p>{props.t('workspace.trainSubtitle')}</p></div>
        </header>
        <div className={css.columnBody}>
          <section className={css.guide} aria-label={props.t('guide.label')}>
            <strong>{props.t('guide.train')}</strong><p>{props.t('guide.trainBody')}</p>
          </section>
          <details className={css.targetSetup}>
            <summary>{props.t('workspace.target')}</summary>
            <section className={css.guide} aria-label={props.t('draft.label')}>
              <p role="status">{props.t(view.persistence === null ? 'draft.disabled'
                : view.persistence.state === 'blocked' ? `draft.blocked.${view.persistence.reason}` : `draft.${view.persistence.state}`)}</p>
              <details><summary>{props.t('draft.files')}</summary>
                <p>{props.t('draft.scope')}</p><p>{props.t('draft.retention')}</p>
                <button type="button" disabled={busy} onClick={() => { props.saveDraft(selectAuthoringDraft(view)) }}>{props.t('draft.export')}</button>
                <label>{props.t('draft.import')}<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file === undefined) return
                  draftRead.current?.abort()
                  const reading = new AbortController(); draftRead.current = reading
                  if (file.size > props.draftMaxBytes) { props.loadDraft({ error: 'size' }); return }
                  void file.text().then((text) => {
                    if (!reading.signal.aborted) props.loadDraft({ text })
                  }, () => {
                    if (!reading.signal.aborted) props.loadDraft({ error: 'read' })
                  })
                }} /></label>
              </details>
            </section>
            {!parentKnown && <p role="status">{props.t('draft.parentMissing')}</p>}
            {!sourceKnown && <p role="status">{props.t('draft.sourceMissing')}</p>}
            {view.trainingDuck !== null && <div className={css.card}>
              <strong>Individual training for {view.ducks.find(duck => duck.id === view.trainingDuck)?.name}</strong>
              <p>Train this routine independently. When the run completes, assign its exported policy to this duck in Robot Studio.
                Parallel environments train one policy, not a group.</p>
              <div className={css.actions}><button type="button" onClick={props.openStudio}>Manage dance group ↗</button>
                <button type="button" onClick={() => { props.actions.finishDuckEditing() }}>Leave duck training setup</button></div>
            </div>}
            <>
              <div className={css.sectionHeading}><h2>What will your robot learn?</h2><button type="button" onClick={props.openStudio}>Open Studio ↗</button></div>
              <p className={css.muted}>Start with gentle movements. Every card is an authored target, not a pre-trained skill.</p>
              <div className={css.grid}>{catalog?.templates.map((item, index) => <button type="button" key={item.id}
                className={clsx(css.template, draft?.templateId === item.id && css.chosen)} disabled={busy || choiceProfile === undefined}
                onClick={choiceProfile === undefined ? undefined : () => { props.actions.chooseTemplate(choiceProfile, item) }}>
                <span className={css.templateIcon} aria-hidden="true">{ICONS[index % ICONS.length]}</span>
                <strong>{item.label}</strong><small>{item.description}</small>
                {item.id === 'head-bob' && <span className={css.recommendation}>{props.t('guide.recommended')}</span>}
                <span className={css.tag}>{DIFFICULTY[item.difficulty]} · {CATEGORY[item.category]}</span>
              </button>)}</div>
              {catalog !== null && catalog.templates.length === 0 && <p>No compatible motion templates are installed.</p>}
              {lab.projects.length > 0 && <div className={css.card}><h3>Continue a saved project</h3>
                <label>Saved revision<select defaultValue="" disabled={busy} onChange={(event) => {
                  const selected = lab.projects.find(item => item.id === event.target.value)
                  if (selected !== undefined) { props.actions.loadProject(selected); props.execute({ operation: 'project', projectRevisionId: selected.id }) }
                }}><option value="">Choose a saved project</option>{lab.projects.map(item => <option key={item.id} value={item.id}>{item.recipe.name} · {item.createdAt}</option>)}</select></label>
              </div>}
              <p className={css.status}>Only installed robot adapters are listed.
                Humanoid support needs a compatible model and controller—not just a new 3D mesh.</p>
            </>

            {draft === null ? <p>Choose a motion template first.</p> : <>
              <div className={css.sectionHeading}><h2>Make it yours</h2><span className={css.tag}>{saved ? 'Saved revision' : 'Unsaved changes'}</span></div>
              {!saved && <p className={css.status}>{props.t('draft.unsaved')}</p>}
              <label>Project name<input value={draft.name} disabled={busy}
                onChange={(event) => { props.actions.projectName(event.target.value) }} /></label>
              <div className={css.card}><h3>{motionBlocks === undefined ? template?.label ?? 'Motion target' : 'Block routine'}</h3>
                <label><span className={css.labelRow}><span>Move size</span>
                  <strong>{Math.round(draft.parameters.moveSize * 100)}%</strong></span>
                <input aria-label="Move size" type="range" min="0" max="1" step="0.05" value={draft.parameters.moveSize} disabled={busy}
                  onChange={(event) => { props.actions.parameters({ moveSize: Number(event.target.value) }) }} /></label>
                <div className={css.fields}><label>Tempo (BPM)<input type="number" min={catalog?.limits.minBpm} max={catalog?.limits.maxBpm}
                  value={draft.parameters.bpm} disabled={busy}
                  onChange={(event) => { props.actions.parameters({ bpm: Number(event.target.value) }) }} /></label>
                {motionBlocks === undefined ? <label>Length<select value={draft.parameters.beats} disabled={busy}
                  onChange={(event) => { props.actions.parameters({ beats: Number(event.target.value) }) }}>
                  {catalog?.limits.beatChoices.map(beats => <option key={beats} value={beats}>
                    {beats} beats · {(beats * 60 / draft.parameters.bpm).toFixed(1)} seconds</option>)}
                </select></label> : <label>Total length<input readOnly value={`${draft.parameters.beats} beats · ${duration.toFixed(1)} seconds`} /></label>}</div>
                <p className={css.muted}>Smaller moves are a better starting point.
                  The model's joint limits are checked when you save; balance still needs simulation.</p>
              </div>
              <div className={css.sectionHeading}><h2>Arrange your moves</h2>
                {motionBlocks === undefined ? <button type="button" disabled={busy || blockBeats === undefined}
                  onClick={blockBeats === undefined ? undefined : () => {
                    const beats = blockChoices.includes(draft.parameters.beats) ? draft.parameters.beats : blockBeats
                    props.actions.blocks([{ templateId: draft.templateId, templateVersion: draft.templateVersion, beats, moveSize: 1 }])
                  }}>Build with motion blocks</button> : <button type="button" disabled={busy || template === undefined}
                  onClick={template === undefined ? undefined : () => { props.actions.singleTemplate(template.defaultParameters.beats) }}>
                    Use one template</button>}
              </div>
              {motionBlocks !== undefined && <>
                <p className={css.muted}>Moves run from top to bottom. Each block starts and ends in the neutral pose.
                  Block size is relative to the overall Move size above; music length follows your blocks.</p>
                {motionBlocks.map((block, index) => <article key={index} className={clsx(css.card, position?.index === index && css.chosen)}
                  aria-label={`Motion block ${index + 1}`}>
                  <div className={css.fields}>
                    <label>Move {index + 1}<select aria-label={`Block ${index + 1} move`} value={block.templateId} disabled={busy}
                      onChange={(event) => {
                        const selected = catalog?.templates.find(item => item.id === event.target.value)
                        if (selected !== undefined) props.actions.blocks(motionBlocks.map((item, slot) =>
                          slot === index ? { ...item, templateId: selected.id, templateVersion: selected.version } : item))
                      }}>{catalog?.templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    <label>Block length<select aria-label={`Block ${index + 1} length`} value={block.beats} disabled={busy}
                      onChange={(event) => { props.actions.blocks(motionBlocks.map((item, slot) =>
                        slot === index ? { ...item, beats: Number(event.target.value) } : item)) }}>
                      {catalog?.limits.blockBeatChoices.map(beats => <option key={beats} value={beats}>{beats} beats</option>)}
                    </select></label>
                  </div>
                  <label><span className={css.labelRow}><span>Relative move size</span>
                    <strong>{Math.round(block.moveSize * 100)}%</strong></span>
                  <input type="range" aria-label={`Block ${index + 1} move size`} min="0" max="1" step="0.05" value={block.moveSize}
                    disabled={busy} onChange={(event) => { props.actions.blocks(motionBlocks.map((item, slot) =>
                      slot === index ? { ...item, moveSize: Number(event.target.value) } : item)) }} /></label>
                  <div className={css.actions}>
                    <button type="button" disabled={busy || index === 0} onClick={() => { reorder(motionBlocks, index, -1) }}>Move up</button>
                    <button type="button" disabled={busy || index === motionBlocks.length - 1}
                      onClick={() => { reorder(motionBlocks, index, 1) }}>Move down</button>
                    <button type="button" disabled={busy || motionBlocks.length >= maxBlocks} onClick={() => {
                      props.actions.blocks([...motionBlocks.slice(0, index + 1), { ...block }, ...motionBlocks.slice(index + 1)])
                    }}>Duplicate</button>
                    <button type="button" disabled={busy || motionBlocks.length === 1} onClick={() => {
                      props.actions.blocks(motionBlocks.filter((_, slot) => slot !== index))
                    }}>Remove</button>
                  </div>
                </article>)}
                <button type="button" disabled={busy || blockBeats === undefined || motionBlocks.length >= maxBlocks}
                  onClick={blockBeats === undefined ? undefined : () => {
                    props.actions.blocks([...motionBlocks,
                      { templateId: draft.templateId, templateVersion: draft.templateVersion, beats: blockBeats, moveSize: 1 }])
                  }}>Add a move</button>
                <p className={css.status}>{motionBlocks.length} / {catalog?.limits.maxProjectBlocks} blocks · {draft.parameters.beats} beats
                  {duration > (catalog?.limits.maxClipSeconds ?? 0) && ' · Shorten the routine to fit the configured duration limit.'}</p>
              </>}
              <div className={css.sectionHeading}><h2>Give it a soundtrack</h2>
                <span className={css.tag}>Original · Local · No account</span></div>
              <div className={css.card}><div className={css.fields}><label>Music style<select value={draft.music.style} disabled={busy}
                onChange={(event) => {
                  const style = MUSIC.find(item => item.id === event.target.value)
                  if (style !== undefined) props.actions.musicStyle(style.id)
                }}>
                {MUSIC.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label>Variation<input readOnly value={draft.music.seed + 1} aria-label="Music variation" /></label></div>
              <p className={css.muted}>Percussion, bass and melody follow the same {draft.music.bpm} BPM beat grid.
                Music is generated when you play the saved target.</p>
              <div className={css.actions}>
                <button type="button" disabled={busy} onClick={() => { props.actions.musicVariation() }}>Try another variation</button>
                <button type="button" disabled={busy || !validDraft}
                  onClick={() => { props.downloadMusic(draft.music) }}>Generate music (WAV)</button></div>
              </div>
              <div className={css.timeline} aria-label="Routine beat timeline">
                {motionBlocks === undefined ? <div className={css.phrase}>
                  <strong>Beats 1–{draft.parameters.beats}</strong><br />{template?.label}</div>
                  : motionBlocks.map((block, index) => {
                    const first = motionBlocks.slice(0, index).reduce((sum, item) => sum + item.beats, 0) + 1
                    return <div className={clsx(css.phrase, position?.index === index && css.chosen)} key={index}>
                      <strong>{first}–{first + block.beats - 1}</strong><br />
                      {catalog?.templates.find(item => item.id === block.templateId)?.label}
                    </div>
                  })}
              </div>
              <p className={css.status}>Target preview uses forward kinematics—not learned behavior or a balance test.
                Editing tempo or movement requires a new saved revision and training run.</p>
              <div className={css.actions}><button type="button" disabled={busy || !validDraft} onClick={() => { save(draft, false) }}>Save revision</button>
                <button type="button" disabled={busy || !validDraft} onClick={() => { save(draft, true) }}>Preview target in Studio</button>
              </div>
              {project !== undefined && <details><summary>Inspect generated joint targets</summary>
                <pre className={css.hash}>{JSON.stringify(project.clip, null, 2)}</pre></details>}
            </>}
          </details>
          {props.renderSlot('conversation.micro-duck.learning-plan', {})}
          <>
            <div className={css.sectionHeading}><h3>{props.t('workspace.trainingSettings')}</h3></div>
            {!saved && !view.customTraining && <p className={css.status}>{props.t('workspace.saveTarget')}</p>}
            {view.customTraining && <p className={css.status}>Custom joint experiment · not linked to your project or its soundtrack</p>}
            <details><summary>Advanced: custom joint experiment</summary>
              <label className={css.check}><input type="checkbox" checked={view.customTraining} disabled={busy || activeRun !== undefined}
                onChange={(event) => { props.actions.customTraining(event.target.checked) }} />Use a custom joint clip for training</label>
              {view.customTraining && <fieldset disabled={busy || activeRun !== undefined}>
                <p className={css.muted}>Custom edits are frozen in the training run, not in your saved project.
                  The template preview does not include these edits. Custom runs have no beat-linked soundtrack.</p>
                <label>Custom experiment ID<input value={view.name}
                  onChange={(event) => { props.actions.name(event.target.value) }} /></label>
                <label>Custom reward recipe<select value={view.behaviorId} onChange={(event) => {
                  const selected = lab.behaviors.find(item => item.id === event.target.value)
                  if (selected !== undefined) props.actions.behavior(selected.id, selected.defaultSteps)
                }}><option value="">Choose a registered reward recipe</option>
                  {lab.behaviors.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                {behavior !== undefined && <p className={css.muted}>{behavior.description}</p>}
                <button type="button" disabled={project === undefined}
                  onClick={project === undefined ? undefined : () => { props.actions.clip(JSON.stringify(project.clip, null, 2)) }}>
                  Copy saved target into editor</button>
                <label>Custom clip JSON<textarea value={view.clipJson} spellCheck={false} rows={7}
                  onChange={(event) => { props.actions.clip(event.target.value) }} /></label>
                {clip.error !== null && <p role="alert" className={css.error}>{clip.error}</p>}
                {clip.clip !== null && lab.scene !== null && <ClipEditor clip={clip.clip} jointNames={lab.scene.jointNames}
                  onChange={(value) => { props.actions.clip(JSON.stringify(value, null, 2)) }} />}
                <p className={css.muted}>The backend checks the actual model's joint limits at admission.
                  A numeric pose is not a balance or safety test.</p>
              </fieldset>}
            </details>
            <div className={css.card}>
              <label>{props.t('backend.label')}<select value={view.trainingBackend} disabled={busy || activeRun !== undefined}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'cpu' || value === 'mlx' || value === 'rlx') props.actions.trainingBackend(value)
                }}>
                <option value="cpu">{props.t('backend.cpu')}</option>
                <option value="mlx">{props.t('backend.mlx')}</option>
                <option value="rlx">{props.t('backend.rlx')}</option></select></label>
              <p className={css.muted}>{props.t(`backend.${view.trainingBackend}Description`)}</p>
              {backend?.available !== true && <p className={css.status}>{backend?.reason ?? props.t('backend.checkConnection')}</p>}
              <label>Practice budget<select value={String(budget)} disabled={busy || activeRun !== undefined}
                onChange={(event) => { props.actions.steps(event.target.value) }}>
                {[...new Set([props.quickCheckSteps, behavior?.defaultSteps ?? 0, (behavior?.defaultSteps ?? 0) * 2, budget])]
                  .filter(value => value > 0).map(value =>
                    <option key={value} value={value}>{props.t(value === props.quickCheckSteps ? 'budget.quick'
                      : value === behavior?.defaultSteps ? 'budget.default'
                        : value === (behavior?.defaultSteps ?? 0) * 2 ? 'budget.longer' : 'budget.custom')} · {value.toLocaleString()} steps</option>)}
              </select></label>
              <details><summary>Advanced training settings</summary><div className={css.fields}>
                <label>Training steps<input type="number" min="1" value={Number.isFinite(budget) ? budget : ''} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.steps(event.target.value) }} /></label>
                <label>Parallel environments<input type="number" min="1" value={view.envs} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.envs(event.target.value) }} /></label>
                <label>Random seed<input type="number" min="0" value={view.seed} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.seed(event.target.value) }} /></label>
              </div></details>
              <p id={trainingHintId} className={css.status}>{props.t(trainingHint)}</p>
              <p className={css.muted}>{props.t(budget === props.quickCheckSteps ? 'guide.quickCheck' : 'guide.trainingBudget')}</p>
              <div className={css.actions}><button type="button" className={css.primary} aria-describedby={trainingHintId}
                disabled={!validSource || !validTraining || !ready || !lab.readiness?.capabilities.train.available
            || !backend?.available || busy || activeRun !== undefined || behavior === undefined
            || (!view.customTraining && plannedTrial === null)}
                onClick={view.customTraining ? behavior === undefined || customClip === null ? undefined : () => {
                  props.execute({ operation: 'train', spec: { behaviorId: behavior.id, backend: view.trainingBackend, steps: budget,
                    envs: Number(view.envs), seed: Number(view.seed), actuator: 'bam', name: view.name, clip: customClip,
                    weights: Object.fromEntries(behavior.terms.map(term => [term.key, term.weight])) } })
                } : plannedTrial === null ? undefined : () => { props.saveTrial(plannedTrial, true) }}>
                {view.customTraining ? 'Start custom experiment' : 'Save and start trial'}</button>
              {!view.customTraining && <button type="button" disabled={busy || plannedTrial === null}
                onClick={plannedTrial === null ? undefined : () => { props.saveTrial(plannedTrial, false) }}>Save trial</button>}
              <button type="button" disabled={activeRun === undefined || busy}
                onClick={activeRun === undefined ? undefined : () => { props.execute({ operation: 'stop', runId: activeRun.id }) }}>Stop training</button></div>
            </div>
            <p className={css.muted}>Training completion is not skill completion.
              Quick checks validate setup; longer budgets do not guarantee a learned dance. Closing this panel does not stop training.</p>
            {lab.runs.length > 0 && <h3>{props.t('guide.trainingProgress')}</h3>}
            {lab.runs.map((run) => {
              const policyId = run.policyId
              return <article key={run.id} className={css.run}>
                <strong>{run.spec.projectSnapshot?.recipe.name ?? run.spec.name} · {run.state}</strong>
                <small>{props.t(`backend.${run.spec.backend}Run`)}</small>
                {run.progress !== null && <><progress aria-label={`${run.spec.name} training budget`} value={run.progress.steps} max={run.progress.total} />
                  <p>{run.progress.steps.toLocaleString()} / {run.progress.total.toLocaleString()} steps
                    · {run.progress.elapsedSeconds.toFixed(1)} seconds
                  {run.progress.elapsedSeconds > 0 && ` · ${(run.progress.steps / run.progress.elapsedSeconds).toFixed(0)} training steps/s (average)`}</p></>}
                <TrainingObservations run={run} t={props.t} />
                {run.error !== null && <p role="alert" className={css.error}>{run.error}</p>}
                {policyId !== null && <button type="button" onClick={() => { props.actions.policy(policyId); props.actions.page('evaluate') }}>Review this run</button>}
              </article>
            })}
            {lab.incompatibleRuns.length > 0 && <details><summary>Unsupported run records ({lab.incompatibleRuns.length})</summary>
              <p>These files are preserved but cannot be executed. Train a new experiment; do not edit recorded hashes.</p>
              {lab.incompatibleRuns.map(run => <p key={run.id}>{run.id}: {run.reason}</p>)}</details>}
          </>
        </div>
      </section>
      <section className={css.column} role="tabpanel" id={`${tabsId}-evaluate-panel`}
        aria-labelledby={`${tabsId}-evaluate-tab`} hidden={activeTab !== 'evaluate'}>
        <header className={css.columnHeader}>
          <div><h2>{props.t('workspace.evaluate')}</h2><p>{props.t('workspace.evaluateSubtitle')}</p></div>
        </header>
        <div className={css.columnBody}>
          <section className={css.guide} aria-label={props.t('guide.label')}>
            <strong>{props.t('guide.evaluate')}</strong><p>{props.t('guide.evaluateBody')}</p>
          </section>
          {props.renderSlot('conversation.micro-duck.learning-review', {})}
        </div>
      </section>
    </div>
  </section>
}
