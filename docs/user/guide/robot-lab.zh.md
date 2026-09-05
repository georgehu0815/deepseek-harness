# MicroDuck Studio 用户指南

[English](robot-lab.md) | 中文

使用中央的 **Micro Duck** 标签选择实验性动作、自定义已保存项目和本地配乐、训练策略，然后在右侧 **Robot Studio** 检查记录的表现。本指南从环境配置开始，带你完成 **Choose → Customize → Train → Evaluate → Perform**。内置控件使用英文；你的名称和内容保留原语言。

**这是一个仿真平台。** **Target preview · Not physics-tested** 通过正向运动学展示期望动作。**Recorded simulation · Not live hardware** 展示导出策略在物理仿真中的动作。预览和训练完成都不能证明学会舞蹈。通过评估不代表获准激活硬件；硬件激活仍不可用。

## 1. 准备计算机

你需要包含 [run-robot-lab.sh](../../../run-robot-lab.sh) 的 DSH 源码检出、终端和支持 WebGL 的浏览器。

| 要求 | 支持的配置 |
|---|---|
| 操作系统 | Apple Silicon macOS，或 Linux x86_64/aarch64 |
| Node.js | 22.x 中的 22.19+，或 24+ |
| Node 包管理器 | pnpm |
| 源码下载 | Git |
| Python 环境配置 | uv；复用已安装的 Lab Python 环境时可不需要 |
| Python 运行时 | 3.12；启动脚本可通过 uv 配置 |

