#!/usr/bin/env python3
"""
自动化视频重新生成工具
当视频不合格时，自动调用 drama-storyboard skill 优化提示词并重新生成视频
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

try:
    from quality_control import VideoQualityController
except ImportError:
    sys.path.insert(0, str(Path(__file__).parent))
    from quality_control import VideoQualityController


class AutoRegenerator:
    """自动化视频重新生成器"""

    def __init__(
        self,
        min_total_score: int = 30,
        min_dimension_score: int = 5,
        config_path: Optional[str] = None,
    ):
        self.controller = VideoQualityController(
            min_total_score=min_total_score,
            min_dimension_score=min_dimension_score,
            config_path=config_path,
        )

    def call_drama_storyboard_skill(
        self, improvement_prompt: str, metadata: Optional[Dict] = None
    ) -> str:
        """
        调用 drama-storyboard skill 生成优化的视频提示词

        Args:
            improvement_prompt: 改进建议
            metadata: 视频元数据

        Returns:
            优化后的视频生成提示词
        """
        print("\n" + "=" * 60)
        print("调用 drama-storyboard skill 优化提示词")
        print("=" * 60)

        # 构建剧本内容
        script_content = f"""# 视频重新生成需求

## 原视频信息
"""
        if metadata:
            script_content += f"""- 集数: 第 {metadata.get('episode', 'N/A')} 集
- 场景: 第 {metadata.get('scene', 'N/A')} 场景
- 镜头: 第 {metadata.get('line', 'N/A')} 镜头
- 剪辑版本: 第 {metadata.get('cut', 'N/A')} 版

"""

        script_content += f"""## 改进要求

{improvement_prompt}

