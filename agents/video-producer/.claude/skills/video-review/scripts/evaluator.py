#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Review Evaluator
读取 Gemini 分析结果，进行5维度评分和合格性判定
支持时间段级别分析（C 级）
"""

import sys
import json
import re
from typing import Dict, List, Tuple, Optional
from pathlib import Path
from datetime import datetime

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def evaluate_from_gemini_analysis(analysis: Dict) -> Dict:
    """
    基于 Gemini 分析结果进行5维度评分

    Args:
        analysis: Gemini 分析结果字典

    Returns:
        Dict: 评审结果，包含分数、问题列表等
    """

    # 提示词符合度分析
    prompt_compliance = analysis.get("prompt_compliance", {})
    compliance_score = prompt_compliance.get("compliance_score", 1.0)

    # 剧情维度评分（满分10分）
    plot_data = analysis["plot"]
    plot_score = (
        plot_data["narrative_coherence"] * 0.4 +
        plot_data["scene_transition"] * 0.3 +
        plot_data["story_logic"] * 0.3
    )

    # 人物维度评分（满分10分）
    # 角色一致性为最高优先级，权重60%
    character_data = analysis["character"]
    character_score = (
        character_data["character_consistency"] * 0.6 +  # 最高优先级：60%
        character_data["appearance_match"] * 0.25 +
        character_data["action_logic"] * 0.15
    )

    # 场景维度评分（满分10分）
    # 场景一致性为最高优先级，权重60%
    scene_data = analysis["scene"]
    scene_score = (
        scene_data["environment_quality"] * 0.6 +  # 最高优先级：60%
        scene_data["lighting_quality"] * 0.25 +
        scene_data["props_accuracy"] * 0.15
    )

    # 调度维度评分（满分10分）
    direction_data = analysis["direction"]
    direction_score = (
        direction_data["camera_movement"] * 0.25 +
        direction_data["shot_composition"] * 0.25 +
        direction_data["editing_rhythm"] * 0.25 +
        direction_data["technical_quality"] * 0.25
    )

    # 时长维度评分（满分10分）
    duration_data = analysis["duration"]
    actual = duration_data["actual_duration"]
    expected = duration_data["expected_duration"]
    duration_diff = abs(actual - expected)

    # 时长偏差评分
    if duration_diff <= 0.5:
        duration_base_score = 10
    elif duration_diff <= 1.0:
        duration_base_score = 8
    elif duration_diff <= 2.0:
        duration_base_score = 6
    else:
        duration_base_score = max(0, 10 - duration_diff)

    # 结合节奏评分
    duration_score = (duration_base_score + duration_data["pacing_score"]) / 2

    # 总分
    total_score = plot_score + character_score + scene_score + direction_score + duration_score

    return {
        "segment_id": analysis["segment_id"],
        "_raw_analysis": analysis,  # 保存原始分析数据，用于角色一致性检查
        "prompt_compliance": {
            "score": round(compliance_score, 3),
            "percentage": f"{round(compliance_score * 100, 1)}%",
            "matched_elements": prompt_compliance.get("matched_elements", []),
            "missing_elements": prompt_compliance.get("missing_elements", []),
            "incorrect_elements": prompt_compliance.get("incorrect_elements", []),
            "deviation_description": prompt_compliance.get("deviation_description", "")
        },
        "actual_content_description": analysis.get("actual_content_description", ""),
        "scores": {
            "plot": round(plot_score, 2),
            "character": round(character_score, 2),
            "scene": round(scene_score, 2),
            "direction": round(direction_score, 2),
            "duration": round(duration_score, 2),
            "total": round(total_score, 2)
        },
        "issues": {
            "plot": plot_data["plot_issues"],
            "character": character_data["character_issues"],
            "scene": scene_data["scene_issues"],
            "direction": direction_data["direction_issues"],
            "duration": duration_data["duration_issues"],
            "critical": analysis["critical_issues"]
        },
        "details": {
            "plot": plot_data,
            "character": character_data,
            "scene": scene_data,
            "direction": direction_data,
            "duration": duration_data,
            "overall_summary": analysis["overall_summary"]
        }
    }


def is_video_qualified(evaluation: Dict) -> Tuple[bool, List[str]]:
    """
    判定视频是否合格

    六级判定标准（按优先级）：
    0. 提示词符合度检查：< 20% → 一票否决
    1. 角色一致性检查：< 7分 → 一票否决（最高优先级）
    2. 场景一致性检查：< 7分 → 一票否决（最高优先级）
    3. 硬性规则：任何维度 < 5分 → 不合格
    4. 维度检查：任何维度 < 7分 → 不合格
    5. 总分检查：总分 < 40分 → 不合格

    Args:
        evaluation: 评审结果

    Returns:
        Tuple[bool, List[str]]: (是否合格, 不合格维度列表)
    """

    scores = evaluation["scores"]
    failed_dimensions = []

    # 第零级：提示词符合度检查（一票否决）
    compliance = evaluation.get("prompt_compliance", {})
    compliance_score = compliance.get("score", 1.0)

    if compliance_score < 0.2:
        failed_dimensions.append("prompt_compliance_critical")
        return False, failed_dimensions

    # 第一级：角色一致性检查（一票否决，最高优先级）
    # 检查原始分析数据中的 character_consistency 分数
    raw_analysis = evaluation.get("_raw_analysis", {})
    if raw_analysis:
        character_data = raw_analysis.get("character", {})
        character_consistency = character_data.get("character_consistency", 10)

        if character_consistency < 7:
            failed_dimensions.append("character_consistency_critical")
            return False, failed_dimensions

    # 第二级：场景一致性检查（一票否决，最高优先级）
    # 检查原始分析数据中的 environment_quality 分数
    if raw_analysis:
        scene_data = raw_analysis.get("scene", {})
        environment_quality = scene_data.get("environment_quality", 10)

        if environment_quality < 7:
            failed_dimensions.append("scene_consistency_critical")
            return False, failed_dimensions

    # 第三级：硬性规则 - 任何维度 < 5分
    for dim in ["plot", "character", "scene", "direction", "duration"]:
        if scores[dim] < 5:
            failed_dimensions.append(f"{dim}_critical")

    if failed_dimensions:
        return False, failed_dimensions

    # 第四级：维度检查 - 任何维度 < 7分
    for dim in ["plot", "character", "scene", "direction", "duration"]:
        if scores[dim] < 7:
            failed_dimensions.append(dim)

    if failed_dimensions:
        return False, failed_dimensions

    # 第五级：总分检查 - < 40分
    if scores["total"] < 40:
        return False, ["total_score_insufficient"]

    return True, []


def load_analysis_result(file_path: str) -> Dict:
    """加载 Gemini 分析结果"""
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_review_result(
    evaluation: Dict,
    qualified: bool,
    failed_dimensions: List[str],
    video_path: str,
    output_dir: str,
    filename: str = None
) -> str:
    """
    保存评审结果

    Args:
        evaluation: 评审结果
        qualified: 是否合格
        failed_dimensions: 不合格维度列表
        video_path: 视频文件路径
        output_dir: 输出目录
        filename: 文件名（可选）

    Returns:
        str: 保存的文件路径
    """

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    if filename is None:
        segment_id = evaluation["segment_id"].lower().replace("-", "")
        filename = f"{segment_id}_review.json"

    file_path = output_path / filename

    review_result = {
        **evaluation,
        "qualified": qualified,
        "failed_dimensions": failed_dimensions,
        "video_path": video_path,
        "timestamp": datetime.now().isoformat(),
        "recommendation": _generate_recommendation(qualified, failed_dimensions, evaluation)
    }

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(review_result, f, indent=2, ensure_ascii=False)

    print(f"[SAVE] 评审结果已保存: {file_path}")
    return str(file_path)


def _generate_recommendation(qualified: bool, failed_dimensions: List[str], evaluation: Dict) -> str:
    """生成优化建议"""

    if qualified:
        return "视频质量合格，可以使用"

    # 提示词符合度一票否决
    if "prompt_compliance_critical" in failed_dimensions:
        compliance = evaluation.get("prompt_compliance", {})
        percentage = compliance.get("percentage", "0%")
        return f"提示词符合度严重不足（{percentage}），视频内容与原始提示词严重偏离，必须重新生成"

    if any("_critical" in dim for dim in failed_dimensions):
        critical_dims = [dim.replace("_critical", "") for dim in failed_dimensions if "_critical" in dim]
        return f"视频存在严重问题，需要重新生成。重点优化：{', '.join(critical_dims)}"

    if "total_score_insufficient" in failed_dimensions:
        return "视频总分不足，需要全面优化后重新生成"

    return f"视频需要重新生成，重点优化：{', '.join(failed_dimensions)}"


def print_review_summary(evaluation: Dict, qualified: bool, failed_dimensions: List[str]):
    """打印评审摘要"""

    print("\n" + "="*60)
    print("[STAT] 评审结果")
    print("="*60)

    segment_id = evaluation["segment_id"]
    scores = evaluation["scores"]
    compliance = evaluation.get("prompt_compliance", {})

    print(f"\n片段编号: {segment_id}")
    print(f"合格状态: {'[OK] 合格' if qualified else '[FAIL] 不合格'}")

    # 提示词符合度（如果有）
    if compliance.get("score") is not None:
        compliance_score = compliance.get("score", 0)
        percentage = compliance.get("percentage", "0%")
        status = "✓" if compliance_score >= 0.2 else "✗"
        print(f"\n[COMPLIANCE] 提示词符合度: {percentage} {status}")

        if compliance_score < 0.2:
            print(f"  [WARN] 符合度低于20%阈值，一票否决！")

        # 显示符合/缺失/错误要素
        matched = compliance.get("matched_elements", [])
        missing = compliance.get("missing_elements", [])
        incorrect = compliance.get("incorrect_elements", [])

        if matched:
            print(f"  符合要素: {len(matched)}项")
        if missing:
            print(f"  缺失要素: {len(missing)}项")
        if incorrect:
            print(f"  错误要素: {len(incorrect)}项")

    print(f"\n[CHART] 各维度评分:")
    print(f"  剧情: {scores['plot']}/10")
    print(f"  人物: {scores['character']}/10")
    print(f"  场景: {scores['scene']}/10")
    print(f"  调度: {scores['direction']}/10")
    print(f"  时长: {scores['duration']}/10")
    print(f"  总分: {scores['total']}/50")

    if not qualified:
        print(f"\n[WARN]  不合格维度: {', '.join(failed_dimensions)}")

    # 打印问题列表
    issues = evaluation["issues"]
    has_issues = False

    for dim in ["plot", "character", "scene", "direction", "duration"]:
        if issues[dim]:
            if not has_issues:
                print(f"\n[CHECK] 发现的问题:")
                has_issues = True
            print(f"\n  {dim.upper()}:")
            for issue in issues[dim]:
                print(f"    - {issue}")

    if issues["critical"]:
        print(f"\n[ERROR] 严重问题:")
        for issue in issues["critical"]:
            print(f"  - {issue}")

    print("\n" + "="*60)


def analyze_timeranges(
    evaluation: Dict,
    storyboard_path: Optional[str] = None,
    segment_id: Optional[str] = None
) -> Dict[str, Dict]:
    """
    分析视频的时间段（C 级）质量
    将整体评分映射到各个时间切片

    Args:
        evaluation: 整体评审结果
        storyboard_path: 分镜脚本路径（可选）
        segment_id: 片段ID（可选）

    Returns:
        Dict: 各时间切片的评分和问题
        {
            "C01": {
                "time_range": "0-1.5s",
                "scores": {...},
                "issues": [...],
                "qualified": bool
            },
            ...
        }
    """
    timerange_scores = {}

    # 如果没有提供分镜脚本，使用简单的时间分段
    if not storyboard_path or not segment_id:
        return _simple_timerange_analysis(evaluation)

    # 从分镜脚本中提取时间切片信息
    try:
        timeranges = _extract_timeranges_from_storyboard(storyboard_path, segment_id)
        if not timeranges:
            return _simple_timerange_analysis(evaluation)

        # 为每个时间切片分配评分
        scores = evaluation["scores"]
        issues = evaluation["issues"]

        for c_id, time_info in timeranges.items():
            # 简化版：所有 C 使用相同的整体评分
            # 未来可以基于视频分析结果进行更精细的时间段评分
            c_scores = {
                "plot": scores["plot"],
                "character": scores["character"],
                "scene": scores["scene"],
                "direction": scores["direction"],
                "duration": scores["duration"]
            }

            # 计算该 C 的平均分
            c_avg = sum(c_scores.values()) / len(c_scores)

            # 判定该 C 是否合格（使用相同的标准）
            c_qualified = c_avg >= 7.0

            timerange_scores[c_id] = {
                "time_range": time_info["time_range"],
                "description": time_info.get("description", ""),
                "scores": c_scores,
                "average_score": round(c_avg, 2),
                "issues": issues.get("critical", []) + issues.get("plot", []) + issues.get("character", []),
                "qualified": c_qualified
            }

    except Exception as e:
        print(f"[WARN] 时间段分析失败: {e}")
        return _simple_timerange_analysis(evaluation)

    return timerange_scores


def _extract_timeranges_from_storyboard(storyboard_path: str, segment_id: str) -> Dict:
    """
    从分镜脚本中提取时间切片信息

    Returns:
        Dict: {
            "C01": {"time_range": "0-1.5s", "description": "..."},
            "C02": {"time_range": "1.5-3.5s", "description": "..."},
            ...
        }
    """
    try:
        with open(storyboard_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 查找对应的镜头段落
        pattern = rf'\*\*{segment_id}\*\*[^\n]*\n(.*?)(?=\n\*\*SC\d+-L\d+\*\*|\Z)'
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)

        if not match:
            return {}

        segment_content = match.group(1)

        # 提取时间切片
        timeranges = {}
        slice_pattern = r'(C\d+)\s*\(([^)]+)\)[:\s]*([^\n]+)'
        slices = re.findall(slice_pattern, segment_content)

        for slice_id, time_range, description in slices:
            timeranges[slice_id] = {
                "time_range": time_range,
                "description": description.strip()
            }

        return timeranges

    except Exception as e:
        print(f"[WARN] 解析分镜脚本失败: {e}")
        return {}


def _simple_timerange_analysis(evaluation: Dict) -> Dict:
    """
    简单的时间段分析（当没有分镜脚本时）
    将视频平均分为3段
    """
    scores = evaluation["scores"]
    issues = evaluation["issues"]

    # 简单分为3段
    timerange_scores = {}
    for i, c_id in enumerate(["C01", "C02", "C03"], 1):
        c_avg = sum([scores["plot"], scores["character"], scores["scene"],
                     scores["direction"], scores["duration"]]) / 5
        c_qualified = c_avg >= 7.0

        timerange_scores[c_id] = {
            "time_range": f"段落{i}",
            "description": "",
            "scores": {
                "plot": scores["plot"],
                "character": scores["character"],
                "scene": scores["scene"],
                "direction": scores["direction"],
                "duration": scores["duration"]
            },
            "average_score": round(c_avg, 2),
            "issues": issues.get("critical", []),
            "qualified": c_qualified
        }

    return timerange_scores


def decide_regeneration_strategy(
    timerange_scores: Dict,
    overall_qualified: bool
) -> Tuple[str, List[str]]:
    """
    根据时间段评分决定重新生成策略

    Args:
        timerange_scores: 时间段评分结果
        overall_qualified: 整体是否合格

    Returns:
        Tuple[str, List[str]]: (策略, 目标C列表)
        策略: "none" | "regenerate_l" | "regenerate_c"
    """
    if overall_qualified:
        return "none", []

    if not timerange_scores:
        # 没有时间段信息，重新生成整个 L
        return "regenerate_l", []

    # 统计不合格的 C
    failed_cs = [c_id for c_id, data in timerange_scores.items()
                 if not data["qualified"]]

    total_cs = len(timerange_scores)
    failed_count = len(failed_cs)

    if failed_count == 0:
        # 所有 C 都合格但整体不合格，重新生成整个 L
        return "regenerate_l", []
    elif failed_count >= total_cs * 0.7:
        # 70%以上的 C 不合格，重新生成整个 L
        return "regenerate_l", []
    else:
        # 只有部分 C 不合格，只重新生成这些 C
        return "regenerate_c", failed_cs


def print_timerange_analysis(timerange_scores: Dict, strategy: str, target_cs: List[str]):
    """打印时间段分析结果"""
    if not timerange_scores:
        return

    print("\n" + "="*60)
    print("[TIMERANGE] 时间段分析")
    print("="*60)

    for c_id, data in timerange_scores.items():
        status = "✓" if data["qualified"] else "✗"
        print(f"\n{c_id} ({data['time_range']}): {status}")
        print(f"  平均分: {data['average_score']}/10")
        if data["issues"]:
            print(f"  问题: {', '.join(data['issues'][:2])}")

    print(f"\n[STRATEGY] 重新生成策略: ", end="")
    if strategy == "none":
        print("无需重新生成")
    elif strategy == "regenerate_l":
        print("重新生成整个 L")
    elif strategy == "regenerate_c":
        print(f"只重新生成: {', '.join(target_cs)}")

    print("="*60)


# ============ 命令行接口 ============

def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="评审视频质量（基于 Gemini 分析结果）"
    )
    parser.add_argument(
        "analysis_file",
        help="Gemini 分析结果文件路径（JSON）"
    )
    parser.add_argument(
        "video_path",
        help="视频文件路径"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录（默认: workspace/output）"
    )

    args = parser.parse_args()

    try:
        # 加载分析结果
        print(f"[SCAN] 加载分析结果: {args.analysis_file}")
        analysis = load_analysis_result(args.analysis_file)

        # 评审评分
        print("[CHECK] 进行评审评分...")
        evaluation = evaluate_from_gemini_analysis(analysis)

        # 判定合格性
        qualified, failed_dims = is_video_qualified(evaluation)

        # 打印摘要
        print_review_summary(evaluation, qualified, failed_dims)

        # 保存结果
        save_review_result(
            evaluation=evaluation,
            qualified=qualified,
            failed_dimensions=failed_dims,
            video_path=args.video_path,
            output_dir=args.output_dir
        )

        # 返回状态码
        return 0 if qualified else 1

    except Exception as e:
        print(f"[FAIL] 错误: {e}")
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    exit(main())