按照 [Node.js](https://nodejs.org/en/download)、[pnpm](https://pnpm.io/installation)、[Git](https://git-scm.com/downloads) 和 [uv](https://docs.astral.sh/uv/getting-started/installation/) 的说明安装缺少的前置工具。锁定的 Torch 依赖不支持 Intel macOS。直接 Robot 控件和本地音乐生成不需要模型或音乐提供方密钥。对话使用已配置的模型提供方；已有的 AgencyCopilot 登录不需要额外的 LLM（大语言模型）密钥。独立的网页搜索是否可用，不是 Robot Lab 的前置条件。

为 Python wheel 包、Node 依赖和首次构建预留磁盘空间与时间。冻结的 Python 锁文件使用上游指定的镜像。在 Linux x86_64 上，即使物理仿真和标准学习器使用 CPU，也可能下载大量 CUDA 依赖；这不会启用 GPU 物理仿真。

## 2. 启动 Robot Lab

在 DSH 检出目录中运行：

```sh
./run-robot-lab.sh --clone-source --verify
```

启动脚本会克隆缺少的 MicroDuck 源码，复用或创建 Python 环境，安装锁定的 Node 依赖，构建 UI 与后端，检查 MuJoCo 就绪状态，并执行短时真实训练、导出、重新加载和评估集成测试。随后，它使用独立的 `robot-lab` 配置方案，在 **http://127.0.0.1:3082** 启动服务。请自行打开该地址，并保持终端运行。

已有源码检出和配置补丁保持不变。脚本不会停止其他服务器。端口被占用时，可选择另一个端口：

```sh
./run-robot-lab.sh --no-build --port 3083
```

仅在成功构建后使用 `--no-build`。修改或更新 DSH 代码后，应重新构建并刷新原本要使用的页面。不同端口对应另一个服务器；它不会更新已经在 3081 端口运行的 GUI。

### 复用已有安装

提供 Lab 根目录，而不是其 `microduck_local` 子目录，并指定已安装环境中的 Python 可执行文件：

```sh
./run-robot-lab.sh \
  --source /path/to/microduck-lab \
  --python /path/to/microduck-lab/microduck_local/.venv/bin/python \
  --verify
```

未指定这些选项时，源码默认位于同级的 `../microduck-lab` 检出目录；启动脚本也接受 `DSH_MICRODUCK_SOURCE_ROOT` 和 `DSH_MICRODUCK_PYTHON`。它优先复用 Lab 已有的 `.venv`，否则使用 `DSH_HOME/robot-lab/venv` 下的托管环境。`DSH_HOME` 默认为 `~/.dsh`。`--setup-python` 显式同步托管环境，不能与显式 Python 选择同时使用。

### 可选的 Apple MLX 配置

在 Apple Silicon macOS 上，显式创建独立的 Python 3.12 环境，安装 Lab 的冻结依赖和 MLX 0.31.1：

```sh
./run-robot-lab.sh --setup-mlx
```

它使用 `DSH_HOME/robot-lab/mlx-venv`，而非 CPU 环境或 Lab 的 `.venv`。后续启动时复用该环境，或使用其他兼容安装时，请指定解释器的绝对路径：

```sh
./run-robot-lab.sh --no-build --mlx-python "${DSH_HOME:-$HOME/.dsh}/robot-lab/mlx-venv/bin/python"
```

也可以在启动前导出 `DSH_MICRODUCK_MLX_PYTHON`。复用不会向选定环境安装包，且不能与 `--setup-mlx` 同时使用。启动脚本检查 Python 3.12、MLX 0.31.1、原生 Apple Silicon 支持，并执行一个真实的微型 Metal 运算；失败会中止启动，不会回退到 CPU。MLX 环境存在并不代表自动启用。显式配置方案覆盖项优先，且保持不变。

### 理解启动检查

即使已配置 MLX，`--verify` 也使用小规模 **CPU** 训练实验检查真实 DSH 提供方和沙箱。它是安装测试，不是 GPU 训练测试或浏览器测试，也不证明策略已经学会舞蹈。Metal 预检同样不能证明端到端 MLX 训练可用。终端会打印 `DSH_HOME/robot-lab/verification.*/host-provider.json` 下的新证据路径。该测试的临时策略不会加入你的 UI 策略库。

后续启动时可以省略集成测试：

```sh
./run-robot-lab.sh --no-build
```

如需检查已安装环境而不启动服务器：

```sh
./run-robot-lab.sh --no-build --verify --setup-only
```

## 3. 选择目标

1. 打开启动脚本的地址，使用 **Choose workspace** 选择可写实验目录。
2. 创建或选择会话，然后在中央标签中选择 **Supply Chain** 旁的 **Micro Duck**。
3. 等待 **Local robot lab connected**；需要时使用 **Check connection**。
4. 在 **Choose** 中选择模板。**Open Studio ↗** 或侧栏的 **Robot Studio** 鸭子图标可打开右侧播放器。如果那里选中了地球，请选择 **MicroDuck**。

九种原创模板分别为 Head Bob、Disco Groove、Side Sway、Robot Pop、Tiny March、Celebration Mix、Stand Steady、Say Hello 和 Look Around。它们都是 **Experimental target**，不是预训练技能。目标使用实际安装的 MicroDuck 模型的十四个关节、默认姿态和关节限制。列表只显示已安装的机器人适配器；其他机器人需要兼容的模型和控制器，而不只是替换网格。

空播放器还提供 **Preview standing policy**，对随附的 `alpha_stand` 策略执行有界、零速度指令仿真。这是已记录物理仿真，不是虚构的站立动画，也不是训练实验。无需启动上游 `duck-lab` 服务器或其独立查看器。

训练前填写学习简述：目标、预测、计划改变，以及准备检查的证据。例如，预测较小动作会减少跌倒，只改变动作幅度，并在相同评估设置下比较终止次数和直立比例。证据字段是计划，不是结果。从小幅动作和短动作序列开始；目标标签不承诺已经学会技能。

## 4. 自定义并保存

**参考动作**指定期望关节位置。**策略**是在仿真中采取动作的已训练控制器。修改参考动作本身不会训练策略或测试平衡。

1. 在 **Customize** 中输入 **Project name**。
2. 从较小的 **Move size** 开始。设置 **Tempo (BPM)** 和 **Length**；显示的拍数与 BPM 共同决定时长。
3. 在 **Music style** 中选择 Disco、Electronic、Lo-fi 或 Chiptune。**Try another variation** 改变种子，不改变速度。
4. 点击 **Generate music (WAV)**，下载本地原创合成的打击乐、贝斯和旋律。该操作不会自动播放。
5. 点击 **Save revision** 或 **Preview target in Studio**。内容未变时，预览复用准确的保存修订；修改过的草稿会先保存。
6. 在右侧播放器确认 **Target preview · Not physics-tested**，然后点击 **Play with soundtrack**。

音乐和动作共用 BPM 与拍数。音乐不需要账户、密钥、人声或商业录音。DSH 保存带版本的配方，而不是音频字节；浏览器本地生成 PCM 和可下载 WAV。显示的时间轴代表编写的动作与拍数，不是已学会执行的证据。

保存时按模型关节限制检查目标，但不检查平衡或动力学可行性。预览使用真实 MuJoCo 正向运动学，不执行已训练策略或物理轨迹。需要准确参考时可检查生成的关节目标。修改速度或动作需要新的保存修订和训练实验，不能改变旧记录的时序。未保存草稿不持久化，请在刷新前保存。

### 组合多个动作块

在 **Customize → Motion blocks** 中点击 **Arrange motion blocks**，将选定模板变为首块。使用 **Add motion block**，然后设置每块的 **Move**、**Length** 和 **Relative move size**。通过 **Earlier** 或 **Later** 重排，使用 **Duplicate** 复制，或用 **Remove** 删除。至少保留一个动作块，目录限制总块数、时长和编译关键帧数量。

所有块共用动作的 BPM，长度决定动作和音乐总拍数。**Master move size** 乘以每块相对幅度，因此减小它会缩小整套动作。**Use one repeated move** 返回单模板草稿。编辑后保存并预览；排列目标并不测试物理中的平衡或过渡。

时间轴显示草稿块顺序。播放其准确保存修订时，高亮跟随当前记录时间对应的冻结动作块与拍数。后续草稿不能改变已加载记录的时间轴或配乐。

## 5. 训练已保存项目

保存当前草稿后打开 **Train**。绑定项目的实验保留准确修订、编译后的动作和配乐。训练默认值使用保存的完整组合推荐及其奖励覆盖值，而不只使用首块模板。

| 字段 | 首次运行选择 | 含义 |
|---|---|---|
| Training backend | `CPU — Standard` | SB3 PPO 学习和 MuJoCo/BAM 物理仿真均在 CPU 上运行 |
| Practice budget | `Quick check — setup only` | 默认 1,024 步的环境检查，不是技能学习目标 |
| Parallel environments | `2` | 高级设置：训练环境数量 |
| Random seed | `0` | 高级设置：用于比较的记录种子 |

可选的 **MLX GPU — Apple Silicon** 在 Metal 上进行策略和价值网络学习，MuJoCo/BAM 物理仿真仍在 CPU 上运行。其独立 PPO 配方不含对称损失，与 CPU 训练不具备数值等价性。小规模实验可能更慢，不承诺提速。MLX 不可用时报告原因，不回退到 CPU。两个后端都不授予硬件使用许可。

开始前检查保存目标、学习简述和评估配方。配方固定回合数、请求时限、种子、允许终止次数和所需平均直立比例；其时限独立于 Perform 的仿真时长。使用 **Save trial** 只提交计划而不训练，再使用 **Start saved trial**；也可使用 **Save and start trial**，在一个操作中先保存再启动。保存的试验不可变，只能启动一个运行；改变计划需要新试验。等待 `completed` 后选择 **Evaluate this policy**；训练完成不代表达成目标。状态`failed`、`stopped` 和 `interrupted` 不代表导出已完成。**Stop training** 取消当前会话的活跃实验。关闭面板或切换会话不会停止服务器持有的训练；返回原会话监控或停止它。关闭服务器前请显式停止训练，中断的实验不会自动继续。

短时检查可能学到很少，或者表现较差。较长实验可选择练习预算，或在后端限制内增加高级设置中的 **Training steps**。比较预算时保持项目和种子不变。更大预算不保证学会舞蹈；新实验不是热启动续训。

### 可选：自定义关节实验

在 **Train** 中展开 **Advanced: custom joint experiment**，启用 **Use a custom joint clip for training**。输入 **Custom experiment ID**，选择已注册的 **Custom reward recipe**，然后使用 **Copy saved target into editor** 或提供 **Custom clip JSON**。有效 JSON 会显示以弧度为单位的数值关键帧控件。检查设置后使用 **Start custom experiment**；后端在准入时检查实际模型关节限制。

这是未绑定项目的实验，不是预注册学习试验：编辑冻结在实验中，而不进入已保存项目或模板预览，记录也没有按拍关联的项目配乐。自定义 ID 仅使用字母、数字、空格、`_`、`-` 和 `.`，以字母或数字开头；项目显示名称则单独支持 Unicode。数值编辑不验证平衡，也不提供图形姿态控制架。关闭自定义片段选项可返回绑定项目的训练。

## 6. 评估、观察与改进

1. 训练后打开 **Evaluate**，选择试验和准确的导出策略。此阶段独立于 Perform；不需要先生成表演。
2. 点击 **Evaluate trial**，使用试验保存的配方。核对报告中的策略标识和 SHA-256 与选择一致。其他导出策略的报告不是此策略的证据。
3. 检查报告历史与回合结果：标准、请求时限、种子、实际步数、终止次数、直立比例和可用的关节跟踪误差。未完成尝试单独计数，不显示为成功报告。
4. 选择一个回合，在 Robot Studio 生成新的重新仿真。它使用保存报告的种子和请求时限，不使用当前草稿设置或回合较短的实际长度。这是**新的重新仿真**，不是原始评估录制。仅当前会话已完成运行的策略可用；运行时不兼容仍会阻止执行。
5. 如果已有基线报告，可进行比较。同条件评估要求评估设置、观测语义、冻结物理和已加载的执行运行时来源信息匹配；目标、参考动作、预算、学习器和种子仍是可见差异。多项变量改变不能证明受控的单变量比较，也不能自动评选优胜者。
6. 填写 **Observation**、**Interpretation** 和 **Next change**，点击 **Save reflection**。报告必须匹配试验冻结的评估；反思绑定到该实际报告和试验，而不是之后选择的其他策略。在保存的反思上点击 **Review improvement draft**，检查新计划。在携带父反思保存新试验前，草稿**尚未保存**；它启动新运行，不从检查点续训。

通过直立比例或终止标准不能证明完整编舞、稳健性、倒立技巧正确或硬件安全。短时试验评估失败可以是训练不足的有效证据。不要仅为获得通过标签而放宽标准。失败后可直接反思并改进，无需进入 Perform。采用不同标准的探索性评估不替代试验冻结的评估。

## 7. 表演与检查

1. 打开 **Perform**，选择 **Trained policy**。失败或未评估的策略仍可用于仿真检查，并显示其状态。
2. 记录 **SHA-256** 哈希；它标识准确的导出字节，不是安全证书。
3. 选择 **Simulation duration**。绑定项目的策略初始使用保存目标的时长，显式选择可覆盖它。20 秒请求最多执行 1,000 个真实控制步，但跌倒可能使其提前结束。
4. 点击 **Generate learned performance**，记录加载后，在 Robot Studio 点击 **Play with soundtrack** 或 **Play recording**。
5. 检查实际记录时长和提前结束提示。按钮名称不代表成功学习，应检查策略实际做了什么。

配乐和项目标签来自所选实验冻结的项目，绝不来自后续草稿。随附策略或未绑定项目的策略没有项目配乐。模型工具的仿真不会自动将记录加载到浏览器播放器。

**Pause** 同时停止声音和姿态。**Performance time** 同步跳转二者；**Restart** 返回开头并播放。回放不自动开始，也不循环。**Replay speed** 提供 0.5×、1×、1.5× 和 2×，并为当前会话记住选择。声音和姿态同步改变，音频速度和音高都会改变，而不是保持原音高。保存的动作、训练和下载的 WAV 保持不变。在音频启动过程中改变倍速会取消待执行启动，保持暂停。它保持最后姿态，并在实际结束时停止声音，包括提前终止。隐藏播放器或浏览器标签、切换会话都会暂停回放。音频启动失败会显示错误并保持暂停；需要时显式选择 **Play without music**。**Mute** 改变音量，不停止时间。

使用 **Camera** 预设、**Reset view**、**Expand view**、画布拖动和滚动检查场景。先让查看器获得焦点，再按 **Space** 播放或暂停；它不会截获表单字段输入。**Visual surface** 提供 Studio grid、Concrete、Sand 和 Grass，全部是平面外观，不是物理、摩擦、可变形地面或地形测试。

点击机器人部件可检查世界坐标，或打开 **Motion details** 选择关节。物理记录报告实际关节角度与速度、控制器目标、执行器扭矩和身体倾角；速度指标测量根部移动速度。目标预览将数值标为运动学目标，而不是实测物理。不记录足部接触。**Routine tempo** 显示保存的 BPM。**Body speed** 按记录时间测量，因此不会乘以回放倍速。平均每秒训练步数衡量训练吞吐量，而不是移动速度。当前块指标跟随记录保存的块序列。

## 8. 保存工作并在以后继续

持久化项目与实验默认保存在所选工作区的 `.microduck-studio/<session-hash>/` 下。保存的项目修订保留配方、模型与模板数据、目标和哈希。绑定项目的实验将项目和音乐连同种子、训练配方、来源信息及导出产物一起冻结。评估保留请求与报告。版本 1 学习试验、运行绑定和反思独立于项目及运行记录，保留计划与证据谱系。重新加载已提交记录不会重启训练；改进草稿在显式提交为新试验前仍未保存。管理员可以更改存储目录。

项目使用格式 2，包含冻结动作块和整套动作训练推荐；模板、片段与音乐版本仍为 1，实验运行仍为格式 3。旧项目格式被拒绝，不自动转换。请保留它们，而不是修改版本或哈希。

返回**同一工作区和原会话**。使用 **Refresh library** 重新加载保存记录，无需刷新浏览器页面。在 **Choose** 中使用 **Continue a saved project** 加载修订；在 **Perform** 中选择策略。即使处于同一工作区，另一个会话也有独立记录。加载或编辑已保存项目会创建草稿；再次保存创建独立不可变修订，不覆盖来源修订。

只有运行格式 3 可执行。旧文件在 **Unsupported run records** 下保持不变，不提供自动迁移、导入或热启动路径。完整的格式 3 策略若运行时与当前运行时不一致，仍可检查并显示不兼容原因，但不能仿真或评估。旧评估不能覆盖这项检查。

请备份完整实验目录和对应会话数据，而不只是 ONNX 文件。保留源码版本与 Python 环境：源码、依赖或 BAM 参数改变可能使冻结实验无法执行。不要编辑哈希或来源信息来绕过检查。需要时可从配方重新下载 WAV；DSH 不保存生成的音频字节。

## 9. 理解部署限制

在 **Perform** 中展开 **Hardware deployment remains blocked**，使用 **Show deployment blockers**。

本地自定义片段策略使用的相位字段与所检查的实体机器人运行时不兼容。本地策略也尚未完成必要的目标验证和受监督实机试验。**Activate hardware (unavailable)** 是刻意禁用的。成功导出或通过仿真评估都不会启用它；本指南不包含硬件激活步骤。

## 故障排查

| 现象 | 操作 |
|---|---|
| 启动脚本报告缺少源码或资源 | 检查 `--source`；对缺少的检出使用 `--clone-source`。已有但不完整的目录不会被自动覆盖。 |
| Python 配置或就绪检查失败 | 确认 Python 3.12 并检查错误。检查冻结 uv 安装所需的镜像访问，或提供可用的 `--python`。不要随意升级依赖来替换锁文件。 |
| 构建失败或面板不存在 | 解决构建错误，省略 `--no-build` 重新构建，刷新启动脚本的准确地址。在中央寻找 Micro Duck，在右侧可视化工作区寻找 MicroDuck。 |
| 端口被占用 | 复用原本要使用的服务器或选择其他端口；启动脚本绝不终止占用者。 |
| 保存或启动试验被禁用 | 保存当前项目草稿；填写全部四个简述字段；检查评估标准、会话与工作区、后端就绪状态、数值设置、验证错误和是否已有活跃实验。 |
| 沙箱或只读错误 | 选择获授权的可写工作区，请管理员检查约束。不要关闭沙箱来强制训练。 |
| 查看器为空 | 预览保存目标或生成策略记录。如出现渲染器错误，检查 WebGL 支持。 |
| 音频不能启动 | 通过直接手势点击 Play，检查错误，或显式选择 Play without music。浏览器音频不可用时可下载 WAV。 |
| 音乐超过限制 | 缩短拍数，或请管理员检查合成时长与样本数限制。提高采样率也会增加所需样本数。 |
| MLX GPU 不可用 | 检查 Apple Silicon macOS、Python 3.12、MLX 0.31.1 和 Metal 诊断。后续启动仍需要 `--mlx-python` 或对应环境变量。 |
| 切换会话后策略或项目消失 | 返回其原会话和工作区。 |
| 不支持的格式或哈希与来源不匹配 | 保留原文件，恢复原运行时或训练新实验。绝不重写记录的证据。 |
| 评估失败 | 检查条件、记录、参考和训练预算。失败可能准确描述训练不足的策略。 |

运行 `./run-robot-lab.sh --help` 查看启动选项。[组合包配置参考](../../../packages/bundle/robot-lab/README.md)说明配置方案组合，[提供方参考](../../../packages/robot/robot-lab-microduck/README.md)说明执行与存储约束。对话配置见[配置模型](./providers.md)。
