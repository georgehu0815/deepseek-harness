---
description: "Use session-owned Robot Lab operations for authored projects, local training, recorded simulation and evaluation evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-robot-lab

English | [中文](README.zh.md)

## Summary

Use the Robot Lab Service Definition on `ctx.robotLab` for session-owned readiness, registered behaviors, geometry, policy discovery, training, recorded simulation, evaluation, and deployment preparation. One effect-scoped provider implements these operations. Browser remotes and tools call `execute(agent, request, signal)` with an authoritative agent; requests cannot choose filesystem roots or invoke provider-private operations.

## Table of Contents

- [Readiness and policy compatibility](#readiness-and-policy-compatibility)
- [Authored studio projects](#authored-studio-projects)
- [Learning trials and evidence](#learning-trials-and-evidence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="readiness-and-policy-compatibility"></a>

## Readiness and policy compatibility

The JSON records in `./types` distinguish standard MicroDuck observations from Lab body-phase observations. The current policy profiles have 61 observations and 14 actions; tensor width alone does not establish deployment compatibility. Provider absence returns disabled readiness capabilities; every other operation fails. Duplicate providers fail at registration, and disposing the registration removes it.

Training requests accept optional `backend: "cpu" | "mlx" | "rlx"`; the provider resolves omission to CPU and records the selected backend in new runs. `mlx` identifies DSH-owned PPO; `rlx` identifies PPO from the configured RLX checkout. Readiness includes per-backend availability, failure reasons, and separate learner and physics devices. An unavailable selection fails without substituting another learner. `RobotRun` represents only format-3 records and always includes `spec.backend`. Completed RLX runs also require `artifactSha256` to bind their checkpoint, metadata, full-precision normalizer, parity evidence and policy through an artifact manifest. Run discovery returns unsupported version diagnostics separately in `incompatibleRuns`; it never reconstructs old recipes.

Optional `RobotRun.progress.rlx` exposes RLX optimizer steps from fully completed updates and completed-phase timings without changing the training-only `elapsedSeconds` clock. Partial work in unfinished or failed phases is excluded; zero reported steps does not prove no optimizer work occurred. Missing statistics remain unknown, not zero; runs without them remain readable. These sampled observations may lag and do not authorize policy publication or establish learned skill. The [progress reference](../../../docs/subsystems/robot.md#run-progress) defines the measured intervals, loss meaning and excluded costs.

Policy metadata separates historical `verification` evidence from `runtimeCompatibility`, which reports whether the intact artifact can execute under the current provider runtime and gives a reason when it cannot. Listing an artifact does not authorize simulation or hardware deployment; execution rechecks compatibility.

<a id="authored-studio-projects"></a>

## Authored studio projects

`studio` returns installed model profiles, actual joint limits and root-body identity, and versioned experimental templates independently of optional learner availability. `save_project` validates a complete recipe and creates an immutable revision; `projects` lists revisions and `project` retrieves one by its opaque `projectRevisionId`. Recipes bind tempo, beat count, move size and a version-1 `RobotMusicRecipe`; audio synthesis stays in the browser. Templates expose `category`, authoring `difficulty`, registered `behaviorId`, and explicit `trainingWeights`; consumers merge those frozen overrides with the behavior's catalog reward defaults. The provider does not silently apply template weights to training requests. No catalog entry asserts that a trained policy can perform the motion. Project and clip display names preserve identical Unicode text exactly, including spaces and slashes (nonblank, at most 64 Unicode scalars, no controls or surrogates); they never select filesystem paths. Training `spec.name` retains its ASCII identifier rule.

An optional ordered `recipe.blocks` array supports reordering, removing and duplicating `{templateId,templateVersion:1,beats,moveSize}` entries before saving a new revision. The first block must match the top-level template; block beats sum to motion/music beats, and the global move size multiplies each block's size. Version-2 revisions freeze effective `blocks` and whole-motion `training: {behaviorId,weights}`. All-Stand motion resolves to `stand` with `{}` even with explicit blocks; any mixture or non-Stand motion resolves to `imitate` with `{travel: 0}`. Use that recommendation rather than the first block's behavior for a sequence; unsupported project versions are rejected.

`reference_preview` returns `kinematic-reference` MuJoCo poses for a saved revision, not a policy rollout or evidence of dynamic feasibility. `simulate` remains `recorded-simulation`. Reference frames provide known joint positions and root tilt; joint/root velocity, root speed, controller targets and actuator torque are null because they are not measured. Recorded simulation frames provide actual simulator state with explicit joint, actuator and identified-root units. Consumers must preserve these mode distinctions and must not interpret upright evaluation success as choreography certification.

A training request may bind `projectRevisionId` with `clip: null` to select its saved clip, or supply the identical clip. Admission resolves that immutable revision and stores `projectSnapshot` with the run recipe; callers cannot supply the snapshot. Training never looks up a mutable project or recompiles a template after admission. Ordinary training still accepts its explicit clip or null and resolves the backend independently.

<a id="learning-trials-and-evidence"></a>

## Learning trials and evidence

`save_trial` commits a `RobotTrialRecipe` before `train_trial` may start it. The recipe requires a saved project and `clip: null`, four learning-brief strings (`goal`, `prediction`, `plannedChange`, `evidence`), evaluation criteria, and an explicit nullable `parentReflectionId`. Evidence in the brief is a measurement plan, not a result. Each trial admits at most one run; `trials` derives status from its binding and authoritative run rather than storing a second lifecycle. Saving alone does not reserve training capacity.

`evaluate_trial` uses the frozen criteria and the trial's completed exported policy. `evaluations` returns validated completed reports and a separate `incompleteCount`, not successful placeholders for interrupted admissions. `save_reflection` binds observation, interpretation and next change to an actual report matching the same trial's frozen criteria, run and policy bytes; `reflections` reloads committed records. An improvement draft is unsaved until a new `save_trial` commits its `parentReflectionId`; it never edits the parent or resumes its checkpoint.

A trial may explicitly supply `evaluation.dance` with version 1 or 2 and every threshold; there are no choreography defaults. The plan and criteria versions must match. Explicit version-1 admission remains supported, including already frozen trials that have not started; neither admission nor history reads automatically upgrade them. Before its trainer starts, the provider resolves a policy-independent `RobotDancePlan` and binds the complete decoded plan to that trial. Direct `evaluate` with dance criteria requires the same pre-training plan on the owned run and identical assessment inputs; it cannot add a retrospective plan. Reports preserve the balance-only `passed` flag and independently report `danceStatus: 'passed' | 'failed' | 'incomplete'`, control-rate cycle/block measurements and frozen reference identity. Missing dance criteria means choreography was not assessed, not that it passed. These experimental criteria are not general skill or hardware qualification.

`replay_evaluation` selects a saved episode by zero-based index and returns `mode: 'new-resimulation'`: a new simulation using the report's seed and requested horizon, not original evaluation frames. Only session-owned run policies support it; execution rechecks policy bytes and runtime compatibility. The [record reference](../../../docs/subsystems/robot.md) defines the shared types and evidence semantics.

<a id="model-experience"></a>

## Model Experience

### Operation results

#### What the model sees

The `robot_lab` tool consumer summarizes `RobotLabResult` records from this service. The service does not construct model messages; without a provider, readiness reports disabled capabilities and other operations fail.

#### Token effect

Only the consumer's logged tool results add context; this service injects no messages or schemas.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The local provider does not support physical deployment, paid GPU training, uploaded checkpoints, or automatic training continuation after restart.
- Simulation responses contain bounded recorded rollouts, not continuous real-time telemetry. Consumers must preserve the `recorded-simulation` label.
- Run formats and observation profiles are explicit; no compatibility promise covers earlier experimental artifacts.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published because this service owns provider registration and request dispatch, not an independent experiment journal or artifact store.

</details>
