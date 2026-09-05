/**
 * Terra BFF provider plugin for the geo capability.
 * @module @deepseek-ai/dsh-host-geo-bff
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-geo'
import { TerraGeoBffProvider } from './provider.ts'

export { TerraGeoBffProvider } from './provider.ts'
export {
  TargetPolicyError,
  validateConnectedAddress,
  validateTarget,
} from './targetPolicy.ts'
export type {
  ResolvedAddress,
  TargetPolicyErrorCode,
  TargetPolicyOptions,
  TargetResolver,
  ValidatedTarget,
} from './targetPolicy.ts'
export type { TerraGeoBffProviderOptions } from './types.ts'

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'host-geo-bff'

/** The geo seam this provider replaces. */
export const inject = ['geo']

/** Terra BFF origin and request limits. */
export interface Config {
  /** Terra BFF origin. */
  baseUrl?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Whether private and loopback targets are permitted. */
  allowPrivateSources?: boolean
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('http://127.0.0.1:4176'),
  timeoutMs: z.number().default(10_000),
  allowPrivateSources: z.boolean().default(true),
  maxResponseBytes: z.number().default(10_000_000),
})

type ResolvedConfig = Required<Config>

/** Require a positive finite request limit. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`host-geo-bff: ${name} must be a positive finite number`)
  }
}

/** Register the Terra provider as the active geo provider. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const url = new URL(resolved.baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('host-geo-bff: baseUrl must use http or https')
  }
  assertPositiveFinite('timeoutMs', resolved.timeoutMs)
  if (resolved.timeoutMs > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`host-geo-bff: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
  assertPositiveFinite('maxResponseBytes', resolved.maxResponseBytes)

  const provider = new TerraGeoBffProvider({
    baseUrl: url.href,
    timeoutMs: resolved.timeoutMs,
    allowPrivateSources: resolved.allowPrivateSources,
    maxResponseBytes: resolved.maxResponseBytes,
  })
  ctx.effect(() => ctx.geo.registerProvider(provider), 'host-geo-bff: provider registration')
}
