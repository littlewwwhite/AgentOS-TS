# Storyboard Shot Schema Design

Date: 2026-04-28
Owner: zjding
Status: approved (in-conversation)

## Goal

锁定 STORYBOARD 阶段产出的 shot 数据契约。该契约的唯一职责是
**支撑 VIDEO 阶段从 shot 凑齐一次合理的 Ark Seedance 2.0 API 请求**。

设计判据（按优先级）：正确性 > 可维护性 > 简洁性 > 扩展性 > 性能。

## Background

### Ark Seedance 2.0 API contract（事实，非推测）

`video_api.py:_public_url` + `submit_video_generation` 决定边界：

- API 接受的视觉参考形态只有：公网 `http(s)` URL 或 `data:` URI。
- API **不接受任何项目内部 ID**（无 asset_id / subject_id 概念）。
- API 通过 `referenceImages[].name` 或 prompt 内 `[图N]` 索引来与 prompt 内
  的引用对齐 —— 这是 Ark 端纯字符串/位置绑定，不查任何外部库。
- 单次请求产出一段连续的 N 秒视频；prompt 内的多 beat / 多机位描述由模型
  自行解析为内部分镜，**不需要**结构化拆分到多次请求。

### 推论

`@act_001:st_001` 这类 token 是**项目内部别名**，对 Ark 不可见。`@xxx → URL`
解析这一跳必然存在；问题只是放在哪一阶段。

## Decision

### Shot schema（approved storyboard 持久形态）

```jsonc
{
  "episode_id": "ep001",
  "title": "...",
  "scenes": [
    {
      "scene_id": "scn_001",
      "shots": [
        {
          "id": "scn_001_clip001",
          "duration": 15,
          "prompt": "总体描述...剧情摘要...Beats[0-3]...S1|...|...对白..."
        }
      ]
    }
  ]
}
```

字段集穷尽且最小：

- `id` — 跨阶段寻址，文件命名，重生成定位
- `duration` — int [4, 15]，直接对应 Ark `duration` API 参数
- `prompt` — 自由 markdown，承载所有自然语言内容（描述 / Beats / Sx /
  对白 / 角色状态 / 运镜 / 音效），并以 `@xxx` token 作为视觉资产引用的
  **唯一声明渠道**

不引入 `subject_ids` / `actors[]` / `reference_images[]` / `dialog[]` /
`shot_type` / `camera_movement` 等任何额外字段。理由：

- subject 绑定从 prompt token 派生，单一事实源，避免双写漂移。
- 对白 / 音效等下游可消费内容暂留 prompt；若未来 SUBTITLE / TTS 阶段
  确需结构化对白，再以正交补丁方式新增 `dialog[]`，不影响本契约。
- 任何"内容描述"型字段（机位、景别、时段）一律走 prompt 自由文本。

### Resolution timing：α 路线（runtime 解析）

`@xxx → URL` 在 VIDEO 阶段每次 batch_generate 跑时由 `subject_resolver`
完成，approved storyboard JSON 不烧入任何 URL。

| 阶段 | 持有的视觉信息 |
|---|---|
| storyboard draft | prompt 含 `@xxx` token |
| storyboard approved | 同上（**finalize gate 已校验所有 token 可解析**） |
| video runtime | prompt 含 `@xxx` token + 解析得到的 `referenceImages[]` |
| Ark API request | prompt 内 `@xxx` 替换为 `[图N]` + `referenceImages[i].name` 对齐 |

### Finalize gate：静态 @token 校验

`apply_storyboard_result.py --finalize-stage` 在 draft → approved 跃迁前
**必须**执行：

1. 扫描所有 `scenes[].shots[].prompt` 内的 `@act_xxx` / `@loc_xxx` /
   `@prp_xxx` token（含可选 `:st_yyy` 状态后缀）
2. 解析每个 token：
   - actor token → 查 `output/actors/actors.json` 是否存在该 actor，
     若有 `:st_yyy` 状态后缀则进一步要求该 state 在 actor record 中存在
   - location token → 查 `output/locations/locations.json`
   - prop token → 查 `output/props/props.json`
3. 任一 token 解析失败 → finalize **fail-fast**，返回未解析 token 列表，
   stage 状态保持 `partial`，不写 approved 路径
4. 全部通过 → 写 `output/storyboard/approved/epNNN_storyboard.json`，
   `pipeline-state.json` 更新为 `validated`

**不**校验内容：URL 是否仍可访问、image 文件是否仍存在、token 在 prompt
里出现的次数 —— 只校验"绑定关系存在"。具体 URL 永远在 runtime 现查，
asset library 升级（如重抽更好的角色立绘）自动渗透到所有未生成的 shot。

### Runtime-only fields（不进 approved）

以下字段是 VIDEO 阶段对 runtime storyboard 拷贝（`output/epNNN/
epNNN_storyboard.json`）的注入，**永不写回 approved**：

- `lsi.url` / `lsi.video_url` — 跨 run 续帧载体
- `first_frame_url` / `last_frame_url` — i2v 通道（与 reference_image 互斥）
- 所有由 `subject_resolver` / `convert_prompt_brackets` 生成的中间态

`prepare_runtime_storyboard_export` 维持现状：approved 是模板，runtime 是
实例。

## Non-goals

- 不在本设计内规定 dialog / 配音 / 字幕的字段形态 —— 由 SUBTITLE skill
  自行决定它从 prompt 解析还是另起结构化通道
- 不规定 reference video 的导演显式指定通道 —— 当前仅 continuity 续帧
  使用 `referenceVideos`，无证据显示需要扩展
- 不做 storyboard 版本号 / asset 快照机制 —— α 路线明确放弃可重放性，
  asset 升级即生效

## Rationale（短半衰期 vs 长半衰期）

`{id, duration, prompt}` 是**长半衰期接口**：换底层视频模型（Veo / Sora /
下一代 Ark）时，shot 契约不变，仅 runtime resolver 与 request_compiler
适配新 API。

`@xxx` token 系统是**长半衰期协议**：其语义独立于具体 asset URL，asset
library 升级、CDN 迁移、AWB 重构都不影响已 approved 的 storyboard。

`subject_resolver` / `convert_prompt_brackets` / `prepare_runtime_storyboard_export`
是**短半衰期适配层**：它们的具体实现可随 provider 变迁而重写，不污染
持久产物。

## Migration impact

- 已完成：删除 `clips[]` / `expected_duration` / `source_refs` /
  `generate_episode_json.py` / `pipeline-prompt-v2.md`（cleanup tasks
  #22–#28）
- 待完成：
  - storyboard SKILL.md + references/schema.md 改写以契合本设计（task #29）
  - video-gen SKILL.md + references 同步（task #30）
  - apps/console UI 字段清理（task #32）
  - apply_storyboard_result.py 增 @token finalize 校验（task #35）
  - 全量测试验证（task #33）

## Open questions

无。三个分支均已收敛：

1. dialog 字段：暂留 prompt（不开新字段）
2. scene 级 actors/locations/props 数组：剔除（prompt token 派生）
3. approved/runtime 字段分离：确认（lsi/first_frame/last_frame 仅 runtime）
