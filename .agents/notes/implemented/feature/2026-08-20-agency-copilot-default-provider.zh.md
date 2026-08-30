# Agent Note: Agency Copilot is the shipped default model provider

Status: implemented

[English](2026-08-20-agency-copilot-default-provider.md) | 中文

## 问题

基础 bundle 原先选择直接 DeepSeek 路由，但 harness 已有能够服务 Anthropic Messages 端点的通用适配器。Agency Copilot 通过该协议提供 Claude Code 模型，同时要求独立端点、凭据引用与集成请求头。把它实现为另一套直接适配器会重复消息转换、流式处理、回放、取消和错误归一化，却没有引入新的协议格式。

## 决策

基础 bundle 将 `agency-copilot` 声明为 `dsh-llm-pi-ai` 提供方 profile。该 profile 使用 `anthropic-messages` 协议，通过 `ctx.credentials` 解析 `CLAUDE_CODE_COPILOT_TOKEN`，发送 `Copilot-Integration-Id: copilot-developer-cli` 与 `Editor-Version: vscode/1.96.0`，并公布支持文本和图像输入的 `claude-opus-4-8`。`agent-default-model` 选择该路由和模型。

该 profile 设置 `authMode: bearer`，以 `Authorization: Bearer` 发送解析出的 Copilot 访问令牌，而不是使用 Anthropic `x-api-key`。通用适配器对其他 profile 仍默认使用 API 密钥认证。

`@deepseek-ai/dsh-llm-pi-ai` 导出 `AGENCY_COPILOT_PROVIDER` 与 `DEFAULT_COPILOT_MODEL`，供程序化消费者使用相同标识符。直接 `deepseek-official` 适配器仍然挂载且可选；该决策只更改发行版默认值，不移除提供方。

该 profile 位于 `packages/bundle/base/cordis.patch.yml`，因为部署默认值属于该位置。用户 settings 按提供方合并，可以替换其令牌引用、端点、请求头、模型列表或传输设置，无需新增适配器实现。

通用适配器始终向 `ctx.credentials` 请求 profile 中精确的 `CLAUDE_CODE_COPILOT_TOKEN` 引用。发行版自带的 `credentials-local` 在四层精确引用来源之下负责 Agency 专用发现：先按顺序检查进程环境别名，再检查 macOS 或 Windows 上已登录 `copilot-cli` 的 OS 凭据。Linux 没有 OS 存储回退。存储精确引用会覆盖这些回退，而适配器无需了解别名或凭据存储。

## 考虑过的替代方案

**新增专用 Agency Copilot 适配器。** 把令牌别名与平台凭据存储查找放进协议适配器，会重复现有 pi-ai Anthropic 的请求与流行为，也会把本地凭据策略混入通用适配器。`credentials-local` 可以解释精确的 profile 引用，同时保持适配器中立。只有 Agency Copilot 偏离 Anthropic Messages 协议，或需要凭据能力无法表达的认证时，独立适配器才合理。

**将现有 `anthropic` catalog 路由指向 Agency Copilot。** 这会继承不属于该部署的 catalog 行为，并把 Anthropic 公共服务与独立认证网关混为一体。独立路由让端点、凭据与提供方身份保持明确。

**从基础 bundle 移除直接 DeepSeek 适配器。** 更改默认值不要求移除可用的备选路由。保留它可以继续支持显式 DeepSeek 选择与用户 settings。

## 结果

新 profile 选择 Agency Copilot Claude Opus 4.8。首次启动在版本化内部测试欢迎声明之后无需任何凭据提示：`credentials-local` 会自动检查精确引用来源、有序环境别名，以及 macOS 或 Windows 上已登录的 `copilot-cli` 存储。Linux 没有 OS 存储回退。用户可以选择在 Models 中把替代值存入精确引用 `CLAUDE_CODE_COPILOT_TOKEN`，从而覆盖别名与 CLI 存储回退，且不会向 settings 或浏览器响应暴露该值。已有保存的模型选择仍优先于组合默认值。Agency Copilot 请求共享通用适配器的流、回放、图像、重试、超时与归因行为，而 Copilot 专用端点和请求头保持为可见且可覆盖的配置。

基础 bundle 组合测试固定路由、模型、端点、协议、令牌引用、输入模态与集成请求头。pi-ai 适配器测试继续负责协议转换、凭据解析、配置请求头合并、取消与终止流行为。
