#!/usr/bin/env python3
"""
视频质量控制和重新生成工具
根据评审结果识别不合格视频，生成优化提示词，并可选择自动重新生成

质量判定规则（按优先级顺序）：
1. 硬性规则（不可配置）：任意维度低于5分必须重新生成
2. 可配置规则：任意维度低于阈值（默认5/10，但不能低于硬性规则）
3. 可配置规则：总分低于阈值（默认30/50）
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 导入评审器
try:
    from review import VideoReviewer
except ImportError:
    sys.path.insert(0, str(Path(__file__).parent))
    from review import VideoReviewer


class VideoQualityController:
    """视频质量控制器"""

    # 默认的维度阈值配置
    DEFAULT_DIMENSION_THRESHOLDS = {
        "plot": 6,       # 剧情：核心维度，要求更高
        "character": 6,  # 人物：核心维度，要求更高
        "scene": 5,      # 场景：重要但可适当放宽
        "direction": 5,  # 调度：重要但可适当放宽
        "duration": 4,   # 时长：相对次要
    }

    def __init__(
        self,
        min_total_score: int = 30,
        min_dimension_score: Optional[int] = None,  # 已弃用，保留向后兼容
        dimension_thresholds: Optional[Dict[str, int]] = None,
        config_path: Optional[str] = None,
    ):
        """
        初始化质量控制器

        Args:
            min_total_score: 最低总分阈值（默认30/50）
            min_dimension_score: 单个维度最低分（已弃用，使用 dimension_thresholds）
            dimension_thresholds: 各维度的阈值配置（如果不指定则使用默认值）
            config_path: 配置文件路径
        """
        self.min_total_score = min_total_score

        # 如果提供了 dimension_thresholds，使用它；否则使用默认配置
        if dimension_thresholds is not None:
            self.dimension_thresholds = dimension_thresholds
        else:
            self.dimension_thresholds = self.DEFAULT_DIMENSION_THRESHOLDS.copy()

        # 向后兼容：如果提供了 min_dimension_score，覆盖所有维度的阈值
        if min_dimension_score is not None:
            for key in self.dimension_thresholds:
                self.dimension_thresholds[key] = min_dimension_score

        self.reviewer = VideoReviewer(config_path=config_path)

    def is_video_qualified(
        self, reviews: Dict, total_score: int
    ) -> Tuple[bool, List[str]]:
        """
        判断视频是否合格

        判定顺序：
        1. 硬性规则：任意维度低于5分必须重新生成（不可配置）
        2. 检查各维度：每个维度有独立的阈值要求
        3. 检查总分：总分低于阈值

        Args:
            reviews: 各维度评审结果
            total_score: 总分

        Returns:
            (是否合格, 不合格原因列表)
        """
        reasons = []

        # 第1步：硬性规则 - 任意维度低于5分必须重新生成
        HARD_MIN_DIMENSION_SCORE = 5
        for dim_key, review in reviews.items():
            score = review["score"]
            if score < HARD_MIN_DIMENSION_SCORE:
                dim_name = self.reviewer.dimensions[dim_key]["name"]
                reasons.append(
                    f"[FAIL] {dim_name}维度严重不达标: {score}/10 (硬性要求 >= {HARD_MIN_DIMENSION_SCORE}，必须重新生成)"
                )

        # 第2步：检查各维度（使用独立的阈值）
        for dim_key, review in reviews.items():
            score = review["score"]
            # 获取该维度的阈值，如果没有配置则使用默认值5
            threshold = self.dimension_thresholds.get(dim_key, 5)

            # 只检查高于硬性规则但低于配置阈值的情况
            if HARD_MIN_DIMENSION_SCORE <= score < threshold:
                dim_name = self.reviewer.dimensions[dim_key]["name"]
                reasons.append(
                    f"{dim_name}维度不达标: {score}/10 (要求 >= {threshold})"
                )

        # 第3步：检查总分
        if total_score < self.min_total_score:
            reasons.append(
                f"总分过低: {total_score}/50 (要求 >= {self.min_total_score})"
            )

        return len(reasons) == 0, reasons

    def generate_improvement_prompt(
        self, reviews: Dict, metadata: Optional[Dict] = None
    ) -> str:
        """
        根据评审结果生成改进的视频生成提示词

        Args:
            reviews: 各维度评审结果
            metadata: 视频元数据

        Returns:
            优化后的提示词
        """
        prompt_parts = []

        # 添加元数据信息
        if metadata:
            prompt_parts.append(
                f"# 视频信息: 第{metadata.get('episode', 'N/A')}集 "
                f"第{metadata.get('scene', 'N/A')}场景 "
                f"第{metadata.get('line', 'N/A')}镜头"
            )
            prompt_parts.append("")

        prompt_parts.append("# 视频生成要求")
        prompt_parts.append("")

        # 根据各维度的评审建议生成提示词
        for dim_key, review in reviews.items():
            dim_name = self.reviewer.dimensions[dim_key]["name"]
            score = review["score"]

            # 只针对评分较低的维度添加改进要求
            if score < 7:
                prompt_parts.append(f"## {dim_name}方面:")
                for suggestion in review["suggestions"]:
                    prompt_parts.append(f"- {suggestion}")
                prompt_parts.append("")

        # 添加通用要求
        prompt_parts.append("## 整体要求:")
        prompt_parts.append("- 确保画面清晰，构图合理")
        prompt_parts.append("- 注意节奏控制，避免拖沓")
        prompt_parts.append("- 保持风格统一，符合整体调性")

        return "\n".join(prompt_parts)

    def review_and_analyze(
        self, video_path: str
    ) -> Tuple[Dict, int, bool, List[str], str]:
        """
        评审视频并分析是否需要重新生成

        Args:
            video_path: 视频文件路径

        Returns:
            (评审结果, 总分, 是否合格, 不合格原因, 改进提示词)
        """
        # 执行评审
        print(f"正在评审: {video_path}")

        # 获取评审结果（需要修改 review 方法返回详细数据）
        # 这里我们需要直接调用内部方法
        if self.reviewer._is_video_file(video_path):
            video_content, metadata = self.reviewer.analyze_video_file(video_path)
            script = video_content
            analysis = self.reviewer.analyze_script(script)
            if metadata:
                analysis["metadata"] = metadata
        else:
            script = self.reviewer.read_script(video_path)
            analysis = self.reviewer.analyze_script(script)
            metadata = None

        # 评审各维度
        reviews = {}
        for dim_key in self.reviewer.dimensions.keys():
            score, evaluation, suggestions = self.reviewer.review_dimension(
                dim_key, script, analysis
            )
            reviews[dim_key] = {
                "score": score,
                "evaluation": evaluation,
                "suggestions": suggestions,
            }

        # 计算总分
        total_score = sum(r["score"] for r in reviews.values())

        # 判断是否合格
        is_qualified, reasons = self.is_video_qualified(reviews, total_score)

        # 生成改进提示词
        improvement_prompt = self.generate_improvement_prompt(
            reviews, analysis.get("metadata")
        )

        return reviews, total_score, is_qualified, reasons, improvement_prompt

    def batch_quality_control(
        self, video_paths: List[str], output_dir: str
    ) -> Dict:
        """
        批量质量控制

        Args:
            video_paths: 视频文件路径列表
            output_dir: 输出目录

        Returns:
            质量控制报告
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        results = {
            "total": len(video_paths),
            "qualified": 0,
            "unqualified": 0,
            "videos": [],
        }

        for video_path in video_paths:
            try:
                (
                    reviews,
                    total_score,
                    is_qualified,
                    reasons,
                    improvement_prompt,
                ) = self.review_and_analyze(video_path)

                video_result = {
                    "path": video_path,
                    "total_score": total_score,
                    "is_qualified": is_qualified,
                    "reasons": reasons,
                    "reviews": reviews,
                }

                if is_qualified:
                    results["qualified"] += 1
                    print(f"  ✓ 合格 ({total_score}/50)")
                else:
                    results["unqualified"] += 1
                    print(f"  ✗ 不合格 ({total_score}/50)")
                    print(f"    原因: {', '.join(reasons)}")

                    # 保存改进提示词
                    video_name = Path(video_path).stem
                    prompt_file = output_path / f"{video_name}_improvement_prompt.txt"
                    with open(prompt_file, "w", encoding="utf-8") as f:
                        f.write(improvement_prompt)
                    video_result["improvement_prompt_file"] = str(prompt_file)
                    print(f"    改进提示词已保存: {prompt_file}")

                results["videos"].append(video_result)

            except Exception as e:
                print(f"  ✗ 错误: {e}")
                results["videos"].append(
                    {"path": video_path, "error": str(e), "is_qualified": False}
                )

        # 保存完整报告
        report_file = output_path / "quality_control_report.json"
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        # 生成待重新生成列表
        unqualified_videos = [
            v for v in results["videos"] if not v.get("is_qualified", False)
        ]
        if unqualified_videos:
            regenerate_list_file = output_path / "videos_to_regenerate.txt"
            with open(regenerate_list_file, "w", encoding="utf-8") as f:
                for video in unqualified_videos:
                    f.write(f"{video['path']}\n")
            print(f"\n待重新生成列表已保存: {regenerate_list_file}")

        return results


