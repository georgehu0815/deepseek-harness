---
description: "Observable browser state stores with explicit snapshots, subscriptions, and lifecycle ownership."
kind: "package-library"
---
# @deepseek-ai/dsh-client-store

English | [中文](README.zh.md)

## Summary

React-free observable and snapshot-store primitives shared by Client controllers and renderer adapters. The package owns synchronous and animation-frame publication, Immer-backed updates, shallow equality, and optional browser persistence; React hook construction remains in `@deepseek-ai/dsh-client-ui-renderer`. Use it when Client state must publish stable snapshots without depending on React.

## Table of Contents

- [Browser recovery](#browser-recovery)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="browser-recovery"></a>
## Browser recovery

`defineStore` accepts an optional `persist` string for legacy whole-state JSON or a `ProtectedPersistence<T>` object for explicit partial-state recovery. Omitting it keeps the store in memory. The object supplies a payload selector, validating restore codec, version, complete-envelope UTF-8 byte limit, notice projection and `scopeDisposal: 'retain'`. The [Slots reference](../../../docs/subsystems/slots.md#protected-recovery) defines the types. Legacy keys and raw JSON formats are unchanged.

Protected restore is synchronous and checks envelope fields, version, exact scope and payload before merging with fresh initial state. Writes require browser Web Locks and compare the exact previously observed raw record under that lock. A missing lock service can still permit valid restoration, but never unprotected writes. Invalid data, unsupported versions, size/storage failures and revision conflicts block further automatic writes in that instance without replacing saved bytes or rolling back local edits. `PersistNotice` distinguishes pending, restored and saved states from these failures; it is not part of the selected payload.

`dispose()` synchronously cancels persistence effects and queued writes; local actions remain usable but cannot write storage. Protected `clearPersisted()` returns a promise, cancels pending saves and removes only the observed revision under the same lock. It rejects for blocked, disposed or already-cleared instances, or a changed stored revision. Legacy cleanup remains synchronous and nonfatal. Renderer teardown retains protected records; it does not establish permanent Session deletion. [The recovery decision](../../../.agents/notes/implemented/architecture/2026-09-05-protected-browser-authoring-recovery.md) owns this retention and conflict policy.

<a id="model-experience"></a>
## Model Experience

None, as this package provides browser-side state primitives and registers nothing model-facing.

#### KV Cache effect

None; the stores neither assemble nor send model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Persistence is browser-local plaintext** — JSON in `localStorage` is neither encrypted nor cross-device synchronization. Protected records are not automatically migrated or pruned, including after scope or application teardown. Without storage or Web Locks, edits remain local and protection reports why they cannot be saved.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package exports a library engine and creates no process-global state; each store instance is covered by its owning tests.
