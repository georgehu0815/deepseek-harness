/** Optional RLX training work observations remain separate from policy assessments. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RobotRlxProgress, RobotRun } from '@deepseek-ai/dsh-robot-lab/types'

type Locale = PropsLocale<'robot-lab'>
const SCOPES: Record<RobotRlxProgress['version'], Parameters<Locale['t']>[0]> = { 1: 'rlx.scope' }

/**
 * Show recorded RLX observations without filling absent measurements or interpreting training loss as skill.
 * @param props - The authoritative run and the locale supplied by its enclosing panel.
 * @returns Collapsible observations for RLX runs, or no RLX claims for other trainers.
 */
export function TrainingObservations({ run, t }: { run: RobotRun } & Locale) {
  if (run.spec.backend !== 'rlx') return null
  const rlx = run.progress?.rlx
  const observed = (value: number | null | undefined, digits: number) => value == null ? t('assessment.notRecorded') : value.toFixed(digits)
  return <details>
    <summary>{t('rlx.title')}</summary>
    <p>{rlx === undefined ? t('rlx.absent') : t(SCOPES[rlx.version])}</p>
    <p>{t('rlx.intervals')}</p>
    <dl>
      <dt>{t('rlx.rollouts')}</dt><dd>{observed(rlx?.completedRollouts, 0)}</dd>
      <dt>{t('rlx.optimizerSteps')}</dt><dd>{observed(rlx?.optimizerSteps, 0)}</dd>
      <dt>{t('rlx.loss')}</dt><dd>{observed(rlx?.lastMeanLoss, 4)}</dd>
      <dt>{t('rlx.collection')}</dt><dd>{observed(rlx?.collectionSeconds, 3)}</dd>
      <dt>{t('rlx.update')}</dt><dd>{observed(rlx?.updateSeconds, 3)}</dd>
      <dt>{t('rlx.checkpoint')}</dt><dd>{observed(rlx?.checkpointSeconds, 3)}</dd>
      <dt>{t('rlx.export')}</dt><dd>{observed(rlx?.exportSeconds, 3)}</dd>
    </dl>
    <p>{t('rlx.lossScope')}</p>
    <p>{t('rlx.timingScope')}</p>
    <p>{t('rlx.clockScope')}</p>
  </details>
}
