#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video file bytes + reviewer prompts (reference_consistency, prompt_compliance)
# output: per-clip review JSON consumed by gemini_adapter / evaluator
# pos: aos-cli video.analyze review boundary for generated video clips
"""
Simplified Video Analyzer
Model boundary note: migrated to aos-cli model video.analyze.
"""

import os
import sys
import json
import time
import tempfile
from pathlib import Path
from typing import Any, List, Dict, Optional

# 配置UTF-8输出
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


DEFAULT_REVIEW_MODEL = (
    os.environ.get("VIDEO_GEN_REVIEW_MODEL")
    or os.environ.get("VIDEO_ANALYZE_MODEL")
    or os.environ.get("GEMINI_MODEL")
    or "gemini-3.1-pro-preview"
)


# ============ 两个评审角色定义 ============

REVIEWERS = [
    {
        "name": "reference_consistency",
        "role": "参考一致性检查",
        "prompt_template": """
你是一位视频质量检查员。请仔细观看这段视频，检查视频中的人物、道具、场景是否和提示词中描述的参考对象保持一致。

原始提示词：
{prompt}

**检查重点**：
1. **人物一致性**（1-10分）：视频中出现的人物是否与提示词描述的角色一致？面部特征、服装、体型等是否匹配？
2. **场景一致性**（1-10分）：视频中的场景/环境是否与提示词描述的场景一致？布局、氛围、关键元素是否匹配？
3. **道具一致性**（1-10分）：提示词中提到的道具是否在视频中正确出现？

**所有文字内容必须使用中文输出。**

请以 JSON 格式输出：
{{
  "actor_consistency": <1-10分>,
  "location_consistency": <1-10分>,
  "props_consistency": <1-10分>,
  "actor_issues": ["人物相关问题1", "问题2"],
  "location_issues": ["场景相关问题1", "问题2"],
  "props_issues": ["道具相关问题1", "问题2"],
  "overall_consistency_note": "总体一致性说明"
}}
"""
    },
    {
        "name": "prompt_compliance",
        "role": "提示词符合度检查",
        "prompt_template": """
你是一位视频内容审核员。请仔细观看这段视频，判断生成的视频内容是否和提示词描述的内容保持一致。

原始提示词：
{prompt}

**检查重点**：
1. **内容符合度**（1-10分）：视频中呈现的动作、事件、画面是否与提示词描述一致？
2. **关键要素覆盖**：逐一列举提示词中的关键要素，判断每个要素是否在视频中体现
3. **偏差说明**：描述视频与提示词之间的主要差异

**所有文字内容必须使用中文输出。**

请以 JSON 格式输出：
{{
  "content_compliance_score": <1-10分>,
  "matched_elements": ["已体现的要素1", "已体现的要素2"],
  "missing_elements": ["缺失的要素1", "缺失的要素2"],
  "incorrect_elements": ["错误呈现的要素1"],
  "deviation_description": "视频与提示词的主要偏差描述",
  "overall_compliance_note": "总体符合度说明"
}}
"""
    }
]


def merge_results(results: List[Dict]) -> Dict:
    """合并评审结果"""
    merged = {
        "reference_consistency": {},
        "prompt_compliance": {}
    }

    for result in results:
        if not result['success']:
            continue

        reviewer_name = result['reviewer']
        data = result['result']

        if reviewer_name == "reference_consistency":
            merged["reference_consistency"] = data
        elif reviewer_name == "prompt_compliance":
            merged["prompt_compliance"] = data

    return merged


def call_video_review_analyze(
    video_path: str | Path,
    segment_id: str,
    expected_duration: float,
    original_prompt: str,
    *,
    model: str | None = None,
    cwd: Path | None = None,
) -> dict[str, Any]:
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Missing video input: {path}")

    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": f"video-gen.review.{segment_id}",
        "capability": "video.analyze",
        "modelPolicy": {"model": model or DEFAULT_REVIEW_MODEL},
        "input": {
            "content": {
                "prompt": _build_review_prompt(original_prompt, expected_duration),
                "videos": [path.resolve().as_uri()],
            }
        },
        "output": {"kind": "json"},
        "options": {"expectedDuration": expected_duration},
    }

    with tempfile.TemporaryDirectory(prefix="video-gen-review-aos-cli-") as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=cwd or Path.cwd())
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write a video review response envelope")
        return _read_json_output(response_path)


