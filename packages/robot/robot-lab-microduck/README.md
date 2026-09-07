---
description: "Configure local MicroDuck training with CPU, MLX or RLX, and inspect recorded simulation and policy-evaluation limits."
kind: "package-reference"
---

# @deepseek-ai/dsh-robot-lab-microduck

English | [中文](README.zh.md)

## Summary

Train MicroDuck locally through `ctx.robotLab` with CPU SB3, optional DSH-owned MLX GPU PPO, or a separately configured RLX PPO backend. MuJoCo physics runs on CPU. Configure absolute `sourceRoot` (a MicroDuck Lab checkout with its upstream model checkout) and `pythonBin` (that Lab's installed Python environment). Optional `mlxPythonBin` selects a separate Python 3.12 environment with MLX on macOS arm64. The package does not install dependencies, modify the checkout, open a server port, publish policies, or command hardware.

## Table of Contents

- [Storage and process ownership](#storage-and-process-ownership)
- [Studio recipes and reference preview](#studio-recipes-and-reference-preview)
- [Durable learning records](#durable-learning-records)
- [Learner selection](#learner-selection)
- [Simulation and evaluation](#simulation-and-evaluation)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="storage-and-process-ownership"></a>
## Storage and process ownership

`storageDirectory` defaults to `.microduck-studio` below the authoritative session workspace. Each session receives a hash-named directory. Filesystem containment is checked through `ctx.fs`; every Python process runs through `ctx.subprocess` with full `ctx.sandbox` confinement. Read-only sessions cannot start training. Secrets are not forwarded implicitly. Interpreter, source, and bridge paths are not accepted from request JSON.

Training admission reserves one configured local capacity slot before preparing a run. `maxConcurrentTraining`, training and operation timeouts, termination grace, output limits, environment count, step count, clip size, and reward bounds are configurable. Browser disconnection does not cancel admitted training. Stop and provider disposal terminate process trees and await quiescence. A run without its owning process becomes interrupted when inspected; it never restarts automatically.

Every version-3 manifest freezes the resolved backend, recipe and clip, dependency versions, source/model fingerprint, bridge and learner identities, hardware and devices, and effective BAM parameter values plus their installed-package or fallback source and hash. `bridgeSha256` hashes the packaged `bridge.py`, `studio.py` and `dance_metrics.py` runtime bundle; learner helper hashes remain separate. Reload rejects changed BAM values or source choice; environment construction reuses frozen values without reopening installed parameter data. All three learners use standing starts, observation noise, action delay, no assistance, no domain randomization, and the selected actuator. Reload checks the frozen clip instead of resolving a behavior's default clip. The packaged bridge adapts the Lab's environment factory without changing its source.

Completion and `policySha256` commit in one atomic manifest replacement. If completion has already committed when Stop settles, Stop preserves the completed policy and original finish timestamp while still waiting for the whole process tree to exit. Training stopped before completion is recorded as `stopped` without a published policy. Owned policies without a completed run and matching frozen hash cannot load. ONNX Runtime executes the same in-memory bytes that were verified, not a reopened file path. Artifacts include the normalized `policy.onnx`, private trainer checkpoints, progress, and evaluation evidence. Uploaded pickle checkpoints are not accepted.

For `run` and `runs`, process-owner reconciliation preserves the progress sample already parsed from the bridge while applying the rest of the authoritative run record, including terminal state, finish time and policy identity. Progress remains nullable and point-in-time: it may lag committed completion and is not guaranteed to be the newest sample. Completion does not synthesize a final step count or make progress authoritative for policy publication.

Optional RLX progress records cumulative completed collection/update intervals, rollout/update pairs and actual minibatch optimizer steps within fully completed updates. Counters and timings exclude partial work in unfinished or failed phases; an update may apply minibatches then fail without adding any reported optimizer steps. Its last mean loss averages the last fully completed update's weighted total minibatch objectives, not separate policy/value/entropy losses, and remains null until an update fully completes. Collection wall time includes environment calls and inference; update wall time includes GAE, deferred critic computation and optimizer work. Neither isolates CPU physics or GPU compute, and transfer time has no measured value. Checkpoint serialization and ONNX/parity export have separate nullable timings populated only after successful operations; they are excluded from training `elapsedSeconds`. Checkpoints remain non-resumable. Runs without these statistics remain readable as unknown, not zero. See the [progress reference](../../../docs/subsystems/robot.md#run-progress) for exact fields and remaining cost-attribution limits.

<a id="studio-recipes-and-reference-preview"></a>

## Studio recipes and reference preview

`studio` reads the installed MuJoCo model to identify `trunk_base`, the fourteen ordered hinge joints, their actual ranges and standing defaults. Only the MicroDuck adapter is available. Version-1 Head Bob, Disco Groove, Side Sway, Robot Pop, Tiny March, Celebration Mix, Stand Steady, Say Hello and Look Around templates are experimental authored motion, not learned skills. Each template declares dance/action category, authoring difficulty, and its registered reward behavior (`stand` for Stand Steady, `imitate` for the other motions). Each in-place imitation template declares `trainingWeights: {travel: 0}`; Stand Steady declares no overrides. The caller explicitly merges these values with registered reward defaults; ordinary training does not change. These labels and overrides are not policy evaluation results. Compilation bounds targets to the model's ranges and smooths transitions; matching loop endpoints prevent a target jump at wraparound.

The recommended recipe is 96 BPM, 32 beats (20 seconds), and move size 0.5. Move size is bounded to [0,1]. `minStudioBpm` and `maxStudioBpm` default to 40 and 200; `studioBeatChoices` defaults to [16,32] for single-template recipes. `studioBlockBeatChoices` defaults to [4,8,16,32] and `maxProjectBlocks` to 8; sequence totals may be sums outside the single-template preset list. `maxClipKeys`, `maxClipSeconds` and `maxSimulationSteps` also constrain compilation and preview. Music must have matching tempo and beats and one of `disco`, `electronic`, `lofi` or `chiptune`; only its versioned recipe is persisted. The browser generates downloadable audio without a music provider or key.

`save_project` commits an immutable version-2 `revision-<uuid>` JSON record below session-owned `projects/`, binding the complete recipe, every block's template snapshot, resolved training recommendation, model profile and compiled clip with a SHA256 digest. Older project versions are rejected without migration. `projects` and `project` validate stored records before returning them. `maxProjects` defaults to 100 retained revisions; saves reject at capacity rather than pruning. A non-null recipe `projectId` must identify an existing local project. Read-only sessions cannot save. A project-bound training request supplies its revision identity and either `clip: null` to select the saved clip or the identical explicit clip; preparation freezes the resolved clip and full snapshot in its version-3 training recipe. Later project saves cannot change the admitted run.

Optional `recipe.blocks` composes ordered motion at one BPM. The first block identifies the top-level template, total beats match music, and global move size scales each block. Reordering, removing or duplicating blocks creates a new saved revision. Each block returns to the model's neutral standing pose within its declared beats; joins add no hidden beats or duplicate keys. The compiler preserves eight samples per beat and rejects insufficient key budgets. `project.training` resolves all-Stand motion to `stand` with `{}`, including explicit block sequences; any mixture or non-Stand motion uses `imitate` with `{travel: 0}`. Consumers merge its overrides with behavior defaults instead of selecting the first block's behavior. Compiled `clip.name` preserves `recipe.name` exactly as Unicode display text, including spaces and slashes; neither determines project paths. Display names must be nonblank, at most 64 Unicode scalars, with no controls or surrogates. Training `spec.name` retains its ASCII rule.

`reference_preview` uses CPU MuJoCo forward kinematics on the frozen clip and labels every result `kinematic-reference`. It requires `maxSimulationSteps >= 2` to retain both zero and duration endpoints; one-step actual simulations remain valid. It does not run a learned policy, integrate dynamics, or establish balance or contact feasibility. Kinematic frames report known joint positions and root tilt. Their joint velocity, root world velocity, root speed, controller targets and actuator torque are null, not measured zeros or finite-difference estimates. Recorded policy frames report actual qpos (rad), qvel (rad/s), controller targets (rad), generalized actuator torque (N m), and identified-root world linear velocity/speed (m/s) and tilt (rad). Contact events and dance-timing scores are not inferred from body transforms.

<a id="durable-learning-records"></a>

## Durable learning records

The host provider persists immutable version-1 trials, trial/run bindings and reflections in authorized session storage through the configured filesystem. Project format 2, run format 3 and scientific Python artifacts retain their own formats. Learning metadata does not change the Python runtime fingerprint. `save_trial` requires a Python-validated project snapshot matching a bounded reread, and validates the complete brief, training request, frozen evaluation criteria and optional parent reflection before committing; it neither reserves capacity nor starts Python training. `train_trial` commits one binding before starting its trainer, rejects a second admission, and derives run status from the existing supervisor. Preparation or persistence failure must not start untracked training.

`evaluate_trial` resolves the bound completed run and uses its policy with the trial's frozen evaluation criteria. `evaluations` validates saved admissions and completed reports, including policy ownership and hashes, and returns admissions lacking a report only as `incompleteCount`. `save_reflection` rejects missing, foreign-session, mismatched or tampered trial/report references and binds the report's hash and actual policy bytes only when its criteria match the frozen trial recipe. New trials may reference that immutable reflection; ancestry reads validate all referenced evidence and reject cycles. Drafts are not durable lineage. `maxTrials`, `maxReflections`, `maxEvaluationRecords`, `maxLearningRecordBytes` and `maxLearningTextLength` bound retained history reads and learning records; the [provider configuration](src/index.ts) defines their scope. Record and complete-response limits fail explicitly rather than pruning evidence or fabricating empty histories.

`replay_evaluation` supports only completed session-owned run policies. It verifies the saved report and policy, selects its recorded episode seed, and calls the existing simulator with the report's requested `stepsPerEpisode` and supported zero command. It does not shorten the request to the episode's actual early-terminated step count or use current draft settings. The result is a **new re-simulation**, not an original recording, and runtime incompatibility remains a blocker regardless of a historical pass.

<a id="learner-selection"></a>

## Learner selection

Training accepts `backend: "cpu" | "mlx" | "rlx"`; omission resolves to CPU before admission. Readiness reports each backend's availability and reason, `learnerDevice`, and `physicsDevice`. An unavailable selection never falls back to another learner. CPU uses the Lab's existing SB3 recipe. MLX uses the original `dsh-mlx-ppo-v1` recipe, not RLX or EnvPool: Metal actor/critic learning, CPU MuJoCo/BAM physics, no symmetry prior, and no speedup claim. CPU workers fork before MLX or Torch initialization; Metal probes run in separate processes.

MLX stores raw Gaussian samples and their log probabilities; the environment clips applied actuation while observing the raw action. Export returns the deterministic raw mean with frozen observation normalization baked in: float64 subtraction, division and clipping, then float32 actor input, matching training's `VecNormalize`. Export parity uses the actual frozen environment normalizer rather than a second export-oriented implementation. Timeout bootstrapping uses the terminal observation, and both terminal kinds stop GAE propagation across resets. CPU collection and export retain their original action semantics. MLX numeric snapshots are not resumable checkpoints. ONNX publication requires CPU Runtime parity against the frozen Metal actor; inference does not require MLX, but still checks artifact, helper, runtime, source, and physics provenance.

### RLX PPO

`rlx` imports PPO, its model, rollout buffer and observation adapter from the configured RLX checkout; it does not select `dsh-mlx-ppo-v1`. Set both absolute `rlxPythonBin` and `rlxSourceRoot` paths, or leave both unset. The interpreter requires Python 3.12 on macOS arm64, working MLX Metal, the RLX dependencies and the local simulator dependencies. Configuration does not install or modify either checkout. The [published package](package.json) includes `python/rlx_ppo.py`; RLX and the simulator remain separate installations. Readiness probes imports and a small Metal operation, not learned motion.

The provider's `rlxPpo` object configures rollout horizon, minibatches, epochs, learning rate, discount, GAE, PPO losses, gradient limits, observation normalization and minimum episode duration; [the configuration definition](src/rlx-config.ts) owns defaults and ranges. Admission freezes the resolved `rlx-microduck-ppo-v1` recipe, hashes the RLX Python sources and dependency declarations including dirty contents, resolves a divisible minibatch count, and records requested versus whole-rollout collected steps. Rounded collection cannot exceed `maxTrainingSteps`. Episode duration covers the frozen clip and configured minimum, rounded up to whole steps using the installed simulator's `CTRL_DT`. The recipe records `requestedEpisodeSeconds`, `controlDtSeconds`, `episodeSteps` and effective `episodeSeconds`; the effective duration never shortens the requested motion. CPU workers start before MLX or Torch initialization.

RLX timeout bootstrapping uses the terminal-state value without extending GAE across resets; true terminations bootstrap zero. Terminal observations use the adapter's current normalization statistics without a second statistics update. Raw Gaussian actions retain their matching log probabilities, and exported actions remain raw deterministic means rather than blanket-clipped outputs. Export preserves the live adapter's float64 normalization before the float32 actor and requires CPU ONNX Runtime parity against that actor, including collected observations and normalization-limit probes.

Completed RLX runs bind `rlx-artifacts.json` through `artifactSha256`. Its hashes bind the numeric checkpoint, JSON metadata, full-precision `normalizer.npz`, `export-parity.json` and final `policy.onnx`; missing or changed members prevent loading. After export and artifact verification, RLX completion rechecks frozen source, helper, model, runtime, BAM and clip identities before committing `completed`. A mismatch records failure instead of publishing a completed policy, even when export itself succeeds. Keep the entire run directory, not just its ONNX file. These inference artifacts do not contain resumable optimizer, RNG or environment state. The [RLX backend decision](../../../.agents/notes/implemented/feature/2026-09-05-microduck-rlx-backend.md) records the separate learner identity and export requirements.

`rlx.safetensors.json` stores bounded version-1 collection diagnostics in `metadata.trainingDiagnostics`. They summarize completed episode lengths separately for termination and time-limit truncation (count, sum, minimum, maximum and eleven fixed histogram bins with inclusive upper bounds and overflow), maximum observed age and one right-censored unfinished length per environment. Lengths count control steps; zero tails denote no active unfinished steps, not extra completed episodes. `collectionComplete` means only that observed transitions equal the admitted collection budget, not completion of optimization or export, or evidence of a learned skill.

`referenceExposure` has 32 bins for source-derived post-step reward reference indices on the actual runtime grid of an explicit owned clip. Its `elapsedReferenceTraversals` counts elapsed reference-clock traversals, not measured policy phase, tracking or successful motion. Without an explicit clip, exposure is unavailable; default behavior references are not measured. Completed runs bind the checkpoint metadata through the existing artifact hashes. Raw `progress.jsonl` carries `trainingDiagnostics` prefixes at the existing sampling cadence, without policy binding even if a prefix reaches the collection budget. Missing diagnostics in older checkpoints mean unavailable, not zero. These diagnostics are not projected into public `RobotProgress` or the UI, change no assessment criteria and supply no qualified preset.

### DSH-owned MLX setup

To provision the optional DSH-owned MLX interpreter without modifying either external environment, choose absolute `LAB` and `DSH` checkout paths and run:

```sh
UV_PROJECT_ENVIRONMENT="$DSH/.artifacts/microduck-mlx-env" uv sync --frozen --project "$LAB/microduck_local" --python 3.12 --no-editable
uv pip install --python "$DSH/.artifacts/microduck-mlx-env/bin/python" 'mlx==0.31.1'
```

Set `mlxPythonBin` to that interpreter. MLX 0.31.1 resolves the matching Metal package; no RLX, EnvPool, or global Qt installation is needed. Setup is explicit and is never triggered by a training request.

<a id="simulation-and-evaluation"></a>

## Simulation and evaluation

Requested `steps` or `stepsPerEpisode` set the rollout horizon independently of the behavior's training episode length. At 50 Hz, 1,000 steps request 20 seconds and the default `maxSimulationSteps` of 1,500 permits 30 seconds. Fall and non-finite-state termination still stop an episode early. Training horizons and reference-clip periods are unchanged; looping reference targets do not repeat recorded frames.

Policy discovery verifies supported completed manifests and ONNX hashes while reporting `runtimeCompatibility` separately. Intact version-3 artifacts remain listed with an incompatibility reason after a bridge, source, dependency, or BAM change; their original provenance and evaluation evidence are not rewritten. `runs` separates unsupported on-disk versions into `incompatibleRuns` diagnostics without interpreting their recipes or artifacts. These files are untouched, excluded from policy discovery, and rejected by direct run or execution requests. Simulation and evaluation recheck compatibility and reject incompatible artifacts before inference. Restore the original runtime or train a new run rather than changing frozen hashes.

`scene` returns actual MuJoCo meshes. `simulate` loads a named exported policy and returns a bounded, seeded BAM rollout with body transforms; it is recorded simulation, not live control. Only the shipped walking/standing policies and policies from completed owned runs are selectable. Simulation and evaluation record the effective BAM values, disabled observation noise, enabled action delay, and disabled domain randomization and random yaw. Simulation and individual evaluation episodes also report sampled battery voltage, sag gain, firmware limits, friction scale, and delay settings. Nominal flags do not promise an unperturbed or settled standing start: seeded reset perturbations, BAM battery/sag sampling and action lag remain active. [Nominal physics semantics](../../../docs/subsystems/robot.md#nominal-physics) defines those draws and the fresh-construction/reset seed relationship.

Shipped-policy inference preserves the environment's returned standard-61 observation and its one-control-step velocity lag, overlaying only the requested twist on a copy; owned-run inference uses the returned observation directly. It does not rebuild observations to update commands. The [observation reference](../../../docs/subsystems/robot.md#policy-observations) owns slices, array lifetime and the body-phase incompatibility. A cadence check is not proof of upstream policy provenance, standing balance or dance feasibility.

Every evaluation reserves an immutable `eval-<uuid>` directory under session storage `evaluations/`. Before any rollout, `request.json` records the supplied spec and criteria, exact policy hash, physics settings, identity, and admission time. The matching `report.json` contains measured episodes, optional pose RMSE, and the supplied criteria's result. Concurrent calls use distinct directories and exclusive, randomly named temporary files. All admissions and reports are retained, including shipped-policy evidence; an interrupted attempt retains its admission without a completed report. `verification: evaluated` means a report exists for those policy bytes, not that its criteria passed. Passing termination and upright criteria neither proves choreography completion nor certifies hardware safety.

### Explicit choreography assessment

Save complete `evaluation.dance` criteria with a project-bound trial before starting it. Admission resolves the actual simulator reference grid, evaluation inputs, physics and evaluator identity into `run.dancePlan`. The host commits `binding.dancePlanSha256` using its canonical hash of the **entire decoded plan, including the opaque Python `sha256`**. It does not substitute or recompute the Python digest; later semantic changes fail even if that digest string is retained. Direct dance evaluation requires the matching pre-training run plan and identical assessment inputs, not retrospective defaults.

Every required cycle and authored block is scored from finite full-control-rate joint, root-orientation and root-position measurements. The report separates joint/root RMSE, movement amplitude, reference-matched gain and horizontal drift from balance. Missing samples remain missing; neither target values nor repeated frames fill gaps, and no time alignment hides phase error. `passed` still means only the supplied upright/termination criteria; `danceStatus` independently reports passed, failed or incomplete. A report without dance criteria is unassessed for choreography.

Criteria and plan versions must match at 1 or 2; unsupported versions fail. Version 1 retains observed-fragment threshold rejection. Version 2 keeps those recorded subset metrics but uses a planned-whole-window RMSE lower bound for definite partial failure; amplitude and gain can decide failure only with all planned finite measurements, even if execution terminates. Maximum drift remains decisive on partial coverage. An incomplete window cannot pass; episode termination and early truncation fail independently. Each cycle and block uses its own planned length. [The record reference](../../../docs/subsystems/robot.md#dance-assessment) defines the bound. Frozen version-1 trials remain admissible without upgrading; saved plans, verdicts, reasons and hashes are not rewritten.

The frozen reference exposes both authored duration and the actual control-grid cycle duration. The requested evaluation must cover all required runtime cycles: two 20-second cycles at 50 Hz require at least 2,000 requested steps and a configured `maxSimulationSteps` of at least 2,000; the 1,500-step default is insufficient. Dance preflight uses the stdlib-only helper without initializing numeric runtimes before RLX worker forks; numeric reference recomputation occurs at admission, evaluation and before completed-policy publication. [The choreography decision](../../../.agents/notes/implemented/feature/2026-09-05-microduck-frozen-choreography-assessment.md) records these experimental evidence limits. Timing qualification, independent controls and robustness testing remain separate work; a pass does not certify a generally learned skill or hardware safety.

Lab imitation stores sin/cos phase in body-command observation indices 59–60. `microduck-lab-body-phase-61` policies are not compatible with the robot's standard body pitch/yaw semantics. `prepare` always returns `allowed: false`, with an additional phase mismatch reason for clip policies. No API bypass enables physical deployment.

<a id="verification"></a>

## Verification

<details>
<summary>Maintainer checks — click to expand</summary>

The [bridge regressions](tests/test_bridge.py) check returned-observation identity, copied shipped-command overlays and retained non-command channels. The [optional CPU cadence check](tests/test_rollout_observations.py) uses `ROBOT_BRIDGE_SOURCE` with the installed Lab interpreter for four fixed-action BAM steps without policy loading or training; without that variable it explicitly skips. These checks cover observation lifetime and velocity lag, not a controller's balance, dance ability or upstream provenance.

The RLX [helper tests](tests/test_rlx_ppo.py) cover source fingerprints, numerical configuration, artifact binding and live-normalizer export. Their optional numeric case requires `ROBOT_RLX_NUMERIC=1` and absolute `ROBOT_RLX_SOURCE`. The separate [RLX bridge smoke](tests/smoke_rlx.py) accepts `--source`, `--rlx-source` and a fresh `--output` directory under the selected RLX interpreter. It uses two environments for a four-step saved Head Bob run and an eight-step time-limit run. These bounded checks do not establish learned choreography, host sandbox composition or browser operation.

Run dependency-free bridge tests with `python -B packages/robot/robot-lab-microduck/tests/test_bridge.py`; `tests/test_mlx_ppo.py` additionally requires NumPy and enables numerical/export checks when MLX and ONNX Runtime are present. The optional real smoke uses `tests/smoke.py --source <absolute-lab> --output <workspace-directory> --backend cpu|mlx --steps 32` under the selected interpreter. `--inference-python <cpu-interpreter>` verifies that exported MLX policies execute without MLX installed. It trains a small head-sway reference, exports and reloads the exact policy, simulates, evaluates, and verifies blocked deployment. Its short training budget is an integration check, not evidence that a useful dance was learned.

`tests/test_studio.py` covers immutable project files and model-limit validation; setting `ROBOT_STUDIO_SOURCE` enables real CPU catalog, reference, telemetry and frozen-project train/export checks. Run it with the installed interpreter and the provider's `OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1` environment. `tests/studio-process.spec.ts` uses `DSH_MICRODUCK_SOURCE_ROOT` and `DSH_MICRODUCK_PYTHON` to validate actual Python replies through the TypeScript parser without training.

The opt-in `pnpm run test:e2e packages/robot/robot-lab-microduck/tests/provider.e2e.ts` uses the real Loader, agent, provider, subprocess service, and workspace sandbox. Set `DSH_MICRODUCK_SOURCE_ROOT` and `DSH_MICRODUCK_PYTHON` to the installed paths; without both, it skips. Optional `DSH_MICRODUCK_BACKEND=mlx` and `DSH_MICRODUCK_MLX_PYTHON` select a 32-step Metal training smoke with CPU inference; CPU defaults to 1,024 steps. `DSH_MICRODUCK_BACKEND=rlx`, `DSH_MICRODUCK_RLX_PYTHON` and `DSH_MICRODUCK_RLX_SOURCE_ROOT` select the 32-step RLX variant. Missing paths for a requested optional backend fail without fallback. It checks training, durable ONNX hash identity, simulation, evaluation records, and blocked deployment without a model key or hardware connection.

The separate macOS [lifecycle test](tests/lifecycle.e2e.ts) requires `DSH_MICRODUCK_LIFECYCLE=1` and all four installed-path variables: `DSH_MICRODUCK_SOURCE_ROOT`, `DSH_MICRODUCK_PYTHON`, `DSH_MICRODUCK_RLX_SOURCE_ROOT` and `DSH_MICRODUCK_RLX_PYTHON`. It targets ordinary Stop, Stop after deliberately killing only its owned CPU workers, absence of surviving processes or published policies, and capacity reuse by a fresh run. It is an explicitly opted-in failure-injection test, not automatic dead-worker recovery or checkpoint resume.

</details>

<a id="model-experience"></a>

## Model Experience

### Measured results and diagnostics

#### What the model sees

The `robot_lab` tool consumer summarizes this provider's measured results and failure diagnostics. Simulation is labeled `recorded-simulation`; deployment preparation returns `allowed: false`. The provider injects no messages. New evaluation reports include the exact limitation `The domain-randomization flag was disabled; seeded reset and BAM variation remain. No physical trial was performed.` This distinguishes the disabled flag from continuing seeded sampling; see [nominal physics](../../../docs/subsystems/robot.md#nominal-physics). The [expected limitations](tests/expected/evaluation-limitations.json) pin the returned and stored wording; existing reports retain their recorded text.

#### Token effect

The consumer controls result summaries and their byte budget; full meshes and rollout frames are not model messages emitted by this provider.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No live stream, pose solver API, warm-start/fine-tuning operation, paid GPU launcher, publication, hardware installation, or activation is provided.
- Choreography thresholds are explicit experimental criteria, not a calibrated general dance-completion standard. Evaluation does not include randomization sweeps, actuator-limit scoring, independent null controls or video/contact-sheet capture. Inverted behaviors need different criteria.
- Source, bridge, or runtime dependency changes invalidate replay until the matching environment is restored. Only version-3 runs are supported; older formats are neither migrated nor executed.
- MLX accelerates the learner, not robot physics. Its recipe is not numerically equivalent to SB3; performance and behavioral quality require task-specific measurement.
- Artifacts are retained without automatic pruning. Oversized bridge replies fail at the configured output limit.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published because this provider exposes no separate cross-plugin event relation to check. Admission, bridge-reply and artifact-compatibility validation run in the owning operations.

</details>
