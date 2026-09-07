# Agent Note: Opt-in blank-session Conversation Views

Status: implemented

English | [中文](2026-09-05-blank-session-presentation-views.zh.md)

## Problem

A session-owned workspace can expose useful controls before any chat turn exists. Creating a Session is insufficient when the Conversation shell hides its navigation and body until activity appears. Requiring a message to reach those controls couples presentation to an unrelated model operation; manufacturing activity would misrepresent the Session's evidence.

## Decision

The [Conversation view registry](../../../../docs/subsystems/conversation.md#blank-session-presentation) owns two independent declarations. `presentationOnly: true` identifies a View without an event builder, snapshot or activity contribution. Optional `supportsBlankSession: true` permits controls before Conversation activity exists and applies equally to event-backed and presentation-only Views. Omission preserves activity-dependent eligibility.

The shell joins registered Slot entries and View capabilities by target id. Blank-session navigation contains Chat and explicitly opted-in Views only; Chat remains the default and has no blank View body. A real blank Session with an available non-Chat opt-in uses compact workspace navigation, while selecting that View renders its controls. Registry changes and disposal update the same observable roster. The assembler ignores presentation-only definitions instead of creating empty builders or invented activity. Session lifecycle, event history and Slot registration semantics remain unchanged.

[Micro Duck](../../../../packages/client/ui-robot-lab/README.md) registers a presentation-only blank-session View. Studio creates or opens a Session through the existing Session Controller, then selects Micro Duck through [Conversation-owned View commands](2026-09-05-conversation-owned-view-commands.md). That decision owns imperative selection and mount-safe delivery; eligibility remains here. Neither capability registration nor Session creation saves a project, starts training or invokes a model.

## Alternatives considered

**Require chat or synthesize activity.** Both make access depend on evidence unrelated to the workspace. A fabricated event or active target would also distort Session and Conversation state.

**Register a dummy builder for presentation controls.** Controls that read their own session-owned service do not need event aggregation. The explicit union preserves builder obligations for actual event-backed Views without pretending another snapshot exists.

**Add feature-specific shell branches or general Slot options.** Eligibility belongs to Conversation navigation, not the generic renderer or Slot registry. A target-neutral capability gives other Views the same opt-in without naming Micro Duck in the shell.

## Consequences

Feature owners must register both their View capability and their component with matching target ids. Blank-session support grants visibility, not authorization or permission to perform side effects. Views without opt-in remain unavailable before activity; a missing Session still follows the ordinary empty-composer path. Human review and authenticated built-GUI verification remain separate from source-level registration and tests.

This decision partially supersedes the blanket blank-View omission in [Conversation assembly](2026-08-09-client-conversation-node-assembly.md), while preserving its event-backed activation and replay rationale. The [Client ownership decision](2026-08-20-client-session-conversation-ownership.md) remains authoritative for Controller, adapter and renderer responsibilities. The broader [Studio proposal](../../proposed/feature/2026-09-04-microduck-studio.md) remains partial; blank-session access does not complete its beginner-learning, choreography or hardware requirements.
