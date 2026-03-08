#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini Video Analyzer for Video Review
使用 Google Gemini API 分析视频内容，输出结构化的评审数据
"""

import os
import sys
import time
import json
from typing import List, Optional
from datetime import datetime
from pathlib import Path

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

try:
    from google import genai
    from google.genai import types
    from pydantic import BaseModel
except ImportError:
    print("请先安装依赖: pip install google-genai pydantic")
    exit(1)


# ============ Pydantic Schema 定义 ============

class PlotAnalysis(BaseModel):
    """剧情维度分析"""
    narrative_coherence: int  # 1-10分：叙事连贯性
    scene_transition: int     # 1-10分：场景转换流畅度
    story_logic: int          # 1-10分：故事逻辑合理性
    key_events: List[str]     # 关键剧情事件列表
    plot_issues: List[str]    # 发现的剧情问题


class CharacterAnalysis(BaseModel):
    """人物维度分析"""
    character_consistency: int  # 1-10分：角色一致性
    appearance_match: int       # 1-10分：外观匹配度
    action_logic: int           # 1-10分：动作逻辑性
    characters_present: List[str]  # 出现的角色列表
    character_issues: List[str]    # 发现的人物问题


class SceneAnalysis(BaseModel):
    """场景维度分析"""
    environment_quality: int    # 1-10分：环境质量
    lighting_quality: int       # 1-10分：光影质量
    props_accuracy: int         # 1-10分：道具准确性
    scene_description: str      # 场景描述
    scene_issues: List[str]     # 发现的场景问题


class DirectionAnalysis(BaseModel):
    """调度维度分析"""
    camera_movement: int        # 1-10分：运镜流畅度
    shot_composition: int       # 1-10分：构图质量
    editing_rhythm: int         # 1-10分：剪辑节奏
    technical_quality: int      # 1-10分：技术质量
    direction_issues: List[str] # 发现的调度问题


class DurationAnalysis(BaseModel):
    """时长维度分析"""
    actual_duration: float      # 实际时长（秒）
    expected_duration: float    # 期望时长（秒）
    pacing_score: int           # 1-10分：节奏把控
    duration_issues: List[str]  # 发现的时长问题


class PromptComplianceAnalysis(BaseModel):
    """提示词符合度分析"""
    compliance_score: float         # 0.0-1.0：符合度分数
    matched_elements: List[str]     # 符合的关键要素
    missing_elements: List[str]     # 缺失的关键要素
    incorrect_elements: List[str]   # 错误/不符的要素
    deviation_description: str      # 偏差说明


class VideoReviewAnalysis(BaseModel):
    """完整的视频评审分析结果"""
    segment_id: str                         # SC##-L## 格式
    actual_content_description: str         # 视频实际呈现的内容描述
    prompt_compliance: PromptComplianceAnalysis  # 提示词符合度分析
    plot: PlotAnalysis
    character: CharacterAnalysis
    scene: SceneAnalysis
    direction: DirectionAnalysis
    duration: DurationAnalysis
    overall_summary: str                    # 整体评价
    critical_issues: List[str]              # 严重问题列表


# ============ 核心分析函数 ============

def analyze_video_for_review(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: Optional[str] = None,
    character_references: Optional[List[str]] = None,
    api_key: Optional[str] = None,
    model: str = "gemini-2.5-flash"
) -> VideoReviewAnalysis:
    """
    使用 Gemini API 分析视频，返回评审所需的结构化数据

    Args:
        video_path: 视频文件路径
        segment_id: 片段编号，格式 SC##-L##
        expected_duration: 期望时长（秒）
        original_prompt: 原始提示词（用于符合度对比）
        character_references: 角色参考图片路径列表（用于角色一致性对比）
        api_key: Gemini API Key，默认从环境变量读取
        model: 使用的模型，默认 gemini-2.5-flash

    Returns:
        VideoReviewAnalysis: 结构化的分析结果
    """

    # 初始化客户端
    if api_key is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("未找到 GEMINI_API_KEY 环境变量")

    client = genai.Client(api_key=api_key)

    print(f"[UPLOAD] 上传视频: {video_path}")
    video_file = client.files.upload(file=video_path)

    # 等待处理完成
    print("[WAIT] 等待视频处理...")
    while video_file.state.name == "PROCESSING":
        time.sleep(5)
        video_file = client.files.get(name=video_file.name)

    if video_file.state.name != "ACTIVE":
        raise RuntimeError(f"视频处理失败: {video_file.state.name}")

    print(f"[OK] 视频处理完成")

    # 上传角色参考图片
    reference_files = []
    if character_references:
        print(f"[UPLOAD] 上传 {len(character_references)} 张角色参考图...")
        for ref_path in character_references:
            ref_path_obj = Path(ref_path)
            if ref_path_obj.exists():
                try:
                    # 读取文件内容并上传，避免路径编码问题
                    with open(ref_path_obj, 'rb') as f:
                        file_content = f.read()

                    # 使用ASCII安全的文件名
                    safe_filename = f"character_ref_{len(reference_files)}.png"

                    # 创建临时文件
                    import tempfile
                    with tempfile.NamedTemporaryFile(mode='wb', suffix='.png', delete=False) as tmp:
                        tmp.write(file_content)
                        tmp_path = tmp.name

                    # 上传临时文件
                    ref_file = client.files.upload(file=tmp_path)
                    reference_files.append(ref_file)

                    # 删除临时文件
                    os.unlink(tmp_path)

                    print(f"  ✓ {ref_path_obj.name}")
                except Exception as e:
                    print(f"  ✗ 上传失败 {ref_path_obj.name}: {e}")
            else:
                print(f"  ✗ 文件不存在: {ref_path}")

    print(f"[ANALYZE] 开始分析...")

    # 构建角色和场景参考说明
    reference_section = ""
    if reference_files:
        reference_section = f"""

