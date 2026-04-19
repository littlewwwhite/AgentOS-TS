# Pipeline State Contract

这个文档定义 `${PROJECT_DIR}/workspace/pipeline-state.json` 的最小统一约定。

目标：

- 为长流程提供统一、机器可读的断点恢复入口
- 保留各 skill 原有产物文件作为事实产物
- 让“状态 / 继续 / 跳转阶段 / 全流程执行”使用同一索引

## Core Rules

1. `pipeline-state.json` 是跨 skill 的状态索引，不替代最终产物。
2. 每个 stage 进入时必须先写 `running`。
3. 每次长任务中断点都应写 `partial` 或 `failed`，不能只依赖日志。
4. 每个 stage 完成并通过门控后写 `completed` 或 `validated`。
5. 文件不存在时，允许从现有 artifacts 重建，但重建属于 fallback。

## Required Top-Level Keys

```json
{
  "version": 1,
  "updated_at": "2026-03-25T12:00:00Z",
  "current_stage": "SCRIPT",
  "next_action": "enter VISUAL",
  "last_error": null,
  "stages": {},
  "episodes": {}
}
```

## Stage Keys

固定 stage 名称：

- `INSPIRATION`
- `SCRIPT`
- `VISUAL`
- `STORYBOARD`
- `VIDEO`
- `EDITING`
- `MUSIC`
- `SUBTITLE`

每个 `stages.<STAGE>` 最少包含：

```json
{
  "status": "running",
  "updated_at": "2026-03-25T12:00:00Z",
  "artifacts": [],
  "notes": null
}
```

## Episode Keys

从 producer 阶段开始，按 `ep{NNN}` 记录子状态：

```json
{
  "ep001": {
    "storyboard": {
      "status": "completed",
      "artifact": "output/ep001/ep001_storyboard.json"
    },
    "video": {
      "status": "partial",
      "artifact": "output/ep001/ep001_delivery.json"
    },
    "editing": {
      "status": "not_started"
    },
    "music": {
      "status": "not_started"
    },
    "subtitle": {
      "status": "not_started"
    }
  }
}
```

## Status Values

- `not_started`
- `running`
- `partial`
- `failed`
- `completed`
- `validated`

推荐语义：

- `running`: 已进入阶段，正在执行
- `partial`: 已产生中间产物，但门控未满足
- `failed`: 执行失败，需要人工或重试
- `completed`: 目标产物已经写出
- `validated`: 完成且已通过门控校验

## Minimum Artifact Mapping

- `INSPIRATION` → `output/inspiration.json`
- `SCRIPT` → `output/script.json`
- `VISUAL` → `output/actors/actors.json`, `output/locations/locations.json`, `output/props/props.json`
- `STORYBOARD` → `output/script.json` and optional `workspace/storyboard/ep{NNN}.shots.json`
- `VIDEO` → `output/ep{NNN}/ep{NNN}_storyboard.json`, `output/ep{NNN}/ep{NNN}_delivery.json`
- `EDITING` → `output/ep{NNN}/ep{NNN}.mp4`, `output/ep{NNN}/ep{NNN}.xml`, `output/editing_summary.json`
- `MUSIC` → `output/ep{NNN}/ep{NNN}_final.mp4`, `output/ep{NNN}/ep{NNN}_final.xml`
- `SUBTITLE` → `output/ep{NNN}/ep{NNN}.mp4`, `output/ep{NNN}/ep{NNN}.xml`, `output/ep{NNN}/ep{NNN}.srt`

## Recovery Rules

恢复顺序：

1. 先读取 `pipeline-state.json`
2. 如果缺字段或状态明显过旧，再扫描对应 artifacts
3. 扫描结果只用于补全缺失字段，不应覆盖更新鲜的显式状态

## Merge-Sensitive Stage Rule

`storyboard` 是共享写热点。为避免并行任务只返回内存结果导致恢复点丢失：

1. 子任务完成后，先把每集结果写到 `workspace/storyboard/ep{NNN}.shots.json`
2. 主 session 合并进 `output/script.json`
3. 合并成功后，再把 `episodes.ep{NNN}.storyboard.status` 置为 `completed` 或 `validated`
