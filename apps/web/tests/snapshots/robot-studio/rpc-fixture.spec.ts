/** Saved-history UI fixtures obey elapsed coverage independently of missing finite measurements. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { robotRpcFixture } from './rpc-fixture.ts'

describe('saved choreography report fixtures', () => {
  it('keeps optional RLX observations separate from assessments and preserves trainer and artifact identity', () => {
    const history = robotRpcFixture({ savedRlxRuns: true }).history()
    expect(history.evaluations).toEqual([])
    expect(history.runs).toHaveLength(3)
    const [legacy, zero, completed] = history.runs
    for (const run of history.runs) {
      expect(run.spec.backend).toBe('rlx')
      expect(run.provenance.trainer).toMatchObject({ backend: 'rlx', learnerDevice: 'metal', physicsDevice: 'cpu' })
      expect(run.spec.name).toMatch(/^Synthetic RLX /)
    }
    expect(legacy!.progress).not.toHaveProperty('rlx')
    expect(zero!.progress!.rlx).toMatchObject({ version: 1, completedRollouts: 0, optimizerSteps: 0,
      collectionSeconds: 0, updateSeconds: 0, lastMeanLoss: null, checkpointSeconds: null, exportSeconds: null })
    expect(completed!.progress).toMatchObject({ steps: 100, total: 100, elapsedSeconds: 10,
      rlx: { version: 1, completedRollouts: 4, optimizerSteps: 8, lastMeanLoss: -0.125,
        collectionSeconds: 3.25, updateSeconds: 5.5, checkpointSeconds: 0.125, exportSeconds: 2.75 } })
    expect(completed!.artifactSha256).toEqual({ 'rlx-artifacts.json': 'a'.repeat(64) })
    expect(completed!.policyId).toBe(`run:${completed!.id}`)
    if (process.env.DSH_EXPORT_R6_UI_RUNS === '1') {
      const file = resolve('.artifacts/round6-ui-run-fixtures.json')
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify(history.runs, null, 2)}\n`)
    }
  })

  it('keeps synthetic v2 observed-fragment values incomplete with one finite sample and distinct evidence identity', () => {
    const [legacy, , current] = robotRpcFixture({ savedDanceReports: true }).history().evaluations
    expect(current!.id).not.toBe(legacy!.id)
    expect(current!.dancePlan!.sha256).not.toBe(legacy!.dancePlan!.sha256)
    expect(current!.dancePlan).toMatchObject({ version: 2, evaluation: { dance: { version: 2, requiredCycles: 1 } } })
    expect(current!.spec.dance!.version).toBe(2)
    expect(current!.danceStatus).toBe('incomplete')
    const episode = current!.episodes[0]!
    expect(episode).toMatchObject({ steps: 100, terminated: false, dance: { completedCycles: 1, truncated: false } })
    const cycle = episode.dance!.cycles[0]!
    expect(cycle).toMatchObject({ steps: 100, measuredSteps: 1, complete: false, rootOrientationRmseRad: 0.3,
      status: 'incomplete', reasons: ['incomplete-window', 'missing-measurements'] })
    expect(cycle.jointRmseRad![0]).toBe(0.3)
    expect(cycle.blocks.map(block => [block.steps, block.measuredSteps])).toEqual([[50, 1], [50, 0]])
    expect(cycle.blocks[1]).toMatchObject({ jointRmseRad: null, rootOrientationRmseRad: null, maxHorizontalDriftMeters: null })
    expect(current!.limitations).toContain('Synthetic partial-measurement math fixture; not a physics rollout or a learned-skill result.')
  })

  it('keeps full-horizon incomplete evidence nonterminated and preserves cycle/block counts', () => {
    const allReports = robotRpcFixture({ savedDanceReports: true }).history().evaluations
    const reports = allReports.slice(0, 2)
    expect(reports.map(report => report.danceStatus)).toEqual(['failed', 'incomplete'])
    for (const report of reports) {
      const plan = report.dancePlan!
      expect(plan.version).toBe(1)
      expect(plan.evaluation.dance.version).toBe(1)
      expect(report.spec.dance!.version).toBe(1)
      expect(report.id).toMatch(/^eval-[a-f0-9-]{36}$/)
      expect(report.policyId).toMatch(/^run:run-[a-f0-9-]{36}$/)
      expect(report.passed).toBe(true)
      const episode = report.episodes[0]!
      expect(episode.steps).toBe(report.spec.stepsPerEpisode)
      expect(episode.terminated).toBe(false)
      expect(episode.dance).toMatchObject({ completedCycles: 2, terminated: false, truncated: false })
      for (const cycle of episode.dance!.cycles) {
        expect(cycle.steps).toBe(plan.reference.cycleSteps)
        expect(cycle.blocks.reduce((sum, block) => sum + block.steps, 0)).toBe(cycle.steps)
        expect(cycle.blocks.reduce((sum, block) => sum + block.measuredSteps, 0)).toBe(cycle.measuredSteps)
        expect(cycle.reasons).toEqual(cycle.index === 0 ? [] : episode.dance!.reasons)
      }
    }
    expect(reports[0]!.episodes[0]!.dance!.reasons).toEqual(['reference-gain'])
    const incomplete = reports[1]!.episodes[0]!.dance!
    expect(incomplete.reasons).toEqual(['incomplete-window', 'missing-measurements'])
    expect(incomplete.cycles[1]).toMatchObject({ steps: 240, measuredSteps: 30, complete: false, status: 'incomplete' })
    expect(incomplete.cycles[1]!.blocks[0]).toMatchObject({ steps: 120, measuredSteps: 30, complete: false })
    expect(incomplete.cycles[1]!.blocks[1]).toMatchObject({ steps: 120, measuredSteps: 0,
      jointRmseRad: null, rootOrientationRmseRad: null, maxHorizontalDriftMeters: null })
    expect(incomplete.cycles[1]!.blocks[1]!.amplitudeRatio).toEqual(Array(14).fill(null))
    expect(incomplete.cycles[1]!.blocks[1]!.referenceGainRatio).toEqual(Array(14).fill(null))
    if (process.env.DSH_EXPORT_P4_UI_FIXTURES === '1') {
      const file = resolve('.artifacts/p4-ui-report-fixtures.json')
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify(allReports, null, 2)}\n`)
    }
  })
})
