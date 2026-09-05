# @deepseek-ai/dsh-tool-supply-chain

English | [中文](README.zh.md)

The model-facing Consumer of the supply-chain seam: three read-only tools that run a scenario, list what has been run, and read the reports behind a run. The package owns no simulation logic and no I/O — every call goes through `ctx.supplyChain`.

## The tools

- `supply_chain_simulate` — runs one scenario and returns per-item fill rate, demand, backlog, and cost, plus the run id. Starts from a `preset` and applies individual overrides on top.
- `supply_chain_runs` — lists the retained runs, newest last, each with the settings that produced it, so a run id can be recovered before reading a report.
- `supply_chain_report` — reads one of the three reports behind a run: `node` (needs `nodeId` and `item`), `bullwhip` (needs `item`), or `edge`. Omitting `runId` reads the most recent run.

## Numeric bounds live in descriptions

The tool schema DSL carries no `minimum`/`maximum`, so each numeric field's accepted range is appended to its description from `CONFIG_BOUNDS` — the same table the seam validates against. A model that respects the stated range never trips `supply_chain_invalid_config`, and the range cannot drift from the validator because both read one source.

## Why the results are summaries

`supply_chain_simulate` returns service outcomes rather than the run's day-by-day series: a 200-day network is tens of kilobytes of arrays that would dominate the context for a question about fill rate. The full detail stays reachable through `supply_chain_report`, one report at a time.

## Model Experience

### Tool schemas

#### What the model sees

The generated [tool-supply-chain schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-supply-chain). Beyond what the catalog states: every numeric argument's description ends with `Accepted range {min} to {max}.`, and `preset` accepts `baseline`, `demandShock`, `disruption`, `lowCapacity`, or `thinSafetyStock`. `disruptionEdge` is a two-element `[source, target]` lane and takes effect only together with a non-zero `disruptionProbability`.

#### Token effect

Conditional and bounded by the request. A `supply_chain_simulate` result is one row per item plus run-level totals; `supply_chain_runs` is one row per retained run, capped by the seam's `maxRuns`. A `node` or `bullwhip` report returns day-indexed series for the one facility or item named, so its size scales with the run's horizon rather than with the network.

#### KV Cache effect

Append-only: each result is appended to the transcript and no earlier request tokens are rewritten. The three schemas are a stable prefix that changes only when this package's tool definitions change.

## Known Limitations and Deferred Work

- **No run is addressable after a host restart** — run ids come from the seam's in-memory store, so ids the model saw in an earlier session resolve to `supply_chain_unknown_run`.
- **A run cannot be cancelled or polled** — `supply_chain_simulate` blocks for the whole simulation and reports only the final outcome, so a long horizon appears as one slow call with no progress.
- **Reports are read one at a time** — comparing two runs, or one facility across runs, takes a call per report; there is no diff or cross-run query.
- **The disruption lane is not checked against the topology** — `disruptionEdge` is validated for shape (exactly two non-empty ids) but not for existence, so a lane the network does not contain yields a run with no closures rather than an argument error.
