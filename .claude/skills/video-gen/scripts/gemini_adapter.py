#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Legacy-named video review adapter.

The public module name is kept for compatibility; the implementation now calls
analyzer.py, which routes generated-clip review through aos-cli video.analyze.
"""

import os
import sys
import json
from pathlib import Path
from typing import Optional, Dict, Tuple, List

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 确保本目录在 sys.path 中，以便直接导入 analyzer
sys.path.insert(0, str(Path(__file__).parent))
from analyzer import analyze_video_parallel


class GeminiVideoAdapter:
    """
    Legacy-named generated-video review adapter.

    功能：
    1. 检查是否已有分析结果JSON
    2. 如果没有，调用内置 analyzer.py 进行分析
    3. 读取并返回分析结果
    """

    def get_analysis_result(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str] = None,
        actor_references: Optional[List[str]] = None,
        output_dir: str = "draft/output",
        force_reanalyze: bool = False,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """
        获取视频分析结果

        优先级：
        1. 读取已有的分析结果JSON（除非 force_reanalyze）
        2. 调用内置 analyzer 进行并行分析

        Args:
            video_path: 视频文件路径
            segment_id: 片段编号 (SC##-L##)
            expected_duration: 期望时长（秒）
            original_prompt: 原始提示词（用于符合度对比）
            actor_references: 角色参考图片路径列表
            output_dir: 输出目录
            force_reanalyze: 是否强制重新分析
            api_key: Deprecated compatibility parameter. aos-cli reads provider config.

        Returns:
            Tuple[Dict, str]: (分析结果字典, JSON文件路径)
        """

        # 调用内置 analyzer 进行分析（不再写入独立文件）
        print(f"[STAT] 调用内置分析器...")

        analysis = analyze_video_parallel(
            video_path=video_path,
            segment_id=segment_id,
            expected_duration=expected_duration,
            original_prompt=original_prompt or "",
            actor_references=actor_references,
            api_key=api_key
        )

        # 转换为字典
        if hasattr(analysis, 'model_dump'):
            analysis = analysis.model_dump()

        print(f"[OK] 分析完成: {segment_id}")
        return analysis, ""


def get_video_analysis(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: Optional[str] = None,
    actor_references: Optional[List[str]] = None,
    output_dir: str = "draft/output",
    force_reanalyze: bool = False,
    gemini_skill_path: Optional[str] = None,
    api_key: Optional[str] = None
) -> Tuple[Dict, str]:
    """
    便捷函数：获取视频分析结果

    Args:
        video_path: 视频文件路径
        segment_id: 片段编号
        expected_duration: 期望时长
        original_prompt: 原始提示词（用于符合度对比）
        actor_references: 角色参考图片路径列表
        output_dir: 输出目录
        force_reanalyze: 是否强制重新分析
        gemini_skill_path: 已弃用，保留参数兼容性
        api_key: Deprecated compatibility parameter.

    Returns:
        Tuple[Dict, str]: (分析结果, JSON文件路径)
    """
    adapter = GeminiVideoAdapter()
    return adapter.get_analysis_result(
        video_path=video_path,
        segment_id=segment_id,
        expected_duration=expected_duration,
        original_prompt=original_prompt,
        actor_references=actor_references,
        output_dir=output_dir,
        force_reanalyze=force_reanalyze,
        api_key=api_key
    )


# 命令行接口
def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Legacy video review adapter"
    )
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("segment_id", help="片段编号 (SC##-L##)")
    parser.add_argument("expected_duration", type=float, help="期望时长（秒）")
    parser.add_argument("-o", "--output-dir", default="draft/output", help="输出目录")
    parser.add_argument("--force", action="store_true", help="强制重新分析")

    args = parser.parse_args()

    try:
        analysis, json_path = get_video_analysis(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            output_dir=args.output_dir,
            force_reanalyze=args.force
        )

        print(f"\n[OK] 分析完成")
        print(f"[FILE] 结果文件: {json_path}")
        return 0

    except Exception as e:
        print(f"\n[FAIL] 分析失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
