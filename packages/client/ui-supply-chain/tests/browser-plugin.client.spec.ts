// @vitest-environment jsdom
/** Browser plugin loading against the real Cordis service trace and slot registry. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SimulationRun } from '@deepseek-ai/dsh-supply-chain/types'
import { SupplyChainPanel } from '../src/client/SupplyChainPanel.tsx'
import type { SupplyChainPanelInject } from '../src/client/SupplyChainPanel.tsx'
import { apply, inject } from '../src/client/index.ts'

class RemoteService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remote')
  }
}

function declareConversationView(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  new RemoteService(ctx)
  const slots = ctx.get('slots') as SlotRegistry
  declareConversationView(slots)
  const catalog = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      runIds: [],
      latestRunId: null,
      presets: [
        { name: 'baseline', config: { days: 60, items: 1 } },
        { name: 'disruption', config: { days: 60, items: 1 } },
      ],
    },
  })
  const run = { id: 'run-1' } as SimulationRun
  const simulate = vi.fn().mockResolvedValue({ ok: true, value: run })
  const setOverlay = vi.fn()
  const clearOverlay = vi.fn()
  const flyTo = vi.fn()
  ctx.provide('earthOverlays', { setOverlay, clearOverlay, flyTo })
  return { ctx, slots, catalog, simulate, run }
}

describe('ui-supply-chain browser plugin', () => {
  it('declares the generated Remote namespace it reads', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.supplyChain', 'earthOverlays'])
  })

  it('waits for the supplyChain Remote, then applies and unregisters cleanly', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await Promise.resolve()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)

    b.ctx.provide('remote.supplyChain', { catalog: b.catalog, simulate: b.simulate })
    await fiber.await()
    expect(b.catalog).toHaveBeenCalledOnce()

    const entry = b.slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(SupplyChainPanel)
    expect(entry.options).toMatchObject({ id: 'supply-chain', order: 30 })
    await vi.waitFor(() => {
      const injected = (entry.inject as unknown as () => SupplyChainPanelInject)()
      expect(injected.presets.map(each => each.name)).toEqual(['baseline', 'disruption'])
    })

    const injected = (entry.inject as unknown as () => SupplyChainPanelInject)()
    // The run arrives through the replay source rather than the call's result:
    // playback is owned by the plugin body so it survives the tab unmounting.
    injected.runSimulation({ preset: 'disruption', days: 45 })
    expect(b.simulate).toHaveBeenCalledWith({ preset: 'disruption', overrides: { days: 45 } })
    await vi.waitFor(() => {
      expect(injected.hooks.replay.getSnapshot().run).toBe(b.run)
    })
    expect(injected.hooks.replay.getSnapshot().day).toBe(0)

    await fiber.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
