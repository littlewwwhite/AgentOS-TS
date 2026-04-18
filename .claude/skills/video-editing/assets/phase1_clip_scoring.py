"""
第一阶段：Clip 变体评分与选优
用途：以 clip 目录为单位，对比分析所有变体，输出剪辑决策数据
调用方：scripts/phase1_analyze.py
"""

import json


# ════════════════════════════════════════════════════════════
# 主模板（始终注入）
# ════════════════════════════════════════════════════════════

MAIN = """\
你是一位专业的视频分镜分析师，擅长 AI 生成视频的质量评估与剪辑决策支持。

## 任务

对这组视频变体进行逐镜头（shot-by-shot）对比分析，输出供下游剪辑 AI 直接消费的结构化数据。

共 {variant_count} 个变体：
{variant_list}

## 切镜锚点

以下是通过算法对每个变体独立检测到的切镜节点：

{shot_cuts_per_variant}

请以这些切点为边界划分镜头进行分析。注意不同变体的切点可能不同——如果某变体有独特的切点，请在分析该变体时考虑其自身的切镜位置。如果你认为算法漏检了明显的切镜，可以补充。

## 分析维度

对每个镜头的**每个变体**，输出以下剪辑决策相关字段：

### per_variant（每变体评估）
- **camera**: 景别与构图（如"中景，三分法构图"、"特写，居中"）
- **camera_direction**: 运镜方向与方式（如"从左向右慢摇"、"缓慢推进"、"固定"）
- **dialogue**: 对话检测（"有口型"、"无对话"、"字幕显示…"）
- **quality_score**: 1-10 画面质量评分（画面一致性、动作流畅度、AI 生成瑕疵程度）
- **quality_issues**: 画面质量问题列表（变形、闪烁、不连贯、穿模等），无问题则为空数组

### continuity_to_next（shot 间衔接度，最后一个 shot 省略此字段）
对每个变体评估与下一 shot 的衔接：
- **score**: 1-10 衔接流畅度
- **position_match**: 人物位置是否连贯（true/false）
- **lighting_match**: 光线是否一致（true/false）
- **issues**: 衔接问题描述列表，无问题则为空数组

{storyboard_section}\
{comparison_section}\

## 输出格式

严格输出 JSON 对象，不要包含任何其他文字、代码块标记或解释。

时间字段使用**秒数（float）**，并附带 timecode 辅助字段。

{{
  "shots": [
    {{
      "shot_id": 1,
      "start": 0.0,
      "end": 5.708,
      "start_tc": "00:00",
      "end_tc": "00:05",
      "duration": 5.708,
      "per_variant": {{
        "v1": {{
          "camera": "中景，三分法构图",
          "camera_direction": "从左向右慢摇",
          "dialogue": "无对话",
          "quality_score": 8,
          "quality_issues": []
        }},
        "v2": {{ ... }},
        "v3": {{ ... }}
      }},
      "continuity_to_next": {{
        "v1": {{ "score": 8, "position_match": true, "lighting_match": true, "issues": [] }},
        "v2": {{ ... }}
      }}
    }}
  ],
  "overall": {{
    "total_shots": 3,
    "total_variants": 3,
    "summary": "整体概述（30-50字）",
    "best_variant_quality_score": 8.0,
    "recommendation": "推荐/可用/需重新生成"
  }}
}}

注意：
- `per_variant` 嵌套在每个 shot 内，key 为变体标签（v1, v2, ...）
- `start` / `end` 为秒数（float），`start_tc` / `end_tc` 为 MM:SS 辅助显示
- `continuity_to_next` 仅在非最后一个 shot 时输出
- 只有 1 个变体时，`per_variant` 仍然使用该结构，key 为 "v1"
- `best_variant_quality_score` 范围 1-10
- `recommendation` 三选一：推荐（8+分）、可用（6-7分）、需重新生成（<6分）
"""


# ════════════════════════════════════════════════════════════
# 可选段落：分镜脚本匹配（有 storyboard 时注入）
# ════════════════════════════════════════════════════════════

STORYBOARD_SECTION = """\

## 分镜脚本匹配评分

以下是该视频对应的分镜脚本（原始生成指令）：

{storyboard_json}

请对每个镜头额外输出 `script_match` 字段：
- **score**: 1-10 分，评价视频对脚本的还原程度
- **matched_shot**: 最匹配的脚本 shot_id
- **hits**: 匹配到位的要素列表（如场景环境、镜头运动、人物动作、光影氛围等）
- **misses**: 缺失或偏差的要素列表
- **notes**: 补充说明（如"构图从中心偏移为三分法，但效果更佳"）

评分标准：
- 10分：完美还原，所有 shot 要素高度匹配
- 8-9分：主体匹配，细节有少量偏差
- 6-7分：基本可用，但有明显的缺失要素
- 4-5分：偏差较大，需补充生成
- 1-3分：严重不符，需重新生成

"""


