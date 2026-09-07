/** Real RLX stop and dead-worker recovery through the confined provider, without hardware. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { RobotRunId } from '@deepseek-ai/dsh-robot-lab'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subprocess-local'

const execute = promisify(execFile)
const config = process.argv[2]
assert(config, 'Expected fixture config path')
assert.equal(process.platform, 'darwin', 'This real RLX worker exercise requires Apple Metal and POSIX groups')
assert.equal(process.env.DSH_ROBOT_LIFECYCLE, '1', 'Lifecycle budget must be explicitly enabled')
const uninstall = installFailLoud('robot-lifecycle-smoke')
let ctx: Context | undefined
try {
  ctx = await boot('robot-lifecycle-smoke', config)
  const agents = ctx.get('agents')
  const loadedLab = ctx.get('robotLab')
  const subprocess = ctx.get('subprocess')
  assert(agents && loadedLab && subprocess, 'Fixture requires real session, robot and subprocess services')
  const lab = loadedLab
  const { agent } = await agents.create({ sessionId: SessionId('robot-lifecycle-smoke'), meta: { cwd: process.cwd() } })
  const signal = new AbortController().signal
  const root = join(process.cwd(), '.microduck-studio', createHash('sha256').update(agent.session.id).digest('hex'))
  const trainers = new Map<string, SubprocessHandle>()
  // oxlint-disable-next-line typescript/unbound-method -- Preserve identity for restoration; call supplies the receiver.
  const spawn = subprocess.spawn
  // Observe real handles; executable, confinement, IO, signals and process ownership are unchanged.
  subprocess.spawn = function (spec) {
    const handle = spawn.call(subprocess, spec)
    if (typeof spec.stdio.stdin === 'object') {
      const input = JSON.parse(spec.stdio.stdin.data) as { request: { operation: string; runId?: string } }
      if (input.request.operation === 'train' && input.request.runId) trainers.set(input.request.runId, handle)
    }
    return handle
  }
  ctx.effect(() => () => { subprocess.spawn = spawn }, 'restore fixture subprocess observer')

  async function table(): Promise<Array<{ pid: number; parent: number; group: number; state: string }>> {
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,pgid=,stat='], { timeout: 5000 })
    return stdout.trim().split('\n').map((line) => {
      const [pid, parent, group, state] = line.trim().split(/\s+/)
      assert(pid && parent && group && state, 'Expected POSIX process identity fields')
      return { pid: Number(pid), parent: Number(parent), group: Number(group), state }
    })
  }
  async function waitFor(label: string, condition: () => Promise<boolean>, milliseconds = 60_000): Promise<void> {
    const deadline = performance.now() + milliseconds
    while (!await condition()) {
      assert(performance.now() < deadline, `Timed out observing ${label}`)
      await delay(50)
    }
  }
  const readiness = await lab.execute(agent, { operation: 'readiness' }, signal)
  assert.equal(readiness.operation, 'readiness')
  if (readiness.operation !== 'readiness') throw new Error('Unexpected readiness result')
  assert(readiness.readiness.backends.rlx.available, 'Configured RLX runtime must be available; no fallback')
  const behaviors = await lab.execute(agent, { operation: 'behaviors' }, signal)
  assert.equal(behaviors.operation, 'behaviors')
  if (behaviors.operation !== 'behaviors') throw new Error('Unexpected behaviors result')
  const stand = behaviors.behaviors.find(behavior => behavior.id === 'stand')
  assert(stand, 'Standing reward must be installed')
  const spec = { name: 'rlx-lifecycle', backend: 'rlx' as const, behaviorId: stand.id, steps: 192000, envs: 2,
    seed: 71, actuator: 'bam' as const, weights: Object.fromEntries(stand.terms.map(term => [term.key, term.weight])), clip: null }

  async function running() {
    const admitted = await lab.execute(agent, { operation: 'train', spec }, signal)
    assert.equal(admitted.operation, 'train')
    if (admitted.operation !== 'train') throw new Error('Unexpected admission')
    assert.equal(admitted.run.spec.backend, 'rlx')
    const handle = trainers.get(admitted.run.id)
    assert(handle, 'Observer must capture the actual admitted trainer')
    const directory = join(root, 'runs', admitted.run.id)
    let exited = false
    void handle.done.then(() => { exited = true }, () => { exited = true })
    await waitFor('real rollout progress', async () => {
      assert(!exited, `Trainer exited before real progress: ${handle.collected.stderr?.readFrom(0).text ?? ''}`)
      if (!(await readdir(directory)).includes('progress.jsonl')) return false
      const contents = await readFile(join(directory, 'progress.jsonl'), 'utf8')
      const newline = contents.lastIndexOf('\n')
      if (newline < 0) return false
      const complete = contents.slice(0, newline).split('\n').filter(Boolean)
      return complete.some(line => (JSON.parse(line) as { steps: number }).steps > 0)
    })
    const members = (await table()).filter(row => row.group === handle.pid && !row.state.startsWith('Z'))
    assert(members.some(row => row.pid === handle.pid), 'Actual trainer must still be alive')
    const workers = members.filter(row => row.pid !== handle.pid)
    assert(workers.length > 0, 'Must observe actual live CPU worker descendants before stopping')
    return { runId: admitted.run.id, handle, directory, workers }
  }

  async function stop(runId: RobotRunId, handle: SubprocessHandle, directory: string) {
    const started = performance.now()
    const stopped = await lab.execute(agent, { operation: 'stop', runId }, signal)
    assert.equal(stopped.operation, 'stop')
    if (stopped.operation !== 'stop') throw new Error('Unexpected stop result')
    assert.equal(stopped.run.state, 'stopped')
    assert.equal(stopped.run.policyId, null)
    assert.equal(stopped.run.policySha256, null)
    assert.equal(await handle.waitForExit(AbortSignal.timeout(5000)), true)
    const alive = (await table()).filter(row => row.group === handle.pid && !row.state.startsWith('Z'))
    assert.deepEqual(alive, [], 'Stop must return after the process group has no live members')
    const files = await readdir(directory)
    assert(!files.includes('policy.onnx'), 'Stopped training must not publish a final policy')
    const elapsedMs = performance.now() - started
    assert(elapsedMs < 30_000, 'Stop must finish well before the 120-second training watchdog')
    return { runId, state: stopped.run.state, elapsedMs, liveProcessesAfterStop: alive.length }
  }

  const first = await running()
  // An admitted run stays owned even while a concurrent admission is rejected.
  await assert.rejects(lab.execute(agent, { operation: 'train', spec }, signal), /capacity is occupied/)
  const ordinaryStop = await stop(first.runId, first.handle, first.directory)

  const second = await running()
  // Recheck the group immediately before signaling only this fixture's owned descendants.
  const beforeFault = (await table()).filter(row => row.group === second.handle.pid && row.pid !== second.handle.pid && !row.state.startsWith('Z'))
  assert(beforeFault.length > 0)
  for (const worker of beforeFault) process.kill(worker.pid, 'SIGKILL')
  await waitFor('CPU workers to exit after injected failure', async () =>
    !(await table()).some(row => row.group === second.handle.pid && row.pid !== second.handle.pid && !row.state.startsWith('Z')), 10_000)
  assert((await table()).some(row => row.pid === second.handle.pid && !row.state.startsWith('Z')),
    'The learner must remain alive after losing workers, so API stop exercises supervisor rescue')
  const deadWorkerStop = await stop(second.runId, second.handle, second.directory)

  const resumed = await lab.execute(agent, { operation: 'train', spec: { ...spec, steps: 32, seed: 72 } }, signal)
  assert.equal(resumed.operation, 'train')
  if (resumed.operation !== 'train') throw new Error('Expected fresh admission after worker failure')
  let completed = resumed.run
  await waitFor('fresh capacity to complete a real export', async () => {
    const update = await lab.execute(agent, { operation: 'run', runId: resumed.run.id }, signal)
    assert.equal(update.operation, 'run')
    if (update.operation !== 'run') throw new Error('Unexpected run result')
    completed = update.run
    return completed.state !== 'starting' && completed.state !== 'running'
  })
  assert.equal(completed.state, 'completed', completed.error ?? 'Fresh run must finish')
  assert(completed.policySha256 && completed.policyId)
  const evidence = { mode: 'real-confined-rlx-lifecycle', ordinaryStop, deadWorkerStop,
    observedWorkers: [first.workers.length, second.workers.length], capacityReused: true,
    completedRunId: completed.id, policySha256: completed.policySha256, hardwareActivated: false }
  await writeFile(join(process.cwd(), 'lifecycle-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
