# @deepseek-ai/dsh-tool-robot-lab

English | [中文](README.zh.md)

Registers `robot_lab`, a session-owned JSON-operation tool over `ctx.robotLab`. Its `request_json` accepts public readiness, catalog, geometry, policy, run, training, stop, simulation, evaluation, and deployment-preparation requests. The executor validates public operation names before invoking the provider; internal bridge commands cannot be called. No operation activates hardware.

Training may specify `spec.backend: "cpu" | "mlx"`; omission selects CPU. Inspect per-backend readiness before requesting optional MLX GPU learning. Robot physics remains on CPU, and unavailable MLX produces an error rather than fallback.

`studio` exposes actual model metadata and experimental templates, including actions Stand Steady (`stand`), Say Hello (`hello`) and Look Around (`look-around`). `save_project` persists a complete motion/music recipe as an immutable revision; `projects` and `project` inspect saved revisions. `reference_preview` reports explicitly labeled kinematic poses, not learned execution. Optional `recipe.blocks` supports ordered motion editing through new immutable revisions. Project summaries retain identity, recipe, effective blocks, whole-motion training recommendations and clip size without dumping targets. `clip.name` equals the exact Unicode `recipe.name` display text; use `"project-" + project.id` for the ASCII training name, and merge `project.training.weights` with defaults from `project.training.behaviorId`. Project-bound training may include `projectRevisionId` with `clip: null` to select the saved clip, or with the identical explicit clip; the provider, not the caller, resolves and freezes its snapshot.

For a guided experiment, `save_trial` first commits a project-required recipe with `clip: null`, a four-string learning brief, frozen evaluation criteria and nullable `parentReflectionId`; `train_trial` then starts its single bound run. `evaluate_trial` applies those saved criteria rather than current draft settings. `trials`, `evaluations` and `reflections` reload session-owned evidence; incomplete evaluation admissions are counted separately. `save_reflection` binds the learner's observation, interpretation and next change to an actual matching report. An improvement remains an unsaved draft until another `save_trial` commits its parent reflection reference.

`replay_evaluation` takes `evaluationId` and zero-based `episodeIndex`. It returns an explicitly new re-simulation from the saved seed and requested horizon for a session-owned run policy, not original evaluation frames or hardware control. Missing, mismatched, tampered or runtime-incompatible evidence fails. See the [service records](../../../docs/subsystems/robot.md) for exact request and result types.

`maxResultBytes` limits the complete structured tool result, including its wrapper. Geometry and recorded frames become model-relevant counts and summaries rather than large numerical dumps; the browser still receives the full service result. Training replies summarize clip identity and size rather than repeating every joint target. Results exceeding the configured byte budget fail with a narrowing diagnostic.

## Model Experience

### Robot Lab operation

#### What the model sees

The `robot_lab` schema describes supported JSON operations and required fields. Results contain real readiness failures, immutable run identities, measured evaluation results, or blocked deployment reasons. Visual results are explicitly recorded simulation, not live hardware telemetry. Calling the tool requires an owning agent session.

#### Token effect

The schema contributes a fixed prompt cost. Each logged result adds bounded JSON text; geometry, frame arrays, and full clip keyframes are omitted from model-facing summaries.

#### KV Cache effect

Results append to the existing conversation. This package does not rewrite preceding messages or make an independent model request.

## Known Limitations and Deferred Work

- The JSON-string argument is a compact initial operation interface rather than separate typed tools for each operation.
- The tool does not attach images or video, register jobs with the generic job tools, automatically poll training, or publish completion messages into an idle agent session. Inspect runs explicitly.
