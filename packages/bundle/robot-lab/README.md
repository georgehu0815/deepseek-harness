---
description: "Compose MicroDuck Studio services, tools, choreography guidance and native viewers in a DSH profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-robot-lab-bundle

English | [中文](README.zh.md)

## Summary

Opt-in MicroDuck Studio composition over the base and Web bundles. The patch mounts the Robot Lab service, local Python provider, model-facing tools, and native right-column viewer. The [design proposal](../../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.md) records the compatibility and deployment requirements.

## Table of Contents

- [Standalone bootstrap](#standalone-bootstrap)
- [Configuration](#configuration)
- [Choreography skill](#choreography-skill)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="standalone-bootstrap"></a>

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

In the Robot UI, choose a writable workspace and a session, then open **Micro Duck** for **Choose → Customize → Train → Evaluate → Perform**. Each step explains its next action; **Robot Studio** displays target previews and recorded simulations. Direct controls need no model key; configure a model provider separately for chat assistance. The smoke checks provider integration, not a complete browser workflow or learned choreography. Hardware preparation reports blockers and cannot activate hardware.

<a id="configuration"></a>

## Configuration

Append `@deepseek-ai/dsh-robot-lab-bundle` to the selected profile's `dsh.profile.bundles` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`. The profile resolver must be able to resolve this package and its declared dependencies. Rebuild the affected host and client artifacts before restarting the existing Web process; opening another Vite server does not update that application.

Set these environment variables before starting the profile, or override the `robot-lab-microduck` row in the profile patch with explicit `sourceRoot` and `pythonBin` values and `disabled: false`:

| Variable | Value |
|---|---|
| `DSH_MICRODUCK_SOURCE_ROOT` | Absolute MicroDuck Lab checkout containing `microduck_local`, `microduck`, and `microduck_rl` |
| `DSH_MICRODUCK_PYTHON` | Absolute Python executable in the installed MicroDuck Lab environment |
| `DSH_MICRODUCK_MLX_PYTHON` | Optional absolute Python executable for DSH-owned Apple MLX; maps to `mlxPythonBin` (unset by default) |
| `DSH_MICRODUCK_RLX_PYTHON` | Optional absolute Python 3.12 executable for RLX on macOS arm64; maps to `rlxPythonBin` |
| `DSH_MICRODUCK_RLX_SOURCE_ROOT` | Absolute RLX checkout paired with the RLX interpreter; maps to `rlxSourceRoot` |

Without both required source and CPU Python variables, the provider row is disabled and readiness explains that no provider is configured. Installation paths are not inferred from the DSH checkout. Provider limits and project-storage settings belong to the provider's configuration, not to this composition carrier. Training outputs must not be committed to the source repository.

Set both RLX variables or neither; the provider rejects partial RLX configuration. `rlx` selects the installed RLX learner independently of the DSH-owned `mlx` backend. RLX requires explicit dependency setup and working Metal; the MLX setup option does not install RLX. Provider patch configuration also accepts `rlxPpo` to set numerical training inputs. The [provider README](../../robot/robot-lab-microduck/README.md) owns those settings, artifact requirements and bounded RLX verification. The launcher's CPU verification does not qualify RLX.

<a id="choreography-skill"></a>

## Choreography skill

The bundle publishes [microduck-choreography](skills/microduck-choreography/SKILL.md) for Clip Gen **Sequence By AI** and explicit manual clip authoring. The current session loads the skill, plans a localized timed guide, and returns one model-bound JSON envelope; it does not delegate, train, simulate, or activate hardware. The request supplies the installed model metadata and selected tempo. The health-dance example is optional, not a fixed duration or model definition.

The `robot-lab-choreography-skills` row mounts the standard [filesystem provider](../../skill/skill-filesystem/README.md) with `providerName: robot-lab-choreography`, `includeDefaultRoots: false`, and an absolute `bundledSkillDir`. The bundle's `resolveChoreographySkillDir()` derives the directory from its own module URL; the patch calls that export through Node's `createRequire(ctx.baseUrl)`. This retains the asset root through an ESM module proxy without relying on exported package metadata or the session's working directory. The base provider and project/user overrides remain available. Custom profiles can replace this row's complete configuration to select another absolute root.

The package's `skills/` directory is the only instruction source. The checkout's `.agents/skills/microduck-choreography` is a directory symlink to that source, so checkout sessions can discover it before the bundle is activated; it is not required by installed profiles. Rebuild the bundle's host artifact before loading its patch. The [focused tests](tests/choreography-skill.spec.ts) verify directory-alias discovery and Loader registration from installed and proxy packages; they do not qualify physical motion or a complete packaged executable.

<a id="model-experience"></a>

## Model Experience

### Mounted tools

#### What the model sees

The mounted skill provider makes `microduck-choreography` available through the skill catalog and loader. Its tool package owns the `robot_lab` schema and results; provider unavailability remains an explicit diagnostic rather than a synthetic training result.

#### Token effect

The mounted tools contribute their schemas and logged results. Skill discovery contributes a catalog summary; loading the choreography skill adds its instructions to retained tool history.

#### KV Cache effect

Changing the mounted tool set can change the request prefix. The bundle does not modify existing messages or issue model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Python environment and MicroDuck checkouts must be installed separately; this bundle does not download models or install Python dependencies at boot.
- Local clip policies use Lab-specific phase semantics and are simulation-only. Apple MLX requires explicit configuration and working Metal; enabling the bundle alone does not enable GPU training. Physical installation and activation remain unavailable.
- Host composition changes require restarting the existing Web process. Client hot reload requires an active rebuild watcher that includes the new package.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published because this bundle owns composition rows, not running experiments or independent mutable state.

</details>
