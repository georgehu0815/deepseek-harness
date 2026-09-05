# Agent Note: Atomic Remote Namespace Publication

Status: implemented

English | [中文](2026-09-04-remote-namespace-atomic-publication.zh.md)

## Problem

A Cordis consumer waiting on `remote.<namespace>` can activate before `ctx.remote.$mount()` finishes. Constructing the namespace Service publishes its existence; awaiting its fiber before installing methods leaves an interval in which the dependency is satisfied but its methods are absent. The built supply-chain consumer reproduced this with `catalog is not a function`, even though the generated contribution contained that method. Rebuilding metadata or adding an RPC response fixture cannot repair a failure before transport dispatch.

## Decision

The [Client gateway](../../../../packages/api/gateway/README.md) prepares namespace fibers with an unavailable `Service.check` predicate. It installs the complete contribution's direct and scoped methods synchronously, then publishes new namespace readiness through Cordis notification. Extensions reuse existing namespace Services and install without yielding between methods; existing consumers do not restart.

The serialized mount queue remains the mutation owner. Rollback retires only the failed contribution's tokens and methods before awaiting namespace cleanup. A namespace unloads only after its last contributed method leaves; retained calls observe withdrawal and in-flight calls are aborted.

## Alternatives considered

**Reorder application plugins or delay consumers.** Loader order is not a readiness guarantee, and consumers already declare the correct namespace injection. Moving the wait into each consumer would duplicate gateway lifecycle knowledge.

**Publish after the first method.** Later methods and scoped variants would still race consumer activation. Yielding between extension methods would expose a partial batch on an already-live namespace.

**Rebuild artifacts or expand transport fixtures.** Both are necessary for their own failures but do not address premature Service availability.

## Consequences

No generated descriptor, public Remote API, or consumer injection changes. Client lifecycle tests cover waiting consumers, remounting, both contribution withdrawal orders, and successful or failed extension visibility across microtasks. The built Web regression uses the actual supply-chain contribution and gateway factory with only external RPC replies replaced. Robot's assembled snapshot remains the application-level check.

The [Remote method architecture](../architecture/2026-08-02-typert-remote-method-calls.md) and [generated-contract build ordering](../process/2026-08-08-api-remotes-generated-contract-build.md) remain authoritative and are not superseded; this decision supplies the namespace readiness guarantee within that design.
