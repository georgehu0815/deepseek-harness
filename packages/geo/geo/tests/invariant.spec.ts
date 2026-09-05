// Registers the package-owned invariant companion through the real invariant
// registry and asserts the manifest name plus a working disposer. The companion
// installs an explained empty check (this seam holds one replaceable provider
// handle and owns no durable event stream), so the test confirms registration
// and teardown rather than a runtime violation.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as GeoInvariant from '../src/invariant.ts'

describe('geo invariant companion', () => {
  it('exposes the companion plugin metadata', () => {
    expect(GeoInvariant.name).toBe('geo-invariant')
    expect(GeoInvariant.inject).toEqual(['invariants'])
  })

  it('registers and disposes under the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const disposer = await GeoInvariant.apply(ctx)
    expect(typeof disposer).toBe('function')
    disposer()
  })

  it('loads and unloads as a plugin under the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(GeoInvariant)
    expect(fork).toBeDefined()
    await fork.dispose()
  })
})
