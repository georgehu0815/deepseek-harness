# Agent Note: 原生 Claude Code 插件支持

Status: implemented

[English](2026-08-29-claude-code-plugin-native-support.md) | 中文

## Problem

一个 [Claude Code](https://docs.claude.com/en/docs/claude-code) 插件在同一个插件根目录下打包了五类贡献——`skills/*/SKILL.md`、`commands/*.md`、`agents/*.md` 子代理、`.mcp.json` MCP 服务器,以及 `hooks/hooks.json`。DeepSeek Harness 对每一类都已有接缝:`ctx.skills`、`ctx.commands`、`tool-subagent`、`ctx.tools` 上的 `mcp-client`,以及 `hooks-claude-code`。缺的是一种以 DSH 原生方式(把一个 bundle 加进 profile)安装整个插件的手段——既不 fork harness,也不为每个插件手写 `cordis.yml`——并且能同时运行多个插件而其命令名、工具名、服务器名不冲突。

有两个事实约束这一映射。Claude Code 命令是一段可复用的提示词,但 DSH 命令不开启模型轮次,因此命令适配器无法直接"运行"它。且 DSH 命令名必须匹配 `/^[a-z][a-z0-9_-]*$/`,因此 Claude Code 的 `<plugin>:<name>` 冒号形式无法原样使用。

## Decision

原生支持 = 一个 bundle 加一个新增的核心字段,不 fork。

新增的核心字段是 [`mcp-client` `allowedTools`](../../../../packages/mcp/mcp-client/README.md)(有其自己的[笔记](2026-08-28-mcp-client-tool-allowlist.md)):Claude Code 服务器的 `tools:` 白名单在 `mcp-client` 上此前没有表达方式,而在连接时过滤能让不允许的工具不进入注册表与模型。

`packages/hooks/cc-commands/` 中的 `@deepseek-ai/dsh-cc-commands` 把 `commands/*.md` 加载为 `ctx.commands` 注册。由于 DSH 命令不开启轮次,每个处理器会展开命令正文——替换 `$ARGUMENTS`、`${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PROJECT_DIR}`——并通过 `invocation.agent.followup(...)` 作为一个全新用户轮次注入,这与 `command-goal` 处理图片附件走同一路径。命令返回值仅为 UI 回显。命令名被强制为 DSH 文法 `<pluginName>-<file>`,因此模型看到的是 `/windows-brain-brain`,而非被拒的 `windows-brain:brain`。

`packages/bundle/claude-code-plugin/` 中的 `@deepseek-ai/dsh-claude-code-plugin` 是可安装的 bundle。一个 DSH profile 先应用其有序 bundle 补丁,再应用自身的 `cordis.patch.yml`,按 row id 后写覆盖,因此该插件出于必然拆到两层:

- bundle 的静态 `cordis.patch.yml` 携带以 `CC_PLUGIN_ROOT` 环境变量为键的纯配置行:`cc-skills`(`skill-filesystem.customSkillDirs`)、`cc-commands`(`pluginRoot`)、`cc-hooks`(`hooks-claude-code`,除非 `hooks/hooks.json` 存在否则 `disabled`)。它们只需要插件根目录,故由 `!!js` 表达式解析。
- 逐插件行——每个 `.mcp.json` 服务器一条 `mcp-client` 行、每个 agent 一条 `tool-subagent` 行——其数量与内容随插件而变,静态补丁无法表达。`scripts/install.mjs`(单个插件)与 `scripts/cc-manifest.mjs`(多个)把它们生成为可审阅的行,写入 profile 自身的补丁层。

子代理映射到 `tool-subagent` 且无需改接缝:每个 agent 变成一条 `tool-subagent` 行,其逐实例 `Config` 已携带 `toolName`、`persona`、`toolFilter`、`provider`。agent 的 `tools:` 列表映射到 `toolFilter.allow`(`Read→read`、`Bash→bash`……),其正文成为 persona,因此 DSH 通过 `childCtx.tools.restrict()` 强制 agent 的工具范围,而非靠提示词。

### 多插件命名空间

三个注册表拒绝跨插件重复:命令名、`tool-subagent` `toolName`、`mcp-client` `serverName`。`CC_PLUGIN_ROOT` 下的单个插件无需命名空间。对多个插件,`cc-manifest.mjs` 用插件名为各插件的命令名(经 `cc-commands.pluginName`)、子代理工具名(`--namespace`)、MCP 服务器名(`--namespace`)加前缀,因此组合后的 profile 无冲突。windows-brain 插件以不同名字组合两次会产出 47 行且 id 全唯一。

### MCP 与子代理用生成器,而非运行时加载器

MCP 与子代理行被生成为静态、可审阅的 `cordis.yml` 行,而非由运行时加载器发现。服务器启动命令、工具授权、agent persona 与工具范围因而在 profile 中保持可见、逐行可覆盖,这与 DSH 呈现随部署而变的配置的方式一致。

## Alternatives considered

**Fork harness / 改 `agent-loop`。** 拒绝:每个 Claude Code 部分都已有接缝,新行为应落在扩展点而非循环里。此处无一需要改循环。

**在启动时读取插件的运行时 MCP/子代理加载器。** 作为首版拒绝:它会把每个服务器的命令、鉴权、工具授权,以及每个 agent 的 persona 与范围藏进代码,失去生成行所保留的逐行审阅与覆盖。一旦行的形态稳定,加载器仍是合理的未来补充。

**用 Claude Code 冒号形式 `<plugin>:<name>` 为命令加命名空间。** 拒绝:DSH 命令文法禁止冒号。强制为 `<pluginName>-<file>` 使名字既合法又唯一。

**多插件情形下每个插件一个 bundle 实例。** 拒绝,改用带插件命名空间 id 的单个生成 profile 补丁:它避免逐插件 bundle 复制,并让整个多插件 profile 保持为一个可审阅文件。

**用提示词文本强制 agent 工具限制(如 Claude Code 所做)。** 拒绝:`tool-subagent` 的 `toolFilter` 在执行器中经 `restrict()` 强制该范围,而提示词无法保证。

## Consequences

- Claude Code 插件以 DSH 原生方式安装:把 `dsh-claude-code-plugin` 加入 profile 的 bundles,生成逐插件行,并在设置了 `CC_PLUGIN_ROOT` 后启动。多个插件经一个 manifest 组合而不冲突。
- 唯一发布的核心改动是新增的 `mcp-client` `allowedTools` 字段;其余皆在 `dsh-base` 之上组合已有插件。
- 生成的行不会热重载:编辑插件的 `.mcp.json` 或 `agents/` 需重新运行生成器。逐 agent `model` 与逐 agent MCP 授权尚未映射,Claude Code 的 `agency`/`authScope` 鉴权作为注释surface而非翻译。

## Related

- [mcp-client 工具白名单](2026-08-28-mcp-client-tool-allowlist.md) —— 本特性依赖的新增核心字段。
- [mcp-client 插件](2026-07-07-mcp-client-plugin.md) —— 生成行所针对的 MCP 接缝。
