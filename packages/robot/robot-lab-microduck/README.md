# @deepseek-ai/dsh-robot-lab-microduck

English | [中文](README.zh.md)

Local CPU MuJoCo provider for `ctx.robotLab`, with CPU SB3 training and optional DSH-owned MLX GPU PPO. Configure absolute `sourceRoot` (a MicroDuck Lab checkout with its upstream model checkout) and `pythonBin` (that Lab's installed Python environment). Optional `mlxPythonBin` selects a separate Python 3.12 environment with MLX on macOS arm64. The package does not install dependencies, modify the checkout, open a server port, publish policies, or command hardware.

## Storage and process ownership

`storageDirectory` defaults to `.microduck-studio` below the authoritative session workspace. Each session receives a hash-named directory. Filesystem containment is checked through `ctx.fs`; every Python process runs through `ctx.subprocess` with full `ctx.sandbox` confinement. Read-only sessions cannot start training. Secrets are not forwarded implicitly. Interpreter, source, and bridge paths are not accepted from request JSON.

Training admission reserves one configured local capacity slot before preparing a run. `maxConcurrentTraining`, training and operation timeouts, termination grace, output limits, environment count, step count, clip size, and reward bounds are configurable. Browser disconnection does not cancel admitted training. Stop and provider disposal terminate process trees and await quiescence. A run without its owning process becomes interrupted when inspected; it never restarts automatically.

Every version-3 manifest freezes the resolved backend, recipe and clip, dependency versions, source/model fingerprint, bridge and learner identities, hardware and devices, and effective BAM parameter values plus their installed-package or fallback source and hash. `bridgeSha256` hashes the `bridge.py` and `studio.py` runtime bundle; learner helper hashes remain separate. Reload rejects changed BAM values or source choice; environment construction reuses frozen values without reopening installed parameter data. Both learners use standing starts, observation noise, action delay, no assistance, no domain randomization, and the selected actuator. Reload checks the frozen clip instead of resolving a behavior's default clip. The packaged bridge adapts the Lab's environment factory without changing its source.

Completion and `policySha256` commit in one atomic manifest replacement. Owned policies without a completed run and matching frozen hash cannot load. ONNX Runtime executes the same in-memory bytes that were verified, not a reopened file path. Artifacts include the normalized `policy.onnx`, private trainer checkpoints, progress, and evaluation evidence. Uploaded pickle checkpoints are not accepted.

## Studio recipes and reference preview

`studio` reads the installed MuJoCo model to identify `trunk_base`, the fourteen ordered hinge joints, their actual ranges and standing defaults. Only the MicroDuck adapter is available. Version-1 Head Bob, Disco Groove, Side Sway, Robot Pop, Tiny March, Celebration Mix, Stand Steady, Say Hello and Look Around templates are experimental authored motion, not learned skills. Each template declares dance/action category, authoring difficulty, and its registered reward behavior (`stand` for Stand Steady, `imitate` for the other motions). Each in-place imitation template declares `trainingWeights: {travel: 0}`; Stand Steady declares no overrides. The caller explicitly merges these values with registered reward defaults; ordinary training does not change. These labels and overrides are not policy evaluation results. Compilation bounds targets to the model's ranges and smooths transitions; matching loop endpoints prevent a target jump at wraparound.

The recommended recipe is 96 BPM, 32 beats (20 seconds), and move size 0.5. Move size is bounded to [0,1]. `minStudioBpm` and `maxStudioBpm` default to 40 and 200; `studioBeatChoices` defaults to [16,32] for single-template recipes. `studioBlockBeatChoices` defaults to [4,8,16,32] and `maxProjectBlocks` to 8; sequence totals may be sums outside the single-template preset list. `maxClipKeys`, `maxClipSeconds` and `maxSimulationSteps` also constrain compilation and preview. Music must have matching tempo and beats and one of `disco`, `electronic`, `lofi` or `chiptune`; only its versioned recipe is persisted. The browser generates downloadable audio without a music provider or key.

`save_project` commits an immutable version-2 `revision-<uuid>` JSON record below session-owned `projects/`, binding the complete recipe, every block's template snapshot, resolved training recommendation, model profile and compiled clip with a SHA256 digest. Older project versions are rejected without migration. `projects` and `project` validate stored records before returning them. `maxProjects` defaults to 100 retained revisions; saves reject at capacity rather than pruning. A non-null recipe `projectId` must identify an existing local project. Read-only sessions cannot save. A project-bound training request supplies its revision identity and either `clip: null` to select the saved clip or the identical explicit clip; preparation freezes the resolved clip and full snapshot in its version-3 training recipe. Later project saves cannot change the admitted run.

Optional `recipe.blocks` composes ordered motion at one BPM. The first block identifies the top-level template, total beats match music, and global move size scales each block. Reordering, removing or duplicating blocks creates a new saved revision. Each block returns to the model's neutral standing pose within its declared beats; joins add no hidden beats or duplicate keys. The compiler preserves eight samples per beat and rejects insufficient key budgets. `project.training` resolves all-Stand motion to `stand` with `{}`, including explicit block sequences; any mixture or non-Stand motion uses `imitate` with `{travel: 0}`. Consumers merge its overrides with behavior defaults instead of selecting the first block's behavior. Compiled `clip.name` preserves `recipe.name` exactly as Unicode display text, including spaces and slashes; neither determines project paths. Display names must be nonblank, at most 64 Unicode scalars, with no controls or surrogates. Training `spec.name` retains its ASCII rule.

`reference_preview` uses CPU MuJoCo forward kinematics on the frozen clip and labels every result `kinematic-reference`. It requires `maxSimulationSteps >= 2` to retain both zero and duration endpoints; one-step actual simulations remain valid. It does not run a learned policy, integrate dynamics, or establish balance or contact feasibility. Kinematic frames report known joint positions and root tilt. Their joint velocity, root world velocity, root speed, controller targets and actuator torque are null, not measured zeros or finite-difference estimates. Recorded policy frames report actual qpos (rad), qvel (rad/s), controller targets (rad), generalized actuator torque (N m), and identified-root world linear velocity/speed (m/s) and tilt (rad). Contact events and dance-timing scores are not inferred from body transforms.

## Durable learning records

The host provider persists immutable version-1 trials, trial/run bindings and reflections in authorized session storage through the configured filesystem. Project format 2, run format 3 and scientific Python artifacts retain their own formats. Learning metadata does not change the Python runtime fingerprint. `save_trial` requires a Python-validated project snapshot matching a bounded reread, and validates the complete brief, training request, frozen evaluation criteria and optional parent reflection before committing; it neither reserves capacity nor starts Python training. `train_trial` commits one binding before starting its trainer, rejects a second admission, and derives run status from the existing supervisor. Preparation or persistence failure must not start untracked training.

`evaluate_trial` resolves the bound completed run and uses its policy with the trial's frozen evaluation criteria. `evaluations` validates saved admissions and completed reports, including policy ownership and hashes, and returns admissions lacking a report only as `incompleteCount`. `save_reflection` rejects missing, foreign-session, mismatched or tampered trial/report references and binds the report's hash and actual policy bytes only when its criteria match the frozen trial recipe. New trials may reference that immutable reflection; ancestry reads validate all referenced evidence and reject cycles. Drafts are not durable lineage. `maxTrials`, `maxReflections`, `maxEvaluationRecords`, `maxLearningRecordBytes` and `maxLearningTextLength` bound retained history reads and learning records; the [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-robot-lab-microduck) defines their scope. Record and complete-response limits fail explicitly rather than pruning evidence or fabricating empty histories.

`replay_evaluation` supports only completed session-owned run policies. It verifies the saved report and policy, selects its recorded episode seed, and calls the existing simulator with the report's requested `stepsPerEpisode` and supported zero command. It does not shorten the request to the episode's actual early-terminated step count or use current draft settings. The result is a **new re-simulation**, not an original recording, and runtime incompatibility remains a blocker regardless of a historical pass.

## Learner selection

Training accepts `backend: "cpu" | "mlx"`; omission resolves to CPU before admission. Readiness reports each backend's availability and reason, `learnerDevice`, and `physicsDevice`. Missing or failed MLX never falls back to CPU. CPU uses the Lab's existing SB3 recipe. MLX uses the original `dsh-mlx-ppo-v1` recipe, not RLX or EnvPool: Metal actor/critic learning, CPU MuJoCo/BAM physics, no symmetry prior, and no speedup claim. CPU workers fork before MLX or Torch initialization; Metal probes run in separate processes.

MLX stores raw Gaussian samples and their log probabilities; the environment clips applied actuation while observing the raw action. Export returns the deterministic raw mean with frozen observation normalization baked in: float64 subtraction, division and clipping, then float32 actor input, matching training's `VecNormalize`. Export parity uses the actual frozen environment normalizer rather than a second export-oriented implementation. Timeout bootstrapping uses the terminal observation, and both terminal kinds stop GAE propagation across resets. CPU collection and export retain their original action semantics. MLX numeric snapshots are not resumable checkpoints. ONNX publication requires CPU Runtime parity against the frozen Metal actor; inference does not require MLX, but still checks artifact, helper, runtime, source, and physics provenance.

To provision the optional interpreter without modifying either external environment, choose absolute `LAB` and `DSH` checkout paths and run:

```sh
UV_PROJECT_ENVIRONMENT="$DSH/.artifacts/microduck-mlx-env" uv sync --frozen --project "$LAB/microduck_local" --python 3.12 --no-editable
uv pip install --python "$DSH/.artifacts/microduck-mlx-env/bin/python" 'mlx==0.31.1'
```

Set `mlxPythonBin` to that interpreter. MLX 0.31.1 resolves the matching Metal package; no RLX, EnvPool, or global Qt installation is needed. Setup is explicit and is never triggered by a training request.

## Simulation and evaluation

Requested `steps` or `stepsPerEpisode` set the rollout horizon independently of the behavior's training episode length. At 50 Hz, 1,000 steps request 20 seconds and the default `maxSimulationSteps` of 1,500 permits 30 seconds. Fall and non-finite-state termination still stop an episode early. Training horizons and reference-clip periods are unchanged; looping reference targets do not repeat recorded frames.

Policy discovery verifies supported completed manifests and ONNX hashes while reporting `runtimeCompatibility` separately. Intact version-3 artifacts remain listed with an incompatibility reason after a bridge, source, dependency, or BAM change; their original provenance and evaluation evidence are not rewritten. `runs` separates unsupported on-disk versions into `incompatibleRuns` diagnostics without interpreting their recipes or artifacts. These files are untouched, excluded from policy discovery, and rejected by direct run or execution requests. Simulation and evaluation recheck compatibility and reject incompatible artifacts before inference. Restore the original runtime or train a new run rather than changing frozen hashes.

`scene` returns actual MuJoCo meshes. `simulate` loads a named exported policy and returns a bounded, seeded BAM rollout with body transforms; it is recorded simulation, not live control. Only the shipped walking/standing policies and policies from completed owned runs are selectable. Simulation and evaluation record the effective BAM values, disabled observation noise, enabled action delay, and disabled domain randomization and random yaw. Simulation and individual evaluation episodes also report sampled battery voltage, sag gain, firmware limits, friction scale, and delay settings. Seeded BAM startup sampling remains active even without domain randomization.

Every evaluation reserves an immutable `eval-<uuid>` directory under session storage `evaluations/`. Before any rollout, `request.json` records the supplied spec and criteria, exact policy hash, physics settings, identity, and admission time. The matching `report.json` contains measured episodes, optional pose RMSE, and the supplied criteria's result. Concurrent calls use distinct directories and exclusive, randomly named temporary files. All admissions and reports are retained, including shipped-policy evidence; an interrupted attempt retains its admission without a completed report. `verification: evaluated` means a report exists for those policy bytes, not that its criteria passed. Passing termination and upright criteria neither proves choreography completion nor certifies hardware safety.

Lab imitation stores sin/cos phase in body-command observation indices 59–60. `microduck-lab-body-phase-61` policies are not compatible with the robot's standard body pitch/yaw semantics. `prepare` always returns `allowed: false`, with an additional phase mismatch reason for clip policies. No API bypass enables physical deployment.

## Verification

Run dependency-free bridge tests with `python -B packages/robot/robot-lab-microduck/tests/test_bridge.py`; `tests/test_mlx_ppo.py` additionally requires NumPy and enables numerical/export checks when MLX and ONNX Runtime are present. The optional real smoke uses `tests/smoke.py --source <absolute-lab> --output <workspace-directory> --backend cpu|mlx --steps 32` under the selected interpreter. `--inference-python <cpu-interpreter>` verifies that exported MLX policies execute without MLX installed. It trains a small head-sway reference, exports and reloads the exact policy, simulates, evaluates, and verifies blocked deployment. Its short training budget is an integration check, not evidence that a useful dance was learned.

`tests/test_studio.py` covers immutable project files and model-limit validation; setting `ROBOT_STUDIO_SOURCE` enables real CPU catalog, reference, telemetry and frozen-project train/export checks. Run it with the installed interpreter and the provider's `OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1` environment. `tests/studio-process.spec.ts` uses `DSH_MICRODUCK_SOURCE_ROOT` and `DSH_MICRODUCK_PYTHON` to validate actual Python replies through the TypeScript parser without training.

The opt-in `pnpm run test:e2e packages/robot/robot-lab-microduck/tests/provider.e2e.ts` uses the real Loader, agent, provider, subprocess service, and workspace sandbox. Set `DSH_MICRODUCK_SOURCE_ROOT` and `DSH_MICRODUCK_PYTHON` to the installed paths; without both, it skips. Optional `DSH_MICRODUCK_BACKEND=mlx` and `DSH_MICRODUCK_MLX_PYTHON` select a 32-step Metal training smoke with CPU inference; CPU defaults to 1,024 steps. Requesting MLX without its interpreter fails. It checks training, durable ONNX hash identity, simulation, evaluation records, and blocked deployment without a model key or hardware connection.

## Model Experience

### Measured results and diagnostics

#### What the model sees

The `robot_lab` tool consumer summarizes this provider's measured results and failure diagnostics. Simulation is labeled `recorded-simulation`; deployment preparation returns `allowed: false`. The provider injects no messages.

#### Token effect

The consumer controls result summaries and their byte budget; full meshes and rollout frames are not model messages emitted by this provider.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- No live stream, pose solver API, warm-start/fine-tuning operation, paid GPU launcher, publication, hardware installation, or activation is provided.
- Evaluation does not include randomization sweeps, actuator-limit scoring, independent null controls, video/contact-sheet capture, or a dance-completion criterion. Inverted behaviors need different criteria.
- Source, bridge, or runtime dependency changes invalidate replay until the matching environment is restored. Only version-3 runs are supported; older formats are neither migrated nor executed.
- MLX accelerates the learner, not robot physics. Its recipe is not numerically equivalent to SB3; performance and behavioral quality require task-specific measurement.
- Artifacts are retained without automatic pruning. Oversized bridge replies fail at the configured output limit.
