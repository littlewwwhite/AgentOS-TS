# Pipeline State Contract

这个文档定义项目根目录下 `pipeline-state.json` 的最小统一约定。

文中所有 artifact 路径一律使用**项目根相对路径**（如 `output/script.json`、`output/storyboard/draft/ep001_storyboard.json`），避免再引入 `${OUTPUT}` 一类额外路径宏。

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
6. 人工介入只允许发生在**合法业务节点**，而不是任意文件。
7. 上游 source / canonical artifact 被修改后，受影响下游必须标记为 `stale` 或 `change_requested`。
8. 已 `locked` 的产物不得被下游静默修改；如需返修，必须创建 change request。

## Recommended Writer Surface

推荐通过共享 CLI 修改状态，而不是让每个 skill 各自手写 JSON：

```bash
python3 ./scripts/pipeline_state.py ensure --project-dir "${PROJECT_DIR}"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage SCRIPT --status running --next-action "review SCRIPT"
python3 ./scripts/pipeline_state.py artifact --project-dir "${PROJECT_DIR}" --path output/script.json --kind canonical --owner-role writer --status completed
python3 ./scripts/pipeline_state.py episode --project-dir "${PROJECT_DIR}" --episode ep001 --kind video --status partial --artifact output/ep001/ep001_delivery.json
```

约定：

- `ensure`：文件不存在时创建最小结构
- `stage`：更新阶段状态、当前阶段、下一步
- `artifact`：更新显式 artifact 索引
- `episode`：更新单集子状态

文件扫描与从 artifacts 重建状态，始终只作为 fallback，不应覆盖更新鲜的显式状态。

## Required Top-Level Keys

```json
{
  "version": 1,
  "updated_at": "2026-03-25T12:00:00Z",
  "current_stage": "SCRIPT",
  "next_action": "enter VISUAL",
  "last_error": null,
  "stages": {},
  "episodes": {},
  "artifacts": {},
  "change_requests": []
}
```

## Stage Keys

当前主流程固定 stage 名称：

- `SCRIPT`
- `VISUAL`
- `STORYBOARD`
- `VIDEO`
- `EDITING`
- `MUSIC`
- `SUBTITLE`

`INSPIRATION` 当前不是默认主流程 stage，不参与默认 `pipeline-state.json` 初始化、恢复决策和 MVP UI 进度。`script-writer` 可作为上游创作/灵感扩写入口，产物保存在 `draft/`，但不应把 S1-S8 创作过程直接映射为正式 `SCRIPT` 阶段运行中。

历史项目中若存在 `stages.INSPIRATION`、`output/inspiration.json` 或 `wangwen` 产物，应作为上游创作/市场依据保留。正式 `SCRIPT` 阶段从解析、映射分析、资产分析、剧情拆解与 `output/script.json` 契约交付开始。

每个 `stages.<STAGE>` 最少包含：

```json
{
  "status": "running",
  "updated_at": "2026-03-25T12:00:00Z",
  "artifacts": [],
  "notes": null
}
```

扩展字段（推荐）：

