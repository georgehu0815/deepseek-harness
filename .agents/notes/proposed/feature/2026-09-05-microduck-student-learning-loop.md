# Agent Note: MicroDuck student learning loop

Status: proposed

English | [中文](2026-09-05-microduck-student-learning-loop.zh.md)

## Problem

Students can author a motion and launch training without stating what they expect, independently assessing the resulting policy, or preserving the evidence that informs their next attempt. Evaluation embedded in Perform obscures the distinction between training completion, meeting named simulation criteria, and authorization to operate physical hardware. A single transient report cannot support comparison across trials or recovery after a browser refresh.

The [native Studio proposal](2026-09-04-microduck-studio.md) retains its ownership of model-derived authoring, immutable physics artifacts, audio timing, renderer integration, and hardware exclusions. This proposal partially supersedes its four-phase navigation and combined simulation/evaluation duration selection. It does not replace the existing providers, shared player, or unresolved physical-runtime work; both records remain active and cross-linked.

The [implemented independent-group decision](../../implemented/feature/2026-09-05-microduck-independent-group-playback.md) adds per-duck saved-project setup and synchronized presentation of independent policies. Training remains manual through this learning loop; group playback does not supply a training queue, checkpoint continuation or joint-policy evaluation.

## Proposal

Deliver a complete simulation learning loop before physical world editing, new learning algorithms, or robot activation. Keep Micro Duck beside Supply Chain in the existing conversation column and Robot Studio in the shared visual column. Use English product copy and the existing Harness shell, assistant, session ownership, and configurable execution providers.

### Student workflow

The [implemented Train/Evaluate layout](../../implemented/simplification/2026-09-05-microduck-train-evaluate-columns.md) supersedes this proposal's five-page navigation, Next footer and center Perform controls: Train and Evaluate are full-width subtabs that retain their contents when hidden, with target setup collapsed inside Train. The broader learning and evidence requirements below remain active; the page names describe the proposed grouping, not current navigation.

The five main phases are Choose, Customize, Train, Evaluate, and Perform. Observe and Improve are evidence actions available from Evaluate and Perform rather than additional mandatory phases. A failed evaluation can lead directly to an improvement experiment without passing through Perform.

Choose offers the existing nine experimental targets and a learning brief: goal, prediction, planned change, and evidence to examine. Guidance starts with distinguishing targets from policies, small movements, short routines, and controlled comparisons. Walking, jumping, world randomization, demonstration learning, preference learning, and hardware execution are not advertised as available lessons without their actual adapters and tests.

Customize retains motion blocks, global tempo, master/relative size, original music, and numeric advanced editing. Students see their planned change beside the authored target. Appearance controls remain explicitly separate from physics. Saving motion does not train a controller or test dynamic feasibility.

Train shows the learning brief, exact saved target, supported CPU/MLX choice, budget, and an evaluation recipe chosen before the trial starts. Saving a trial freezes the brief, recipe, and project revision before training; starting it separately binds the admitted run. Completing training presents Evaluate this policy; it does not label the goal achieved. Advanced unlinked training remains available but is not retrospectively presented as a pre-registered student trial.

Evaluate owns policy/report selection, simulation assessment, report history, episode-level evidence, baseline comparison, and reflection. Assessment retains measurable upright/termination criteria and reports tracking error when available. [Explicit frozen choreography assessment](../../implemented/feature/2026-09-05-microduck-frozen-choreography-assessment.md) adds optional pre-training criteria and cycle/block evidence; calibrated general choreography qualification and robustness remain unassessed. Every displayed report must match its exact policy/export, not the latest draft or a different run. Evaluation horizons are independent of Perform's exploratory simulation duration.

Perform owns explicit recorded simulation and presentation. A failed or unassessed policy remains available for simulation inspection with its status visible. Hardware remains blocked. The player preserves target-versus-recording labels, music provenance, replay timing, and unavailable measurement labels.

### Workplace layout

