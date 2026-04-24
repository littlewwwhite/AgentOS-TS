# Shot Validation Rules

> Status: lightweight, audit-first  
> Scope: preflight validation before expensive video generation

## Purpose

在真正跑视频之前，先做一次**轻量结构校验**，目的是尽早发现：

- 空 prompt
- 缺失 scene / clip / shot
- 时长非法
- 角色 / 地点锚点缺失
- 上下游契约层级混淆

这个校验当前首先是**规则文档**，后续再落成轻量 validator。

## Accepted Input Shapes

`video-gen` 当前接受两类输入：

### A. STORYBOARD Canonical Shape

```json
{
  "scenes": [
    {
      "scene_id": "scn_001",
      "actors": ["act_001"],
      "locations": ["loc_001"],
      "shots": [
        {
          "source_refs": [0],
          "prompt": "..."
        }
      ]
    }
  ]
}
```

### B. VIDEO Runtime Shape

```json
{
  "scenes": [
    {
      "scene_id": "scn_001",
      "actors": ["act_001"],
      "locations": ["loc_001"],
      "clips": [
        {
          "clip_id": "clip_001",
          "expected_duration": 5,
          "complete_prompt": "...",
          "shots": [
            {
              "shot_id": "shot_001",
              "partial_prompt": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

## Blocking Rules

出现以下任一项，应阻止进入昂贵视频生成：

1. 顶层缺失 `scenes[]`
2. 任一 `scene` 缺失 `scene_id`
3. 任一 `scene` 同时没有 `shots[]` 且没有 `clips[]`
4. STORYBOARD shape 下任一 `shots[].prompt` 为空
5. VIDEO runtime shape 下任一 `clips[].complete_prompt` 为空
6. 任一 `clip.expected_duration` 不在 3-15 秒范围内
7. 任一 `scene` 缺失 `actors` 或 `locations` 数组
8. 传入文件既不像 canonical storyboard，也不像 runtime storyboard

## Warning Rules

以下问题先给 warning，不必立即阻断：

1. `source_refs` 缺失或为空
2. `props` 缺失
3. `shots[]` / `clips[]` 数量明显偏少，但仍可生成
4. prompt 过长，接近或超过当前模型建议上限
5. 同一 scene 下 clip/shot 编号不连续

## Contract Discipline

### If Input Is STORYBOARD Canonical

- 允许只有 `shots[].prompt`
- 不要求出现 `complete_prompt`
- 进入 VIDEO 时需要导出为 runtime storyboard

### If Input Is VIDEO Runtime

- 应优先存在 `clips[].complete_prompt`
- `shots[]` 作为 clip 内部细分结构
- 评审、`lsi`、运行时补写都只应写在这一层

## Continuity Validation

轻量连续性规则如下：

1. 同一 scene 内多 clip → 可启用 clip-to-clip 连续性参考
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
    "clip_count": 2,
    "shot_count": 4
  }
}
```

## Decision Rule

如果 blocking issue 来自：

- canonical storyboard 缺失必填字段 → 回到 STORYBOARD 层修正
- runtime export 缺字段但 canonical 完整 → 允许重新导出 runtime storyboard

不要在 VIDEO 层用补丁式字符串拼接修复上游结构问题。
