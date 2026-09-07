/** Recorded choreography verdicts and observed-sample metrics, with labelled v2 lower bounds. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RobotDancePlan, RobotDanceWindow, RobotEvaluation } from '@deepseek-ai/dsh-robot-lab/types'
import css from './MicroDuck.module.css'

type Locale = PropsLocale<'robot-lab'>
const SCOPES: Record<RobotDancePlan['version'], Parameters<Locale['t']>[0]> = {
  1: 'dance.scope', 2: 'dance.scopeV2',
}

function WindowMetrics({ window, plan, expectedSteps, activeJointIndices, t }: Locale & {
  window: RobotDanceWindow
  plan: RobotDancePlan
  expectedSteps: number
  activeJointIndices: readonly number[] | undefined
}) {
  const measured = (value: number | null | undefined) => value == null ? t('assessment.notRecorded') : value.toFixed(4)
  const largestJointRmse = window.jointRmseRad === null ? null : Math.max(...window.jointRmseRad)
  const bound = (value: number | null) => measured(value === null ? null : value * Math.sqrt(window.measuredSteps / expectedSteps))
  return <>
    <p>{t(window.complete ? 'dance.complete' : 'dance.partial')} · {t('dance.steps')}: {window.steps}
      {' · '}{t('dance.samples')}: {window.measuredSteps}/{expectedSteps}</p>
    <p>{t('dance.observedSamples')}</p>
    {plan.version === 2 && <><p>{t('dance.boundExplanation')}</p>
      <p>{t('dance.jointBound')}: {bound(largestJointRmse)} · {t('dance.rootBound')}: {bound(window.rootOrientationRmseRad)}</p></>}
    <p>{t('dance.maxJointRmse')}: {measured(largestJointRmse)} · {t('dance.rootRmse')}: {measured(window.rootOrientationRmseRad)}
      {' · '}{t('dance.drift')}: {measured(window.maxHorizontalDriftMeters)}</p>
    {window.reasons.length > 0 && <><p>{t('dance.reasons')}</p><ul>{window.reasons.map((reason, index) =>
      <li key={index}>{reason}</li>)}</ul></>}
    <details><summary>{t('dance.jointDetails')}</summary>
      <table><thead><tr><th>{t('dance.joint')}</th><th>{t('dance.jointRmse')}</th>
        <th>{t('dance.amplitude')}</th><th>{t('dance.gain')}</th></tr></thead>
      <tbody>{plan.reference.jointNames.map((name, index) => {
        const moving = activeJointIndices?.includes(index)
        return <tr key={name}><th scope="row">{name}</th><td>{measured(window.jointRmseRad?.[index])}</td>
          <td>{moving === false ? t('dance.inactiveJoint') : measured(window.amplitudeRatio[index])}</td>
          <td>{moving === false ? t('dance.inactiveJoint') : measured(window.referenceGainRatio[index])}</td></tr>
      })}</tbody></table>
    </details>
  </>
}

/**
 * Show recorded identity, sample coverage and versioned criteria with derived bounds, without recomputing verdicts.
 * @param props - one immutable report and the parent entry's locale binding.
 * @returns explicitly unassessed legacy evidence or the recorded choreography result and its measured windows.
 */
