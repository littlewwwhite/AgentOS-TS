# src/engine/

项目引擎 — Project / Phase / Checkpoint 数据模型与 DAG 调度器，支持审阅-打回-修改循环。

| 文件 | 地位 | 功能 |
|------|------|------|
| `schema.ts` | 类型定义 | Project / Phase / Checkpoint 接口与状态枚举 |
| `store.ts` | 持久层 | SQLite 存储（projects / phases / checkpoints 三表，FK CASCADE） |
| `scheduler.ts` | 调度核心 | DAG 依赖推进、Phase 完成级联、Checkpoint 审阅决策处理 |
| `checkpoint.ts` | MCP 接口 | create_checkpoint / resolve_checkpoint / list_checkpoints 三个 MCP tool |
| `memory.ts` | 记忆层 | 审阅反馈提炼 → project memory 文件，agent 唤醒时注入 context |
| `index.ts` | 桶导出 | 统一导出 |
