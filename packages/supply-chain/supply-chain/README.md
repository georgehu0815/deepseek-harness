# @deepseek-ai/dsh-supply-chain

English | [中文](README.zh.md)

The supply-chain capability seam: a Service Definition (`ctx.supplyChain`) that runs multi-echelon shipping scenarios, retains their results, and derives the three reports the tools and the browser panel read. It owns no simulation model of its own — a Service Provider supplies that.

## What it does

`ctx.supplyChain` resolves a scenario request into a complete `SimulationConfig`, hands it to the registered provider, retains the finished run, and answers report queries over it. `registerProvider(provider)` installs the active simulator and returns a disposer; with none installed, `simulate` throws `supply_chain_simulator_unavailable`.

Scenario defaults live in [src/config.ts](src/config.ts): `DEFAULT_SIMULATION_CONFIG`, the five presets (`baseline`, `demandShock`, `disruption`, `lowCapacity`, `thinSafetyStock`), and `CONFIG_BOUNDS`, the per-field accepted range every caller is validated against. `resolveConfig` is the explicit defaulting step — a request becomes a complete config there, never through a hidden fallback inside a provider.

Reports are pure functions over a finished run, in [src/reports.ts](src/reports.ts), so the same code serves the host tools and the browser bundle:

- **node** — one facility's inventory, backlog, inflow, and outflow by day.
- **bullwhip** — order-variance amplification per echelon, the ratio of received-series variance to shipped-series variance (sample variance, `ddof=1`). Above 1 means that echelon enlarges the demand swing it passes upstream.
- **edge** — every lane ranked by mean and peak utilization, with the count of days at or above capacity.

## Retention

Runs are held in memory in insertion order and evicted oldest-first once `maxRuns` is exceeded. `simulate` emits `supply-chain/run` only after the run is committed to that store, so no listener can observe a run the service cannot then serve.

## Configuration

- `maxRuns` (default `8`) — how many finished runs stay resident before the oldest is evicted.

## Browser access

The class extends `TypertRemoteService`, so the panel reaches it through generated Typert Remotes rather than a session projection: `simulate` (preset name plus overrides, resolved host-side), `run` (one retained run by id), and `catalog` (retained run ids, the newest id, and every preset with its fully resolved config). The catalog resolves presets on the host so the browser never carries a second copy of the defaults.

## Export shape

Default-exports the `SupplyChainRuntime` service class and merges `ctx.supplyChain` into the cordis `Context`. `./types` carries the domain types, `./config` the presets and bounds, and `./reports` the report builders; `./client` and `./remote` serve the browser half.

## Model Experience

### Capability seam (no direct model surface)

#### What the model sees

Nothing directly. This package registers no tool and contributes no prompt text. The model reaches it through `@deepseek-ai/dsh-tool-supply-chain`, whose schemas and results are documented there.

#### Token effect

None from this package alone.

#### KV Cache effect

None from this package alone; the consuming tools own their prefix effects.

## Known Limitations and Deferred Work

- **Runs are in-memory only** — nothing is persisted, so a host restart loses every retained run and the browser panel starts empty. A run is also unreachable once `maxRuns` evicts it, and `getRun` then throws `supply_chain_unknown_run`.
- **Runs are absent from the session log** — the panel reads them over request/response Remotes, so a scenario a user ran is not part of session history and is not reconstructable from the log. Only what a tool call returns reaches the model and the transcript.
- **No provider ships active** — the base bundle carries `@deepseek-ai/dsh-supply-chain-isomorph` disabled, so an unconfigured deployment answers `supply_chain_simulator_unavailable` until an overlay enables a provider.
- **Report kinds are fixed** — `node`, `bullwhip`, and `edge` are the complete set; a new view requires a new builder here rather than a provider-supplied figure.
