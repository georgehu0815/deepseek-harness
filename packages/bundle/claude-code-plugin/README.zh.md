# @deepseek-ai/dsh-claude-code-plugin

[English](README.md) | 中文

把一个 [Claude Code](https://docs.claude.com/en/docs/claude-code) 插件——它的技能、命令、子代理、MCP 服务器与 hooks——作为一个 [profile bundle](../README.md) 原生运行在 DeepSeek Harness 上。该 bundle 在 [`dsh-base`](../base/README.md) 之上组合已发布的插件;它唯一依赖的 DSH 核心改动是新增的 [`mcp-client` `allowedTools`](../../mcp/mcp-client/README.md) 字段。设计决策见 [Agent Note](../../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md)。

## 两个补丁层,出于必然

一个 DSH profile 先应用其 `dsh.profile.bundles`(有序的静态 bundle 补丁),再应用自身的 `cordis.patch.yml`,按 row id 后写覆盖。本 bundle 把插件拆到两层,因为静态补丁能表达纯配置行,却无法表达数量不定的逐插件行:

- **Bundle 补丁(`cordis.patch.yml`)——静态、由环境驱动的默认值,以 `CC_PLUGIN_ROOT` 为键:**
  - `cc-skills` → [`skill-filesystem`](../../skill/skill-filesystem/README.md),`customSkillDirs: [<root>/skills]`
  - `cc-commands` → [`cc-commands`](../../hooks/cc-commands/README.md),带 `pluginRoot`
  - `cc-hooks` → [`hooks-claude-code`](../../hooks/hooks-claude-code/README.md),除非 `<root>/hooks/hooks.json` 存在,否则 `disabled`
- **Profile 补丁(生成)——具体插件配置与逐插件行:** `scripts/install.mjs` 用技能、命令及 hooks 的字面路径覆盖 bundle 默认值,并为每个 `.mcp.json` 服务器生成一条 [`mcp-client`](../../mcp/mcp-client/README.md) 行,为每个 `agents/*.md` 生成一条 [`tool-subagent`](../../subagent/tool-subagent/README.md) 行。`scripts/cc-manifest.mjs` 为多个插件生成相应的命名空间行。

## 安装

单个插件:

```sh
# 1. generate the per-plugin MCP + subagent rows into the profile
node scripts/install.mjs <pluginRoot> <profileDir> [--provider spawn]

# 2. the profile's package.json dsh.profile.bundles lists, in order:
#      ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-claude-code-plugin"]

# 3. 启动;生成的 profile 已包含插件路径
dsh --profile <name>
```

多个插件,通过一个 manifest——每一行都带插件命名空间,因此命令、子代理工具名、MCP 服务器名都不会冲突:

```sh
node scripts/cc-manifest.mjs <manifest.json> <profileDir>
```

```json
{
  "plugins": [
    { "root": "/abs/windows-brain/plugin", "name": "windows-brain" },
    { "root": "/abs/another/plugin",        "name": "another" }
  ],
  "provider": "spawn"
}
```

## 每个 Claude Code 部分变成什么

| Claude Code 部分 | DSH 接缝 | 行 |
|---|---|---|
| `skills/*/SKILL.md` | `ctx.skills` | 一条共享 `skill-filesystem` 行(`cc-skills`) |
| `commands/*.md` | `ctx.commands` | `cc-commands`(把展开后的提示词作为一轮注入) |
| `agents/*.md` | `tool-subagent` | 每个 agent 一条 `tool-subagent` 行,带 `persona` + `toolFilter` |
| `.mcp.json` 服务器 | `ctx.tools` 上的 `mcp-client` | 每个服务器一条 `mcp-client` 行,带 `allowedTools` |
| `hooks/hooks.json` | `hooks-claude-code` | `cc-hooks`(仅当文件存在) |

## 命名空间与冲突

三个注册表拒绝跨插件重复:命令名、`tool-subagent` `toolName`、`mcp-client` `serverName`。生成的单插件 profile 无需命名空间。对多个插件,`cc-manifest.mjs` 用各插件名为命令名(经 `cc-commands.pluginName`)、子代理工具名、MCP 服务器名加前缀,因此组合后的 profile 无冲突。

## 模型体验

本 bundle 自身不新增任何面向模型的文本。每条被组合行的所属包各自拥有其模型体验:`cc-commands` 把展开后的命令提示词作为普通用户轮次注入;`tool-subagent` 把每个 agent 暴露为一个可派发工具,带其 persona 与工具范围;`mcp-client` 发布该服务器允许的工具。每一部分都在会话日志中可审阅。

## Known Limitations and Deferred Work

- MCP 与子代理行在安装时生成,不会热重载:编辑插件的 `.mcp.json` 或 `agents/` 后需重新运行生成器。
- 尚未映射 Claude Code 的逐 agent `model` 与逐 agent MCP 授权;子代理继承部署模型及其 `toolFilter` 允许的工具范围。
- `.mcp.json` 中通过 `agency`/`authScope` 表达的 Claude Code 鉴权在 DSH 中没有对应物;生成器将其作为注释surface,服务器凭据须经 `env`/`headers` 提供。
- Hooks 仅从 `hooks/hooks.json` 挂载;其他 Claude Code hook 位置不予发现。
