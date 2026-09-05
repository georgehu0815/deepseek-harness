# Agent Note: Independent MicroDuck policies with synchronized group playback

Status: implemented

English | [中文](2026-09-05-microduck-independent-group-playback.zh.md)

## Problem

A multi-duck stage needs independently selected and trained policies without implying that several rendered robots share a physics environment. Reusing one policy for every displayed duck cannot express different learned routines; sharing a visual start does not establish coordinated control or collision avoidance.

## Decision

The [Robot Studio client](../../../../packages/client/ui-robot-lab/README.md#multiple-ducks) owns a transient session roster with stable member identities, editable names, per-duck policy and saved-project selections, and visual formation offsets. Add and duplicate enforce the positive-integer `maxGroupMembers` configuration, default 8; remove retains one member. Duplicating a member copies selections, not weights or a run. The declared store retains this view state across Studio tab closure, but not browser refresh. Saved projects and server-owned training artifacts are independent of that transient roster.

**Set up individual training** loads the chosen saved project into Micro Duck's Train page and marks the duck being edited. It does not admit training or create a queue. Users manually run the existing per-duck trial flow and assign each exported policy afterward. Parallel environments remain workers for one policy; policy selection is neither fine-tuning nor checkpoint continuation.

`LabClient` captures all members before notifications or requests, validates available policy selections, and sequentially requests independent zero-command simulations with a shared reset seed and requested horizon. Each response must match its captured policy identity/hash and provide a positive finite recorded duration. All tracks publish atomically after success; failure or disposal cannot replace the loaded group with partial results. Simulation requests remain existing single-policy operations, not a new joint-world backend operation.

One `PlaybackTransport` starts every recorded track at the same logical time and stops at the shortest endpoint. The first duck's matching run supplies its frozen project soundtrack when present; other policies are not retimed to its BPM. Renderer offsets arrange independent trajectories without altering measured physics. The recorded roster freezes names, assignments and positions; editing the draft roster does not relabel or move an existing recording. A new successful recording applies those edits.

## Alternatives considered

**Joint multi-robot physics and policy training.** This models interactions but requires a shared environment, collision semantics, observations, rewards and evaluation. The selected scope is independent per-duck policies with synchronized playback; a common stage must not imply those unimplemented interactions.

**Render copies of one selected policy.** This gives several visual ducks but cannot assign distinct trained routines or training projects. Each member instead selects its own existing policy, even when several deliberately select the same one.

**Automatically queue training or warm-start the selected policy.** A roster selection contains neither a complete admitted trial nor checkpoint provenance. Explicit existing trial admission preserves manual control and exact artifacts without inventing group learning or continuation semantics.

## Consequences

The stage can compare or present different policies on one clock while keeping existing policy compatibility checks and training ownership. Sequential simulation limits concurrent execution but increases preparation time with roster size. Atomic publication avoids mixed old/new tracks; the shortest duration prevents frozen or repeated short tracks from implying sustained control. A soundtrack synchronizes presentation, not learned coordination. Inter-duck collisions and joint-policy evaluation are not modeled, and hardware remains unavailable.

**Save group file** and **Load group file** provide explicit user-managed recovery across refresh, not automatic session persistence. Version-1 JSON carries `version`, `members`, `formation` and `spacing`; members carry their identities, names, policy/project references and stage `x`/`z` positions. No ONNX bytes, project contents or recordings are embedded. Import validates the 1 MiB limit, configured member ceiling and fields before replacing the roster draft; invalid input leaves it unchanged. The prior recording remains loaded until re-recording succeeds.

References are portable identifiers, not transferable authorization or artifacts. Missing policies or project revisions stay visible as unavailable rather than being silently reassigned. Recording requires available policies, and individual training setup requires an available saved revision. Load into the originating session to resolve its session-owned artifacts, or explicitly choose replacements. Unexported roster edits remain transient; preserving the JSON does not preserve the referenced experiment directory.

## Verification

[Group recording regressions](../../../../packages/client/ui-robot-lab/tests/group-playback.client.spec.ts) cover captured selections, sequential requests, atomic publication, shortest duration, invalid policies, response identity, failure and disposal. [Renderer tests](../../../../packages/client/ui-robot-lab/tests/viewer-geometry.client.spec.tsx) cover independent tracks on one clock and visual offsets. These source checks do not establish learned coordination, physical collision behavior or hardware safety; assembled-browser evidence remains necessary for the complete GUI workflow.

## Related decisions

The [native Studio proposal](../../proposed/feature/2026-09-04-microduck-studio.md) remains active for scientific provenance, audio timing and unresolved authoring/hardware work. The [student learning-loop proposal](../../proposed/feature/2026-09-05-microduck-student-learning-loop.md) retains trial, evaluation and reflection ownership. This note adds roster management, group presentation and per-duck training setup only; neither broader proposal is fully superseded or eligible for archival.
