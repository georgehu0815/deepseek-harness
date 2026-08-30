/**
 * Client-namespace projection of the geo view-report domain: a pure re-export of
 * the package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — the `geoView` projection key and the
 * `GeoView` report types the Earth reporter writes and the panel reads.
 * @module @deepseek-ai/dsh-geo-view/client
 */

export type * from './types.ts'
