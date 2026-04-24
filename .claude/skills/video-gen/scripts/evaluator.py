#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simplified Video Review Evaluator
简化评审：只检查参考一致性和提示词符合度
"""

import sys
import json
from typing import Dict, List, Tuple, Optional
from pathlib import Path

from config_loader import get_gemini_review_config

_thresholds = get_gemini_review_config().get("thresholds", {})

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def _safe_num(val, default=5):
    """安全获取数值，None 或非数值类型返回默认值。"""
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def evaluate_from_gemini_analysis(analysis: Dict) -> Dict:
    """
    基于 Gemini 分析结果进行简化评分（2维度）

    维度1: 参考一致性（人物 + 场景 + 道具）
    维度2: 提示词符合度

    Args:
        analysis: Gemini 分析结果字典

    Returns:
        Dict: 评审结果
    """

    # 参考一致性评分（满分10分）
    ref_data = analysis.get("reference_consistency", {})
    actor_score = _safe_num(ref_data.get("actor_consistency"))
    location_score = _safe_num(ref_data.get("location_consistency"))
    props_score = _safe_num(ref_data.get("props_consistency"))
    # 加权：人物 50%，场景 35%，道具 15%
    reference_score = actor_score * 0.5 + location_score * 0.35 + props_score * 0.15

    # 提示词符合度评分（满分10分）
    compliance_data = analysis.get("prompt_compliance", {})
    compliance_score = _safe_num(compliance_data.get("content_compliance_score"))

    # 总分（满分20分）
    total_score = reference_score + compliance_score

    # 收集所有问题
    all_issues = []
    all_issues.extend(ref_data.get("actor_issues", []))
    all_issues.extend(ref_data.get("location_issues", []))
    all_issues.extend(ref_data.get("props_issues", []))
    missing = compliance_data.get("missing_elements", [])
    incorrect = compliance_data.get("incorrect_elements", [])
    if missing:
        all_issues.extend([f"缺失: {e}" for e in missing])
    if incorrect:
        all_issues.extend([f"错误: {e}" for e in incorrect])

    return {
        "segment_id": analysis.get("segment_id", ""),
        "scores": {
            "reference_consistency": round(reference_score, 2),
            "prompt_compliance": round(compliance_score, 2),
            "total": round(total_score, 2)
        },
        "details": {
            "actor_consistency": actor_score,
            "location_consistency": location_score,
            "props_consistency": props_score,
            "content_compliance": compliance_score,
            "matched_elements": compliance_data.get("matched_elements", []),
            "missing_elements": missing,
            "incorrect_elements": incorrect,
            "deviation_description": compliance_data.get("deviation_description", ""),
        },
        "issues": all_issues,
        "reference_note": ref_data.get("overall_consistency_note", ""),
        "compliance_note": compliance_data.get("overall_compliance_note", ""),
    }


def is_video_qualified(evaluation: Dict) -> Tuple[bool, List[str]]:
    """
    判定视频是否合格（简化版）

    两级判定：
    1. 参考一致性 >= 阈值
    2. 提示词符合度 >= 阈值

    Args:
        evaluation: 评审结果

    Returns:
        Tuple[bool, List[str]]: (是否合格, 不合格维度列表)
    """

    scores = evaluation["scores"]
    failed_dimensions = []

    ref_min = _thresholds.get("reference_consistency_min", 6)
    compliance_min = _thresholds.get("prompt_compliance_min", 6)

    if scores["reference_consistency"] < ref_min:
        failed_dimensions.append("reference_consistency")

    if scores["prompt_compliance"] < compliance_min:
        failed_dimensions.append("prompt_compliance")

    passed = len(failed_dimensions) == 0
    return passed, failed_dimensions


def save_review_result(
    evaluation: Dict,
    qualified: bool,
    failed_dimensions: List[str],
    video_path: str,
    output_dir: str,
    filename: str = None,
    original_prompt: str = ""
) -> str:
    """保存评审结果"""

    import re
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    if filename is None:
        video_stem = Path(video_path).stem
        if re.match(r'^ep\d{3}[_-]scn\d{3}[_-]clip\d{3}', video_stem, re.IGNORECASE):
            filename = f"{video_stem.lower()}.json"
        else:
            segment_id = evaluation["segment_id"].lower().replace("-", "")
            if "__" in segment_id or "_shot" in segment_id:
                return None
            filename = f"{segment_id}_review.json"

    file_path = output_path / filename

    scores = evaluation["scores"]
    details = evaluation.get("details", {})

    review_result = {
        "prompt": original_prompt,
        "status": "reviewed",
        "pass": qualified,
        "analysis": {
            "reference_consistency": {
                "actor_consistency": details.get("actor_consistency", 0),
                "location_consistency": details.get("location_consistency", 0),
                "props_consistency": details.get("props_consistency", 0),
            },
            "prompt_compliance": {
                "content_compliance": details.get("content_compliance", 0),
                "matched_elements": details.get("matched_elements", []),
                "missing_elements": details.get("missing_elements", []),
                "incorrect_elements": details.get("incorrect_elements", []),
                "deviation_description": details.get("deviation_description", ""),
            }
        },
        "review": {
            "dimensions": {
                "reference_consistency": scores.get("reference_consistency", 0),
                "prompt_compliance": scores.get("prompt_compliance", 0),
            },
            "total_score": scores.get("total", 0)
        },
    }

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(review_result, f, indent=2, ensure_ascii=False)

    print(f"[SAVE] 评审结果已保存: {file_path}")
    return str(file_path)


def print_review_summary(evaluation: Dict, qualified: bool, failed_dimensions: List[str]):
    """打印评审摘要"""

    print("\n" + "="*60)
    print("[STAT] 评审结果")
    print("="*60)

    segment_id = evaluation["segment_id"]
    scores = evaluation["scores"]

    print(f"\n片段编号: {segment_id}")
    print(f"合格状态: {'[OK] 合格' if qualified else '[FAIL] 不合格'}")

    print(f"\n[CHART] 评分:")
    print(f"  参考一致性: {scores['reference_consistency']}/10")
    print(f"  提示词符合度: {scores['prompt_compliance']}/10")
    print(f"  总分: {scores['total']}/20")

    if not qualified:
        print(f"\n[WARN] 不合格维度: {', '.join(failed_dimensions)}")

    issues = evaluation.get("issues", [])
    if issues:
        print(f"\n[CHECK] 发现的问题:")
        for issue in issues[:10]:
            print(f"  - {issue}")

    print("\n" + "="*60)


# ============ 命令行接口 ============

def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="评审视频质量（简化版：参考一致性 + 提示词符合度）"
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
        default="draft/output",
        help="输出目录（默认: draft/output）"
    )

    args = parser.parse_args()

    try:
        print(f"[SCAN] 加载分析结果: {args.analysis_file}")
        with open(args.analysis_file, "r", encoding="utf-8") as f:
            analysis = json.load(f)

        print("[CHECK] 进行评审评分...")
        evaluation = evaluate_from_gemini_analysis(analysis)

        qualified, failed_dims = is_video_qualified(evaluation)

        print_review_summary(evaluation, qualified, failed_dims)

        save_review_result(
            evaluation=evaluation,
            qualified=qualified,
            failed_dimensions=failed_dims,
            video_path=args.video_path,
            output_dir=args.output_dir
        )

        return 0 if qualified else 1

    except Exception as e:
        print(f"[FAIL] 错误: {e}")
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    exit(main())
