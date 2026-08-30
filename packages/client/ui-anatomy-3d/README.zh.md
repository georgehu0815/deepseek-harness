# @deepseek-ai/dsh-client-ui-anatomy-3d

[English](README.md) | 中文

用于解剖探索器的浏览器 Client 插件。它注册一个 `sidebar.footer.action` 启动入口和一个 `shell.overlay`；该 overlay 从 `/models/*.glb` 渲染 Three.js 解剖探索器。本包没有 Host 行为。

## 模型体验

无。这个浏览器 Client 插件只注册展示 slot，没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送模型请求。

## 已知限制与暂缓事项

- 需要支持 WebGL 的 Web 浏览器。
- 模型加载依赖部署在精确 `/models/*.glb` URL 下的静态 GLB 资产。
- 解剖标签和内容仅提供英文。
