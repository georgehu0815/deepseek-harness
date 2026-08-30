# 在 DeepSeek Harness 上运行 Claude Code 插件

[English](running-a-claude-code-plugin.md) | 中文

本指南展示如何把一个 [Claude Code](https://docs.claude.com/en/docs/claude-code)(CC)插件——它的技能、命令、子代理、MCP 服务器与 hooks——原生运行在 DeepSeek Harness(DSH)上,并记录使其工作的每个文件与改动。

原生支持 = **一个 bundle 加一个新增的核心字段,不 fork**。一个 CC 插件以 DSH 原生方式安装:把 `dsh-claude-code-plugin` bundle 加进 profile,生成包含插件路径及逐插件行的补丁,然后正常启动该 profile。

## Claude Code 插件映射为什么

一个 CC 插件是一个目录(*插件根目录*),包含以下部分。每一部分都映射到已有的 DSH 接缝:

| Claude Code 部分 | 文件 | DSH 接缝 | 产生的行 |
|---|---|---|---|
| 技能 | `skills/*/SKILL.md` | `ctx.skills` | 一条 `skill-filesystem` 行(`cc-skills`) |
| 命令 | `commands/*.md` | `ctx.commands` | `cc-commands`(把展开后的提示词作为一轮注入) |
| 子代理 | `agents/*.md` | `tool-subagent` | 每个 agent 一条 `tool-subagent` 行(`persona` + `toolFilter`) |
| MCP 服务器 | `.mcp.json` | `ctx.tools` 上的 `mcp-client` | 每个服务器一条 `mcp-client` 行(`allowedTools`) |
| Hooks | `hooks/hooks.json` | `hooks-claude-code` | `cc-hooks`(仅当文件存在) |

设计理由、备选方案与后果记录在[原生 Claude Code 插件支持 Agent Note](../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md)中。

## 快速开始(单个插件)

假设插件位于 `/abs/windows-brain/plugin`,profile 目录为 `~/.dsh/profiles/wb`。

**1. 把逐插件的 MCP + 子代理行生成到 profile 中。**

```sh
node packages/bundle/claude-code-plugin/scripts/install.mjs \
  /abs/windows-brain/plugin \
  ~/.dsh/profiles/wb \
  --provider spawn
```

这会写出 `~/.dsh/profiles/wb/cordis.patch.yml`,其中包含技能、命令及 hooks 的字面路径,并为每个 `.mcp.json` 服务器添加一条 `mcp-client` 行,为每个 `agents/*.md` 文件添加一条 `tool-subagent` 行。对 windows-brain,它会报告例如:

```
wrote ~/.dsh/profiles/wb/cordis.patch.yml
  8 mcp-client row(s), 14 tool-subagent row(s), provider=spawn
  plugin root: /abs/windows-brain/plugin
```

**2. 在 profile 的 `package.json` 中列出 bundles,** 按顺序——`dsh-base` 在前,本 bundle 在后:

```json
{
  "name": "dsh-profile-wb",
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-claude-code-plugin"
      ]
    }
  },
  "dependencies": {
    "@deepseek-ai/dsh-base": "workspace:^",
    "@deepseek-ai/dsh-claude-code-plugin": "workspace:^"
  }
}
```

**3. 启动生成的 profile。** profile 补丁用已安装的插件路径覆盖 bundle 默认值:

```sh
dsh --profile wb
```

技能被加载,`/windows-brain-<command>` 命令可用,每个 agent 是一个可派发的子代理工具,MCP 服务器连接。若插件携带 `hooks/hooks.json`,其命令-hook 子集运行;否则 hooks 行保持 disabled。

## 多个插件

三个 DSH 注册表拒绝跨插件重复——命令名、子代理 `toolName`、MCP `serverName`。要同时运行多个插件,使用 `cc-manifest.mjs`,它用插件名为每个名字加前缀,因此无一冲突。

编写一个 manifest:

```json
{
  "plugins": [
    { "root": "/abs/windows-brain/plugin", "name": "windows-brain" },
    { "root": "/abs/another/plugin",        "name": "another" }
  ],
  "provider": "spawn"
}
```

生成组合后的 profile 补丁:

```sh
node packages/bundle/claude-code-plugin/scripts/cc-manifest.mjs \
  ./manifest.json \
  ~/.dsh/profiles/multi
```

这会输出一个 `cordis.patch.yml`,含单个 `- insert:`,携带:一条共享 `cc-skills` 行(所有插件的技能目录)、每个插件一条 `cc-commands` 行、每个携带 hooks 的插件一条 `cc-hooks` 行,以及每个插件带命名空间的 `mcp-client` 与 `tool-subagent` 行。`name` 缺省取插件目录 basename;`provider` 缺省为 `spawn`。因每个 row id 都带插件命名空间,整个多插件 profile 是一个无冲突、可审阅的文件。

## 工作原理:两个补丁层

一个 DSH profile 先应用其 `dsh.profile.bundles`(有序的静态 bundle 补丁),再应用自身的 `cordis.patch.yml`,按 row id 后写覆盖。一个 CC 插件**出于必然**拆到两层:静态补丁能表达纯配置行,却无法表达数量不定的逐插件行。

- **Bundle 补丁——静态、纯配置,以 `CC_PLUGIN_ROOT` 为键。** 只需要插件根目录的行,由 `!!js` 表达式解析:
  - `cc-skills` → `skill-filesystem`,`customSkillDirs: [<root>/skills]`
  - `cc-commands` → `cc-commands` 插件,带 `pluginRoot`
  - `cc-hooks` → `hooks-claude-code`,除非 `<root>/hooks/hooks.json` 存在否则 `disabled`
- **Profile 补丁——生成的逐插件行。** 每个服务器一条 `mcp-client` 行、每个 agent 一条 `tool-subagent` 行。其数量与内容随插件而变,故由 `install.mjs`/`cc-manifest.mjs` 生成为可审阅的行,写入 profile 层。服务器启动命令、工具授权、agent persona 与工具范围保持逐行可见、可覆盖。

## 参考:每个文件与改动

以下内容除另有说明外均位于仓库根 `packages/` 下。

### 新包:`@deepseek-ai/dsh-cc-commands`

把 `commands/*.md` 加载为 DSH 命令。DSH 命令不开启模型轮次,因此每个处理器展开命令正文(`$ARGUMENTS`、`${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PROJECT_DIR}`)并通过 `invocation.agent.followup(...)` 作为一个全新用户轮次注入。

- `packages/hooks/cc-commands/src/index.ts` —— 插件:`name`、`inject`、`Config`、`apply`,以及导出的加载器 `parseFrontmatter`、`expandBody`、`commandName`、`loadCommands`、`buildInjectedMessage`。
- `packages/hooks/cc-commands/src/types.ts` —— `CcCommand`、`ExpansionVars`。
- `packages/hooks/cc-commands/src/invariant.ts` —— 包自有的 invariant 伴生(无运行时 invariant;命令注册随 fiber 释放)。
- `packages/hooks/cc-commands/package.json` —— manifest 与依赖。
- `packages/hooks/cc-commands/tsconfig.json` —— 项目引用。
- `packages/hooks/cc-commands/tests/cc-commands.spec.ts` —— 真实组合测试(在真实 `CommandRuntime` 上注册命令,经执行器执行一条,断言被注入的提示词)以及 Loader 安全的导出形态与 HMR 释放。
- `packages/hooks/cc-commands/tests/fixture-plugin/commands/{hello,plain}.md` —— 测试夹具。
- `packages/hooks/cc-commands/README.md`、`README.zh.md`、`README.i18n.yaml` —— 双语文档与配对记录。

### 新 bundle:`@deepseek-ai/dsh-claude-code-plugin`

可安装的 bundle 加安装生成器。

- `packages/bundle/claude-code-plugin/cordis.patch.yml` —— 静态纯配置补丁(`cc-skills`、`cc-commands`、`cc-hooks`),以 `CC_PLUGIN_ROOT` 为键。
- `packages/bundle/claude-code-plugin/scripts/install.mjs` —— 单插件生成器:写出 profile `cordis.patch.yml`。
- `packages/bundle/claude-code-plugin/scripts/cc-manifest.mjs` —— 多插件生成器:组合一个 `pluginRoots[]` manifest,带逐插件命名空间。
- `packages/bundle/claude-code-plugin/scripts/cc-mcp-to-cordis.mjs` —— `.mcp.json` → `mcp-client` 行(支持 `--namespace`、`--insert`)。
- `packages/bundle/claude-code-plugin/scripts/cc-subagents.mjs` —— `agents/*.md` → `tool-subagent` 行(支持 `--provider`、`--namespace`、`--insert`)。
- `packages/bundle/claude-code-plugin/src/index.ts` —— bundle 模块(无运行时 API;实质是补丁文件)。
- `packages/bundle/claude-code-plugin/src/invariant.ts` —— invariant 伴生(静态补丁载体)。
- `packages/bundle/claude-code-plugin/package.json` —— 带 `dsh.bundle.patch` 与被组合插件依赖的 manifest。
- `packages/bundle/claude-code-plugin/tsconfig.json` —— 项目引用。
- `packages/bundle/claude-code-plugin/tests/claude-code-plugin.spec.ts` —— 断言补丁可解析、`!!js` 纯配置行正确、`install.mjs` 产出 schema 合法的行,且 `cc-manifest.mjs` 把两个冲突插件无冲突组合。
- `packages/bundle/claude-code-plugin/README.md`、`README.zh.md`、`README.i18n.yaml` —— 双语文档与配对记录。

### 唯一的核心改动:`mcp-client` `allowedTools`

一个 CC 服务器的 `.mcp.json` `tools:` 白名单在 `mcp-client` 上此前没有表达方式。该新增字段在连接时过滤工具,因此不允许的工具永不进入注册表或模型。

- `packages/mcp/mcp-client/src/index.ts` —— 在 `StdioConfig`/`StreamableHttpConfig` 上新增 `allowedTools?: string[]`,以及 zod schema 字段。
- `packages/mcp/mcp-client/src/tools.ts` —— 导出的 `toolAllowed(rawName, allowlist)` 判定(精确、尾部 `*` 前缀、单独 `*`),在工具发布前于 `syncTools` 中应用。
- `packages/mcp/mcp-client/src/connection.ts` —— 把 `allowedTools` 传入 bridge 选项。
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts` —— 新增 `toolAllowed` 单元测试与 `syncTools` 白名单/缺省/HMR 测试。
- `packages/mcp/mcp-client/README.md` —— `allowedTools` 配置行与连接行为。
- `.agents/notes/implemented/feature/2026-08-28-mcp-client-tool-allowlist.md`(+ `.zh.md`、`.i18n.yaml`)—— 该字段的 Agent Note。

### 接线与特性笔记

- `tsconfig.host.json` —— 为 `packages/hooks/cc-commands` 与 `packages/bundle/claude-code-plugin` 新增项目引用。
- `.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md`(+ `.zh.md`、`.i18n.yaml`)—— 把各部分串起来并交叉链接 `mcp-client` 白名单笔记的特性 Agent Note。

## 命令、工具与服务器命名

- **命令。** DSH 命令名必须匹配 `/^[a-z][a-z0-9_-]*$/`,因此 CC `<plugin>:<name>` 冒号形式无法使用。每条命令命名为 `<pluginName>-<file>`,转为小写,不符字符折叠为 `-`,若结果不以字母开头则加 `cc-` 前缀。`pluginName` 缺省取插件根目录的 basename。因此 `pluginName: windows-brain` 下的 `commands/brain.md` 注册为 `/windows-brain-brain`。
- **子代理工具。** 每个 agent 变成一条 `tool-subagent` 行,其 `toolName` 为 agent 名(多插件情形下逐插件加命名空间)。其 `tools:` 列表映射到 `toolFilter.allow`(`Read→read`、`Bash→bash`、`Grep→grep`、`Glob→glob`、`Write→write`、`Edit→edit`、`WebSearch→web_search`),在执行器中经 `restrict()` 强制,其正文成为 persona。
- **MCP 服务器。** 每个服务器变成一条 `mcp-client` 行,其 `serverName` 为 `.mcp.json` 键(多插件情形下为 `<plugin>-<server>`)。其 `tools:` 成为 `allowedTools`。

## 验证

两个包都带真实组合测试。在仓库根:

```sh
pnpm -s exec vitest run \
  packages/hooks/cc-commands/tests/ \
  packages/bundle/claude-code-plugin/tests/
```

`cc-commands` 套件启动真实命令运行时,经执行器执行一条命令,断言经变量展开的提示词通过 `agent.followup` 注入,以及卸载时释放。bundle 套件解析静态补丁,针对已发布 `Config` 校验每条生成的 `mcp-client` 与 `tool-subagent` 行,并证明两个冲突插件组合为一个无冲突 profile。

## 限制

- MCP 与子代理行在安装时生成,不会热重载:编辑插件的 `.mcp.json` 或 `agents/` 后需重新运行生成器。
- 尚未映射 Claude Code 的逐 agent `model` 与逐 agent MCP 授权;子代理继承部署模型及其 `toolFilter` 允许的工具范围。
- `.mcp.json` 中通过 `agency`/`authScope` 表达的 Claude Code 鉴权在 DSH 中没有对应物;生成器将其作为注释surface,服务器凭据须经 `env`/`headers` 提供。
- Hooks 仅从 `hooks/hooks.json` 挂载;其他 Claude Code hook 位置不予发现。
