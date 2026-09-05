import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolGeoQueryInvariant from '../src/invariant.ts'

describe('tool-geo-query invariant companion', () => {
  it('exposes companion metadata', () => {
    expect(ToolGeoQueryInvariant.name).toBe('tool-geo-query-invariant')
    expect(ToolGeoQueryInvariant.inject).toEqual(['invariants'])
  })

  it('registers and disposes through the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const dispose = await ToolGeoQueryInvariant.apply(ctx)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('loads and unloads as a plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(ToolGeoQueryInvariant)
    await fiber.dispose()
  })
})
