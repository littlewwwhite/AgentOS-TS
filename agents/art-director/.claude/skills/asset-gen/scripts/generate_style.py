#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_style.py - Step 0: 世界观视觉分析

读取 design.json，调用 Gemini 分析世界观类型，生成统一视觉风格配置 style.json。
style.json 被 generate_scenes.py 和 generate_props.py 加载，确保：
  1. 生图前缀与世界观完全一致（仙侠用游戏CG词，科幻用UE5词）
  2. 审图时按世界观标准检验风格合规性
  3. 防污染否定词精准过滤与世界观不符的元素

用法:
  python generate_style.py \\
    --script-json "path/to/script.json" \\
    --output     "path/to/{project}_style.json"
"""

import sys, os, json, time, argparse
from pathlib import Path

if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from google import genai

SCRIPT_DIR = Path(__file__).parent
STYLE_CONFIG_PATH = SCRIPT_DIR / 'style_config.json'


def log(msg):
    print(f"[Step 0] {msg}", file=sys.stderr, flush=True)


def load_style_config():
    with open(STYLE_CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)['generate_style']


def build_analysis_prompt(design_data, config):
    title     = design_data.get('title', design_data.get('name', '未知'))
    worldview = design_data.get('worldview', '')
    synopsis  = str(design_data.get('synopsis', design_data.get('background', '')))[:500]
    return config['prompt_template'].format(title=title, worldview=worldview, synopsis=synopsis)


def generate_style(script_json_path, output_path):
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        log('ERROR: GEMINI_API_KEY 未设置')
        sys.exit(1)

    config = load_style_config()

    log(f'读取剧本信息: {script_json_path}')
    with open(script_json_path, 'r', encoding='utf-8') as f:
        design_data = json.load(f)

    prompt = build_analysis_prompt(design_data, config)
    base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=api_key,
        **({"http_options": {"base_url": base_url}} if base_url else {}),
    )
    models_to_try = [config.get('model', 'gemini-3.1-flash-lite-preview')]
    result = None

    retry_attempts = config.get('retry_attempts', 2)
    retry_sleep    = config.get('retry_sleep_seconds', 3)

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                log(f'尝试 {model} 分析世界观 (第{attempt+1}次)...')
                response = client.models.generate_content(model=model, contents=[prompt])
                raw = response.text.strip()
                if '```json' in raw:
                    raw = raw.split('```json')[1].split('```')[0].strip()
                elif '```' in raw:
                    raw = raw.split('```')[1].split('```')[0].strip()
                result = json.loads(raw)
                wt = result.get('worldview_type', '未知')
                log(f'✓ 世界观分析完成: 【{wt}】')
                break
            except Exception as e:
                log(f'{model} 第{attempt+1}次失败: {e}')
                if attempt < retry_attempts - 1:
                    time.sleep(retry_sleep)
        if result:
            break

    if not result:
        log('❌ Gemini 分析失败，请手动创建 style.json')
        sys.exit(1)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log(f'✓ style.json 已保存: {out}')

    # 输出到 stdout 供调用方捕获
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Step 0: Gemini 世界观视觉分析 → style.json')
    parser.add_argument('--script-json', required=True, help='script.json 路径')
    parser.add_argument('--output',      required=True, help='输出 style.json 路径')
    args = parser.parse_args()
    generate_style(args.script_json, args.output)
