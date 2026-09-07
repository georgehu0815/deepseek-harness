---
description: "Use the robot_lab tool to author MicroDuck projects, request local experiments and inspect bounded evaluation evidence without activating hardware."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-robot-lab

English | [中文](README.zh.md)

## Summary

Send session-owned JSON operations through `robot_lab`, the tool this package registers over `ctx.robotLab`. Its `request_json` accepts public readiness, catalog, geometry, policy, run, training, stop, simulation, evaluation, and deployment-preparation requests. The executor validates public operation names before invoking the provider; internal bridge commands cannot be called. No operation activates hardware.

## Table of Contents

- [Learner readiness and progress](#learner-readiness-and-progress)
- [Authored studio projects](#authored-studio-projects)
- [Learning trials and evidence](#learning-trials-and-evidence)
- [Result limits](#result-limits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="learner-readiness-and-progress"></a>

## Learner readiness and progress

Training may specify `spec.backend: "cpu" | "mlx" | "rlx"`; omission selects CPU. `mlx` selects DSH-owned PPO; `rlx` selects the configured RLX PPO. Inspect the selected backend's readiness before requesting either optional Metal learner. Robot physics remains on CPU, and an unavailable learner produces an error rather than fallback. Interpreter paths, RLX source selection and PPO deployment settings belong to the [provider configuration](../robot-lab-microduck/README.md), not request JSON.

Optional `progress.rlx` in run results reports completed-phase timings, actual optimizer steps within fully completed updates and the last fully completed update's mean weighted total PPO objective. Partial work in unfinished or failed phases is excluded, so zero reported steps does not prove no optimizer work occurred. Missing statistics are unknown, not zero. These observations are neither skill evidence nor isolated device or transfer costs; the [progress reference](../../../docs/subsystems/robot.md#run-progress) defines their scope. They use the existing tool-result records, not a new request operation.

<a id="authored-studio-projects"></a>

## Authored studio projects

`studio` exposes actual model metadata and experimental templates, including actions Stand Steady (`stand`), Say Hello (`hello`) and Look Around (`look-around`). `save_project` persists a complete motion/music recipe as an immutable revision; `projects` and `project` inspect saved revisions. `reference_preview` reports explicitly labeled kinematic poses, not learned execution. Optional `recipe.blocks` supports ordered motion editing through new immutable revisions. Project summaries retain identity, recipe, effective blocks, whole-motion training recommendations and clip size without dumping targets. `clip.name` equals the exact Unicode `recipe.name` display text; use `"project-" + project.id` for the ASCII training name, and merge `project.training.weights` with defaults from `project.training.behaviorId`. Project-bound training may include `projectRevisionId` with `clip: null` to select the saved clip, or with the identical explicit clip; the provider, not the caller, resolves and freezes its snapshot.

<a id="learning-trials-and-evidence"></a>

## Learning trials and evidence

For a guided experiment, `save_trial` first commits a project-required recipe with `clip: null`, a four-string learning brief, frozen evaluation criteria and nullable `parentReflectionId`; `train_trial` then starts its single bound run. `evaluate_trial` applies those saved criteria rather than current draft settings. `trials`, `evaluations` and `reflections` reload session-owned evidence; incomplete evaluation admissions are counted separately. `save_reflection` binds the learner's observation, interpretation and next change to an actual matching report. An improvement remains an unsaved draft until another `save_trial` commits its parent reflection reference.

For experimental choreography assessment, supply complete `recipe.evaluation.dance` criteria when saving the trial, then use `train_trial` and `evaluate_trial`. The provider freezes the scientific plan before training; direct `evaluate` can use dance criteria only when all assessment inputs match that owned run's plan. Explicit `dance.version` selects version 1 or 2 and must match the frozen plan; there are no inferred thresholds, automatic upgrades or retrospective plans. Version 1 rejects observed-fragment violations; version 2 uses whole-window RMSE lower bounds for partial coverage and defers movement-ratio decisions until all planned measurements are available. Read the balance `passed` and choreography `danceStatus` separately; incomplete measurements and absent choreography assessment are not success. The [record reference](../../../docs/subsystems/robot.md) owns threshold fields and measurement units.

`replay_evaluation` takes `evaluationId` and zero-based `episodeIndex`. It returns an explicitly new re-simulation from the saved seed and requested horizon for a session-owned run policy, not original evaluation frames or hardware control. Missing, mismatched, tampered or runtime-incompatible evidence fails. See the [service records](../../../docs/subsystems/robot.md) for exact request and result types.

<a id="result-limits"></a>

## Result limits

`maxResultBytes` limits the complete structured tool result, including its wrapper. Geometry and recorded frames become model-relevant counts and summaries rather than large numerical dumps; the browser still receives the full service result. Training replies summarize clip identity and size rather than repeating every joint target. Results exceeding the configured byte budget fail with a narrowing diagnostic.

<a id="model-experience"></a>

## Model Experience

### Robot Lab operation

#### What the model sees

The `robot_lab` schema describes supported JSON operations and required fields. Results contain real readiness failures, immutable run identities, measured evaluation results, or blocked deployment reasons. Visual results are explicitly recorded simulation, not live hardware telemetry. Calling the tool requires an owning agent session.

#### Token effect

The schema contributes a fixed prompt cost. Each logged result adds bounded JSON text; geometry, frame arrays, and full clip keyframes are omitted from model-facing summaries.

#### KV Cache effect

Results append to the existing conversation. This package does not rewrite preceding messages or make an independent model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The JSON-string argument is a compact initial operation interface rather than separate typed tools for each operation.
- The tool does not attach images or video, register jobs with the generic job tools, automatically poll training, or publish completion messages into an idle agent session. Inspect runs explicitly.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published because this tool delegates to `ctx.robotLab` and bounds model-facing results without owning independent policy state.

</details>
