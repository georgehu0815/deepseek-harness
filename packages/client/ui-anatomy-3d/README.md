# @deepseek-ai/dsh-client-ui-anatomy-3d

English | [中文](README.zh.md)

Browser Client plugin for the anatomy explorer. It registers a `sidebar.footer.action` launcher and a `shell.overlay`; the overlay renders the Three.js anatomy explorer from `/models/*.glb`. The package has no Host behavior.

## Model Experience

None, as this browser Client plugin registers presentation slots and nothing reaches a model request.

#### KV Cache effect

None; this package does not assemble or send model requests.

## Known Limitations and Deferred Work

- Requires a web browser with WebGL support.
- Model loading depends on static GLB assets deployed at the exact `/models/*.glb` URLs.
- Anatomy labels and content are English only.
