# @deepseek-ai/dsh-cc-commands

[English](README.md) | 中文

把 [Claude Code](https://docs.claude.com/en/docs/claude-code) 插件的 `commands/*.md` 通过 [`ctx.commands`](../../interaction/commands/README.md) 加载为 DeepSeek Harness 命令。Claude Code 命令是一段可复用的提示词,而非确定性动作,且 DSH 命令自身不会开启模型轮次,因此每个处理器会展开命令正文,并通过 `invocation.agent.followup(...)` 把它作为一个全新的用户轮次注入——这与 [`command-goal`](../../goal/command-goal/README.md) 处理图片附件走的是同一条路径。命令返回值仅用于 UI 回显;真正驱动模型的是被注入的消息。

原生 Claude Code 插件支持的相关决策见 [Agent Note](../../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md)。

## 加载内容

每个 `commands/<file>.md` 变为一条命令:

| 来源 | 转换为 |
|---|---|
| frontmatter `description` | 命令描述(缺省时回退为 `Claude Code command <file>`) |
| frontmatter `argument-hint` | 命令的输入框 `input.hint` |
| 正文 | 调用时注入的提示词,经变量展开后 |

正文可使用 Claude Code 变量 `$ARGUMENTS`、`${CLAUDE_PLUGIN_ROOT}` 与 `${CLAUDE_PROJECT_DIR}`;三者都会在注入前被替换。其余 frontmatter 键不予读取。

## 命令命名

DSH 命令名必须匹配 `/^[a-z][a-z0-9_-]*$/`,因此 Claude Code 的 `<plugin>:<name>` 冒号形式无法使用。每条命令命名为 `<pluginName>-<file>`,转为小写,任何不符字符折叠为 `-`,若结果不以字母开头则加 `cc-` 前缀。`pluginName` 缺省取插件根目录的 basename。当 `pluginName: windows-brain` 时,`commands/brain.md` 注册为 `/windows-brain-brain`。

## 配置

| 键 | 必填 | 缺省 | 含义 |
|---|---|---|---|
| `pluginRoot` | 是 | — | Claude Code 插件根目录;`commands/` 与 `${CLAUDE_PLUGIN_ROOT}` 由它派生。 |
| `pluginName` | 否 | `pluginRoot` 的 basename | 命令名的命名空间前缀。 |
| `projectDir` | 否 | 加载时的 harness 工作目录 | 替换 `${CLAUDE_PROJECT_DIR}` 的值。 |

配置错误当场报错:`pluginRoot` 在加载时必填。缺失 `commands/` 目录时不注册任何命令而非抛错,因此没有命令的插件也能干净组合。

## 模型体验

模型永远看不到命令文件本身。它在普通会话历史中看到的是一个新的用户轮次,携带展开后的提示词——与用户手动键入该提示词无法区分。这让每条 Claude Code 命令在日志中都可审阅,后续轮次也能读到其完整文本,而无需任何命令特有的状态。

## 组合

该插件注入 `commands`。一个 profile 挂载命令运行时与本插件,通常每个 Claude Code 插件挂载一次:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'

- id: cc-commands
  name: '@deepseek-ai/dsh-cc-commands'
  config:
    pluginRoot: /abs/windows-brain/plugin
    pluginName: windows-brain
```

若要一次性加载整个插件(命令、子代理、MCP 服务器、技能、hooks),使用 [`dsh-claude-code-plugin`](../../bundle/claude-code-plugin/README.md) bundle,它会把本插件与其他插件一并挂载。

## Known Limitations and Deferred Work

- 仅读取扁平 frontmatter 键 `description` 与 `argument-hint`;嵌套 YAML 及其他键被忽略。
- 命令名有命名空间但不做额外去重:两个都会产出 `<name>` 的插件必须被赋予不同的 `pluginName`(bundle 与 `cc-manifest` 会自动完成)。
- 仅展开这三个已文档化的变量;其他 `${…}` 序列原样透传。
