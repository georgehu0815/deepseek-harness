/** Explicitly opted-in Apple Metal lifecycle verification; independent private Loader workspace. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { RobotRun } from '@deepseek-ai/dsh-robot-lab'

const enabled = process.env.DSH_MICRODUCK_LIFECYCLE === '1'
const fixture = new URL('./fixtures/provider/', import.meta.url)

it.skipIf(!enabled || process.platform !== 'darwin')('stops real RLX workers, rescues a dead-worker learner and reuses capacity', { timeout: 210_000, retry: 0 }, async () => {
  for (const name of ['DSH_MICRODUCK_SOURCE_ROOT', 'DSH_MICRODUCK_PYTHON', 'DSH_MICRODUCK_RLX_SOURCE_ROOT', 'DSH_MICRODUCK_RLX_PYTHON']) {
    if (!process.env[name]) throw new Error(`Opted-in RLX lifecycle verification requires ${name}`)
  }
  const driver = fileURLToPath(new URL('lifecycle-driver.ts', fixture))
  const result = await runLoaderSmoke({
    label: 'real confined RLX lifecycle', tempDirPrefix: 'dsh-robot-lifecycle-',
    configPath: fileURLToPath(new URL('cordis.yml', fixture)),
    binScript: driver, libBinScript: driver, mode: 'src',
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 180_000,
    env: {
      DSH_MICRODUCK_SOURCE_ROOT: process.env.DSH_MICRODUCK_SOURCE_ROOT,
      DSH_MICRODUCK_PYTHON: process.env.DSH_MICRODUCK_PYTHON,
      DSH_MICRODUCK_RLX_SOURCE_ROOT: process.env.DSH_MICRODUCK_RLX_SOURCE_ROOT,
      DSH_MICRODUCK_RLX_PYTHON: process.env.DSH_MICRODUCK_RLX_PYTHON,
      DSH_ROBOT_LIFECYCLE: '1',
    },
    inspect: async (cwd) => {
      const root = join(cwd, '.microduck-studio')
      const files = await readdir(root, { recursive: true })
      const manifests = files.filter(path => path.endsWith('manifest.json'))
      expect(manifests).toHaveLength(3)
      let stopped = 0
      let completed = 0
      for (const manifestPath of manifests) {
        const manifest = JSON.parse(await readFile(join(root, manifestPath), 'utf8')) as RobotRun
        const runDirectory = dirname(manifestPath)
        if (files.includes(join(runDirectory, 'state.json'))) {
          const state = JSON.parse(await readFile(join(root, runDirectory, 'state.json'), 'utf8')) as { state: string }
          expect(state.state).toBe('stopped')
          expect(manifest.policyId).toBeNull()
          expect(manifest.policySha256).toBeNull()
          expect(files.includes(join(runDirectory, 'policy.onnx'))).toBe(false)
          stopped++
        } else {
          expect(manifest.state).toBe('completed')
          expect(manifest.policySha256).toMatch(/^[a-f0-9]{64}$/)
          completed++
        }
      }
      expect({ stopped, completed }).toEqual({ stopped: 2, completed: 1 })
    },
  })
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'real-confined-rlx-lifecycle',
    ordinaryStop: { state: 'stopped', liveProcessesAfterStop: 0 },
    deadWorkerStop: { state: 'stopped', liveProcessesAfterStop: 0 },
    capacityReused: true, hardwareActivated: false })
  const evidence = process.env.DSH_ROBOT_LIFECYCLE_EVIDENCE
  if (evidence) {
    await mkdir(dirname(evidence), { recursive: true })
    await writeFile(evidence, result.stdout)
  }
})
