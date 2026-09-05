/** Pure projections of recorded assessments; playback settings never enter these comparisons. */
import type { RobotBamProvenance, RobotEvaluation, RobotEvaluationSpec, RobotRun } from '@deepseek-ai/dsh-robot-lab/types'

/** Editable pre-trial criteria, independent of the exploratory performance horizon. */
export type AssessmentRecipe = Omit<RobotEvaluationSpec, 'policyId'>

/** Recorded aggregate metrics and the episode coverage of available tracking measurements. */
export interface AssessmentSummary {
  upright: number
  terminations: number
  poseDegrees: number | null
  trackingEpisodes: number
  episodeCount: number
}

/** Qualified selected-minus-baseline differences; null deltas are not comparable or unmeasured. */
export interface AssessmentComparison {
  likeForLike: boolean
  differences: string[]
  uprightDelta: number | null
  poseDelta: number | null
}

/**
 * Aggregate recorded episodes without treating missing tracking samples as zero.
 * @param report - completed assessment with recorded episode measurements.
 * @returns upright/termination statistics, available-episode mean tracking error in degrees, and tracking coverage counts.
 */
export function assessmentSummary(report: RobotEvaluation): AssessmentSummary {
  const poses = report.episodes.flatMap(episode => episode.poseRmse === null ? [] : [episode.poseRmse])
  return {
    upright: report.episodes.reduce((sum, episode) => sum + episode.uprightFraction, 0) / report.episodes.length,
    terminations: report.episodes.filter(episode => episode.terminated).length,
    poseDegrees: poses.length === 0 ? null : poses.reduce((sum, value) => sum + value, 0) / poses.length * 180 / Math.PI,
    trackingEpisodes: poses.length, episodeCount: report.episodes.length,
  }
}

/**
 * Validate criteria before submission; provider-specific resource limits still apply.
 * @param recipe - planned assessment criteria and episode seeds.
 * @returns whether criteria are within valid ranges and all episode seeds fit the supported integer range.
 */
export function validAssessment(recipe: AssessmentRecipe): boolean {
  return Number.isSafeInteger(recipe.episodes) && recipe.episodes > 0
    && Number.isSafeInteger(recipe.stepsPerEpisode) && recipe.stepsPerEpisode > 0
    && Number.isSafeInteger(recipe.seed) && recipe.seed >= 0 && recipe.seed <= 2147483647 - recipe.episodes
    && Number.isSafeInteger(recipe.maxTerminations) && recipe.maxTerminations >= 0 && recipe.maxTerminations <= recipe.episodes
    && Number.isFinite(recipe.minMeanUprightFraction) && recipe.minMeanUprightFraction >= 0 && recipe.minMeanUprightFraction <= 1
}

/**
 * Compare all named acceptance settings, excluding the intentionally different policy identity.
 * @param left - first assessment's acceptance settings.
 * @param right - second assessment's acceptance settings.
 * @returns whether criteria, seeds and requested horizons match exactly.
 */
export function sameAssessment(left: AssessmentRecipe, right: AssessmentRecipe): boolean {
  return left.episodes === right.episodes && left.stepsPerEpisode === right.stepsPerEpisode && left.seed === right.seed
    && left.maxTerminations === right.maxTerminations && left.minMeanUprightFraction === right.minMeanUprightFraction
}

function sameRecord<T extends number | string>(left: Record<string, T>, right: Record<string, T>): boolean {
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => left[key] === right[key])
}

/**
 * Compare effective actuator provenance; rollout actuator mode and remaining physics flags are protocol-fixed literals.
 * @param left - first recorded BAM source and effective parameters.
 * @param right - second recorded BAM source and effective parameters.
 * @returns whether both recordings use exactly the same BAM settings and source.
 */
export function sameBam(left: RobotBamProvenance, right: RobotBamProvenance): boolean {
  return left.sha256 === right.sha256 && left.source === right.source && sameRecord(left.parameters, right.parameters)
}

