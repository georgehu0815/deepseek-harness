/** Independent assessment, descriptive comparison and reflection alongside exploratory performance. */
import type { LearningReviewProps } from './studio-props.ts'
import { policyStatus } from './policy-status.ts'
import { assessmentSummary, validAssessment } from './evaluation-evidence.ts'
import { assessmentFields } from './assessment-fields.ts'
import { reviewEvidence } from './review-evidence.ts'
import css from './MicroDuck.module.css'

/**
 * Display recorded evidence without allowing playback controls to rewrite a trial's criteria.
 * @param props - shared session data, draft actions and captured-session operation callbacks.
 * @returns assessment or performance controls with persistent observe/improve actions.
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
  const simulationSteps = view.simulationSteps ?? (project === undefined ? props.simulationSteps : Math.ceil(project.clip.duration * 50))
  const assessment = trial?.trial.recipe.evaluation ?? view.assessment ?? props.evaluation
  const form = assessmentFields(assessment)
  const reflectionValid = Object.values(view.reflection).every(value => value.trim() !== '')
  return <>
    <div className={css.sectionHeading}><h2>{view.page === 'evaluate' ? 'Assess what it actually learned' : 'Watch what it actually learned'}</h2>
      <button type="button" onClick={props.openStudio}>Open Studio ↗</button></div>
    <label>Trained policy<select value={view.policyId ?? ''} disabled={busy} onChange={(event) => {
      const selected = lab.policies.find(item => item.id === event.target.value)
      if (selected !== undefined) props.actions.policy(selected.id)
    }}><option value="">Choose a policy</option>{lab.policies.map(item => <option key={item.id} value={item.id}>
        {lab.runs.find(candidate => candidate.policyId === item.id && candidate.policySha256 === item.sha256)
          ?.spec.projectSnapshot?.recipe.name ?? item.name}
        {' · '}{policyStatus(item, report)}
      </option>)}</select></label>
    {policy !== undefined && <div className={css.card}>
      <h3>{project?.recipe.name ?? policy.name}</h3><p className={css.hash}>Policy {policy.id} · SHA-256: {policy.sha256}</p>
      <p>{policyStatus(policy, report)}</p>
      {!policy.runtimeCompatibility.available && <p className={css.error}>{policy.runtimeCompatibility.reason}</p>}
      {view.page === 'evaluate' ? <>
        <p>{trial === undefined ? 'Exploratory assessment · not a pre-registered student trial' : `Frozen assessment for trial ${trial.trial.id}`}</p>
        <p>{assessment.episodes} episodes · requested horizon {assessment.stepsPerEpisode} steps ({assessment.stepsPerEpisode / 50} seconds)
          {' · '}seeds {assessment.seed}–{assessment.seed + assessment.episodes - 1}</p>
        <p>Maximum terminations: {assessment.maxTerminations} · Minimum mean upright fraction: {assessment.minMeanUprightFraction}</p>
        {trial === undefined && <details><summary>Exploratory assessment settings</summary>
          <p className={css.muted}>These editable criteria assess an unlinked policy;
            they do not change a saved trial or Perform's horizon.</p>
          <fieldset disabled={busy}><div className={css.fields}>{form.fields.map(field => <label key={field.key}>{field.label}
            <input type="number" min={field.min} max={field.max} step={field.step} value={assessment[field.key]}
              onChange={(event) => { props.actions.assessment({ ...assessment, [field.key]: Number(event.target.value) }) }} />
          </label>)}</div></fieldset>
          {form.error !== null && <p className={css.error}>{form.error}</p>}
        </details>}
        <button type="button" className={css.primary} disabled={!canEvaluate || !validAssessment(assessment)} onClick={() => {
          if (trial !== undefined) props.execute({ operation: 'evaluate_trial', trialId: trial.trial.id })
          else props.execute({ operation: 'evaluate', spec: { ...assessment, policyId: policy.id } })
        }}>{trial === undefined ? 'Check this policy' : 'Evaluate trial'}</button>
      </> : <>
        <label>Simulation duration<select value={simulationSteps} disabled={busy}
          onChange={(event) => { props.actions.simulationSteps(Number(event.target.value)) }}>
          {[...new Set([250, 500, 1000, 1500, props.simulationSteps,
            project === undefined ? props.simulationSteps : Math.ceil(project.clip.duration * 50)])]
            .sort((a, b) => a - b).map(steps => <option key={steps} value={steps}>{steps / 50} seconds</option>)}</select></label>
        <button type="button" className={css.primary} disabled={!canSimulate} onClick={() => {
          props.openStudio(); props.execute({ operation: 'simulate', policyId: policy.id, steps: simulationSteps, seed: 0, command: [0, 0, 0] })
        }}>Generate learned performance</button>
        <p className={css.muted}>Exploratory simulation, not a new assessment.
          The soundtrack comes from this run's frozen project, not a newer draft.
          A fall or other termination can end playback early.</p>
        <button type="button" onClick={() => { props.actions.page('evaluate') }}>Observe and improve in Evaluate</button>
      </>}
    </div>}
    <div className={css.card}><h3>Measured evidence history</h3>
      <label>Evaluation report<select value={report?.id ?? ''} disabled={busy} onChange={(event) => {
        const selected = evidence.reports.find(item => item.id === event.target.value)
        if (selected !== undefined) { props.actions.policy(selected.policyId); props.actions.evaluation(selected.id) }
      }}><option value="">Choose a completed report</option>{evidence.reports.map(item => <option key={item.id} value={item.id}>
          {item.id} · {item.policyId} · {item.passed ? 'criteria passed' : 'criteria failed'} · {item.evaluatedAt}
        </option>)}</select></label>
      {evidence.reports.length === 0 && <p>No completed evaluation reports loaded.</p>}
      {lab.incompleteEvaluations > 0 && <p>{lab.incompleteEvaluations} incomplete assessment admissions are not completed reports.</p>}
      {!ready && <p>Saved learning history remains inspectable. Runtime availability is required for new simulation or training.</p>}
    </div>
    {report !== null && <>
      {policy === undefined || policy.id !== report.policyId || policy.sha256 !== report.policyHash ? <p className={css.status}>
        Historical report for the recorded policy hash below. Matching current executable policy metadata is unavailable.</p> : null}
      <label>Baseline report<select value={view.baselineId ?? ''} disabled={busy} onChange={(event) => {
        props.actions.baseline(evidence.reports.find(item => item.id === event.target.value)?.id ?? null)
      }}><option value="">No baseline selected</option>{evidence.reports.filter(item => item.id !== report.id).map(item =>
          <option key={item.id} value={item.id}>{item.id} · {item.policyId}</option>)}</select></label>
      {[{ value: report, source: evidence.reportRun, baseline: false }, ...(baseline === undefined || baseline.id === report.id ? []
        : [{ value: baseline, source: evidence.baselineRun, baseline: true }])].map(({ value, source, baseline: isBaseline }) => {
        const measured = assessmentSummary(value)
        const linked = lab.trials.find(item => item.binding?.runId === source?.id && source !== undefined)
        return <article className={css.card} key={value.id} aria-label={isBaseline ? 'Baseline evidence' : 'Selected evidence'}>
          <h3>{isBaseline ? 'Baseline report' : value.passed ? 'Passed the recorded simulation criteria' : 'Needs more practice under these criteria'}</h3>
          <p className={css.hash}>Report {value.id} · {value.evaluatedAt}</p>
          <p className={css.hash}>Policy {value.policyId} · SHA-256 {value.policyHash}</p>
          <p className={css.hash}>Trial {linked?.trial.id ?? 'not linked'} · SHA-256 {linked?.trial.sha256 ?? 'not loaded'}</p>
          <p className={css.hash}>Run {source?.id ?? 'not loaded'} · recipe hash {source?.recipeHash ?? 'not loaded'}</p>
          <p className={css.hash}>Project {source?.spec.projectSnapshot?.id ?? 'not linked'}
            {' · '}SHA-256 {source?.spec.projectSnapshot?.sha256 ?? 'not loaded'}</p>
          {linked !== undefined && <><p>Planned goal: {linked.trial.recipe.brief.goal}</p>
            <p>Prediction: {linked.trial.recipe.brief.prediction}</p>
            <p>Planned change: {linked.trial.recipe.brief.plannedChange}</p><p>Evidence plan: {linked.trial.recipe.brief.evidence}</p></>}
          {source !== undefined && <p>Training: {source.spec.backend} · {source.spec.steps} steps · seed {source.spec.seed}
            {' · '}{source.spec.envs} environments</p>}
          <p>Recorded criteria: {value.spec.episodes} episodes · horizon {value.spec.stepsPerEpisode} steps · seed {value.spec.seed}
            {' · '}maximum terminations {value.spec.maxTerminations} · minimum upright {value.spec.minMeanUprightFraction}</p>
          <div className={css.metricGrid}>
            <div className={css.metric}>
              <small>Mean upright fraction</small><strong>{(measured.upright * 100).toFixed(1)}%</strong>
            </div>
            <div className={css.metric}><small>Terminated episodes</small><strong>{measured.terminations}</strong></div>
          </div>
          <p>Mean available-episode joint tracking error: {measured.poseDegrees === null ? 'Not recorded' : `${measured.poseDegrees.toFixed(1)}°`}
            {' · '}{measured.trackingEpisodes}/{measured.episodeCount} episodes with tracking measurements</p>
          <p className={css.muted}>Standing upright does not by itself prove choreography completion.
            Termination is not a universal fall detector.</p>
          <details><summary>Exact assessment inputs</summary><pre className={css.hash}>{JSON.stringify({
            spec: value.spec, physics: value.physics,
            observationProfile: value.observationProfile, training: source?.spec,
            sourceFingerprint: source?.sourceFingerprint, trainingProvenance: source?.provenance }, null, 2)}</pre></details>
          {!isBaseline && policy?.runId === null && <p>Episode re-simulation requires an owned completed run.
            Shipped policies have no owned run; use Generate learned performance for an exploratory simulation.</p>}
          {!isBaseline && value.episodes.map((episode, index) => <div className={css.run} key={index}>
            <strong>Episode {index + 1} · seed {episode.seed}</strong>
            <p>{episode.steps} executed steps · {episode.terminated ? 'terminated' : 'not terminated'}
              {' · '}{(episode.uprightFraction * 100).toFixed(1)}% upright · tracking error {
                episode.poseRmse === null ? 'not recorded' : `${(episode.poseRmse * 180 / Math.PI).toFixed(1)}°`}</p>
            <button type="button" disabled={!canSimulate || policy.runId === null
              || policy.id !== value.policyId || policy.sha256 !== value.policyHash} onClick={() => {
              props.openStudio(); props.execute({ operation: 'replay_evaluation', evaluationId: value.id, episodeIndex: index })
            }}>Re-simulate episode {index + 1}</button>
          </div>)}
          {value.limitations.map(reason => <p className={css.muted} key={reason}>{reason}</p>)}
        </article>
      })}
      <p className={css.muted}>Episode re-simulation creates new frames from saved inputs;
        it is not the original evaluation recording and does not change report metrics.</p>
      {comparison !== null && baseline?.id !== report.id && <article className={css.card}><h3>Descriptive trial comparison</h3>
        <p>{comparison.likeForLike ? 'Matching assessment settings, observation semantics and frozen physics.' : 'Not a like-for-like assessment.'}</p>
        {comparison.differences.map(difference => <p key={difference}>{difference}</p>)}
        {comparison.uprightDelta !== null && <p>Selected minus baseline upright fraction: {
          comparison.uprightDelta.toFixed(1)} percentage points.</p>}
        {comparison.poseDelta !== null && <p>Selected minus baseline tracking error: {comparison.poseDelta.toFixed(1)}°.</p>}
        <p className={css.muted}>Descriptive results only, not a winner score or proof that one change caused the outcome.
          Reward totals are not compared.</p>
      </article>}
      <div className={css.card}><h3>Observe and improve</h3>
        <p>Student interpretation of report {report.id}; recorded measurements above remain unchanged.</p>
        {!evidence.canReflect && <p>A reflection requires the exact report and frozen assessment recipe of a linked student trial.</p>}
        <fieldset disabled={busy || !evidence.canReflect}>
          <label>Observation<textarea rows={2} value={view.reflection.observation}
            onChange={(event) => { props.actions.reflection({ observation: event.target.value }) }} /></label>
          <label>Interpretation<textarea rows={2} value={view.reflection.interpretation}
            onChange={(event) => { props.actions.reflection({ interpretation: event.target.value }) }} /></label>
          <label>Next change<textarea rows={2} value={view.reflection.nextChange}
            onChange={(event) => { props.actions.reflection({ nextChange: event.target.value }) }} /></label>
          <button type="button" disabled={!reflectionValid} onClick={() => {
            if (reportTrial !== undefined) props.saveReflection({
              trialId: reportTrial.trial.id, evaluationId: report.id, ...view.reflection,
            })
          }}>Save reflection</button>
        </fieldset>
      </div>
    </>}
    {lab.reflections.length > 0 && <div className={css.card}><h3>Saved reflections</h3>{lab.reflections.map(reflection =>
      <article className={css.run} key={reflection.id}>
        <strong>{reflection.nextChange}</strong><p>Observation: {reflection.observation}</p>
        <p>Interpretation: {reflection.interpretation}</p>
        <p className={css.hash}>Reflection {reflection.id} · trial {reflection.trialId} · report {reflection.evaluationId}
          {' · '}policy SHA-256 {reflection.policyHash}</p>
        <button type="button" disabled={busy} onClick={() => { props.reviewImprovement(reflection) }}>Review improvement draft</button>
      </article>)}</div>}
    <details><summary>Hardware deployment remains blocked</summary>
      <p>Local policies are simulation prototypes. This interface has no hardware activation operation.</p>
      <button type="button" disabled={policy === undefined || busy} onClick={() => {
        if (policy !== undefined) props.execute({ operation: 'prepare', policyId: policy.id })
      }}>Show deployment blockers</button>
      {lab.deploymentReasons.map(reason => <p key={reason}>{reason}</p>)}<button type="button" disabled>Activate hardware (unavailable)</button>
    </details>
  </>
}
