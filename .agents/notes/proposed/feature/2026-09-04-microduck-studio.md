# Agent Note: Native MicroDuck policy studio

Status: proposed

English | [中文](2026-09-04-microduck-studio.zh.md)

## Problem

A robot-learning workspace needs one reproducible path from an authored behavior through training, deterministic evaluation, simulation playback, and deployment preparation. MicroDuck Lab supplies useful CPU MuJoCo/SB3 engines and a browser renderer, but its standalone application does not provide DSH session ownership or a verified hardware-release process. Exported tensor dimensions alone do not establish compatibility: local clip imitation uses body-command observation indices 59–60 for phase, whereas the inspected robot runtime assigns different meanings to those fields.

Robot authoring needs conversation-width controls without taking exclusive ownership of Earth's visual column. The [slot standard](../../implemented/architecture/2026-07-22-slot-type-chain-implementation.md) remains authoritative; the [Terra integration decision](../../implemented/architecture/2026-08-20-terra-geo-plugin-port.md) retains its geo providers, projections, and rendering rationale. This proposal owns MicroDuck authoring and shared-player integration, not the geo capability. The [student learning-loop proposal](2026-09-05-microduck-student-learning-loop.md) extends the workflow with independent evaluation, durable learning trials, comparison, and reflection; the scientific runtime and shared-player decisions here remain applicable.

The [implemented independent-group decision](../../implemented/feature/2026-09-05-microduck-independent-group-playback.md) owns per-duck policy selection, manual training setup and synchronized recorded playback. The [native Clip Gen decision](../../implemented/feature/2026-09-05-microduck-native-clip-gen.md) owns graphical joint/rig authoring and reviewed MP4 reference export. Neither replaces this proposal's scientific runtime or deferred hardware work. The [blank-session presentation decision](../../implemented/architecture/2026-09-05-blank-session-presentation-views.md) owns chat-independent View eligibility, not completion of this broader Studio workflow.

## Proposal

Reuse the Python simulation, actuator, training, and ONNX-export implementations through a configurable local provider. Port focused renderer and motion-authoring components into a native client plugin, preserving upstream attribution. Do not start the standalone Next.js application or make browsers connect directly to configurable Lab URLs.

A Robot Lab Service Definition owns the provider registration and the public operations shared by tools and typed Remote callers. The MicroDuck Service Provider owns process supervision and immutable artifacts. Tool Consumers expose bounded task-relevant results. The client plugin owns the center workflow and its shared right-hand player. The [implemented Train/Evaluate layout](../../implemented/simplification/2026-09-05-microduck-train-evaluate-columns.md) owns full-width center subtabs, collapsed target setup and the absence of center Perform controls; the broader scientific-runtime and player requirements here remain active. All registrations unwind with their Cordis fibers; no agent-loop modification is required.

### Native center workflow and shared player

Register Micro Duck in `conversation.view` with order 40 beside Supply Chain; keep Robot Studio in the shared right visual workspace beside Earth. The `visual.workspace.view` wrapper supports a missing session without accessing store hooks, then renders its declared session-scoped `robot-lab.visual.player` child. Both entries share one captured-session `LabClient` and `PlaybackTransport`. The client object owns business records and polling; the declared store owns drafts and view preferences. Closing or hiding the player pauses audio and pose but does not cancel training. Session switches never retarget requests, and late responses cannot update disposed owners.

### Authored targets, projects and music

Nine original experimental dance/action templates use the actual MJCF model's fourteen-joint order, default pose and limits. Saving creates an immutable session-owned format-2 project revision containing its recipe, model/profile, resolved ordered blocks, whole-composition training recommendation, compiled targets and SHA-256. Optional authored blocks are the sole motion source, share one BPM, and keep motion/music beat totals consistent; per-block relative size is multiplied by master move size. Each resolved block freezes its template metadata. Whole-motion training recommendations combine all blocks rather than using the first template alone. Template/clip/music formats stay at 1 and run format at 3; old project formats are rejected without migration. MuJoCo forward kinematics provides a real model preview labeled Target preview / Not physics-tested, not fabricated physics or evidence of learned behavior. Training admission resolves and freezes the selected project revision and music; subsequent draft edits cannot rename, retime or rebind old recordings.

