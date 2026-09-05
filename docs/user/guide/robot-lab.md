# MicroDuck Studio user guide

English | [中文](robot-lab.zh.md)

Use the **Micro Duck** center tab to choose an experimental motion, customize a saved project and local soundtrack, train a policy, then inspect its recorded performance in **Robot Studio** on the right. This guide takes you from setup through **Choose → Customize → Train → Evaluate → Perform**. Built-in controls use English; your names and content retain their original language.

**This is a simulation platform.** A **Target preview · Not physics-tested** shows desired motion through forward kinematics. A **Recorded simulation · Not live hardware** shows an exported policy acting in physics. Neither a preview nor a completed training run proves a learned dance. Passing an evaluation does not approve hardware activation, which remains unavailable.

## 1. Prepare your computer

You need a DSH checkout containing [run-robot-lab.sh](../../../run-robot-lab.sh), a terminal, and a browser with WebGL support.

| Requirement | Supported setup |
|---|---|
| Operating system | Apple Silicon macOS, or Linux x86_64/aarch64 |
| Node.js | 22.19+ within 22.x, or 24+ |
| Node package manager | pnpm |
| Source downloads | Git |
| Python setup | uv, unless reusing an installed Lab Python environment |
| Python runtime | 3.12; the launcher can provision it through uv |

