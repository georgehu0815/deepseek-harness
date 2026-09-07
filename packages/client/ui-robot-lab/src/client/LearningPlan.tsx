/** Pre-training learning plans and saved trial admissions, separate from measured evidence. */
import type { LearningPlanProps } from './studio-props.ts'
import { assessmentFields } from './assessment-fields.ts'
import { ChoreographyEditor } from './ChoreographyEditor.tsx'
import { resolveAssessment, validChoreography } from './choreography-draft.ts'
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
  const resolved = resolveAssessment(assessment, view.choreography)
  const choreographyInvalid = resolved === null || (resolved.dance !== undefined && !validChoreography(resolved.dance))
  const selected = lab.trials.find(entry => entry.trial.id === view.trialId)
  const policyId = selected?.run?.policyId
  const active = lab.runs.some(run => run.state === 'starting' || run.state === 'running')
  const backend = selected?.trial.recipe.spec.backend ?? 'cpu'
  return <>
    <details className={css.card}>
      <summary>{props.t('plan.briefTitle')}</summary>
      <p className={css.muted}>{props.t('brief.intro')}</p>
      <fieldset disabled={busy}>
        <label>{props.t('plan.goal')}<textarea rows={4} value={view.brief.goal} placeholder={props.t('brief.goalPlaceholder')}
          onChange={(event) => { props.actions.brief({ goal: event.target.value }) }} /></label>
        <label>{props.t('plan.prediction')}<textarea rows={4} value={view.brief.prediction} placeholder={props.t('brief.predictionPlaceholder')}
          onChange={(event) => { props.actions.brief({ prediction: event.target.value }) }} /></label>
        <label>{props.t('plan.change')}<textarea rows={4} value={view.brief.plannedChange} placeholder={props.t('brief.changePlaceholder')}
          onChange={(event) => { props.actions.brief({ plannedChange: event.target.value }) }} /></label>
        <label>{props.t('plan.evidence')}<textarea rows={4} value={view.brief.evidence} placeholder={props.t('brief.evidencePlaceholder')}
          onChange={(event) => { props.actions.brief({ evidence: event.target.value }) }} /></label>
      </fieldset>
      <p className={css.muted}>{props.t('brief.note')}</p>
      <p className={css.status}>{props.t('brief.unsaved')}</p>
      {view.parentReflectionId !== null && <p className={css.hash}>{props.t('plan.improvement', { id: view.parentReflectionId })}</p>}
    </details>
    {!view.customTraining && <>
      <div className={css.card}><h3>{props.t('plan.assessmentTitle')}</h3>
        <p className={css.muted}>{props.t('plan.freezeNotice')}</p>
        <dl className={css.assessmentSummary}>
          <div><dt>{props.t('guide.assessmentEpisodes')}</dt><dd>{assessment.episodes}</dd></div>
          <div><dt>{props.t('guide.assessmentUpright')}</dt><dd>{assessment.minMeanUprightFraction}</dd></div>
          <div><dt>{props.t('guide.assessmentTerminations')}</dt><dd>{assessment.maxTerminations}</dd></div>
        </dl>
        <p className={css.muted}>{props.t('guide.assessmentHint')}</p>
        <details><summary>{props.t('guide.assessmentAdvanced')}</summary>
          <fieldset disabled={busy}><div className={css.fields}>{form.fields.map(field => <label key={field.key}>{props.t(field.label)}
            <input type="number" min={field.min} max={field.max} step={field.step} value={assessment[field.key]}
              onChange={(event) => { props.actions.assessment({ ...assessment, [field.key]: Number(event.target.value) }) }} />
          </label>)}</div></fieldset>
        </details>
        {form.error !== null && <p className={css.error}>{props.t(form.error)}</p>}
        <p>{props.t('plan.horizon', { seconds: assessment.stepsPerEpisode / 50,
          first: assessment.seed, last: assessment.seed + assessment.episodes - 1 })}</p>
        <ChoreographyEditor value={view.choreography} criteria={assessment.dance}
          profile={lab.catalog?.profiles.find(profile => profile.id === view.dance?.profileId)} disabled={busy} t={props.t}
          onChange={(value) => { props.actions.choreography(value, assessment) }} />
        {choreographyInvalid && <p role="alert" className={css.error}>{props.t('criteria.invalid')}</p>}
        <p className={css.muted}>{props.t((view.choreography?.enabled ?? (assessment.dance !== undefined))
          ? 'criteria.planned' : 'criteria.balanceOnly')}</p>
      </div>
      <div className={css.card}><h3>{props.t('plan.savedTrials')}</h3>
        <label>{props.t('plan.savedTrial')}<select value={view.trialId ?? ''} disabled={busy} onChange={(event) => {
          const entry = lab.trials.find(item => item.trial.id === event.target.value)
          if (entry !== undefined) props.actions.trial(entry.trial.id)
        }}><option value="">{props.t('plan.chooseTrial')}</option>{lab.trials.map(entry => <option key={entry.trial.id} value={entry.trial.id}>
            {entry.trial.recipe.brief.goal} · {entry.run?.state ?? props.t(entry.binding === null ? 'plan.notStarted' : 'plan.runUnavailable')}
            {' · '}{entry.trial.id}
          </option>)}</select></label>
        {selected !== undefined && <>
          <p className={css.hash}>{props.t('plan.trialHash', { id: selected.trial.id, hash: selected.trial.sha256 })}</p>
          <p className={css.hash}>{props.t('plan.targetHash', { id: selected.trial.projectRevisionId, hash: selected.trial.projectSha256 })}</p>
          <p>{props.t('plan.frozenGoal', { goal: selected.trial.recipe.brief.goal })}</p>
          <p>{props.t('plan.frozenPrediction', { prediction: selected.trial.recipe.brief.prediction })}</p>
          <p>{props.t('plan.frozenChange', { change: selected.trial.recipe.brief.plannedChange })}</p>
          <p>{props.t('plan.plannedEvidence', { evidence: selected.trial.recipe.brief.evidence })}</p>
          <p>{props.t('plan.trainingSettings', { steps: selected.trial.recipe.spec.steps, backend,
            seed: selected.trial.recipe.spec.seed, envs: selected.trial.recipe.spec.envs })}</p>
          <p>{props.t('plan.assessmentSettings', { episodes: selected.trial.recipe.evaluation.episodes,
            steps: selected.trial.recipe.evaluation.stepsPerEpisode, seed: selected.trial.recipe.evaluation.seed,
            terminations: selected.trial.recipe.evaluation.maxTerminations,
            upright: selected.trial.recipe.evaluation.minMeanUprightFraction })}</p>
          {selected.trial.recipe.evaluation.dance !== undefined && <details><summary>{props.t('criteria.frozen')}</summary>
            <pre>{JSON.stringify(selected.trial.recipe.evaluation.dance, null, 2)}</pre></details>}
          <p className={css.muted}>{props.t('plan.immutable')}</p>
          {selected.binding === null ? <button type="button" disabled={busy || active || !lab.readiness?.ready
            || !lab.readiness.capabilities.train.available || !lab.readiness.backends[backend].available}
          onClick={() => { props.execute({ operation: 'train_trial', trialId: selected.trial.id }) }}>{props.t('plan.startSaved')}</button>
            : <p className={css.hash}>{props.t('plan.boundRun', { id: selected.binding.runId,
              state: selected.run?.state ?? props.t('plan.boundRunUnavailable') })}</p>}
          {policyId != null && <button type="button" onClick={() => {
            props.actions.policy(policyId); props.actions.page('evaluate')
          }}>{props.t('plan.evaluatePolicy')}</button>}
        </>}
      </div>
    </>}
  </>
}
