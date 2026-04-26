#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
style_generate.py - Step 0: 世界观视觉分析

读取 design.json，调用 Gemini 分析世界观类型，生成统一视觉风格配置 style.json。
style.json 被 generate_scenes.py 和 generate_props.py 加载，确保：
  1. 生图前缀与世界观完全一致（仙侠用游戏CG词，科幻用UE5词）
  2. 审图时按世界观标准检验风格合规性
  3. 防污染否定词精准过滤与世界观不符的元素

用法:
  python style_generate.py \\
    --script-json "path/to/script.json" \\
    --output     "path/to/{project}_style.json"
"""

import sys, os, json, argparse
from string import Template
from pathlib import Path

if sys.platform == 'win32':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    elif hasattr(sys.stdout, 'buffer'):
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from common_gemini_client import generate_json_with_retry
from common_config import get_style_config
from pipeline_state import ensure_state, update_artifact, update_stage


def log(msg):
    print(f"[Step 0] {msg}", file=sys.stderr, flush=True)


def load_style_config():
    return get_style_config()['generate_style']


def load_project_style(workspace):
    """从 draft/style.json 加载项目世界观风格配置"""
    style_path = Path(workspace) / 'style.json'
    if not style_path.exists():
        raise FileNotFoundError(
            f"风格配置文件不存在: {style_path}\n"
            f"请先运行 style_generate.py 生成 style.json"
        )
    with open(style_path, 'r', encoding='utf-8') as f:
        style_data = json.load(f)
    wt = style_data.get('worldview_type', '未知')
    print(f"✓ 已加载风格配置: {style_path.name}  世界观: 【{wt}】", flush=True)
    return style_data


def build_analysis_prompt(script_data, config, style_override=None):
    title     = script_data.get('title', '未知')
    worldview = script_data.get('worldview', '')
    style = style_override if style_override else script_data.get('style', '真人')
    template = config['prompt_template']
    return Template(template).safe_substitute(title=title, worldview=worldview, style=style)


def generate_style(script_json_path, output_path, style_override=None):
    config = load_style_config()

    log(f'读取剧本信息: {script_json_path}')
    with open(script_json_path, 'r', encoding='utf-8') as f:
        script_data = json.load(f)

    if style_override:
        log(f'风格已覆写为: 【{style_override}】（原值: {script_data.get("style", "真人")}）')

    prompt = build_analysis_prompt(script_data, config, style_override)
    model = config.get('model', 'gemini-3.1-flash-lite-preview')
    retry_attempts = config.get('retry_attempts', 2)
    retry_sleep    = config.get('retry_sleep_seconds', 3)

    try:
        log(f'尝试 {model} 分析世界观...')
        result = generate_json_with_retry(
            prompt,
            label='世界观分析',
            max_retries=retry_attempts,
            base_delay=retry_sleep,
            model=model,
        )
        wt = result.get('worldview_type', '未知') if isinstance(result, dict) else '未知'
        log(f'✓ 世界观分析完成: 【{wt}】')
    except Exception as e:
        log(f'❌ 世界观分析失败: {e}')
        log('❌ Gemini 分析失败，请手动创建 style.json')
        sys.exit(1)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log(f'✓ style.json 已保存: {out}')

    project_root = Path(script_json_path).resolve().parent.parent
    ensure_state(str(project_root))
    update_artifact(
        str(project_root),
        out.resolve().relative_to(project_root).as_posix(),
        "control",
        "visual",
        "completed",
    )
    update_stage(
        str(project_root),
        "VISUAL",
        "partial",
        next_action="review VISUAL",
        artifact=out.resolve().relative_to(project_root).as_posix(),
    )

    # 输出到 stdout 供调用方捕获
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Step 0: Gemini 世界观视觉分析 → style.json')
    parser.add_argument('--script-json',    required=True, help='script.json 路径')
    parser.add_argument('--output',         required=True, help='输出 style.json 路径')
    parser.add_argument('--style-override', default=None,  help='覆写风格（如 真人、动漫、水墨），优先级高于 script.json 中的 style 字段')
    args = parser.parse_args()
    generate_style(args.script_json, args.output, args.style_override)