def _build_review_prompt(original_prompt: str, expected_duration: float) -> str:
    reviewer_prompts = [
        reviewer["prompt_template"].format(
            prompt=original_prompt,
            expected_duration=expected_duration,
        )
        for reviewer in REVIEWERS
    ]
    return "\n\n".join(
        [
            f"Expected duration: {expected_duration} seconds.",
            "Return one JSON object containing both top-level keys: reference_consistency and prompt_compliance.",
            *reviewer_prompts,
        ]
    )


def _read_json_output(response_path: Path) -> dict[str, Any]:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli video review response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli video review failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")
    if "data" in output:
        data = output["data"]
        if not isinstance(data, dict):
            raise RuntimeError("aos-cli video review output.data must be an object")
        return data
    if "text" in output:
        return _parse_json_text(str(output["text"]))
    raise RuntimeError("aos-cli video review response missing output.data")


def _parse_json_text(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise RuntimeError("aos-cli video review JSON text must decode to an object")
    return data


def analyze_video_parallel(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: str,
    actor_references: Optional[List[str]] = None,
    api_key: Optional[str] = None,
    model: str = None,
    max_workers: int = None
) -> Dict:
    """
    并行视频分析（简化版：参考一致性 + 提示词符合度）

    Args:
        video_path: 视频文件路径
        segment_id: 片段编号
        expected_duration: 期望时长（秒）
        original_prompt: 原始提示词
        actor_references: 角色参考图片路径列表（暂未使用）
        api_key: Deprecated compatibility parameter. aos-cli reads provider config.
        model: 使用的模型
        max_workers: 最大并行数

    Returns:
        Dict: 合并后的评审结果
    """

    if model is None:
        model = DEFAULT_REVIEW_MODEL

    print("="*60)
    print("[REVIEW] aos-cli video.analyze 评审（参考一致性 + 提示词符合度）")
    print("="*60)
    print(f"视频: {video_path}")
    print(f"片段: {segment_id}")
    print("评审角色: 2 个")

    print("\n[REVIEW] 调用 aos-cli model video.analyze...")
    start_time = time.time()
    merged_result = call_video_review_analyze(
        video_path,
        segment_id,
        expected_duration,
        original_prompt,
        model=model,
    )
    end_time = time.time()
    elapsed = end_time - start_time

    print(f"\n[DONE] 评审完成，耗时: {elapsed:.2f} 秒")

    # 4. 构建最终输出
    return {
        "segment_id": segment_id,
        "video_path": video_path,
        "expected_duration": expected_duration,
        "elapsed_time": elapsed,
        "parallel_results": merged_result,
        "raw_results": [
            {
                "reviewer": "aos_cli_video_analyze",
                "role": "aos-cli video.analyze",
                "success": True,
                "result": merged_result,
            }
        ]
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="简化视频评审")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("segment_id", help="片段编号")
    parser.add_argument("expected_duration", type=float, help="期望时长（秒）")
    parser.add_argument("--prompt", help="原始提示词")
    parser.add_argument("--prompt-file", help="提示词文件路径")
    parser.add_argument("--api-key", help="已弃用：保留参数兼容性，实际由 aos-cli model provider 配置读取")
    parser.add_argument("--model", default=DEFAULT_REVIEW_MODEL, help="模型名称")
    parser.add_argument("--output", help="输出文件路径")

    args = parser.parse_args()

    if args.prompt:
        prompt = args.prompt
    elif args.prompt_file:
        with open(args.prompt_file, 'r', encoding='utf-8') as f:
            prompt = f.read()
    else:
        prompt = ""

    result = analyze_video_parallel(
        video_path=args.video_path,
        segment_id=args.segment_id,
        expected_duration=args.expected_duration,
        original_prompt=prompt,
        api_key=args.api_key,
        model=args.model
    )

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n[SAVE] 结果已保存: {args.output}")
    else:
        print("\n[RESULT]")
        print(json.dumps(result, ensure_ascii=False, indent=2))
