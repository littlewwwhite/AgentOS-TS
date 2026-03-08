#!/usr/bin/env python3
"""
视频自动重新生成工具
读取质量控制报告，自动调用视频生成 API 重新生成不合格的视频
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional


class VideoRegenerator:
    """视频重新生成器"""

    def __init__(self, video_generator: str = "auto"):
        """
        初始化重新生成器

        Args:
            video_generator: 视频生成工具 ('video-create', 'kling-video', 'auto')
        """
        self.video_generator = video_generator

    def detect_generator(self) -> str:
        """自动检测可用的视频生成工具"""
        # 检查 video-create
        video_create_path = (
            Path.home() / ".claude/skills/video-create/scripts/auth.py"
        )
        if video_create_path.exists():
            return "video-create"

        # 检查 kling-video
        kling_video_path = Path.home() / ".claude/skills/kling-video"
        if kling_video_path.exists():
            return "kling-video"

        return None

    def load_quality_report(self, report_file: str) -> Dict:
        """加载质量控制报告"""
        with open(report_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def read_improvement_prompt(self, prompt_file: str) -> str:
        """读取改进提示词"""
        with open(prompt_file, "r", encoding="utf-8") as f:
            return f.read()

    def regenerate_with_video_create(
        self, video_path: str, improvement_prompt: str
    ) -> bool:
        """
        使用 video-create 重新生成视频

        Args:
            video_path: 原视频路径
            improvement_prompt: 改进提示词

        Returns:
            是否成功
        """
        print(f"使用 video-create 重新生成: {video_path}")
        print(f"提示词:\n{improvement_prompt}\n")

        # 这里需要调用 video-create 的 API
        # 由于需要认证和复杂的流程，这里提供命令行提示
        print("请手动执行以下步骤:")
        print("1. 确保已登录 anime-material-workbench")
        print("2. 使用改进提示词重新生成视频")
        print(
            f"3. 将生成的视频保存到: {Path(video_path).parent / (Path(video_path).stem + '_v2' + Path(video_path).suffix)}"
        )

        return False

    def regenerate_with_kling_video(
        self, video_path: str, improvement_prompt: str
    ) -> bool:
        """
        使用 kling-video 重新生成视频

        Args:
            video_path: 原视频路径
            improvement_prompt: 改进提示词

        Returns:
            是否成功
        """
        print(f"使用 kling-video 重新生成: {video_path}")
        print(f"提示词:\n{improvement_prompt}\n")

        # 这里需要调用 kling-video 的 API
        print("请手动执行以下步骤:")
        print("1. 使用 kling-video skill 生成视频")
        print("2. 使用改进提示词作为输入")
        print(
            f"3. 将生成的视频保存到: {Path(video_path).parent / (Path(video_path).stem + '_v2' + Path(video_path).suffix)}"
        )

        return False

    def generate_regeneration_script(
        self, unqualified_videos: List[Dict], output_file: str
    ):
        """
        生成重新生成的脚本文件

        Args:
            unqualified_videos: 不合格视频列表
            output_file: 输出脚本文件路径
        """
        script_lines = ["#!/bin/bash", "# 视频重新生成脚本", ""]

        for video in unqualified_videos:
            video_path = video["path"]
            prompt_file = video.get("improvement_prompt_file")

            if not prompt_file:
                continue

            video_name = Path(video_path).stem
            script_lines.append(f"# 重新生成: {video_name}")
            script_lines.append(f"echo '正在处理: {video_name}'")
            script_lines.append(f"# 提示词文件: {prompt_file}")
            script_lines.append(
                f"# 原视频路径: {video_path}"
            )
            script_lines.append(
                f"# 新视频路径: {Path(video_path).parent / (video_name + '_v2' + Path(video_path).suffix)}"
            )
            script_lines.append("")
            script_lines.append(
                "# TODO: 在这里添加实际的视频生成命令"
            )
            script_lines.append(
                "# 例如: python3 video_generator.py --prompt \"$(cat {})\" --output {}".format(
                    prompt_file,
                    Path(video_path).parent / (video_name + "_v2" + Path(video_path).suffix),
                )
            )
            script_lines.append("")

        with open(output_file, "w", encoding="utf-8") as f:
            f.write("\n".join(script_lines))

        # 添加执行权限
        Path(output_file).chmod(0o755)
        print(f"重新生成脚本已保存: {output_file}")

    def process_quality_report(self, report_file: str, output_dir: str):
        """
        处理质量控制报告，生成重新生成任务

        Args:
            report_file: 质量控制报告文件
            output_dir: 输出目录
        """
        # 加载报告
        report = self.load_quality_report(report_file)

        # 筛选不合格视频
        unqualified_videos = [
            v for v in report["videos"] if not v.get("is_qualified", False)
        ]

        if not unqualified_videos:
            print("所有视频都合格，无需重新生成！")
            return

        print(f"发现 {len(unqualified_videos)} 个不合格视频")
        print("\n不合格视频列表:")
        for i, video in enumerate(unqualified_videos, 1):
            print(
                f"{i}. {video['path']} (评分: {video.get('total_score', 'N/A')}/50)"
            )
            if "reasons" in video:
                for reason in video["reasons"]:
                    print(f"   - {reason}")

        # 生成重新生成脚本
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        script_file = output_path / "regenerate_videos.sh"
        self.generate_regeneration_script(unqualified_videos, str(script_file))

        # 生成详细的重新生成计划
        plan_file = output_path / "regeneration_plan.json"
        plan = {
            "total_videos": len(unqualified_videos),
            "videos": [
                {
                    "original_path": v["path"],
                    "new_path": str(
                        Path(v["path"]).parent
                        / (Path(v["path"]).stem + "_v2" + Path(v["path"]).suffix)
                    ),
                    "improvement_prompt_file": v.get("improvement_prompt_file"),
                    "total_score": v.get("total_score"),
                    "reasons": v.get("reasons", []),
                }
                for v in unqualified_videos
            ],
        }

        with open(plan_file, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)

        print(f"\n重新生成计划已保存: {plan_file}")
        print(f"重新生成脚本已保存: {script_file}")
        print("\n下一步:")
        print(f"1. 查看改进提示词文件（在 {output_dir} 目录）")
        print(f"2. 根据提示词使用视频生成工具重新生成视频")
        print(f"3. 或者编辑 {script_file} 添加实际的生成命令后执行")


def main():
    parser = argparse.ArgumentParser(description="视频自动重新生成工具")
    parser.add_argument(
        "report_file", help="质量控制报告文件 (quality_control_report.json)"
    )
    parser.add_argument(
        "-o", "--output", help="输出目录", default="regeneration_output"
    )
    parser.add_argument(
        "--generator",
        choices=["video-create", "kling-video", "auto"],
        default="auto",
        help="视频生成工具",
    )

    args = parser.parse_args()

    # 检查报告文件是否存在
    if not Path(args.report_file).exists():
        print(f"错误: 报告文件不存在: {args.report_file}")
        sys.exit(1)

    # 初始化重新生成器
    regenerator = VideoRegenerator(video_generator=args.generator)

    # 处理质量报告
    regenerator.process_quality_report(args.report_file, args.output)


if __name__ == "__main__":
    main()
