# @deepseek-ai/dsh-robot-lab

English | [中文](README.zh.md)

Robot Lab Service Definition on `ctx.robotLab`. One effect-scoped provider implements session-owned readiness, registered behaviors, geometry, policy discovery, training, recorded simulation, evaluation, and deployment preparation. Browser remotes and tools call `execute(agent, request, signal)` with an authoritative agent; requests cannot choose filesystem roots or invoke provider-private operations.

The JSON records in `./types` distinguish standard MicroDuck observations from Lab body-phase observations. The current policy profiles have 61 observations and 14 actions; tensor width alone does not establish deployment compatibility. Provider absence returns disabled readiness capabilities; every other operation fails. Duplicate providers fail at registration, and disposing the registration removes it.

Training requests accept optional `backend: "cpu" | "mlx"`; the provider resolves omission to CPU and records the selected backend in new runs. Readiness includes per-backend availability, failure reasons, and separate learner and physics devices. Selecting unavailable MLX fails without CPU fallback. `RobotRun` represents only format-3 records and always includes `spec.backend`. Run discovery returns unsupported version diagnostics separately in `incompatibleRuns`; it never reconstructs old recipes.

Policy metadata separates historical `verification` evidence from `runtimeCompatibility`, which reports whether the intact artifact can execute under the current provider runtime and gives a reason when it cannot. Listing an artifact does not authorize simulation or hardware deployment; execution rechecks compatibility.

## Authored studio projects

`studio` returns installed model profiles, actual joint limits and root-body identity, and versioned experimental templates independently of optional learner availability. `save_project` validates a complete recipe and creates an immutable revision; `projects` lists revisions and `project` retrieves one by its opaque `projectRevisionId`. Recipes bind tempo, beat count, move size and a version-1 `RobotMusicRecipe`; audio synthesis stays in the browser. Templates expose `category`, authoring `difficulty`, registered `behaviorId`, and explicit `trainingWeights`; consumers merge those frozen overrides with the behavior's catalog reward defaults. The provider does not silently apply template weights to training requests. No catalog entry asserts that a trained policy can perform the motion. Project and clip display names preserve identical Unicode text exactly, including spaces and slashes (nonblank, at most 64 Unicode scalars, no controls or surrogates); they never select filesystem paths. Training `spec.name` retains its ASCII identifier rule.

An optional ordered `recipe.blocks` array supports reordering, removing and duplicating `{templateId,templateVersion:1,beats,moveSize}` entries before saving a new revision. The first block must match the top-level template; block beats sum to motion/music beats, and the global move size multiplies each block's size. Version-2 revisions freeze effective `blocks` and whole-motion `training: {behaviorId,weights}`. All-Stand motion resolves to `stand` with `{}` even with explicit blocks; any mixture or non-Stand motion resolves to `imitate` with `{travel: 0}`. Use that recommendation rather than the first block's behavior for a sequence; unsupported project versions are rejected.

`reference_preview` returns `kinematic-reference` MuJoCo poses for a saved revision, not a policy rollout or evidence of dynamic feasibility. `simulate` remains `recorded-simulation`. Reference frames provide known joint positions and root tilt; joint/root velocity, root speed, controller targets and actuator torque are null because they are not measured. Recorded simulation frames provide actual simulator state with explicit joint, actuator and identified-root units. Consumers must preserve these mode distinctions and must not interpret upright evaluation success as choreography certification.

A training request may bind `projectRevisionId` with `clip: null` to select its saved clip, or supply the identical clip. Admission resolves that immutable revision and stores `projectSnapshot` with the run recipe; callers cannot supply the snapshot. Training never looks up a mutable project or recompiles a template after admission. Ordinary training still accepts its explicit clip or null and resolves the backend independently.

## Learning trials and evidence

`save_trial` commits a `RobotTrialRecipe` before `train_trial` may start it. The recipe requires a saved project and `clip: null`, four learning-brief strings (`goal`, `prediction`, `plannedChange`, `evidence`), evaluation criteria, and an explicit nullable `parentReflectionId`. Evidence in the brief is a measurement plan, not a result. Each trial admits at most one run; `trials` derives status from its binding and authoritative run rather than storing a second lifecycle. Saving alone does not reserve training capacity.

`evaluate_trial` uses the frozen criteria and the trial's completed exported policy. `evaluations` returns validated completed reports and a separate `incompleteCount`, not successful placeholders for interrupted admissions. `save_reflection` binds observation, interpretation and next change to an actual report matching the same trial's frozen criteria, run and policy bytes; `reflections` reloads committed records. An improvement draft is unsaved until a new `save_trial` commits its `parentReflectionId`; it never edits the parent or resumes its checkpoint.

`replay_evaluation` selects a saved episode by zero-based index and returns `mode: 'new-resimulation'`: a new simulation using the report's seed and requested horizon, not original evaluation frames. Only session-owned run policies support it; execution rechecks policy bytes and runtime compatibility. The [record reference](../../../docs/subsystems/robot.md) defines the shared types and evidence semantics.

## Model Experience

### Operation results

#### What the model sees

The `robot_lab` tool consumer summarizes `RobotLabResult` records from this service. The service does not construct model messages; without a provider, readiness reports disabled capabilities and other operations fail.

#### Token effect

Only the consumer's logged tool results add context; this service injects no messages or schemas.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The local provider does not support physical deployment, paid GPU training, uploaded checkpoints, or automatic training continuation after restart.
- Simulation responses contain bounded recorded rollouts, not continuous real-time telemetry. Consumers must preserve the `recorded-simulation` label.
- Run formats and observation profiles are explicit; no compatibility promise covers earlier experimental artifacts.