Music synthesis is original local seeded percussion, bass and melody in disco, electronic, lofi and chiptune styles, with no external account/key, voices or commercial recordings. Only the recipe persists; the browser generates bounded transient PCM and downloadable WAV. Audio generation and playback remain separate explicit actions. Music-backed playback uses AudioContext as the master clock for sound and pose; explicit `music: null` uses monotonic time. Audio failure pauses with a visible reason, never silently substituting a different clock. Pause, seek, restart, end, hidden view/document, session switch and disposal synchronize both outputs. Playback never autostarts or loops a short recording to imply sustained performance. Per-session replay rates of 0.5×, 1×, 1.5× and 2× scale shared logical time and audio tempo/pitch without changing saved BPM, PCM/WAV, training or measured body speed. Rate changes during pending audio resume cancel to paused. Frozen block/beat indicators use recorded time, and training throughput remains distinct from motion speed.

Every RobotFrame carries telemetry in the model's actual joint order: qpos, qvel, delayed controller position targets, applied actuator torque, identified root world velocity, speed and tilt. Physics values must come from simulation state, not target clips or noisy observations. Kinematic preview values retain target labels and have no measured torque/controller output. Foot contacts are not recorded. Tempo, physical travel speed and learning throughput are distinct quantities.

### Experiment identity and execution

Every run freezes the recipe, exact reference clip, seed, environment and actuator settings, semantic observation profile, source versions, and export checksum. Warm-start descendants would also need a frozen parent-checkpoint identity; they remain outside the delivered slice. A policy loader restores the recorded clip rather than resolving a behavior default. The artifact root is inside the authorized workspace; source checkouts are configuration, not hardcoded deployment paths.

Process owners use the subprocess and sandbox services, scrub unrelated credentials, bound output, and await termination. Concurrent mutations and retried starts must not create duplicate training jobs. Failure, cancellation, and interrupted recovery remain distinguishable from successful completion. Browser refresh never replays a training start or hardware command.

A completed run binds the exported bytes to a frozen hash; inference consumes those verified bytes rather than reopening a mutable path. Effective BAM parameter values and their source are part of provenance because an installed parameter package can change physics without changing the Lab checkout. Each evaluation has an independent identity and records its criteria and policy hash before execution; subsequent evaluations must not erase earlier evidence. Run ownership begins at admission, and disposal waits through both process exit and durable settlement. Stale inspection results cannot demote a terminal run.

### Optional Apple MLX learning

The [implemented RLX backend decision](../../implemented/feature/2026-09-05-microduck-rlx-backend.md) owns the separately configured `rlx` learner and its artifact binding. The DSH-owned `mlx` decision below remains applicable; neither backend establishes this proposal's deferred choreography or hardware acceptance.

CPU remains the default. The optional Apple MLX backend runs policy and critic learning on Metal while retaining CPU MuJoCo/BAM physics. Its original DSH PPO implementation is informed by RLX, but does not copy or depend on RLX or EnvPool. A separate frozen recipe records the algorithm and device choices; it has no symmetry loss and is not numerically equivalent to the CPU trainer. GPU overhead can outweigh learning throughput for small runs, so no speedup is promised.

Export parity must compare ONNX inference against the actual frozen `VecNormalize` instance followed by the float32 actor. Observation normalization uses double-precision statistics and arithmetic before conversion to float32. Reimplementing the same reduced-precision normalization in both the exporter and its reference can make both agree while diverging from the trained controller. Numeric checkpoints and the exact normalizer statistics are evidence, not substitutes for that independent comparison. Trainer/helper source hashes, the recipe, devices, environment, and exported artifact hashes bind execution to its recorded provenance; rewriting them is not a compatibility repair.

