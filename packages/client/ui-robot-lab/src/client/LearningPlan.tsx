/** Pre-training learning plans and saved trial admissions, separate from measured evidence. */
import type { LearningPlanProps } from './studio-props.ts'
import { assessmentFields } from './assessment-fields.ts'
import css from './MicroDuck.module.css'

/**
 * Present the shared learning draft and the immutable plan of an explicitly selected trial.
 * @param props - this section's framework-derived session, shared draft and injected controller bindings.
 * @returns editable planning controls and independently resumable saved trial history.
 */
export function LearningPlan(props: LearningPlanProps) {
  const view = props.useStore(value => value)
  const lab = props.useLab(value => value)
  const busy = lab.busy !== null
  const assessment = view.assessment ?? props.evaluation
  const form = assessmentFields(assessment)
  const selected = lab.trials.find(entry => entry.trial.id === view.trialId)
  const active = lab.runs.some(run => run.state === 'starting' || run.state === 'running')
  const backend = selected?.trial.recipe.spec.backend ?? 'cpu'
  return <>
    <details className={css.card} open={view.page === 'choose' || view.page === 'train'}>
      <summary>Learning brief · planned, not measured</summary>
      <p className={css.muted}>Start small. Predict what will change, then compare recorded evidence rather than the target preview.</p>
      <fieldset disabled={busy}>
        <label>Learning goal<textarea rows={2} value={view.brief.goal}
          onChange={(event) => { props.actions.brief({ goal: event.target.value }) }} /></label>
        <label>Prediction<textarea rows={2} value={view.brief.prediction}
          onChange={(event) => { props.actions.brief({ prediction: event.target.value }) }} /></label>
        <label>Planned change<textarea rows={2} value={view.brief.plannedChange}
          onChange={(event) => { props.actions.brief({ plannedChange: event.target.value }) }} /></label>
        <label>Evidence to examine<textarea rows={2} value={view.brief.evidence}
          onChange={(event) => { props.actions.brief({ evidence: event.target.value }) }} /></label>
      </fieldset>
      <p className={css.muted}>This is your evidence plan, not a measured result. All four fields are required to save a guided trial.</p>
      {view.parentReflectionId !== null && <p className={css.hash}>Improvement draft · parent reflection {view.parentReflectionId}.
        Unsaved changes must be reviewed and saved. Starting creates a new run, not a warm start.</p>}
    </details>
    {view.page === 'train' && !view.customTraining && <>
      <div className={css.card}><h3>Assessment planned before training</h3>
        <p className={css.muted}>These criteria freeze with the trial. Perform's simulation duration cannot change them.</p>
        <fieldset disabled={busy}><div className={css.fields}>{form.fields.map(field => <label key={field.key}>{field.label}
          <input type="number" min={field.min} max={field.max} step={field.step} value={assessment[field.key]}
            onChange={(event) => { props.actions.assessment({ ...assessment, [field.key]: Number(event.target.value) }) }} />
        </label>)}</div></fieldset>
        {form.error !== null && <p className={css.error}>{form.error}</p>}
        <p>Requested horizon: {assessment.stepsPerEpisode / 50} seconds per episode · seeds {assessment.seed}–{
          assessment.seed + assessment.episodes - 1}.</p>
        <p className={css.muted}>Upright and termination criteria only.
          Choreography completion, robustness and hardware suitability remain unassessed.</p>
      </div>
      <div className={css.card}><h3>Saved trials</h3>
        <label>Saved trial<select value={view.trialId ?? ''} disabled={busy} onChange={(event) => {
          const entry = lab.trials.find(item => item.trial.id === event.target.value)
          if (entry !== undefined) props.actions.trial(entry.trial.id)
        }}><option value="">Choose an immutable trial</option>{lab.trials.map(entry => <option key={entry.trial.id} value={entry.trial.id}>
            {entry.trial.recipe.brief.goal} · {entry.run?.state ?? (entry.binding === null ? 'not started' : 'run unavailable')} · {entry.trial.id}
          </option>)}</select></label>
        {selected !== undefined && <>
          <p className={css.hash}>Trial {selected.trial.id} · SHA-256 {selected.trial.sha256}</p>
          <p className={css.hash}>Target {selected.trial.projectRevisionId} · SHA-256 {selected.trial.projectSha256}</p>
          <p>Frozen goal: {selected.trial.recipe.brief.goal}</p><p>Frozen prediction: {selected.trial.recipe.brief.prediction}</p>
          <p>Frozen planned change: {selected.trial.recipe.brief.plannedChange}</p>
          <p>Planned evidence: {selected.trial.recipe.brief.evidence}</p>
          <p>{selected.trial.recipe.spec.steps} training steps · {backend} · seed {selected.trial.recipe.spec.seed}
            {' · '}{selected.trial.recipe.spec.envs} environments</p>
          <p>{selected.trial.recipe.evaluation.episodes} assessment episodes · {selected.trial.recipe.evaluation.stepsPerEpisode} steps each
            {' · '}seed {selected.trial.recipe.evaluation.seed}
            {' · '}maximum terminations {selected.trial.recipe.evaluation.maxTerminations}
            {' · '}minimum upright {selected.trial.recipe.evaluation.minMeanUprightFraction}</p>
          <p className={css.muted}>Saved trial settings above are immutable; editing the draft creates a different trial.</p>
          {selected.binding === null ? <button type="button" disabled={busy || active || !lab.readiness?.ready
            || !lab.readiness.capabilities.train.available || !lab.readiness.backends[backend].available}
          onClick={() => { props.execute({ operation: 'train_trial', trialId: selected.trial.id }) }}>Start saved trial</button>
            : <p className={css.hash}>Bound run {selected.binding.runId} · {selected.run?.state ?? 'Run unavailable'}.
              This trial cannot start a second run.</p>}
          {selected.run?.policyId != null && <button type="button" onClick={() => {
            if (selected.run?.policyId != null) { props.actions.policy(selected.run.policyId); props.actions.page('evaluate') }
          }}>Evaluate this policy</button>}
        </>}
      </div>
    </>}
  </>
}
