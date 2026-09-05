# @deepseek-ai/dsh-supply-chain-isomorph

English | [中文](README.zh.md)

The supply-chain Service Provider: it runs the real ISOMORPH demand simulator in a one-shot Python subprocess and returns the result to `ctx.supplyChain`. The simulation model stays in Python; this package is the process boundary and the payload translation across it.

## What it does

`apply` registers a provider on `ctx.supplyChain`. Each `simulate` call spawns `pythonBin` on [python/isomorph_bridge.py](python/isomorph_bridge.py) with `--simulator-root`, writes the resolved `SimulationConfig` to its stdin as JSON, and reads one JSON document from stdout. The bridge translates DSH camelCase into the simulator's snake_case parameters, calls `run_demo_simulation`, and emits the network and the per-item results. Nothing persists between calls: one run is one process.

The topology is the simulator's own — 13 facilities across tiers 0 to 6, with `NewYork` (tier 0) as the demand destination and the tier-6 sources upstream.

## Configuration

`pythonBin` and `simulatorRoot` are required, so a misconfigured row fails at load rather than at the first simulation.

- `pythonBin` — interpreter that can import the simulator package. No value is defaulted: the correct interpreter is deployment-specific and a wrong guess fails deep inside the subprocess.
- `simulatorRoot` — the ISOMORPH demo checkout containing `simulator/demo_simulator.py`; also the subprocess working directory.
- `timeoutMs` (default `120000`) — deadline for one run.
- `maxOutputBytes` (default `67108864`) — cap on the stdout document.

## Dormant by default

The row ships `disabled: true` in [packages/bundle/base/cordis.patch.yml](../../bundle/base/cordis.patch.yml) because it requires a local Python checkout that no default install provides. Enabling it means clearing `disabled` and supplying both paths from an overlay. [restart-supply-chain.sh](../../../restart-supply-chain.sh) rebuilds every layer and boots a dedicated `supply-chain` profile whose patch layer does exactly that, keeping machine-specific paths out of the repository.

## Failure reporting

A spawn failure, a non-zero exit, a timeout, an output-cap breach, or unparsable stdout all surface as `supply_chain_simulator_failed` carrying the subprocess stderr, so a missing dependency or an unmounted checkout is legible from the tool result.

## Model Experience

### Service Provider (no direct model surface)

#### What the model sees

Nothing directly. This package computes run results behind `ctx.supplyChain` and registers no tool, prompt, or schema. The model reaches its output through `@deepseek-ai/dsh-tool-supply-chain`. Its one model-visible contribution is a failure message: a subprocess that cannot start or exits non-zero becomes the `supply_chain_simulator_failed` text carried in that tool's error result.

#### Token effect

None from this package alone, beyond the failure text a failed run contributes to the calling tool's result.

#### KV Cache effect

None from this package alone; the consuming tools own their prefix effects.

## Known Limitations and Deferred Work

- **Cannot run in CI or any default install** — the provider needs a real local ISOMORPH checkout and a Python interpreter with its dependencies. The integration tests self-skip unless `DSH_ISOMORPH_ROOT` and `DSH_ISOMORPH_PYTHON` point at both, so the engine path is exercised only on a developer machine.
- **One process per run** — there is no warm worker or batching, so process start and simulator import are paid on every call. A long horizon with several items is seconds, not milliseconds.
- **The whole result crosses at once** — the run is one JSON document on stdout, bounded only by `maxOutputBytes`; there is no streaming or per-day progress, so a panel cannot show partial results while a run is in flight.
- **Topology and echelon roles are the simulator's** — facilities, lanes, and tiers are fixed by the Python model and are not configurable from cordis.yml.
