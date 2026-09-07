# Agent Note: Protected browser authoring recovery

Status: implemented

English | [中文](2026-09-05-protected-browser-authoring-recovery.zh.md)

## Problem

A browser authoring draft is neither disposable viewing preference nor a committed experiment. Whole-state persistence can retain server caches and false completion markers; last-writer-wins storage can destroy another editor's work. Session-context disposal and HMR also occur without permanent Session deletion, so tying saved-draft deletion to those lifetimes loses recoverable inputs.

## Decision

[Client store](../../../../packages/client/store/README.md#browser-recovery) owns opt-in protected partial-state persistence. An explicit codec selects editable JSON and validates restoration into fresh initial state. A strict versioned, scope-addressed envelope is bounded as complete UTF-8 bytes, including metadata. Legacy string keys and raw whole-state formats remain unchanged.

Restoration is synchronous. Writes require an exclusive Web Lock and an exact comparison with the raw record that this instance observed. Missing locks do not authorize fallback writes. A valid record may still restore without enabling storage writes; local editing remains available. Invalid data, unsupported versions, size/storage failures and conflicting revisions block persistence while retaining both stored bytes and local edits. Notices report persistence outcomes separately from editing success.

The renderer reference-counts store holders and disposes persistence effects when the last holder or Session scope leaves. Protected records survive scope and HMR teardown; unseen protected stores are not instantiated merely for cleanup. Explicit protected deletion cancels pending saves and requires the same lock and observed revision. Closed or blocked instances cannot delete the saved winner.

[Micro Duck](../../../../packages/client/ui-robot-lab/README.md) persists only target recipe, brief, assessment, training inputs and a parent-reflection hint. Recovery marks the target dirty and does not save records, train, evaluate or start playback. Reflection notes, rosters, selections, server caches, reports and frames remain excluded. Parent references are checked against currently loaded history before preparing an improvement trial and remain subject to authoritative Host validation. Explicit draft files are bounded and restricted to their owning Session.

## Alternatives considered

**Persist the whole editor or treat recovery as a saved trial.** This confuses user inputs with authoritative records and revives irrelevant playback or selection state. The domain's explicit selector keeps evidence and operations with their existing owners.

**Write without Web Locks or compare only a revision field.** A read/check/write sequence without serialization races with another cooperating editor. Exact raw-record comparison also notices changes outside the revision field. There is no unsafe fallback or force-write action.

**Delete on context disposal.** Contexts leave during reload, HMR and scope transitions. Those events are insufficient evidence of permanent user-authorized deletion. Explicit retention avoids converting lifecycle cleanup into data loss.

**Automatically merge or overwrite a conflicting draft.** The engine cannot choose which authored inputs the user intends. Export current edits, reload to inspect the saved winner, then explicitly import into that same Session instead; failed or oversized exports remain visible failures.

## Consequences

This is plaintext browser-local recovery, not encryption, cloud synchronization, committed evidence or a durable backup guarantee. Pending saves can be lost on teardown. Retained records are not automatically migrated or pruned, and browser site-data removal can erase them. A new explicit deletion or retention policy needs its own authority rather than reusing context disposal.

The [Slot composition decision](2026-07-22-slot-type-chain-implementation.md) remains active for declared factories, props and renderer-owned instances; protected retention refines the lifetime of saved bytes, not component mutation authority. The [student learning-loop proposal](../../proposed/feature/2026-09-05-microduck-student-learning-loop.md) retains its broader beginner and scientific requirements. Browser recovery does not establish full workflow completion, real-browser verification or human acceptance.
