# src/task-queue/

异步任务队列 — Agent 通过 MCP tool 提交长耗时任务（图片/视频生成），任务在主机侧独立运行，不依赖 agent session。

| 文件 | 地位 | 功能 |
|------|------|------|
| `store.ts` | 持久层 | SQLite 任务存储（状态机：pending → submitted → processing → completed/failed） |
| `queue.ts` | 核心引擎 | 提交、轮询、重试、并发限制、生命周期管理 |
| `executor.ts` | 执行层 | API 调用执行器接口 + AnimeworkbenchExecutor 实现 |
| `registry.ts` | 配置层 | 从 `apis/*.yaml` 加载 API 配置，驱动 executor 行为 |
| `tools.ts` | MCP 接口 | submit_task / check_tasks / cancel_task / download_result 四个 MCP tool |
| `index.ts` | 桶导出 | 统一导出 |
