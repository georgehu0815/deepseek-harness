# Agent Note: mcp-client per-server tool allowlist

Status: implemented

[English](2026-08-28-mcp-client-tool-allowlist.md) | 中文

## 问题

`mcp-client` 会注册 MCP 服务器声明的每一个工具。同时组合多个服务器会撑爆模型可用的工具预算:单个 Azure DevOps 服务器就暴露约九十个工具,而 DeepSeek 的函数名数组无法容纳众多此类服务器的并集。Claude Code 插件已在其 `.mcp.json` 中通过把每个服务器的 `tools` 数组收窄到插件实际调用的少数几个来解决这一问题,但 DSH 没有对等能力,因此对这类插件的忠实导入无法保持在工具预算之内。这一缺口也阻碍了原生 Claude Code 插件支持,其 MCP 转换步骤(`.mcp.json` → `cordis.yml`)需要一个字段来承载每个服务器的允许清单。

## 决策

`Config` 在 stdio 与 Streamable HTTP 两种变体上都新增一个可选的 `allowedTools?: string[]`。当存在时,只有原始名称匹配某一条目的服务器工具才会被注册;省略该字段则保持此前注册全部工具的行为。每个条目是一个精确的原始名称,或一个 `prefix*` 通配符,其结尾的 `*` 匹配任意后缀;单独的 `*` 匹配一切,因此 `["*"]` 等价于省略。

匹配在 MCP 服务器自身的原始工具名上进行,发生在公开名归一化之前,位于 `syncTools` 第一阶段——即一个被发现的工具成为 `ctx.tools` 注册项的唯一节点。被丢弃的工具永远不会到达注册表或模型。纯匹配器 `toolAllowed(rawName, allowlist)` 被导出供转换工具与测试使用。

`allowedTools` 是一个经校验的 `Config` 字段(`z.array(String)`,保留省略语义,故缺省值保持为 `undefined`),在 `startConnection` 中被解析进 `ToolBridgeOptions`——这是包边界上显式的解析步骤,而非同步循环内部隐藏的默认值。该字段与一个代际的其余部分共享同一受 effect 作用域约束的生命周期:释放一个同步代际会恰好注销允许清单所接纳的那些工具,对其丢弃的工具不留残留。

## Alternatives considered

**用拒绝清单替代允许清单,或二者兼有。** 消费者证据——Claude Code `.mcp.json` 的 `tools` 数组——是一份允许清单,而预算问题正是"只保留需要的少数几个",允许清单直接表达了这一点。代码库别处的 `ToolRestriction` 同时携带 `allow` 与 `deny`,但在没有现实消费者的情况下在此处新增 `deny` 会是无支撑的表面;待真实需求出现时可再添加。

**在调用时或在 `ctx.tools` 守卫处过滤,而非在注册时。** 守卫仍会注册每个工具,故模型仍能看到并调用它们——工具预算问题恰恰就是已注册工具的数量,因此决策必须在注册发生处执行。在注册处过滤还意味着被丢弃的工具不会在请求中留下任何 schema token。

**匹配公开的 `mcp__<server>__<tool>` 名称。** 插件作者在 `.mcp.json` 中写的是原始名称,而公开名是一种有损的归一化(冲突时会哈希),因此匹配原始名称能让允许清单针对作者所知的名称来书写,并避免把过滤器耦合到归一化细节上。

**用正则表达式替代 `prefix*` 通配符。** 参考用的 Claude Code harness 与手头的插件都使用精确名称与简单前缀通配符;完整的正则方言是不必要的表面,且在 YAML 中是个陷阱。精确 + 结尾 `*` 覆盖了所有已观察到的情形。

## Testing

`packages/mcp/mcp-client/tests/mcp-client.spec.ts` 为 `toolAllowed` 增加了单元覆盖(精确、`prefix*`、单独 `*`、空清单),并通过真实的 `ToolRuntime` 增加了集成覆盖:允许清单只注册匹配的工具、缺省字段注册全部、以及释放一个被允许的代际会注销所接纳的工具且对丢弃的工具不留残留——这是注册表贡献的 HMR 安全契约。

## Consequences

现在一个部署可以组合众多 MCP 服务器,并通过收窄每个服务器把模型的工具数组保持在预算之内,这正是忠实导入 Claude Code 插件 `.mcp.json` 的使能改动。默认行为不变:没有 `allowedTools` 时,每个服务器工具都照旧注册,因此不影响任何既有组合。README 记录了该字段及其面向模型的效果——被丢弃的工具既不到达注册表也不进入请求。

## Related

这为 [MCP client plugin](2026-07-07-mcp-client-plugin.md) 所定义的插件新增了一个字段;那篇 Agent Note 拥有连接、发现与公开名机制,而 [MCP client auto-reconnect](2026-08-06-mcp-client-auto-reconnect.md) 拥有被允许的代际所参与的重连生命周期。二者仍是各自决策的权威。
