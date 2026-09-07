# Agent Note: Conversation-owned View commands

Status: implemented

English | [中文](2026-09-05-conversation-owned-view-commands.zh.md)

## Problem

Opening a Session and activating target data do not select a Conversation View. Studio entry needs to reach its controls even before the Session body mounts. Writing a second store instance, retaining a callback after unmount or replaying a late create result can select the wrong View or Session.

## Decision

[UiConversation](../../../../packages/client/ui-conversation/README.md) owns `selectView(sessionId, target)`. It accepts only the current known Session binding and an installed View eligible for that Session. A required synchronous constructor factory receives the service after registry initialization and supplies its owner command; no additional client value export or generic Slot capability is introduced.

The actual Conversation body binds its declared View-store action through an owner layout-lifecycle callback. A command reaches that mounted action immediately or waits once for the first committed mount. Only the latest pending command is retained; it is not a mirrored selection value. Existing tab and focus actions still own ordinary user navigation.

Delivery rechecks Session identity and binding generation, installed target and blank-session eligibility. A newer owner gesture, Session/binding change, target withdrawal or lost capability, body unmount, scope disposal and HMR cancel undelivered commands. Identity-safe cleanup cannot remove a newer writer. No delayed timer, DOM click or target-data activation substitutes for committing UI selection.

[Robot Studio](../../../../packages/client/ui-robot-lab/README.md) uses the command after an explicit Start or Open succeeds. Canceling late navigation does not cancel an already admitted Session creation. Selection never saves a project, starts training, invokes a model or creates Conversation activity.

## Alternatives considered

**Require a manual tab selection after every Studio entry.** This leaves an explicit entry action short of its requested destination. The domain-owned command selects the existing View without creating feature-specific shell branches.

**Call `binding.activate` or instantiate the View store independently.** Activation controls target assembly, not selected UI state; another store instance is not the renderer's current declared instance. Neither operation delivers the user's navigation request.

**Export implementation values or add a framework-wide navigation prop.** Other domains need a JSON-compatible command, not ownership of Conversation internals. The injected service and plain owner callback preserve existing module and props rules.

## Consequences

The [blank-session presentation decision](2026-09-05-blank-session-presentation-views.md) remains authoritative for independent presentation-only and blank-session capabilities. This decision replaces only its manual-entry requirement and absence of an imperative selection command. Chat fallback, View eligibility and event-backed activation retain their existing owners. Source-level delivery and cancellation do not establish authenticated built-GUI verification or human acceptance of the complete Studio workflow.