## 参考图片说明

已提供 {len(reference_files)} 张参考图片（包含角色参考图和场景参考图）。

### 人物维度评估要求：

1. **character_consistency**（角色一致性）：
   - 对比视频中的角色与角色参考图片
   - 检查面部特征（眼睛、鼻子、嘴巴、脸型）是否一致
   - 检查发型、服装、配饰是否匹配
   - 检查整体气质和风格是否符合
   - 如果角色外观与参考图差异明显，应扣分并在 character_issues 中说明

2. **appearance_match**（外观匹配度）：
   - 评估角色外观与参考图的整体匹配程度
   - 重点关注：骨骼结构、眼距、下颚几何形状
   - 注意：AI生成视频可能存在"美化"或"年龄变化"问题，这些都应视为不匹配

**重要**：如果视频中的角色与参考图严重不符（如完全不同的人），应在 critical_issues 中标注"角色外观与参考图严重不符"。

### 场景维度评估要求：

1. **environment_quality**（环境质量）：
   - **对比视频中的场景与场景参考图片**
   - 检查场景的整体布局、风格、色调是否一致
   - 检查关键场景元素（建筑、家具、装饰）是否匹配
   - 检查场景氛围和光影效果是否符合
   - 如果场景与参考图差异明显，应扣分并在 scene_issues 中说明

2. **lighting_quality**（光影质量）：
   - 对比参考图中的光影效果
   - 检查光源位置、光线强度、阴影效果是否一致

3. **props_accuracy**（道具准确性）：
   - 对比参考图中的道具细节
   - 检查道具的位置、样式、数量是否准确

**重要**：如果视频中的场景与参考图严重不符（如完全不同的场景），应在 critical_issues 中标注"场景与参考图严重不符"。
"""
    else:
        reference_section = """

## 参考图片说明

未提供参考图片，人物维度和场景维度评分仅基于视频内部的一致性和逻辑性。
"""

    # 构建分析提示词
    prompt_compliance_section = ""
    if original_prompt:
        prompt_compliance_section = f"""

## 0. 提示词符合度分析（最重要的前置检查）

原始提示词：
{original_prompt}

请先完成以下步骤：

### 步骤1：描述视频实际内容
请详细描述视频中实际呈现的内容，包括：
- 场景环境（时间、地点、氛围）
- 人物角色（外观、服装、动作）
- 镜头运动（运镜方式、景别、角度）
- 关键事件（发生了什么）
- 视觉细节（光影、道具、特效等）

将此描述填入 actual_content_description 字段。

### 步骤2：对比分析
将视频实际内容与原始提示词进行逐项对比，分析：

1. **matched_elements**（符合的要素）：
   - 列出视频中完全符合提示词要求的关键要素
   - 例如："场景为演武场"、"主角萧禾出现"、"运镜为Slow Dolly In"

2. **missing_elements**（缺失的要素）：
   - 列出提示词中要求但视频中未呈现的要素
   - 例如："缺少石锁道具"、"未出现尘埃悬浮效果"

3. **incorrect_elements**（错误/不符的要素）：
   - 列出视频中与提示词描述不一致或错误的要素
   - 例如："场景为室内而非室外"、"人物服装颜色错误"

