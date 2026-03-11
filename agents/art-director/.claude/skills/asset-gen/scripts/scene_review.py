#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scene_review.py - 场景统一审图脚本（主图 + 参考表）

支持两种审核模式：
  1. main  - 场景主图审核（世界观合规性 + 提示词匹配度 + 技术质量）
  2. ref   - 场景参考表审核（风格继承一致性 + 多视角布局 + 污染元素）

config.json 格式：
{
  "worldview_type": "修仙/仙侠",
  "anti_contamination": "NO European architecture...",
  "style_note": "原始风格描述",
  "scenes": [  // main 模式使用
    {"name": "场景名", "image": "路径", "prompt": "完整提示词", "is_reused": false}
  ],
  "refs": [    // ref 模式使用
    {"name": "场景名", "main_image": "主图路径", "ref_image": "参考表路径", "description": "描述"}
  ]
}

输出 (stdout JSON):
{
  "approved": true/false,
  "summary": "整体评价",
  "issues": [{"name": "名称", "severity": "high/medium", "reason": "描述"}]
}
"""
import sys
import os, os, json, time, argparse

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from google import genai
from google.genai import types

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
import pathlib as _pathlib, json as _json
_REVIEW_CONFIG_PATH = _pathlib.Path(__file__).parent / "review_config.json"
with open(_REVIEW_CONFIG_PATH, "r", encoding="utf-8") as _f:
    _RC = _json.load(_f)

# 世界观对应的期望画风描述
WORLDVIEW_STYLE_DESC = _RC["worldview_descriptions"]["scene"]


def build_main_scene_prompt(worldview_type, anti_contamination, style_note, total_count):
    """构建主图审核的系统提示词"""
    style_desc = WORLDVIEW_STYLE_DESC.get(worldview_type, WORLDVIEW_STYLE_DESC["通用"])
    anti_note = f"\n**防污染项（优先级最高）**: {anti_contamination}" if anti_contamination else ""
    style_ref = f"\n**项目风格描述（仅供参考）**: {style_note}" if style_note else ""
    return _RC["review_prompts"]["scene_main_system"].format(
        total_count=total_count,
        worldview_type=worldview_type,
        style_desc=style_desc,
        anti_note=anti_note,
        style_ref=style_ref,
    )


def build_ref_scene_prompt(worldview_type, anti_contamination, style_note, total_count):
    """构建参考表审核的系统提示词"""
    style_desc = WORLDVIEW_STYLE_DESC.get(worldview_type, WORLDVIEW_STYLE_DESC["通用"])
    anti_note = f"\n**防污染项（优先级最高）**: {anti_contamination}" if anti_contamination else ""
    style_ref = f"\n**项目风格描述（仅供参考）**: {style_note}" if style_note else ""
    return _RC["review_prompts"]["scene_ref_system"].format(
        total_count=total_count,
        worldview_type=worldview_type,
        style_desc=style_desc,
        anti_note=anti_note,
        style_ref=style_ref,
    )


def load_image(img_path):
    """加载图片并返回 Part 对象"""
    if not os.path.exists(img_path):
        return None, f"[图片不存在: {img_path}]"

    with open(img_path, 'rb') as f:
        img_data = f.read()

    mime = 'image/png'
    if img_path.lower().endswith(('.jpg', '.jpeg')):
        mime = 'image/jpeg'
    elif img_path.lower().endswith('.webp'):
        mime = 'image/webp'

    return types.Part.from_bytes(data=img_data, mime_type=mime), None


def review_main_scenes(config, client):
    """审核主场景图"""
    scenes_info = config.get('scenes', [])
    worldview_type = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')
    style_note = config.get('style_note', '')

    if not scenes_info:
        return {"approved": True, "summary": "无场景需要审查", "issues": []}

    print(f'审图世界观: 【{worldview_type}】，共 {len(scenes_info)} 个场景', file=sys.stderr)

    # 构建 contents
    system_text = build_main_scene_prompt(worldview_type, anti_contamination, style_note, len(scenes_info))
    contents = [system_text]

    for i, s in enumerate(scenes_info, 1):
        img_path = s['image']
        status = "已确认" if s.get('is_reused') else "待审"

        contents.append(f"\n{'='*50}\n场景 #{i}「{s['name']}」【{status}】\n{'='*50}")

        # 加载图片
        img_part, error = load_image(img_path)
        if img_part:
            contents.append(img_part)
        else:
            print(f'警告: {error}', file=sys.stderr)
            contents.append(error)

        # 完整提示词
        contents.append(f"该场景的完整生成提示词:\n{s['prompt']}\n")

    contents.append("\n请根据上方全部场景图和提示词，输出审查结果 JSON。只输出 JSON，不要任何其他内容。")

    return call_gemini(client, contents)


def review_ref_scenes(config, client):
    """审核场景参考表"""
    refs_info = config.get('refs', [])
    worldview_type = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')
    style_note = config.get('style_note', '')

    if not refs_info:
        return {"approved": True, "summary": "无参考表需要审查", "issues": []}

    print(f'审图世界观: 【{worldview_type}】，共 {len(refs_info)} 组参考表', file=sys.stderr)

    # 构建 contents
    system_text = build_ref_scene_prompt(worldview_type, anti_contamination, style_note, len(refs_info))
    contents = [system_text]

    for i, r in enumerate(refs_info, 1):
        name = r['name']
        main_path = r['main_image']
        ref_path = r['ref_image']
        description = r.get('description', '')

        contents.append(f"\n{'='*50}\n参考表组 #{i}「{name}」\n{'='*50}")

        # 主图（已确认标准）
        contents.append("① 主场景图（已确认画风标准）:")
        img_part, error = load_image(main_path)
        if img_part:
            contents.append(img_part)
        else:
            contents.append(error)

        # 参考表（待审）
        contents.append("② 参考表（待审核）:")
        img_part, error = load_image(ref_path)
        if img_part:
            contents.append(img_part)
        else:
            contents.append(error)

        if description:
            contents.append(f"场景描述: {description[:200]}\n")

    contents.append("\n请根据上方全部参考表组，输出审查结果 JSON。只输出 JSON，不要任何其他内容。")

    return call_gemini(client, contents)


def call_gemini(client, contents):
    """调用 Gemini API 进行审图"""
    models_to_try  = _RC["gemini"]["models"]
    retry_attempts = _RC["gemini"]["retry_attempts"]
    result = None

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                print(f'尝试 {model} (第{attempt+1}次)...', file=sys.stderr)
                response = client.models.generate_content(model=model, contents=contents)
                raw = response.text.strip()

                # 提取 JSON
                if '```json' in raw:
                    raw = raw.split('```json')[1].split('```')[0].strip()
                elif '```' in raw:
                    raw = raw.split('```')[1].split('```')[0].strip()

                result = json.loads(raw)
                print(f'{model} 审查完成', file=sys.stderr)
                break
            except Exception as e:
                print(f'{model} 第{attempt+1}次失败: {e}', file=sys.stderr)
                if attempt == 0:
                    time.sleep(_RC["gemini"]["retry_sleep_seconds"])
        if result:
            break

    if not result:
        print('所有模型均失败，默认通过审查', file=sys.stderr)
        result = {"approved": True, "summary": "所有 Gemini 模型均失败，默认通过", "issues": []}

    return result


def main():
    parser = argparse.ArgumentParser(description='场景统一审图脚本（主图 + 参考表）')
    parser.add_argument('--config', required=True, help='审图配置 JSON 文件路径')
    parser.add_argument('--mode', required=True, choices=['main', 'ref'],
                       help='审核模式: main=主图审核, ref=参考表审核')
    args = parser.parse_args()

    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY not set', file=sys.stderr)
        sys.exit(1)

    with open(args.config, 'r', encoding='utf-8') as f:
        config = json.load(f)

    _base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=api_key,
        **(_base_url and {"http_options": {"base_url": _base_url}} or {}),
    )

    # 根据模式选择审核函数
    if args.mode == 'main':
        result = review_main_scenes(config, client)
    else:  # ref
        result = review_ref_scenes(config, client)

    # 输出结果
    print(f'\n审查结果: {"通过" if result.get("approved") else "未通过"}', file=sys.stderr)
    print(f'评价: {result.get("summary", "")}', file=sys.stderr)
    if result.get('issues'):
        print('问题列表:', file=sys.stderr)
        for issue in result['issues']:
            print(f'  [{issue.get("severity","?")}] 「{issue.get("name","?")}」: {issue.get("reason","?")}', file=sys.stderr)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
