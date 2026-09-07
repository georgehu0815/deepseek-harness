/** Opt-in real CPU or Metal learner integration with confined CPU physics; no robot connection. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { RobotRun, RobotTrialBinding } from '@deepseek-ai/dsh-robot-lab'
import { learningHash } from '../src/learning-store.ts'

const source = process.env.DSH_MICRODUCK_SOURCE_ROOT
const python = process.env.DSH_MICRODUCK_PYTHON
const mlxPython = process.env.DSH_MICRODUCK_MLX_PYTHON
const rlxPython = process.env.DSH_MICRODUCK_RLX_PYTHON
const rlxSource = process.env.DSH_MICRODUCK_RLX_SOURCE_ROOT
const backend = process.env.DSH_MICRODUCK_BACKEND ?? 'cpu'
const dance = process.env.DSH_ROBOT_DANCE === '1'
const fixture = new URL('./fixtures/provider/', import.meta.url)

it.skipIf(!source || !python)('trains, reloads and evaluates real physics through the Loader-owned provider', { timeout: 210_000, retry: 0 }, async () => {
  if (backend !== 'cpu' && backend !== 'mlx' && backend !== 'rlx') throw new Error('DSH_MICRODUCK_BACKEND must be cpu, mlx or rlx')
  if (backend === 'rlx' && (!rlxPython || !rlxSource)) throw new Error('RLX smoke requires its configured interpreter and source; no CPU fallback')
  if (backend === 'mlx' && !mlxPython) throw new Error('MLX smoke requires DSH_MICRODUCK_MLX_PYTHON; no CPU fallback')
  const learnerDevice = backend === 'cpu' ? 'cpu' : 'metal'
  const trainingSteps = backend === 'cpu' ? 1024 : 32
  const configPath = fileURLToPath(new URL('cordis.yml', fixture))
  const binScript = fileURLToPath(new URL('smoke-driver.ts', fixture))
  const result = await runLoaderSmoke({
    label: 'real MicroDuck host-provider pipeline', tempDirPrefix: 'dsh-robot-provider-',
    configPath, binScript, libBinScript: binScript, mode: 'src',
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 180_000,
    env: { DSH_MICRODUCK_SOURCE_ROOT: source, DSH_MICRODUCK_PYTHON: python,
      DSH_MICRODUCK_MLX_PYTHON: mlxPython, DSH_MICRODUCK_BACKEND: backend,
      DSH_MICRODUCK_RLX_PYTHON: rlxPython, DSH_MICRODUCK_RLX_SOURCE_ROOT: rlxSource, DSH_ROBOT_DANCE: dance ? '1' : '0' },
    inspect: async (cwd) => {
      const root = join(cwd, '.microduck-studio')
      const files = await readdir(root, { recursive: true })
      const manifests = files.filter(path => path.endsWith('manifest.json'))
      expect(manifests).toHaveLength(1)
      const manifestPath = manifests[0]
      if (manifestPath === undefined) throw new Error('Missing durable experiment manifest')
      const manifest = JSON.parse(await readFile(join(root, manifestPath), 'utf8')) as RobotRun
      expect(manifest).toMatchObject({ formatVersion: 3, state: 'completed', spec: { backend, steps: trainingSteps },
        provenance: { environment: { updateDevice: learnerDevice }, trainer: { backend, learnerDevice, physicsDevice: 'cpu' } } })
      if (manifest.formatVersion !== 3) throw new Error('Expected explicit learner provenance')
      expect(manifest.provenance.trainer.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(Object.keys(manifest.provenance.trainer.helperSha256)).toEqual(backend === 'cpu' ? [] : [backend === 'rlx' ? 'rlx_ppo.py' : 'mlx_ppo.py'])
      if (backend === 'rlx') expect(manifest.artifactSha256?.['rlx-artifacts.json']).toMatch(/^[a-f0-9]{64}$/)
      if (dance) {
        expect(manifest.dancePlan?.evaluation.dance.requiredCycles).toBe(2)
        const bindings = files.filter(path => dirname(path).endsWith(join('learning', 'bindings')) && path.endsWith('.json'))
        expect(bindings).toHaveLength(1)
        const binding = JSON.parse(await readFile(join(root, bindings[0]!), 'utf8')) as RobotTrialBinding
        expect(binding.dancePlanSha256).toBe(learningHash(manifest.dancePlan))
      }
      const bytes = await readFile(join(root, dirname(manifestPath), 'policy.onnx'))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.policySha256)
      expect(files.some(path => path.endsWith('request.json'))).toBe(true)
      expect(files.some(path => path.endsWith('report.json'))).toBe(true)
    },
  })
  const evidence = JSON.parse(result.stdout.trim()) as {
    mode: string
    backend: string
    learnerDevice: string
    trainingSteps: number
    dance: boolean
    frameCount: number
    deployment: { allowed: boolean }
    policyHash: string
  }
  expect(evidence).toMatchObject({ mode: 'real-host-provider', backend, learnerDevice, trainingSteps, dance })
  expect(evidence.frameCount).toBeGreaterThan(0)
  expect(evidence.deployment.allowed).toBe(false)
  expect(evidence.policyHash).toMatch(/^[a-f0-9]{64}$/)
  if (process.env.DSH_ROBOT_SMOKE_EVIDENCE !== undefined) {
    await mkdir(dirname(process.env.DSH_ROBOT_SMOKE_EVIDENCE), { recursive: true })
    await writeFile(process.env.DSH_ROBOT_SMOKE_EVIDENCE, result.stdout)
  }
})
