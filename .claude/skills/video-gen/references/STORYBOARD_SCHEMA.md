# Storyboard JSON Schema (VIDEO 视角)

本文件描述 VIDEO 阶段所看到的 storyboard JSON 字段契约。**权威 schema 在
storyboard skill 内**：`.claude/skills/storyboard/references/schema.md`。
设计原则见 `docs/superpowers/specs/2026-04-28-storyboard-shot-schema-design.md`。

VIDEO 阶段的职责：

1. 读取 approved canonical（`output/storyboard/approved/ep{NNN}_storyboard.json`）
2. 拷贝为 runtime 副本（`output/ep{NNN}/ep{NNN}_storyboard.json`）
3. 在 runtime 副本上注入运行时字段（`lsi`、首末帧 URL 等），**绝不回写
   approved canonical**

## 1. Approved Canonical Shape (storyboard skill 输出)

```jsonc
{
  "episode_id": "ep001",
  "title": "...",
  "scenes": [
    {
      "scene_id": "scn_001",
      "shots": [
        {
          "id":       "scn_001_clip001",     // ^scn_\d{3}_clip\d{3}$
          "duration": 15,                    // int [4, 15]
          "prompt":   "...markdown text..."  // 含 @act_xxx / @loc_xxx / @prp_xxx token
        }
      ]
    }
  ]
}
```

`shots[]` 字段集合是**穷尽的**：只有 `id` / `duration` / `prompt`。

- `id` — 跨阶段寻址；`batch_generate` 用其归一化形式作为 `clip_id`
- `duration` — 直接映射 Ark Seedance 2.0 `duration` API 参数
- `prompt` — 自由 markdown，承载所有自然语言内容，并以 `@xxx` token 作为
  视觉资产引用的**唯一声明渠道**

VIDEO 阶段**不得**期望或要求 `source_refs` / `actors[]` / `clips[]` /
`expected_duration` / `complete_prompt` / `complete_prompt_v2` /
`layout_prompt` / `sfx_prompt` / `partial_prompt` 等历史字段；它们已在
schema 设计中正式移除。

## 2. Runtime-only Fields (VIDEO 注入，不进 approved)

`output/ep{NNN}/ep{NNN}_storyboard.json` runtime 副本可能在生成过程中被
注入以下字段。这些只在 runtime 层有效，**永不写回 approved canonical**：

| Field | Owner | Purpose |
|-------|-------|---------|
| `shots[].lsi.url` | batch_generate runtime | 上一镜首帧 URL（image-reference 续帧通道） |
| `shots[].lsi.video_url` | batch_generate runtime | 上一镜整段视频 URL（video-reference 续帧通道） |
| `shots[].first_frame_url` / `shots[].last_frame_url` | batch_generate runtime | i2v 通道（与 reference_image 互斥） |

mode 互斥规则在 `video_api._normalize_reference_images` / `submit_video_generation`
里强制执行：`referenceImages[]` 与 `first_frame_url` 不可同时出现，否则
fail-fast。

## 3. Token Resolution Boundary (Ark API 真相)

**Ark Seedance 2.0 不接受任何项目内部 ID。** API 入参的视觉参考形态只有：

- 公网 `http(s)://...` URL
- `data:image/...;base64,...` URI

`@act_xxx[:st_yyy]` / `@loc_xxx` / `@prp_xxx` 是**项目内部别名**，
对 Ark 不可见。`@xxx → URL` 解析必须在 VIDEO 阶段完成，由
`scripts/subject_resolver.py` 查询：

- actors → `output/actors/actors.json`（带 `:st_yyy` 时取对应 state 的图）
- locations → `output/locations/locations.json`
- props → `output/props/props.json`

解析得到的 URL 注入 `referenceImages[]`，并把 prompt 内的 `@xxx` 替换为
`[图N]` 标记与 `referenceImages[i].name` 对齐（Ark 端是纯字符串绑定，
不查任何外部库）。

storyboard finalize gate（`apply_storyboard_result.py --finalize-stage`）
已对所有 `@token` 做静态存在性校验，进入 VIDEO 阶段时假定每个 token 都
能在当前 asset 库中解析；若 runtime 解析失败（asset 文件被删 / 未 ready），
则按现有 fail-fast 路径报错。

## 4. Field Discipline Rules

- **不得**因为 runtime 注入字段缺失而要求改写 approved canonical：
  runtime 注入是 batch_generate 的职责
- **不得**在 VIDEO 层用补丁式字符串拼接修复上游结构问题；如果 approved
  canonical 缺失必填字段，回到 STORYBOARD 阶段重新批准
- **不得**新增脱离 `{id, duration, prompt}` 三字段的"导演侧"字段；任何
  长期需要的结构化值都应在 storyboard schema 设计 spec 中先经过审议
- runtime 副本与 approved canonical 同名，但**生命周期不同**：approved
  是模板，runtime 是实例
