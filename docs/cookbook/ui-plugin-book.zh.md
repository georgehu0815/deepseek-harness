---
title: DeepSeek Harness UI 插件学生手册
description: 从临时 Studio 原型出发，构建生产级 DeepSeek Harness UI 插件，涵盖 Host 工具、Client slot、ACP、SDK 集成、测试与安装
author: George Hu
ms.date: 2026-08-23
ms.topic: tutorial
keywords:
  - DeepSeek Harness
  - UI 插件
  - DSH Studio
  - Cordis
  - ACP
estimated_reading_time: 45
---

[English](ui-plugin-book.md) | 中文

## 学习路径

你将构建一项由 agent（智能体）驱动的功能，并将它实现为 4 种形态：在聊天中创建的临时 UI、生产级 DSH Studio 插件、编辑器集成等 ACP（Agent Client Protocol）客户端，以及自定义外部应用。完成后的生产示例会添加面向模型的 `study_progress` 工具，并为该工具调用提供专用 Studio 卡片。

你将学会：

* 在临时动态 UI 与已安装插件之间做出选择
* 构建遵循 DSH Client slot 规则的 React 组件
* 将 agent 工具连接到可回放的 UI 卡片
* 将 Client 插件添加到 DSH Studio
* 向 Copilot 或其他 ACP 客户端公开同一项 agent 能力
* 从 TypeScript、Python 或其他外部 UI 驱动 agent
* 测试组件行为、插件生命周期、组装后的浏览器输出和安装过程

开始前，请先完成[第一个 Harness 插件](../user/develop/basic/index.md)。请使用 Node.js `^22.19` 或 `>=24`、pnpm，并在本地检出中完成 `pnpm install`。

Studio React 组件不能跨越进程边界。Studio 渲染 Client 插件；ACP 和 SDK 客户端接收协议数据，并渲染各自的原生组件。各客户端共享的是工具及其持久会话事件，而不是 React 组件树。

## 1. 理解 UI 架构

DSH 将 agent 行为与展示分离：

```text
Model
  |
  | chooses study_progress from its schema
  v
Host Tool plugin
  | validates arguments, executes, returns canonical JSON
  | records tool/call and tool/result Session events
  +-------------------------+-------------------------+
  |                         |                         |
  v                         v                         v
DSH Studio Client plugin    ACP client                SDK/custom UI
React + typed Slot          native editor UI          web/mobile/desktop UI
```

Host 工具负责行为和面向模型的数据，Studio Client 插件负责渲染，外部客户端则拥有自己的 UI，并消费 ACP 或 SDK 事件。这样的职责划分让工具在没有打开浏览器时仍可使用，也让会话回放不依赖某一种 UI 框架。

请选择对应的扩展点：

| 目标 | 扩展点 |
|---|---|
| 显示标准工具卡片 | `presentCall` 和 `presentResult` 渲染意图 |
| 替换某个工具的 Studio 卡片 | 带键的 `tool.call.toolview` slot |
| 在聊天中添加持久业务行 | `ConversationNodeDefinition` 和带键的 `conversation.chat.node` slot |
| 添加设置或侧边栏 UI | 对应的已声明 slot |
| 让模型执行操作 | 在 `ctx.tools` 上注册的 Host 工具 |
| 让 Client UI 调用 Host | Remote API 或包私有的动态 Cordis 处理程序 |
| 从编辑器驱动 DSH | 基于 JSON-RPC stdio 的 ACP |
| 从应用驱动 DSH | 基于 JSON-RPC stdio 的 TypeScript 或 Python SDK |

请阅读[工具编写](adding-a-tool.md)了解完整的工具约定。当 UI 表示持久的多事件工作流，而不是单次工具调用时，请阅读[添加会话节点](adding-a-conversation-node.md)。

## 2. 先在聊天中尝试构想

动态 Cordis 插件适合在当前 DSH 进程中制作一次性原型。启动 Studio：

```bash
pnpm dsh web --no-open
```

打开命令输出的 URL，启动会话，然后发送以下提示词：

```text
Create a temporary Study Progress UI in this DSH session. It should show a subject,
completed lessons, total lessons, and a progress bar. Use a Client dynamic Cordis
plugin, inspect the available Slots before choosing where to mount it, and ask for
browser approval when required.
```

运行新的 Client 包会创建一个 `Awaiting approval` 请求。打开左侧边栏的 **Cordis plugins** 面板，在 **This session** 下找到该插件，然后选择 **Allow this version only** 或 **Allow future versions of this plugin**。批准前请检查生成的代码，并且只在信任代码时批准。仅包含 Host 的包不需要此浏览器批准。运行成功后，使用返回的标识符引用该插件：

