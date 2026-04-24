# Storyboard JSON Schema

本文件明确区分两个相邻但不同的契约层：

1. **STORYBOARD 层**：`storyboard` skill 产出的 draft/approved 简化结构
2. **VIDEO 导出层**：`video-gen/generate_episode_json.py` 从 approved canonical 导出的 `ep{NNN}_storyboard.json` 运行时结构
3. **导演锁版 canonical 路径**：`output/storyboard/approved/ep{NNN}_storyboard.json`

STORYBOARD 层与 VIDEO 导出层都有效，但**不要把它们误认为同一个字段层级**；导演锁版文件也**不要**被 VIDEO 运行时直接改写。

## 1. STORYBOARD 层（draft / approved artifact）

### Data Hierarchy

```
Episode (集)
└── Scene (场)
    └── Shot (视频片段, 3-15s)
```

### Top-level Fields

- `title`: Episode title/summary
- `scenes`: Array of scenes

### Scene Level

| Field | Description |
|-------|-------------|
| `scene_id` | Scene ID |
| `actors` | All actor IDs in scene |
| `locations` | All location IDs in scene |
| `props` | All prop IDs in scene |
| `shots` | Array of generated-video shots |

### Shot Level

| Field | Description |
|-------|-------------|
| `source_refs` | 0-based action indexes from `scene.actions[]` used to build this shot |
| `prompt` | Canonical storyboard text for exactly one generated video, following the storyboard skill template |

### STORYBOARD 层规则

- `source_refs` 是 STORYBOARD 阶段的可追溯性字段
- `prompt` 是 STORYBOARD 阶段唯一必须保留的视频提示词字段
- 在这一层**不要引入** `layout_prompt`、`sfx_prompt`、`complete_prompt_v2` 等 VIDEO 导出字段

## 2. VIDEO 导出层（`ep{NNN}_storyboard.json`）

### Data Hierarchy

```
Episode (集)
└── Scene (场)
    └── Clip (运行时生成单元)
        └── Shot (clip 内部镜头拆分)
```

### Scene Level

| Field | Description |
|-------|-------------|
| `scene_id` | Scene ID |
| `actors` | All actor IDs in scene |
| `locations` | All location IDs in scene |
| `props` | All prop IDs in scene |
| `clips` | Runtime generation units consumed by current video pipeline |

### Clip Level

| Field | Description |
|-------|-------------|
| `clip_id` | Clip ID |
| `expected_duration` | Planned duration |
| `layout_prompt` | Scene layout / position prefix |
| `sfx_prompt` | SFX-only suffix |
| `complete_prompt` | Current runtime v1 generation prompt |
| `complete_prompt_v2` | Optional runtime v2 generation prompt |
| `shots` | Internal shot breakdown used to assemble clip-level prompts |

### Shot-in-Clip Level

| Field | Description |
|-------|-------------|
| `shot_id` | Internal shot ID |
| `time_range` | Time span inside clip |
| `partial_prompt` | Per-shot prompt fragment |
| `partial_prompt_v2` | Optional v2 fragment |

## 3. Compatibility Rules

- VIDEO 阶段必须读取 `output/storyboard/approved/ep{NNN}_storyboard.json`
- `generate_episode_json.py` 只负责把 approved canonical 导出为 runtime storyboard，不再从 `script.json` 重写该集 storyboard
- `batch_generate.py` 进入时会先把 approved canonical 同步/导出到 `output/ep{NNN}/ep{NNN}_storyboard.json`
- 后续 `lsi`、评审元数据、运行时补写都落在 VIDEO 导出层，不回写 approved canonical
- `batch_generate.py` **同时接受**：
  - 简化输入：`scenes[].shots[].prompt`
  - 当前运行时输入：`scenes[].clips[].complete_prompt`
- `generate_episode_json.py` 当前默认产出的是 **VIDEO 导出层 runtime copy**，原因是后续评审、首帧衔接、v1/v2 prompt 选择仍依赖 `clips[]`
- 如果未来完成 VIDEO 导出层瘦身，再把 `prompt` 提升为唯一运行时字段；在那之前，不要把 `clips[]` 误标为“历史文件专用”