The native center panel has a compact project heading, five-phase progress navigation, the current phase, and a primary next action. A learning/evidence section provides trial history, comparison, and reflection without adding a second permanent sidebar. Detailed settings remain progressively disclosed. The existing conversation composer remains visible; the panel opts into its owner's measured overlay layout and resets local scrolling on phase changes while preserving scroll through edits.

The right player identifies the source record and whether the student sees a kinematic target, exploratory simulation, or re-simulated evaluation episode. It never represents recorded poses as live hardware. Evaluation episode regeneration must be labeled as a new simulation using saved inputs, not as an original recorded video.

### Durable records and ownership

Extend the existing Robot Lab Service Definition, provider, typed Remote Consumer, and model tool rather than adding a parallel application server. Keep scientific execution in the existing Python engine. Add bounded, immutable, session-owned learning records through the host provider so learning metadata need not alter the Python runtime fingerprint or reinterpret existing project/run formats.

Saving a trial commits the learning brief, frozen evaluation recipe, training inputs, saved project identity/hash, and optional parent reflection without starting a run. Training that saved trial commits a separate immutable binding to the actual prepared run before its trainer starts or admission is published. One trial can admit only one run; ambiguous client failures require reloading its binding, not creating an automatic replacement. Process status is derived from the authoritative run rather than stored in a second lifecycle. Failed preparation or binding persistence must not start untracked learning work.

An append-only reflection binds the student's observation, interpretation, and proposed next change to a specific trial and exact completed evaluation report. Missing, foreign-session, mismatched-policy, or tampered references are rejected. A saved reflection can reopen an explicitly unsaved improvement draft from its parent's exact project and training inputs. Saving that reviewed draft creates the child trial with a reference to the committed reflection; no atomic reflection-and-child commit or durable unsaved draft is claimed. A mutable browser selection is not lineage. Starting the next trial creates a new run, not a checkpoint continuation.

The provider exposes existing evaluation history through validated bounded read operations. Incomplete evaluation admissions are not successful reports. Lists and durable parsers fail clearly for invalid data or configured size limits instead of fabricating empty or successful results. Artifact reads and writes use the configured filesystem and authorized session storage.

Changing lesson text or motion creates a new proposed experiment; it never modifies a prior trial, policy, report, or reflection. Browser refresh reloads committed records without replaying starts. Stores hold drafts and selection, the captured-session LabClient owns business snapshots and requests, and framework-provided hooks deliver them to components. No new direct service access or subscription code belongs in components.

### Comparison and replay

Comparison is descriptive evidence, not an automatic winner score. Show named criteria, episode count, requested horizon, seeds, termination counts, upright fraction, and available tracking errors. Only reports with matching assessment settings, observation semantics, frozen physics, and loaded source/runtime provenance can support a like-for-like assessment label. Distinct objectives, targets, budgets, learners, or seeds remain visible as experimental differences; multiple differences cannot be described as a controlled single-variable test.

Re-simulating an evaluation episode resolves the stored report, verifies the owned completed run's policy bytes and runtime compatibility, selects the recorded episode seed, and uses the requested report horizon with zero velocity command. The observed early-termination step count is not the requested horizon. Only run-owned exports support this operation: the unchanged Python loader cannot pin a shipped policy before execution against a supplied expected digest. The provider enforces these inputs; the UI cannot substitute current draft settings. Runtime incompatibility remains a blocker. An evaluation pass never overrides it.

### Safety and capability states

Use separate states for training completion, assessment outcome, missing tests, runtime compatibility, and hardware availability. Do not compute a universal Sim2Real readiness percentage. Keep hardware activation unavailable through UI, tool, and provider paths. A browser playback clock is never a physical controller clock.

The current runtime accepts semantic policy profiles with 61 observations and 14 actions; matching dimensions alone is insufficient. A full target-specific hardware contract, setup/calibration wizard, authenticated permissions, local watchdogs, supervised approval, and independent stopping remain prerequisites for a later hardware release. MLX remains a Metal learner with CPU physics; MPS, MJX, BC, DPO, and other algorithms remain unavailable until real providers exist.

