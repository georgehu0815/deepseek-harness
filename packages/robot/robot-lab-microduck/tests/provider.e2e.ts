/** Opt-in real CPU or Metal learner integration with confined CPU physics; no robot connection. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { RobotRun } from '@deepseek-ai/dsh-robot-lab'

const source = process.env.DSH_MICRODUCK_SOURCE_ROOT
const python = process.env.DSH_MICRODUCK_PYTHON
const mlxPython = process.env.DSH_MICRODUCK_MLX_PYTHON
const backend = process.env.DSH_MICRODUCK_BACKEND ?? 'cpu'
const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/robot/robot-lab-microduck/', import.meta.url)

it.skipIf(!source || !python)('trains, reloads and evaluates real physics through the Loader-owned provider', { timeout: 210_000, retry: 0 }, async () => {
  if (backend !== 'cpu' && backend !== 'mlx') throw new Error('DSH_MICRODUCK_BACKEND must be cpu or mlx')
  if (backend === 'mlx' && !mlxPython) throw new Error('MLX smoke requires DSH_MICRODUCK_MLX_PYTHON; no CPU fallback')
  const learnerDevice = backend === 'mlx' ? 'metal' : 'cpu'
  const trainingSteps = backend === 'mlx' ? 32 : 1024
  const configPath = fileURLToPath(new URL('cordis.yml', fixture))
  const binScript = fileURLToPath(new URL('smoke-driver.ts', fixture))
  const result = await runLoaderSmoke({
    label: 'real MicroDuck host-provider pipeline', tempDirPrefix: 'dsh-robot-provider-',
    configPath, binScript, libBinScript: binScript, mode: 'src',
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 180_000,
    env: { DSH_MICRODUCK_SOURCE_ROOT: source, DSH_MICRODUCK_PYTHON: python,
      DSH_MICRODUCK_MLX_PYTHON: mlxPython, DSH_MICRODUCK_BACKEND: backend },
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
      expect(Object.keys(manifest.provenance.trainer.helperSha256)).toEqual(backend === 'mlx' ? ['mlx_ppo.py'] : [])
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
    frameCount: number
    deployment: { allowed: boolean }
    policyHash: string
  }
  expect(evidence).toMatchObject({ mode: 'real-host-provider', backend, learnerDevice, trainingSteps })
  expect(evidence.frameCount).toBeGreaterThan(0)
  expect(evidence.deployment.allowed).toBe(false)
  expect(evidence.policyHash).toMatch(/^[a-f0-9]{64}$/)
  if (process.env.DSH_ROBOT_SMOKE_EVIDENCE !== undefined) {
    await mkdir(dirname(process.env.DSH_ROBOT_SMOKE_EVIDENCE), { recursive: true })
    await writeFile(process.env.DSH_ROBOT_SMOKE_EVIDENCE, result.stdout)
  }
})
