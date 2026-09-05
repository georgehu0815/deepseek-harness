# Robot experiments

English | [中文](README.zh.md)

Session-owned robot policy experiments. This group owns the backend; the [MicroDuck Studio bundle](../bundle/robot-lab/README.md) composes it with the [native viewer](../client/ui-robot-lab/README.md).

| Package | Role | Context key |
|---|---|---|
| [`robot-lab`](robot-lab/README.md) | Service Definition, operation types and generated browser Remote | `robotLab` |
| [`robot-lab-microduck`](robot-lab-microduck/README.md) | Installed MicroDuck Lab Python provider; bounded CPU processes and artifacts | Provider registration |
| [`tool-robot-lab`](tool-robot-lab/README.md) | Logged model-facing operations with bounded result summaries | Tool registration |

The tools and viewer use the same session-owned operations. Physics, training and artifact storage belong to the provider, not the browser or agent loop. Local policy evaluation does not authorize hardware activation; Lab-specific phase observations require a separate compatible deployment implementation.