```text
@study-1 add a Reset action and make the empty state clear.
```

实际标识符可能不同。`@pluginId` 引用会指示 agent 检查现有包、追加一个不可变版本，然后运行或更新它。

动态定义仅存在于进程内存中。DSH 重启后，其 `pluginId` 和 `packageId` 会失效。你可以重新创建动态插件；如果原型必须在重启后继续存在，请完成下方的已安装插件实验。

## 3. 规划生产示例

生产示例使用一个同时包含两端入口的包：

```text
dsh-study-progress/
  package.json
  cordis.patch.yml
  tsconfig.json
  tsdown.config.ts
  src/
    index.ts
    invariant.ts
    client/
      index.ts
      StudyProgressCard.tsx
      StudyProgressCard.module.css
      css-modules.d.ts
  tests/
    browser-plugin.client.spec.ts
    study-progress-card.client.spec.tsx
```

Node 入口注册 `study_progress`，浏览器入口注册带键的 Studio 卡片，组合包补丁挂载 Host 和 Client 配置项。两个入口作为一项功能共同发布，因此适合放在一个包中。更大的能力可以把工具、服务和 UI 拆分为独立版本的包。

即使没有 Studio，工具结果也应当有用：

```json
{
  "subject": "Cordis lifecycle",
  "completed": 3,
  "total": 5,
  "percent": 60,
  "message": "3 of 5 lessons complete"
}
```

Studio 可以把这些数据转换为进度卡片，ACP 可以在编辑器卡片中显示渲染后的文本，外部仪表板则可以绘制自己的进度条。

## 4. 创建包 manifest

如果需要独立安装的插件，请在本仓库之外创建包。在仓库内开发官方包时，请将其放在适当的 `packages/<group>/<name>/` 目录下，并遵循[添加工作区包](adding-a-package.md)。

以下独立 `package.json` 可以作为起点。分发前，请将 workspace 版本范围替换为目标 DSH 的已发布版本。

```json
{
  "name": "dsh-study-progress",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    },
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/invariant.js",
    "lib/types/**/*.d.ts",
    "cordis.patch.yml"
  ],
  "scripts": {
    "build": "tsc -b && tsdown",
    "prepare": "pnpm run build",
    "test": "vitest run"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-tool"]
    }
  }
}
```

