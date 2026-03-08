#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini Video Skill Adapter
智能适配器：调用独立的gemini-video.skill或读取其输出
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from typing import Optional, Dict, Tuple, List

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


class GeminiVideoAdapter:
    """
    Gemini Video Skill 适配器

    功能：
    1. 检查是否已有分析结果JSON
    2. 如果没有，尝试调用gemini-video.skill
    3. 读取并返回分析结果
    """

    def __init__(self, gemini_skill_path: Optional[str] = None):
        """
        初始化适配器

        Args:
            gemini_skill_path: gemini-video.skill的路径（可选）
        """
        self.gemini_skill_path = gemini_skill_path or self._find_gemini_skill()

    def _find_gemini_skill(self) -> Optional[str]:
        """自动查找gemini-video.skill"""
        # 常见位置
        possible_paths = [
            "D:/Zhuchen/Projects/.claude/skills/gemini-video.skill",
            "../gemini-video.skill",
            "../../gemini-video.skill",
        ]

        for path in possible_paths:
            if Path(path).exists():
                return path

        return None

    def get_analysis_result(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str] = None,
        character_references: Optional[List[str]] = None,
        output_dir: str = "workspace/output",
        force_reanalyze: bool = False,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """
        获取视频分析结果

        Args:
            video_path: 视频文件路径
            segment_id: 片段编号 (SC##-L##)
            expected_duration: 期望时长（秒）
            original_prompt: 原始提示词（用于符合度对比）
            character_references: 角色参考图片路径列表
            output_dir: 输出目录
            force_reanalyze: 是否强制重新分析

        Returns:
            Tuple[Dict, str]: (分析结果字典, JSON文件路径)
        """

        # 生成分析结果文件名
        analysis_filename = f"{segment_id.lower().replace('-', '')}_analysis.json"
        analysis_path = Path(output_dir) / analysis_filename

        # 1. 检查是否已有分析结果
        if analysis_path.exists() and not force_reanalyze:
            print(f"[OK] 找到已有分析结果: {analysis_path}")
            return self._load_analysis_result(str(analysis_path)), str(analysis_path)

        # 2. 如果没有，尝试调用gemini-video.skill
        print(f"[STAT] 未找到分析结果，准备分析视频...")

        # 检查是否可以调用gemini-video.skill
        if self.gemini_skill_path and Path(self.gemini_skill_path).exists():
            print(f"[TOOL] 使用gemini-video.skill: {self.gemini_skill_path}")
            return self._call_gemini_skill(
                video_path,
                segment_id,
                expected_duration,
                original_prompt,
                character_references,
                output_dir,
                api_key
            )

        # 3. 如果无法调用，使用内置的gemini_analyzer
        print(f"[WARN]  未找到gemini-video.skill，使用内置分析器")
        return self._use_builtin_analyzer(
            video_path,
            segment_id,
            expected_duration,
            original_prompt,
            character_references,
            output_dir,
            api_key
        )

    def _load_analysis_result(self, json_path: str) -> Dict:
        """加载分析结果JSON"""
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _call_gemini_skill(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str],
        character_references: Optional[List[str]],
        output_dir: str,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """
        调用gemini-video.skill

        注意：这里假设gemini-video.skill已经解压并可以直接调用
        实际使用时需要根据gemini-video.skill的具体实现调整
        """

        # TODO: 根据gemini-video.skill的实际接口调整
        # 这里提供一个示例实现

        print(f"[UPLOAD] 调用gemini-video.skill分析视频...")

        # 假设gemini-video.skill有一个命令行接口
        # 实际使用时需要根据其文档调整

        # 示例命令（需要根据实际情况调整）
        # result = subprocess.run([
        #     "python3",
        #     f"{self.gemini_skill_path}/analyze.py",
        #     video_path,
        #     segment_id,
        #     str(expected_duration),
        #     "-o", output_dir
        # ], capture_output=True, text=True)

        # 如果调用失败，回退到内置分析器
        print(f"[WARN]  gemini-video.skill调用接口待实现，使用内置分析器")
        return self._use_builtin_analyzer(
            video_path,
            segment_id,
            expected_duration,
            original_prompt,
            character_references,
            output_dir,
            api_key
        )

    def _use_builtin_analyzer(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str],
        character_references: Optional[List[str]],
        output_dir: str,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """使用内置的gemini_analyzer"""

        # 导入内置分析器
        import sys
        sys.path.insert(0, str(Path(__file__).parent))

        from gemini_analyzer import analyze_video_for_review, save_analysis_result

        # 分析视频
        analysis = analyze_video_for_review(
            video_path=video_path,
            segment_id=segment_id,
            expected_duration=expected_duration,
            original_prompt=original_prompt,
            character_references=character_references,
            api_key=api_key
        )

        # 保存结果
        analysis_file = save_analysis_result(
            analysis=analysis,
            output_dir=output_dir
        )

        return analysis.model_dump(), analysis_file


def get_video_analysis(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: Optional[str] = None,
    character_references: Optional[List[str]] = None,
    output_dir: str = "workspace/output",
    force_reanalyze: bool = False,
    gemini_skill_path: Optional[str] = None,
    api_key: Optional[str] = None
) -> Tuple[Dict, str]:
    """
    便捷函数：获取视频分析结果

    优先级：
    1. 读取已有的分析结果JSON
    2. 调用gemini-video.skill（如果可用）
    3. 使用内置的gemini_analyzer

    Args:
        video_path: 视频文件路径
        segment_id: 片段编号
        expected_duration: 期望时长
        original_prompt: 原始提示词（用于符合度对比）
        output_dir: 输出目录
        force_reanalyze: 是否强制重新分析
        gemini_skill_path: gemini-video.skill路径（可选）

    Returns:
        Tuple[Dict, str]: (分析结果, JSON文件路径)
    """

    adapter = GeminiVideoAdapter(gemini_skill_path)
    return adapter.get_analysis_result(
        video_path=video_path,
        segment_id=segment_id,
        expected_duration=expected_duration,
        original_prompt=original_prompt,
        character_references=character_references,
        output_dir=output_dir,
        force_reanalyze=force_reanalyze,
        api_key=api_key
    )


# 命令行接口
def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Gemini Video Skill 适配器"
    )
    parser.add_argument(
        "video_path",
        help="视频文件路径"
    )
    parser.add_argument(
        "segment_id",
        help="片段编号 (SC##-L##)"
    )
    parser.add_argument(
        "expected_duration",
        type=float,
        help="期望时长（秒）"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重新分析"
    )
    parser.add_argument(
        "--gemini-skill",
        help="gemini-video.skill路径"
    )

    args = parser.parse_args()

    try:
        analysis, json_path = get_video_analysis(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            output_dir=args.output_dir,
            force_reanalyze=args.force,
            gemini_skill_path=args.gemini_skill
        )

        print(f"\n[OK] 分析完成")
        print(f"[FILE] 结果文件: {json_path}")
        print(f"[STAT] 片段: {analysis['segment_id']}")

        return 0

    except Exception as e:
        print(f"\n[FAIL] 分析失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
