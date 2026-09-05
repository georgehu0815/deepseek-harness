/**
 * Pure types for the Terra BFF geo provider: constructor options and the raw
 * Terra response fields this provider reads. No runtime code — the provider and
 * plugin entry live in `./provider.ts` and `./index.ts`.
 * @module @deepseek-ai/dsh-host-geo-bff/types
 */

import type { TargetResolver } from './targetPolicy.ts'

/** Options for {@link TerraGeoBffProvider}. */
export interface TerraGeoBffProviderOptions {
  /** Terra BFF origin (e.g. `http://127.0.0.1:4176`). */
  readonly baseUrl: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
  /**
   * Whether the SSRF guard permits private/loopback targets. The default Terra
   * origin is loopback, so this is true by default; a public deployment sets it
   * false.
   */
  readonly allowPrivateSources: boolean
  /** Maximum bytes read from any response body before aborting. */
  readonly maxResponseBytes: number
  /** Injectable `fetch`; defaults to the global `fetch` so tests never hit the network. */
  readonly fetchImpl?: typeof fetch
  /** Injectable DNS resolver forwarded to the SSRF guard; defaults to Node's `dns.lookup`. */
  readonly resolver?: TargetResolver
}
