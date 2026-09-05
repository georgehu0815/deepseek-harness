/** Beginner-facing project authoring and PPO controls; playback remains in the right Studio. */
import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import type { RobotMusicRecipe } from '@deepseek-ai/dsh-robot-lab/types'
import type { MicroDuckProps } from './studio-props.ts'
import type { DancePage } from './store.ts'
import { trialRecipe } from './trial-draft.ts'
import { ClipEditor } from './ClipEditor.tsx'
import { parseClipDraft } from './clip-draft.ts'
import { routinePosition } from './routine-position.ts'
import css from './MicroDuck.module.css'

const PAGES: ReadonlyArray<{ id: DancePage; label: string }> = [
  { id: 'choose', label: 'Choose' }, { id: 'customize', label: 'Customize' },
  { id: 'train', label: 'Train' }, { id: 'evaluate', label: 'Evaluate' }, { id: 'perform', label: 'Perform' },
]
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
 * @returns the guided template, authoring, training and review workflow.
 */
export function MicroDuckPanel(props: MicroDuckProps) {
  const lab = props.useLab(value => value)
  const view = props.useStore(value => value)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { if (panel.current !== null) panel.current.scrollTop = 0 }, [view.page])
  const draft = view.dance
  const motionBlocks = draft?.blocks
  const catalog = lab.catalog
  const profile = catalog?.profiles.find(item => item.id === draft?.profileId) ?? catalog?.profiles[0]
  const template = catalog?.templates.find(item => item.id === draft?.templateId)
  const project = lab.projects.find(item => item.id === view.savedRevisionId)
  const saved = project !== undefined && view.savedEditVersion === view.editVersion
  const clip = useMemo(() => parseClipDraft(view.clipJson), [view.clipJson])
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
  const validDraft = draft !== null && catalog !== null && draft.name.trim() !== '' && Number.isFinite(duration)
    && duration > 0 && duration <= catalog.limits.maxClipSeconds
    && draft.parameters.bpm >= catalog.limits.minBpm && draft.parameters.bpm <= catalog.limits.maxBpm
    && (motionBlocks === undefined ? catalog.limits.beatChoices.includes(draft.parameters.beats)
      : motionBlocks.length > 0 && motionBlocks.length <= catalog.limits.maxProjectBlocks)
  const plannedTrial = trialRecipe(view, saved ? project : undefined, behavior, props.evaluation)
  const currentPage = PAGES.findIndex(item => item.id === view.page)
  const followsDraft = view.page === 'customize' && saved && project.id === lab.recordingProject?.id
  const replayTime = props.usePlayback(value => followsDraft ? value.time : 0)
  const position = followsDraft ? routinePosition(project.blocks, project.recipe.parameters.bpm, replayTime) : null
  const blockBeats = catalog?.limits.blockBeatChoices[0]
  const reorder = (index: number, direction: -1 | 1) => {
    if (motionBlocks === undefined) return
    const blocks = [...motionBlocks]
    const current = blocks[index]; const adjacent = blocks[index + direction]
    if (current === undefined || adjacent === undefined) return
    blocks[index] = adjacent; blocks[index + direction] = current
    props.actions.blocks(blocks)
  }
  const save = (preview: boolean) => {
    if (preview && saved) {
      props.openStudio(); props.execute({ operation: 'reference_preview', projectRevisionId: project.id })
    } else if (draft !== null && validDraft) props.saveProject(draft, view.editVersion, preview)
  }

  return <section ref={panel} className={css.panel} aria-label="Micro Duck control panel" data-conversation-composer-overlay="">
    <header className={css.hero}>
      <div><span className={css.eyebrow}>Create · Practice · Perform</span><h1>Micro Duck</h1>
        <p>Small moves. Your music. A robot learning something new.</p></div>
      <div className={css.robotPill}><span aria-hidden="true">♩</span>{profile?.label ?? 'Robot Studio'}</div>
    </header>
    <nav className={css.steps} aria-label="Dance workflow">{PAGES.map((page, index) =>
      <button key={page.id} type="button" aria-current={view.page === page.id ? 'step' : undefined}
        className={clsx(css.step, view.page === page.id && css.active)} onClick={() => { props.actions.page(page.id) }}>
        <span className={css.stepNumber}>{index + 1}</span>{page.label}
      </button>)}</nav>
    <div className={css.status} role="status">{lab.busy !== null ? ACTIVITY[lab.busy] ?? 'Working…' : ready ? 'Local robot lab connected' : 'Connect the local robot lab to begin'}
      {!ready && lab.readiness?.reason && <span> · {lab.readiness.reason}</span>}
    </div>
    {lab.error !== null && <p role="alert" className={css.error}>{lab.error}</p>}
    <button type="button" onClick={props.refresh} disabled={busy}>{ready ? 'Refresh library' : 'Check connection'}</button>
    <p className={css.status}>Simulation only · Choreography completion and robustness unassessed · Hardware blocked</p>
    {view.trainingDuck !== null && <div className={css.card}>
      <strong>Individual training for {view.ducks.find(duck => duck.id === view.trainingDuck)?.name}</strong>
      <p>Train this routine independently. When the run completes, assign its exported policy to this duck in Robot Studio.
        Parallel environments train one policy, not a group.</p>
      <div className={css.actions}><button type="button" onClick={props.openStudio}>Manage dance group ↗</button>
        <button type="button" onClick={() => { props.actions.finishDuckEditing() }}>Leave duck training setup</button></div>
    </div>}
    {(view.page === 'choose' || view.page === 'customize' || view.page === 'train')
      && props.renderSlot('conversation.micro-duck.learning-plan', {})}

    {view.page === 'choose' && <>
      <div className={css.sectionHeading}><h2>What will your robot learn?</h2><button type="button" onClick={props.openStudio}>Open Studio ↗</button></div>
      <p className={css.muted}>Start with gentle movements. Every card is an authored target, not a pre-trained skill.</p>
      <div className={css.grid}>{catalog?.templates.map((item, index) => <button type="button" key={item.id}
        className={clsx(css.template, draft?.templateId === item.id && css.chosen)} disabled={busy || profile === undefined}
        onClick={() => { if (profile !== undefined) props.actions.chooseTemplate(profile, item) }}>
        <span className={css.templateIcon} aria-hidden="true">{ICONS[index % ICONS.length]}</span>
        <strong>{item.label}</strong><small>{item.description}</small>
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
    </>}

    {view.page === 'customize' && (draft === null ? <p>Choose a motion template first.</p> : <>
      <div className={css.sectionHeading}><h2>Make it yours</h2><span className={css.tag}>{saved ? 'Saved revision' : 'Unsaved changes'}</span></div>
      <label>Project name<input value={draft.name} disabled={busy}
        onChange={(event) => { props.actions.projectName(event.target.value) }} /></label>
      <div className={css.card}><h3>{motionBlocks === undefined ? template?.label ?? 'Motion target' : 'Block routine'}</h3>
        <label><span className={css.labelRow}><span>Move size</span><strong>{Math.round(draft.parameters.moveSize * 100)}%</strong></span>
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
        {motionBlocks === undefined ? <button type="button" disabled={busy || blockBeats === undefined} onClick={() => {
          if (blockBeats === undefined) return
          const beats = catalog?.limits.blockBeatChoices.includes(draft.parameters.beats) ? draft.parameters.beats : blockBeats
          props.actions.blocks([{ templateId: draft.templateId, templateVersion: draft.templateVersion, beats, moveSize: 1 }])
        }}>Build with motion blocks</button> : <button type="button" disabled={busy || template === undefined} onClick={() => {
          if (template !== undefined) props.actions.singleTemplate(template.defaultParameters.beats)
        }}>Use one template</button>}
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
          <label><span className={css.labelRow}><span>Relative move size</span><strong>{Math.round(block.moveSize * 100)}%</strong></span>
            <input type="range" aria-label={`Block ${index + 1} move size`} min="0" max="1" step="0.05" value={block.moveSize}
              disabled={busy} onChange={(event) => { props.actions.blocks(motionBlocks.map((item, slot) =>
                slot === index ? { ...item, moveSize: Number(event.target.value) } : item)) }} /></label>
          <div className={css.actions}>
            <button type="button" disabled={busy || index === 0} onClick={() => { reorder(index, -1) }}>Move up</button>
            <button type="button" disabled={busy || index === motionBlocks.length - 1}
              onClick={() => { reorder(index, 1) }}>Move down</button>
            <button type="button" disabled={busy || motionBlocks.length >= (catalog?.limits.maxProjectBlocks ?? 0)} onClick={() => {
              props.actions.blocks([...motionBlocks.slice(0, index + 1), { ...block }, ...motionBlocks.slice(index + 1)])
            }}>Duplicate</button>
            <button type="button" disabled={busy || motionBlocks.length === 1} onClick={() => {
              props.actions.blocks(motionBlocks.filter((_, slot) => slot !== index))
            }}>Remove</button>
          </div>
        </article>)}
        <button type="button" disabled={busy || blockBeats === undefined || motionBlocks.length >= (catalog?.limits.maxProjectBlocks ?? 0)}
          onClick={() => {
            if (blockBeats !== undefined) props.actions.blocks([...motionBlocks,
              { templateId: draft.templateId, templateVersion: draft.templateVersion, beats: blockBeats, moveSize: 1 }])
          }}>Add a move</button>
        <p className={css.status}>{motionBlocks.length} / {catalog?.limits.maxProjectBlocks} blocks · {draft.parameters.beats} beats
          {duration > (catalog?.limits.maxClipSeconds ?? 0) && ' · Shorten the routine to fit the configured duration limit.'}</p>
      </>}
      <div className={css.sectionHeading}><h2>Give it a soundtrack</h2><span className={css.tag}>Original · Local · No account</span></div>
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
              <strong>{first}–{first + block.beats - 1}</strong><br />{catalog?.templates.find(item => item.id === block.templateId)?.label}
            </div>
          })}
      </div>
      <p className={css.status}>Target preview uses forward kinematics—not learned behavior or a balance test.
        Editing tempo or movement requires a new saved revision and training run.</p>
      <div className={css.actions}><button type="button" disabled={busy || !validDraft} onClick={() => { save(false) }}>Save revision</button>
      </div>
      {project !== undefined && <details><summary>Inspect generated joint targets</summary>
        <pre className={css.hash}>{JSON.stringify(project.clip, null, 2)}</pre></details>}
    </>)}

    {view.page === 'train' && <>
      <div className={css.sectionHeading}><h2>Give your robot time to practice</h2></div>
      {!saved && !view.customTraining && <p className={css.status}>
        Save your current routine in Customize before starting a project-bound run.</p>}
      {view.customTraining && <p className={css.status}>Custom joint experiment · not linked to your project or its soundtrack</p>}
      <details><summary>Advanced: custom joint experiment</summary>
        <label className={css.check}><input type="checkbox" checked={view.customTraining} disabled={busy || activeRun !== undefined}
          onChange={(event) => { props.actions.customTraining(event.target.checked) }} />Use a custom joint clip for training</label>
        {view.customTraining && <fieldset disabled={busy || activeRun !== undefined}>
          <p className={css.muted}>Custom edits are frozen in the training run, not in your saved project.
            The template preview does not include these edits. Custom runs have no beat-linked soundtrack.</p>
          <label>Custom experiment ID<input value={view.name} onChange={(event) => { props.actions.name(event.target.value) }} /></label>
          <label>Custom reward recipe<select value={view.behaviorId} onChange={(event) => {
            const selected = lab.behaviors.find(item => item.id === event.target.value)
            if (selected !== undefined) props.actions.behavior(selected.id, selected.defaultSteps)
          }}><option value="">Choose a registered reward recipe</option>
            {lab.behaviors.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {behavior !== undefined && <p className={css.muted}>{behavior.description}</p>}
          <button type="button" disabled={project === undefined} onClick={() => {
            if (project !== undefined) props.actions.clip(JSON.stringify(project.clip, null, 2))
          }}>Copy saved target into editor</button>
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
        <label>Training backend<select value={view.trainingBackend} disabled={busy || activeRun !== undefined}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'cpu' || value === 'mlx') props.actions.trainingBackend(value)
          }}>
          <option value="cpu">CPU — Standard</option><option value="mlx">MLX GPU — Apple Silicon</option></select></label>
        <p className={css.muted}>{view.trainingBackend === 'mlx'
          ? 'Apple Metal trains the policy and critic. MuJoCo/BAM physics remains on CPU. This PPO recipe differs from CPU training; small runs may be slower.'
          : 'Stable-Baselines3 PPO learning and MuJoCo/BAM physics run on CPU.'}</p>
        {backend?.available !== true && <p className={css.status}>{backend?.reason ?? 'Check the backend connection.'}</p>}
        <label>Practice budget<select value={String(budget)} disabled={busy || activeRun !== undefined}
          onChange={(event) => { props.actions.steps(event.target.value) }}>
          {[...new Set([props.quickCheckSteps, behavior?.defaultSteps ?? 0, (behavior?.defaultSteps ?? 0) * 2, budget])]
            .filter(value => value > 0).map(value =>
              <option key={value} value={value}>{value === props.quickCheckSteps ? 'Quick check — setup only' : value === behavior?.defaultSteps ? 'Practice — recommended' : value === (behavior?.defaultSteps ?? 0) * 2 ? 'Longer practice' : 'Custom'} · {value.toLocaleString()} steps</option>)}
        </select></label>
        <details><summary>Advanced training settings</summary><div className={css.fields}>
          <label>Training steps<input type="number" min="1" value={budget} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.steps(event.target.value) }} /></label>
          <label>Parallel environments<input type="number" min="1" value={view.envs} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.envs(event.target.value) }} /></label>
          <label>Random seed<input type="number" min="0" value={view.seed} disabled={busy || activeRun !== undefined} onChange={(event) => { props.actions.seed(event.target.value) }} /></label>
        </div></details>
        <div className={css.actions}><button type="button" className={css.primary}
          disabled={!validSource || !validTraining || !ready || !lab.readiness?.capabilities.train.available
            || !backend?.available || busy || activeRun !== undefined || behavior === undefined
            || (!view.customTraining && plannedTrial === null)}
          onClick={() => {
            if (behavior === undefined) return
            const common = { behaviorId: behavior.id, backend: view.trainingBackend, steps: budget,
              envs: Number(view.envs), seed: Number(view.seed), actuator: 'bam' as const,
              weights: Object.fromEntries(behavior.terms.map(term => [term.key, term.weight])) }
            if (view.customTraining) {
              if (clip.clip !== null) props.execute({ operation: 'train', spec: { ...common, name: view.name, clip: clip.clip } })
            } else if (plannedTrial !== null) props.saveTrial(plannedTrial, true)
          }}>{view.customTraining ? 'Start custom experiment' : 'Save and start trial'}</button>
        {!view.customTraining && <button type="button" disabled={busy || plannedTrial === null} onClick={() => {
          if (plannedTrial !== null) props.saveTrial(plannedTrial, false)
        }}>Save trial</button>}
        <button type="button" disabled={activeRun === undefined || busy} onClick={() => { if (activeRun !== undefined) props.execute({ operation: 'stop', runId: activeRun.id }) }}>Stop training</button></div>
      </div>
      <p className={css.muted}>Training completion is not skill completion.
        Quick checks validate setup; longer budgets do not guarantee a learned dance. Closing this panel does not stop training.</p>
      {lab.runs.map(run => <article key={run.id} className={css.run}>
        <strong>{run.spec.projectSnapshot?.recipe.name ?? run.spec.name} · {run.state}</strong>
        <small>{run.spec.backend === 'mlx' ? 'MLX GPU learner' : 'CPU learner'} · CPU physics</small>
        {run.progress !== null && <><progress aria-label={`${run.spec.name} training budget`} value={run.progress.steps} max={run.progress.total} />
          <p>{run.progress.steps.toLocaleString()} / {run.progress.total.toLocaleString()} steps
            · {run.progress.elapsedSeconds.toFixed(1)} seconds
          {run.progress.elapsedSeconds > 0 && ` · ${(run.progress.steps / run.progress.elapsedSeconds).toFixed(0)} training steps/s (average)`}</p></>}
        {run.error !== null && <p role="alert" className={css.error}>{run.error}</p>}
        {run.policyId !== null && <button type="button" onClick={() => { if (run.policyId !== null) { props.actions.policy(run.policyId); props.actions.page('evaluate') } }}>Review this run</button>}
      </article>)}
      {lab.incompatibleRuns.length > 0 && <details><summary>Unsupported run records ({lab.incompatibleRuns.length})</summary>
        <p>These files are preserved but cannot be executed. Train a new experiment; do not edit recorded hashes.</p>
        {lab.incompatibleRuns.map(run => <p key={run.id}>{run.id}: {run.reason}</p>)}</details>}
    </>}

    {(view.page === 'evaluate' || view.page === 'perform') && props.renderSlot('conversation.micro-duck.learning-review', {})}
    <footer className={css.footer}><span className={css.muted}>{draft === null ? 'Choose a template to start' : `${draft.name} · ${Number.isFinite(duration) ? duration.toFixed(1) : '—'} seconds`}</span>
      {view.page === 'customize' && <button type="button" className={css.primary} disabled={busy || !validDraft}
        onClick={() => { save(true) }}>Preview target in Studio</button>}
      {currentPage < PAGES.length - 1 && <button type="button" className={css.primary} disabled={draft === null || busy}
        onClick={() => {
          const next = PAGES[currentPage + 1]
          if (next !== undefined) props.actions.page(next.id)
        }}>Next: {PAGES[currentPage + 1]?.label} →</button>}
    </footer>
  </section>
}
