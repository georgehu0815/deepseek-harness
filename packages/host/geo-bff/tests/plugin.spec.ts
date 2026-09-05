// Unit tests for the function plugin's apply(): it registers a `terra-bff`
// provider through ctx.effect + ctx.geo.registerProvider, disposing restores the
// previous provider (HMR safety), and it validates its resolved config loudly.
import { describe, expect, it, vi } from 'vitest'
import { apply, Config, name, inject, TerraGeoBffProvider } from '@deepseek-ai/dsh-host-geo-bff'
import type { GeoProvider } from '@deepseek-ai/dsh-geo'

/** A minimal ctx shaped to exactly what `apply` reads. */
function makeCtx(): {
  ctx: Parameters<typeof apply>[0]
  registered: GeoProvider[]
  disposed: number
  runEffects: () => void
} {
  const registered: GeoProvider[] = []
  let disposed = 0
  const effects: Array<() => (() => void) | undefined> = []
  const geo = {
    registerProvider(provider: GeoProvider): () => void {
      registered.push(provider)
      return () => { disposed += 1 }
    },
  }
  const ctx = {
    geo,
    effect(fn: () => (() => void) | undefined): void { effects.push(fn) },
  } as unknown as Parameters<typeof apply>[0]
  return {
    ctx,
    registered,
    get disposed() { return disposed },
    runEffects() {
      for (const fn of effects) {
        const dispose = fn()
        if (typeof dispose === 'function') dispose()
      }
    },
  }
}

/** A fully-resolved config as the loader would supply after Config defaults. */
function resolvedConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'http://127.0.0.1:4176',
    timeoutMs: 10_000,
    allowPrivateSources: true,
    maxResponseBytes: 10_000_000,
    ...overrides,
  }
}

describe('plugin metadata', () => {
  it('names the plugin and injects the geo seam', () => {
    expect(name).toBe('host-geo-bff')
    expect(inject).toEqual(['geo'])
  })

  it('Config applies loopback defaults', () => {
    const parsed = new Config({})
    expect(parsed.baseUrl).toBe('http://127.0.0.1:4176')
    expect(parsed.timeoutMs).toBe(10_000)
    expect(parsed.allowPrivateSources).toBe(true)
    expect(parsed.maxResponseBytes).toBe(10_000_000)
  })
})

describe('apply', () => {
  it('registers exactly one terra-bff provider through ctx.effect', () => {
    const { ctx, registered, runEffects } = makeCtx()
    const effect = vi.spyOn(ctx, 'effect')
    apply(ctx, resolvedConfig())
    expect(effect).toHaveBeenCalledTimes(1)
    runEffects()
    expect(registered).toHaveLength(1)
    expect(registered[0]).toBeInstanceOf(TerraGeoBffProvider)
    expect(registered[0]!.id).toBe('terra-bff')
  })

  it('disposing the effect restores the previous provider (HMR safety)', () => {
    const harness = makeCtx()
    apply(harness.ctx, resolvedConfig())
    harness.runEffects()
    expect(harness.registered).toHaveLength(1)
    expect(harness.disposed).toBe(1)
  })

  it('normalizes the baseUrl to its href form', () => {
    const { ctx, registered, runEffects } = makeCtx()
    apply(ctx, resolvedConfig({ baseUrl: 'http://terra.test' }))
    runEffects()
    // The provider stores the normalized href; a geocode builds URLs against it.
    expect(registered[0]!.id).toBe('terra-bff')
  })

  it('rejects a non-http(s) baseUrl', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ baseUrl: 'ftp://terra.test' })) })
      .toThrow(/must use http or https/)
  })

  it('rejects a malformed baseUrl', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ baseUrl: 'not a url' })) })
      .toThrow()
  })

  it('rejects a non-positive timeoutMs', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ timeoutMs: 0 })) })
      .toThrow(/timeoutMs must be a positive finite number/)
  })

  it('rejects a non-finite timeoutMs', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ timeoutMs: Number.POSITIVE_INFINITY })) })
      .toThrow(/timeoutMs must be a positive finite number/)
  })

  it('rejects a timeoutMs beyond the max Node timer delay', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ timeoutMs: 2_147_483_648 })) })
      .toThrow(/timeoutMs must be no greater than/)
  })

  it('rejects a non-positive maxResponseBytes', () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig({ maxResponseBytes: -1 })) })
      .toThrow(/maxResponseBytes must be a positive finite number/)
  })
})
