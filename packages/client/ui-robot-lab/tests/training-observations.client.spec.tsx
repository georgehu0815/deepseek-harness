// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RobotRlxProgress, RobotRun } from '@deepseek-ai/dsh-robot-lab/types'
import { TrainingObservations } from '../src/client/TrainingObservations.tsx'
import { en, zh } from '../src/client/locales.ts'
import { fixtureRunningRun } from './fixtures.client.ts'

afterEach(cleanup)
const progress = { steps: 0, total: 100, elapsedSeconds: 0, reward: null }
const zero: RobotRlxProgress = { version: 1, completedRollouts: 0, optimizerSteps: 0, lastMeanLoss: null,
  collectionSeconds: 0, updateSeconds: 0, checkpointSeconds: null, exportSeconds: null }
function run(value: RobotRun['progress'], backend: RobotRun['spec']['backend'] = 'rlx'): RobotRun {
  const device = backend === 'cpu' ? 'cpu' : 'metal'
  return { ...structuredClone(fixtureRunningRun), spec: { ...fixtureRunningRun.spec, backend }, progress: value,
    provenance: { ...fixtureRunningRun.provenance, trainer: { ...fixtureRunningRun.provenance.trainer, backend, learnerDevice: device,
      helperSha256: backend === 'cpu' ? {} : { [backend === 'rlx' ? 'rlx_ppo.py' : 'mlx_ppo.py']: 'b'.repeat(64) } },
    environment: { ...fixtureRunningRun.provenance.environment, updateDevice: device } } }
}
const t = (key: string) => en[key as keyof typeof en] ?? key

describe('RLX training observations', () => {
  it.each(['cpu', 'mlx'] as const)('makes no RLX observation claims for the %s trainer', (backend) => {
    const view = render(<TrainingObservations run={run(progress, backend)} t={t} />)
    expect(view.container.textContent).toBe('')
  })

  it.each([null, progress])('preserves missing legacy observations instead of inventing zeros', (value) => {
    const view = render(<TrainingObservations run={run(value)} t={t} />)
    const summary = view.getByText(en['rlx.title'])
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(view.getByText(en['rlx.absent'])).toBeTruthy()
    expect(view.getAllByText(en['assessment.notRecorded'])).toHaveLength(7)
    expect(view.queryByText('0.000')).toBeNull()
  })

  it.each(['running', 'failed'] as const)('retains reported zeros without denying unreported work in a %s run', (state) => {
    const current = run({ ...progress, rlx: zero })
    current.state = state
    current.finishedAt = state === 'failed' ? '2026-09-06T02:00:00.000Z' : null
    current.error = state === 'failed' ? 'Synthetic failure during an unfinished update' : null
    const view = render(<TrainingObservations run={current} t={t} />)
    fireEvent.click(view.getByText(en['rlx.title']))
    expect([...view.container.querySelectorAll('dd')].map(node => node.textContent))
      .toEqual(['0', '0', 'Not recorded', '0.000', '0.000', 'Not recorded', 'Not recorded'])
    expect(view.getByText(/ongoing, incomplete or failed phase work is excluded/)).toBeTruthy()
    expect(view.getByText(/Zero reported values do not mean no computation occurred/)).toBeTruthy()
    expect(view.getByText('Optimizer steps in reported updates')).toBeTruthy()
    expect(view.getByText(en['rlx.scope'])).toBeTruthy()
    expect(view.queryByText(en['rlx.absent'])).toBeNull()
  })

  it('shows weighted total loss and mixed phase timing without deriving assessment or transfer costs', () => {
    const current = run({ steps: 64, total: 100, elapsedSeconds: 1.5, reward: 0,
      rlx: { ...zero, completedRollouts: 2, optimizerSteps: 4, lastMeanLoss: -0.125, collectionSeconds: 0.4, updateSeconds: 0.6 } })
    const before = structuredClone(current)
    const view = render(<TrainingObservations run={current} t={t} />)
    fireEvent.click(view.getByText(en['rlx.title']))
    expect([...view.container.querySelectorAll('dd')].map(node => node.textContent))
      .toEqual(['2', '4', '-0.1250', '0.400', '0.600', 'Not recorded', 'Not recorded'])
    expect(view.getByText(en['rlx.lossScope'])).toBeTruthy()
    expect(view.getByText(en['rlx.timingScope'])).toBeTruthy()
    expect(view.getByText(en['rlx.clockScope'])).toBeTruthy()
    expect(current).toEqual(before)
  })

  it.each([en, zh])('localizes completed operation times and preserves a recorded zero loss', (dictionary) => {
    const current = run({ ...progress, steps: 100, elapsedSeconds: 10,
      rlx: { ...zero, completedRollouts: 4, optimizerSteps: 8, lastMeanLoss: 0,
        collectionSeconds: 3.25, updateSeconds: 5.5, checkpointSeconds: 0.125, exportSeconds: 2.75 } })
    const view = render(<TrainingObservations run={current} t={key => dictionary[key as keyof typeof en]} />)
    fireEvent.click(view.getByText(dictionary['rlx.title']))
    expect([...view.container.querySelectorAll('dd')].map(node => node.textContent))
      .toEqual(['4', '8', '0.0000', '3.250', '5.500', '0.125', '2.750'])
    expect(view.getByText(dictionary['rlx.lossScope'])).toBeTruthy()
    expect(view.getByText(dictionary['rlx.timingScope'])).toBeTruthy()
    expect(view.getByText(dictionary['rlx.clockScope'])).toBeTruthy()
    expect(current.progress!.elapsedSeconds).toBe(10)
  })
})
