#!/usr/bin/env python3
"""
视频评审工具 - 主执行脚本
支持文本脚本评审和视频文件分析
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 尝试导入视频分析器
try:
    from video_analyzer import VideoPathParser, GeminiVideoAnalyzer
    VIDEO_ANALYSIS_AVAILABLE = True
except ImportError:
    VIDEO_ANALYSIS_AVAILABLE = False

# 评审维度配置
DIMENSIONS = {
    "plot": {"name": "剧情", "weight": 1.0, "max_score": 10},
    "character": {"name": "人物", "weight": 1.0, "max_score": 10},
    "scene": {"name": "场景", "weight": 1.0, "max_score": 10},
    "direction": {"name": "调度", "weight": 1.0, "max_score": 10},
    "duration": {"name": "时长", "weight": 1.0, "max_score": 10},
}


class VideoReviewer:
    """视频评审器"""

    def __init__(self, config_path: Optional[str] = None):
        self.config = self._load_config(config_path)
        self.dimensions = DIMENSIONS.copy()

        # 如果有自定义配置，更新维度
        if self.config and "dimensions" in self.config:
            self.dimensions.update(self.config["dimensions"])

    def _load_config(self, config_path: Optional[str]) -> Dict:
        """加载配置文件"""
        if not config_path:
            config_path = Path.home() / ".video_review_config.json"

        if Path(config_path).exists():
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _is_video_file(self, file_path: str) -> bool:
        """判断是否为视频文件"""
        video_extensions = [".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv"]
        return Path(file_path).suffix.lower() in video_extensions

    def read_script(self, file_path: str) -> str:
        """读取脚本文件"""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        # 支持多种格式
        supported_formats = [".txt", ".md", ".json"]
        if path.suffix.lower() not in supported_formats:
            print(f"警告: 文件格式 {path.suffix} 可能不被支持，尝试读取...")

        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        # 如果是 JSON 格式，尝试提取脚本内容
        if path.suffix.lower() == ".json":
            try:
                data = json.loads(content)
                # 尝试常见的字段名
                for key in ["script", "content", "text", "description"]:
                    if key in data:
                        return data[key]
                # 如果没有找到，返回整个 JSON 的字符串表示
                return json.dumps(data, ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                pass

        return content

    def analyze_script(self, script: str) -> Dict:
        """分析脚本内容（基础版本，后续可接入 AI）"""
        analysis = {
            "word_count": len(script),
            "line_count": len(script.split("\n")),
            "has_dialogue": "：" in script or ":" in script,
            "has_scene_description": any(
                keyword in script for keyword in ["场景", "镜头", "画面"]
            ),
        }
        return analysis

    def review_dimension(
        self, dimension_key: str, script: str, analysis: Dict
    ) -> Tuple[int, str, List[str]]:
        """评审单个维度（基础版本）"""
        dimension = self.dimensions[dimension_key]
        score = 5  # 默认中等分数
        evaluation = ""
        suggestions = []

        if dimension_key == "plot":
            # 剧情维度评审
            if analysis["word_count"] < 100:
                score = 4
                evaluation = "脚本内容较短，故事结构不够完整。"
                suggestions = ["扩充故事内容，完善开头、发展、高潮、结尾结构"]
            else:
                score = 7
                evaluation = "脚本具有基本的故事结构。"
                suggestions = ["可以增强冲突设置，使剧情更有张力"]

        elif dimension_key == "character":
            # 人物维度评审
            if analysis["has_dialogue"]:
                score = 7
                evaluation = "脚本包含对话，人物有一定的表现空间。"
                suggestions = ["可以进一步丰富人物性格特征"]
            else:
                score = 5
                evaluation = "脚本缺少对话，人物刻画不够立体。"
                suggestions = ["增加人物对话和互动", "明确人物性格设定"]

        elif dimension_key == "scene":
            # 场景维度评审
            if analysis["has_scene_description"]:
                score = 7
                evaluation = "脚本包含场景描述，画面感较好。"
                suggestions = ["可以增加更多细节描写，增强视觉冲击力"]
            else:
                score = 5
                evaluation = "场景描述不够清晰，缺乏画面感。"
                suggestions = ["增加场景细节描述", "明确场景转换逻辑"]

        elif dimension_key == "direction":
            # 调度维度评审
            score = 6
            evaluation = "基础的叙事结构，镜头语言有待丰富。"
            suggestions = ["增加镜头运用描述（特写、全景等）", "注意节奏控制"]

        elif dimension_key == "duration":
            # 时长维度评审
            estimated_duration = analysis["word_count"] / 3  # 粗略估算：3字/秒
            if 30 <= estimated_duration <= 180:
                score = 8
                evaluation = f"预估时长约 {estimated_duration:.0f} 秒，适合短视频平台。"
                suggestions = ["保持当前节奏"]
            elif estimated_duration < 30:
                score = 6
                evaluation = f"预估时长约 {estimated_duration:.0f} 秒，内容略显单薄。"
                suggestions = ["适当扩充内容，增加信息密度"]
            else:
                score = 6
                evaluation = f"预估时长约 {estimated_duration:.0f} 秒，可能过长。"
                suggestions = ["精简内容，提高节奏紧凑度"]

        return score, evaluation, suggestions

    def generate_report(
        self, file_path: str, script: str, reviews: Dict, metadata: Optional[Dict] = None
    ) -> str:
        """生成评审报告"""
        total_score = sum(r["score"] for r in reviews.values())
        max_total_score = sum(d["max_score"] for d in self.dimensions.values())

        report = f"""# 视频评审报告