# ════════════════════════════════════════════════════════════
# 可选段落：变体对比（>1 个变体时注入）
# ════════════════════════════════════════════════════════════

COMPARISON_SECTION = """\

## 变体对比分析

你收到了同一 clip 的多个生成变体。请在逐 shot 分析之外，额外输出以下对比层：

### clip_comparison

在 JSON 顶层输出 `clip_comparison` 对象：

1. **best_overall**: 综合最佳变体
   - `variant`: 变体标签（如 "v1"）
   - `score`: 综合评分 1-10
   - `reason`: 选择理由（20-40字）

2. **per_shot_best**: 每个 shot 的最佳变体
   - key 为 shot 标识（如 "shot_1", "shot_2"）
   - 每项包含 `best`（变体标签）、`score`（1-10）、`reason`（10-20字）

3. **recommended_assembly**: 推荐剪辑组装方案
   - `strategy`: "single"（单一变体最优）或 "mixed"（混剪多变体）
   - `plan`: 组装计划数组，每项包含：
     - `shot`: shot 标识（如 "shot_1"）
     - `use`: 推荐使用的变体标签
     - `source_file`: 该变体的源文件名（如 "ep001_scn001_clip001_002.mp4"）
     - `in`: shot 起始时间（秒，float）
     - `out`: shot 结束时间（秒，float）
     - `transition`: 与下一 shot 的转场方式（"cut" / "dissolve" / "需加转场"）
   - `mixable`: 是否适合混剪（true/false）
   - `mix_warnings`: 混剪风险提示列表（如角色外观不一致、光线跳变等），无风险则为空数组

示例输出结构：

"clip_comparison": {{
  "best_overall": {{ "variant": "v2", "score": 8.5, "reason": "画面稳定性和动作流畅度最佳" }},
  "per_shot_best": {{
    "shot_1": {{ "best": "v1", "score": 9, "reason": "开场构图最佳" }},
    "shot_2": {{ "best": "v2", "score": 8, "reason": "动作更自然" }}
  }},
  "recommended_assembly": {{
    "strategy": "mixed",
    "plan": [
      {{ "shot": "shot_1", "use": "v1", "source_file": "ep001_scn001_clip001.mp4", "in": 0.0, "out": 5.708, "transition": "cut" }},
      {{ "shot": "shot_2", "use": "v2", "source_file": "ep001_scn001_clip001_002.mp4", "in": 5.708, "out": 10.25, "transition": "cut" }}
    ],
    "mixable": true,
    "mix_warnings": ["v1 与 v2 角色发色略有差异"]
  }}
}}

"""


# ════════════════════════════════════════════════════════════
# 组装入口
# ════════════════════════════════════════════════════════════

def build(
    variants: list[dict],
    shot_detections: dict[str, dict],
    storyboard_clip: dict | None = None,
) -> str:
    """组装完整 prompt，按条件注入可选段落。

    Args:
        variants: 变体列表 [{label, stem, ...}]
        shot_detections: per-variant 切点字典 {label: shot_detection_result}
                         也兼容旧格式的单个 dict（当做所有变体共享）
        storyboard_clip: 分镜脚本片段（可选）
    """

    variant_count = len(variants)
    variant_list = "\n".join(f"- {v['label']}: {v['stem']}.mp4" for v in variants)

    # 兼容旧调用：如果传入的是单个 dict 而非 per-variant 字典
    if isinstance(shot_detections, dict) and "total_shots" in shot_detections:
        shot_detections = {v["label"]: shot_detections for v in variants}

    # 构建 per-variant 切点展示
    shot_cuts_parts = []
    for label, sd in sorted(shot_detections.items()):
        part = json.dumps(
            {
                "variant": label,
                "total_shots": sd.get("total_shots", 1),
                "total_cuts": sd.get("total_cuts", 0),
                "cut_points": sd.get("cut_points", []),
                "shots": sd.get("shots", []),
            },
            ensure_ascii=False,
            indent=2,
        )
        shot_cuts_parts.append(f"### {label}\n{part}")
    shot_cuts_per_variant = "\n\n".join(shot_cuts_parts)

    # 可选段落
    storyboard_section = ""
    if storyboard_clip:
        storyboard_json = json.dumps(storyboard_clip, ensure_ascii=False, indent=2)
        storyboard_section = STORYBOARD_SECTION.format(storyboard_json=storyboard_json)

    comparison_section = COMPARISON_SECTION if variant_count > 1 else ""

    return MAIN.format(
        variant_count=variant_count,
        variant_list=variant_list,
        shot_cuts_per_variant=shot_cuts_per_variant,
        storyboard_section=storyboard_section,
        comparison_section=comparison_section,
    )
