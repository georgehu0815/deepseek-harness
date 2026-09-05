/** Reject unsupported run formats through the real Loader without rewriting stored files. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent'
import type { RobotLabRequest, RobotPolicyId, RobotRunId } from '@deepseek-ai/dsh-robot-lab'

const config = process.argv[2]
if (config === undefined) throw new Error('Expected a Robot Lab fixture config path')
const source = join(process.cwd(), 'metadata-source')
await mkdir(join(source, 'microduck_local/src/microduck_local'), { recursive: true })
await writeFile(join(source, 'microduck_local/src/microduck_local/contract.py'), '# Metadata-only fixture: unsupported formats require no physics imports.\n')
process.env.DSH_MICRODUCK_SOURCE_ROOT = source
process.env.DSH_MICRODUCK_PYTHON = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
const uninstall = installFailLoud('robot-history-snapshot')
let ctx: Context | undefined
try {
  ctx = await boot('robot-history-snapshot', config)
  const agent = ctx.get('agents')?.roots()[0]
  const lab = ctx.get('robotLab')
  if (agent === undefined || lab === undefined) throw new Error('Fixture requires a real agent and Robot Lab')
  const identity = createHash('sha256').update(agent.session.id).digest('hex')
  const id = 'run-00000000-0000-0000-0000-000000000000' as RobotRunId
  const directory = join(process.cwd(), '.microduck-studio', identity, 'runs', id)
  await mkdir(directory, { recursive: true })
  // Unsupported metadata and opaque policy bytes must never reach artifact inspection or inference.
  const bytes = Buffer.from('historical policy fixture')
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const spec = { name: 'Historical dance' }
  const manifest = JSON.stringify({ formatVersion: 2, id, state: 'completed', spec,
    recipeHash: createHash('sha256').update(JSON.stringify(spec)).digest('hex'), provenance: { bridgeSha256: 'historical-bridge' },
    observationProfile: 'microduck-lab-body-phase-61', policyId: 'run:' + id, policySha256: checksum })
  await writeFile(join(directory, 'manifest.json'), manifest)
  await writeFile(join(directory, 'policy.onnx'), bytes)
  const signal = new AbortController().signal
  const listing = await lab.execute(agent, { operation: 'runs' }, signal)
  if (listing.operation !== 'runs' || listing.runs.length !== 0 || listing.incompatibleRuns.length !== 1) throw new Error('Expected unsupported-format listing diagnostic')
  const result = await lab.execute(agent, { operation: 'policies' }, signal)
  if (result.operation !== 'policies' || result.policies.length !== 0) throw new Error('Unsupported runs must not expose policies')
  const policyId = ('run:' + id) as RobotPolicyId
  const requests: RobotLabRequest[] = [
    { operation: 'run', runId: id },
    { operation: 'stop', runId: id },
    { operation: 'simulate', policyId, steps: 100, seed: 0, command: [0, 0, 0] },
    { operation: 'evaluate', spec: { policyId, episodes: 1, stepsPerEpisode: 100, seed: 0, maxTerminations: 0, minMeanUprightFraction: 0.5 } },
  ]
  const rejectedOperations: string[] = []
  for (const request of requests) {
    try {
      await lab.execute(agent, request, signal)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('unsupported Robot Lab run format; only version 3 is supported')) throw error
      rejectedOperations.push(request.operation)
    }
  }
  if (rejectedOperations.length !== requests.length) throw new Error('Unsupported formats must reject all direct operations')
  process.stdout.write(JSON.stringify({
    runs: listing.runs, incompatibleRuns: listing.incompatibleRuns, policies: result.policies, rejectedOperations,
    manifestUnchanged: await readFile(join(directory, 'manifest.json'), 'utf8') === manifest,
    artifactUnchanged: (await readFile(join(directory, 'policy.onnx'))).equals(bytes),
  }) + '\n')
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
