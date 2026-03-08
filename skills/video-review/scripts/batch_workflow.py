#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch Video Review Workflow
批量处理视频文件夹，自动分析、评审、优化
"""

import os
import sys
import json
from pathlib import Path
from typing import List, Dict
import re

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 添加脚本目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from workflow import run_complete_workflow


def parse_video_filename(filename: str) -> Dict:
    """
    解析视频文件名，提取片段信息

    支持格式：
    - ep##-sc##-l##.mp4
    - ep##-sc##-l##-##.mp4
    - ep##-sc##-l##-##-c##.mp4

    Returns:
        Dict: {
            'episode': int,
            'scene': int,
            'locus': int,
            'version': int or None,
            'shot': int or None,
            'segment_id': str  # SC##-L##
        }
    """
    # 匹配模式
    pattern = r'ep(\d+)-sc(\d+)-l(\d+)(?:-(\d+))?(?:-c(\d+))?\.mp4'
    match = re.match(pattern, filename, re.IGNORECASE)

    if not match:
        return None

    episode, scene, locus, version, shot = match.groups()

    return {
        'episode': int(episode),
        'scene': int(scene),
        'locus': int(locus),
        'version': int(version) if version else None,
        'shot': int(shot) if shot else None,
        'segment_id': f"SC{int(scene):02d}-L{int(locus):02d}"
    }


def find_videos(directory: str, recursive: bool = True) -> List[Dict]:
    """
    查找目录下的所有视频文件

    Args:
        directory: 视频目录
        recursive: 是否递归查找子目录

    Returns:
        List[Dict]: 视频信息列表
    """
    videos = []
    directory = Path(directory)

    if not directory.exists():
        raise FileNotFoundError(f"目录不存在: {directory}")

    # 查找所有mp4文件
    pattern = "**/*.mp4" if recursive else "*.mp4"

    for video_path in directory.glob(pattern):
        # 解析文件名
        info = parse_video_filename(video_path.name)

        if info:
            info['path'] = str(video_path)
            info['filename'] = video_path.name
            videos.append(info)
        else:
            print(f"[WARN]  跳过无法解析的文件: {video_path.name}")

    return videos


def load_prompt_json(json_path: str) -> Dict:
    """加载提示词JSON文件"""
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_expected_duration(prompt_json: Dict, segment_id: str) -> float:
    """从提示词JSON中获取期望时长"""
    for segment in prompt_json.get('segments', []):
        if segment.get('id') == segment_id:
            return float(segment.get('duration', 5.0))

    # 默认5秒
    return 5.0


def batch_process_videos(
    video_dir: str,
    prompt_json_path: str,
    output_dir: str = "workspace/output",
    recursive: bool = True,
    api_key: str = None
) -> Dict:
    """
    批量处理视频文件夹

    Args:
        video_dir: 视频目录
        prompt_json_path: 提示词JSON文件路径
        output_dir: 输出目录
        recursive: 是否递归查找
        api_key: Gemini API Key

    Returns:
        Dict: 批量处理结果汇总
    """

    print("="*60)
    print("[VIDEO] 批量视频评审工作流")
    print("="*60)
    print(f"视频目录: {video_dir}")
    print(f"提示词文件: {prompt_json_path}")
    print(f"输出目录: {output_dir}")
    print("="*60 + "\n")

    # 查找所有视频
    print("[SCAN] 扫描视频文件...")
    videos = find_videos(video_dir, recursive)

    if not videos:
        print("[FAIL] 未找到任何视频文件")
        return {
            'total': 0,
            'processed': 0,
            'qualified': 0,
            'failed': 0,
            'results': []
        }

    print(f"[OK] 找到 {len(videos)} 个视频文件\n")

    # 加载提示词JSON
    print("[READ] 加载提示词文件...")
    prompt_json = load_prompt_json(prompt_json_path)
    print("[OK] 提示词加载完成\n")

    # 批量处理
    results = []
    qualified_count = 0
    failed_count = 0

    for i, video in enumerate(videos, 1):
        print(f"\n{'='*60}")
        print(f"处理进度: {i}/{len(videos)}")
        print(f"视频: {video['filename']}")
        print(f"片段: {video['segment_id']}")
        print(f"{'='*60}\n")

        try:
            # 获取期望时长
            expected_duration = get_expected_duration(
                prompt_json,
                video['segment_id']
            )

            # 运行完整工作流
            result = run_complete_workflow(
                video_path=video['path'],
                segment_id=video['segment_id'],
                expected_duration=expected_duration,
                prompt_json_path=prompt_json_path,
                output_dir=output_dir,
                api_key=api_key
            )

            # 记录结果
            result['video_info'] = video
            results.append(result)

            if result['qualified']:
                qualified_count += 1
                print(f"\n[OK] {video['segment_id']} 合格")
            else:
                print(f"\n[FAIL] {video['segment_id']} 不合格")
                print(f"不合格维度: {', '.join(result['failed_dimensions'])}")

        except Exception as e:
            print(f"\n[FAIL] 处理失败: {e}")
            failed_count += 1
            results.append({
                'video_info': video,
                'qualified': False,
                'error': str(e)
            })

    # 生成汇总报告
    summary = {
        'total': len(videos),
        'processed': len(videos) - failed_count,
        'qualified': qualified_count,
        'failed': failed_count,
        'qualified_rate': f"{qualified_count/len(videos)*100:.1f}%",
        'results': results
    }

    # 保存汇总报告
    summary_path = Path(output_dir) / "batch_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("\n" + "="*60)
    print("[STAT] 批量处理汇总")
    print("="*60)
    print(f"总视频数: {summary['total']}")
    print(f"处理成功: {summary['processed']}")
    print(f"合格数量: {summary['qualified']}")
    print(f"失败数量: {summary['failed']}")
    print(f"合格率: {summary['qualified_rate']}")
    print(f"\n[FILE] 汇总报告: {summary_path}")
    print("="*60)

    return summary


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="批量处理视频文件夹"
    )
    parser.add_argument(
        "video_dir",
        help="视频目录"
    )
    parser.add_argument(
        "prompt_json",
        help="提示词JSON文件路径"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录（默认: workspace/output）"
    )
    parser.add_argument(
        "--no-recursive",
        action="store_true",
        help="不递归查找子目录"
    )
    parser.add_argument(
        "-k", "--api-key",
        help="Gemini API Key（默认从环境变量读取）"
    )

    args = parser.parse_args()

    try:
        summary = batch_process_videos(
            video_dir=args.video_dir,
            prompt_json_path=args.prompt_json,
            output_dir=args.output_dir,
            recursive=not args.no_recursive,
            api_key=args.api_key
        )

        # 返回状态码
        if summary['failed'] > 0:
            return 2  # 有失败
        elif summary['qualified'] < summary['total']:
            return 1  # 有不合格
        else:
            return 0  # 全部合格

    except Exception as e:
        print(f"\n[FAIL] 批量处理失败: {e}")
        import traceback
        traceback.print_exc()
        return 3


if __name__ == "__main__":
    exit(main())
