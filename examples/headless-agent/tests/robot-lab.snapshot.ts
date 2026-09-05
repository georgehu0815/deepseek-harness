/** Keyless assembled-app transcript for Robot Lab's unconfigured-provider diagnostic. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionLog, scrubRequestHeaders } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const fixtureDir = fileURLToPath(new URL('./robot-lab-snapshots/unconfigured/', import.meta.url))
const override = join(fixtureDir, 'replay.override.json')
const expected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../robot-lab.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

describe('Robot Lab assembled headless snapshot', () => {
  it('reports unsupported run formats without exposing policies or rewriting stored files', async () => {
    const fixture = new URL('./fixtures/robot/robot-lab-microduck/', import.meta.url)
    const driver = fileURLToPath(new URL('history-driver.ts', fixture))
    const result = await runLoaderSmoke({
      label: 'Robot Lab unsupported-format transcript', tempDirPrefix: 'dsh-robot-history-',
      configPath: fileURLToPath(new URL('cordis.yml', fixture)), binScript: driver, libBinScript: driver,
      mode: 'src', tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    })
    expect(JSON.parse(result.stdout.trim()) as unknown).toMatchInlineSnapshot(`
      {
        "artifactUnchanged": true,
        "incompatibleRuns": [
          {
            "formatVersion": 2,
            "id": "run-00000000-0000-0000-0000-000000000000",
            "reason": "unsupported Robot Lab run format; only version 3 is supported",
          },
        ],
        "manifestUnchanged": true,
        "policies": [],
        "rejectedOperations": [
          "run",
          "stop",
          "simulate",
          "evaluate",
        ],
        "runs": [],
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('logs the real readiness tool result without claiming compute or hardware availability', async () => {
    const result = await runLoaderSmoke({
      label: 'Robot Lab unconfigured-provider transcript',
      tempDirPrefix: 'dsh-robot-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Check whether MicroDuck training is available. Do not start training or activate hardware.'],
      tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
      env: { DSH_SNAPSHOT_FILE: override, DSH_SNAPSHOT_OVERRIDE: override },
      inspect: async (cwd) => {
        const directory = join(cwd, '.sessions')
        const files = (await readdir(directory, { recursive: true })).filter(file => file.endsWith('.jsonl'))
        const logs = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))
        const log = logs.find(value => value.includes('robot-readiness'))
        if (log === undefined) throw new Error('Robot Lab tool result was not durably logged')
        expect(log).toContain('Configure a MicroDuck Lab provider and Python environment.')
        const events = log.trim().split('\n').map(line => JSON.parse(line) as SessionEvent)
        const offered = events.find(event => event.type === 'request/header')
        if (offered?.type !== 'request/header') throw new Error('Expected the assembled tool schema in the session log')
        expect(offered.data.header.tools?.find(tool => tool.name === 'robot_lab')).toMatchInlineSnapshot(`
          {
            "description": "Inspect MicroDuck readiness, behaviors, scene, policies or runs; train and stop local CPU or optional MLX GPU experiments (MuJoCo physics stays on CPU); simulate or evaluate exported ONNX. Never activates hardware. Operations: studio, save_project, projects, project, reference_preview, readiness, behaviors, scene, policies, runs, run, train, stop, simulate, evaluate, prepare, save_trial, trials, train_trial, evaluate_trial, evaluations, save_reflection, reflections, replay_evaluation. Guided learning saves a prediction and evidence plan before training; reflections bind measured results to exact policy bytes. Studio templates are experimental authored motion, not trained skills. reference_preview is kinematic MuJoCo posing, not a learned-policy rollout. Use readiness first and inspect behaviors before training. Simulation is a recorded deterministic rollout, not a physical robot or live control stream.",
            "name": "robot_lab",
            "parameters": {
              "properties": {
                "request_json": {
                  "description": "JSON object with operation. Queries need only operation; run/stop require runId. studio returns installed profile, templates and limits, including actions Stand Steady (stand), Say Hello (hello), and Look Around (look-around). save_project requires recipe={projectId:null|savedId,name,profileId,templateId,templateVersion:1,parameters:{bpm,beats,moveSize},music:{version:1,style:"disco"|"electronic"|"lofi"|"chiptune",bpm,beats,seed}} with matching music tempo/beats. Optional recipe.blocks=[{templateId,templateVersion:1,beats,moveSize}] is the ordered motion sequence; first block matches the top-level template, beats sum to motion/music beats, and parameters.moveSize scales each block. Reorder/remove/duplicate blocks and save a new immutable revision. Project and clip display names preserve exact Unicode; use "project-" + project.id as the ASCII train name, not clip.name. Use project.training.behaviorId and explicitly merge its weights with the behavior defaults for whole-sequence training. project and reference_preview require projectRevisionId. Defaults recommended bpm96,beats32,moveSize0.5; bounds come from studio. train may include spec.projectRevisionId with clip:null to select its saved clip, or supply the identical clip; admission freezes the resolved clip and project snapshot. train accepts optional spec.backend="cpu"|"mlx" (default cpu; unavailable mlx fails without fallback) and requires spec={name,behaviorId,steps,envs,seed,actuator:"bam"|"xml",weights:{},clip:null|{version:1,name,duration,loop,keys:[{t,joints:[14 radians],rootPitch}]}}. simulate requires policyId,steps,seed,command:[vx,vy,yawRate]. evaluate requires spec={policyId,episodes,stepsPerEpisode,seed,maxTerminations,minMeanUprightFraction}. prepare requires policyId and always reports blocked physical deployment for local prototypes. save_trial requires recipe={spec:existing training request with projectRevisionId and clip:null,brief:{goal,prediction,plannedChange,evidence},evaluation:{episodes,stepsPerEpisode,seed,maxTerminations,minMeanUprightFraction},parentReflectionId:null|savedReflectionId}; all four brief fields are nonblank strings and evidence describes what to measure, not existing results. Save first; train_trial and evaluate_trial require trialId and use frozen settings. A trial admits one run only; save a new trial to retry. trials lists saved trials with bindings and run state. evaluations lists validated completed reports and incompleteCount, excluding unfinished attempts from evidence. save_reflection requires reflection={trialId,evaluationId,observation,interpretation,nextChange}; its evaluation must match the frozen assessment and exact completed policy. reflections lists saved observations. Improve can reopen an unsaved draft from a reflection; saving with parentReflectionId creates a child trial. replay_evaluation requires evaluationId and episodeIndex; returns a NEW re-simulation of an owned policy episode, not its original video.",
                  "type": "string",
                },
              },
              "required": [
                "request_json",
              ],
              "type": "object",
            },
          }
        `)
        const header = JSON.parse(log.split('\n')[0]!) as { id: string }
        const normalized = scrubRequestHeaders(normalizeSessionLog(log, { sessionIds: [header.id], cwd }))
        if (refreshing) await writeFile(expected, normalized)
        expect(normalized).toBe(await readFile(expected, 'utf8'))
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('No training or hardware activation was performed.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
