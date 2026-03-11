#!/usr/bin/env python3
"""
视频文件分析器
支持解析视频路径元数据和使用 Gemini 分析视频内容
"""

import os
import re
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

try:
    from google import genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("警告: google-genai 未安装，视频分析功能不可用")
    print("安装命令: pip install google-genai pydantic")


class VideoPathParser:
    """视频路径解析器

    支持三种视频格式：
    1. 原始完整 l 视频: ep##-sc##-l##.mp4
    2. 重新生成的完整 l 视频: ep##-sc##-l##-##.mp4
    3. 单个镜头片段（基于某个 l 版本）: ep##-sc##-l##-##-c##.mp4
    """

    # 路径格式1（原始完整 l）: 03-video/ep01/sc01/l01/ep##-sc##-l##.mp4
    PATH_PATTERN_ORIGINAL = re.compile(
        r"(?P<base>.*?/)?(?P<ep>ep\d+)/(?P<sc>sc\d+)/(?P<l>l\d+)/(?P<filename>ep\d+-sc\d+-l\d+\.(?P<ext>\w+))$"
    )

    # 路径格式2（重新生成的完整 l）: 03-video/ep01/sc01/l01/ep##-sc##-l##-##.mp4
    PATH_PATTERN_REGENERATED_L = re.compile(
        r"(?P<base>.*?/)?(?P<ep>ep\d+)/(?P<sc>sc\d+)/(?P<l>l\d+)/(?P<filename>ep\d+-sc\d+-l\d+-\d+\.(?P<ext>\w+))$"
    )

    # 路径格式3（单个镜头，基于某个 l 版本）: 03-video/ep01/sc01/l01/ep##-sc##-l##-##-c##.mp4
    PATH_PATTERN_SHOT = re.compile(
        r"(?P<base>.*?/)?(?P<ep>ep\d+)/(?P<sc>sc\d+)/(?P<l>l\d+)/(?P<filename>ep\d+-sc\d+-l\d+-\d+-c\d+\.(?P<ext>\w+))$"
    )

    # 文件名格式1（原始完整 l）: ep##-sc##-l##
    FILENAME_PATTERN_ORIGINAL = re.compile(
        r"^ep(?P<episode>\d+)-sc(?P<scene>\d+)-l(?P<line>\d+)(?:\.(?P<ext>\w+))?$"
    )

    # 文件名格式2（重新生成的完整 l）: ep##-sc##-l##-##
    FILENAME_PATTERN_REGENERATED_L = re.compile(
        r"^ep(?P<episode>\d+)-sc(?P<scene>\d+)-l(?P<line>\d+)-(?P<version>\d+)"
    )

    # 文件名格式3（单个镜头，基于某个 l 版本）: ep##-sc##-l##-##-c##
    FILENAME_PATTERN_SHOT = re.compile(
        r"^ep(?P<episode>\d+)-sc(?P<scene>\d+)-l(?P<line>\d+)-(?P<base_version>\d+)-c(?P<shot>\d+)"
    )

    @classmethod
    def parse(cls, video_path: str) -> Optional[Dict]:
        """
        解析视频路径，提取元数据

        支持三种格式：
        1. 原始完整 l: ep##-sc##-l##.mp4
        2. 重新生成的完整 l: ep##-sc##-l##-##.mp4
        3. 单个镜头（基于某个 l 版本）: ep##-sc##-l##-##-c##.mp4

        Args:
            video_path: 视频文件路径

        Returns:
            包含元数据的字典，如果解析失败返回 None
        """
        path = Path(video_path)

        # 优先匹配单个镜头格式（ep##-sc##-l##-##-c##）
        match = cls.PATH_PATTERN_SHOT.search(str(path))
        if match:
            groups = match.groupdict()
            filename_match = cls.FILENAME_PATTERN_SHOT.search(groups["filename"])
            if filename_match:
                numbers = filename_match.groupdict()
                return {
                    "full_path": str(path.absolute()),
                    "base_dir": groups.get("base", ""),
                    "episode": int(numbers["episode"]),
                    "scene": int(numbers["scene"]),
                    "line": int(numbers["line"]),
                    "base_version": int(numbers["base_version"]),  # 基于哪个 l 版本
                    "shot": int(numbers["shot"]),
                    "version": None,
                    "extension": groups["ext"],
                    "filename": groups["filename"],
                    "episode_dir": groups["ep"],
                    "scene_dir": groups["sc"],
                    "line_dir": groups["l"],
                    "type": "shot",  # 单个镜头
                }

        # 匹配重新生成的完整 l 格式（ep##-sc##-l##-##）
        match = cls.PATH_PATTERN_REGENERATED_L.search(str(path))
        if match:
            groups = match.groupdict()
            filename_match = cls.FILENAME_PATTERN_REGENERATED_L.search(groups["filename"])
            if filename_match:
                numbers = filename_match.groupdict()
                return {
                    "full_path": str(path.absolute()),
                    "base_dir": groups.get("base", ""),
                    "episode": int(numbers["episode"]),
                    "scene": int(numbers["scene"]),
                    "line": int(numbers["line"]),
                    "base_version": None,  # 完整 l 没有 base_version
                    "shot": None,
                    "version": int(numbers["version"]),
                    "extension": groups["ext"],
                    "filename": groups["filename"],
                    "episode_dir": groups["ep"],
                    "scene_dir": groups["sc"],
                    "line_dir": groups["l"],
                    "type": "regenerated_l",  # 重新生成的完整 l
                }

        # 匹配原始完整 l 格式（ep##-sc##-l##）
        match = cls.PATH_PATTERN_ORIGINAL.search(str(path))
        if match:
            groups = match.groupdict()
            filename_match = cls.FILENAME_PATTERN_ORIGINAL.search(groups["filename"])
            if filename_match:
                numbers = filename_match.groupdict()
                return {
                    "full_path": str(path.absolute()),
                    "base_dir": groups.get("base", ""),
                    "episode": int(numbers["episode"]),
                    "scene": int(numbers["scene"]),
                    "line": int(numbers["line"]),
                    "base_version": None,  # 原始 l 没有 base_version
                    "shot": None,
                    "version": None,
                    "extension": groups["ext"],
                    "filename": groups["filename"],
                    "episode_dir": groups["ep"],
                    "scene_dir": groups["sc"],
                    "line_dir": groups["l"],
                    "type": "original_l",  # 原始完整 l
                }

        # 如果完整路径匹配失败，尝试只匹配文件名
        # 单个镜头
        filename_match = cls.FILENAME_PATTERN_SHOT.search(path.name)
        if filename_match:
            numbers = filename_match.groupdict()
            return {
                "full_path": str(path.absolute()),
                "episode": int(numbers["episode"]),
                "scene": int(numbers["scene"]),
                "line": int(numbers["line"]),
                "base_version": int(numbers["base_version"]),
                "shot": int(numbers["shot"]),
                "version": None,
                "extension": path.suffix.lstrip("."),
                "filename": path.name,
                "type": "shot",
            }

        # 重新生成的完整 l
        filename_match = cls.FILENAME_PATTERN_REGENERATED_L.search(path.name)
        if filename_match:
            numbers = filename_match.groupdict()
            return {
                "full_path": str(path.absolute()),
                "episode": int(numbers["episode"]),
                "scene": int(numbers["scene"]),
                "line": int(numbers["line"]),
                "base_version": None,
                "shot": None,
                "version": int(numbers["version"]),
                "extension": path.suffix.lstrip("."),
                "filename": path.name,
                "type": "regenerated_l",
            }

        # 原始完整 l
        filename_match = cls.FILENAME_PATTERN_ORIGINAL.search(path.name)
        if filename_match:
            numbers = filename_match.groupdict()
            return {
                "full_path": str(path.absolute()),
                "episode": int(numbers["episode"]),
                "scene": int(numbers["scene"]),
                "line": int(numbers["line"]),
                "base_version": None,
                "shot": None,
                "version": None,
                "extension": path.suffix.lstrip("."),
                "filename": path.name,
                "type": "original_l",
            }

        return None