Install missing prerequisites using the [Node.js](https://nodejs.org/en/download), [pnpm](https://pnpm.io/installation), [Git](https://git-scm.com/downloads), and [uv](https://docs.astral.sh/uv/getting-started/installation/) instructions. Intel macOS is not supported by the locked Torch dependency. Direct Robot controls and local music generation require no model or music-provider key. Chat uses your configured model provider; an existing AgencyCopilot sign-in does not need an additional LLM key. Separate web-search availability is not a Robot Lab prerequisite.

Allow disk space and time for Python wheels, Node dependencies, and the first build. The frozen Python lock uses upstream-selected mirrors. On Linux x86_64 it can download large CUDA dependencies even though physics and the standard learner use CPU; this does not enable GPU physics.

## 2. Start Robot Lab

Run the following from the DSH checkout:

```sh
./run-robot-lab.sh --clone-source --verify
```

The launcher clones missing MicroDuck sources, reuses or creates the Python environment, installs locked Node dependencies, builds the UI/backend, checks MuJoCo readiness, and runs a short real training/export/reload/evaluation integration test. It then starts a dedicated `robot-lab` profile at **http://127.0.0.1:3082**. Open that URL yourself and keep the terminal running.

Existing source checkouts and profile patches are preserved. The script does not stop other servers. If the port is occupied, choose another one:

```sh
./run-robot-lab.sh --no-build --port 3083
```

Use `--no-build` only after a successful build. After changing or updating DSH code, rebuild and refresh the intended page. A different port opens a separate server; it does not update an already-running GUI on port 3081.

### Reuse your installation

Pass the Lab root, not its `microduck_local` subdirectory, and the Python executable inside the installed environment:

```sh
./run-robot-lab.sh \
  --source /path/to/microduck-lab \
  --python /path/to/microduck-lab/microduck_local/.venv/bin/python \
  --verify
```

Without these options, the source defaults to the sibling `../microduck-lab` checkout; the launcher also accepts `DSH_MICRODUCK_SOURCE_ROOT` and `DSH_MICRODUCK_PYTHON`. It reuses the Lab's existing `.venv` when available, otherwise uses a managed environment under `DSH_HOME/robot-lab/venv`. `DSH_HOME` defaults to `~/.dsh`. `--setup-python` explicitly synchronizes the managed environment and cannot be combined with an explicit Python selection.

### Optional Apple MLX setup

On Apple Silicon macOS, explicitly create a separate Python 3.12 environment with the Lab's frozen dependencies and MLX 0.31.1:

```sh
./run-robot-lab.sh --setup-mlx
```

This uses `DSH_HOME/robot-lab/mlx-venv`, not the CPU environment or Lab's `.venv`. To reuse that environment on subsequent launches, or another compatible installation, pass an absolute interpreter path:

```sh
./run-robot-lab.sh --no-build --mlx-python "${DSH_HOME:-$HOME/.dsh}/robot-lab/mlx-venv/bin/python"
```

Alternatively, export `DSH_MICRODUCK_MLX_PYTHON` before launching. Reuse does not install packages into the selected environment and cannot be combined with `--setup-mlx`. The launcher checks Python 3.12, MLX 0.31.1, native Apple Silicon support, and a tiny real Metal operation; failure stops startup without CPU fallback. MLX is not enabled automatically just because its environment exists. Explicit profile overrides take precedence and remain unchanged.

### Understand the startup check

`--verify` checks the real DSH provider and sandbox with a small **CPU** training run, even when MLX is configured. It is an installation test, not a GPU-training test, browser test, or proof that a dance was learned. The Metal preflight also does not prove end-to-end MLX training. The terminal prints a fresh evidence path under `DSH_HOME/robot-lab/verification.*/host-provider.json`. Its temporary policy is not added to your UI policy library.

For later launches, omit the integration test:

```sh
./run-robot-lab.sh --no-build
```

To check the installed stack without starting a server:

```sh
./run-robot-lab.sh --no-build --verify --setup-only
```

## 3. Choose a target

1. Open the launcher's URL and use **Choose workspace** to select a writable experiment directory.
2. Create or select a session, then select **Micro Duck** beside **Supply Chain** in the center tabs.
3. Wait for **Local robot lab connected**; use **Check connection** if needed.
4. In **Choose**, select a template. **Open Studio ↗**, or the sidebar's **Robot Studio** duck icon, opens the right player. If Earth is selected there, choose **MicroDuck**.

The nine original templates are Head Bob, Disco Groove, Side Sway, Robot Pop, Tiny March, Celebration Mix, Stand Steady, Say Hello and Look Around. Each is an **Experimental target**, not a pre-trained skill. Targets use the actual installed MicroDuck model's fourteen joints, default pose and joint limits. Only installed robot adapters are listed; another robot needs a compatible model and controller, not merely a replacement mesh.

The empty player also offers **Preview standing policy** for a bounded, zero-command simulation of the shipped `alpha_stand` policy. This is recorded physics, not fabricated standing animation or a training run. You do not need the upstream `duck-lab` server or its separate viewer.

Before training, fill in the learning brief: your goal, prediction, planned change, and evidence you plan to examine. For example, predict that a smaller movement will reduce falls, change only move size, and compare termination counts and upright fraction under the same assessment settings. The evidence field is a plan, not a result. Start with small movements and short routines; target labels do not promise learned skills.

## 4. Customize and save

A **reference motion** specifies desired joint positions. A **policy** is a trained controller acting in simulation. Changing a reference does not itself train a policy or test balance.

1. In **Customize**, enter a **Project name**.
2. Start with a small **Move size**. Set **Tempo (BPM)** and **Length**; the displayed beat count determines duration together with BPM.
3. Choose Disco, Electronic, Lo-fi or Chiptune under **Music style**. **Try another variation** changes the seed, not the tempo.
4. Click **Generate music (WAV)** to download original locally synthesized percussion, bass and melody. This action does not autoplay.
5. Click **Save revision**, or **Preview target in Studio**. Preview reuses the exact saved revision when unchanged; an edited draft is saved first.
6. In the right player, confirm **Target preview · Not physics-tested**, then press **Play with soundtrack**.

Music and movement share BPM and beat count. Music needs no account, key, voices or commercial recordings. DSH saves the versioned recipe, not audio bytes; the browser generates PCM and downloadable WAV locally. The displayed timeline represents authored motion and beats, not evidence of learned execution.

Saving checks targets against model joint limits, but not balance or dynamical feasibility. The preview uses real MuJoCo forward kinematics without a learned policy or physics rollout. Inspect generated joint targets when you need the exact reference. Tempo or motion edits require a new saved revision and a new training run; they cannot retime an old recording. Unsaved drafts are not durable—save before refreshing.

### Compose several motion blocks

In **Customize → Motion blocks**, click **Arrange motion blocks** to turn the selected template into the first block. Use **Add motion block**, then set each block's **Move**, **Length** and **Relative move size**. Reorder with **Earlier** or **Later**, copy with **Duplicate**, or remove a block with **Remove**. At least one block must remain, and the catalog limits total blocks, time and compiled keys.

All blocks share the routine's BPM. Their lengths determine total motion and music beats. **Master move size** multiplies each block's relative size, so reducing it scales the whole routine. **Use one repeated move** returns to a single-template draft. Save and preview after editing; arranging targets does not test balance or transitions in physics.

The timeline shows the draft block order. During playback of its exact saved revision, the highlight follows the frozen block and beat at the current recording time. A later draft cannot change an already loaded recording's timeline or soundtrack.

## 5. Train the saved project

Open **Train** after saving the current draft. A project-bound run retains that exact revision, compiled motion and soundtrack. Training defaults use the saved whole-composition recommendation and its reward overrides, not just the first block's template.

| Field | First-run choice | Meaning |
|---|---|---|
| Training backend | `CPU — Standard` | SB3 PPO learning and MuJoCo/BAM physics on CPU |
| Practice budget | `Quick check — setup only` | Default 1,024-step setup check, not a learned-skill target |
| Parallel environments | `2` | Advanced setting: number of training environments |
| Random seed | `0` | Advanced setting: recorded seed for comparisons |

Optional **MLX GPU — Apple Silicon** performs policy and critic learning on Metal while MuJoCo/BAM physics stays on CPU. Its separate PPO recipe has no symmetry loss and is not numerically equivalent to CPU training. Small runs may be slower; no speedup is promised. Unavailable MLX reports its reason without CPU fallback. Neither backend grants hardware approval.

Review the saved target, learning brief and evaluation recipe before starting. The recipe fixes episode count, requested horizon, seed, allowed terminations and required mean upright fraction; its horizon is independent of Perform's simulation duration. Use **Save trial** to commit the plan without training, then **Start saved trial**, or use **Save and start trial** to save it before starting in one action. The saved trial is immutable and can start only one run; changing the plan requires a new trial. Wait for `completed` before choosing **Evaluate this policy**; training completion is not goal achievement. The states `failed`, `stopped` and `interrupted` do not mean an export completed. **Stop training** cancels an active run in this session. Closing the panel or changing sessions does not stop server-owned training; return to the original session to monitor or stop it. Stop explicitly before shutting down the server; interrupted runs do not automatically resume.

A short check may learn little or perform poorly. For a longer experiment, select the practice budget or increase **Training steps** in advanced settings within backend limits. Keep the project and seed fixed when comparing budgets. Larger budgets do not guarantee a learned dance; new runs are not warm-start continuations.

### Optional: custom joint experiment

In **Train**, expand **Advanced: custom joint experiment** and enable **Use a custom joint clip for training**. Enter a **Custom experiment ID**, choose a registered **Custom reward recipe**, and use **Copy saved target into editor** or provide **Custom clip JSON**. Valid JSON exposes numeric keyframe controls in radians. Use **Start custom experiment** after checking the settings; the backend checks actual model joint limits at admission.

This is an unlinked experiment, not a pre-registered learning trial: edits freeze in its run, not in your saved project or template preview, and its recording has no beat-linked project soundtrack. Keep the custom ID to letters, digits, spaces, `_`, `-` and `.`, beginning with a letter or digit; project display names separately support Unicode. Numeric editing does not validate balance or create a graphical pose rig. Disable the custom-clip option to return to project-bound training.

## 6. Evaluate, observe and improve

1. Open **Evaluate** after training and select the trial and exact exported policy. This phase is independent of Perform; you do not need to generate a performance first.
2. Click **Evaluate trial** to use its saved recipe. Check the report's policy identity and SHA-256 against your selection. A report for another export is not evidence for this policy.
3. Inspect report history and episode results: criteria, requested horizon, seeds, actual steps, termination counts, upright fraction and available joint tracking error. Incomplete attempts are counted separately, not shown as successful reports.
4. Select an episode to generate a new re-simulation in Robot Studio. It uses the saved report's seed and requested horizon, not current draft settings or the episode's shorter actual length. This is a **new re-simulation**, not the original evaluation recording. It is available only for policies from completed runs in this session; runtime incompatibility still blocks execution.
5. Compare a baseline report if available. A like-for-like assessment requires matching settings, observation semantics, frozen physics and loaded execution-runtime provenance; objectives, targets, budgets, learners and seeds remain visible differences. Several changed variables cannot establish a controlled single-variable comparison or an automatic winner.
6. Enter **Observation**, **Interpretation** and **Next change**, then click **Save reflection**. It requires a report matching the trial's frozen assessment and binds to that actual report and trial, not whichever policy you select later. Click **Review improvement draft** on a saved reflection and review the new plan. The draft is **not saved** until you save a new trial with its parent reflection; it starts a new run, not checkpoint continuation.

Passing upright/termination criteria does not establish complete choreography, robustness, a correct inverted trick or hardware safety. A failed short-run assessment can be useful evidence of an undertrained policy. Do not relax criteria solely to obtain a pass label. You can reflect and improve directly after failure without visiting Perform. Exploratory evaluations with different criteria do not replace the trial's frozen assessment.

## 7. Perform and inspect

1. Open **Perform** and choose a **Trained policy**. Failed or unassessed policies remain available for simulation inspection with their status visible.
2. Note its **SHA-256** hash, which identifies exact exported bytes, not a safety certificate.
3. Choose **Simulation duration**. A project-bound policy initially uses its saved target duration; an explicit selection overrides it. A 20-second request allows 1,000 real control steps, but a fall may end it early.
4. Click **Generate learned performance**, then press **Play with soundtrack** or **Play recording** in Robot Studio after the recording loads.
5. Check the actual recorded duration and any early-ending notice. The button name does not establish successful learning; inspect what the policy actually does.

The soundtrack and project label come from the selected run's frozen project, never a later draft. Shipped or unlinked policies have no project soundtrack. Model-tool simulations do not automatically load a recording into the browser player.

**Pause** stops sound and pose together. **Performance time** seeks both; **Restart** returns to the beginning and plays. Playback is never automatic or looping. **Replay speed** offers 0.5×, 1×, 1.5× and 2×, remembered for this session. It changes sound and pose together; audio pitch and tempo change rather than preserving pitch. Your saved routine, training and downloaded WAV stay unchanged. Changing speed during audio startup cancels that pending start and leaves playback paused. It holds the last pose and stops sound at the actual end, including early termination. Hiding the player or browser tab, or switching sessions, pauses playback. Audio startup failure remains visible and paused; choose **Play without music** explicitly if desired. **Mute** changes volume without stopping time.

Use **Camera** presets, **Reset view**, **Expand view**, canvas dragging and scrolling to inspect the scene. Focus the viewer before pressing **Space** to play or pause; it does not capture form-field typing. **Visual surface** offers Studio grid, Concrete, Sand and Grass; all are flat appearances, not physics, friction, deformable ground or terrain tests.

Click a robot part to inspect its world position, or open **Motion details** and select a joint. Recorded physics reports actual joint angle and velocity, controller target, actuator torque and body tilt; the speed indicator measures root travel speed. Target previews label values as kinematic targets, not measured physics. Foot contacts are not recorded. **Routine tempo** shows saved BPM. **Body speed** is measured in recorded time, so replay speed does not multiply it. Average training steps/second measures training throughput, not movement speed. The current block indicator follows the recording's saved block sequence.

## 8. Save your work and return later

Durable projects and experiments default to `.microduck-studio/<session-hash>/` in the selected workspace. Saved project revisions retain recipes, model/template data, targets and hashes. Project-bound runs freeze their project and music alongside seed, training recipe, provenance and exported artifacts. Evaluations retain their requests and reports. Version-1 learning trials, run bindings and reflections preserve your plan and evidence lineage separately from project/run records. Reloading committed records does not restart training; improvement drafts remain unsaved until explicitly committed as a new trial. Administrators can change the storage directory.

Projects use format 2 with frozen blocks and a whole-routine training recommendation; template, clip and music versions remain 1, and experiment runs remain format 3. Old project formats are rejected without automatic conversion. Preserve them rather than editing their version or hashes.

Return to the **same workspace and original session**. Use **Refresh library** to reload saved records without refreshing the browser page. In **Choose**, use **Continue a saved project** to load a revision; use **Perform** to select a policy. Another session has its own records, even within the same workspace. Loading or editing a saved project creates a draft; a new save creates a separate immutable revision rather than overwriting its source.

Only run format 3 is executable. Older files remain untouched under **Unsupported run records**, with no automatic migration, import or warm-start path. Intact format-3 policies whose runtime differs from the current runtime remain inspectable with an incompatibility reason, but cannot simulate or evaluate. An old evaluation does not override that check.

Back up the entire experiment directory and corresponding session data, not just an ONNX file. Preserve source revisions and Python environments: source, dependency or BAM parameter changes can invalidate execution of a frozen run. Do not edit hashes or provenance to bypass the check. Download WAV again from its recipe if needed; DSH does not retain generated audio bytes.

## 9. Understand deployment limits

In **Perform**, expand **Hardware deployment remains blocked** and use **Show deployment blockers**.

Local custom-clip policies use phase fields incompatible with the inspected physical robot runtime. Local policies also lack required target validation and supervised physical trials. **Activate hardware (unavailable)** is intentionally disabled. Successful export or simulation evaluation does not enable it; this guide contains no hardware activation procedure.

## Troubleshooting

| Symptom | Action |
|---|---|
| Launcher reports a missing source or asset | Check `--source`; use `--clone-source` for missing checkouts. Existing incomplete directories are not overwritten automatically. |
| Python setup or readiness fails | Confirm Python 3.12 and inspect the error. Check mirror access for frozen uv installation, or provide a working `--python`. Do not replace the lock with arbitrary upgrades. |
| Build fails or the panel is missing | Resolve build errors, rebuild without `--no-build`, and refresh the launcher's exact URL. Look for Micro Duck in the center and MicroDuck in the right visual workspace. |
| Port is occupied | Reuse the intended server or choose another port; the launcher never kills the owner. |
| Trial save or start is disabled | Save the current project draft; complete all four brief fields; check assessment criteria, session/workspace, backend readiness, numeric settings, validation errors and whether a run is active. |
| Sandbox or read-only error | Select an authorized writable workspace and ask the administrator to check confinement. Do not disable the sandbox to force training. |
| Viewer is empty | Preview a saved target or generate a policy recording. Check WebGL support if a renderer error appears. |
| Audio will not start | Press Play from a direct gesture, inspect the error, or explicitly choose Play without music. Download WAV if browser audio is unavailable. |
| Music exceeds limits | Shorten the beat count or ask the administrator to review synthesis duration/sample limits. Raising the sample rate also increases required samples. |
| MLX GPU is unavailable | Check Apple Silicon macOS, Python 3.12, MLX 0.31.1 and Metal diagnostics. Later launches still need `--mlx-python` or its environment variable. |
| Policy or project disappears after a session switch | Return to its original session and workspace. |
| Unsupported format or hash/provenance mismatch | Preserve the original files; restore the original runtime or train a new experiment. Never rewrite recorded evidence. |
| Evaluation fails | Inspect criteria, recording, reference and training budget. Failure may accurately describe an undertrained policy. |

Run `./run-robot-lab.sh --help` for launcher options. The [bundle configuration reference](../../../packages/bundle/robot-lab/README.md) covers profile composition, and the [provider reference](../../../packages/robot/robot-lab-microduck/README.md) covers execution and storage constraints. For chat configuration, see [Configure models](./providers.md).