`dsh.bundle` 配置项让该包可以安装到 profile 中。`dsh.client` 配置项告诉 Web 模块 loader，`./client` 是浏览器插件。Client 包还需要声明源码使用的 Cordis、React、DSH Tool、Client runtime、slot、primitive 和 invariant 依赖。请遵循 [Client 包检查清单](../../packages/client/AGENTS.md#new-plugin-package-checklist)中准确的对等依赖与开发依赖规则。

## 5. 实现 Host 工具

Host 工具接收已完成课程数和课程总数，计算稳定结果，并在不依赖 Studio 的情况下生成面向模型的文本。

```tsx
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'study-progress'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'study_progress',
    description: 'Report a learner progress checkpoint for one subject.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Subject being studied.' },
      completed: { type: 'number', required: true, description: 'Completed lesson count.' },
      total: { type: 'number', required: true, description: 'Total lesson count.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subject: { type: 'string', required: true },
          completed: { type: 'number', required: true },
          total: { type: 'number', required: true },
          percent: { type: 'number', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
      presentationMeta: (_args, value) => value,
    },
    execute(args) {
      if (!Number.isInteger(args.completed) || !Number.isInteger(args.total)) {
        throw new Error('completed and total must be integers')
      }
      if (args.total <= 0 || args.completed < 0 || args.completed > args.total) {
        throw new Error('expected 0 <= completed <= total and total > 0')
      }
      const percent = Math.round((args.completed / args.total) * 100)
      return Promise.resolve({
        ...args,
        percent,
        message: `${args.completed} of ${args.total} lessons complete`,
      })
    },
  }))
}
```

schema 会在 `execute` 之前校验 JSON 类型；显式检查则约束 schema 无法表达的字段关系。`presentationMeta` 保存卡片回放所需的字段。展示转换器或卡片模型不得读取文件、时钟、会话状态或随机值，因为回放必须仅根据持久的调用与结果数据生成相同视图。

## 6. 构建 Studio 组件

组件接收 `ToolCallViewProps`。它不会接收 `ctx`、导入 Host 服务或直接订阅业务数据。请先在纯函数中规范化冻结的工具块，再渲染结果。

```tsx
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './StudyProgressCard.module.css'

interface ProgressCardModel {
  subject: string
  completed: number
  total: number
  percent: number
  state: 'running' | 'complete' | 'error'
  message?: string
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function modelOf(block: ToolCallViewProps['block']): ProgressCardModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '{}'
  let args: Record<string, unknown> = {}
  try { args = readObject(JSON.parse(argsRaw)) ?? {} } catch { /* streaming JSON may be incomplete */ }
  const meta = settled ? readObject(block.meta) : null
  const source = meta ?? args
  return {
    subject: typeof source.subject === 'string' ? source.subject : 'Study progress',
    completed: typeof source.completed === 'number' ? source.completed : 0,
    total: typeof source.total === 'number' ? source.total : 0,
    percent: typeof source.percent === 'number' ? source.percent : 0,
    state: !settled ? 'running' : block.isError ? 'error' : 'complete',
    message: settled && block.isError ? 'The progress update failed.' : undefined,
  }
}

export function StudyProgressCard({ block }: ToolCallViewProps) {
  const model = modelOf(block)
  return (
    <section className={css.card} aria-label="Study progress">
      <div className={css.heading}>
        <strong>{model.subject}</strong>
        <span>{model.state === 'running' ? 'Updating' : `${model.percent}%`}</span>
      </div>
      <progress max={100} value={model.percent} aria-label={`${model.percent}% complete`} />
      <div className={css.detail}>{model.completed} of {model.total} lessons</div>
      {model.message !== undefined && <div role="alert">{model.message}</div>}
    </section>
  )
}
```

请使用 CSS Module 和共享的 `--dsw-*` token。不要使用产品颜色字面量、全局选择器、Tailwind 或第二套组件库。面向用户发布插件时，应当本地化产品文案；这个紧凑示例保留英文文本，便于读者观察数据流。

## 7. 注册带键的工具 slot

`tool.call.toolview` slot 按准确的工具名称分发。注册 `key: 'study_progress'` 后，只有该工具的通用 Studio 行会被替换。

```tsx
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { StudyProgressCard } from './StudyProgressCard.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'study_progress',
  }, StudyProgressCard))
}
```

`ctx.slots.inject` 会等待 slot 声明，在其所有者存在期间注册，在声明消失时注销，并在重新声明后再次注册。不要把它替换为向其他包拥有的 slot 直接调用 `slots.register`。

更高级的组件可以使用 4 种派生属性共享：

* `PropsRuntime` 提供所有者数据和标准会话钩子
* `PropsRenderSlots` 提供此配置项声明的子 slot
* `PropsStore` 提供在重新挂载后仍保留的共享交互状态
* `InjectFace` 提供普通回调、值以及与框架绑定的可观察钩子

组件局部状态保留在 React 中，会话业务数据保留在 Client runtime 中，共享视图状态使用配置项声明的存储工厂。组件绝不接收 `ctx`。

## 8. 挂载并安装插件

创建包含 Host 和 Client 配置项的 `cordis.patch.yml`：

```yaml
- insert:
    - id: study-progress
      name: dsh-study-progress

    - id: ui-study-progress
      name: dsh-study-progress/client
```

对于仓库内的官方 Client 包，请把包名添加到 Web 组合包依赖中，并向 [`packages/bundle/web-app/cordis.patch.yml`](../../packages/bundle/web-app/cordis.patch.yml) 添加 `dsh.client` 配置项。按照[工作区包检查清单](adding-a-package.md#2-register-it-in-the-root-configs)的说明，将该包添加到 `tsconfig.client.json`。

对于独立包，请构建它并安装到 profile：

```bash
pnpm run build
dsh plugin --profile study add ./dsh-study-progress
dsh --profile study --dump-config
dsh --profile study web --no-open
```

配置转储必须包含一个 `dsh-study-progress` 组合包层以及两个配置项。使用以下命令移除插件：

```bash
dsh plugin --profile study remove dsh-study-progress
```

通过 Git 安装时，包需要自包含的 `prepare` 脚本。pnpm 10 要求用户在 profile 的 `pnpm-workspace.yaml` 中允许该包执行构建。如果不希望在安装时执行代码，请优先使用包含已构建产物的注册表包或 tarball。[打包并安装插件](../user/develop/basic/publish.md)定义了完整的 profile、组合包、Git 和信任工作流。

## 9. 让 agent 使用组件

agent 不会通过点击 React 组件来显示进度，而是调用 Host 工具。Studio 观察产生的持久工具事件，并选择带键的渲染器。

安装插件后启动会话，并发送：

```text
Create a five-part study plan for Cordis lifecycle. After listing the plan, call
study_progress for "Cordis lifecycle" with completed=1 and total=5. When I tell
you that I completed another lesson, call the tool again with the new count.
```

然后发送：

```text
I completed the next lesson.
```

验证以下结果：

1. 模型使用结构化参数调用 `study_progress`。
2. Host 校验并记录调用与结果。
3. Studio 根据准确的工具名称选择 `StudyProgressCard`。
4. 重新加载页面后，系统根据会话日志重建相同的已完成卡片。
5. 没有自定义组件的客户端仍会从 `output.render` 收到 `3 of 5 lessons complete`。

如果 UI 操作必须改变 agent 状态，请使用 Host 工具或 Remote 方法。按钮回调使用普通 JSON 调用该类型化操作；Host 会把所有模型可见的后果记录为会话事件。绝不能只在 React 中修改 Host 状态。

## 10. 从 Copilot 或 ACP 使用同一项能力

ACP 是面向编辑器的自动化传输协议。运行仓库提供的 ACP 组合：

```bash
pnpm --dir . run demo:acp
```

配置兼容 ACP 的客户端，使其通过 stdio 启动该命令，然后依次使用 `initialize`、`session/new` 和 `session/prompt`。权限请求通过 `session/request_permission` 到达；已提交的助手文本和图像通过 `session/update` 到达。

ACP 有意不传输 Studio React 组件、transcript（文本记录）回放、推理、计划、标题或工具展示。Copilot 等编辑器会根据协议能力渲染自己的控件。要公开 `study_progress`，请将其 Host 包添加到该客户端使用的 ACP 组合中。客户端会收到 agent 已提交的回答；更丰富的工具活动需要使用能够投影相应会话事件的传输协议。

请以 [ACP 包约定](../../packages/acp/acp/README.md)为准。不要把仅限 Studio 的交互描述为可移植到 ACP。

## 11. 使用 SDK 构建外部 UI

TypeScript 和 Python SDK 通过 JSON-RPC stdio 启动 DSH runtime，并返回根会话事件。应用负责把这些事件映射到自己的组件状态。

安装 Python 包并执行第一次调用：

```bash
python -m pip install deepseek-harness-sdk
```

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    cordis="/absolute/path/to/study-agent.cordis.yml",
) as harness:
    result = harness.run(
        "Build a five-part Cordis plan and report one completed lesson.",
        session_id="student-001",
    )

print(result.final_response)
for event in result.events:
    # Route tool/call and tool/result events into application-owned view models.
    print(event)
```

TypeScript 应用使用 `@deepseek-ai/dsh-sdk-client` 中的 `DeepSeekHarness`，并提供明确的 runtime 启动命令。当 UI 需要在工作执行期间接收通知时，请使用更底层的 `HarnessClient` 订阅。关闭 harness，让 runtime 子进程得到回收。

外部 UI 应当：

1. 启动或连接到受信任的 DSH runtime。
2. 创建或选择由应用拥有的会话。
3. 发送提示词。
4. 将有序会话事件归约为普通应用状态。
5. 使用应用的原生组件系统渲染该状态。
6. 为用户操作发送类型化命令或新提示词。
7. 仅当下一次交互需要继续当前对话时，才保留会话 id。

不要解析助手正文来恢复标识符或进度。请优先使用规范的工具值、持久元数据或专用会话事件。[TypeScript SDK](../../packages/sdk/client/README.md)、[Python SDK](../../python/sdk/README.md)和 [JSON-RPC 示例](../../examples/jsonrpc-agent/README.md)定义了受支持的进程生命周期与事件访问方式。

## 12. 测试组件和生命周期

请使用 4 个测试层级，每个层级验证不同属性。

### 组件测试

使用真实的运行中、成功、流式 JSON 格式不完整和失败块渲染 `StudyProgressCard`。断言无障碍文本、进度值和操作，不要断言 CSS 类名、渲染次数或 slot 内部实现。在组件 spec 的第一行添加 `// @vitest-environment jsdom`。

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StudyProgressCard } from '../src/client/StudyProgressCard.tsx'

