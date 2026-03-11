# apis/

API 配置注册表 — YAML 声明式定义外部 API 的端点、认证、轮询策略和速率限制。由 `src/task-queue/registry.ts` 加载，驱动 executor 行为。

| 文件 | Provider | 功能 |
|------|----------|------|
| `animeworkbench-image.yaml` | animeworkbench | 图片生成 API（maxConcurrent: 3, polling: 5s） |
| `animeworkbench-video.yaml` | animeworkbench | 视频生成 API（maxConcurrent: 2, polling: 10s） |
