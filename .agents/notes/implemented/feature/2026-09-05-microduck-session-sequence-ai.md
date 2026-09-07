# Agent Note: Current-session AI sequences for MicroDuck Clip Gen

Status: implemented

English | [中文](2026-09-05-microduck-session-sequence-ai.zh.md)

## Problem

Natural-language choreography needs more freedom than the deterministic action recipes. A second model connection would bypass the current session's model selection and logged conversation. Applying the last assistant text or waiting for general agent idleness cannot identify a particular queued request; importing a late answer can also destroy newer user edits. A prompt alone cannot reproduce the exact keyframes a user previously generated, and raw lyrics do not provide a timed movement guide for reviewing those keys.

## Decision

[SequenceByAI](../../../../packages/client/ui-robot-lab/README.md#clip-gen) queues an ordinary user message to the captured current session through `SessionFace.prompt`. The message quotes the activity as data and records a canonical request UUID, installed model fingerprint, fourteen ordered joint names, limits and defaults, separate MJCF indices, optional matching hinge metadata and bounded output instructions. Joint-array channels are not MJCF joint ids. The current agent is instructed to load the [canonical choreography skill](../../../../packages/bundle/robot-lab/skills/microduck-choreography/SKILL.md), plan timed segments first, then author their matching keys. The repository skill entry is a symlink to that bundle-owned source; the [bundle](../../../../packages/bundle/robot-lab/README.md) owns working-directory-independent skill loading. Generation uses no second model provider, subagent or robot operation.

The `MICRODUCK_SEQUENCE_REQUEST_V2` request requires one final JSON envelope containing the request identity, a timed `guide` and the existing version-1 model-bound `sequence`. [The decoder](../../../../packages/client/ui-robot-lab/src/client/clip-sequence-agent.ts) owns its exact fields. An optional single whole JSON code fence is accepted; arbitrary prose extraction is not. Historical V1 request markers and guide-free envelopes remain recognizable for event projection, but new requests cannot import a guide-free answer. Guide segments have finite times, positive durations, exact contiguous coverage from zero through the clip duration and nonblank descriptions. The prompt requires the activity's language; the validator checks text presence, not language. Formatting yields `start–end s: description` lines with at most 2,000 UTF-16 code units, so accepted guides fit both the activity textarea and saved-guide prompt.

Reply validation checks the complete UTF-8 budget, exact fields, model fingerprint, joint order, exact requested BPM, finite targets, installed ranges and downstream reference limits. Zero and duration endpoints must use the installed `defaultPosition` joint arrays, including nonlooping clips; looping root-pitch endpoints also agree exactly. Invalid results do not silently clamp, retarget or fall back to deterministic recipes.

A plugin-owned event-backed Conversation target joins direct-user request nodes to turn-result nodes using engine-resolved turn placement. User messages have no turn field, so a mutable last-turn cursor is not an authority. Definitions ignore streamed chunks, reasoning, tool results and replacement surface copies; only a successfully ended turn can publish its final correlated answer. Interrupted, failed, ambiguous or malformed replies cannot become importable results. A same-turn ambiguity error identifies every affected request, so later waiters also fail rather than waiting indefinitely. Incremental builders process changed nodes instead of rescanning raw history. Blank-session eligibility remains explicit, and the target contributes no shell activity merely by existing.

The local request captures the session, request id, installed profile and draft edit epoch. A successful result is added to the root-scoped Dance guide library with the formatted generated guide and exact keys/BPM; the raw submitted activity or lyrics remain in the logged user request. An unchanged edit epoch permits replacing both the activity input and timeline. Intervening edits preserve both and retain a candidate with guide preview and explicit replacement. Applying either route clears manual verification without starting playback or export. The last received guide and downloadable AI result stay distinct from subsequent draft edits. Cancellation, leaving the entry and plugin disposal drop local completion ownership without cancelling the shared agent's turn.

Optional sequences extend the protected version-1 guide payload without discarding text-only guides. Reuse validates model compatibility and loads saved keys rather than asking the model to generate them again. Generated names are made unique; manual prompt-guide names still reject duplicates. Browser persistence reports pending, saved or blocked independently of whether a generated result is usable in memory. These records are not server projects, policies or measured evidence.

The task prompt permits the choreography skill load only and forbids other tools, subagents, training, simulation, evaluation and hardware calls. This instruction is not an executor-enforced sandbox: the current session retains its configured tools and authority. The browser offers an explicit download of the received bare clip object, not its AI envelope or model-bound wrapper; generation never automatically downloads or asks the agent to write a filesystem path. Authored references and successful JSON validation establish neither balance nor hardware safety.

## Alternatives considered

**A dedicated model request or generation server.** It would introduce independent credentials, provider selection and history ownership for a task the existing session can perform. Ordinary prompt admission retains one visible conversation and its established lifecycle.

**Scrape the latest answer or resolve on agent idle.** Queued messages, injected context, cancellation and multiple steps make these observations insufficient for request attribution. Explicit admission identity and successful turn settlement provide narrower evidence.

**Always replace the editor or save only the prompt.** Unconditional replacement loses intervening edits; regenerating from prose loses exact targets. Saving raw lyrics as the guide also omits the timed directions needed to review the motion. An edit epoch and a generated guide saved with its model-bound sequence preserve user work and reproducible authoring.

## Consequences

Generation and skill loading consume the current session's model tokens and can fail or wait behind queued work. Local waiting has no hard timeout. Users can cancel local waiting without interrupting unrelated session work. Saved guides are browser-local, subject to storage availability and the complete envelope budget; subsequent timeline edits and media require their own explicit saving. No new training, deployment or learned-skill claim follows from generation.

## Verification

The [protocol tests](../../../../packages/client/ui-robot-lab/tests/clip-sequence-agent.client.spec.ts) exercise installed mapping, quoted input, skill-load instructions, required contiguous guides, complete UTF-16/UTF-8 bounds, historical projection versus new-request import, and downstream clip constraints. The [Conversation tests](../../../../packages/client/ui-robot-lab/tests/clip-sequence-events.client.spec.ts) exercise committed-turn correlation, malformed and interrupted output, ambiguity, replay and session independence. The [assembled Clip Gen scenario](../../../../apps/web/tests/robot-studio.snapshot.ts) covers the button-to-current-agent prompt path, committed reply, exact timeline, cross-session guide reuse, manual-review reset and absence of training requests. Request-lifecycle and draft tests own stale-edit candidates and local cancellation. These deterministic tests do not establish live-model adherence or physical feasibility.

## Related decisions

The [native Clip Gen decision](2026-09-05-microduck-native-clip-gen.md) remains active for shared editor ownership, installed forward kinematics, manual review and MP4 recording; this decision partially supersedes its text-only guide behavior. The [Studio](../../proposed/feature/2026-09-04-microduck-studio.md) and [student learning-loop](../../proposed/feature/2026-09-05-microduck-student-learning-loop.md) proposals retain scientific runtime, learning and deferred hardware scope. None is fully superseded or archived.
