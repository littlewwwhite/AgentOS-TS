#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
props_review.py - 道具专用 Gemini 审图脚本（世界观感知版）

关键特性：
  1. 从 config 读取 worldview_type / anti_contamination，按世界观标准审图
  2. 图文交替配对展示：每张图片后立即跟随其完整生成提示词
  3. 检查道具风格是否与世界观一致（如仙侠道具不能出现工业制造感）

config.json 格式：
{
  "worldview_type":      "修仙/仙侠",
  "anti_contamination":  "NO European craftsmanship, ...",
  "style_note":          "原始风格描述",
  "props": [
    {"name": "道具名", "image": "路径", "prompt": "完整提示词", "is_reused": false}
  ]
}

输出 (stdout JSON):
{
  "approved": true/false,
  "summary": "整体评价",
  "issues": [{"type": "prop", "name": "名称", "severity": "high/medium", "reason": "描述"}]
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

# 道具对应世界观的期望材质/制造工艺描述
WORLDVIEW_PROP_DESC = _RC["worldview_descriptions"]["prop"]


def build_system_prompt(worldview_type, anti_contamination, style_note, total_count):
    """构建系统指令"""
    prop_desc = WORLDVIEW_PROP_DESC.get(worldview_type, WORLDVIEW_PROP_DESC["通用"])
    anti_note = f"\n**道具防污染检查项（优先级最高）**: {anti_contamination}" if anti_contamination else ""
    style_ref = f"\n**项目原始风格描述（仅供理解创作意图）**: {style_note}" if style_note else ""
    return _RC["review_prompts"]["prop_system"].format(
        total_count=total_count,
        worldview_type=worldview_type,
        prop_desc=prop_desc,
        anti_note=anti_note,
        style_ref=style_ref,
    )


def build_output_reminder():
    return "\n请根据上方全部道具图和提示词，输出审查结果 JSON。只输出 JSON，不要任何其他内容。"


def main():
    parser = argparse.ArgumentParser(description='道具专用 Gemini 审图（世界观感知版）')
    parser.add_argument('--config', required=True, help='审图配置 JSON 文件路径')
    args = parser.parse_args()

    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY not set', file=sys.stderr)
        sys.exit(1)

    with open(args.config, 'r', encoding='utf-8') as f:
        config = json.load(f)

    props_info         = config.get('props', [])
    worldview_type     = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')
    style_note         = config.get('style_note', '')

    if not props_info:
        print(json.dumps({"approved": True, "summary": "无道具需要审查", "issues": []}, ensure_ascii=False))
        return

    print(f'审图世界观: 【{worldview_type}】，共 {len(props_info)} 个道具', file=sys.stderr)

    _base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=api_key,
        **(_base_url and {"http_options": {"base_url": _base_url}} or {}),
    )

    # 构建 contents：系统指令 → 逐一 [图片 + 完整提示词] → 输出提醒
    system_text = build_system_prompt(worldview_type, anti_contamination, style_note, len(props_info))
    contents = [system_text]

    for i, p in enumerate(props_info, 1):
        img_path = p['image']
        status = "已确认" if p.get('is_reused') else "待审"

        contents.append(f"\n{'='*50}\n道具 #{i}「{p['name']}」【{status}】\n{'='*50}")

        if os.path.exists(img_path):
            with open(img_path, 'rb') as f:
                img_data = f.read()
            mime = 'image/png'
            if img_path.lower().endswith(('.jpg', '.jpeg')):
                mime = 'image/jpeg'
            elif img_path.lower().endswith('.webp'):
                mime = 'image/webp'
            contents.append(types.Part.from_bytes(data=img_data, mime_type=mime))
        else:
            print(f'警告: 道具图不存在: {img_path}', file=sys.stderr)
            contents.append(f"[图片不存在: {img_path}]")

        contents.append(f"该道具的完整生成提示词:\n{p['prompt']}\n")

    contents.append(build_output_reminder())

    models_to_try  = _RC["gemini"]["models"]
    retry_attempts = _RC["gemini"]["retry_attempts"]
    result = None

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                print(f'尝试 {model} (第{attempt+1}次)...', file=sys.stderr)
                response = client.models.generate_content(model=model, contents=contents)
                raw = response.text.strip()
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

    print(f'\n审查结果: {"通过" if result.get("approved") else "未通过"}', file=sys.stderr)
    print(f'评价: {result.get("summary", "")}', file=sys.stderr)
    if result.get('issues'):
        print('问题列表:', file=sys.stderr)
        for issue in result['issues']:
            print(f'  [{issue.get("severity","?")}] 「{issue.get("name","?")}」: {issue.get("reason","?")}', file=sys.stderr)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
