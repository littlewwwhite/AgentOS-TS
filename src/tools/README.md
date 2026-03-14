# src/tools

自定义 MCP 工具集，以 in-process MCP server 形式挂载到 Agent。`index.ts` 作为注册中心，按需组合各工具服务器。

## 文件清单

| 文件/目录 | 地位 | 功能 |
|:----------|:-----|:-----|
| `index.ts` | 注册中心 | 将各子模块工具封装为具名 MCP server，提供 `createToolServers()` 工厂函数 |
| `awb/` | AWB 工具组 | AnimeWorkBench 平台 API 基础设施（认证、COS 上传、任务提交/轮询） |
| `audio.ts` | 音频工具 | TTS、音效、音乐生成 |
| `image.ts` | 图像工具 | 图片生成与超分辨率放大 |
| `video.ts` | 视频工具 | 视频生成与状态查询 |
| `script-parser.ts` | 剧本解析 | 从 `draft/` 读取并写出到 `output/` 的确定性 regex 解析器 |
| `source.ts` | 源结构 | 检测和准备素材源项目结构 |
| `source-structure.ts` | 结构定义 | 源项目目录结构类型与常量 |
| `storage.ts` | 存储工具 | JSON 读写、静态资产保存与枚举 |
| `workspace.ts` | 工作区检查 | 验证工作区目录约定是否满足 |
| `agent-switch.ts` | 工具切换 | Agent 运行时动态切换工具服务器 |
