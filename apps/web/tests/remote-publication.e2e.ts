// The Web lane requires built artifacts. Exercise the shipped gateway factory
// against a generated business contribution; only its external RPC is replaced.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as cordis from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the Context.remote declaration merge from the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { expect, it, vi } from 'vitest'

type GatewayPlugin = { inject: string[]; apply: (ctx: Context) => void }
type GatewayBundle = { factory: (require: (id: string) => unknown) => GatewayPlugin }

it('makes every generated supply-chain method callable inside an already-waiting consumer', async () => {
  const generated = await import(pathToFileURL(join(process.cwd(), 'packages/supply-chain/supply-chain/lib/typert.remote-client.js')).href) as { default: TypertRemoteContribution }
  let gateway: GatewayPlugin | undefined
  vi.stubGlobal('window', { __ModuleLoader__: { load(bundle: GatewayBundle) {
    gateway = bundle.factory((id) => {
      if (id !== '@deepseek-ai/cordis') throw new Error(`unexpected gateway factory dependency: ${id}`)
      return cordis
    })
  } } })
  const ctx = new cordis.Context()
  try {
    ;(0, eval)(readFileSync(join(process.cwd(), 'packages/api/gateway/lib/client.js'), 'utf8'))
    if (gateway === undefined) throw new Error('built gateway did not register its factory')
    await ctx.plugin(TypertRegistry)
    const reply = { ok: false as const, error: { code: 'internal' as const, message: 'External transport unavailable', details: {} } }
    const calls: string[] = []
    const connection = {
      rpc: { call: async (_channel: string, endpoint: string) => {
        calls.push(endpoint)
        return reply
      } },
      registerGenerationSource: () => () => {},
      start: () => ({ stop: () => {} }),
    } satisfies Pick<ConnectionHandle, 'rpc' | 'registerGenerationSource' | 'start'>
    // This direct-RPC test replaces only the Connection members read by Gateway.
    ctx.provide('connection', connection as unknown as ConnectionHandle)
    await ctx.plugin(gateway)
    const results: RemoteResult<unknown>[] = []
    const consumer = ctx.plugin({
      inject: ['remote', 'remote.supplyChain'],
      async apply(scope: Context) {
        const methods = scope.get('remote.supplyChain') as unknown as Record<string, (...args: unknown[]) => Promise<RemoteResult<unknown>>>
        const pending = [methods.catalog!(), methods.run!('fixture-run'), methods.simulate!({ overrides: {} })]
        results.push(...await Promise.all(pending))
      },
    })
    const dispose = await ctx.remote.$mount(generated.default)
    await consumer
    expect(calls).toEqual(['supplyChain/catalog', 'supplyChain/run', 'supplyChain/simulate'])
    expect(results).toMatchObject([reply, reply, reply])
    await dispose()
    expect(ctx.get('remote.supplyChain')).toBeUndefined()
    await consumer.dispose()
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  }
})
