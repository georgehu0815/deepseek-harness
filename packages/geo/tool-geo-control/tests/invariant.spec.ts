import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolGeoControlInvariant from '../src/invariant.ts'

describe('tool-geo-control invariant companion', () => {
  it('exposes companion metadata', () => {
    expect(ToolGeoControlInvariant.name).toBe('tool-geo-control-invariant')
    expect(ToolGeoControlInvariant.inject).toEqual(['invariants'])
  })

  it('registers and disposes through the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const dispose = await ToolGeoControlInvariant.apply(ctx)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('loads and unloads as a plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(ToolGeoControlInvariant)
    await fiber.dispose()
  })
})
