/**
 * Client-namespace projection of the geo command domain: a pure re-export of
 * the package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — the `geoCommand` projection key and the
 * command types the Earth bridge reads.
 * @module @deepseek-ai/dsh-geo-command/client
 */

export type * from './types.ts'