def main():
    parser = argparse.ArgumentParser(description="视频质量控制和重新生成工具")
    parser.add_argument("video_path", help="视频文件路径或包含视频的目录")
    parser.add_argument(
        "-o", "--output", help="输出目录", default="quality_control_output"
    )
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

    args = parser.parse_args()

    # 初始化质量控制器
    controller = VideoQualityController(
        min_total_score=args.min_total_score,
        min_dimension_score=args.min_dimension_score,
        config_path=args.config,
    )

    # 判断是单个文件还是目录
    path = Path(args.video_path)
    if path.is_file():
        # 单个文件
        (
            reviews,
            total_score,
            is_qualified,
            reasons,
            improvement_prompt,
        ) = controller.review_and_analyze(str(path))

        print("\n" + "=" * 60)
        print(f"评审结果: {'✓ 合格' if is_qualified else '✗ 不合格'}")
        print(f"总分: {total_score}/50")

        if not is_qualified:
            print("\n不合格原因:")
            for reason in reasons:
                print(f"  - {reason}")

            print("\n改进提示词:")
            print("-" * 60)
            print(improvement_prompt)

            # 保存提示词
            output_path = Path(args.output)
            output_path.mkdir(parents=True, exist_ok=True)
            prompt_file = output_path / f"{path.stem}_improvement_prompt.txt"
            with open(prompt_file, "w", encoding="utf-8") as f:
                f.write(improvement_prompt)
            print(f"\n改进提示词已保存: {prompt_file}")

    elif path.is_dir():
        # 目录批量处理
        video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
        video_files = []
        for ext in video_extensions:
            video_files.extend(path.glob(f"**/*{ext}"))

        if not video_files:
            print(f"错误: 在 {path} 中未找到视频文件")
            sys.exit(1)

        print(f"找到 {len(video_files)} 个视频文件\n")
        results = controller.batch_quality_control(
            [str(f) for f in video_files], args.output
        )

        print("\n" + "=" * 60)
        print("质量控制报告")
        print("=" * 60)
        print(f"总计: {results['total']} 个视频")
        print(f"合格: {results['qualified']} 个")
        print(f"不合格: {results['unqualified']} 个")
        print(f"合格率: {results['qualified']/results['total']*100:.1f}%")
        print(f"\n完整报告: {args.output}/quality_control_report.json")

    else:
        print(f"错误: {path} 不是有效的文件或目录")
        sys.exit(1)


if __name__ == "__main__":
    main()
