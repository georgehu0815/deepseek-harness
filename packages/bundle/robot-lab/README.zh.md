# @deepseek-ai/dsh-robot-lab-bundle

[English](README.md) | 中文

在基础和 Web 组合包之上按需启用的 MicroDuck Studio 组合。补丁挂载 Robot Lab 服务、本地 Python 提供方、面向模型的工具及原生右栏查看器。[设计提案](../../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.md)记录兼容性和部署要求。

## 独立启动

在 DSH 检出目录中使用 [run-robot-lab.sh](../../../run-robot-lab.sh)。先安装 Node 22.x 中的 22.19+ 或 Node 24+、pnpm、Git 和 uv。启动脚本支持 Apple Silicon macOS 和 Linux x86_64/aarch64；上游 Torch 锁文件不支持 Intel macOS。

```sh
./run-robot-lab.sh --clone-source --verify
./run-robot-lab.sh --no-build
./run-robot-lab.sh --no-build --verify --setup-only
```

第一条命令克隆缺少的源码检出、安装锁定依赖、构建原生 UI 与后端、检查 MuJoCo 就绪状态、执行真实 CPU 集成冒烟测试，并在 `http://127.0.0.1:3082` 提供服务。脚本在 `DSH_HOME`（默认 `~/.dsh`）下创建独立的 `robot-lab` 配置方案，保留已有补丁，并拒绝覆盖不相关配置或占用已使用的端口。它不会停止其他服务器。`--setup-only` 执行选定检查而不启动服务器；可选的 `--verify` 测试实际 DSH 提供方与沙箱，不测试浏览器渲染。每次验证在 `DSH_HOME/robot-lab/verification.*/host-provider.json` 保存新报告；临时策略产物由测试管理，不会加入 UI 策略库。

使用 `--source /path/to/microduck-lab` 和 `--python /path/to/python` 复用安装。未显式指定 Python 时，脚本复用 Lab 已有的 `.venv`，或在 `DSH_HOME/robot-lab/venv` 下配置独立的 Python 3.12 环境；`--setup-python` 显式选择对该托管环境进行冻结同步。脚本不安装面向 GPU 的 `microduck_rl` 环境，也不修改已有源码检出。新克隆使用上游默认分支，而非固定提交；为可复现性，应记录并保留输出的源码版本。冻结锁文件使用上游指定的镜像；即使仅执行 CPU 训练，Linux x86_64 也可能下载大量 CUDA 依赖。完整选项见 `--help`。

在 Apple Silicon macOS 上，`--setup-mlx` 显式使用 `--no-editable` 将 Lab 的冻结依赖同步到 `DSH_HOME/robot-lab/mlx-venv` 中独立的 Python 3.12 环境，然后在其中安装 `mlx==0.31.1`。CPU 环境和 Lab 的 `.venv` 保持不变。也可以使用 `--mlx-python /absolute/path/to/python` 或 `DSH_MICRODUCK_MLX_PYTHON` 复用已安装 MLX 0.31.1 的 Python 3.12 环境，不向其中安装任何依赖；两种复用方式均与 `--setup-mlx` 冲突。选定的解释器必须在 Metal 上执行一个微型运算；解释器无效、Metal 不可用或运算失败都会中止启动，不会回退到 CPU。脚本不会自动选择已有 MLX 环境：后续启动时须再次指定复用选项或导出环境变量。显式配置方案覆盖项优先，脚本绝不重写它们。

MLX 训练使用独立的 PPO 配方，在 Apple GPU 上执行策略计算，在 CPU 上执行 MuJoCo 物理仿真，并非全 GPU 仿真，也不保证提速。CPU 仍为默认选项，无需安装 MLX。`--verify` 仍执行真实 CPU 集成冒烟测试；该报告和 Metal 预检都不能证明 MLX 端到端训练可用。

在仅使用英文的 Robot UI 中选择可写工作区和会话，打开 **Robot Studio**，在 **Teach** 中编写动作，在 **Train** 中启动或停止训练，在 **Policies** 中加载策略，在 **Test** 中运行评估。直接操作不需要模型密钥；对话辅助需另外配置模型提供方。冒烟测试成功仅证明流程可用，不证明已经学会编舞。**Deploy** 只报告阻断原因，不能激活硬件。

## 配置

在所选配置方案的 `dsh.profile.bundles` 中，将 `@deepseek-ai/dsh-robot-lab-bundle` 添加到 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` 之后。配置方案解析器必须能够解析本包及其声明的依赖。重启现有 Web 进程之前，先重建受影响的主机端和客户端产物；打开另一个 Vite 服务器不会更新该应用。

启动配置方案之前设置以下环境变量，或者在配置方案补丁中覆盖 `robot-lab-microduck` 项，明确提供 `sourceRoot`、`pythonBin` 和 `disabled: false`：

| 变量 | 值 |
|---|---|
| `DSH_MICRODUCK_SOURCE_ROOT` | 包含 `microduck_local`、`microduck` 和 `microduck_rl` 的 MicroDuck Lab 检出的绝对路径 |
| `DSH_MICRODUCK_PYTHON` | 已安装 MicroDuck Lab 环境中 Python 可执行文件的绝对路径 |
| `DSH_MICRODUCK_MLX_PYTHON` | 可选的 Apple MLX Python 可执行文件绝对路径；映射到 `mlxPythonBin`（默认未设置） |

缺少源码或 CPU Python 这两个必需变量中的任意一个时，提供方项被禁用，就绪检查会说明未配置提供方。安装路径不从 DSH 检出位置推断。提供方限制和项目存储设置属于提供方配置，不属于此组合载体。训练输出不得提交到源代码仓库。

## 模型体验

### 挂载的工具

#### 模型看到的内容

本组合包本身不添加提示词或工具定义。其工具包负责 `robot_lab` schema 和结果；提供方不可用时明确诊断，不生成合成训练结果。

#### Token 影响

挂载的工具贡献各自的 schema 和已记录结果。此载体不贡献额外上下文。

#### KV Cache 影响

修改挂载的工具集合可能改变请求前缀。组合包不修改现有消息，也不发起模型请求。

## 已知限制与后续工作

- Python 环境和 MicroDuck 检出必须单独安装；本组合包不会在启动时下载模型或安装 Python 依赖。
- 本地片段策略使用 Lab 特定的相位语义，仅用于仿真。Apple MLX 需要显式配置且 Metal 可用；单独启用此组合包不会启用 GPU 训练。实体安装和激活仍不可用。
- 修改主机端组合需要重启现有 Web 进程。客户端热重载要求有包含新包的活动重建监视器。