### Evidence and deployment

Animation, simulation, recorded rollout, and physical operation have distinct labels. Assistance and policy handoffs remain visible. Evaluate the deterministic exported ONNX with its baked normalizer, recording the exact policy hash, independent physical constraints, task completion, and starting conditions. A reward curve or locomotion termination count is not a dance verification result. Include standing/baseline and null controls where applicable.

Local body-phase clip policies are simulation-only. Deployment preparation reports semantic incompatibility and missing target configuration explicitly; it does not install or activate a policy. Physical release requires a supported runtime command encoding, official GPU retraining and randomization, target-specific validation, separately approved installation/activation, onboard watchdogs, and a supervised trial. Neither a manifest assertion nor a human approval can replace failed compatibility checks. The browser and language model do not own a motor-control loop.

Model-visible summaries and evidence are reconstructable from logged tool results or declared session events. High-rate poses are not conversation history. Historical replay reconstructs records without executing side effects.

## Alternatives considered

**Embed the standalone Lab in an iframe.** This preserves its fullscreen UI but also its independent transport, global input handling, and job ownership. Native slot composition lets conversation and direct controls use the same authorized service.

**Rewrite MuJoCo and PPO in TypeScript.** This duplicates the most specialized existing code without improving the user workflow. The Python provider keeps scientific behavior independently testable.

**Add a fifth permanent robot column.** A shared visual track preserves conversation width and keeps visualization contributions independent of shell geometry.

**Treat any 61-input/14-output ONNX as deployable.** Identical dimensions conceal different command encodings, joint order, normalization, and timing. Explicit semantic profiles and target verification are required.

**Repeat short recordings to imply longer learned motion.** Playback repetition cannot establish sustained control. Requested rollout steps define an independent simulation horizon while fall termination remains active; the training episode and reference period remain unchanged.

**Hide old policies or rewrite their provenance after a bridge change.** Artifact integrity and current runtime compatibility are separate checks. Format-3 artifacts remain inspectable when runtime drift blocks inference. Unsupported-format files stay untouched and are listed separately as unsupported records, not interpreted as executable policies or silently migrated.

**Present decorative ground as a physics setting.** Surface colors and textures do not define collision geometry, friction, or deformable material. The four visual floors remain flat appearances; actual uneven terrain needs separately implemented physics and evaluation.

## Acceptance criteria

- The existing GUI offers Micro Duck beside Supply Chain in the center and a session-shared Robot Studio player beside Earth on the right, without replacing the main server or losing Earth overlays.
- A user saves a model-derived target and music recipe, previews it as non-physics motion, starts and stops real local training, reloads immutable artifacts, evaluates the exact export, and plays its frozen project-bound recording.
- Audio/pose tests cover pause, seek, pending resume, early end, hidden views, session switching and disposal; Unicode names survive save/reload, and new drafts cannot relabel or change old recordings.
- Incompatible or unverified policies cannot reach hardware activation through either UI or tool calls.
- Tests cover provider registration/disposal, process failure and cancellation, clip provenance, semantic compatibility, malformed wire inputs, and cross-session ownership.
- A real Loader composition and keyless assembled transcript cover the tool/API workflow; browser coverage checks panel switching, focused controls, reconnect, and explicit unavailable states.
- Build the affected artifacts and verify the existing GUI URL; report simulation learning evidence separately from plumbing tests and any physical trial.

## Delivered scope and deferred work

Robot Studio's built-in UI uses English, including navigation, validation, accessibility labels, tooltips, and safety notices, as explicitly requested for this feature. User-authored names and content keep their original language; this is not a global locale change for other plugins.

The native simulation workflow supports authored project targets, local training, exact-policy reload, recorded 3D playback, evaluation, and explicit cancellation. The viewer uses real recorded poses with pose-based camera framing, directional lighting, and ground shadows. Studio grid, Concrete, Sand, and Grass are purely visual flat floors. Perspective, Front, Side, Top, Reset view, Expand view, canvas-scoped orbit controls, and focused Space playback affect presentation only. Preview standing policy requests a bounded simulation of the shipped `alpha_stand` policy rather than fabricating a pose or starting training.

