import { execFile } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

// Execute the shipping Bash/Node checks; only installation, Python, Git and launch are faked.
const launcher = fileURLToPath(new URL('../run-robot-lab.sh', import.meta.url))
const assets = [
  'microduck_local/pyproject.toml',
  'microduck_local/uv.lock',
  'microduck_local/src/microduck_local/contract.py',
  'microduck_rl/src/mjlab_microduck/robot/microduck/scene_walk.xml',
  'microduck/policies/alpha_stand.onnx',
  'microduck/policies/alpha_walking.onnx',
]
const artifacts = [
  'apps/cli/lib/bin.js',
  'packages/robot/robot-lab/lib/index.js',
  'packages/robot/robot-lab-microduck/lib/index.js',
  'packages/client/ui-robot-lab/lib/client.js',
]
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-robot-lab-bundle']
const setup = ['--no-build', '--setup-only']

interface Call {
  command: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  stdin: string
}

function put(file: string, contents = '') {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-robot-lab test-')))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const repo = join(root, 'checkout')
  const home = join(root, 'home')
  const state = join(home, '.dsh', 'robot-lab')
  const lab = join(root, 'microduck-lab')
  const bin = join(root, 'bin')
  for (const dir of [repo, home, bin]) mkdirSync(dir, { recursive: true })
  copyFileSync(launcher, join(repo, 'run-robot-lab.sh'))
  for (const file of assets) put(join(lab, file))
  for (const file of artifacts) put(join(repo, file))
  const journal = join(root, 'calls.jsonl')
  put(journal)
  const mock = join(bin, 'mock.cjs')
  put(mock, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const command = path.basename(process.argv[1])
const args = process.argv.slice(2)
const env = process.env
if (command === 'uname') {
  if (args[0] === '-s') console.log(env.MOCK_OS || 'Linux')
  else if (args[0] === '-m') console.log(env.MOCK_ARCH || 'x86_64')
  else process.exit(97)
  process.exit(0)
}
const stdin = command === 'python' && args.includes('--source') ? fs.readFileSync(0, 'utf8') : ''
fs.appendFileSync(env.MOCK_JOURNAL, JSON.stringify({ command, executable: process.argv[1], args, cwd: process.cwd(), env, stdin }) + '\\n')
if (command === 'python') {
  if (args.includes('-I')) {
    const code = args[args.indexOf('-c') + 1]
    process.exit(Number((code.includes('import mlx.core') ? env.MOCK_MLX_EXIT : env.MOCK_MLX_ENV_EXIT) || 0))
  }
  if (args.includes('-c')) process.exit(Number(env.MOCK_PYTHON_EXIT || 0))
  if (!args.includes('--source')) process.exit(97)
  process.stdout.write(env.MOCK_READINESS || '{"readiness":{"ready":true}}')
} else if (command === 'uv') {
  if (env.MOCK_UV_FAIL === args[0]) process.exit(42)
  if (args[0] === 'pip' && args[1] === 'install') process.exit(0)
  if (args[0] !== 'sync') process.exit(97)
  const python = path.join(env.UV_PROJECT_ENVIRONMENT, 'bin', 'python')
  fs.mkdirSync(path.dirname(python), { recursive: true })
  if (!fs.existsSync(python)) fs.symlinkSync(env.MOCK_COMMAND, python)
} else if (command === 'pnpm') {
  const action = args[0] === 'exec' ? 'verify' : args[0] === 'dsh' ? 'launch' : args[0] === 'install' ? 'install' : args.join(' ') === 'run build' ? 'build' : ''
  if (!action) process.exit(97)
  if (env.MOCK_PNPM_FAIL === action) process.exit(42)
  if (action === 'build' && env.MOCK_BUILD_OUTPUT === '1') {
    for (const file of ${JSON.stringify(artifacts)}) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'built fixture')
    }
  }
  if (action === 'verify' && env.MOCK_EVIDENCE !== 'missing') {
    fs.writeFileSync(env.DSH_ROBOT_SMOKE_EVIDENCE, env.MOCK_EVIDENCE === 'empty' ? '' : '{"fixture":true}')
  }
} else if (command === 'git') {
  if (args[0] === 'clone' && args[1] === '--recursive' && args.length === 4 && env.MOCK_CLONE === '1') {
    if (![env.MOCK_LAB, path.join(env.MOCK_LAB, 'microduck'), path.join(env.MOCK_LAB, 'microduck_rl')].includes(args[3])) process.exit(97)
    const isLab = args[3] === env.MOCK_LAB
    const prefix = isLab ? 'microduck_local/' : path.basename(args[3]) + '/'
    for (const asset of ${JSON.stringify(assets)}.filter(file => file.startsWith(prefix))) {
      const file = path.join(args[3], isLab ? asset : asset.slice(prefix.length))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'cloned fixture: ' + asset)
    }
    fs.writeFileSync(path.join(args[3], '.git'), 'fixture Git metadata')
  } else {
    if (args[0] !== '-C' || args.slice(2).join(' ') !== 'rev-parse HEAD') process.exit(97)
    console.log('fixture-revision')
  }
} else process.exit(97)
`)
  chmodSync(mock, 0o755)
  // Mocked uname keeps platform acceptance independent of the test host.
  for (const command of ['pnpm', 'python', 'python3', 'uv', 'git', 'uname']) symlinkSync(mock, join(bin, command))
  symlinkSync(process.execPath, join(bin, 'node'))
  const python = join(lab, 'microduck_local/.venv/bin/python')
  mkdirSync(dirname(python), { recursive: true })
  symlinkSync(mock, python)
  const env = {
    PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: root,
    MOCK_JOURNAL: journal, MOCK_COMMAND: mock,
  }
  const profile = (name = 'robot-lab') => join(home, '.dsh', 'profiles', name)
  const calls = (): Call[] => readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Call)
  function run(args: string[], overrides: Record<string, string> = {}, cwd = repo) {
    return new Promise<{ code: number; output: string }>((resolve, reject) => {
      execFile('/bin/bash', [join(repo, 'run-robot-lab.sh'), ...args], {
        cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10_000,
      }, (error, stdout, stderr) => {
        if (error && (typeof error.code !== 'number' || error.killed)) reject(new Error('Launcher did not complete', { cause: error }))
        else resolve({ code: typeof error?.code === 'number' ? error.code : 0, output: stdout + stderr })
      })
    })
  }
  return { root, repo, home, state, lab, python, profile, calls, run }
}

async function listen(port = 0) {
  const server = createServer(socket => socket.end('owned listener'))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const close = () => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  onTestFinished(async () => { if (server.listening) await close() })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  return { server, port: address.port, close }
}

describe.skipIf(process.platform === 'win32')('run-robot-lab.sh', () => {
  it.each(['--help', '-h'])('%s has no setup side effects', async (flag) => {
    const f = fixture()
    rmSync(f.lab, { recursive: true })
    const result = await f.run([flag])
    expect(result.code).toBe(0)
    expect(result.output).toContain('Usage: ./run-robot-lab.sh')
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
    expect(existsSync(f.lab)).toBe(false)
  })

  it.each(['--source', '--python', '--mlx-python', '--profile', '--port'])('rejects absent, empty and option-valued %s', async (flag) => {
    const f = fixture()
    for (const suffix of [[], [''], ['--setup-only']]) {
      const result = await f.run([flag, ...suffix])
      expect(result.code).toBe(1)
      expect(result.output).toContain(`${flag} requires a value`)
    }
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
  })

  it.each([
    [['--unknown'], 'unknown option'],
    [['--profile', '../personal'], 'invalid profile name'],
    [['--profile', '-bad'], 'invalid profile name'],
    ...['0', '65536', '-1', '1.5', 'abc', '123456'].map(port => [['--port', port], 'port must be']),
    [['--python', '/unused/python', '--setup-python'], 'conflicts with --setup-python'],
    [['--mlx-python', '/unused/python', '--setup-mlx'], 'conflicts with --setup-mlx'],
    [['--setup-mlx', '--mlx-python', '/unused/python'], 'conflicts with --setup-mlx'],
    [['--mlx-python', 'python'], 'requires an absolute path'],
    [['--mlx-python', './env/bin/python'], 'requires an absolute path'],
  ] as [string[], string][])('rejects invalid arguments %j', async (args, message) => {
    const f = fixture()
    const result = await f.run(args)
    expect(result.code).toBe(1)
    expect(result.output).toContain(message)
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
  })

  it.each(['', 'microduck', 'microduck_rl', ...assets])('rejects missing checkout or asset %s without cloning', async (missing) => {
    const f = fixture()
    rmSync(join(f.lab, missing), { recursive: true })
    const result = await f.run(setup)
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/missing checkout|not a supported Lab checkout|missing source asset/)
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
  })

  it('--clone-source provisions cold checkouts, managed Python and build outputs before setup-only verification', async () => {
    const f = fixture()
    rmSync(f.lab, { recursive: true })
    for (const artifact of artifacts) rmSync(join(f.repo, artifact))
    const result = await f.run(['--clone-source', '--verify', '--setup-only'], {
      MOCK_CLONE: '1', MOCK_LAB: f.lab, MOCK_BUILD_OUTPUT: '1',
    })
    expect(result.code).toBe(0)
    expect(result.output).toContain('setup complete; no Web server started')
    const calls = f.calls()
    expect(calls.map(call => call.command)).toEqual([
      'git', 'git', 'git', 'uv', 'python', 'git', 'git', 'git', 'pnpm', 'pnpm', 'python', 'pnpm',
    ])
    expect(calls.filter(call => call.command === 'git').map(call => call.args)).toEqual([
      ['clone', '--recursive', 'https://github.com/georgehu0815/microduck-lab.git', f.lab],
      ['clone', '--recursive', 'https://github.com/pollen-robotics/microduck.git', join(f.lab, 'microduck')],
      ['clone', '--recursive', 'https://github.com/pollen-robotics/microduck_rl.git', join(f.lab, 'microduck_rl')],
      ...[f.lab, join(f.lab, 'microduck'), join(f.lab, 'microduck_rl')].map(dir => ['-C', dir, 'rev-parse', 'HEAD']),
    ])
    for (const asset of assets) expect(readFileSync(join(f.lab, asset), 'utf8')).toBe(`cloned fixture: ${asset}`)
    for (const artifact of artifacts) expect(readFileSync(join(f.repo, artifact), 'utf8')).toBe('built fixture')
    const uv = calls.find(call => call.command === 'uv')
    expect(uv?.args).toEqual(['sync', '--frozen', '--python', '3.12', '--project', join(f.lab, 'microduck_local')])
    expect(uv?.env.UV_PROJECT_ENVIRONMENT).toBe(join(f.state, 'venv'))
    expect(existsSync(join(f.state, 'venv/bin/python'))).toBe(true)
    expect(existsSync(join(f.lab, 'microduck_local/.venv'))).toBe(false)
    const pnpm = calls.filter(call => call.command === 'pnpm')
    expect(pnpm.map(call => call.args)).toEqual([
      ['install', '--frozen-lockfile'], ['run', 'build'],
      ['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/robot/robot-lab-microduck/tests/provider.e2e.ts'],
    ])
    expect(pnpm[0]?.env.CI).toBe('true')
    expect(pnpm.every(call => call.cwd === f.repo)).toBe(true)
    const verify = pnpm.at(-1)!
    expect(verify.env).toMatchObject({
      DSH_MICRODUCK_SOURCE_ROOT: f.lab, DSH_MICRODUCK_PYTHON: join(f.state, 'venv/bin/python'),
    })
    expect(readFileSync(verify.env.DSH_ROBOT_SMOKE_EVIDENCE!, 'utf8')).toBe('{"fixture":true}')
    expect(JSON.parse(readFileSync(join(f.state, 'readiness.json'), 'utf8'))).toEqual({ readiness: { ready: true } })
    expect(JSON.parse(readFileSync(join(f.profile(), 'package.json'), 'utf8'))).toMatchObject({ dsh: { profile: { bundles } } })
  })

  it('--clone-source preserves existing source checkouts without clone, pull or reset', async () => {
    const f = fixture()
    const checkouts = [f.lab, join(f.lab, 'microduck'), join(f.lab, 'microduck_rl')]
    for (const dir of checkouts) put(join(dir, '.git'), 'personal Git metadata')
    for (const asset of assets) put(join(f.lab, asset), `personal source: ${asset}`)
    const python = readFileSync(f.python)
    const result = await f.run([...setup, '--clone-source'])
    expect(result.code).toBe(0)
    expect(f.calls().filter(call => call.command === 'git').map(call => call.args)).toEqual(
      checkouts.map(dir => ['-C', dir, 'rev-parse', 'HEAD']),
    )
    expect(f.calls().some(call => ['uv', 'pnpm'].includes(call.command))).toBe(false)
    for (const dir of checkouts) expect(readFileSync(join(dir, '.git'), 'utf8')).toBe('personal Git metadata')
    for (const asset of assets) expect(readFileSync(join(f.lab, asset), 'utf8')).toBe(`personal source: ${asset}`)
    expect(readFileSync(f.python)).toEqual(python)
  })

  it.each(artifacts)('--no-build rejects missing %s without installing or building', async (artifact) => {
    const f = fixture()
    rmSync(join(f.repo, artifact))
    const result = await f.run(setup)
    expect(result.code).toBe(1)
    expect(result.output).toContain(`missing build artifact ${artifact}`)
    expect(f.calls().map(call => call.command)).toEqual(['python'])
    expect(existsSync(f.profile())).toBe(false)
  })

  it.each(['{"readiness":{"ready":false}}', '{"readiness":{}}', '{"readiness":{"ready":"true"}}', '{}', 'not JSON'])('rejects unsuccessful readiness JSON %s despite Python exit zero', async (readiness) => {
    const f = fixture()
    const result = await f.run([...setup, '--verify'], { MOCK_READINESS: readiness })
    expect(result.code).not.toBe(0)
    expect(readFileSync(join(f.state, 'readiness.json'), 'utf8')).toBe(readiness)
    expect(f.calls().filter(call => call.command === 'pnpm')).toEqual([])
    expect(f.calls().at(-1)?.stdin).toBe('{"request":{"operation":"readiness"},"limits":{}}\n')
  })

  it.each([[], [...bundles].reverse(), [bundles[0], bundles[1]]].map(present => ({ present })))('preserves and refuses unrelated profile bundles $present', async ({ present }) => {
    const f = fixture()
    const manifest = JSON.stringify({ private: true, dsh: { profile: { bundles: present } }, personal: 'keep' })
    const patch = '# private settings\nplugins: []\n'
    put(join(f.profile(), 'package.json'), manifest)
    put(join(f.profile(), 'cordis.local.patch.yml'), patch)
    const result = await f.run(setup)
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Refusing to overwrite unrelated profile')
    expect(readFileSync(join(f.profile(), 'package.json'), 'utf8')).toBe(manifest)
    expect(readFileSync(join(f.profile(), 'cordis.local.patch.yml'), 'utf8')).toBe(patch)
    expect(readdirSync(f.profile()).sort()).toEqual(['cordis.local.patch.yml', 'package.json'])
    expect(f.calls().map(call => call.command)).toEqual(['python'])
  })

  it('creates a dedicated profile and preserves personal manifest, workspace and patches across reruns', async () => {
    const f = fixture()
    expect((await f.run(setup)).code).toBe(0)
    const file = join(f.profile(), 'package.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      name: 'dsh-profile-robot-lab', private: true, dependencies: {}, dsh: { profile: { bundles } },
    })
    expect(readFileSync(join(f.profile(), 'pnpm-workspace.yaml'), 'utf8')).toBe('packages: []\n')
    const personal = {
      'package.json': JSON.stringify({ dependencies: { personal: '1.0.0' }, dsh: { profile: { bundles: [...bundles, 'personal'] } } }, null, 4),
      'pnpm-workspace.yaml': 'packages: []\nonlyBuiltDependencies: [personal]\n',
      'cordis.local.patch.yml': '# personal local overlay\nplugins: []\n',
      'cordis.patch.yml': '# personal patch\nplugins: []\n',
    }
    for (const [name, contents] of Object.entries(personal)) put(join(f.profile(), name), contents)
    for (let rerun = 0; rerun < 2; rerun++) {
      expect((await f.run(setup)).code).toBe(0)
      for (const [name, contents] of Object.entries(personal)) expect(readFileSync(join(f.profile(), name), 'utf8')).toBe(contents)
    }
    expect(f.calls().filter(call => call.command === 'pnpm')).toEqual([])
  })

  it('--setup-only builds and checks readiness without launching', async () => {
    const f = fixture()
    const result = await f.run(['--setup-only'])
    expect(result.code).toBe(0)
    expect(result.output).toContain('setup complete; no Web server started')
    const calls = f.calls()
    expect(calls.map(call => [call.command, ...call.args])).toEqual([
      ['python', '-B', '-c', expect.stringContaining('sys.version_info')],
      ['pnpm', 'install', '--frozen-lockfile'],
      ['pnpm', 'run', 'build'],
      ['python', '-B', 'packages/robot/robot-lab-microduck/python/bridge.py', '--source', f.lab, '--root', join(f.state, 'preflight')],
    ])
    expect(calls[1]?.env.CI).toBe('true')
    expect(calls[1]?.cwd).toBe(f.repo)
  })

  it.each(['install', 'build', 'verify'])('propagates %s failure without launch', async (action) => {
    const f = fixture()
    const result = await f.run(['--setup-only', '--verify'], { MOCK_PNPM_FAIL: action })
    expect(result.code).toBe(42)
    const pnpmCalls = f.calls().filter(call => call.command === 'pnpm')
    expect(pnpmCalls.at(-1)?.args[0]).toBe(action === 'verify' ? 'exec' : action === 'build' ? 'run' : 'install')
    expect(pnpmCalls.some(call => call.args[0] === 'dsh')).toBe(false)
  })

  it.each(['missing', 'empty'])('--verify rejects %s evidence even with a stale successful report', async (evidence) => {
    const f = fixture()
    put(join(f.state, 'verification.old/host-provider.json'), '{"stale":true}')
    const result = await f.run([...setup, '--verify'], { MOCK_EVIDENCE: evidence })
    expect(result.code).toBe(1)
    expect(result.output).toContain('verification produced no evidence')
    expect(readFileSync(join(f.state, 'verification.old/host-provider.json'), 'utf8')).toBe('{"stale":true}')
  })

  it('--verify supplies a fresh evidence path on every successful run', async () => {
    const f = fixture()
    for (let run = 0; run < 2; run++) expect((await f.run([...setup, '--verify'])).code).toBe(0)
    const calls = f.calls().filter(call => call.command === 'pnpm')
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.args).toEqual(['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/robot/robot-lab-microduck/tests/provider.e2e.ts'])
      expect(call.env.DSH_ROBOT_SMOKE_EVIDENCE).toMatch(/verification\.[^/]+\/host-provider\.json$/)
      expect(readFileSync(call.env.DSH_ROBOT_SMOKE_EVIDENCE!, 'utf8')).toBe('{"fixture":true}')
    }
    expect(calls[0]?.env.DSH_ROBOT_SMOKE_EVIDENCE).not.toBe(calls[1]?.env.DSH_ROBOT_SMOKE_EVIDENCE)
  })

  it('--setup-python uses frozen uv Python 3.12 in an external environment, preserving Lab .venv', async () => {
    const f = fixture()
    const original = readFileSync(f.python)
    const result = await f.run([...setup, '--setup-python'])
    expect(result.code).toBe(0)
    const [uv, version, readiness] = f.calls()
    expect(uv?.command).toBe('uv')
    expect(uv?.args).toEqual(['sync', '--frozen', '--python', '3.12', '--project', join(f.lab, 'microduck_local')])
    expect(uv?.env.UV_PROJECT_ENVIRONMENT).toBe(join(f.state, 'venv'))
    expect(version?.command).toBe('python')
    expect(readiness?.env.DSH_MICRODUCK_PYTHON).toBe(join(f.state, 'venv/bin/python'))
    expect(readFileSync(f.python)).toEqual(original)
  })

  it.each(['Linux/x86_64', 'Linux/aarch64', 'Darwin/x86_64'])('rejects MLX setup and reuse on %s before installation', async (platform) => {
    const f = fixture()
    const [MOCK_OS, MOCK_ARCH] = platform.split('/') as [string, string]
    for (const flags of [['--setup-mlx'], ['--mlx-python', f.python]]) {
      const result = await f.run([...setup, ...flags], { MOCK_OS, MOCK_ARCH })
      expect(result.code).toBe(1)
      expect(result.output).toContain('MLX requires Apple Silicon macOS')
    }
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
  })

  it('rejects an environment-selected MLX interpreter conflicting with setup', async () => {
    const f = fixture()
    const result = await f.run([...setup, '--setup-mlx'], { DSH_MICRODUCK_MLX_PYTHON: f.python })
    expect(result.code).toBe(1)
    expect(result.output).toContain('conflicts with --setup-mlx')
    expect(f.calls()).toEqual([])
  })

  it.each(['missing', 'not executable'])('rejects %s MLX Python without installation', async (kind) => {
    const f = fixture()
    const python = join(f.root, 'external/bin/python')
    if (kind === 'not executable') put(python, '# not executable')
    const result = await f.run([...setup, '--mlx-python', python], { MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64' })
    expect(result.code).toBe(1)
    expect(result.output).toContain(`MLX Python is not executable: ${python}`)
    expect(f.calls()).toEqual([])
  })

  it('--setup-mlx isolates frozen dependencies and the MLX pin from CPU and Lab environments', async () => {
    const f = fixture()
    const original = readFileSync(f.python)
    const result = await f.run([...setup, '--setup-mlx'], { MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64' })
    expect(result.code).toBe(0)
    const python = join(f.state, 'mlx-venv/bin/python')
    const calls = f.calls()
    expect(calls.map(call => call.command)).toEqual(['python', 'uv', 'python', 'uv', 'python', 'python'])
    const [sync, install] = calls.filter(call => call.command === 'uv')
    expect(sync?.args).toEqual(['sync', '--frozen', '--project', join(f.lab, 'microduck_local'), '--python', '3.12', '--no-editable'])
    expect(sync?.env.UV_PROJECT_ENVIRONMENT).toBe(join(f.state, 'mlx-venv'))
    expect(install?.args).toEqual(['pip', 'install', '--python', python, 'mlx==0.31.1'])
    expect(calls[2]?.executable).toBe(python)
    expect(calls[2]?.args.at(-1)).toBe(join(f.state, 'mlx-venv'))
    expect(calls[2]?.args.join(' ')).toContain('sys.prefix == sys.base_prefix')
    expect(calls[4]?.executable).toBe(python)
    expect(calls.at(-1)?.executable).toBe(f.python)
    expect(calls.at(-1)?.env).toMatchObject({ DSH_MICRODUCK_PYTHON: f.python, DSH_MICRODUCK_MLX_PYTHON: python })
    expect(readFileSync(f.python)).toEqual(original)
    expect(existsSync(join(f.state, 'venv'))).toBe(false)
  })

  it.each(['sync', 'pip', 'environment', 'metal'])('propagates MLX %s failure without readiness, verification or launch', async (stage) => {
    const f = fixture()
    const result = await f.run([...setup, '--verify', '--setup-mlx'], {
      MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64',
      MOCK_UV_FAIL: stage, MOCK_MLX_ENV_EXIT: stage === 'environment' ? '42' : '0', MOCK_MLX_EXIT: stage === 'metal' ? '42' : '0',
    })
    expect(result.code).toBe(42)
    const calls = f.calls()
    expect(calls.some(call => call.command === 'pnpm' || call.args.includes('--source'))).toBe(false)
    expect(existsSync(f.profile())).toBe(false)
    if (stage === 'environment') expect(calls.some(call => call.args[0] === 'pip')).toBe(false)
  })

  it('refuses MLX setup through a symlink to an external environment', async () => {
    const f = fixture()
    mkdirSync(f.state, { recursive: true })
    symlinkSync(join(f.lab, 'microduck_local/.venv'), join(f.state, 'mlx-venv'))
    const original = readFileSync(f.python)
    const result = await f.run([...setup, '--setup-mlx'], { MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64' })
    expect(result.code).toBe(1)
    expect(result.output).toContain('symlinked managed environment')
    expect(f.calls().some(call => call.command === 'uv')).toBe(false)
    expect(readFileSync(f.python)).toEqual(original)
  })

  it.each(['flag', 'environment'])('reuses %s-selected MLX without installation and forwards it while preserving profiles', async (selection) => {
    const f = fixture()
    const python = join(f.root, 'external MLX/bin/python')
    mkdirSync(dirname(python), { recursive: true })
    symlinkSync(join(f.root, 'bin/mock.cjs'), python)
    const personal = {
      'package.json': JSON.stringify({ dependencies: { personal: '1' }, dsh: { profile: { bundles } } }),
      'cordis.patch.yml': '# user-owned provider override\n',
      'cordis.local.patch.yml': '# user-owned local override\n',
      'pnpm-workspace.yaml': 'packages: []\n# user-owned\n',
    }
    for (const [file, contents] of Object.entries(personal)) put(join(f.profile(), file), contents)
    const listener = await listen()
    const port = listener.port
    await listener.close()
    const result = await f.run(['--no-build', '--verify', '--port', String(port), ...(selection === 'flag' ? ['--mlx-python', python] : [])], {
      MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64', DSH_MICRODUCK_MLX_PYTHON: selection === 'environment' ? python : '/overridden/python',
      DSH_MICRODUCK_BACKEND: 'mlx',
    })
    expect(result.code).toBe(0)
    expect(result.output).toContain('real CPU integration verification')
    const calls = f.calls()
    expect(calls.find(call => call.command === 'pnpm' && call.args[0] === 'exec')?.env.DSH_MICRODUCK_BACKEND).toBe('cpu')
    const preflight = calls.find(call => call.args.includes('-I'))!
    expect(preflight.executable).toBe(python)
    expect(preflight.args.slice(0, 3)).toEqual(['-I', '-B', '-c'])
    for (const check of ['sys.version_info[:2] != (3, 12)', 'platform.machine() != "arm64"', 'version("mlx") != "0.31.1"', 'mx.metal.is_available()', 'mx.set_default_device(mx.gpu)', 'stream=mx.gpu', 'mx.eval(result)', 'result.item() != 3.0']) {
      expect(preflight.args[3]).toContain(check)
    }
    expect(calls.some(call => call.command === 'uv')).toBe(false)
    const readiness = calls.find(call => call.args.includes('--source'))!
    expect(readiness.executable).toBe(f.python)
    expect(readiness.args).not.toContain('--mlx-python')
    for (const call of calls.filter(call => call.command === 'pnpm')) expect(call.env.DSH_MICRODUCK_MLX_PYTHON).toBe(python)
    expect(calls.at(-1)?.args).toEqual(['dsh', '--profile', 'robot-lab', '--port', String(port), '--patch', join(f.profile(), 'cordis.local.patch.yml')])
    for (const [file, contents] of Object.entries(personal)) expect(readFileSync(join(f.profile(), file), 'utf8')).toBe(contents)
  })

  it('does not enable an existing managed MLX environment without opt-in', async () => {
    const f = fixture()
    const python = join(f.state, 'mlx-venv/bin/python')
    mkdirSync(dirname(python), { recursive: true })
    symlinkSync(join(f.root, 'bin/mock.cjs'), python)
    const result = await f.run([...setup, '--verify'], { MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64' })
    expect(result.code).toBe(0)
    expect(f.calls().some(call => call.command === 'uv' || call.args.includes('-I'))).toBe(false)
    expect(f.calls().at(-1)?.env.DSH_MICRODUCK_MLX_PYTHON).toBe('')
  })

  it('does not fall back or install when a reused MLX interpreter fails preflight', async () => {
    const f = fixture()
    const result = await f.run([...setup, '--verify', '--mlx-python', f.python], { MOCK_OS: 'Darwin', MOCK_ARCH: 'arm64', MOCK_MLX_EXIT: '43' })
    expect(result.code).toBe(43)
    expect(f.calls().map(call => call.command)).toEqual(['python', 'python'])
    expect(f.calls().at(-1)?.args).toContain('-I')
    expect(existsSync(f.profile())).toBe(false)
  })

  it.each([false, true])('launches with explicit port and local overlay=%s, resolving caller-relative paths', async (overlay) => {
    const f = fixture()
    const listener = await listen()
    const port = listener.port
    await listener.close()
    const patch = join(f.profile('personal-robot'), 'cordis.local.patch.yml')
    if (overlay) put(patch, '# keep my overlay\n')
    const result = await f.run(['--no-build', '--source', '../microduck-lab', '--python', '../microduck-lab/microduck_local/.venv/bin/python', '--profile', 'personal-robot', '--port', String(port)], { DSH_HOME: '../home/.dsh' })
    expect(result.code).toBe(0)
    const launch = f.calls().at(-1)
    expect(launch?.command).toBe('pnpm')
    expect(launch?.args).toEqual(['dsh', '--profile', 'personal-robot', '--port', String(port), ...(overlay ? ['--patch', patch] : [])])
    expect(launch?.cwd).toBe(f.repo)
    expect(launch?.env).toMatchObject({
      DSH_HOME: join(f.home, '.dsh'), DSH_MICRODUCK_SOURCE_ROOT: f.lab,
      DSH_MICRODUCK_PYTHON: f.python, PYTHONDONTWRITEBYTECODE: '1',
    })
    expect(f.calls().some(call => ['uv', 'git'].includes(call.command))).toBe(false)
    if (overlay) expect(readFileSync(patch, 'utf8')).toBe('# keep my overlay\n')
  })

  it('launches on default port 3082 with environment-selected source and Python', async (context) => {
    const f = fixture()
    try {
      const listener = await listen(3082)
      await listener.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') context.skip('Default port is owned by another process')
      throw error
    }
    const result = await f.run(['--no-build'], { DSH_MICRODUCK_SOURCE_ROOT: f.lab, DSH_MICRODUCK_PYTHON: f.python })
    expect(result.code).toBe(0)
    expect(f.calls().at(-1)?.args).toEqual(['dsh', '--profile', 'robot-lab', '--port', '3082'])
  })

  it('refuses an occupied loopback port before setup and keeps its owner listening', async () => {
    const f = fixture()
    const listener = await listen()
    const result = await f.run(['--port', String(listener.port)])
    expect(result.code).toBe(1)
    expect(result.output).toContain(`port ${listener.port} unavailable (EADDRINUSE)`)
    expect(f.calls()).toEqual([])
    expect(readdirSync(f.home)).toEqual([])
    expect(listener.server.listening).toBe(true)
    const second = await f.run(['--port', String(listener.port)])
    expect(second.code).toBe(1)
    expect(second.output).toContain('EADDRINUSE')
    expect(listener.server.listening).toBe(true)
  })
})
