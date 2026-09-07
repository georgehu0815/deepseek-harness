/** Independent policy assessment, descriptive comparison and reflection in Evaluate. */
import type { LearningReviewProps } from './studio-props.ts'
import { policyStatus } from './policy-status.ts'
import { assessmentSummary, validAssessment } from './evaluation-evidence.ts'
import { assessmentFields } from './assessment-fields.ts'
import { reviewEvidence } from './review-evidence.ts'
import { DanceEvidence } from './DanceEvidence.tsx'
import { resolveAssessment } from './choreography-draft.ts'
import css from './MicroDuck.module.css'

const danceComparisonLabel = {
  matching: 'dance.compareMatching', different: 'dance.compareDifferent',
  missing: 'dance.compareMissing', unassessed: 'dance.compareUnassessed',
} as const

/**
 * Display recorded evidence without allowing playback controls to rewrite a trial's criteria.
 * @param props - shared session data, draft actions and captured-session operation callbacks.
 * @returns assessment controls with persistent evidence and observe/improve actions.
 */
export function LearningReview(props: LearningReviewProps) {
  const lab = props.useLab(value => value)
  const view = props.useStore(value => value)
  const evidence = reviewEvidence(lab, view)
  const { policy, report, run, trial, reportTrial, baseline, comparison } = evidence
  const busy = lab.busy !== null
  const ready = lab.readiness?.ready === true
  const canSimulate = ready && !busy && policy?.runtimeCompatibility.available === true
    && lab.readiness?.capabilities.simulate.available === true
  const canEvaluate = ready && !busy && policy?.runtimeCompatibility.available === true
    && lab.readiness?.capabilities.evaluate.available === true
  const project = run?.spec.projectSnapshot
  const resolved = trial?.trial.recipe.evaluation ?? resolveAssessment(view.assessment ?? props.evaluation, view.choreography)
  const assessment = resolved ?? view.assessment ?? props.evaluation
  const form = assessmentFields(assessment)
  const reflectionValid = Object.values(view.reflection).every(value => value.trim() !== '')
  return <>
    <div className={css.sectionHeading}><h3>{props.t('assessment.title')}</h3>
      <button type="button" onClick={props.openStudio}>{props.t('review.openStudio')}</button></div>
    <label>{props.t('review.trainedPolicy')}<select value={view.policyId ?? ''} disabled={busy} onChange={(event) => {
      const selected = lab.policies.find(item => item.id === event.target.value)
      if (selected !== undefined) props.actions.policy(selected.id)
    }}><option value="">{props.t('review.choosePolicy')}</option>{lab.policies.map(item => <option key={item.id} value={item.id}>
        {props.t('review.policyOption', {
          name: lab.runs.find(candidate => candidate.policyId === item.id && candidate.policySha256 === item.sha256)
            ?.spec.projectSnapshot?.recipe.name ?? item.name,
          status: props.t(policyStatus(item, report)),
        })}
      </option>)}</select></label>
    {policy !== undefined && <div className={css.card}>
      <h3>{project?.recipe.name ?? policy.name}</h3>
      <p className={css.hash}>{props.t('review.policyIdentity', { id: policy.id, hash: policy.sha256 })}</p>
      <p>{props.t(policyStatus(policy, report))}</p>
      {!policy.runtimeCompatibility.available && <p className={css.error}>{policy.runtimeCompatibility.reason}</p>}
      <>
        <p>{trial === undefined ? props.t('review.exploratoryAssessment') : props.t('review.frozenAssessment', { id: trial.trial.id })}</p>
        <p>{props.t('review.assessmentHorizon', {
          episodes: assessment.episodes, steps: assessment.stepsPerEpisode, seconds: assessment.stepsPerEpisode / 50,
          firstSeed: assessment.seed, lastSeed: assessment.seed + assessment.episodes - 1,
        })}</p>
        <p>{props.t('review.assessmentLimits', {
          terminations: assessment.maxTerminations, upright: assessment.minMeanUprightFraction,
        })}</p>
        {trial === undefined && <details><summary>{props.t('review.exploratorySettings')}</summary>
          <p className={css.muted}>{props.t('review.exploratorySettingsScope')}</p>
          <fieldset disabled={busy}><div className={css.fields}>{form.fields.map(field => <label key={field.key}>{props.t(field.label)}
            <input type="number" min={field.min} max={field.max} step={field.step} value={assessment[field.key]}
              onChange={(event) => {
                props.actions.assessment({ ...(view.assessment ?? props.evaluation), [field.key]: Number(event.target.value) })
              }} />
          </label>)}</div></fieldset>
          {form.error !== null && <p className={css.error}>{props.t(form.error)}</p>}
        </details>}
        {resolved === null && <p role="alert">{props.t('criteria.invalid')}</p>}
        <button type="button" className={css.primary} disabled={!canEvaluate || resolved === null || !validAssessment(resolved)}
          onClick={resolved === null ? undefined : () => {
            if (trial !== undefined) props.execute({ operation: 'evaluate_trial', trialId: trial.trial.id })
            else props.execute({ operation: 'evaluate', spec: { ...resolved, policyId: policy.id } })
          }}>{props.t(trial === undefined ? 'review.checkPolicy' : 'review.evaluateTrial')}</button>
      </>
    </div>}
    <div className={css.card}><h3>{props.t('review.evidenceHistory')}</h3>
      <label>{props.t('review.evaluationReport')}<select value={report?.id ?? ''} disabled={busy} onChange={(event) => {
        const selected = evidence.reports.find(item => item.id === event.target.value)
        if (selected !== undefined) { props.actions.policy(selected.policyId); props.actions.evaluation(selected.id) }
      }}><option value="">{props.t('review.chooseReport')}</option>{evidence.reports.map(item => <option key={item.id} value={item.id}>
          {props.t('review.reportOption', {
            id: item.id, policyId: item.policyId,
            status: props.t(item.passed ? 'assessment.balancePassed' : 'assessment.balanceFailed'), evaluatedAt: item.evaluatedAt,
          })}
        </option>)}</select></label>
      {evidence.reports.length === 0 && <p>{props.t('review.noReports')}</p>}
      {lab.incompleteEvaluations > 0 && <p>{props.t('review.incompleteAdmissions', { count: lab.incompleteEvaluations })}</p>}
      {!ready && <p>{props.t('review.historyAvailable')}</p>}
    </div>
    {report !== null && <>
      {policy === undefined || policy.id !== report.policyId || policy.sha256 !== report.policyHash ? <p className={css.status}>
        {props.t('review.historicalReport')}</p> : null}
      <label>{props.t('review.baselineReport')}<select value={view.baselineId ?? ''} disabled={busy} onChange={(event) => {
        props.actions.baseline(evidence.reports.find(item => item.id === event.target.value)?.id ?? null)
      }}><option value="">{props.t('review.noBaseline')}</option>{evidence.reports.filter(item => item.id !== report.id).map(item =>
          <option key={item.id} value={item.id}>{props.t('review.baselineOption', { id: item.id, policyId: item.policyId })}</option>)}</select></label>
      {[{ value: report, source: evidence.reportRun, baseline: false }, ...(baseline === undefined || baseline.id === report.id ? []
        : [{ value: baseline, source: evidence.baselineRun, baseline: true }])].map(({ value, source, baseline: isBaseline }) => {
        const measured = assessmentSummary(value)
        const linked = lab.trials.find(item => item.binding?.runId === source?.id && source !== undefined)
        return <article className={css.card} key={value.id} aria-label={props.t(isBaseline ? 'review.baselineEvidence' : 'review.selectedEvidence')}>
          <h3>{isBaseline ? props.t('review.baselineReport') : props.t(value.passed ? 'assessment.balancePassed' : 'assessment.balanceFailed')}</h3>
          {isBaseline && <p>{props.t(value.passed ? 'assessment.balancePassed' : 'assessment.balanceFailed')}</p>}
          <p className={css.muted}>{props.t('assessment.balanceOnly')}</p>
          <p className={css.hash}>{props.t('review.reportIdentity', { id: value.id, evaluatedAt: value.evaluatedAt })}</p>
          <p className={css.hash}>{props.t('review.reportPolicyIdentity', { id: value.policyId, hash: value.policyHash })}</p>
          <p className={css.hash}>{props.t('review.trialIdentity', {
            id: linked?.trial.id ?? props.t('review.notLinked'), hash: linked?.trial.sha256 ?? props.t('review.notLoaded'),
          })}</p>
          <p className={css.hash}>{props.t('review.runIdentity', {
            id: source?.id ?? props.t('review.notLoaded'), hash: source?.recipeHash ?? props.t('review.notLoaded'),
          })}</p>
          <p className={css.hash}>{props.t('review.projectIdentity', {
            id: source?.spec.projectSnapshot?.id ?? props.t('review.notLinked'),
            hash: source?.spec.projectSnapshot?.sha256 ?? props.t('review.notLoaded'),
          })}</p>
          {linked !== undefined && <><p>{props.t('review.plannedGoal', { goal: linked.trial.recipe.brief.goal })}</p>
            <p>{props.t('review.prediction', { prediction: linked.trial.recipe.brief.prediction })}</p>
            <p>{props.t('review.plannedChange', { change: linked.trial.recipe.brief.plannedChange })}</p>
            <p>{props.t('review.evidencePlan', { evidence: linked.trial.recipe.brief.evidence })}</p></>}
          {source !== undefined && <p>{props.t('review.training', {
            backend: source.spec.backend, steps: source.spec.steps, seed: source.spec.seed, environments: source.spec.envs,
          })}</p>}
          <p>{props.t('review.recordedCriteria', {
            episodes: value.spec.episodes, steps: value.spec.stepsPerEpisode, seed: value.spec.seed,
            terminations: value.spec.maxTerminations, upright: value.spec.minMeanUprightFraction,
          })}</p>
          <div className={css.metricGrid}>
            <div className={css.metric}>
              <small>{props.t('review.meanUpright')}</small><strong>{props.t('review.percent', { value: (measured.upright * 100).toFixed(1) })}</strong>
            </div>
            <div className={css.metric}><small>{props.t('review.terminatedEpisodes')}</small><strong>{measured.terminations}</strong></div>
          </div>
          <p>{props.t('review.trackingSummary', {
            error: measured.poseDegrees === null ? props.t('assessment.notRecorded') : props.t('review.degrees', { value: measured.poseDegrees.toFixed(1) }),
            measured: measured.trackingEpisodes, total: measured.episodeCount,
          })}</p>
          <p className={css.muted}>{props.t('review.balanceScope')}</p>
          <DanceEvidence report={value} t={props.t} />
          <details><summary>{props.t('review.exactInputs')}</summary><pre className={css.hash}>{JSON.stringify({
            spec: value.spec, dancePlan: value.dancePlan, physics: value.physics,
            observationProfile: value.observationProfile, training: source?.spec,
            sourceFingerprint: source?.sourceFingerprint, trainingProvenance: source?.provenance }, null, 2)}</pre></details>
          {!isBaseline && policy?.runId === null && <p>{props.t('review.ownedRunRequired')}</p>}
          {!isBaseline && value.episodes.map((episode, index) => <div className={css.run} key={index}>
            <strong>{props.t('review.episode', { episode: index + 1, seed: episode.seed })}</strong>
            <p>{props.t('review.episodeMetrics', {
              steps: episode.steps, termination: props.t(episode.terminated ? 'review.terminated' : 'review.notTerminated'),
              upright: (episode.uprightFraction * 100).toFixed(1),
              error: episode.poseRmse === null ? props.t('review.notRecorded')
                : props.t('review.degrees', { value: (episode.poseRmse * 180 / Math.PI).toFixed(1) }),
            })}</p>
            <button type="button" disabled={!canSimulate || policy.runId === null
              || policy.id !== value.policyId || policy.sha256 !== value.policyHash} onClick={() => {
              props.openStudio(); props.execute({ operation: 'replay_evaluation', evaluationId: value.id, episodeIndex: index })
            }}>{props.t('review.replayEpisode', { episode: index + 1 })}</button>
          </div>)}
          {value.limitations.map(reason => <p className={css.muted} key={reason}>{reason}</p>)}
        </article>
      })}
      <p className={css.muted}>{props.t('review.replayScope')}</p>
      {comparison !== null && baseline?.id !== report.id && <article className={css.card}><h3>{props.t('review.comparisonTitle')}</h3>
        <p>{props.t(comparison.likeForLike ? 'review.comparisonMatching' : 'review.comparisonDifferent')}</p>
        <p>{props.t(danceComparisonLabel[comparison.dancePlanMatch])}</p>
        {comparison.differences.map(difference => <p key={difference}>{props.t(difference)}</p>)}
        {comparison.uprightDelta !== null && <p>{props.t('review.uprightDelta', { delta: comparison.uprightDelta.toFixed(1) })}</p>}
        {comparison.poseDelta !== null && <p>{props.t('review.trackingDelta', { delta: comparison.poseDelta.toFixed(1) })}</p>}
        <p className={css.muted}>{props.t('review.comparisonScope')}</p>
      </article>}
      <div className={css.card}><h3>{props.t('review.observeImprove')}</h3>
        <p>{props.t('draft.reflectionNotice')}</p>
        <p>{props.t('review.interpretationScope', { id: report.id })}</p>
        {!evidence.canReflect && <p>{props.t('review.reflectionRequiresTrial')}</p>}
        <fieldset disabled={busy || !evidence.canReflect}>
          <label>{props.t('review.observation')}<textarea rows={2} value={view.reflection.observation}
            onChange={(event) => { props.actions.reflection({ observation: event.target.value }) }} /></label>
          <label>{props.t('review.interpretation')}<textarea rows={2} value={view.reflection.interpretation}
            onChange={(event) => { props.actions.reflection({ interpretation: event.target.value }) }} /></label>
          <label>{props.t('review.nextChange')}<textarea rows={2} value={view.reflection.nextChange}
            onChange={(event) => { props.actions.reflection({ nextChange: event.target.value }) }} /></label>
          <button type="button" disabled={!reflectionValid} onClick={reportTrial === undefined ? undefined : () => {
            props.saveReflection({ trialId: reportTrial.trial.id, evaluationId: report.id, ...view.reflection })
          }}>{props.t('review.saveReflection')}</button>
        </fieldset>
      </div>
    </>}
    {lab.reflections.length > 0 && <div className={css.card}><h3>{props.t('review.savedReflections')}</h3>{lab.reflections.map(reflection =>
      <article className={css.run} key={reflection.id}>
        <strong>{reflection.nextChange}</strong><p>{props.t('review.savedObservation', { observation: reflection.observation })}</p>
        <p>{props.t('review.savedInterpretation', { interpretation: reflection.interpretation })}</p>
        <p className={css.hash}>{props.t('review.reflectionIdentity', {
          id: reflection.id, trialId: reflection.trialId, reportId: reflection.evaluationId, hash: reflection.policyHash,
        })}</p>
        <button type="button" disabled={busy} onClick={() => { props.reviewImprovement(reflection) }}>{props.t('review.improvementDraft')}</button>
      </article>)}</div>}
    <details><summary>{props.t('review.hardwareBlocked')}</summary>
      <p>{props.t('review.hardwareScope')}</p>
      <button type="button" disabled={policy === undefined || busy} onClick={policy === undefined ? undefined : () => {
        props.execute({ operation: 'prepare', policyId: policy.id })
      }}>{props.t('review.showBlockers')}</button>
      {lab.deploymentReasons.map(reason => <p key={reason}>{reason}</p>)}
      <button type="button" disabled>{props.t('review.activateUnavailable')}</button>
    </details>
  </>
}
