#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Review Workflow
完整的视频评审工作流：分析 → 评审 → 优化
"""

import os
import sys
import json
from pathlib import Path
from typing import Optional, List

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 添加脚本目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from gemini_adapter import get_video_analysis
from evaluator import (
    evaluate_from_gemini_analysis,
    is_video_qualified,
    save_review_result,
    print_review_summary,
    analyze_timeranges,
    decide_regeneration_strategy,
    print_timerange_analysis
)


def find_character_references(
    character_names: List[str],
    asset_base_dir: str = "d:/Zhuchen/Projects/02-asset/output/characters"
) -> List[str]:
    """
    根据角色名称查找对应的参考图片

    Args:
        character_names: 角色名称列表（如 ["白行风", "灵霜"]）
        asset_base_dir: 角色资产基础目录

    Returns:
        List[str]: 找到的参考图片路径列表
    """
    reference_paths = []
    asset_dir = Path(asset_base_dir)

    if not asset_dir.exists():
        print(f"[WARN] 角色资产目录不存在: {asset_base_dir}")
        return reference_paths

    for char_name in character_names:
        # 尝试多种命名模式
        patterns = [
            f"*{char_name}*.png",
            f"*{char_name}*.jpg",
            f"*{char_name}*.jpeg",
        ]

        found = False
        for pattern in patterns:
            matches = list(asset_dir.glob(f"**/{pattern}"))
            if matches:
                # 使用第一个匹配的文件
                ref_path = str(matches[0])
                reference_paths.append(ref_path)
                print(f"  ✓ 找到 {char_name} 的参考图: {Path(ref_path).name}")
                found = True
                break

        if not found:
            print(f"  ✗ 未找到 {char_name} 的参考图")

    return reference_paths


def find_scene_references(
    location: str,
    asset_base_dir: str = "d:/Zhuchen/Projects/02-asset/output/scene"
) -> List[str]:
    """
    根据场景名称查找对应的参考图片

    Args:
        location: 场景名称（如 "万剑宗神坛"）
        asset_base_dir: 场景资产基础目录

    Returns:
        List[str]: 找到的参考图片路径列表（主图.png 和 参考表.png）
    """
    reference_paths = []
    asset_dir = Path(asset_base_dir)

    if not asset_dir.exists():
        print(f"[WARN] 场景资产目录不存在: {asset_base_dir}")
        return reference_paths

    # 查找场景文件夹
    scene_dir = asset_dir / location
    if scene_dir.exists():
        # 优先使用主图.png
        main_image = scene_dir / "主图.png"
        ref_table = scene_dir / "参考表.png"

        if main_image.exists():
            reference_paths.append(str(main_image))
            print(f"  ✓ 找到场景 {location} 的主图")

        if ref_table.exists():
            reference_paths.append(str(ref_table))
            print(f"  ✓ 找到场景 {location} 的参考表")

        if not reference_paths:
            print(f"  ✗ 场景 {location} 文件夹存在但无参考图")
    else:
        print(f"  ✗ 未找到场景 {location} 的资产文件夹")

    return reference_paths


def run_complete_workflow(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    prompt_json_path: str,
    output_dir: str = "workspace/output",
    language: str = "cn",
    force_reanalyze: bool = False,
    api_key: Optional[str] = None,
    storyboard_path: Optional[str] = None
) -> dict:
    """
    运行完整的视频评审工作流

    Args:
        video_path: 视频文件路径
        segment_id: 片段编号 (SC##-L##)
        expected_duration: 期望时长（秒）
        prompt_json_path: 提示词JSON文件路径
        output_dir: 输出目录
        language: 语言 (cn/en)
        api_key: Gemini API Key

    Returns:
        dict: 工作流结果
    """

    print("="*60)
    print("[VIDEO] 视频评审工作流")
    print("="*60)
    print(f"视频: {video_path}")
    print(f"片段: {segment_id}")
    print(f"期望时长: {expected_duration}秒")
    print("="*60 + "\n")

    # 读取原始提示词和角色信息（用于符合度对比和角色一致性检查）
    original_prompt = None
    character_names = []
    location = None
    try:
        with open(prompt_json_path, "r", encoding="utf-8") as f:
            prompt_data = json.load(f)
            # 尝试从JSON中提取对应segment_id的提示词和角色
            if isinstance(prompt_data, dict):
                # 如果是字典，尝试找到对应的segment
                if segment_id in prompt_data:
                    original_prompt = prompt_data[segment_id].get("prompt", "")
                    character_names = prompt_data[segment_id].get("characters", [])
                    location = prompt_data[segment_id].get("location", "")
                elif "segments" in prompt_data:
                    for seg in prompt_data["segments"]:
                        if seg.get("id") == segment_id or seg.get("segment_id") == segment_id:
                            # 尝试多种提示词字段名
                            original_prompt = (
                                seg.get("prompt") or
                                seg.get(f"{segment_id}_prompts") or
                                seg.get(f"{segment_id}_prompts_cn") or
                                ""
                            )
                            character_names = seg.get("characters", [])
                            location = seg.get("location", "") or seg.get("scene", "")
                            break
                # 处理 scenes[].segments[] 嵌套结构
                elif "scenes" in prompt_data:
                    for scene in prompt_data["scenes"]:
                        if "segments" in scene:
                            for seg in scene["segments"]:
                                if seg.get("id") == segment_id or seg.get("segment_id") == segment_id:
                                    # 尝试多种提示词字段名
                                    original_prompt = (
                                        seg.get("prompt") or
                                        seg.get(f"{segment_id}_prompts") or
                                        seg.get(f"{segment_id}_prompts_cn") or
                                        ""
                                    )
                                    character_names = seg.get("characters", [])
                                    location = seg.get("location", "") or seg.get("scene", "")
                                    break
                        if character_names or location:  # 找到就退出外层循环
                            break
            elif isinstance(prompt_data, list):
                # 如果是列表，查找对应的segment
                for seg in prompt_data:
                    if seg.get("id") == segment_id or seg.get("segment_id") == segment_id:
                        original_prompt = seg.get("prompt", "")
                        character_names = seg.get("characters", [])
                        location = seg.get("location", "") or seg.get("scene", "")
                        break

        if original_prompt:
            print(f"[INFO] 已加载原始提示词（用于符合度对比）")
        else:
            print(f"[WARN] 未找到片段 {segment_id} 的原始提示词，将跳过符合度对比")

        if character_names:
            print(f"[INFO] 检测到角色: {', '.join(character_names)}")
        else:
            print(f"[WARN] 未找到角色信息，将跳过角色一致性检查")

        if location:
            print(f"[INFO] 检测到场景: {location}")
        else:
            print(f"[WARN] 未找到场景信息，将跳过场景一致性检查")
    except Exception as e:
        print(f"[WARN] 读取提示词JSON失败: {e}，将跳过符合度对比")

    # 查找角色参考图片
    character_references = []
    if character_names:
        print(f"[CHAR] 查找角色参考图片...")
        character_references = find_character_references(character_names)

    # 查找场景参考图片
    scene_references = []
    if location:
        print(f"[SCENE] 查找场景参考图片...")
        scene_references = find_scene_references(location)

    # 合并所有参考图片
    all_references = character_references + scene_references

    # 第一步：Gemini 视频分析（使用智能适配器）
    print("\n[STEP] 步骤 1/3: 视频分析")
    print("-" * 60)

    # 使用智能适配器获取分析结果
    # 优先读取已有结果，如果没有则调用gemini-video.skill或内置分析器
    analysis, analysis_file = get_video_analysis(
        video_path=video_path,
        segment_id=segment_id,
        expected_duration=expected_duration,
        original_prompt=original_prompt,
        character_references=all_references,
        output_dir=output_dir,
        force_reanalyze=force_reanalyze,
        api_key=api_key
    )

    print(f"[SAVE] 分析结果: {analysis_file}")

    # 第二步：评审评分
    print("\n[STEP] 步骤 2/3: 评审评分")
    print("-" * 60)

    evaluation = evaluate_from_gemini_analysis(analysis)
    qualified, failed_dims = is_video_qualified(evaluation)

    # 打印评审摘要
    print_review_summary(evaluation, qualified, failed_dims)

    # 保存评审结果
    review_file = save_review_result(
        evaluation=evaluation,
        qualified=qualified,
        failed_dimensions=failed_dims,
        video_path=video_path,
        output_dir=output_dir
    )

    # 第三步：如果不合格，分析时间段并决定重新生成策略
    optimized_prompt = None
    optimized_file = None
    regeneration_strategy = "none"
    target_cs = []

    if not qualified:
        # 分析时间段
        print(f"\n[STEP] 步骤 3/5: 时间段分析")
        print("-" * 60)

        timerange_scores = analyze_timeranges(
            evaluation=evaluation,
            storyboard_path=storyboard_path,
            segment_id=segment_id
        )

        # 决定重新生成策略
        regeneration_strategy, target_cs = decide_regeneration_strategy(
            timerange_scores=timerange_scores,
            overall_qualified=qualified
        )

        # 打印时间段分析结果
        print_timerange_analysis(timerange_scores, regeneration_strategy, target_cs)

        # 第四步：提示词优化
        print(f"\n[STEP] 步骤 4/5: 提示词优化")
        print("-" * 60)

        try:
            # 导入优化器
            sys.path.insert(0, str(Path(__file__).parent.parent / "prompt_enhancement"))
            from optimizer import optimize_prompt_from_json, save_optimized_json

            # 加载评审结果
            with open(review_file, "r", encoding="utf-8") as f:
                review_result = json.load(f)

            # 优化提示词
            optimized_prompt, metadata = optimize_prompt_from_json(
                json_path=prompt_json_path,
                segment_id=segment_id,
                review_result=review_result,
                failed_dimensions=failed_dims,
                language=language
            )

            # 保存优化后的JSON
            optimized_file = save_optimized_json(
                original_json_path=prompt_json_path,
                segment_id=segment_id,
                optimized_prompt=optimized_prompt,
                output_path=f"{output_dir}/{segment_id.lower().replace('-', '')}_optimized.json",
                language=language
            )

            print(f"\n[OK] 提示词优化完成")
            print(f"[FILE] 优化后的JSON: {optimized_file}")

            # 第五步：根据策略自动重新生成视频
            print(f"\n[STEP] 步骤 5/5: 自动重新生成")
            print("-" * 60)

            try:
                # 提取当前 L 版本号
                import re
                l_version_match = re.search(r'-(\d+)\.mp4$', video_path)
                current_l_version = l_version_match.group(1) if l_version_match else "01"

                if regeneration_strategy == "regenerate_l":
                    # 重新生成整个 L
                    print(f"[INFO] 策略：重新生成整个 L")
                    from video_generator import generate_video

                    generation_result = generate_video(
                        prompt=optimized_prompt,
                        segment_id=segment_id,
                        duration=expected_duration,
                        output_dir=output_dir,
                        api_key=api_key
                    )

                    if generation_result.get("success"):
                        new_video_path = generation_result.get('video_path')
                        print(f"\n[OK] L 级视频重新生成成功!")
                        print(f"[FILE] 新视频: {new_video_path}")

                        # TODO: 重新评审新生成的视频，如果合格则记录到 final_selection
                        print(f"[NOTE] 建议重新评审新生成的视频")
                    else:
                        print(f"\n[WARN] L 级视频生成失败")

                elif regeneration_strategy == "regenerate_c":
                    # 只重新生成有问题的 C
                    print(f"[INFO] 策略：只重新生成 {len(target_cs)} 个时间切片")
                    from c_level_generator import generate_c_level_video

                    for c_id in target_cs:
                        print(f"\n[GEN] 重新生成 {c_id}...")

                        c_result = generate_c_level_video(
                            storyboard_path=storyboard_path or "",
                            segment_id=segment_id,
                            c_id=c_id,
                            l_version=current_l_version,
                            output_dir=output_dir,
                            duration=5.0,  # C 级默认 5 秒
                            max_retries=3
                        )

                        if c_result.get("success"):
                            c_video_path = c_result.get('video_path')
                            print(f"[OK] {c_id} 生成成功: {c_video_path}")

                            # TODO: 评审 C 级视频，如果合格则记录到 final_selection
                            print(f"[NOTE] 建议评审 C 级视频: {c_video_path}")
                        else:
                            print(f"[WARN] {c_id} 生成失败: {c_result.get('message')}")

                else:
                    print(f"[INFO] 无需重新生成")

            except Exception as e:
                print(f"[WARN] 视频重新生成失败: {e}")
                import traceback
                traceback.print_exc()

        except Exception as e:
            print(f"[WARN] 提示词优化失败: {e}")
            import traceback
            traceback.print_exc()

    else:
        print("\n[OK] 视频质量合格，无需优化")

        # 自动记录合格视频到 final_selection.json
        try:
            from final_selection import FinalSelectionManager

            # 提取 L ID（如 ep01-sc01-l02）
            import re
            video_filename = Path(video_path).name
            l_id_match = re.match(r'(ep\d+-sc\d+-l\d+)', video_filename, re.IGNORECASE)

            if l_id_match:
                l_id = l_id_match.group(1).lower()

                # 初始化管理器
                selection_file = Path(output_dir) / "final_selection.json"
                manager = FinalSelectionManager(str(selection_file))

                # 判断是 L 级还是 C 级视频
                if '-c' in video_filename.lower():
                    # C 级视频，添加为 selected_shots
                    manager.add_selected_shot(
                        l_id=l_id,
                        filename=video_filename,
                        path=str(Path(video_path).absolute())
                    )
                    print(f"[RECORD] 已记录 C 级视频到最终选择: {video_filename}")
                else:
                    # L 级视频，设置为 selected_l
                    manager.set_selected_l(
                        l_id=l_id,
                        filename=video_filename,
                        path=str(Path(video_path).absolute())
                    )
                    print(f"[RECORD] 已记录 L 级视频到最终选择: {video_filename}")
            else:
                print(f"[WARN] 无法从文件名提取 L ID: {video_filename}")

        except Exception as e:
            print(f"[WARN] 记录最终选择失败: {e}")
            import traceback
            traceback.print_exc()

    # 返回结果
    return {
        "qualified": qualified,
        "failed_dimensions": failed_dims,
        "scores": evaluation["scores"],
        "analysis_file": analysis_file,
        "review_file": review_file,
        "optimized_file": optimized_file,
        "optimized_prompt": optimized_prompt
    }


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="完整的视频评审工作流"
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
        "prompt_json",
        help="提示词JSON文件路径"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录（默认: workspace/output）"
    )
    parser.add_argument(
        "-l", "--language",
        default="cn",
        choices=["cn", "en"],
        help="语言（默认: cn）"
    )
    parser.add_argument(
        "-k", "--api-key",
        help="Gemini API Key（默认从环境变量读取）"
    )
    parser.add_argument(
        "-f", "--force-reanalyze",
        action="store_true",
        help="强制重新分析视频（忽略已有结果）"
    )

    args = parser.parse_args()

    try:
        result = run_complete_workflow(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            prompt_json_path=args.prompt_json,
            output_dir=args.output_dir,
            language=args.language,
            force_reanalyze=args.force_reanalyze,
            api_key=args.api_key
        )

        print("\n" + "="*60)
        print("[DONE] 工作流完成")
        print("="*60)
        print(f"合格状态: {'[OK] 合格' if result['qualified'] else '[FAIL] 不合格'}")
        print(f"总分: {result['scores']['total']}/50")

        if not result['qualified']:
            print(f"不合格维度: {', '.join(result['failed_dimensions'])}")
            if result['optimized_file']:
                print(f"\n[NOTE] 优化后的提示词已保存:")
                print(f"  {result['optimized_file']}")

        print("\n[SCAN] 输出文件:")
        print(f"  分析结果: {result['analysis_file']}")
        print(f"  评审结果: {result['review_file']}")

        return 0 if result['qualified'] else 1

    except Exception as e:
        print(f"\n[FAIL] 工作流失败: {e}")
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    exit(main())