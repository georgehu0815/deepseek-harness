# @deepseek-ai/dsh-robot-lab-bundle

English | [中文](README.zh.md)

Opt-in MicroDuck Studio composition over the base and Web bundles. The patch mounts the Robot Lab service, local Python provider, model-facing tools, and native right-column viewer. The [design proposal](../../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.md) records the compatibility and deployment requirements.

## Standalone bootstrap

From a DSH checkout, use [run-robot-lab.sh](../../../run-robot-lab.sh). Install Node 22.19+ within 22.x or Node 24+, pnpm, Git, and uv first. The launcher supports Apple Silicon macOS and Linux x86_64/aarch64; Intel macOS is not supported by the upstream Torch lock.

```sh
./run-robot-lab.sh --clone-source --verify
./run-robot-lab.sh --no-build
./run-robot-lab.sh --no-build --verify --setup-only
```

The first command clones missing source checkouts, installs locked dependencies, builds the native UI/backend, checks MuJoCo readiness, performs a real CPU integration smoke, and serves `http://127.0.0.1:3082`. It creates a dedicated `robot-lab` profile under `DSH_HOME` (default `~/.dsh`), preserves existing patches, and refuses an unrelated profile or occupied port. It never stops another server. `--setup-only` performs the selected checks without starting a server; `--verify` is optional and tests the actual DSH provider and sandbox, not browser rendering. Each verification saves a fresh report under `DSH_HOME/robot-lab/verification.*/host-provider.json`; its temporary policy artifacts are test-owned, not added to the UI policy library.

Use `--source /path/to/microduck-lab` and `--python /path/to/python` to reuse an installation. Without explicit Python, the launcher reuses the Lab's existing `.venv`, or provisions an external Python 3.12 environment under `DSH_HOME/robot-lab/venv`; `--setup-python` explicitly selects frozen synchronization of that managed environment. It does not install the GPU-oriented `microduck_rl` environment or modify existing source checkouts. Fresh clones use upstream default branches, not pinned commits; record and retain the printed source revisions for reproducibility. The frozen lock uses upstream-selected mirrors and may download large CUDA dependencies on Linux x86_64 despite CPU-only training. See `--help` for all options.

On Apple Silicon macOS, `--setup-mlx` explicitly synchronizes the Lab's frozen dependencies with `--no-editable` into a separate Python 3.12 environment at `DSH_HOME/robot-lab/mlx-venv`, then installs `mlx==0.31.1` there. It leaves the CPU environment and Lab's `.venv` unchanged. Alternatively, `--mlx-python /absolute/path/to/python` or `DSH_MICRODUCK_MLX_PYTHON` reuses an installed Python 3.12 environment with MLX 0.31.1 without installing anything into it; either conflicts with `--setup-mlx`. Selected interpreters must execute a tiny operation on Metal; an invalid interpreter, unavailable Metal, or failed operation stops the launcher without CPU fallback. An existing MLX environment is not selected automatically: repeat the reuse option or export the variable on subsequent launches. Explicit profile overrides take precedence and are never rewritten.

MLX training uses a separate PPO recipe with policy computation on Apple GPU and MuJoCo physics on CPU, not full-GPU simulation. No speedup is guaranteed. CPU remains the default and needs no MLX installation. `--verify` still runs the real CPU integration smoke; neither that report nor the Metal preflight proves MLX end-to-end training.

In the English-only Robot UI, choose a writable workspace and a session, open **Robot Studio**, author a motion in **Teach**, start or stop training in **Train**, load a policy in **Policies**, and run evaluation in **Test**. Direct controls need no model key; configure a model provider separately for chat assistance. A successful smoke confirms the workflow, not learned choreography. **Deploy** reports blockers and cannot activate hardware.

## Configuration

Append `@deepseek-ai/dsh-robot-lab-bundle` to the selected profile's `dsh.profile.bundles` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`. The profile resolver must be able to resolve this package and its declared dependencies. Rebuild the affected host and client artifacts before restarting the existing Web process; opening another Vite server does not update that application.

Set these environment variables before starting the profile, or override the `robot-lab-microduck` row in the profile patch with explicit `sourceRoot` and `pythonBin` values and `disabled: false`:

| Variable | Value |
|---|---|
| `DSH_MICRODUCK_SOURCE_ROOT` | Absolute MicroDuck Lab checkout containing `microduck_local`, `microduck`, and `microduck_rl` |
| `DSH_MICRODUCK_PYTHON` | Absolute Python executable in the installed MicroDuck Lab environment |
| `DSH_MICRODUCK_MLX_PYTHON` | Optional absolute Python executable for Apple MLX; maps to `mlxPythonBin` (unset by default) |

Without both required source and CPU Python variables, the provider row is disabled and readiness explains that no provider is configured. Installation paths are not inferred from the DSH checkout. Provider limits and project-storage settings belong to the provider's configuration, not to this composition carrier. Training outputs must not be committed to the source repository.

## Model Experience

### Mounted tools

#### What the model sees

This bundle adds no prompt or tool definition itself. Its tool package owns the `robot_lab` schema and results; provider unavailability remains an explicit diagnostic rather than a synthetic training result.

#### Token effect

The mounted tools contribute their schemas and logged results. This carrier contributes no additional context.

#### KV Cache effect

Changing the mounted tool set can change the request prefix. The bundle does not modify existing messages or issue model requests.

## Known Limitations and Deferred Work

- The Python environment and MicroDuck checkouts must be installed separately; this bundle does not download models or install Python dependencies at boot.
- Local clip policies use Lab-specific phase semantics and are simulation-only. Apple MLX requires explicit configuration and working Metal; enabling the bundle alone does not enable GPU training. Physical installation and activation remain unavailable.
- Host composition changes require restarting the existing Web process. Client hot reload requires an active rebuild watcher that includes the new package.