**视频文件**: {file_path}
**评审时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
**综合评分**: {total_score}/{max_total_score}
"""

        # 如果有元数据，添加到报告中
        if metadata:
            report += f"""
**视频元数据**:
- 集数: 第 {metadata.get('episode', 'N/A')} 集
- 场景: 第 {metadata.get('scene', 'N/A')} 场景
- 镜头: 第 {metadata.get('line', 'N/A')} 镜头
- 剪辑版本: 第 {metadata.get('cut', 'N/A')} 版
"""

        report += "\n---\n\n"

        # 各维度详细评审
        for dim_key, dim_info in self.dimensions.items():
            if dim_key not in reviews:
                continue

            review = reviews[dim_key]
            report += f"""## {dim_info['name']}维度 [{review['score']}/{dim_info['max_score']}]

**评价**:
{review['evaluation']}

**改进建议**:
"""
            for suggestion in review["suggestions"]:
                report += f"- {suggestion}\n"

            report += "\n---\n\n"

        # 总体建议
        report += """## 总体建议

"""
        if total_score >= max_total_score * 0.8:
            report += "整体质量优秀，各维度表现均衡。建议在细节打磨上继续优化。\n"
        elif total_score >= max_total_score * 0.6:
            report += "整体质量良好，有一定提升空间。重点关注评分较低的维度进行优化。\n"
        else:
            report += "整体质量有待提升。建议从剧情和人物两个核心维度入手，逐步完善。\n"

        return report

        return report

    def analyze_video_file(self, file_path: str) -> Tuple[str, Optional[Dict]]:
        """
        分析视频文件

        Returns:
            (视频内容描述, 路径元数据)
        """
        if not VIDEO_ANALYSIS_AVAILABLE:
            raise ImportError(
                "视频分析功能不可用，请安装: pip install google-genai pydantic"
            )

        # 解析路径元数据
        metadata = VideoPathParser.parse(file_path)
        if metadata:
            print(f"视频元数据: 第{metadata['episode']}集 第{metadata['scene']}场景 "
                  f"第{metadata['line']}镜头 第{metadata['cut']}剪辑版本")

        # 使用 Gemini 分析视频
        analyzer = GeminiVideoAnalyzer()
        video_content, _ = analyzer.analyze_video_file(file_path, cleanup=True)

        return video_content, metadata

    def review(self, file_path: str, output_format: str = "markdown") -> str:
        """执行完整的评审流程"""
        # 判断是视频文件还是脚本文件
        if self._is_video_file(file_path):
            print("检测到视频文件，使用 Gemini 分析...")
            video_content, metadata = self.analyze_video_file(file_path)
            script = video_content
            # 将元数据添加到分析中
            analysis = self.analyze_script(script)
            if metadata:
                analysis["metadata"] = metadata
        else:
            # 读取脚本
            script = self.read_script(file_path)
            # 分析脚本
            analysis = self.analyze_script(script)

        # 评审各维度
        reviews = {}
        for dim_key in self.dimensions.keys():
            score, evaluation, suggestions = self.review_dimension(
                dim_key, script, analysis
            )
            reviews[dim_key] = {
                "score": score,
                "evaluation": evaluation,
                "suggestions": suggestions,
            }

        # 生成报告
        metadata = analysis.get("metadata")
        if output_format == "markdown":
            return self.generate_report(file_path, script, reviews, metadata)
        elif output_format == "json":
            return json.dumps(
                {
                    "file_path": file_path,
                    "timestamp": datetime.now().isoformat(),
                    "reviews": reviews,
                    "total_score": sum(r["score"] for r in reviews.values()),
                },
                ensure_ascii=False,
                indent=2,
            )
        else:
            raise ValueError(f"不支持的输出格式: {output_format}")


def main():
    parser = argparse.ArgumentParser(description="视频内容评审工具")
    parser.add_argument("file_path", help="视频脚本文件路径")
    parser.add_argument(
        "-o",
        "--output",
        help="输出文件路径（不指定则输出到控制台）",
        default=None,
    )
    parser.add_argument(
        "-f",
        "--format",
        help="输出格式 (markdown/json)",
        choices=["markdown", "json"],
        default="markdown",
    )
    parser.add_argument(
        "-c", "--config", help="配置文件路径", default=None
    )

    args = parser.parse_args()

    try:
        reviewer = VideoReviewer(config_path=args.config)
        report = reviewer.review(args.file_path, output_format=args.format)

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"评审报告已保存到: {args.output}")
        else:
            print(report)

    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
