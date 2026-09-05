#!/usr/bin/env python3
"""Bridge between the DSH supply-chain seam and the ISOMORPH demo simulator.

Reads one JSON config document on stdin, runs a single simulation, and writes
one JSON result document on stdout. Nothing else is written to stdout, so the
caller can parse the stream directly; diagnostics go to stderr.

The simulator is imported from the checkout named by ``--simulator-root``, which
must be the ``demo`` directory containing ``simulator/demo_simulator.py``. This
script does not vendor, modify, or depend on the version of that checkout beyond
the ``run_demo_simulation`` entry point and the ``SimResult`` fields it reads.

Protocol
--------
stdin   the DSH ``SimulationConfig``, in DSH camelCase field names.
stdout  ``{"network": ..., "results": ...}`` matching the DSH domain types.
exit 0  success; any other exit code means the JSON on stdout is absent or
        incomplete and stderr carries the reason.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


# DSH config field -> ISOMORPH config key. The simulator applies its own
# defaults for absent keys; the seam always sends every field, so this map is
# exhaustive in both directions.
CONFIG_KEYS: dict[str, str] = {
    "days": "T",
    "items": "n_items",
    "seed": "seed",
    "pipelineMultiplier": "pipeline_mult",
    "phiLow": "phi_lo",
    "phiHigh": "phi_hi",
    "shockCountScale": "shock_count_scale",
    "shockHeightScale": "shock_height_scale",
    "burstRateScale": "burst_rate_scale",
    "burstHeightScale": "burst_height_scale",
    "seasonalScale": "seasonal_scale",
    "baseLambdaLow": "base_lambda_lo",
    "baseLambdaHigh": "base_lambda_hi",
    "capacityScale": "containers_scale",
    "safetyStockScale": "ss_scale",
    "leadTimeScale": "leadtime_scale",
    "disruptionProbability": "disruption_prob",
    "disruptionDuration": "disruption_duration",
}

# Day 0 of every run. The simulator counts whole days from an unspecified
# origin, so the seam pins one origin to make replay timelines comparable.
RUN_START_TIME = "2026-01-01T00:00:00.000Z"


def to_simulator_config(config: dict[str, Any]) -> dict[str, Any]:
    """Translate a DSH config document into the simulator's keyword names."""
    translated = {
        simulator_key: config[dsh_key]
        for dsh_key, simulator_key in CONFIG_KEYS.items()
        if dsh_key in config
    }
    edge = config.get("disruptionEdge")
    translated["disruption_edge"] = None if edge is None else (edge[0], edge[1])
    return translated


def series(values: Any) -> list[float]:
    """Convert one numpy day-series into plain JSON numbers."""
    return [float(value) for value in values]


def main() -> int:
    """Run one simulation and emit its JSON result. Returns the exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--simulator-root",
        required=True,
        help="the ISOMORPH demo directory containing simulator/demo_simulator.py",
    )
    arguments = parser.parse_args()

    root = os.path.abspath(arguments.simulator_root)
    entry = os.path.join(root, "simulator", "demo_simulator.py")
    if not os.path.isfile(entry):
        print(
            f"simulator root {root!r} does not contain simulator/demo_simulator.py",
            file=sys.stderr,
        )
        return 2

    # Prepend so the checkout's own modules win over any same-named installed
    # package; the simulator resolves `simulator.*` relative to this directory.
    sys.path.insert(0, root)
    from simulator.demo_simulator import run_demo_simulation

    config = json.loads(sys.stdin.read())
    result = run_demo_simulation(to_simulator_config(config))

    items = list(result.item_ids)
    holding_cost = float(config.get("holdingCost", 0.0))
    backlog_penalty = float(config.get("backlogPenalty", 0.0))

    nodes = []
    for node_id in result.node_ids:
        latitude, longitude = result.node_coords[node_id]
        nodes.append(
            {
                "id": node_id,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "tier": int(result.tier[node_id]),
                "inventory": [series(result.inventory[node_id][i]) for i in items],
                "backlog": [series(result.backlog[node_id][i]) for i in items],
                "inflow": [series(result.inflow[node_id][i]) for i in items],
                "outflow": [series(result.outflow[node_id][i]) for i in items],
            }
        )

    edges = [
        {
            "source": source,
            "target": target,
            "capacity": float(result.edge_cap[(source, target)]),
            "utilization": series(result.edge_util[(source, target)]),
        }
        for source, target in result.edge_ids
    ]

    shipments = [
        {
            "id": index,
            "item": items.index(record["item"]),
            "units": int(record["units"]),
            "departureDay": int(record["day"]),
            "arrivalDay": int(record["arrival_day"]),
            "pathNodes": list(record["path_nodes"]),
        }
        for index, record in enumerate(result.shipments)
    ]

    disruptions = [
        {
            "startDay": int(record["day"]),
            "durationDays": int(record["duration"]),
            "source": record["edge"][0],
            "target": record["edge"][1],
        }
        for record in result.disruption_log
    ]

    results = []
    for index, item in enumerate(items):
        total_backlog = sum(
            float(result.backlog[node_id][item].sum()) for node_id in result.node_ids
        )
        total_inventory = sum(
            float(result.inventory[node_id][item].sum()) for node_id in result.node_ids
        )
        results.append(
            {
                "item": item,
                "fillRate": float(result.fill_rate[item]),
                "totalDemand": float(result.demand[item].sum()),
                "totalBacklog": total_backlog,
                "totalCost": holding_cost * total_inventory
                + backlog_penalty * total_backlog,
            }
        )

    json.dump(
        {
            "network": {
                "startTime": RUN_START_TIME,
                "days": int(result.T),
                "itemIds": items,
                "nodes": nodes,
                "edges": edges,
                "shipments": shipments,
                "disruptions": disruptions,
            },
            "results": results,
        },
        sys.stdout,
        separators=(",", ":"),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