class GeminiVideoAnalyzer:
    """Gemini 视频分析器"""

    def __init__(self, api_key: Optional[str] = None):
        if not GEMINI_AVAILABLE:
            raise ImportError("google-genai 未安装")

        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "未找到 GEMINI_API_KEY，请设置环境变量或传入 api_key 参数"
            )

        self.client = genai.Client(api_key=self.api_key)

    def upload_video(self, video_path: str) -> any:
        """
        上传视频到 Gemini

        Args:
            video_path: 视频文件路径

        Returns:
            上传的文件对象
        """
        print(f"正在上传视频: {video_path}")
        video_file = self.client.files.upload(file=video_path)

        # 等待处理完成
        print("等待视频处理...")
        while video_file.state.name == "PROCESSING":
            time.sleep(5)
            video_file = self.client.files.get(name=video_file.name)
            print(f"处理状态: {video_file.state.name}")

        if video_file.state.name == "ACTIVE":
            print("视频处理完成")
            return video_file
        else:
            raise Exception(f"视频处理失败: {video_file.state.name}")

    def analyze_video(
        self, video_file: any, prompt: Optional[str] = None
    ) -> str:
        """
        分析视频内容

        Args:
            video_file: 上传的视频文件对象
            prompt: 分析提示词

        Returns:
            分析结果文本
        """
        if prompt is None:
            prompt = """请详细分析这个视频，包括：
1. 剧情内容：发生了什么事情，故事的发展
2. 人物角色：出现了哪些角色，他们的行为和互动
3. 场景描述：拍摄场景、环境、氛围
4. 镜头语言：镜头运用、构图、运动方式
5. 时长和节奏：视频时长，节奏快慢

请用中文回答，尽可能详细。"""

        print("正在分析视频内容...")
        response = self.client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=[video_file, prompt],
        )

        return response.text

    def cleanup(self, video_file: any):
        """删除上传的视频文件"""
        try:
            self.client.files.delete(name=video_file.name)
            print("已清理上传的视频文件")
        except Exception as e:
            print(f"清理文件失败: {e}")

    def analyze_video_file(
        self, video_path: str, cleanup: bool = True
    ) -> Tuple[str, Optional[any]]:
        """
        完整的视频分析流程

        Args:
            video_path: 视频文件路径
            cleanup: 是否在分析后清理上传的文件

        Returns:
            (分析结果, 视频文件对象)
        """
        video_file = None
        try:
            video_file = self.upload_video(video_path)
            result = self.analyze_video(video_file)
            return result, video_file
        finally:
            if cleanup and video_file:
                self.cleanup(video_file)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="视频文件分析工具")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument(
        "--parse-only", action="store_true", help="仅解析路径，不分析视频"
    )
    parser.add_argument("--prompt", help="自定义分析提示词", default=None)
    parser.add_argument(
        "--no-cleanup", action="store_true", help="不清理上传的视频文件"
    )

    args = parser.parse_args()

    # 解析路径
    print("=" * 50)
    print("解析视频路径")
    print("=" * 50)
    metadata = VideoPathParser.parse(args.video_path)
    if metadata:
        print("路径元数据:")
        for key, value in metadata.items():
            print(f"  {key}: {value}")
    else:
        print("警告: 无法解析视频路径格式")

    if args.parse_only:
        return

    # 分析视频
    print("\n" + "=" * 50)
    print("分析视频内容")
    print("=" * 50)

    if not GEMINI_AVAILABLE:
        print("错误: google-genai 未安装，无法分析视频")
        return

    try:
        analyzer = GeminiVideoAnalyzer()
        result, _ = analyzer.analyze_video_file(
            args.video_path, cleanup=not args.no_cleanup
        )
        print("\n分析结果:")
        print("-" * 50)
        print(result)
    except Exception as e:
        print(f"错误: {e}")


if __name__ == "__main__":
    main()
