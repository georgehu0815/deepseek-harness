/** Exact artifact selection for historical learning evidence and current runtime actions. */
import type { RobotEvaluation, RobotPolicy, RobotRun, RobotTrialEntry } from '@deepseek-ai/dsh-robot-lab/types'
import type { AssessmentComparison } from './evaluation-evidence.ts'
import type { LabSnapshot } from './lab-client.ts'
import type { RobotDraft } from './store.ts'
import { compareAssessments, sameAssessment, sameBam } from './evaluation-evidence.ts'

/** Current selection and exact historical relationships used by assessment and reflection controls. */
export interface ReviewEvidence {
  policy: RobotPolicy | undefined
  reports: RobotEvaluation[]
  report: RobotEvaluation | null
  run: RobotRun | undefined
  reportRun: RobotRun | undefined
  trial: RobotTrialEntry | undefined
  reportTrial: RobotTrialEntry | undefined
  baseline: RobotEvaluation | undefined
  baselineRun: RobotRun | undefined
  comparison: AssessmentComparison | null
  canReflect: boolean
}

/**
 * Resolve report and trial provenance without assigning another policy's evidence to the current selection.
 * @param lab - committed session-owned scientific and learning records.
 * @param view - explicit report, policy and comparison selections.
 * @returns selected evidence and qualified comparison, including historical data when runtime metadata is absent.
 */
export function reviewEvidence(lab: LabSnapshot, view: RobotDraft): ReviewEvidence {
  const policy = lab.policies.find(item => item.id === view.policyId)
  const reports = lab.evaluations
  const explicit = reports.find(item => item.id === view.evaluationId)
  const latest = lab.evaluation
  const report = explicit ?? (latest !== null && latest.policyId === policy?.id && latest.policyHash === policy.sha256 ? latest : null)
  const runs = [...lab.runs, ...lab.trials.flatMap(entry => entry.run === null ? [] : [entry.run])]
  const run = runs.find(item => item.policyId === policy?.id && item.policySha256 === policy.sha256)
  const reportRun = runs.find(item => item.policyId === report?.policyId && item.policySha256 === report.policyHash)
  const trial = lab.trials.find(item => item.binding?.runId === run?.id && run !== undefined)
  const reportTrial = lab.trials.find(item => item.binding?.runId === reportRun?.id && reportRun !== undefined)
  const baseline = reports.find(item => item.id === view.baselineId)
  const baselineRun = runs.find(item => item.policyId === baseline?.policyId && item.policySha256 === baseline.policyHash)
  const comparison = baseline !== undefined && report !== null ? compareAssessments(baseline, report, baselineRun, reportRun) : null
  return {
    policy, reports, report, run, reportRun, trial, reportTrial, baseline, baselineRun, comparison,
    canReflect: report !== null && reportTrial !== undefined && reportRun !== undefined
      && sameAssessment(report.spec, reportTrial.trial.recipe.evaluation) && report.observationProfile === reportRun.observationProfile
      && sameBam(report.physics.bam, reportRun.provenance.bam)
      && report.dancePlan?.sha256 === reportRun.dancePlan?.sha256,
  }
}
