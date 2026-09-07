// @vitest-environment jsdom
/** Built Loader/slot composition with fixture Robot RPC; this test does not verify rendered pixels or physics. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'
import { robotRpcFixture } from './snapshots/robot-studio/rpc-fixture.ts'
import { danceV2Model } from '../../../packages/client/ui-robot-lab/tests/dance-v2-fixture.ts'

installAssembledBootEnv()
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('configures Cumbia v2 companions through the built multi-duck controls without robot operations', async () => {
  const network = vi.fn(() => { throw new Error('Multi-duck UI fixture must not use external transport') })
  vi.stubGlobal('fetch', network); vi.stubGlobal('WebSocket', network)
  vi.stubGlobal('innerWidth', 1920); vi.stubGlobal('__fxTiming', undefined)
  const fixture = robotRpcFixture({ sessionIds: ['fx-alpha'] })
  const respond: typeof fixture.respond = (sessionId, request) => {
    const result = fixture.respond(sessionId, request)
    if (result.operation === 'scene') result.scene = danceV2Model.scene
    if (result.operation === 'studio') {
      result.catalog.profiles = [danceV2Model.profile]; result.catalog.limits = danceV2Model.limits
    }
    return result
  }
  mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
  await waitFor(() => {
    const timing = (globalThis as typeof globalThis & {
      __fxTiming?: { setRobotLabResponder: (responder: typeof respond) => void }
    }).__fxTiming
    expect(timing).toBeDefined(); timing?.setRobotLabResponder(respond)
  })
  const tree = await screen.findByRole('tree', { name: 'Sessions' })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  fireEvent.click(await screen.findByRole('tab', { name: 'RL Training' }))
  const lab = await screen.findByRole('region', { name: 'Micro Duck control panel' })
  await within(lab).findByText('Local robot lab connected')
  fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
  const editor = within(await screen.findByRole('region', { name: 'Clip Gen' }))
  fireEvent.change(editor.getByRole('combobox', { name: 'Load a generated dance' }), { target: { value: 'cumbia_v2' } })
  const workspace = await screen.findByRole('region', { name: 'Simulation workspace' })
  const region = within(workspace).getByRole('region', { name: 'Ducks in this view' })
  const ducks = within(region)
  const before = fixture.requests.length
  const rows: string[] = []
  const record = (label: string) => {
    rows.push(`[${label}]`)
    for (const paragraph of region.querySelectorAll('p')) rows.push(`text=${paragraph.textContent}`)
    rows.push(`count=${region.querySelector('output')!.textContent}`)
    for (const select of region.querySelectorAll('select')) {
      rows.push(`${select.closest('label')!.firstChild!.textContent}=${select.selectedOptions[0]!.textContent}`)
    }
    for (const button of region.querySelectorAll('button')) rows.push(`button=${button.textContent}; disabled=${button.disabled}`)
  }
  record('Cumbia v2 / primary only')
  fireEvent.click(ducks.getByRole('button', { name: 'Add duck' }))
  fireEvent.click(ducks.getByRole('button', { name: 'Add duck' }))
  expect(ducks.getByRole<HTMLSelectElement>('combobox', { name: 'Duck 2 dance' }).value).toBe('follow')
  fireEvent.change(ducks.getByRole('combobox', { name: 'Duck 3 dance' }), { target: { value: 'salsa_v2' } })
  record('three ducks / independent Salsa v2')
  fireEvent.change(editor.getByRole('combobox', { name: 'Load a generated dance' }), { target: { value: 'bachata_v2' } })
  expect(ducks.getByRole<HTMLSelectElement>('combobox', { name: 'Duck 2 dance' }).value).toBe('follow')
  expect(ducks.getByRole<HTMLSelectElement>('combobox', { name: 'Duck 3 dance' }).value).toBe('salsa_v2')
  record('new primary / follower and independent choice retained')
  fireEvent.click(ducks.getByRole('button', { name: 'Remove Duck 2' }))
  fireEvent.change(ducks.getByRole('combobox', { name: 'Duck 3 dance' }), { target: { value: 'follow' } })
  record('remove and rejoin')
  expect(workspace.querySelectorAll('audio')).toHaveLength(1)
  expect(fixture.requests.slice(before)).toEqual([])
  expect(network).not.toHaveBeenCalled()
  rows.push('one-shared-audio=true; robot-operations-started=0')
  const target = join(process.cwd(), 'apps/web/tests/expected/clip-ducks.txt')
  const actual = rows.join('\n') + '\n'
  if (REFRESHING_GOLDEN) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, actual) }
  expect(actual).toBe(readFileSync(target, 'utf8'))
}, 60_000)
