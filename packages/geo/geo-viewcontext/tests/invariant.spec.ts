import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as GeoViewContextInvariant from '../src/invariant.ts'

describe('geo-viewcontext invariant companion', () => {
  it('exposes companion metadata', () => {
    expect(GeoViewContextInvariant.name).toBe('geo-viewcontext-invariant')
    expect(GeoViewContextInvariant.inject).toEqual(['invariants'])
  })

  it('registers and disposes through the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const dispose = await GeoViewContextInvariant.apply(ctx)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('loads and unloads as a plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(GeoViewContextInvariant)
    await fiber.dispose()
  })
})
