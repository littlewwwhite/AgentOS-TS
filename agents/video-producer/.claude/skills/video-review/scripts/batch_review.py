#!/usr/bin/env python3
"""
批量评审工具
支持批量处理多个视频脚本文件
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List

from review import VideoReviewer


def find_script_files(directory: str, extensions: List[str] = None) -> List[Path]:
    """查找目录下的所有脚本文件"""
    if extensions is None:
        extensions = [".txt", ".md", ".json"]

    dir_path = Path(directory)
    if not dir_path.exists():
        raise FileNotFoundError(f"目录不存在: {directory}")

    files = []
    for ext in extensions:
        files.extend(dir_path.glob(f"**/*{ext}"))

    return sorted(files)


def batch_review(
    input_dir: str,
    output_dir: str,
    output_format: str = "markdown",
    config_path: str = None,
):
    """批量评审"""
    # 创建输出目录
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # 查找所有脚本文件
    script_files = find_script_files(input_dir)
    if not script_files:
        print(f"在 {input_dir} 中未找到脚本文件")
        return

    print(f"找到 {len(script_files)} 个脚本文件")

    # 初始化评审器
    reviewer = VideoReviewer(config_path=config_path)

    # 批量评审
    results = []
    for i, script_file in enumerate(script_files, 1):
        print(f"[{i}/{len(script_files)}] 评审: {script_file.name}")

        try:
            report = reviewer.review(str(script_file), output_format=output_format)

            # 保存报告
            if output_format == "markdown":
                output_file = output_path / f"{script_file.stem}_review.md"
            else:
                output_file = output_path / f"{script_file.stem}_review.json"

            with open(output_file, "w", encoding="utf-8") as f:
                f.write(report)

            results.append(
                {"file": str(script_file), "status": "success", "output": str(output_file)}
            )
            print(f"  ✓ 报告已保存: {output_file}")

        except Exception as e:
            results.append({"file": str(script_file), "status": "error", "error": str(e)})
            print(f"  ✗ 错误: {e}")

    # 生成汇总报告
    summary_file = output_path / "batch_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "total": len(script_files),
                "success": sum(1 for r in results if r["status"] == "success"),
                "failed": sum(1 for r in results if r["status"] == "error"),
                "results": results,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"\n批量评审完成！汇总报告: {summary_file}")


def main():
    parser = argparse.ArgumentParser(description="批量视频评审工具")
    parser.add_argument("input_dir", help="输入目录（包含脚本文件）")
    parser.add_argument("output_dir", help="输出目录（保存评审报告）")
    parser.add_argument(
        "-f",
        "--format",
        help="输出格式 (markdown/json)",
        choices=["markdown", "json"],
        default="markdown",
    )
    parser.add_argument("-c", "--config", help="配置文件路径", default=None)

    args = parser.parse_args()

    try:
        batch_review(args.input_dir, args.output_dir, args.format, args.config)
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