Advanced custom joint experiments use numeric/JSON authoring without a project or soundtrack binding; copying a saved target into that editor does not modify the saved preview. Motion-block controls explicitly add, select, resize, reorder, duplicate and remove template blocks; they do not provide graphical joint posing. Saved unchanged previews reuse their exact revision, and the frozen player timeline remains independent of later edits.

The integrated center workflow and shared music player require their own rebuilt-browser evidence. Earlier CPU, MLX and renderer checks do not establish that integration or a learned dance. Verification must distinguish source regressions, confined Metal training/export/reload smoke, and the built browser workflow. The [MLX numerical suite](../../../../packages/robot/robot-lab-microduck/tests/test_mlx_ppo.py) owns normalization and export-parity checks; the [provider integration test](../../../../packages/robot/robot-lab-microduck/tests/provider.e2e.ts) owns real sandboxed execution evidence. A passing CPU smoke or tiny Metal preflight is not proof of MLX end-to-end training, browser rendering, learned choreography, or hardware safety. Numerical changes require rerunning the actual frozen-normalizer comparison and confined smoke before claiming validated export parity.

Simulation and evaluation use the requested control-step horizon without altering training episodes. Trials freeze their assessment horizon independently of Studio recordings; actual recorded timestamps reflect executed steps, not repetition of a shorter recording. Only format-3 run records are executable. Earlier-format files remain untouched and appear under Unsupported run records, with no migration or import. Intact format-3 artifacts remain visible with explicit runtime incompatibility while inference rechecks immutable provenance. Regression tests cover horizon construction, early termination, incompatible history beside valid runs, unchanged artifact bytes, and UI request durations.

The client requires both `remote` and `remote.robotLab` injections. A hook-free wrapper handles missing sessions because session-maybe entries receive no store hooks or actions in that state. The local launcher preserves user-managed additions in `cordis.local.patch.yml`, applied through the CLI overlay option rather than regenerated plugin rows.

The [standalone bootstrap](../../../../run-robot-lab.sh) composes a dedicated base/Web/Robot profile instead of importing the windows-brain configuration. Missing source downloads require explicit permission through its clone option; existing checkouts and personal patches are preserved. CPU Python provisioning uses the local engine's frozen lock without rewriting source requirements. Optional `--setup-mlx` synchronizes frozen, non-editable dependencies into a separate Python 3.12 environment at `DSH_HOME/robot-lab/mlx-venv` and pins MLX 0.31.1. `--mlx-python` or `DSH_MICRODUCK_MLX_PYTHON` reuses an absolute interpreter path without installation; later launches must select it explicitly. MLX setup and reuse are mutually exclusive, selected interpreters must pass real Metal execution, and failures do not fall back to CPU. Explicit profile overrides take precedence. Readiness checks the returned boolean, and optional `--verify` requires fresh CPU-provider evidence so a skipped test cannot report success; it is not an MLX training verification. When the selected port belongs to the same DSH profile, the launcher stops its complete process tree, waits for exit, and restarts it before setup or build work. A different profile or unrelated listener is never signaled and causes launch to fail.

This proposal remains open for warm-start descendants, choreography-specific acceptance, actual uneven-terrain physics, domain-randomized evaluation, cloud training, and verified physical deployment. Those capabilities are not part of the delivered simulation slice.

## Risks

A local Python environment and the external MicroDuck checkouts are prerequisites, not bundled dependencies. CPU throughput and skill learning vary by machine and seed. Official GPU compute and a real robot require configuration not present in a generic installation. Those missing capabilities must stay visibly unavailable rather than reporting synthetic success. Large scene payloads and concurrent viewers require bounded transport; browser rendering must not delay simulation or onboard safety.