describe('StudyProgressCard', () => {
  it('renders a completed checkpoint from durable metadata', () => {
    render(<StudyProgressCard {...completedToolProps} />)
    expect(screen.getByText('Cordis lifecycle')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '60')
    expect(screen.getByText('3 of 5 lessons')).toBeTruthy()
  })
})
```

请把 fixture 构建器保留在测试包中，不要为了测试而扩大插件的公开导出。

### 插件接线测试

创建真实的 Cordis `Context`，挂载 `SlotRegistry`，声明 `tool.call.toolview`，挂载 Client 插件，并断言出现 `study_progress` 配置项。dispose 插件 fiber 后，断言该配置项消失。这项验证是注册表贡献实现 HMR 安全所必需的证据。

可以把 [`ui-user-questions` 浏览器插件测试](../../packages/client/ui-user-questions/tests/browser-plugin.client.spec.ts)作为紧凑参考，把 [`ui-cordis`](../../packages/extensions/ui-cordis/src/client/index.ts)作为多 slot 生产示例。

### Host 工具测试

通过真实的工具注册表执行。测试有效进度、为零或负数的总数、超过总数的已完成数、执行变为异步后的取消行为、规范输出、模型渲染和展示元数据。请断言行为，不要直接调用 `execute`。

### 组装浏览器测试

面向产品用户的 UI 插件需要真实的 Loader 组合测试和浏览器快照。通过测试 `cordis.yml` 启动实际包；只 mock 模型或其他不确定的依赖。验证工具调用会生成预期的可见卡片，并且回放可以重建该卡片。

开发期间运行以下窄范围检查：

```bash
pnpm --filter dsh-study-progress test
pnpm --filter dsh-study-progress bundle
pnpm run test:gui
DSH_SNAPSHOT=replay pnpm run test:web
```

对于仓库内的官方包，还要运行改动文件要求的类型检查、lint、包约束、文档检查和推送前检查。[测试政策](../testing.md)定义了何时需要单元测试、覆盖率测试、真实 API 测试、快照测试和浏览器测试。

## 13. 验证安装结果

发布前，请完成以下验收检查：

1. `dsh --profile study --dump-config` 显示组合包和两个插件配置项。
2. Client 组合包以 `lib/client.js` 存在。
3. Studio 启动时没有 Loader 或模块图错误。
4. 模型 schema 包含 `study_progress`。
5. 工具调用在 Studio 中渲染自定义卡片。
6. 同一调用在没有自定义渲染器的客户端中仍提供有用文本。
7. 页面重新加载后可以重建已结算卡片。
8. dispose 插件后，工具和 slot 配置项都会移除。
9. 从分发的 tarball 或注册表产物把包重新安装到干净 profile 后，插件可以正常工作。
10. ACP 和 SDK 示例只描述各自协议实际公开的数据。

请检查打包后的包，不要仅依赖源码树：

```bash
pnpm pack
tar -tf dsh-study-progress-0.1.0.tgz
dsh plugin --profile clean-study add ./dsh-study-progress-0.1.0.tgz
dsh --profile clean-study --dump-config
```

归档必须包含所有已导出的 runtime 文件，且不得包含仅供源码使用的机密、凭据、测试 fixture 或陈旧构建输出。

## 14. 选择正确的 UI 模式

| 需求 | 推荐模式 |
|---|---|
| 在一个 Studio 进程中制作可见行为原型 | 动态 Cordis Client 插件 |
| 为一个工具调用提供专用 Studio 渲染 | 带键的 `tool.call.toolview` 配置项 |
| 渲染不依赖单个工具调用的持久工作流 | 会话节点定义和带键的渲染器 |
| 添加用户偏好 | 设置区段和设置卡片 |
| 添加导航或全局操作 | 已声明的侧边栏或布局 slot |
| 支持 ACP 编辑器 | Host 能力和 ACP 原生客户端 UI |
| 支持独立应用 | SDK 会话事件和应用原生 UI |
| 在 Studio 与另一个应用中共享同一个 React 组件 | 仅当两个构建系统都能拥有该组件时，才提取框架无关的库；不要让 React 节点跨越 DSH 进程边界。 |

## 15. 继续阅读生产参考

完成实验后，请以这些文档为准：

* [Web Client 包规则](../../packages/client/AGENTS.md)，包含 slot、属性、状态、依赖、样式和测试约束
* [Web 样式](../web-styling.md)，包含 token 和 CSS Module 规则
* [工具编写](adding-a-tool.md)，包含 schema、执行、模型渲染、持久元数据和通用 UI 意图
* [会话节点](adding-a-conversation-node.md)，用于可回放的业务行
* [包安装](../user/develop/basic/publish.md)，包含组合包和 profile 规则
* [架构](../architecture.md)，包含插件组合和持久会话事件
* [ACP](../../packages/acp/acp/README.md)，包含编辑器自动化限制
* [TypeScript SDK](../../packages/sdk/client/README.md)和 [Python SDK](../../python/sdk/README.md)，用于外部应用集成

所有目标都遵循同一条核心设计规则：agent 行为和持久事实由 Host 管理，展示由其所属客户端管理，每个 UI 都必须能根据类型化输入重建，不能依赖隐藏的实时状态。