## 请生成优化后的视频提示词
画幅: 16:9（横屏）
时长: 根据内容自动判断
"""

        # 保存临时脚本文件
        temp_script_file = Path("/tmp/video_regeneration_script.txt")
        with open(temp_script_file, "w", encoding="utf-8") as f:
            f.write(script_content)

        print(f"\n临时脚本已保存: {temp_script_file}")
        print("\n正在调用 drama-storyboard skill...")

        # 调用 skill（使用 Claude Code 的 Skill 工具）
        # 这里我们生成一个可以手动执行的命令
        skill_command = f"/drama-storyboard {temp_script_file}"

        print(f"\nSkill 调用命令: {skill_command}")
        print("\n注意: 由于 skill 需要在 Claude Code 环境中执行，")
        print("请手动执行上述命令，或者使用以下 Python 代码调用：")
        print(f"\nfrom claude_code import skill")
        print(f"result = skill('drama-storyboard', '{temp_script_file}')")

        # 返回提示信息
        return f"请使用 drama-storyboard skill 处理文件: {temp_script_file}"

    def regenerate_video(
        self,
        video_path: str,
        optimized_prompt: str,
        metadata: Optional[Dict] = None,
        regenerate_type: str = "complete_l",
        base_l_version: Optional[int] = None,
    ) -> str:
        """
        使用优化后的提示词重新生成视频

        命名规则（三种格式）：
        1. 原始完整 l: ep##-sc##-l##.mp4
        2. 重新生成的完整 l: ep##-sc##-l##-##.mp4 (版本号从01开始)
        3. 单个镜头（基于某个 l 版本）: ep##-sc##-l##-##-c##.mp4

        Args:
            video_path: 原视频路径
            optimized_prompt: 优化后的提示词
            metadata: 视频元数据
            regenerate_type: 重新生成类型 ("complete_l" 或 "single_shot")
            base_l_version: 基于哪个 l 版本（仅用于 single_shot）

        Returns:
            新视频路径
        """
        print("\n" + "=" * 60)
        print("重新生成视频")
        print("=" * 60)

        # 生成新的视频文件名
        path = Path(video_path)

        if metadata:
            episode = metadata.get("episode")
            scene = metadata.get("scene")
            line = metadata.get("line")
            video_type = metadata.get("type")  # 'original_l', 'regenerated_l', 'shot'

            if episode is not None and scene is not None and line is not None:
                if regenerate_type == "single_shot":
                    # 重新生成单个镜头: ep##-sc##-l##-##-c##.mp4
                    # 需要指定基于哪个 l 版本
                    if base_l_version is None:
                        # 如果没有指定，尝试从元数据获取
                        if video_type == "regenerated_l":
                            # 如果当前是重新生成的 l，使用其版本号
                            base_l_version = metadata.get("version", 1)
                        elif video_type == "shot":
                            # 如果当前是镜头，使用其 base_version
                            base_l_version = metadata.get("base_version", 1)
                        else:
                            # 原始 l，默认使用版本 1（假设已经有一个合格的版本）
                            base_l_version = 1
                            print(f"[WARN]  警告: 未指定 base_l_version，默认使用版本 {base_l_version}")

                    shot = metadata.get("shot")
                    if shot is not None:
                        # 已经是镜头视频，继续增加镜头号
                        new_shot = shot + 1
                    else:
                        # 从完整 l 中提取单个镜头，从 c01 开始
                        new_shot = 1

                    new_filename = f"ep{episode:02d}-sc{scene:02d}-l{line:02d}-{base_l_version:02d}-c{new_shot:02d}{path.suffix}"
                    print(f"类型: 重新生成单个镜头 (基于 l 版本 {base_l_version:02d}，镜头 c{new_shot:02d})")
                else:
                    # 重新生成完整 l: ep##-sc##-l##-##.mp4
                    version = metadata.get("version")
                    if version is not None:
                        # 已经是重新生成的 l，继续增加版本号
                        new_version = version + 1
                    else:
                        # 原始 l，第一次重新生成为 -01
                        new_version = 1
                    new_filename = f"ep{episode:02d}-sc{scene:02d}-l{line:02d}-{new_version:02d}{path.suffix}"
                    print(f"类型: 重新生成完整 l (版本 {new_version:02d})")

                new_video_path = path.parent / new_filename
            else:
                # 元数据不完整，使用简单的 _v2 后缀
                new_video_path = path.parent / f"{path.stem}_v2{path.suffix}"
                print("类型: 元数据不完整，使用简单命名")
        else:
            # 没有元数据，使用简单的 _v2 后缀
            new_video_path = path.parent / f"{path.stem}_v2{path.suffix}"
            print("类型: 无元数据，使用简单命名")

        print(f"\n原视频: {video_path}")
        print(f"新视频: {new_video_path}")

        # 保存优化后的提示词
        prompt_file = path.parent / f"{new_video_path.stem}_prompt.txt"
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write(optimized_prompt)

        print(f"优化提示词已保存: {prompt_file}")

        # 这里应该调用实际的视频生成 API
        # 由于需要集成具体的视频生成服务，这里提供命令模板
        print("\n请使用以下命令生成视频:")
        print(f"python3 {Path(__file__).resolve().parent / 'submit_video_create.py'} \\")
        print(f"  --prompt-file {prompt_file} \\")
        print(f"  --output {new_video_path}")

        return str(new_video_path)

    def auto_regenerate_workflow(
        self, video_path: str, regenerate_type: str = "complete_l"
    ) -> Dict:
        """
        完整的自动化重新生成工作流

        Args:
            video_path: 视频文件路径
            regenerate_type: 重新生成类型 ("complete_l" 或 "single_shot")

        Returns:
            工作流结果
        """
        result = {
            "original_video": video_path,
            "status": "unknown",
            "steps": [],
        }

        # 步骤1: 评审视频
        print("\n" + "=" * 60)
        print("步骤1: 评审视频质量")
        print("=" * 60)

        try:
            (
                reviews,
                total_score,
                is_qualified,
                reasons,
                improvement_prompt,
            ) = self.controller.review_and_analyze(video_path)

            result["steps"].append(
                {
                    "step": 1,
                    "name": "评审视频",
                    "status": "success",
                    "total_score": total_score,
                    "is_qualified": is_qualified,
                }
            )

            print(f"\n评审结果: {'✓ 合格' if is_qualified else '✗ 不合格'}")
            print(f"总分: {total_score}/50")

            if is_qualified:
                print("\n视频质量合格，无需重新生成！")
                result["status"] = "qualified"
                return result

            print("\n不合格原因:")
            for reason in reasons:
                print(f"  - {reason}")

        except Exception as e:
            print(f"\n错误: 评审失败 - {e}")
            result["steps"].append(
                {"step": 1, "name": "评审视频", "status": "error", "error": str(e)}
            )
            result["status"] = "error"
            return result

        # 步骤2: 调用 drama-storyboard skill 优化提示词
        print("\n" + "=" * 60)
        print("步骤2: 优化视频提示词")
        print("=" * 60)

        try:
            # 获取元数据
            metadata = None
            if hasattr(self.controller.reviewer, "_is_video_file"):
                if self.controller.reviewer._is_video_file(video_path):
                    from video_analyzer import VideoPathParser

                    metadata = VideoPathParser.parse(video_path)

            # 调用 skill
            skill_result = self.call_drama_storyboard_skill(
                improvement_prompt, metadata
            )

            result["steps"].append(
                {
                    "step": 2,
                    "name": "优化提示词",
                    "status": "pending",
                    "note": skill_result,
                }
            )

            # 由于 skill 需要手动执行，这里暂停
            print("\n" + "=" * 60)
            print("[WARN]  需要手动操作")
            print("=" * 60)
            print("\n请按照上述说明调用 drama-storyboard skill")
            print("生成优化后的提示词，然后继续执行步骤3")

            result["status"] = "pending_skill_execution"
            result["improvement_prompt"] = improvement_prompt
            result["metadata"] = metadata

        except Exception as e:
            print(f"\n错误: 优化提示词失败 - {e}")
            result["steps"].append(
                {"step": 2, "name": "优化提示词", "status": "error", "error": str(e)}
            )
            result["status"] = "error"

        return result


def main():
    parser = argparse.ArgumentParser(description="自动化视频重新生成工具")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument(
        "--min-total-score",
        type=int,
        default=30,
        help="最低总分阈值 (默认: 30/50)",
    )
    parser.add_argument(
        "--min-dimension-score",
        type=int,
        default=5,
        help="单个维度最低分 (默认: 5/10)",
    )
    parser.add_argument("-c", "--config", help="配置文件路径", default=None)
    parser.add_argument(
        "-o", "--output", help="输出目录", default="auto_regeneration_output"
    )
    parser.add_argument(
        "--regenerate-type",
        choices=["complete_l", "single_shot"],
        default="complete_l",
        help="重新生成类型: complete_l (完整 l 段落) 或 single_shot (单个镜头)",
    )
    parser.add_argument(
        "--base-l-version",
        type=int,
        default=None,
        help="基于哪个 l 版本（仅用于 single_shot，如果不指定则自动推断）",
    )

    args = parser.parse_args()

    # 初始化自动重新生成器
    regenerator = AutoRegenerator(
        min_total_score=args.min_total_score,
        min_dimension_score=args.min_dimension_score,
        config_path=args.config,
    )

    # 执行自动化工作流
    result = regenerator.auto_regenerate_workflow(
        args.video_path, regenerate_type=args.regenerate_type
    )

    # 保存结果
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)

    result_file = output_path / "auto_regeneration_result.json"
    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n工作流结果已保存: {result_file}")

    # 输出总结
    print("\n" + "=" * 60)
    print("工作流总结")
    print("=" * 60)
    print(f"状态: {result['status']}")
    print(f"完成步骤: {len([s for s in result['steps'] if s['status'] == 'success'])}/{len(result['steps'])}")


if __name__ == "__main__":
    main()