```json
{
  "owner_role": "writer",
  "revision": 3,
  "locked": false
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

## Artifact Keys

推荐为关键 source / canonical / derived artifact 建立显式索引：

```json
{
  "output/script.json": {
    "kind": "canonical",
    "owner_role": "writer",
    "status": "approved",
    "editable": true,
    "revision": 3,
    "depends_on": [
      "draft/design.json",
      "draft/catalog.json",
      "draft/episodes/ep001.md"
    ],
    "invalidates": [
      "output/storyboard/draft/ep001_storyboard.json",
      "output/ep001/ep001_storyboard.json"
    ],
    "updated_at": "2026-03-25T12:20:00Z",
    "notes": null
  }
}
```

字段语义：

- `kind`: `source` / `canonical` / `derived` / `control`
- `owner_role`: 该 artifact 的业务责任方
- `status`: 该 artifact 当前生命周期状态
- `editable`: 是否允许人工作为合法业务节点编辑
- `revision`: 修改递增版本
- `depends_on`: 该 artifact 的直接输入
- `invalidates`: 该 artifact 变动后将失效的直接下游

## Change Requests

当下游发现上游主契约需要返修时，不应静默修改上游，而应写入 change request：

```json
[
  {
    "id": "cr_001",
    "target_artifact": "output/script.json",
    "requested_by_role": "director",
    "reason": "scene motivation mismatch",
    "created_at": "2026-03-25T12:30:00Z",
    "status": "open"
  }
]
```

`status` 推荐值：

- `open`
- `accepted`
- `rejected`
- `resolved`

## Status Values

- `not_started`
- `running`
- `partial`
- `failed`
- `completed`
- `validated`
- `in_review`
- `approved`
- `locked`
- `change_requested`
- `stale`
- `superseded`

推荐语义：

- `running`: 已进入阶段，正在执行
- `partial`: 已产生中间产物，但门控未满足
- `failed`: 执行失败，需要人工或重试
- `completed`: 目标产物已经写出
- `validated`: 完成且已通过门控校验
- `in_review`: 产物已生成，等待审核
- `approved`: 审核通过，可作为下游输入
- `locked`: 已锁版，下游不得静默修改
- `change_requested`: 下游或审查方要求上游返修
- `stale`: 上游变化导致当前产物不再可信
- `superseded`: 被更新版本替代，保留用于审计

## Minimum Artifact Mapping

- `SCRIPT` → `output/script.json`
- `VISUAL` → `output/actors/actors.json`, `output/locations/locations.json`, `output/props/props.json`
- `STORYBOARD` → `output/storyboard/draft/ep{NNN}_storyboard.json`, `output/storyboard/approved/ep{NNN}_storyboard.json`
- `VIDEO` → `output/ep{NNN}/ep{NNN}_storyboard.json`, `output/ep{NNN}/ep{NNN}_delivery.json`
- `EDITING` → `output/ep{NNN}/ep{NNN}.mp4`, `output/ep{NNN}/ep{NNN}.xml`, `output/editing_summary.json`
- `MUSIC` → `output/ep{NNN}/ep{NNN}_final.mp4`, `output/ep{NNN}/ep{NNN}_final.xml`
- `SUBTITLE` → `output/ep{NNN}/ep{NNN}.mp4`, `output/ep{NNN}/ep{NNN}.xml`, `output/ep{NNN}/ep{NNN}.srt`

## Recovery Rules

恢复顺序：

1. 先读取 `pipeline-state.json`
2. 如果缺字段或状态明显过旧，再扫描对应 artifacts
3. 扫描结果只用于补全缺失字段，不应覆盖更新鲜的显式状态
4. `stale` / `change_requested` / `superseded` 的 artifact 不能直接作为继续运行的起点

## Resume Decision

系统恢复时，不应该从“最后跑到哪里”出发，而应该从“最近合法业务节点”出发。

最小规则：

1. 若存在 `open` 的 `change_request`，优先回到 `target_artifact` 所属 stage
2. 若存在 `in_review` 的 source / canonical artifact，优先进入对应 `review`
3. 若某 stage 为 `failed` / `partial` / `running`，从该 stage 继续
4. 若某 stage 为 `stale`，从该 stage 重新生成
5. 不允许跳过 `stale` stage 直接进入其下游 stage
6. 当所有 stage 均为 `completed` / `validated` / `approved` / `locked` / `superseded` 时，才视为流程完成

## Legal Edit Points

本契约只鼓励以下类别的 artifact 作为人工介入入口：

- source artifacts
- canonical artifacts

不鼓励将 derived artifacts（如 `delivery.json`、`mp4`、`xml`、`srt`）作为主编辑入口。

当前正式 storyboard canonical contract 为 `output/storyboard/approved/ep{NNN}_storyboard.json`。

`output/ep{NNN}/ep{NNN}_storyboard.json` 继续保留为 VIDEO 阶段运行时导出层，用于衔接现有视频生成脚本与回放视图。

VIDEO 阶段进入时应优先以 approved canonical 为源，同步导出到 runtime storyboard；后续 `lsi` / 评审等运行时回写只允许写入 runtime export。

## Invalidation Rule

一条最小硬规则：

> source / canonical artifact 修改后，所有 `invalidates` 指向的下游必须转为 `stale` 或 `change_requested`。

## Merge-Sensitive Stage Rule

`storyboard` 是共享写热点。为避免并行任务只返回内存结果导致恢复点丢失：

1. 子任务完成后，先把每集结果写到 `output/storyboard/draft/ep{NNN}_storyboard.json`
2. 主 session 只负责审阅/批准 draft，并复制为 `output/storyboard/approved/ep{NNN}_storyboard.json`
3. `STORYBOARD` 阶段不得合并或回写 `output/script.json`
4. approved canonical 写出并通过门控后，再把 `episodes.ep{NNN}.storyboard.status` 置为 `completed` / `approved` / `validated`
