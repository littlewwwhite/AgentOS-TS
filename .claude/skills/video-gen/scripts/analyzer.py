#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simplified Video Analyzer
简化视频分析器 - 只检查参考一致性和提示词符合度
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

# 配置UTF-8输出
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("请先安装依赖: pip install google-genai")
    exit(1)

from config_loader import get_gemini_review_config, get_gemini_config

_review_cfg = get_gemini_review_config()
_gemini_cfg = get_gemini_config()
GEMINI_BASE_URL = _gemini_cfg.get("base_url", "https://api.chatfire.cn/gemini")
GEMINI_API_KEY = _gemini_cfg.get("api_key", "")
GEMINI_REVIEW_MODEL = _gemini_cfg.get("review_model", "gemini-3.1-pro-preview")


def _make_client(api_key: str = None):
    """创建带 base_url 的 genai.Client"""
    _api_key = api_key or GEMINI_API_KEY
    http_options = types.HttpOptions(base_url=GEMINI_BASE_URL) if GEMINI_BASE_URL else None
    return genai.Client(api_key=_api_key, http_options=http_options)


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


def upload_video_once(video_path: str, api_key: str = None):
    """上传视频（只上传一次）"""
    print(f"[UPLOAD] 上传视频: {video_path}")
    client = _make_client(api_key)
    video_file = client.files.upload(file=video_path)

    print("[WAIT] 等待视频处理...")
    while video_file.state.name == "PROCESSING":
        time.sleep(5)
        video_file = client.files.get(name=video_file.name)

    if video_file.state.name != "ACTIVE":
        raise RuntimeError(f"视频处理失败: {video_file.state.name}")

    print(f"[OK] 视频处理完成")
    return video_file


def analyze_single_reviewer(
    video_file,
    reviewer: Dict,
    original_prompt: str,
    expected_duration: float,
    api_key: str = None,
    model: str = None
):
    """单个评审角色分析"""
    if model is None:
        model = GEMINI_REVIEW_MODEL
    print(f"[{reviewer['role']}] 开始分析...")

    client = _make_client(api_key)

    # 构建 prompt
    prompt_text = reviewer['prompt_template'].format(
        prompt=original_prompt,
        expected_duration=expected_duration
    )

    # 发送请求
    try:
        response = client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_uri(
                    file_uri=video_file.uri,
                    mime_type=video_file.mime_type
                ),
                prompt_text
            ]
        )

        result_text = response.text
        print(f"[{reviewer['role']}] 分析完成")

        # 尝试解析 JSON
        try:
            # 提取 JSON 部分
            if "```json" in result_text:
                json_start = result_text.find("```json") + 7
                json_end = result_text.find("```", json_start)
                result_text = result_text[json_start:json_end].strip()
            elif "```" in result_text:
                json_start = result_text.find("```") + 3
                json_end = result_text.find("```", json_start)
                result_text = result_text[json_start:json_end].strip()

            result_json = json.loads(result_text)
            return {
                "reviewer": reviewer['name'],
                "role": reviewer['role'],
                "success": True,
                "result": result_json
            }
        except json.JSONDecodeError as e:
            print(f"[{reviewer['role']}] JSON 解析失败: {e}")
            return {
                "reviewer": reviewer['name'],
                "role": reviewer['role'],
                "success": False,
                "error": str(e),
                "raw_text": response.text
            }

    except Exception as e:
        print(f"[{reviewer['role']}] 分析失败: {e}")
        return {
            "reviewer": reviewer['name'],
            "role": reviewer['role'],
            "success": False,
            "error": str(e)
        }


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
        api_key: Gemini API Key
        model: 使用的模型
        max_workers: 最大并行数

    Returns:
        Dict: 合并后的评审结果
    """

    if api_key is None:
        api_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("未找到 Gemini API Key（请设置 GEMINI_API_KEY，值使用 ChatFire key）")

    if model is None:
        model = GEMINI_REVIEW_MODEL
    if max_workers is None:
        max_workers = _review_cfg.get("max_workers", 2)

    print("="*60)
    print("[REVIEW] 简化评审（参考一致性 + 提示词符合度）")
    print("="*60)
    print(f"视频: {video_path}")
    print(f"片段: {segment_id}")
    print(f"评审角色: {len(REVIEWERS)} 个")

    # 1. 上传视频（只上传一次）
    video_file = upload_video_once(video_path, api_key)

    # 2. 并行分析
    print(f"\n[REVIEW] 启动 {len(REVIEWERS)} 个并行评审...")
    start_time = time.time()

    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for reviewer in REVIEWERS:
            future = executor.submit(
                analyze_single_reviewer,
                video_file,
                reviewer,
                original_prompt,
                expected_duration,
                api_key,
                model
            )
            futures.append(future)

        for future in as_completed(futures):
            result = future.result()
            results.append(result)

    end_time = time.time()
    elapsed = end_time - start_time

    print(f"\n[DONE] 评审完成，耗时: {elapsed:.2f} 秒")

    # 3. 合并结果
    merged_result = merge_results(results)

    # 4. 构建最终输出
    return {
        "segment_id": segment_id,
        "video_path": video_path,
        "expected_duration": expected_duration,
        "elapsed_time": elapsed,
        "parallel_results": merged_result,
        "raw_results": results
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="简化视频评审")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("segment_id", help="片段编号")
    parser.add_argument("expected_duration", type=float, help="期望时长（秒）")
    parser.add_argument("--prompt", help="原始提示词")
    parser.add_argument("--prompt-file", help="提示词文件路径")
    parser.add_argument("--api-key", help="Gemini API Key")
    parser.add_argument("--model", default=_review_cfg.get("model", "gemini-2.5-flash"), help="模型名称")
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
