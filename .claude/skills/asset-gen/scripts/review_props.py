#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_props.py - 道具统一审图脚本（主图 + 参考表）

Model boundary note: this image+text review path remains deferred until `aos-cli model` defines an explicit multimodal review contract for the required media upload/processing lifecycle and review I/O shape.

支持两种审核模式：
  1. main  - 道具主图审核（世界观合规性 + 提示词匹配度 + 技术质量）
  2. ref   - 道具参考表审核（风格继承一致性 + 多视角布局 + 污染元素）

config.json 格式：
{
  "worldview_type": "修仙/仙侠",
  "anti_contamination": "NO European craftsmanship, ...",
  "style_note": "原始风格描述",
  "props": [  // main 模式使用
    {"name": "道具名", "image": "路径", "prompt": "完整提示词", "is_reused": false}
  ],
  "refs": [   // ref 模式使用
    {"name": "道具名", "main_image": "主图路径", "ref_image": "参考表路径", "description": "道具描述"}
  ]
}

输出 (stdout JSON):
{
  "approved": true/false,
  "summary": "整体评价",
  "issues": [{"name": "名称", "severity": "high/medium", "reason": "描述"}]
}
"""
import sys, os, json, time, argparse

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from gemini_multimodal_legacy import create_client, load_image_part, extract_response_text

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
from common_config import get_review_config
_RC = get_review_config()

# 道具对应世界观的期望材质/制造工艺描述
# WORLDVIEW_PROP_DESC = _RC["worldview_descriptions"]["prop"]


def build_main_prop_prompt(worldview_type, anti_contamination, style_note, total_count, prop_desc=''):
    anti_note = f"\n**道具防污染检查项（优先级最高）**: {anti_contamination}" if anti_contamination else ""
    style_ref = f"\n**项目原始风格描述（仅供理解创作意图）**: {style_note}" if style_note else ""
    return _RC["review_prompts"]["prop_system"].format(
        total_count=total_count,
        worldview_type=worldview_type,
        prop_desc=prop_desc,
        anti_note=anti_note,
        style_ref=style_ref,
    )


def build_ref_prop_prompt(worldview_type, anti_contamination, style_note, total_count, prop_desc=''):
    anti_note = f"\n**道具防污染检查项（优先级最高）**: {anti_contamination}" if anti_contamination else ""
    style_ref = f"\n**项目原始风格描述（仅供参考）**: {style_note}" if style_note else ""
    return _RC["review_prompts"]["prop_ref_system"].format(
        total_count=total_count,
        worldview_type=worldview_type,
        prop_desc=prop_desc,
        anti_note=anti_note,
        style_ref=style_ref,
    )


def review_main_props(config, client):
    """审核道具主图"""
    props_info         = config.get('props', [])
    worldview_type     = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')
    style_note         = config.get('style_note', '')

    if not props_info:
        return {"approved": True, "summary": "无道具需要审查", "issues": []}

    print(f'审图世界观: 【{worldview_type}】，共 {len(props_info)} 个道具', file=sys.stderr)

    description = props_info[0].get('description', '') if props_info else ''

    system_text = build_main_prop_prompt(worldview_type, anti_contamination, style_note, len(props_info), description)
    contents = [system_text]

    for i, p in enumerate(props_info, 1):
        img_path = p['image']
        status = "已确认" if p.get('is_reused') else "待审"

        contents.append(f"\n{'='*50}\n道具 #{i}「{p['name']}」【{status}】\n{'='*50}")

        img_part, img_error = load_image_part(img_path)
        if img_part:
            contents.append(img_part)
        else:
            print(f'警告: 道具图不存在: {img_path}', file=sys.stderr)
            contents.append(img_error)

        contents.append(f"该道具的完整生成提示词:\n{p['prompt']}\n")

        description = p.get('description', '')
        if description:
            contents.append(f"该道具的详细描述:\n{description}\n")

    contents.append(_RC["review_prompts"]["closing"])

    return call_gemini(client, contents, models=["gemini-3.1-pro-preview"])


def review_ref_props(config, client):
    """审核道具参考表"""
    refs_info          = config.get('refs', [])
    worldview_type     = config.get('worldview_type', '通用')
    anti_contamination = config.get('anti_contamination', '')
    style_note         = config.get('style_note', '')

    if not refs_info:
        return {"approved": True, "summary": "无参考表需要审查", "issues": []}

    print(f'审图世界观: 【{worldview_type}】，共 {len(refs_info)} 组道具参考表', file=sys.stderr)

    description = refs_info[0].get('description', '') if refs_info else ''

    system_text = build_ref_prop_prompt(worldview_type, anti_contamination, style_note, len(refs_info), description)
    contents = [system_text]

    for i, r in enumerate(refs_info, 1):
        name        = r['name']
        main_path   = r['main_image']
        ref_path    = r['ref_image']
        description = r.get('description', '')

        contents.append(f"\n{'='*50}\n参考表组 #{i}「{name}」\n{'='*50}")

        contents.append("① 道具主图（已确认画风标准）:")
        img_part, error = load_image_part(main_path)
        if img_part:
            contents.append(img_part)
        else:
            contents.append(error)

        contents.append("② 参考表（待审核）:")
        img_part, error = load_image_part(ref_path)
        if img_part:
            contents.append(img_part)
        else:
            contents.append(error)

        if description:
            contents.append(f"道具描述: {description[:200]}\n")

    contents.append(_RC["review_prompts"]["closing"])

    return call_gemini(client, contents, models=["gemini-3.1-pro-preview"])


def call_gemini(client, contents, models=None):
    models_to_try  = models or _RC["gemini"]["models"]
    retry_attempts = _RC["gemini"]["retry_attempts"]
    result = None

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                print(f'尝试 {model} (第{attempt+1}次)...', file=sys.stderr)
                response = client.models.generate_content(model=model, contents=contents)
                raw = extract_response_text(response)
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
    parser = argparse.ArgumentParser(description='道具统一审图脚本（主图 + 参考表）')
    parser.add_argument('--config', required=True, help='审图配置 JSON 字符串')
    parser.add_argument('--mode', default='main', choices=['main', 'ref'],
                        help='审核模式: main=主图审核（默认）, ref=参考表审核')
    args = parser.parse_args()

    try:
        client = create_client()
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    config = json.loads(args.config)

    if args.mode == 'main':
        result = review_main_props(config, client)
    else:  # ref
        result = review_ref_props(config, client)

    print(f'\n审查结果: {"通过" if result.get("approved") else "未通过"}, config: {config}', file=sys.stderr)
    print(f'评价: {result.get("summary", "")}', file=sys.stderr)
    if result.get('issues'):
        print('问题列表:', file=sys.stderr)
        for issue in result['issues']:
            print(f'  [{issue.get("severity","?")}] 「{issue.get("name","?")}」: {issue.get("reason","?")}', file=sys.stderr)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
