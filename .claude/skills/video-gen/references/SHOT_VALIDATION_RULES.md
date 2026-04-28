# Shot Validation Rules

> Status: lightweight, audit-first
> Scope: preflight validation before expensive video generation

## Purpose

在真正跑视频之前，先做一次**轻量结构校验**，目的是尽早发现：

- 空 prompt
- 缺失 scene / shot
- duration 非法
- shot id 格式错误
- prompt 中嵌入了非法 JSON / 代码块结构

这个校验当前首先是**规则文档**，后续可落成轻量 validator。重型 `@token`
解析校验已在 storyboard finalize gate 完成（见
`.claude/skills/storyboard/references/schema.md` §finalize-gate）。

## Accepted Input Shape

VIDEO 阶段只接受 storyboard skill 产出的 minimal 形态：

```jsonc
{
  "episode_id": "ep001",
  "scenes": [
    {
      "scene_id": "scn_001",
      "shots": [
        {
          "id":       "scn_001_clip001",
          "duration": 15,
          "prompt":   "..."
        }
      ]
    }
  ]
}
```

`shots[]` 字段集合是**穷尽的**：`id` / `duration` / `prompt`。
其它字段（`source_refs` / `actors[]` / `clips[]` / `complete_prompt` /
`expected_duration` / `partial_prompt` 等）都是历史遗留，不再支持。

> 兼容性说明：`batch_generate.py:iter_clips` 仍保留 `scene.get('shots') or
> scene.get('clips')` fallback 用于读取极旧的运行时副本；新生成的 storyboard
> 一律走 `shots[]` 通道。

## Blocking Rules

出现以下任一项，应阻止进入昂贵视频生成：

1. 顶层缺失 `scenes[]`
2. 任一 `scene` 缺失 `scene_id`
3. 任一 `scene` 缺失 `shots[]`，或 `shots[]` 为空
4. 任一 `shots[].id` 缺失或不匹配 `^scn_\d{3}_clip\d{3}$`
5. 任一 `shots[].id` 的 `scn_NNN` 段与父 `scene_id` 不一致
6. 任一 `shots[].duration` 不是整数，或不在 `[4, 15]` 区间内
7. 任一 `shots[].prompt` 缺失或 strip 后为空
8. `shots[].prompt` 内嵌 fenced 代码块（``` ``` 或 ```` ```json ````）或
   `"key":` JSON 键值对结构（违反 storyboard skill 输出格式约束）

## Warning Rules

以下问题先给 warning，不必立即阻断：

1. 同一 scene 下 shot 编号不连续（应从 001 顺序递增）
2. shot prompt 长度接近或超过当前模型建议上限
3. shots 数量明显偏少（例如全集只有一两镜），但仍可生成
4. prompt 内 `@token` 不带 `:st_yyy` 后缀但对应 actor 在 script.json 注册了
   多个 state（runtime resolver 会按 default 处理，但语义可能不准）

## Token Validation Boundary

VIDEO 阶段**不再**承担 `@token → asset URL` 的存在性校验：

- 静态存在性校验已在 storyboard finalize gate 完成
- runtime 解析失败（asset 文件被删 / 未 ready）由 `subject_resolver` 报错
- 本 SHOT 校验只看结构，不查 asset 库

## Continuity Validation

轻量连续性规则如下：

1. 同一 scene 内多 shot → 可启用 shot-to-shot 连续性参考（首末帧注入）
2. 跨 scene → 默认不要求连续性继承
3. 不得因为缺少跨 scene 连续性信息而阻断生成

## Output of Future Validator

未来 validator 建议返回：

```json
{
  "passed": true,
  "has_blocking": false,
  "blocking_issues": [],
  "warnings": [],
  "stats": {
    "scene_count": 1,
    "shot_count": 4
  }
}
```

## Decision Rule

如果 blocking issue 来自：

- approved canonical 缺失必填字段 → 回到 STORYBOARD 阶段重新生成/批准
- runtime export 缺字段但 canonical 完整 → 重新跑 `prepare_runtime_storyboard_export`

不要在 VIDEO 层用补丁式字符串拼接修复上游结构问题。
