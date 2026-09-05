# Agent Note: 浏览器上报当前视图 → 模型可见的 `geo/view` 事件

状态：提议中

领域：地理空间、客户端、会话。扩展（而非取代）[Terra port 的 Geo 域层](2026-08-21-design-terra-geo-plugin-dsh.zh.md)：该文档拥有 agent→Earth `geo/command` 通道和域层；本笔记增加了反向浏览器→Host 视图报告，以及消费它的分割缝（seam）。

## 问题

Agent 可以*驱动*3D Earth 相机（`control_camera`, `draw_*`, `set_basemap`），但无法*观察*它。模型看到的唯一“当前视图”源自 `@deepseek-ai/dsh-geo-viewcontext` 的派生文本，该上下文根据 agent 自身的上一条类型为 `camera` 的 `geo/command` 重建边界框（`packages/geo/geo-viewcontext/src/index.ts` 中的 `latestCameraPose` + `viewport.ts` 中的 `deriveViewBBox`）。后果如下：

- 当用户手动平移、缩放或倾斜地球仪时，agent 无法获知。
- 注入的边界框是基于 `{lat, lon, height}` 启发性得出的，而非屏幕上真实的矩形。
- agent 无法针对“当前视图中有什么”进行推理，也无法用真实边界回答诸如“对当前视图中的每个特征执行 X"之类的请求。

目标：让浏览器**上报其真实的相机视图**给会话，使该视图对模型可见且重放正确；允许 agent **拉取（pull）**并基于此推理；进而使用该真实视图调用 **SAM 分割后端**（SamGeo），将屏幕上的影像转换为矢量足迹（例如每栋房屋/建筑一个多边形），并将其绘制回地球仪上。

## 非目标

- 不为相机状态设立专用 WebSocket（在 Terra port 笔记中已被否决：无法重放）。
- 没有同步的“立即读取浏览器”工具调用。模型读取的是*已记录的*视图状态，而非实时 DOM。
- 不重新实现分割功能。分割工作委托给现有的 **SamGeo** 服务；DSH 仅负责编排（获取视图影像 → POST → 绘制返回的 GeoJSON）。

## SamGeo 后端服务

位于 `/Volumes/ExternalSSD/geoagent/segment-geospatial` 的代码库是 **SamGeo**（`segment-geospatial` v1.4.2）—— Meta 用于地理空间栅格图像的 Segment Anything Model (SAM/SAM2/SAM3)。它提供一项 **FastAPI REST 服务** (`samgeo/api.py`)，可通过 `samgeo-api` 或 `uvicorn samgeo.api:app` 启动（默认端口 8000），接收一个地理配准的图像并返回坐标为地理坐标系格式的 **GeoJSON**。相关端点如下：

| 端点 | 输入 (multipart form) | 输出 |
|---|---|---|
| `GET /health` | — | 存活状态检查 |
| `GET /models` | — | 可用的 SAM 模型列表 |
| `POST /segment/text` | `file` (TIFF/PNG/JPEG), `prompt` (例如 `"building"`, `"house"`), `output_format=geojson\|detections`, `confidence_threshold`, `min_size`, `max_size` | SAM3 文本提示掩码 → GeoJSON FeatureCollection（足迹多边形）或 `detections`（边界框多边形 + 置信度分数），坐标为地理格式 |
| `POST /segment/automatic` | `file`, `output_format` | 分割所有对象 → GeoJSON |
| `POST /segment/predict` | `file`, point/box prompts, `output_format` | 提示掩码 → GeoJSON |

带有 `prompt="house"` (或 `"building"`) 的 `/segment/text` 是直接回答“为当前视图中的每栋房屋绘制一个多边形”的方案：它会为检测到的每个房屋发射一个多边形特征，且坐标已转换为经度/纬度。CORS 设置为 `*`，因此它是一个自包含的 HTTP 服务，DSH 将其视为外部提供者——仅从 **Host** 平面访问，绝不直接从浏览器访问。

需要当前视图的地理配准栅格图像。SamGeo 本身可以下载瓦片（TMS → GeoTIFF）；或者 DSH 为报告的 `bbox` 获取静态地图/瓦片图像并发送 POST。

### 选定的后端：MLX SAM3 `/segment/geo` (已实现)

`segment-geospatial` FastAPI (`samgeo/api.py`) 对像素不敏感，但其 SAM3 后端基于 `meta`/`transformers` (CPU/CUDA torch)，无法在此 Apple Silicon Host 上原生运行。真正的、可运行的 SAM3 位于 `segment-geospatial/mlx_sam3`（原生 MLX；`app/backend/main.py` 已在 :8000 端口提供 `/upload`, `/segment/text` 等服务，但处于**像素空间**——通过上传→会话流程返回 RLE 掩码和 xyxy 像素框）。为了给 DSH 提供一个