### Implementation plan

1. Finalize shared trial, reflection, evaluation-history, and evaluation-episode request/result contracts with bounded validation and session-owned persistence. Preserve scientific runtime files where host-only orchestration suffices.
2. Add pre-registered trial admission, frozen-recipe evaluation, reflection persistence, and explicit report-based re-simulation. Cover failure-before-spawn, cancellation/disposal, reference integrity, read-only denial, and cross-session isolation.
3. Extend LabClient and the declared draft/view store. Implement the five phases, learning brief, assessment recipe, trial/report selection, comparison, and reflection-driven creation of an improvement draft. Preserve unrelated advanced authoring and player behavior.
4. Extend the real Loader and confined native assembled snapshots. Verify save/reload, two comparable trials, failed assessment, exact episode regeneration, parent-linked improvement, mismatched evidence rejection, and unavailable hardware. Update paired owning documentation and generated contracts.
5. Build matched host/client artifacts and verify the existing Robot GUI on port 3082, restarting only that approved GUI if required. Preserve the process listening on port 3081. Use real CPU/MLX execution as integration evidence, not a learned-skill claim.

### Later releases

Physical world revisions and supported randomization follow the simulation feedback loop. Curated datasets, classroom assignment/review, and more comprehensive task/held-out tests build on its records. Hardware-runtime investigation may proceed independently, but physical execution requires its own validated adapter and supervised acceptance. New learning algorithms follow validated dataset and export requirements rather than appearing as placeholder radio buttons.

## Alternatives considered

**Add more algorithms before the feedback loop.** A larger training menu does not help a student define success, interpret failure, or compare trials. Existing PPO providers are sufficient to build the learning workflow.

**Keep evaluation inside Perform.** This makes assessment look like an optional playback action and encourages treating training completion as readiness. A separate phase makes the evidence and its limitations explicit while retaining exploratory simulation.

**Use a single Sim2Real readiness percentage.** Unrelated tests and missing hardware evidence cannot honestly combine into a safety approval. Separate evidence and authorization states preserve their actual meanings.

**Store reflection only in browser state or attach it to whichever policy is selected later.** Refresh loses the learning record and selection drift can relabel evidence. Immutable server-owned references are required.

**Rewrite every project and run format to add learning text.** Learning metadata can be an independently owned record family, preserving existing scientific artifacts. A format change is justified only if the artifact's own semantics change; no compatibility shim or provenance rewriting is permitted.

**Show a re-simulation as the original evaluation recording.** The current engine stores episode results, not frame recordings. Saved-input re-simulation must identify itself as a new recording and remain subject to runtime compatibility checks.

## Acceptance criteria

- A student can state a goal and prediction, save a target, start a trial with frozen assessment criteria, and reach an independent Evaluate phase after training.
- Trial, report, and reflection history survive refresh in the same authorized session; another session cannot access them by copying identifiers.
- A failed assessment exposes exact episode evidence and allows a clearly labeled re-simulation without silently changing the policy, seed, horizon, or scientific runtime.
- A saved reflection can explicitly reopen an unsaved improvement draft. Saving and starting that reviewed draft preserves the parent and produces a new trial/run. Comparison shows actual differences and refuses an unsupported like-for-like conclusion.
- Target preview, simulation measurements, unassessed choreography/robustness, training throughput, and blocked hardware retain truthful labels.
- Focused source tests, real Loader execution, confined keyless assembled transcripts, and the rebuilt browser exercise the complete loop. No broad replay lane may leak into live model providers.

## Risks

Long historical lists and large artifacts require configured limits and complete-response bounds. Loading report history must not erase prior selected evidence or overwrite newer data after session disposal. Pre-registering criteria constrains student flexibility intentionally: an exploratory evaluation may use other criteria but must not masquerade as the trial's original assessment. Keeping physical worlds, hardware execution, new algorithms, and checkpoint continuation out of this release limits breadth in exchange for a verifiable learning loop.
