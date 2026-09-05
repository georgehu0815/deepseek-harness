# 机器人实验

[English](README.md) | 中文

会话所有的机器人策略实验。本组负责后端；[MicroDuck Studio 组合包](../bundle/robot-lab/README.zh.md)将其与[原生查看器](../client/ui-robot-lab/README.zh.md)组合。

| 包 | 角色 | Context 键 |
|---|---|---|
| [`robot-lab`](robot-lab/README.zh.md) | Service Definition、操作类型及生成的浏览器 Remote | `robotLab` |
| [`robot-lab-microduck`](robot-lab-microduck/README.zh.md) | 已安装 MicroDuck Lab 的 Python 提供方；有界 CPU 进程及产物 | 提供方注册 |
| [`tool-robot-lab`](tool-robot-lab/README.zh.md) | 记录到日志的模型操作及有界结果摘要 | 工具注册 |

工具和查看器使用相同的会话所有操作。物理、训练和产物存储属于提供方，不属于浏览器或 agent 循环。本地策略评估不授权硬件激活；Lab 特定的相位观测需要单独实现兼容的部署路径。