4. **compliance_score**（符合度分数）：
   - 范围：0.0 - 1.0
   - 计算方法：(符合要素数量) / (提示词总要素数量)
   - 0.8-1.0：高度符合
   - 0.5-0.8：部分符合
   - 0.2-0.5：大量偏差
   - 0.0-0.2：严重不符（一票否决）

5. **deviation_description**（偏差说明）：
   - 用2-3句话总结视频与提示词的主要偏差
   - 如果符合度高，说明"视频整体符合提示词要求"

**重要提示**：提示词符合度是最关键的评审标准，如果 compliance_score < 0.2，应在 critical_issues 中标注"提示词符合度严重不足，建议重新生成"。
"""
    else:
        prompt_compliance_section = """

## 0. 提示词符合度分析

由于未提供原始提示词，请将以下字段设置为默认值：
- actual_content_description: 详细描述视频实际呈现的内容
- prompt_compliance.compliance_score: 1.0
- prompt_compliance.matched_elements: ["无原始提示词，跳过对比"]
- prompt_compliance.missing_elements: []
- prompt_compliance.incorrect_elements: []
- prompt_compliance.deviation_description: "未提供原始提示词，无法进行符合度分析"
"""

    prompt = f"""
请对这个短剧视频片段进行专业评审分析。

片段编号：{segment_id}
期望时长：{expected_duration}秒
{reference_section}
{prompt_compliance_section}

请从以下5个维度进行详细分析，每个子项给出1-10分的评分：

## 1. 剧情维度 (Plot)
- narrative_coherence: 叙事是否连贯流畅（1-10分）
  评估要点：
  ✓ 故事情节是否连贯
  ✓ 时间线是否合理
  ✓ **空间位置是否连贯**（人物位置前后是否一致，是否突然瞬移）
  ✓ 因果关系是否清晰
- scene_transition: 场景转换是否自然（1-10分）
- story_logic: 故事逻辑是否合理（1-10分）
- key_events: 列出关键剧情事件
- plot_issues: 列出发现的剧情问题（包括人物位置不连贯的问题）

## 2. 人物维度 (Character) - **角色一致性为最高优先级**

**重要提示**：人物维度中，角色与参考图的一致性是最关键的评分标准！

- character_consistency: **角色与参考图的一致性（1-10分）【最高优先级】**
  评估要点（严格对比参考图）：
  ✓ **面部特征是否100%一致**（眼睛、鼻子、嘴巴、脸型）
  ✓ **骨骼结构是否相同**（眼距、下颚几何形状）
  ✓ **发型、服装、配饰是否匹配**
  ✓ **整体气质和风格是否符合**
  ✓ **禁止美化、禁止改变年龄**

  评分标准：
  - 9-10分：与参考图几乎完全一致，细节精准
  - 7-8分：整体相似，但有细微差异
  - 5-6分：基本相似，但有明显差异
  - 3-4分：差异较大，仅保留部分特征
  - 1-2分：完全不同的人物

  **如果 character_consistency < 7分，必须在 critical_issues 中标注"角色外观与参考图不符，建议重新生成"**

- appearance_match: 角色外观与提示词设定的匹配度（1-10分）
  评估要点：
  ✓ 服装颜色、款式是否符合描述
  ✓ 配饰、道具是否准确
  ✓ 姿态、表情是否符合设定

- action_logic: 角色动作是否符合逻辑（1-10分）
  评估要点：
  ✓ 动作是否自然流畅
  ✓ 动作是否符合角色性格
  ✓ 动作是否符合场景逻辑

- characters_present: 列出出现的所有角色
- character_issues: 列出发现的人物问题（**优先列出与参考图不符的问题**）

## 3. 场景维度 (Scene) - **场景一致性为最高优先级**

**重要提示**：场景维度中，场景与参考图的一致性是最关键的评分标准！

- environment_quality: **场景与参考图的一致性（1-10分）【最高优先级】**
  评估要点（严格对比参考图）：
  ✓ **场景整体布局、风格、色调是否一致**
  ✓ **关键场景元素（建筑、家具、装饰）是否匹配**
  ✓ **场景空间布局是否合理**
  ✓ **人物在场景中的位置是否符合逻辑**
  ✓ **人物与道具、背景的空间关系是否准确**
  ✓ **场景氛围是否到位**

  评分标准：
  - 9-10分：与参考图几乎完全一致，细节精准
  - 7-8分：整体相似，但有细微差异
  - 5-6分：基本相似，但有明显差异
  - 3-4分：差异较大，仅保留部分特征
  - 1-2分：完全不同的场景

  **如果 environment_quality < 7分，必须在 critical_issues 中标注"场景与参考图不符，建议重新生成"**

