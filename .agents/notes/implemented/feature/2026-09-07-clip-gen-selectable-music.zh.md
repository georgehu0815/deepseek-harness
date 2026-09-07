# Agent Note: 共享录制时序的 Clip Gen 可选配乐

Status: implemented

English | [中文](2026-09-07-clip-gen-selectable-music.md)

## Problem

读者可以在聊天中试听音乐链接，但这不会将它变成编排机器人片段的配乐。在编辑器中选择音乐还必须影响实际导出的 MP4，而不只是实时预览或标签。完整录音通常远长于动作参考，外部媒体来源也可能消失或拒绝浏览器音频解码。

## Decision

[Clip Gen](../../../../packages/client/ui-robot-lab/README.zh.md#clip-gen)保留每个舞蹈的原创节奏，并增加三个带署名的精选 SoundHelix 片段。它们不是排行榜推荐。内嵌来源元数据保留录音 URL、许可文本、源文件／输出哈希、估计速度及截取偏移；[NOTICE](../../../../packages/client/ui-robot-lab/NOTICE)保留署名条款。原生试听控件不自动选定曲目。单选组拥有当前会话的唯一选择，更改时停止动作并使人工检查失效，录制期间锁定。不引入模型、训练或硬件操作。

片段覆盖估计的 32 拍网格，离线统一到 120 BPM，并在接缝处加入短淡入淡出。同一个已解析配乐将来源、时长、播放速率及重复标记交给预览时钟和录像器。原创节奏保留完整周期的时长缩放；备选配乐使用编排 BPM 除以源 BPM 的速率，并循环填满片段。修改时长时，BPM 与关键帧时间同步缩放。播放速率也改变音高；不提供运行时时间拉伸。音频时钟累计配乐循环，不因此重启较长的舞蹈；完整动作循环则重启配乐相位。估计节拍网格不是动作与音乐同步的证明。

生成的有声和静音版本保留同次录制的已选来源及署名。选择其他曲目不会修改旧视频，但会将其修订标为过期；改变视频字节需要重新生成。录制时的署名可查看并下载为配套 JSON，不烧录到画面。分享使用 SoundHelix 配乐的 MP4 必须注明作者与 SoundHelix。音频选择仍不属于动作 JSON 或保存的指南序列。

## Alternatives considered

**运行时流式播放完整远程 MP3。** 原生试听可以播放远程 URL，但没有适当跨源许可时，Web Audio 导出无法解码它。打包获准使用的片段让两条路径都能读取相同的已选字节，无需代理或运行时网络依赖。

**将整首歌曲压缩到每个片段。** 将数分钟录音压缩到短动作会使速度远离编排节拍网格。重复有界片段保留所选速度关系，并限制随包字节量。

**单选项变化时替换已完成视频的配乐。** 这会将经过检查的录制与后续草稿结合，并需要另一次封装操作。不可变的成对录制保留署名和检查身份；用户明确重新生成。

## Testing

[配乐方案](../../../../packages/client/ui-robot-lab/tests/clip-soundtrack.client.spec.ts)、[音频时钟](../../../../packages/client/ui-robot-lab/tests/clip-audio.client.spec.ts)、[面板控件](../../../../packages/client/ui-robot-lab/tests/clip-gen-panel.client.spec.tsx)、[仿真](../../../../packages/client/ui-robot-lab/tests/clip-simulation.client.spec.tsx)及[成对录制](../../../../packages/client/ui-robot-lab/tests/clip-movie.client.spec.ts)覆盖唯一选择、试听不选定、替换、检查与录制锁、来源保留、速度、重复片段及录制署名。[组装工作流](../../../../apps/web/tests/robot-studio.snapshot.ts)使用前置 RPC 和模拟播放记录已构建的单选控件及所选来源。独立的[原生浏览器测试](../../../../apps/web/tests/clip-music-export.e2e.ts)使用已发射辅助模块、真实 Web Audio 和 MediaRecorder 解码三个片段，并生成解码后音频非零的 MP4；其画布为测试图形，不是机器人渲染证据。

## Consequences

三个片段在 base64 展开前增加约 755 KB 编码音频。插件加载后可离线使用，但选择和生成媒体仍是临时浏览器状态。原生媒体时序及估计源网格不保证逐帧精确的节拍同步；用户必须同时检查音乐和动作。浏览器编解码器可用性及已有录制失败行为保持不变。

[原生 Clip Gen 决策](2026-09-05-microduck-native-clip-gen.zh.md)继续负责动作编写、原创节奏、共享状态及录制所有权；此新增功能仅扩展配乐选择。[Markdown 内嵌播放器](2026-09-07-web-inline-markdown-audio.zh.md)保留独立的远程链接呈现策略。两者均未被完整替代，也不归档。