/**
 * Describe experimental differences without choosing a winner or attributing causation.
 * @param left - baseline assessment.
 * @param right - selected assessment.
 * @param leftRun - baseline training provenance, when loaded.
 * @param rightRun - selected training provenance, when loaded.
 * @returns differences and selected-minus-baseline deltas; incompatible assessments or targets suppress the relevant deltas.
 */
export function compareAssessments(left: RobotEvaluation, right: RobotEvaluation,
  leftRun?: RobotRun, rightRun?: RobotRun): AssessmentComparison {
  const differences: string[] = []
  if (!sameAssessment(left.spec, right.spec)) differences.push('Assessment criteria, seeds, or requested horizon differ.')
  if (left.observationProfile !== right.observationProfile) differences.push('Observation semantics differ.')
  if (!sameBam(left.physics.bam, right.physics.bam)) differences.push('Frozen assessment physics differ.')
  if (leftRun === undefined || rightRun === undefined) differences.push('Complete training provenance is not loaded for both reports.')
  else {
    if (leftRun.sourceFingerprint !== rightRun.sourceFingerprint) differences.push('Frozen runtime source fingerprints differ.')
    if (leftRun.provenance.bridgeSha256 !== rightRun.provenance.bridgeSha256) differences.push('Frozen evaluation bridges differ.')
    if (!sameRecord(leftRun.provenance.dependencyVersions, rightRun.provenance.dependencyVersions)) {
      differences.push('Frozen evaluation runtime versions differ.')
    }
  }
  const likeForLike = differences.length === 0
  const leftTarget = leftRun?.spec.projectSnapshot
  const rightTarget = rightRun?.spec.projectSnapshot
  const sameTarget = leftTarget !== undefined && rightTarget !== undefined && leftTarget.sha256 === rightTarget.sha256
  if (!sameTarget) differences.push('Targets differ or are not linked; tracking errors are not directly comparable.')
  if (leftRun !== undefined && rightRun !== undefined) {
    if (leftRun.spec.backend !== rightRun.spec.backend) differences.push('Training learners differ.')
    if (leftRun.provenance.trainer.learnerDevice !== rightRun.provenance.trainer.learnerDevice) {
      differences.push('Training learner devices differ.')
    }
    if (!sameRecord(leftRun.provenance.trainer.dependencyVersions, rightRun.provenance.trainer.dependencyVersions)) {
      differences.push('Training learner dependencies differ.')
    }
    if (leftRun.spec.actuator !== rightRun.spec.actuator) differences.push('Training actuator models differ.')
    if (leftRun.spec.steps !== rightRun.spec.steps) differences.push('Training budgets differ.')
    if (leftRun.spec.seed !== rightRun.spec.seed) differences.push('Training seeds differ.')
    if (leftRun.spec.envs !== rightRun.spec.envs) differences.push('Parallel environment counts differ.')
    if (leftRun.spec.behaviorId !== rightRun.spec.behaviorId || !sameRecord(leftRun.spec.weights, rightRun.spec.weights)) {
      differences.push('Training reward recipes differ.')
    }
  }
  const before = assessmentSummary(left)
  const after = assessmentSummary(right)
  const sameTrackingCoverage = left.episodes.length === right.episodes.length && left.episodes.every((episode, index) => {
    const other = right.episodes[index]
    return other !== undefined && episode.seed === other.seed && (episode.poseRmse === null) === (other.poseRmse === null)
  })
  if (!sameTrackingCoverage) differences.push('Tracking measurements cover different episode cohorts; tracking-error deltas are withheld.')
  return {
    likeForLike, differences,
    uprightDelta: likeForLike ? (after.upright - before.upright) * 100 : null,
    poseDelta: likeForLike && sameTarget && sameTrackingCoverage && before.poseDegrees !== null && after.poseDegrees !== null
      ? after.poseDegrees - before.poseDegrees : null,
  }
}