- lighting_quality: 光影效果质量（1-10分）
  评估要点：
  ✓ 光源位置、光线强度是否符合参考图
  ✓ 阴影效果是否准确
  ✓ 整体光影氛围是否一致

- props_accuracy: 道具准确性（1-10分）
  评估要点：
  ✓ 道具的位置、样式、数量是否准确
  ✓ 道具与参考图的匹配度

- scene_description: 简要描述场景
- scene_issues: 列出发现的场景问题（**优先列出与参考图不符的问题**，包括人物位置不合理的问题）

## 4. 调度维度 (Direction)
- camera_movement: 运镜流畅度（1-10分）
- shot_composition: 构图质量（1-10分）
- editing_rhythm: 剪辑节奏（1-10分）
- technical_quality: 技术质量（画质、音质等）（1-10分）
- direction_issues: 列出发现的调度问题

## 5. 时长维度 (Duration)
- actual_duration: 视频实际时长（秒，精确到小数点后1位）
- expected_duration: {expected_duration}（直接使用这个值）
- pacing_score: 节奏把控（1-10分）
- duration_issues: 列出发现的时长问题

## 整体评价
- overall_summary: 对视频的整体评价（2-3句话）
- critical_issues: 列出所有严重问题（如果没有则为空列表）

评分标准：
- 9-10分：优秀，完全符合要求
- 7-8分：良好，基本符合要求
- 5-6分：及格，存在一些问题但可接受
- 3-4分：较差，存在明显问题
- 1-2分：很差，严重不符合要求

请严格按照JSON schema返回结果。
"""

    # 调用模型（包含视频和参考图片）
    content_parts = [video_file] + reference_files + [prompt]

    response = client.models.generate_content(
        model=model,
        contents=content_parts,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=VideoReviewAnalysis,
        ),
    )

    # 清理文件
    print("[DELETE] 清理临时文件...")
    client.files.delete(name=video_file.name)
    for ref_file in reference_files:
        client.files.delete(name=ref_file.name)

    # 解析结果
    result = VideoReviewAnalysis.model_validate_json(response.text)
    print(f"[STAR] 分析完成: {segment_id}")

    return result


def save_analysis_result(
    analysis: VideoReviewAnalysis,
    output_dir: str,
    filename: Optional[str] = None
) -> str:
    """
    保存分析结果到JSON文件

    Args:
        analysis: 分析结果
        output_dir: 输出目录
        filename: 文件名（可选，默认使用 segment_id_analysis.json）

    Returns:
        str: 保存的文件路径
    """

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    if filename is None:
        filename = f"{analysis.segment_id.lower().replace('-', '')}_analysis.json"

    file_path = output_path / filename

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(
            analysis.model_dump(),
            f,
            indent=2,
            ensure_ascii=False
        )

    print(f"[SAVE] 分析结果已保存: {file_path}")
    return str(file_path)


# ============ 命令行接口 ============

def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="使用 Gemini API 分析视频内容"
    )
    parser.add_argument(
        "video_path",
        help="视频文件路径"
    )
    parser.add_argument(
        "segment_id",
        help="片段编号，格式 SC##-L##"
    )
    parser.add_argument(
        "expected_duration",
        type=float,
        help="期望时长（秒）"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录（默认: workspace/output）"
    )
    parser.add_argument(
        "-m", "--model",
        default="gemini-2.5-flash",
        help="使用的模型（默认: gemini-2.5-flash）"
    )
    parser.add_argument(
        "-k", "--api-key",
        help="Gemini API Key（默认从环境变量读取）"
    )

    args = parser.parse_args()

    try:
        # 分析视频
        analysis = analyze_video_for_review(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            api_key=args.api_key,
            model=args.model
        )

        # 保存结果
        save_analysis_result(
            analysis=analysis,
            output_dir=args.output_dir
        )

        # 打印摘要
        print("\n" + "="*60)
        print(f"[STAT] 分析摘要")
        print("="*60)
        print(f"片段编号: {analysis.segment_id}")
        print(f"实际时长: {analysis.duration.actual_duration}秒")
        print(f"期望时长: {analysis.duration.expected_duration}秒")
        print(f"\n整体评价: {analysis.overall_summary}")

        if analysis.critical_issues:
            print(f"\n[WARN]  严重问题:")
            for issue in analysis.critical_issues:
                print(f"  - {issue}")

    except Exception as e:
        print(f"[FAIL] 错误: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
