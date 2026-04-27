#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_char.py - 角色专用 Gemini 审图脚本（世界观感知版）

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
This image+text review path remains deferred until `aos-cli model` defines an explicit multimodal review contract for the required media upload/processing lifecycle and review I/O shape.

三种审查类型：
  front      - 审查正视图（头身比 + 剧本符合度 + 无道具强制检查）
  views      - 审查侧/背视图与正视图的一致性
  three_view - 审查三视图角度（检查三面板布局、视角、姿势）

config JSON 格式（通过 --config 参数传递 JSON 字符串）：
{
  "worldview_type": "修仙/仙侠",
  "anti_contamination": "...",
  "actors": [
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
    // three_view 模式：
    {
      "name": "白行风", "form": "形态零",
      "three": "path/to/三视图.png",
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

import sys, os, json, time, argparse

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ── 日志前缀（由 main 根据 actor_name 设置）────────────────────────────────────
_log_prefix = ""


def _log(msg):
    print(f"{_log_prefix}{msg}", file=sys.stderr)

from gemini_multimodal_legacy import create_client, load_image_part, extract_response_text

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
from common_config import get_review_config
_RC = get_review_config()

# # ── 世界观对应的角色审查基准描述 ─────────────────────────────────────────────
# WORLDVIEW_CHAR_DESC = _RC["worldview_descriptions"]["character"]

# ── 审查 Prompt 常量 ──────────────────────────────────────────────────────────
_rp = _RC["review_prompts"]
THREE_VIEW_SYSTEM      = _rp["char_three_view_system"]
THREE_VIEW_GATE_SYSTEM = _rp["char_three_view_gate"]
HEAD_CLOSEUP_SYSTEM    = _rp["char_head_closeup_system"]

def build_three_view_contents(chars_info, worldview_type, visual_mode='', character_style=None):
    """构建三视图角度审查的 contents 列表（检查三面板布局、视角、姿势）"""
    # worldview_desc = WORLDVIEW_CHAR_DESC.get(worldview_type, WORLDVIEW_CHAR_DESC['通用'])
    character_desc = ''
    for char in chars_info:
        ctx = char.get('script_context', '')
        if ctx:
            character_desc = ctx
            break

    system_text = THREE_VIEW_SYSTEM.format(
        total_count=len(chars_info),
        worldview_type=worldview_type,
        visual_mode=visual_mode or '未指定',
        worldview_desc=visual_mode+'。'+character_style.get('prefix', ''),
        character_desc=character_desc,
    )
    _log(f'\n[审核提示词]\n{system_text}')
    contents = [system_text]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )
        img_part = load_image_part(char.get('image', ''))[0]
        if img_part:
            contents.append(img_part)
        else:
            contents.append(f"[三视图不存在: {char.get('image', '?')}]")

        if char.get('prompt'):
            contents.append(f"\n该角色形态的完整生成提示词:\n{char['prompt']}\n")

    contents.append(_rp["closing"])
    return contents


def build_three_view_gate_contents(chars_info, visual_mode=''):
    """构建三视图 Layer 1 门控审查的 contents 列表（纯结构二值判断）"""
    system_text = THREE_VIEW_GATE_SYSTEM.format(
        total_count=len(chars_info),
        visual_mode=visual_mode or '未指定',
    )
    _log(f'\n[门控审核提示词]\n{system_text}')
    contents = [system_text]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )
        img_part = load_image_part(char.get('image', ''))[0]
        if img_part:
            contents.append(img_part)
        else:
            contents.append(f"[三视图不存在: {char.get('image', '?')}]")

        if char.get('prompt'):
            contents.append(f"\n该角色形态的完整生成提示词:\n{char['prompt']}\n")

    contents.append(_rp["closing"])
    return contents


def build_head_closeup_contents(chars_info):
    """构建头部特写审查的 contents 列表（输入正视图+头部特写两张图，单层质量评分，无门控）

    chars_info 中每个 char 需包含:
        - image: 头部特写图片路径
        - front_image: 正视图图片路径（作为一致性参考）
    """
    system_text = HEAD_CLOSEUP_SYSTEM.format(
        total_count=len(chars_info),
    )
    _log(f'\n[头部特写审核提示词]\n{system_text}')
    contents = [system_text]

    for i, char in enumerate(chars_info, 1):
        status = "已确认" if char.get('is_reused') else "待审"
        contents.append(
            f"\n{'='*48}\n"
            f"角色 #{i}「{char['name']}」形态「{char.get('form', '')}」【{status}】\n"
            f"{'='*48}"
        )

        # 正视图（参考基准）
        front_path = char.get('front_image', '')
        if front_path:
            contents.append("\n【正视图（参考基准）】")
            front_part = load_image_part(front_path)[0]
            if front_part:
                contents.append(front_part)
            else:
                contents.append(f"[正视图不存在: {front_path}]")

        # 头部特写（待审目标）
        contents.append("\n【头部特写（待审目标）】")
        img_part = load_image_part(char.get('image', ''))[0]
        if img_part:
            contents.append(img_part)
        else:
            contents.append(f"[头部特写不存在: {char.get('image', '?')}]")

        if char.get('prompt'):
            contents.append(f"\n该角色形态的完整生成提示词:\n{char['prompt']}\n")

    contents.append(_rp["closing"])
    return contents


def call_gemini(client, contents, models=None):
    """调用 Gemini，依次尝试多个模型，返回解析后的 dict"""
    models_to_try  = models or _RC["gemini"]["models"]
    retry_attempts = _RC["gemini"]["retry_attempts"]
    result = None

    for model in models_to_try:
        for attempt in range(retry_attempts):
            try:
                _log(f'尝试 {model} (第{attempt+1}次)...')
                response = client.models.generate_content(model=model, contents=contents)
                raw = extract_response_text(response)

                # 去除可能的 markdown 代码块
                if '```json' in raw:
                    raw = raw.split('```json')[1].split('```')[0].strip()
                elif '```' in raw:
                    raw = raw.split('```')[1].split('```')[0].strip()

                result = json.loads(raw)
                _log(f'{model} 审查完成')
                break
            except Exception as e:
                _log(f'{model} 第{attempt+1}次失败: {e}')
                if attempt == 0:
                    time.sleep(_RC["gemini"]["retry_sleep_seconds"])
        if result:
            break

    return result


def main():
    parser = argparse.ArgumentParser(description='角色专用 Gemini 审图（世界观感知版）')
    parser.add_argument('--config', required=True, help='审图配置 JSON 字符串')
    parser.add_argument('--mode', default='front', choices=['three_view', 'head_closeup'],
                        help='审核模式: three_view=三视图两阶段审核, head_closeup=头部特写质量审核')
    args = parser.parse_args()

    try:
        client = create_client()
    except ValueError as e:
        _log(f'ERROR: {e}')
        sys.exit(1)

    config = json.loads(args.config)

    # ── 设置日志前缀 ──────────────────────────────────────────────────────────
    global _log_prefix
    actor_name = config.get('actor_name', '')
    _log_prefix = f"【{actor_name}】" if actor_name else ""

    review_type        = args.mode
    chars_info         = config.get('actors', [])
    worldview_type     = config.get('worldview_type', '通用')
    visual_mode        = config.get('visual_mode', '')
    character_style    = config.get('character_style', {})
    anti_contamination = config.get('anti_contamination', '')

    if not chars_info:
        print(json.dumps({
            "approved": True,
            "summary": "无角色需要审查",
            "issues": []
        }, ensure_ascii=False))
        return

    _log(
        f'审图类型: 【{review_type}】  '
        f'世界观: 【{worldview_type}】  '
        f'共 {len(chars_info)} 个角色形态'
    )

    # ── head_closeup 模式：单层质量评分，无门控 ───────────────────────────
    if review_type == 'head_closeup':
        _log('=== 头部特写质量评分 ===')
        contents = build_head_closeup_contents(chars_info)
        score_result = call_gemini(client, contents, models=["gemini-3.1-pro-preview"])
        if not score_result:
            import logging
            logging.warning("Gemini review bypassed (head_closeup): quota exhausted or all models failed")
            _log('[WARNING] Gemini review bypassed (head_closeup): quota exhausted or all models failed')
            score_result = {
                "approved": True,
                "summary": "review bypassed: quota exhausted",
                "scores": [],
                "issues": [],
                "review_bypassed": True,
                "bypass_reason": "quota_exhausted",
            }

        result = {
            "approved": score_result.get("approved", False),
            "summary": score_result.get("summary", ""),
            "scores": score_result.get("scores", []),
            "issues": score_result.get("issues", []),
        }
        if score_result.get("review_bypassed"):
            result["review_bypassed"] = True
            result["bypass_reason"] = score_result.get("bypass_reason", "quota_exhausted")
        _log(f'评价: {result.get("summary", "")}')
        if result.get('issues'):
            _log('问题列表:')
            for issue in result['issues']:
                _log(
                    f'  [{issue.get("severity","?")}] '
                    f'「{issue.get("name","?")} / {issue.get("form","?")}」: '
                    f'{issue.get("reason","?")}'
                )

        print(json.dumps(result, ensure_ascii=False))
        return

    # ── three_view 模式：两阶段审核 ──────────────────────────────────────
    _log('=== Layer 1: 结构门控审查 ===')
    gate_contents = build_three_view_gate_contents(chars_info, visual_mode)
    gate_result = call_gemini(client, gate_contents, models=["gemini-3.1-pro-preview"])

    if not gate_result:
        import logging
        logging.warning("Gemini review bypassed (three_view gate): quota exhausted or all models failed")
        _log('[WARNING] Gemini review bypassed (three_view gate): quota exhausted or all models failed')
        gate_result = {
            "gate_results": [{"name": c["name"], "pass": True, "failed_items": [], "review_bypassed": True, "bypass_reason": "quota_exhausted"} for c in chars_info],
            "review_bypassed": True,
            "bypass_reason": "quota_exhausted",
        }

    gate_map = {g["name"]: g for g in gate_result.get("gate_results", [])}
    passed_chars = [c for c in chars_info if gate_map.get(c["name"], {}).get("pass", True)]
    failed_chars = [c for c in chars_info if not gate_map.get(c["name"], {}).get("pass", True)]

    _log(f'门控结果: 通过 {len(passed_chars)} 张，拦截 {len(failed_chars)} 张')
    for c in failed_chars:
        items = gate_map.get(c["name"], {}).get("failed_items", [])
        _log(f'  ✗ 「{c["name"]}」拦截原因: {", ".join(items)}')

    # ── Layer 2: 质量评分（仅对通过门控的图片）────────────────────────────
    gate_issues = [
        {
            "type": "three_view",
            "name": c["name"],
            "form": c.get("form", ""),
            "severity": "high",
            "reason": "、".join(gate_map.get(c["name"], {}).get("failed_items", ["结构门控未通过"])),
            "improved_prompt": ""
        }
        for c in failed_chars
    ]

    if passed_chars:
        _log('=== Layer 2: 质量评分 ===')
        score_contents = build_three_view_contents(passed_chars, worldview_type, visual_mode, character_style)
        score_result = call_gemini(client, score_contents, models=["gemini-3.1-pro-preview"])
        if not score_result:
            import logging
            logging.warning("Gemini review bypassed (three_view quality): quota exhausted or all models failed")
            _log('[WARNING] Gemini review bypassed (three_view quality): quota exhausted or all models failed')
            score_result = {
                "approved": True,
                "summary": "review bypassed: quota exhausted",
                "scores": [],
                "issues": [],
                "best_pick": "",
                "review_bypassed": True,
                "bypass_reason": "quota_exhausted",
            }
    else:
        score_result = {"approved": False, "summary": "所有图片均未通过结构门控", "scores": [], "issues": [], "best_pick": ""}

    # 合并两层结果
    all_issues = gate_issues + score_result.get("issues", [])
    result = {
        "approved": score_result.get("approved", False),
        "summary": score_result.get("summary", ""),
        "scores": score_result.get("scores", []),
        "issues": all_issues,
        "best_pick": score_result.get("best_pick", ""),
    }
    # Propagate bypass marker when either layer was skipped due to quota/error
    gate_bypassed = gate_result.get("review_bypassed", False)
    score_bypassed = score_result.get("review_bypassed", False)
    if gate_bypassed or score_bypassed:
        result["review_bypassed"] = True
        result["bypass_reason"] = score_result.get("bypass_reason") or gate_result.get("bypass_reason", "quota_exhausted")

    # 打印审查摘要到 stderr（不污染 stdout JSON）
    _log(f'\n审查结果: {"✓ 通过" if result.get("approved") else "✗ 未通过"}, config: {config}')
    _log(f'评价: {result.get("summary", "")}')
    if result.get('issues'):
        _log('问题列表:')
        for issue in result['issues']:
            _log(
                f'  [{issue.get("severity","?")}] '
                f'「{issue.get("name","?")} / {issue.get("form","?")}」: '
                f'{issue.get("reason","?")}'
            )

    # 输出 JSON（generate_characters.py 从最后一行读取）
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
