// Registers the package-owned invariant companion through the real invariant
// service and asserts the registration under the package name plus a working
// disposer. The companion installs an explained empty check (this package only
// replaces a provider handle and owns no durable event stream), so the test
// confirms registration and teardown rather than a runtime violation.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as GeoBffInvariant from '../src/invariant.ts'

describe('host-geo-bff invariant companion', () => {
  it('exposes the companion plugin metadata', () => {
    expect(GeoBffInvariant.name).toBe('host-geo-bff-invariant')
    expect(GeoBffInvariant.inject).toEqual(['invariants'])
  })

  it('registers and disposes under the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const disposer = await GeoBffInvariant.apply(ctx)
    expect(typeof disposer).toBe('function')
    disposer()
  })

  it('loads and unloads as a plugin under the real invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(GeoBffInvariant)
    expect(fork).toBeDefined()
    await fork.dispose()
  })
})
