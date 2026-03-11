#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
char_review.py - 角色专用 Gemini 审图脚本（世界观感知版）

两种审查类型：
  front  - 审查正视图（头身比 + 剧本符合度 + 无道具强制检查）
  views  - 审查侧/背视图与正视图的一致性

config.json 格式：
{
  "review_type": "front" | "views",
  "worldview_type": "修仙/仙侠",
  "anti_contamination": "...",
  "characters": [
    // front 模式：
    {
      "name": "白行风", "form": "形态零",
      "image": "path/to/正面.png",
      "prompt": "生成提示词",
      "is_reused": false
    }
    // views 模式：
    {
      "name": "白行风", "form": "形态零",
      "front": "path/to/正面.png",
      "side":  "path/to/侧面.png",
      "back":  "path/to/背面.png",
      "is_reused": false
    }
  ]
}

输出 (stdout 最后一行 JSON):
{
  "approved": true/false,
  "summary": "整体评价",
  "issues": [
    {
      "type": "char",
      "name": "角色名",
      "form": "形态名",
      "severity": "high|medium",
      "reason": "问题描述",
      "improved_prompt": "改进后完整提示词（仅 front 审查失败时填写）"
    }
  ]
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

# ── 世界观对应的角色审查基准描述 ─────────────────────────────────────────────
WORLDVIEW_CHAR_DESC = _RC["worldview_descriptions"]["character"]

# ── 审查 Prompt 常量 ──────────────────────────────────────────────────────────
_rp = _RC["review_prompts"]
FRONT_SYSTEM      = _rp["char_front_system"]
VIEWS_SYSTEM      = _rp["char_views_system"]
THREE_VIEW_SYSTEM = _rp["char_three_view_system"]


def read_image_part(img_path):
    """读取图片为 Gemini Part，文件不存在则返回 None"""
    if not img_path or not os.path.exists(img_path):
        return None
    with open(img_path, 'rb') as f:
        data = f.read()
    mime = 'image/png'
    lp   = img_path.lower()
    if lp.endswith(('.jpg', '.jpeg')):
        mime = 'image/jpeg'
    elif lp.endswith('.webp'):
        mime = 'image/webp'
    return types.Part.from_bytes(data=data, mime_type=mime)


def build_front_contents(chars_info, worldview_type, anti_contamination):
    """构建正视图审查的 contents 列表"""
    worldview_desc = WORLDVIEW_CHAR_DESC.get(worldview_type, WORLDVIEW_CHAR_DESC['通用'])
    anti_note      = f"\n**防污染检查（优先级最高）**: {anti_contamination}" if anti_contamination else ""

    system_text = FRONT_SYSTEM.format(
        worldview_type=worldview_type,
        worldview_desc=worldview_desc,
        anti_note=anti_note
    )
    contents = [system_text]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )
        img_part = read_image_part(char.get('image', ''))
        if img_part:
            contents.append(img_part)
        else:
            contents.append(f"[正面图不存在: {char.get('image', '?')}]")

        if char.get('prompt'):
            contents.append(f"\n该角色形态的完整生成提示词:\n{char['prompt']}\n")

    contents.append("\n请根据以上全部角色图和提示词，输出审查结果 JSON。只输出 JSON，不含其他内容。")
    return contents


def build_views_contents(chars_info):
    """构建侧/背视图一致性审查的 contents 列表"""
    contents = [VIEWS_SYSTEM]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )
        for view_key, view_label in [('front', '正面'), ('side', '侧面'), ('back', '背面')]:
            path     = char.get(view_key, '')
            img_part = read_image_part(path) if path else None
            contents.append(f"【{view_label}视图】")
            if img_part:
                contents.append(img_part)
            else:
                contents.append(f"[{view_label}图不存在: {path or '未提供'}]")

    contents.append("\n请根据以上全部三视图组，输出一致性审查结果 JSON。只输出 JSON，不含其他内容。")
    return contents


def build_three_view_contents(chars_info):
    """构建三视图角度审查的 contents 列表（检查三面板布局、视角、姿势）"""
    contents = [THREE_VIEW_SYSTEM]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )
        img_part = read_image_part(char.get('three', ''))
        if img_part:
            contents.append(img_part)
        else:
            contents.append(f"[三视图整合图不存在: {char.get('three', '?')}]")

    contents.append("\n请根据以上全部三视图整合图，审查三面板的视角角度是否正确、姿势是否站立、手中是否有道具，输出审查结果 JSON。只输出 JSON，不含其他内容。")
    return contents


def call_gemini(client, contents):
    """调用 Gemini，依次尝试多个模型，返回解析后的 dict"""
    models_to_try  = _RC["gemini"]["models"]
    retry_attempts = _RC["gemini"]["retry_attempts"]
    result = None

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                print(f'尝试 {model} (第{attempt+1}次)...', file=sys.stderr)
                response = client.models.generate_content(model=model, contents=contents)
                raw      = response.text.strip()

                # 去除可能的 markdown 代码块
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

    return result


def main():
    parser = argparse.ArgumentParser(description='角色专用 Gemini 审图（世界观感知版）')
    parser.add_argument('--config', required=True, help='审图配置 JSON 文件路径')
    args = parser.parse_args()

    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY not set', file=sys.stderr)
        sys.exit(1)

    with open(args.config, 'r', encoding='utf-8') as f:
        config = json.load(f)

    review_type       = config.get('review_type', 'front')
    chars_info        = config.get('characters', [])
    worldview_type    = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')

    if not chars_info:
        print(json.dumps({
            "approved": True,
            "summary": "无角色需要审查",
            "issues": []
        }, ensure_ascii=False))
        return

    print(
        f'审图类型: 【{review_type}】  '
        f'世界观: 【{worldview_type}】  '
        f'共 {len(chars_info)} 个角色形态',
        file=sys.stderr
    )

    _base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=api_key,
        **(_base_url and {"http_options": {"base_url": _base_url}} or {}),
    )

    if review_type == 'front':
        contents = build_front_contents(chars_info, worldview_type, anti_contamination)
    elif review_type == 'three_view':
        contents = build_three_view_contents(chars_info)
    else:
        contents = build_views_contents(chars_info)

    result = call_gemini(client, contents)

    if not result:
        print('所有 Gemini 模型均失败，默认通过审查', file=sys.stderr)
        result = {"approved": True, "summary": "所有 Gemini 模型均失败，默认通过", "issues": []}

    # 打印审查摘要到 stderr（不污染 stdout JSON）
    print(f'\n审查结果: {"✓ 通过" if result.get("approved") else "✗ 未通过"}', file=sys.stderr)
    print(f'评价: {result.get("summary", "")}', file=sys.stderr)
    if result.get('issues'):
        print('问题列表:', file=sys.stderr)
        for issue in result['issues']:
            print(
                f'  [{issue.get("severity","?")}] '
                f'「{issue.get("name","?")} / {issue.get("form","?")}」: '
                f'{issue.get("reason","?")}',
                file=sys.stderr
            )

    # 输出 JSON（generate_characters.py 从最后一行读取）
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
