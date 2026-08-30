# 实操手册：恢复中断的 pnpm 安装

[English](recovering-an-interrupted-pnpm-install.md) | 中文

当 `pnpm install` 报告 `ERR_PNPM_OUTDATED_LOCKFILE`，而后续命令又报告缺少模块时，请使用此流程。该流程可以恢复工作区，且不会丢弃源码更改或手工编辑生成的安装数据。

## 诊断故障

当工作区包的 manifest（元数据清单）已更改，但 `pnpm-lock.yaml` 中相应的 importer 仍然陈旧时，`ERR_PNPM_OUTDATED_LOCKFILE` 是主要故障。冻结安装会拒绝解析不同的依赖输入，因为 CI 与本地安装必须使用同一份已声明依赖图。

随后报告的模块缺失通常是次生症状。pnpm 可以在停止前开始重建 `node_modules`，导致安装树不完整，而锁文件仍描述较早的工作区输入。

保留所有已暂存和未暂存的工作。不要重置 `pnpm-lock.yaml`、删除 `node_modules`、手工编辑生成的锁文件条目，也不要为缺失模块创建手工符号链接。

## 1. 重新生成锁文件

配置的 registry 可访问时，只重新生成锁文件：

```sh
pnpm install --lockfile-only --no-frozen-lockfile
```

重建依赖前检查生成的更改：

```sh
git diff -- pnpm-lock.yaml
```

每个已更改工作区包的 importer 都必须包含其声明的依赖，以及指向工作区包的预期 `link:` 目标。让 pnpm 更新所有相关的 resolution 和 snapshot 条目，不要手工编辑这些条目。

## 2. 恢复依赖

从已接受的锁文件重建安装树：

```sh
pnpm install --frozen-lockfile
```

冻结安装此时会验证重新生成的依赖图，同时恢复中断安装可能遗漏的包与链接。

## 从本地缓存恢复

registry 访问失败，且本地 pnpm store 已包含所需的包元数据与内容时，请使用离线模式：

```sh
pnpm install --lockfile-only --no-frozen-lockfile --offline
pnpm install --frozen-lockfile --offline
```

如果 Corepack 无法在 macOS 上启动 pnpm，请读取仓库固定的版本，并通过 Node.js 调用其缓存的可执行文件：

```sh
pnpm_version=$(node -p \
  "require('./package.json').packageManager.split('@').at(-1)")
pnpm_cjs=$(find "$HOME/Library/pnpm/.tools/pnpm/$pnpm_version" \
  -path '*/node_modules/pnpm/bin/pnpm.cjs' -print -quit)
test -n "$pnpm_cjs"

node "$pnpm_cjs" install \
  --lockfile-only --no-frozen-lockfile --offline
node "$pnpm_cjs" install --frozen-lockfile --offline
```

离线解析错误表示缓存缺少所需的元数据或内容。请恢复 registry 访问，不要削弱冻结锁文件检查或供应链检查。

## 验证修复

确认 CI 接受锁文件、生成的 diff 有效，并且受影响的包通过聚焦检查：

```sh
CI=true pnpm install
git diff --check -- pnpm-lock.yaml
pnpm run typecheck
```

检查 `pnpm-lock.yaml`，确认每个新增或已更改的工作区包都有 importer。工作区 glob 下新增的包会立即加入依赖解析；如果提交其 manifest 时未包含生成的 importer，下一次冻结安装将失败。

对于点名 `anthropic-messages.js` 的 `PI_AI_ERROR`，请验证已恢复的包并运行适配器测试：

```sh
test -f packages/llm/llm-pi-ai/node_modules/\
@earendil-works/pi-ai/dist/api/anthropic-messages.js
pnpm exec vitest run \
  packages/llm/llm-pi-ai/tests/adapter.spec.ts
```

重新运行最初报告缺少模块的命令。`Lockfile is up to date` 和 `Already up to date` 表示冻结解析器接受该依赖图，且安装树已恢复。

macOS 上不支持 Linux 包的警告或循环工作区依赖警告都属于提示信息，除非 pnpm 以失败状态退出或报告依赖解析错误。

## 两个阶段为何有效

`pnpm-lock.yaml` 中的 importer 是工作区已声明依赖图的权威记录。先重新生成 importer，可以在安装状态再次变化之前使包 manifest 与锁文件一致。

`node_modules` 是安装状态，而不是依赖真源。从已接受的依赖图重建它会恢复完整安装树；只修复一个文件或符号链接可能掩盖更大范围的不一致。
