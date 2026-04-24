#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Export approved storyboard artifacts into VIDEO runtime JSON.

STORYBOARD owns prompt creation and approval. This script only copies the
approved canonical storyboard into the per-episode runtime location, validates
the runtime shape, and optionally starts video generation.
"""

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from compat import TeeWriter, ensure_utf8_output
from pipeline_state import ensure_state, update_episode, update_stage
from path_manager import (
    build_validation_view_from_runtime_storyboard,
    count_storyboard_generation_units,
    prepare_runtime_storyboard_export,
    resolve_runtime_storyboard_path,
)

ensure_utf8_output()

def _resolve_project_root(explicit=None):
    """Resolve project root directory.

    Priority: explicit arg > PROJECT_DIR env var > CWD
    """
    if explicit:
        return explicit
    env_dir = os.environ.get('PROJECT_DIR')
    if env_dir and os.path.isdir(env_dir):
        return env_dir
    return os.getcwd()

PROJECT_ROOT = _resolve_project_root()
OUTPUT_ROOT = os.path.join(PROJECT_ROOT, 'output')
WORKSPACE_ROOT = os.path.join(PROJECT_ROOT, 'draft')


def sync_video_storyboard_state(project_root: str, episode_num: int, runtime_path: str) -> None:
    runtime_relative = Path(runtime_path).resolve().relative_to(Path(project_root).resolve()).as_posix()
    ensure_state(project_root)
    update_stage(project_root, 'VIDEO', 'running', next_action='enter VIDEO')
    update_episode(
        project_root,
        f'ep{episode_num:03d}',
        'video',
        'partial',
        artifact=runtime_relative,
    )

def load_script_data(script_path, episode_num):
    """加载剧本数据"""
    with open(script_path, 'r', encoding='utf-8') as f:
        global_config = json.load(f)

    # 查找指定集数（兼容多种格式）
    episodes = global_config.get('episodes', [])
    episode_data = None
    for ep in episodes:
        # 支持 episode: 1 或 episode_id: "ep_1" / "ep_001" 两种格式
        if ep.get('episode') == episode_num:
            episode_data = ep
            break
        ep_id = ep.get('episode_id', '')
        if ep_id in (f'ep_{episode_num}', f'ep_{episode_num:02d}', f'ep_{episode_num:03d}'):
            episode_data = ep
            break

    if not episode_data:
        raise ValueError(f"未找到第{episode_num}集的数据")

    return episode_data, global_config

def generate_episode_json(episode_num, script_path, output_path=None):
    """Export an approved storyboard canonical into the VIDEO runtime path.

    STORYBOARD owns prompt creation and approval. VIDEO must not generate or
    rewrite director storyboards from script.json; it only copies the approved
    canonical artifact into output/epNNN/ for runtime mutation and validation.
    """
    output_path = str(resolve_runtime_storyboard_path(output_path, OUTPUT_ROOT, episode_num))

    runtime_path, _source_kind = prepare_runtime_storyboard_export(
        output_path,
        str(Path(output_path).parent),
        episode_num,
    )

    print(f"[contract] 检测到已批准 storyboard，直接导出 runtime：{runtime_path}")
    with open(runtime_path, 'r', encoding='utf-8') as f:
        storyboard_data = json.load(f)
    sync_video_storyboard_state(PROJECT_ROOT, episode_num, str(runtime_path))

    try:
        _, global_config = load_script_data(script_path, episode_num)
    except Exception:
        global_config = None

    segment_count = count_storyboard_generation_units(storyboard_data)
    validation_view = build_validation_view_from_runtime_storyboard(storyboard_data, episode_num)
    return str(runtime_path), segment_count, validation_view, global_config

def validate_episode_data(data, global_config=None):
    """验证生成的JSON数据（内存中的 shots 格式）是否符合规范

    返回: (is_valid, errors, warnings)
    """
    errors = []
    warnings = []

    # 检查顶层结构
    required_top_fields = ['drama', 'episode', 'title', 'scenes']
    for field in required_top_fields:
        if field not in data:
            errors.append(f"缺少顶层字段: {field}")

    if 'scenes' not in data:
        return False, errors, warnings

    # 构建有效ID集合（用于ID映射检查）
    valid_actor_ids = set()
    valid_location_ids = set()
    valid_prop_ids = set()
    if global_config:
        for a in global_config.get('actors', []):
            aid = a.get('id') or a.get('actor_id')
            if aid:
                valid_actor_ids.add(aid)
        for l in global_config.get('locations', []):
            lid = l.get('id') or l.get('location_id')
            if lid:
                valid_location_ids.add(lid)
        for p in global_config.get('props', []):
            pid = p.get('id') or p.get('prop_id')
            if pid:
                valid_prop_ids.add(pid)

    # 遍历所有场景和clips
    for scene in data['scenes']:
        scene_id = scene.get('scene_id', 'Unknown')

        if 'clips' not in scene:
            errors.append(f"场景 {scene_id} 缺少 clips 字段")
            continue

        for segment in scene['clips']:
            segment_id = segment.get('clip_id', 'Unknown')

            # 检查Segment级别的必需字段
            required_segment_fields = [
                'clip_id', 'source', 'expected_duration', 'characters',
                'location', 'layout_prompt', 'time', 'weather', 'props', 'act_rhythm', 'shots'
            ]
            for field in required_segment_fields:
                if field not in segment:
                    errors.append(f"{segment_id}: 缺少字段 {field}")

            # ID映射正确性检查
            if global_config:
                # 检查 characters 中的角色ID
                for char_id in segment.get('characters', []):
                    if char_id and char_id not in valid_actor_ids:
                        errors.append(f"{segment_id}: 角色ID '{char_id}' 不存在于全局配置中")

                # 检查 location ID
                loc = segment.get('location', '')
                if loc and loc not in valid_location_ids:
                    errors.append(f"{segment_id}: 场景ID '{loc}' 不存在于全局配置中")

                # 检查 props 中的道具ID
                for prop_id in segment.get('props', []):
                    if prop_id and prop_id not in valid_prop_ids:
                        errors.append(f"{segment_id}: 道具ID '{prop_id}' 不存在于全局配置中")

                # 检查 complete_prompt 和 shots 中引用的ID
                import re as _re
                texts_to_check = []
                if 'complete_prompt' in segment:
                    texts_to_check.append(('complete_prompt', segment['complete_prompt']))
                for shot in segment.get('shots', []):
                    for field in ('partial_prompt', 'description'):
                        if field in shot:
                            texts_to_check.append((f"shot/{field}", shot[field]))

                for field_name, text in texts_to_check:
                    if not text:
                        continue
                    for ref_id in _re.findall(r'\{(act_\w+)\}', text):
                        if ref_id not in valid_actor_ids:
                            warnings.append(f"{segment_id}/{field_name}: 引用了未知角色ID '{{{ref_id}}}'")
                    for ref_id in _re.findall(r'\{(loc_\w+)\}', text):
                        if ref_id not in valid_location_ids:
                            warnings.append(f"{segment_id}/{field_name}: 引用了未知场景ID '{{{ref_id}}}'")
                    for ref_id in _re.findall(r'\{(prp_\w+)\}', text):
                        if ref_id not in valid_prop_ids:
                            warnings.append(f"{segment_id}/{field_name}: 引用了未知道具ID '{{{ref_id}}}'")

            # 检查complete_prompt字段
            if 'complete_prompt' not in segment:
                errors.append(f"{segment_id}: 缺少字段 complete_prompt")

    is_valid = len(errors) == 0
    return is_valid, errors, warnings

def print_validation_report(is_valid, errors, warnings):
    """打印验证报告"""
    print("\n" + "="*60)
    print("JSON文件验证报告")
    print("="*60)

    if is_valid:
        print("[PASS] 验证通过！文件符合skill规范。")
    else:
        print("[FAIL] 验证失败！发现以下错误：")

    if errors:
        print(f"\n错误 ({len(errors)}个):")
        for i, error in enumerate(errors, 1):
            print(f"  {i}. {error}")

    if warnings:
        print(f"\n警告 ({len(warnings)}个):")
        for i, warning in enumerate(warnings, 1):
            print(f"  {i}. {warning}")

    if not errors and not warnings:
        print("\n没有发现任何问题。")

    print("="*60 + "\n")

def parse_episode_range(episode_str, script_path):
    """解析集数参数，支持单集、范围、列表、all"""
    if episode_str == 'all':
        # 从script.json读取所有集数
        with open(script_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        episodes = data.get('episodes', [])
        result = []
        for ep in episodes:
            if isinstance(ep.get('episode'), int):
                result.append(ep['episode'])
                continue
            episode_id = str(ep.get('episode_id', '')).lower().replace('ep_', '').replace('ep', '')
            if episode_id.isdigit():
                result.append(int(episode_id))
        return result
    elif '-' in episode_str:
        # 范围：1-3 → [1, 2, 3]
        start, end = episode_str.split('-', 1)
        return list(range(int(start), int(end) + 1))
    elif ',' in episode_str:
        # 列表：1,3,5 → [1, 3, 5]
        return [int(x.strip()) for x in episode_str.split(',')]
    else:
        return [int(episode_str)]

def main():
    parser = argparse.ArgumentParser(description='导出已批准分镜并生成视频')
    parser.add_argument('--episode', required=True,
                        help='集数编号，支持：单集(1)、范围(1-3)、列表(1,3,5)、全部(all)')
    parser.add_argument('--script', help='剧本JSON文件路径（可选，默认使用 script.json）')
    parser.add_argument('--output', help='输出目录路径（可选）')
    parser.add_argument('--no-generate-video', action='store_true', help='跳过视频生成阶段，只导出 runtime storyboard')
    parser.add_argument('--model-code', default=None, help='视频生成模型代码（默认使用 config.json 配置）')
    parser.add_argument('--quality', default=None, choices=['720', '1080'], help='视频质量（默认使用 config.json 配置）')
    parser.add_argument('--ratio', default=None, choices=['16:9', '9:16', '1:1'], help='画幅比例（默认使用 config.json 配置）')
    parser.add_argument('--project-dir', default=None, help='Project root directory (falls back to PROJECT_DIR env var, then CWD)')
    parser.add_argument('--output-root', default=None, help='Output root directory containing script.json, actors/, etc. (default: PROJECT_ROOT/output)')
    parser.add_argument('--workspace-root', default=None, help='Workspace root directory for intermediate files (default: PROJECT_ROOT/draft)')
    parser.add_argument('--parallel', action='store_true', help='并行处理多集（多集时生效，每集独立进程，日志写入 draft/logs/）')
    parser.add_argument('--skip-existing', action='store_true', default=True,
                        help='Skip episodes whose storyboard JSON already exists and is valid (default: True)')
    parser.add_argument('--force', action='store_true',
                        help='Force regeneration even if storyboard JSON already exists (overrides --skip-existing)')

    args = parser.parse_args()

    # Re-initialize path roots from CLI args
    global PROJECT_ROOT, OUTPUT_ROOT, WORKSPACE_ROOT
    if args.project_dir:
        PROJECT_ROOT = _resolve_project_root(args.project_dir)
    OUTPUT_ROOT = os.path.abspath(args.output_root) if args.output_root else os.path.join(PROJECT_ROOT, 'output')
    WORKSPACE_ROOT = os.path.abspath(args.workspace_root) if args.workspace_root else os.path.join(PROJECT_ROOT, 'draft')

    # 如果未指定script路径，使用 OUTPUT_ROOT 下的默认位置
    if not args.script:
        args.script = os.path.join(OUTPUT_ROOT, 'script.json')

    # 解析集数列表
    episodes = parse_episode_range(args.episode, args.script)
    total = len(episodes)

    if total > 1:
        print(f"批量生成模式：共 {total} 集 {episodes}\n")

    results = {'success': [], 'failed': []}

    # ── 并行模式（多集时生效）──────────────────────────────────
    if args.parallel and total > 1:
        import threading
        import subprocess as _subprocess
        script_path = args.script

        # Step 1: 准备日志目录
        log_dir = os.path.join(WORKSPACE_ROOT, 'logs')
        os.makedirs(log_dir, exist_ok=True)

        print(f"[并行模式] 启动 {total} 集并行处理（日志目录: draft/logs/）\n")
        print_lock = threading.Lock()

        def _run_ep_subprocess(ep_num):
            log_path = os.path.join(log_dir, f'ep{ep_num:03d}.log')
            cmd = [
                sys.executable, os.path.abspath(__file__),
                '--episode', str(ep_num),
                '--script', script_path,
                '--project-dir', PROJECT_ROOT,
                '--output-root', OUTPUT_ROOT,
                '--workspace-root', WORKSPACE_ROOT,
            ]
            if args.no_generate_video:
                cmd.append('--no-generate-video')
            if args.model_code:
                cmd.extend(['--model-code', args.model_code])
            if args.quality:
                cmd.extend(['--quality', args.quality])
            if args.ratio:
                cmd.extend(['--ratio', args.ratio])
            if args.force:
                cmd.append('--force')
            elif args.skip_existing:
                cmd.append('--skip-existing')
            with print_lock:
                print(f"[ep{ep_num:03d}] 启动 → 日志: draft/logs/ep{ep_num:03d}.log")
            with open(log_path, 'w', encoding='utf-8') as _lf:
                ret = _subprocess.run(cmd, stdout=_lf, stderr=_subprocess.STDOUT)
            success = ret.returncode == 0
            with print_lock:
                print(f"[ep{ep_num:03d}] {'✓ 完成' if success else '✗ 失败（查看日志）'}")
            return ep_num, success

        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=total) as executor:
            futures = {executor.submit(_run_ep_subprocess, ep_num): ep_num for ep_num in episodes}
            for future in as_completed(futures):
                ep_num, success = future.result()
                if success:
                    results['success'].append(ep_num)
                else:
                    results['failed'].append(ep_num)

    # ── 串行模式──────────────────────────────────────────────
    else:
        # 准备日志目录（所有模式都写 log）
        log_dir = os.path.join(WORKSPACE_ROOT, 'logs')
        os.makedirs(log_dir, exist_ok=True)

        for i, ep_num in enumerate(episodes):
            if total > 1:
                print(f"\n{'='*60}")
                print(f"[{i+1}/{total}] 正在生成第 {ep_num} 集...")
                print('='*60)

            # Checkpoint: skip if storyboard already exists and --force is not set
            if args.skip_existing and not args.force:
                _ep_out = os.path.join(
                    args.output if args.output else OUTPUT_ROOT,
                    f'ep{ep_num:03d}',
                    f'ep{ep_num:03d}_storyboard.json',
                )
                _approved = os.path.join(
                    OUTPUT_ROOT,
                    'storyboard',
                    'approved',
                    f'ep{ep_num:03d}_storyboard.json',
                )
                if os.path.exists(_ep_out) and os.path.exists(_approved):
                    try:
                        with open(_ep_out, 'r', encoding='utf-8') as _f:
                            json.load(_f)
                        print(f"[checkpoint] Skipping ep{ep_num:03d} — storyboard already exists")
                        results['success'].append(ep_num)
                        continue
                    except (json.JSONDecodeError, OSError):
                        pass  # file is corrupt or unreadable — regenerate

            # 为每集设置 tee 日志（同时写终端和文件）
            log_path = os.path.join(log_dir, f'ep{ep_num:03d}.log')
            log_file = open(log_path, 'w', encoding='utf-8')
            original_stdout = sys.stdout
            original_stderr = sys.stderr
            sys.stdout = TeeWriter(original_stdout, log_file)
            sys.stderr = TeeWriter(original_stderr, log_file)

            try:
                output_path, segment_count, output_json, global_config = generate_episode_json(
                    ep_num, args.script, args.output
                )
                print(f'已导出 {segment_count} 个segments')
                print(f'文件已保存到: {output_path}')

                is_valid, errors, warnings = validate_episode_data(output_json, global_config)
                print_validation_report(is_valid, errors, warnings)

                results['success'].append(ep_num)

                # 阶段二：自动触发视频生成（除非指定 --no-generate-video）
                if not args.no_generate_video and is_valid:
                    from batch_generate import run_batch_generate, DEFAULT_MODEL_CODE, _gen_cfg
                    output_dir = str(Path(output_path).parent)
                    model_code = args.model_code or DEFAULT_MODEL_CODE
                    quality = args.quality or _gen_cfg.get('default_quality', '720')
                    ratio = args.ratio or _gen_cfg.get('default_ratio', '16:9')
                    print(f"\n{'='*60}")
                    print(f"  阶段二：批量生成视频")
                    print(f"  模型: {model_code}  质量: {quality}  比例: {ratio}")
                    print(f"{'='*60}")
                    run_batch_generate(
                        json_path=str(output_path),
                        output_root=output_dir,
                        episode=ep_num,
                        model_code=model_code,
                        quality=quality,
                        ratio=ratio,
                    )
            except Exception as e:
                print(f'错误: 第 {ep_num} 集生成失败: {e}', file=sys.stderr)
                import traceback
                traceback.print_exc()
                results['failed'].append(ep_num)
            finally:
                # 恢复 stdout/stderr 并关闭 log 文件
                sys.stdout = original_stdout
                sys.stderr = original_stderr
                log_file.close()
                print(f"日志已保存到: {log_path}")

    if total > 1:
        print(f"\n{'='*60}")
        print(f"批量生成完成：成功 {len(results['success'])} 集，失败 {len(results['failed'])} 集")
        if results['failed']:
            print(f"失败的集数: {results['failed']}")

    return 0 if not results['failed'] else 1

if __name__ == '__main__':
    sys.exit(main())