export function DanceEvidence({ report, t }: Locale & { report: RobotEvaluation }) {
  const plan = report.dancePlan
  return <section aria-label={t('dance.title')}>
    <h4>{t('dance.title')}</h4>
    {plan === undefined ? <p>{t('dance.unassessed')}</p> : <>
      <p><strong>{report.danceStatus === undefined ? t('assessment.notRecorded') : t(`dance.${report.danceStatus}`)}</strong></p>
      <p>{t(SCOPES[plan.version])}</p>
      <p>{t('dance.unmeasured')}</p>
      <details><summary>{t('dance.frozenCriteria')}</summary>
        <p>{t('dance.requiredCycles')}: {plan.evaluation.dance.requiredCycles}
          {' · '}{t('dance.requiredFraction')}: {plan.evaluation.dance.minPassedEpisodeFraction}</p>
        <p>{t('dance.rootLimit')}: {plan.evaluation.dance.maxRootOrientationRmseRad}
          {' · '}{t('dance.driftLimit')}: {plan.evaluation.dance.maxHorizontalDriftMeters}</p>
        <p>{t('dance.amplitudeRange')}: {plan.evaluation.dance.minAmplitudeRatio}–{plan.evaluation.dance.maxAmplitudeRatio}
          {' · '}{t('dance.gainMinimum')}: {plan.evaluation.dance.minReferenceGainRatio}
          {' · '}{t('dance.referenceFloor')}: {plan.evaluation.dance.minReferenceExcursionRad}</p>
        <p>{t('dance.movementScope')}</p>
        <table><thead><tr><th>{t('dance.joint')}</th><th>{t('dance.jointLimit')}</th><th>{t('dance.movementCheck')}</th></tr></thead>
          <tbody>{plan.reference.jointNames.map((name, index) => <tr key={name}>
            <th scope="row">{name}</th><td>{plan.evaluation.dance.maxJointRmseRad[index]}</td>
            <td>{t(plan.evaluation.dance.movingJointIndices.includes(index) ? 'dance.required' : 'dance.positionOnly')}</td>
          </tr>)}</tbody></table>
        <p>{t('dance.precision')}</p>
      </details>
      <p className={css.hash}>{t('dance.plan')}: {plan.sha256}</p>
      <p>{t('dance.authoredClock')}: {plan.reference.authoredDurationSeconds.toFixed(6)}
        {' · '}{t('dance.runtimeClock')}: {plan.reference.cycleSeconds.toFixed(6)}
        {' · '}{t('dance.clockDelta')}: {(plan.reference.cycleSeconds - plan.reference.authoredDurationSeconds).toFixed(6)}
        {' · '}{t('dance.controlDt')}: {plan.reference.controlDtSeconds.toFixed(6)}</p>
      {report.episodes.map((episode, index) => <details key={index}>
        <summary>{t('dance.episode')} {index + 1} · {episode.dance === undefined
          ? t('assessment.notRecorded') : t(`dance.${episode.dance.status}`)}</summary>
        {episode.dance === undefined ? <p>{t('dance.missingEpisode')}</p> : <>
          <p>{t('dance.cycles')}: {episode.dance.completedCycles}/{plan.evaluation.dance.requiredCycles}
            {' · '}{t('dance.terminated')}: {t(episode.dance.terminated ? 'dance.yes' : 'dance.no')}
            {' · '}{t('dance.truncated')}: {t(episode.dance.truncated ? 'dance.yes' : 'dance.no')}</p>
          {episode.dance.reasons.length > 0 && <><p>{t('dance.reasons')}</p><ul>{episode.dance.reasons.map((reason, reasonIndex) =>
            <li key={reasonIndex}>{reason}</li>)}</ul></>}
          {episode.dance.cycles.map(cycle => <details key={cycle.index}>
            <summary>{t('dance.cycle')} {cycle.index + 1} · {t(`dance.${cycle.status}`)}</summary>
            <WindowMetrics window={cycle} plan={plan} expectedSteps={plan.reference.cycleSteps}
              activeJointIndices={undefined} t={t} />
            {cycle.blocks.map((block) => {
              // Report validation pairs each measured block with this indexed frozen partition.
              const authored = plan.reference.blocks[block.index] as RobotDancePlan['reference']['blocks'][number]
              return <details key={block.index}>
                <summary>{t('dance.block')} {block.index + 1} · {t(`dance.${block.status}`)}</summary>
                <WindowMetrics window={block} plan={plan}
                  expectedSteps={authored.endStep - authored.startStep}
                  activeJointIndices={authored.activeJointIndices} t={t} />
              </details>
            })}
          </details>)}
        </>}
      </details>)}
    </>}
    <p className={css.muted}>{t('dance.limits')}</p>
  </section>
}
