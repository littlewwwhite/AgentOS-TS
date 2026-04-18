#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成视频提示词JSON文件（改进版v2）
基于 video-gen skill 规范

主要改进：
1. source_beat直接从script.json提取
2. description依赖上下文（人物位置连续性）
3. description纯英文/纯中文，无混杂
4. 将剧本内容转换为详细的视觉描述
"""

import json
import os
import sys
import argparse
import re
import base64
import time
import warnings
from pathlib import Path
warnings.filterwarnings('ignore', category=FutureWarning)


from compat import TeeWriter, ensure_utf8_output
from claude_subagent import ClaudeSubagent, safe_json_loads as _safe_json_loads

ensure_utf8_output()

import subprocess
import shutil
from datetime import datetime
from tqdm import tqdm

# 加载配置（保留 gemini 配置供视频评审模块使用）
from config_loader import get_prompt_generation_config, get_gemini_config, get_video_model_config

_prompt_cfg = get_prompt_generation_config()
_gemini_cfg = get_gemini_config()

# 即梦 SD2.0 稳定性固定前缀（注入到每个 clip 的 complete_prompt 开头）
_JIMENG_QUALITY_PREFIX = (
    "面部稳定不变形，五官清晰，全程样貌一致，无崩脸；"
    "人体结构正常，四肢自然，服装发型全程不变；"
    "动作流畅，不僵硬，无穿模，无变脸。"
)

# 画风关键词前缀（每次运行只检测一次，优先级高于稳定性前缀，置于 complete_prompt 最开头）
_STYLE_PREFIX: str = ""


def _analyze_actor_style_with_gemini(actor_infos: list) -> str:
    """使用 Gemini API 分析角色参考图，返回画风文字描述。

    若 Gemini API key 缺失、依赖未安装或图片下载失败，返回空字符串。
    """
    if not _gemini_cfg.get('api_key'):
        return ""
    try:
        import urllib.request
        from google import genai
        from google.genai import types
    except ImportError:
        return ""

    try:
        http_opts = (
            types.HttpOptions(base_url=_gemini_cfg['base_url'])
            if _gemini_cfg.get('base_url') else None
        )
        client = genai.Client(api_key=_gemini_cfg['api_key'], http_options=http_opts)

        image_parts = []
        for info in actor_infos[:3]:
            url = info.get('three_view_url') or info.get('face_view_url')
            if not url:
                continue
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    image_bytes = resp.read()
                    content_type = resp.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
                image_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=content_type))
                print(f"[STYLE] 已加载角色参考图: {info['name']}")
            except Exception as e:
                print(f"[STYLE] 下载 {info['name']} 图片失败: {e}")

        if not image_parts:
            return ""

        prompt = (
            "请观察这些角色图片，简短描述画面的艺术风格（如三维CG动画、2D手绘、写实真人等）"
            "以及主要视觉特征（如仙侠风格、卡通风格等）。不超过100字，只需描述风格，不需要描述角色细节。"
        )
        response = client.models.generate_content(
            model=_gemini_cfg.get('review_model', 'gemini-2.0-flash'),
            contents=image_parts + [prompt]
        )
        description = response.text.strip()
        print(f"[STYLE] Gemini 画风描述: {description}")
        return description
    except Exception as e:
        print(f"[STYLE] Gemini 图片分析失败: {e}")
        return ""


def detect_art_style_from_actors(claude_subagent) -> str:
    """从角色资产图片检测画风，返回适合视频生成的风格关键词前缀字符串。

    流程：
    1. 读取 output/actors/actors.json，收集前3个角色的图片URL和名称
    2. 尝试用 Gemini API 分析角色图片（不可用时跳过）
    3. 用 Claude subagent 根据图片描述（或角色名称）生成风格关键词
    4. 返回形如 "三维CG动画，古风仙侠，" 的字符串（末尾含逗号和空格）
    """
    actors_path = os.path.join(OUTPUT_ROOT, 'actors', 'actors.json')
    if not os.path.exists(actors_path):
        print("[STYLE] actors.json 不存在，跳过风格检测")
        return ""

    with open(actors_path, 'r', encoding='utf-8') as f:
        actors_data = json.load(f)

    # 收集前3个角色的信息
    actor_infos = []
    for act_id, actor in list(actors_data.items())[:3]:
        name = actor.get('name', act_id)
        info: dict = {'id': act_id, 'name': name}
        for state_data in actor.values():
            if isinstance(state_data, dict):
                if 'three_view_url' in state_data:
                    info['three_view_url'] = state_data['three_view_url']
                    break
                elif 'face_view_url' in state_data:
                    info.setdefault('face_view_url', state_data['face_view_url'])
        actor_infos.append(info)

    # 尝试 Gemini 图片分析（支持图片输入）
    gemini_description = _analyze_actor_style_with_gemini(actor_infos)

    # 用 Claude subagent 生成风格关键词
    actor_names = "、".join(info['name'] for info in actor_infos)
    if gemini_description:
        claude_prompt = (
            f"根据以下角色的画风描述，生成适合AI视频生成的风格关键词前缀（中文，不超过20字，"
            f"多个关键词用顿号分隔，末尾加顿号和空格）。\n\n"
            f"角色名：{actor_names}\n"
            f"画风描述：{gemini_description}\n\n"
            f"要求：只输出关键词字符串，不含解释，不含引号。\n"
            f"示例格式：三维CG动画，古风仙侠，"
        )
    else:
        claude_prompt = (
            f"根据角色名称推断这部作品的画面风格，生成适合AI视频生成的风格关键词前缀（中文，不超过20字，"
            f"多个关键词用顿号分隔，末尾加顿号和空格）。\n\n"
            f"角色名：{actor_names}\n\n"
            f"要求：只输出关键词字符串，不含解释，不含引号。\n"
            f"示例格式：三维CG动画，古风仙侠，"
        )

    try:
        response = claude_subagent.generate_content(claude_prompt)
        style_keywords = response.text.strip().strip('"').strip("'")
        # 确保末尾有逗号和空格分隔后续内容
        if style_keywords:
            if not style_keywords.endswith('，'):
                style_keywords += '，'
            style_keywords += ' '
        print(f"[STYLE] 生成风格关键词: {style_keywords!r}")
        return style_keywords
    except Exception as e:
        print(f"[STYLE] Claude 风格关键词生成失败: {e}")
        return ""


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
WORKSPACE_ROOT = WORKSPACE_ROOT


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


def load_scene_config():
    """加载场景配置文件"""
    scene_config_path = os.path.join(OUTPUT_ROOT, 'locations', 'scene.json')
    if os.path.exists(scene_config_path):
        with open(scene_config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}



def remove_costume_colors_with_gemini(script_path, batch_size=10, max_workers=10):
    """使用 Claude subagent 并发批量去除剧本中的服饰颜色描述

    参数:
        script_path: 剧本JSON文件路径
        batch_size: 每批处理的 content 数量（默认10）
        max_workers: 最大并发数（默认10）

    返回:
        处理后的剧本文件路径（临时文件）
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    print("正在使用 Claude subagent 去除服饰颜色描述（并发批量处理模式）...")
    print(f"  并发数: {max_workers}，每批: {batch_size} 条")

    # 读取原始剧本
    with open(script_path, 'r', encoding='utf-8') as f:
        script_data = json.load(f)

    # 步骤1: 收集所有 content 字段及其引用
    content_refs = []
    for episode in script_data.get('episodes', []):
        for scene in episode.get('scenes', []):
            for action in scene.get('actions', []):
                original_content = action.get('content', '')
                if original_content:
                    content_refs.append((action, original_content, len(content_refs)))

    total_count = len(content_refs)
    total_batches = (total_count + batch_size - 1) // batch_size
    print(f"  找到 {total_count} 个 content 字段，共 {total_batches} 批")

    # 线程安全计数器
    lock = threading.Lock()
    counters = {'modified': 0, 'processed': 0, 'failed_batches': 0}

    def _process_single(model, action, original_content):
        """单条回退处理"""
        single_prompt = f"""请去除以下文本中关于服饰颜色的描述，保持其他内容不变。只返回修改后的文本。

原文本：
{original_content}

修改后的文本："""
        response = model.generate_content(single_prompt)
        return response.text.strip()

    def _process_batch(batch_idx, batch):
        """处理单个批次（在线程中执行）"""
        # 每个线程创建独立的 subagent 实例
        model = ClaudeSubagent()

        batch_modified = 0
        batch_prompt = "请去除以下文本中关于服饰颜色的描述，保持其他内容不变。\n\n"
        batch_prompt += "处理规则：\n"
        batch_prompt += "1. 去除所有服饰颜色相关的描述（如：白衣、红衣、黑衣等）\n"
        batch_prompt += "2. 保持其他内容完全不变\n"
        batch_prompt += "3. 按照输入的顺序，用 [TEXT_N] 标记每段文本的输出\n\n"

        for i, (_, content, idx) in enumerate(batch):
            batch_prompt += f"[TEXT_{i}]\n{content}\n\n"

        batch_prompt += "请按照 [TEXT_0], [TEXT_1], [TEXT_2]... 的格式输出处理后的文本。"

        try:
            response = model.generate_content(batch_prompt)
            result_text = response.text.strip()

            # 解析批量结果
            results = []
            current_text = []
            current_idx = None

            for line in result_text.split('\n'):
                if line.startswith('[TEXT_'):
                    if current_idx is not None and current_text:
                        results.append('\n'.join(current_text).strip())
                        current_text = []
                    try:
                        current_idx = int(line.split('_')[1].split(']')[0])
                    except:
                        current_idx = len(results)
                else:
                    if current_idx is not None:
                        current_text.append(line)

            if current_idx is not None and current_text:
                results.append('\n'.join(current_text).strip())

            # 更新 content
            for i, (action, original_content, _) in enumerate(batch):
                if i < len(results):
                    new_content = results[i]
                    if new_content and new_content != original_content:
                        action['content'] = new_content
                        batch_modified += 1

            with lock:
                counters['modified'] += batch_modified
                counters['processed'] += len(batch)

        except Exception as e:
            print(f"  警告: 批次 {batch_idx+1} 处理失败 ({e})，回退到逐个处理...")
            with lock:
                counters['failed_batches'] += 1

            for action, original_content, idx in batch:
                try:
                    new_content = _process_single(model, action, original_content)
                    if new_content != original_content:
                        action['content'] = new_content
                        with lock:
                            counters['modified'] += 1
                except Exception:
                    pass
                finally:
                    with lock:
                        counters['processed'] += 1

        return batch_idx

    # 步骤2: 构建所有批次
    batches = []
    for batch_start in range(0, total_count, batch_size):
        batch_end = min(batch_start + batch_size, total_count)
        batches.append(content_refs[batch_start:batch_end])

    # 步骤3: 并发执行所有批次
    print(f"\n步骤2: 并发处理 {len(batches)} 个批次...")
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_process_batch, i, batch): i
            for i, batch in enumerate(batches)
        }

        for future in as_completed(futures):
            batch_idx = futures[future]
            try:
                future.result()
            except Exception as e:
                print(f"  错误: 批次 {batch_idx+1} 异常 - {e}")
            # 打印总进度
            with lock:
                pct = counters['processed'] * 100 // total_count if total_count else 100
                print(f"  总进度: {counters['processed']}/{total_count} ({pct}%) | 已修改: {counters['modified']}")

    # 步骤4: 保存处理后的剧本（保存到 workspace/）
    workspace_dir = WORKSPACE_ROOT
    os.makedirs(workspace_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    temp_path = os.path.join(workspace_dir, f'script_no_colors_{timestamp}.json')

    with open(temp_path, 'w', encoding='utf-8') as f:
        json.dump(script_data, f, ensure_ascii=False, indent=2)

    print(f"\n服饰颜色去除完成！")
    print(f"  总共处理: {total_count} 个 content 字段")
    print(f"  修改数量: {counters['modified']} 处")
    print(f"  失败批次: {counters['failed_batches']} 个（已回退逐条处理）")
    print(f"  临时文件已保存到: {temp_path}")

    return temp_path


def get_scene_image_path(scene_name, scene_config):
    """获取场景图片路径"""
    if scene_name in scene_config:
        main_path = scene_config[scene_name].get('main', '')
        if main_path:
            # 从脚本目录向上查找项目根目录
            full_path = os.path.join(OUTPUT_ROOT, main_path)
            if os.path.exists(full_path):
                return full_path
    return None







def analyze_scene_layout(scene_image_path, scene_name, ai_model=None):
    """使用 Claude subagent 分析场景的空间布局

    参数:
        scene_image_path: 场景图片路径
        scene_name: 场景名称
        ai_model: ClaudeSubagent 实例（可选，如果不提供则返回通用布局）

    返回: 场景布局描述字典
    """
    # 如果提供了AI模型且图片存在，使用AI分析
    if ai_model and scene_image_path and os.path.exists(scene_image_path):
        try:
            import PIL.Image

            # 读取图片
            image = PIL.Image.open(scene_image_path)

            # 构建分析提示词
            prompt = f"""请分析这张场景图片（{scene_name}）的空间布局，提供以下信息：

1. 空间结构描述：详细描述场景的整体布局、主要区域划分
2. 固定物体列表：列出场景中的主要固定物体（如家具、建筑元素等）
3. 关键位置：标识场景中的关键位置点（如中央、前方、后方、左侧、右侧等）

请以JSON格式输出：
{{
    "spatial_structure": "空间结构的详细描述",
    "fixed_objects": ["物体1", "物体2", "物体3"],
    "key_positions": {{
        "center": "中央位置描述",
        "front": "前方位置描述",
        "back": "后方位置描述",
        "left": "左侧位置描述",
        "right": "右侧位置描述"
    }}
}}

注意：描述要具体、准确，便于后续生成视频提示词时使用。"""

            # 调用 Claude subagent 分析场景（注意：claude -p 不支持图片输入，仅使用文本提示）
            response = ai_model.generate_content([prompt, image])
            result_text = response.text.strip()

            layout = _safe_json_loads(result_text)
            print(f"  [AI分析] 成功分析场景布局: {scene_name}")
            return layout

        except Exception as e:
            print(f"  [警告] AI分析场景布局失败 ({str(e)})，使用通用布局")
            # 失败时回退到通用布局

    # 通用场景布局（作为回退方案）
    return {
        'spatial_structure': f'{scene_name}内景，空间布局待分析',
        'fixed_objects': [],
        'key_positions': {
            'center': f'{scene_name}中央',
            'front': f'{scene_name}前方',
            'back': f'{scene_name}后方',
            'left': f'{scene_name}左侧',
            'right': f'{scene_name}右侧'
        }
    }


def build_mappings(global_config):
    """构建ID到名称的映射（兼容多种字段名格式）"""
    # 兼容 id/name 和 actor_id/actor_name 两种格式
    actors_map = {}
    for a in global_config.get('actors', []):
        actor_id = a.get('id') or a.get('actor_id')
        actor_name = a.get('name') or a.get('actor_name')
        if actor_id and actor_name:
            actors_map[actor_id] = actor_name

    locations_map = {}
    for l in global_config.get('locations', []):
        loc_id = l.get('id') or l.get('location_id')
        loc_name = l.get('name') or l.get('location_name')
        if loc_id and loc_name:
            locations_map[loc_id] = loc_name

    props_map = {}
    for p in global_config.get('props', []):
        prop_id = p.get('id') or p.get('prop_id')
        prop_name = p.get('name') or p.get('prop_name')
        if prop_id and prop_name:
            props_map[prop_id] = prop_name

    return actors_map, locations_map, props_map






def _generate_clip_shot_plan(action_parts, scene_name, time_of_day, characters,
                             previous_end_state, segment, model,
                             character_names=None, scene_name_cn=None):
    """生成 clip 级镜头规划（景别、运镜、构图策略）

    在逐 shot 生成之前，先调用 AI 规划整个 clip 的镜头策略，
    然后将规划结果作为约束传递给每个 shot 的生成。

    参数:
        action_parts: 按 → 拆分的动作片段列表
        scene_name: AI专用场景ID
        time_of_day: 时段
        characters: AI专用角色ID列表
        previous_end_state: 上一 segment 的结束状态
        segment: 当前 segment 数据（含 dialogue_map / inner_thought_map）
        model: ClaudeSubagent 实例
        character_names: 角色名称列表
        scene_name_cn: 场景中文名称

    返回:
        shot plan 列表（每个 shot 一个 dict），失败时返回 None
    """
    total_shots = len(action_parts)

    # 单 shot clip 不需要规划
    if total_shots <= 1:
        return None

    # 构建每个 shot 的对话/内心OS摘要
    shot_info_list = []
    for i, part in enumerate(action_parts):
        info = {"index": i, "action": part}
        if 'dialogue_map' in segment and i in segment['dialogue_map']:
            info["dialogue"] = [f"{d['actor_id']}（{d['emotion']}）：{d['content']}"
                                for d in segment['dialogue_map'][i]]
        if 'inner_thought_map' in segment and i in segment['inner_thought_map']:
            info["inner_thought"] = [f"{d['actor_id']}内心OS：{d['content']}"
                                     for d in segment['inner_thought_map'][i]]
        shot_info_list.append(info)

    # 构建上一镜头结束状态摘要
    prev_state_text = "无（这是第一个 clip）"
    if previous_end_state:
        prev_shot_type = previous_end_state.get('shot_type_cn', previous_end_state.get('shot_type', '未知'))
        prev_camera = previous_end_state.get('camera_movement_cn', previous_end_state.get('camera_movement', '未知'))
        prev_state_text = f"景别: {prev_shot_type}, 运镜: {prev_camera}"

    # 角色映射文本
    char_mapping = ""
    if character_names and characters:
        char_mapping = ', '.join([f'{n} = {{{c}}}' for n, c in zip(character_names, characters)])
    else:
        char_mapping = ', '.join(characters) if characters else '无'

    prompt = f"""你是奥斯卡级导演，为一个 {total_shots} 个镜头的 clip 规划镜头策略。

## 输入
- 动作序列：{json.dumps(shot_info_list, ensure_ascii=False)}
- 场景：{scene_name_cn if scene_name_cn else scene_name}，{'白天' if time_of_day == 'day' else '夜晚'}
- 角色：{char_mapping}
- 上一镜头结束状态：{prev_state_text}

## 规划原则
1. 景别递进：建立镜头（全景/大全景）→ 叙事镜头（中景/中近景）→ 情绪镜头（近景/特写）
2. 避免连续相同景别：相邻 shot 的景别应有变化
3. 对话场景：使用正反打或景别切换，不要固定一个机位
4. 情绪高潮：使用近景/特写 + 推入运镜
5. 与上一 clip 衔接：参考上一镜头结束状态的景别，首 shot 避免重复
6. 运镜多样化：推入/拉远/摇镜/跟拍/环绕交替使用

## 输出格式（严格JSON数组）
[
  {{
    "shot_index": 0,
    "shot_type": "全景",
    "camera_movement": "缓慢推入",
    "composition": "三分法构图",
    "rhythm": "建立环境",
    "reason": "首镜头建立空间关系"
  }}
]

为每个 shot（共 {total_shots} 个）生成一个规划条目。请直接输出JSON数组，不要添加其他内容。JSON字符串值中禁止使用英文双引号（"），需要引用时改用「」或『』。"""

    try:
        response = model.generate_content(prompt)

        if not response.candidates:
            print(f"[镜头规划] 内容被安全过滤器阻止，跳过规划")
            return None

        result_text = response.text.strip()

        shot_plan = _safe_json_loads(result_text)

        if not isinstance(shot_plan, list) or len(shot_plan) == 0:
            print(f"[镜头规划] 返回格式异常，跳过规划")
            return None

        print(f"[镜头规划] 成功生成 {len(shot_plan)} 个镜头的规划：")
        for sp in shot_plan:
            print(f"  Shot {sp.get('shot_index', '?')}: {sp.get('shot_type', '?')} | {sp.get('camera_movement', '?')} | {sp.get('rhythm', '?')}")

        return shot_plan

    except Exception as e:
        print(f"[镜头规划] 规划生成失败 ({str(e)})，将退回自主决策模式")
        return None


def generate_shot_description_with_ai(part, shot_index, total_shots, scene_name, time_of_day,
                                      characters, is_first_shot=False,
                                      scene_layout=None, previous_shot_end_state=None,
                                      dialogue_data=None, inner_thought_data=None, all_action_parts=None, next_action_part=None, model=None,
                                      character_names=None, scene_name_cn=None, props_for_ai=None,
                                      shot_plan_item=None, target_model: str = None):
    """使用 Claude subagent 生成详细的镜头描述

    参数:
        part: 动作内容片段
        shot_index: 当前shot在segment中的索引
        total_shots: segment中总shot数
        scene_name: 场景名称
        time_of_day: 时段（day/night）
        characters: 人物列表
        is_first_shot: 是否是第一个segment的第一个shot
        scene_layout: 场景布局信息
        previous_shot_end_state: 上一个shot的结束状态
        dialogue_data: 对话数据列表 [{'actor': '角色', 'emotion': '情绪', 'content': '内容'}]
        next_action_part: 下一个镜头的动作内容（用于连续性检查）
        model: ClaudeSubagent 实例

    返回:
        (description_cn, sound_effects, scene_layout_description, suggested_duration, character_position, shot_end_state)
    """
    if model is None:
        raise ValueError("AI模型实例是必需的，请提供model参数")

    # 计算对话总字数
    dialogue_text = ""
    dialogue_char_count = 0
    if dialogue_data:
        dialogue_text = " ".join([
            f"{{{d['actor_id']}}}（{d['emotion']}）：{d['content']}"
            for d in dialogue_data
        ])
        dialogue_char_count = sum(len(d['content']) for d in dialogue_data)

    # 构建内心OS文本
    inner_thought_text = ""
    if inner_thought_data:
        inner_thought_text = " ".join([
            f"{{{d['actor_id']}}}内心OS：{d['content']}"
            for d in inner_thought_data
        ])

    # 构建完整动作序列上下文
    action_sequence_context = ""
    if all_action_parts and len(all_action_parts) > 1:
        action_sequence_context = "\n## 完整动作序列\n"
        for idx, action in enumerate(all_action_parts):
            marker = " ← 当前镜头" if idx == shot_index else ""
            action_sequence_context += f"{idx + 1}. {action}{marker}\n"

    # 检查下一个镜头是否有人物（用于连续性检查）
    next_shot_has_character = False
    if next_action_part and characters:
        # 简单检查：如果下一个动作内容不是纯环境描述，则认为有人物
        environment_only_keywords = ['光线', '阳光', '月光', '天空', '云', '风', '雨']
        is_environment_only = all(kw not in next_action_part for kw in environment_only_keywords) or \
                             any(char_name in next_action_part for char_name in characters if char_name)
        next_shot_has_character = not is_environment_only or len(next_action_part) > 15

    # 构建连续性特殊要求
    continuity_requirement = ""
    if shot_index == 0 and next_shot_has_character:
        continuity_requirement = f"""

### 【特别重要】第一个镜头的人物连续性要求
- **当前是第一个镜头，下一个镜头将出现人物角色**
- **必须在当前镜头中建立人物的存在感**，即使当前动作内容没有明确提到人物
- 可以采用以下方式之一：
  1. 在远景或大全景中，让人物以模糊轮廓、剪影或背影的形式出现在画面中
  2. 在环境描述中，暗示人物的存在（如"床上躺着的人影"、"远处可见人物轮廓"）
  3. 通过光影效果暗示人物位置（如"光线照亮了床上熟睡的身影"）
- **禁止**生成纯环境空镜头，必须让观众感知到人物即将登场或已经存在
- 这样可以确保与下一个镜头的自然过渡，避免人物突然出现的跳跃感
"""

    # 构建镜头规划约束段落（在 prompt 之外预先构造，避免 f-string 嵌套问题）
    shot_plan_section = ""
    if shot_plan_item:
        sp_shot_type = shot_plan_item.get('shot_type', '')
        sp_camera = shot_plan_item.get('camera_movement', '')
        sp_composition = shot_plan_item.get('composition', '')
        sp_rhythm = shot_plan_item.get('rhythm', '')
        sp_reason = shot_plan_item.get('reason', '')
        shot_plan_section = f"""## 镜头规划约束（必须遵循）
本镜头在整体 clip 规划中的定位：
- 景别：{sp_shot_type}
- 运镜：{sp_camera}
- 构图：{sp_composition}
- 节奏定位：{sp_rhythm}
- 规划理由：{sp_reason}

**必须严格按照以上规划生成镜头描述**，这是导演对整个 clip 的镜头编排，不要自行更改景别和运镜方式。
"""

    # 轴线规则段落（普通字符串，保持 {act_001} 等字面量不被 f-string 解析）
    _axis_rule_section = (
        "### 4.5 轴线规则（180°法则，硬性要求）\n\n"
        "轴线（又称\"180°线\"）是连接场景中两个或多个主体的假想直线，所有镜头必须在轴线同侧拍摄，否则会造成方向感混乱。\n\n"
        "**建立轴线**：\n"
        "- 第一个镜头确定轴线后，必须在 shot_end_state.axis_line 中记录轴线的两端主体及当前摄影机所在侧\n"
        "- 例如：{act_001} 在画面左侧面朝右，{act_002} 在画面右侧面朝左 → 轴线从 {act_001} 延伸到 {act_002}，摄影机在轴线南侧\n\n"
        "**遵守轴线**：\n"
        "- 如果上一镜头 previous_shot_end_state.axis_line 已建立轴线，当前镜头的摄影机**必须**保持在轴线同侧\n"
        "- 保持同侧意味着：{act_001} 始终在画面同一边（始终在左或始终在右），方向感不变\n"
        "- **跨轴禁止**：禁止在未经过渡处理的情况下让摄影机越过轴线，导致角色左右互换\n\n"
        "**允许越轴的情形**（必须在提示词中明确描写过渡方式）：\n"
        "- 摄影机越过轴线时附带一个明确的运镜过渡：如\"镜头从 {act_001} 右侧缓缓绕行至左侧\"，观众能跟随摄影机越轴\n"
        "- 插入中性镜头（正面/俯拍/特写道具）打断连续性后重新建立轴线\n"
        "- 剧情上角色主动移动位置导致轴线改变（必须描写角色移动过程）\n\n"
        "**多人场景**：\n"
        "- 超过两人时，选取戏剧关系最强的两人连线作为主轴线\n"
        "- 第三方角色的摄影机位须在主轴线同侧\n\n"
        "**description_cn 中的体现**：\n"
        "- 每条镜头描述须在景别/运镜之后，明确标注摄影机相对轴线的方位，如\"摄影机保持在轴线南侧，{act_001} 始终居左\"\n"
        "- 若发生合理越轴，必须写明越轴的运镜方式\n"
    )

    # 解析目标模型，读取配置
    if target_model is None:
        _video_cfg = get_video_model_config()
        target_model = _video_cfg.get('active_model', 'kling_omni')
    _is_jimeng = (target_model == 'seedance2')

    # 模型专属：角色定义
    if _is_jimeng:
        _model_role_intro = (
            "你是一位精通即梦SD2.0模型的视频生成提示词专家及奥斯卡级导演。"
            "你的任务是将标准合格的剧本内容转化为一段连续、有逻辑、极具电影感的视频生成提示词。"
            "SD2.0模型对动作细节极为敏感，必须将所有动作拆解为精确的微动作链，并加入稳定词。"
        )
    else:
        _model_role_intro = (
            "你是一位精通可灵视频Omni模型的视频生成提示词专家及奥斯卡级导演。"
            "你的任务是将标准合格的剧本内容转化为一段连续、有逻辑、极具电影感的视频生成提示词。"
        )

    # 模型专属：构图规则
    if _is_jimeng:
        _composition_rule = (
            "构图方式（用大白话描述人物在画面中的位置关系，如：人物居中/人物偏左/"
            "人物偏右/人物位于画面左侧/人物位于画面右下角/两人分列画面两侧/"
            "说话者在背景听者后脑占前景/人物在画面一角大片留白等）"
        )
    else:
        _composition_rule = "构图方式（三分法/中心构图/对角线构图/引导线构图/过肩构图等经典电影构图）"

    # 模型专属：焦距/镜头描述
    if _is_jimeng:
        _focal_length_rule = "镜头感（广角镜头/长焦镜头/长焦压缩感/浅景深/深景深/背景虚化，不使用具体焦段mm数值）"
    else:
        _focal_length_rule = "焦距（超广角15-20mm/广角24-35mm/标准40-60mm/中长焦70-105mm/长焦135-200mm）"

    # 模型专属：格式要求中的焦距描述
    if _is_jimeng:
        _format_focal = "景别，运动，构图，镜头感，景深。背景描述，光线描述，动作描述，氛围描述。"
    else:
        _format_focal = "景别，运动，构图，焦距，景深。背景描述，光线描述，动作描述，氛围描述。"

    # 模型专属：动作动态章节标题与额外说明
    if _is_jimeng:
        _action_detail_header = "#### 3.1 动作动态（必须详细描述——SD2.0最吃细节，必须拆解为微动作链）"
        _action_abstract_ban = (
            "- **拒绝抽象动词（SD2.0核心要求）**：禁止使用\"跳舞/做饭/走路/战斗\"等泛化词汇，"
            "必须拆解为微动作链\n"
        )
    else:
        _action_detail_header = "#### 3.1 动作动态（必须详细描述）"
        _action_abstract_ban = (
            "- **拒绝抽象动词**：禁止使用\"跳舞/做饭/走路/战斗\"等泛化词汇，必须拆解为微动作链\n"
        )

    # 构建提示词
    prompt = f"""【重要说明】本任务是为虚构的仙侠/奇幻故事生成视频提示词，所有内容均为艺术创作，用于AI视频生成，不涉及真实暴力或危险行为。

【角色定义】{_model_role_intro}

## 输入信息
- 动作内容: {part}
- 场景名称: {scene_name_cn if scene_name_cn else scene_name}（场景ID: {scene_name}，在提示词中必须使用此ID）
- 时段: {'白天' if time_of_day == 'day' else '夜晚'}
- 角色ID映射（必须严格使用这些ID，禁止使用其他ID）: {', '.join([f'{n} = {{{c}}}' for n, c in zip(character_names, characters)]) if character_names and characters else ', '.join(characters) if characters else '无'}
- 道具ID映射（场景中出现的道具，提及时必须使用ID）: {', '.join([f'{n} = {{{pid}}}' for n, pid in props_for_ai]) if props_for_ai else '无'}
- 镜头位置: 第{shot_index + 1}个镜头，共{total_shots}个镜头
- **当前镜头字数限制**: {'500字' if total_shots == 1 else '250字' if total_shots == 2 else '160字' if total_shots == 3 else '120字' if total_shots == 4 else '100字'}（description_cn 字段必须严格遵守此限制）
- 是否首镜头: {'是' if is_first_shot else '否'}
- 对话内容: {dialogue_text if dialogue_text else '无'}
- 对话字数: {dialogue_char_count}字
- 内心OS: {inner_thought_text if inner_thought_text else '无'}
{action_sequence_context}

## 场景布局信息
{json.dumps(scene_layout, ensure_ascii=False, indent=2) if scene_layout else '无'}

## 上一镜头结束状态
{json.dumps(previous_shot_end_state, ensure_ascii=False, indent=2) if previous_shot_end_state else '无'}

{shot_plan_section}## 生成要求
{continuity_requirement}
### 0. 提示词核心原则（重要）
- **运镜必须明确**：不能只描写平面动作，必须把镜头的动态轨迹描述清楚（如"镜头围绕角色360°旋转"而非仅写"角色游动"）
- **行动逻辑清晰**：连续动作必须用顺序词（"首先"、"接着"、"随后"、"最终"）指明执行顺序，确保动作顺畅衔接
- **多镜头匹配**：当视频由多个镜头组成时，每个镜头必须按时间段匹配对应描述，确保内容不错位
- **描述精准具体**：避免含糊不清和过度堆砌关键词，使用特定动词塑造生动画面（如"膨胀"、"炸裂"、"闪烁"而非笼统的"变化"）
- **节奏紧凑，切镜适当频繁**：整体镜头节奏偏快，适当加快切镜频率。避免长时间停留在同一景别和角度，通过适当频繁的景别切换（如中景→近景→特写→过肩）和运镜变化来保持画面活力和叙事张力

### 1. 动作主体识别（重要）
- **仔细分析动作内容，准确识别动作的执行者**
- 如果动作内容没有明确主语，需要根据上一镜头的结束状态推断
- 例如："嘴角勾起一抹冷笑" - 需要判断是谁在笑，通常是上一镜头的主要角色
- 如果上一镜头聚焦在某个角色，当前动作通常延续该角色的表现
- **禁止随意更换动作主体**，确保动作连贯性

### 1.5 人称代词严格规则（硬性要求）
- **动作内容原文中出现的人称代词（她/他/其）必须原样保留，绝对禁止替换**
- 例如：原文写"她转身"，描述中必须写"她转身"，不得改为"他转身"
- 例如：原文写"他握住"，描述中必须写"他握住"，不得改为"她握住"
- 如果原文没有人称代词，根据角色ID映射中的角色名称判断性别，使用正确的人称代词
- **违反此规则视为严重错误**

### 2. 镜头描述要素
请根据动作内容和上下文，自主选择合适的：
- 景别（大全景/全景/中景/中近景/近景/特写/大特写/俯拍/仰拍）
- 镜头运动（固定镜头/缓慢推镜/平稳跟拍/轻微环绕/推入/拉远/摇镜/一镜到底）
- 稳定描述词（无抖动/丝滑流畅/平稳/匀速）——运镜描述中必须体现稳定性
- {_focal_length_rule}
- {_composition_rule}
- 画面张力技法（根据情绪和叙事需要选用）：
  - 大透视：超广角近摄，夸张透视拉伸空间，制造压迫感或宏大感
  - 前景压迫：大体量前景元素挤压视觉空间，增强紧张感
  - 汇聚线透视：走廊/建筑等线条向消失点汇聚，制造纵深张力
  - 广角畸变：超广角极近拍摄，产生夸张形变与冲击力
  - 景深张力：极浅景深 + 强虚化对比，制造视觉紧绷感
  - 透视压缩：长焦压缩前后景距离，制造密集压迫氛围
- 景深
- 光线效果（根据时段和场景氛围）
- 氛围营造

### 3. 动态变化描述（核心重点）
**这是视频生成的关键要素，必须重点描述以下动态变化过程：**

{_action_detail_header}
{_action_abstract_ban}  - ❌ 错误："女生做饭" → ✅ 正确："女生优雅翻炒，无油烟，轻撒调料，动作连贯自然"
  - ❌ 错误："他战斗" → ✅ 正确："他右脚蹬地前踏，右手横剑格挡，随即左手推掌反击，动作流畅不僵硬"
- **必须加稳定词**：每个动作描述都要包含节奏/流畅感描述，如"缓慢"、"平稳"、"流畅"、"不僵硬"、"无卡顿"、"动作自然连贯"
- **起始状态 → 过程 → 结束状态**：完整描述动作的演变过程
- **动作细节**：肢体动作的具体变化（如"手臂从下垂缓缓抬起至胸前，手指逐渐握紧成拳"）
- **动作速度**：快速/缓慢/突然/渐进等节奏变化
- **动作幅度**：大幅度挥动/微小颤抖/剧烈晃动等
- **表情变化**：动作过程中面部表情的同步变化（必须描述）
  - 眉头：舒展/紧锁/上扬/下压的变化过程
  - 眼神：凝视/闪躲/瞪大/眯起/转动的变化
  - 嘴部：抿紧/张开/微笑/咬牙/颤抖的变化
  - 整体表情：从什么表情到什么表情的过渡（如"从平静逐渐转为惊讶，眉毛上扬，眼睛瞪大，嘴巴微张"）
  - **动作与表情联动**：表情变化必须与动作协调一致（如"挥剑时面露决绝，眉头紧锁，咬紧牙关"）
- **连续动作**：如果有多个连续动作，描述它们之间的衔接和过渡，以及表情如何随动作演变
- 示例：❌ "他挥剑" → ✅ "他右手猛然从腰间拔出长剑，面部表情从平静瞬间转为凌厉，眉头紧锁，双目圆睁，剑身在空中划出一道银色弧光，动作流畅连贯，随即向前方全力劈斩而下，口中发出一声低吼"

#### 3.2 运镜动态（必须明确运动轨迹）
- **镜头运动轨迹**：从哪里到哪里，如何移动（如"镜头从远处快速推入至人物面部特写"）
- **运动速度变化**：匀速/加速/减速/突然停止
- **运动方向**：向前推进/向后拉远/左右摇移/上下升降/环绕旋转
- **景别变化**：如果景别在镜头中变化，明确描述（如"从全景快速推入至中近景"）
- 示例：❌ "推镜头" → ✅ "镜头从中景位置开始，以中等速度向前推进，逐渐聚焦到人物面部，最终定格在眼神特写"

#### 3.3 人物位置动态（必须描述空间移动，必须结合场景布局）
- **重要**：必须参考"场景布局信息"中的场景元素（如柱子、桌子、窗户、门等），描述人物与这些元素的位置关系变化
- **主要角色与次要角色**：
  - 主要角色使用 {{act_xxx}} 格式标记（如 {{act_001}}）
  - 次要角色/配角/敌人/群众等不使用花括号，直接描述（如"一条鳞甲妖魔"、"几名守卫"、"远处的行人"）
  - **必须同时描述主要角色和次要角色的位置关系**，不能只关注主要角色
- **【核心硬性要求】所有在场角色必须有位置交代**：
  - 角色ID映射中列出的所有角色，在每个镜头描述中都必须明确其位置或存在感，一个都不能遗漏
  - 即使某个角色不是当前镜头的焦点，也必须在描述中体现其位置，如"背景中{{act_002}}靠在窗边"、"画面左侧{{act_003}}静静伫立"、"{{act_002}}在远处可见"
  - **禁止让任何在场角色凭空消失**——哪怕是一句"{{act_002}}站在背景中"也必须写出来
  - 如果上一镜头结束状态（previous_shot_end_state）的 character_positions 字段有角色位置信息，当前镜头必须延续这些角色的存在，不能无故省略
- **移动轨迹**：人物从哪里移动到哪里，经过哪些场景元素（如"从房间左侧的书架旁走向窗边，再转身走向门口"）
- **移动方式**：走/跑/跳/飞/滑行/后退/侧移等具体移动方式
- **移动速度**：缓慢行走/快速奔跑/突然冲刺/逐渐减速等速度变化
- **空间关系变化**：
  - 主要角色之间的距离变化（如"两人从相距十步逐渐靠近至面对面"）
  - 主要角色与次要角色的位置关系（如"{{act_001}}与妖魔之间的距离从十米缩短至三米"）
  - 多个角色的相对位置（如"{{act_001}}站在前方，{{act_002}}在其身后，妖魔从左侧逼近"）
- **高度变化**：站起/坐下/跳跃/下蹲/倒地等垂直位置变化
- **方向转换**：转身/回头/侧身/旋转等朝向变化
- **相对位置**：与场景元素的位置关系变化，必须具体说明经过或靠近哪些场景物体（如"从柱子后走出，绕过香炉，穿过廊柱间，来到窗前"）
- **场景深度**：前景/中景/后景的位置变化（如"从画面后方走向前景"）
- 示例：❌ "他走过去" → ✅ "{{act_001}}从{{loc_001}}的中央缓步向前，绕过地面的香炉，穿过光影交错的廊柱间，而一条浑身鳞甲的妖魔从右侧阴影中冲出，两者距离迅速拉近，{{act_001}}最终停在窗边，转身面对逼近的妖魔；{{act_002}}始终立于大殿后方台阶上，冷眼旁观"
- 示例：❌ 镜头只描述{{act_001}}，完全不提{{act_002}} → ✅ "{{act_001}}走向桌边翻阅书卷；{{act_002}}静候在门旁，背对光源"

#### 3.4 情绪动态（必须描述情绪演变）
- **情绪转变过程**：从什么情绪到什么情绪（如"从平静逐渐转为愤怒"）
- **表情变化**：眉头、眼神、嘴角等面部细节的动态变化
- **情绪外化**：情绪如何通过肢体语言表现（如"双拳逐渐握紧，身体微微颤抖"）
- **情绪强度变化**：情绪的递进或衰减（如"恐惧感不断加剧"）
- 示例：❌ "他很愤怒" → ✅ "他的表情从平静逐渐变得凝重，眉头紧锁，眼中怒火渐起，最终咬紧牙关，双目圆睁，愤怒达到顶点"

#### 3.5 光影动态（必须描述光线变化）
- **光线移动**：光源的移动轨迹或光线扫过的过程（如"阳光从窗外缓缓移入室内"）
- **明暗变化**：画面亮度的渐变过程（如"从明亮逐渐转暗"）
- **光影对比**：阴影的移动和变化（如"人物从阴影中走入光明"）
- **光效变化**：光晕、光斑、反射等动态效果（如"剑身反射的光芒随着挥动而闪烁"）
- **色温变化**：如果有明显的色调变化，描述其过渡（如"从冷色调逐渐转为暖色调"）
- 示例：❌ "光线很强" → ✅ "强烈的阳光从窗外斜射而入，光束在尘埃中清晰可见，随着人物移动，光影在其身上不断变换，明暗交错"

#### 3.6 氛围动态（必须描述氛围演变）
- **氛围转变**：从什么氛围到什么氛围（如"从宁静转为紧张"）
- **氛围递进**：紧张感/压迫感/恐怖感等如何逐步加强
- **环境响应**：环境元素如何配合氛围变化（如"风声渐起，树叶开始剧烈摇晃"）
- 示例：❌ "气氛紧张" → ✅ "空气仿佛凝固，寂静中只有沉重的呼吸声，紧张感随着两人对峙而不断攀升，压迫感越来越强"

#### 3.7 综合动态描述原则
- **时间轴清晰**：按照时间顺序描述变化过程（开始 → 发展 → 高潮 → 结束）
- **因果关系**：动作引发的连锁反应（如"剑气激起尘土飞扬，光影随之剧烈晃动"）
- **多维度联动**：同时描述多个维度的动态变化，营造丰富的视觉效果
- **避免静态描述**：禁止只描述静止画面，必须体现"动"的过程

### 4. 连续性要求
- 如果有上一镜头的结束状态，当前镜头应该从该状态自然开始
- 确保镜头间的动作、情绪、位置连贯
- 特别注意角色的连续性，不要突然切换主体
- **【人物位置连续性——核心要求】**：
  - 如果上一镜头结束状态（previous_shot_end_state）的 character_positions 字段中记录了角色位置，当前镜头**必须**延续这些角色的存在感，不得让任何角色无故消失
  - 对角色ID映射中的每一个角色，每个镜头描述都必须交代其位置/状态，哪怕只是一句"背景中{{act_002}}依然站在原处"
  - 若当前镜头的动作只涉及部分角色，其余在场角色须以"背景中"/"画面一侧"/"远处可见"等方式保持存在感
- **【物体与道具状态连续性——核心要求】**：
  - 如果上一镜头结束状态（previous_shot_end_state）的 object_states 字段记录了场景中物体/道具的状态，当前镜头**必须**延续这些状态，不得让物体无故改变位置或状态
  - 例如：上一镜头中车辆已停在路口，当前镜头中车辆必须仍停在路口，不能凭空移动；上一镜头中武器被放到桌上，当前镜头中武器必须仍在桌上
  - 对每一个在上一镜头 object_states 中出现的物体，当前镜头若该物体仍在画面中，必须与上一镜头结束时的状态保持一致；若物体不在画面中，不需要强行提及，但不得与其最后已知状态产生矛盾
  - **当前镜头的动作改变了某物体的状态时**（如车辆重新启动、武器被拿走），必须在 description_cn 中明确描写这一状态转变过程，并在 shot_end_state.object_states 中更新为新状态

{_axis_rule_section}

- 根据动作内容识别产生的动效音效
- **严禁生成音乐**，只生成动作产生的动效音效
- 不包括环境底噪/氛围声（如风声、鸟鸣等）
- 常见动效音效类型：脚步声、衣物摩擦声、抓取声、碰撞声、拔剑声等
- 如果动作内容中没有明确的动作，返回空数组

### 5.5 敏感词替换规则（硬性要求，生成时必须执行）

以下词汇会触发视频平台内容审核，**生成前必须替换**，不得直接出现在 description_cn 中：

| 原词 / 原词组 | 替换为 |
|-------------|--------|
| 鲜血、血迹、血液、血水、血流、血泊、血腥 | 红色液体、红色痕迹、红色印记 |
| 血溅、血雾、血染 | 红色飞溅、红色弥漫、染红 |
| 死亡、死去、死了、已死、死状 | 消逝、倒下、失去意识、气绝 |
| 杀死、杀掉、斩杀、斩首、砍杀 | 击败、制服、压制、击倒 |
| 杀人、杀敌 | 击倒对手、击败敌人 |
| 尸体、尸骸、尸首、遗体 | 倒地的身影、失去意识的身躯 |
| 割喉、割颈、割腕 | 划过颈部、触碰手腕 |
| 爆头、穿脑 | 强力击中头部 |
| 断肢、残肢、断手、断臂、断腿 | 受创的肢体、倒地的身影 |
| 内脏、肠子、骨髓 | 生命力、内力 |
| 虐待、折磨、凌迟 | 压制、制服 |
| 自杀、轻生、寻死 | 放弃抵抗、失去意志 |
| 爆炸（写实场景）| 强烈冲击、气浪席卷 |

**替换原则**：
- 保留**动作的视觉效果和情绪张力**，只替换触发审核的具体词汇
- 替换后描述须自然通顺，不影响画面的戏剧性
- 仙侠/奇幻场景中的"仙血""灵血""魔气"等**带修饰前缀**的词可保留，但"鲜血""血腥"等写实词必须替换
- 如原文有审核风险词，替换时无需注明，直接用替代词描述即可

### 6. 格式要求
- 中文描述格式：{_format_focal}
- **角色标记规则**：
  - 主要角色使用 `{{角色ID}}` 格式，如 `{{act_001}}`、`{{act_002}}`
  - 次要角色/配角/敌人/群众等不使用花括号，直接描述，如"一条鳞甲妖魔"、"几名守卫"、"远处的行人"
  - 场景使用 `{{场景ID}}` 格式，如 `{{loc_001}}`
  - **道具标记规则**：如果输入信息中提供了道具ID映射，描述中提及该道具时必须使用 `{{道具ID}}` 格式，如 `{{prp_001}}`；道具ID映射为"无"时直接描述道具名称
- 描述要具体、生动、富有电影感
- **重要**：如果有对话内容，必须在描述的最后添加对话，格式为：{{角色ID}}（情绪）：对话内容，如{{act_001}}（平静）：我要去了
- **重要**：如果有内心OS，必须在对话之后（或无对话时在描述末尾）添加，格式为：{{角色ID}}内心OS：内容，如{{act_001}}内心OS：我真的能做到吗
- 对话应该与动作描述自然衔接，体现角色说话时的表情、口型和肢体语言
- **对话切镜规则（重要）**：当对话超过10个字时，必须在镜头描述中体现切镜效果，禁止用单一固定镜头拍完整段对话。具体要求：
  - 使用"切至"、"镜头切换到"等明确的切镜词汇来标记镜头变化
  - 多人对话时使用正反打（over-the-shoulder）交替展示说话者
  - 单人独白/长台词时，通过推拉镜头制造景别变化（如从中景缓慢推入至近景特写）
  - 示例：中景，{{act_001}}面对{{act_002}}开口说话。切至近景，{{act_001}}表情凝重，位于画面偏左。切至过肩镜头，{{act_002}}后脑占前景右侧，{{act_001}}在背景中微微点头回应。

### 7. 场景布局描述（每个segment的第一个镜头必须生成）
- **重要**：如果是第一个镜头（shot_index=0），必须生成场景布局描述
- **必须参考场景布局信息**：如果提供了"场景布局信息"，必须基于其中的场景元素（如家具、建筑元素、固定物体等）来描述人物位置
- 如果有上一镜头的结束状态，基于该状态生成当前的场景布局
- **角色描述规则**：
  - 主要角色使用 `{{角色ID}}` 格式
  - 次要角色直接描述，不使用花括号（如"一条妖魔"、"数名侍卫"）
  - 必须描述所有出现的角色，不能只描述主要角色
- 格式：场景布局：{{角色ID1}}动词在{{场景ID}}的具体位置（结合场景元素），{{角色ID2}}动词在{{场景ID}}的具体位置（结合场景元素），次要角色描述及位置。
- 示例：场景布局：{{act_001}}站在{{loc_001}}的中央香炉旁，{{act_002}}坐在{{loc_001}}的窗边石凳上，一条浑身鳞甲的妖魔蹲伏在大殿角落的阴影中。
- 动词选择：根据角色动作和位置选择合适的动词（站、坐、躺、走、跪、蹲等）
- **场景元素引用**：尽可能引用场景布局信息中提到的具体物体，让位置描述更加具体和可视化
- 如果不是第一个镜头，scene_layout_description 字段返回空字符串

### 8. 镜头时长判断（重要）
- 根据动作内容和对话长度判断合适的镜头时长
- 确保时长足够让人物完成动作，不要在动作进行中切换镜头
- 确保时长足够让对话说完（对话过程中应有切镜变化，但整体时长要覆盖完整对话）
- 考虑因素：
  - 动作的复杂度（简单动作2-3秒，复杂动作4-6秒）
  - 对话的长度（每10个字约需2秒，要留出情绪表达的时间）
  - 情绪表达的需要（情绪特写需要更长时间）
  - 镜头运动的速度（慢推需要更长时间）
- **计算公式**：
  - 基础时长 = 动作时长（2-6秒）
  - 对话时长 = 对话字数 / 10 * 2（秒）
  - 建议时长 = max(基础时长, 对话时长) + 0.5秒缓冲
- 时长范围：最少2秒，最多4秒

### 9. 字数限制（硬性要求，必须严格遵守）
**这是最重要的要求，必须在生成时就控制好字数，不能超标！**

#### 9.1 整体字数限制
- 最终生成的 complete_prompt（完整提示词）总字数**不得超过 750 字**
- complete_prompt 包含：场景布局（20-40字）+ 所有镜头描述 + 音效提示词（25字）
- 固定部分约占 50-70 字，**留给所有镜头描述的字数约 680 字左右**

#### 9.2 单个镜头字数分配
根据当前 segment 的镜头总数，合理分配每个镜头的字数：
- **1个镜头**：description_cn 不超过 **500 字**
- **2个镜头**：每个 description_cn 不超过 **250 字**
- **3个镜头**：每个 description_cn 不超过 **160 字**
- **4个镜头**：每个 description_cn 不超过 **120 字**
- **5个及以上镜头**：每个 description_cn 不超过 **100 字**

#### 9.3 精简原则
- **必须保留**：景别、运镜、动作动态、人物位置、对话内容（如有）
- **可以精简**：光影细节、氛围描述、背景细节
- **避免重复**：不要在每个镜头中重复描述相同的场景元素
- **使用简洁表达**：用词精炼，避免冗余修饰

#### 9.4 字数检查
生成 description_cn 时，请在心中计算字数，确保不超过上述限制。如果内容过长，优先删减光影和氛围描述，保留核心动作和对话。

## 输出格式
请以JSON格式输出，包含以下字段：
{{
    "description_cn": "中文镜头描述",
    "sound_effects": ["音效1", "音效2"],
    "scene_layout_description": "场景布局描述（仅第一个镜头需要，其他镜头返回空字符串）",
    "suggested_duration": 建议的镜头时长（秒，整数，范围2-4），
    "character_position": {{
        "code": "位置代码（如center/front/back）",
        "description": "位置描述",
        "keyword": "位置关键词"
    }},
    "shot_end_state": {{
        "action": "结束时的动作状态",
        "expression": "结束时的表情",
        "objects": ["画面中的物体列表"],
        "emotion": "结束时的情绪状态",
        "atmosphere": "结束时的氛围感",
        "camera_movement": "镜头运动（英文）",
        "camera_movement_cn": "镜头运动（中文）",
        "shot_type": "景别（英文）",
        "shot_type_cn": "景别（中文）",
        "character_positions": {{"{{act_xxx}}": "镜头结束时该角色在场景中的位置，如'站在桌旁'", "{{act_yyy}}": "位置描述"}},
        "object_states": {{"物体名称或道具ID（如{{prp_001}}或'黑色轿车'）": "该物体在镜头结束时的状态和位置，如'停在路口左侧，引擎熄火'、'放在桌面右角'、'悬挂在墙上'", "其他物体": "状态描述"}},
        "axis_line": {{
            "subject_a": "轴线一端的主体，如'{{act_001}}'",
            "subject_b": "轴线另一端的主体，如'{{act_002}}'或场景固定参照物",
            "camera_side": "摄影机所在侧的描述，如'南侧（{{act_001}}居左，{{act_002}}居右）'",
            "established": true
        }}
    }}
}}

请严格按照可灵3.0规范生成专业的视频提示词。"""

    # 配置安全设置（新版 API 不需要单独传递，跳过）
    try:
        response = model.generate_content(
            prompt
        )

        # 检查是否被阻止或空响应
        if not response.candidates or not response.text.strip():
            print(f"[警告] 响应为空或被安全过滤器阻止，使用备用描述继续生成")
            # 返回基于原始动作内容的简单备用描述，避免整个生成流程中断
            fallback_desc = f"中景，稳定镜头，{part}，自然光线，背景虚化。"
            if dialogue_text:
                fallback_desc += f" {dialogue_text}"
            if inner_thought_text:
                fallback_desc += f" {inner_thought_text}"
            return fallback_desc, "", "", 3, {}, {}

        result_text = response.text.strip()

        result = _safe_json_loads(result_text)

        # 提取返回值
        description_cn = result.get('description_cn', '')
        sound_effects = result.get('sound_effects', [])
        scene_layout_description = result.get('scene_layout_description', '')
        suggested_duration = result.get('suggested_duration', 3)  # 默认3秒
        character_position = result.get('character_position', {})
        shot_end_state = result.get('shot_end_state', {})

        return description_cn, sound_effects, scene_layout_description, suggested_duration, character_position, shot_end_state

    except Exception as e:
        print(f"错误: AI生成失败 ({str(e)})，使用备用描述")
        fallback_desc = f"中景，稳定镜头，{part}，自然光线，背景虚化。"
        if dialogue_text:
            fallback_desc += f" {dialogue_text}"
        if inner_thought_text:
            fallback_desc += f" {inner_thought_text}"
        return fallback_desc, [], "", 3, {}, {}


def estimate_action_duration(action_content):
    """估算action的时长（秒）

    规则：
    - 按→拆分，每个部分约3秒
    - 最少3秒，最多不限制（后续会合并控制）
    """
    parts = action_content.split('→')
    num_parts = len(parts)
    # 每个部分3秒
    duration = num_parts * 3
    return max(3, duration)


def convert_actions_to_segments(scene, actors_map):
    """将action序列转换为segments，智能合并以加快节奏

    合并规则：
    - 相邻的action会尝试合并成一个segment
    - 合并后的总时长不能超过15秒
    - 对话和内心想法附加到当前segment，并记录它们对应的action索引
    - **重要：合并只在同一个场次（scene）内进行，不会跨场合并**

    参数：
        scene: 单个场次的数据（包含location、actions等）
        actors_map: 角色ID到名称的映射

    返回：
        segments列表（该场次内的所有segments）
    """
    segments = []
    current_segment = None
    current_duration = 0
    segment_counter = 1
    action_part_index = 0  # 记录当前segment中有多少个action部分
    prefix_reserve = 0  # 第一个 segment 无需预留；后续 segment 预留 overlap+bridge 空间

    # 记录当前场次信息（用于调试和验证）
    scene_location = scene.get('location', 'Unknown')

    for action in scene['actions']:
        action_type = action['type']

        if action_type == 'action':
            action_duration = estimate_action_duration(action['content'])

            # 判断是否可以合并到当前segment
            # 注意：由于此函数只处理单个scene，所以合并自动限制在场内
            # effective_limit 为非首 segment 预留 overlap+bridge 的空间（约4s）
            effective_limit = 15 - prefix_reserve
            can_merge = (
                current_segment is not None and
                current_duration + action_duration <= effective_limit
            )

            if can_merge:
                # 合并到当前segment
                current_segment['action_content'] += ' → ' + action['content']
                current_duration += action_duration
                action_part_index += 1
            else:
                # 保存上一个segment
                if current_segment:
                    segments.append(current_segment)
                    segment_counter += 1
                    # 第一个 segment 之后，后续都预留 4s（overlap ~2s + bridge ~2s）
                    prefix_reserve = 4

                # 创建新segment
                current_segment = {
                    'clip_id': f"clip_{segment_counter:03d}",
                    'action_content': action['content'],
                    'dialogues': [],
                    'inner_thoughts': [],
                    'dialogue_map': {},  # 记录每个action部分对应的对话
                    'inner_thought_map': {},  # 记录每个action部分对应的内心想法
                    'scene_location': scene_location  # 记录场次信息
                }
                current_duration = action_duration
                action_part_index = 0

        elif action_type == 'dialogue':
            if current_segment:
                _aid = action.get('actor_id', '')
                actor_name = actors_map.get(_aid, _aid) if _aid else '旁白'
                dialogue_data = {
                    'actor': actor_name,
                    'content': action['content'],
                    'emotion': action.get('emotion', ''),
                    'actor_id': _aid
                }

                # 将对话添加到dialogues数组（保持向后兼容）
                current_segment['dialogues'].append(dialogue_data)

                # 将对话映射到对应的action部分索引
                if action_part_index not in current_segment['dialogue_map']:
                    current_segment['dialogue_map'][action_part_index] = []
                current_segment['dialogue_map'][action_part_index].append(dialogue_data)

        elif action_type == 'inner_thought':
            if current_segment:
                _aid = action.get('actor_id', '')
                actor_name = actors_map.get(_aid, _aid) if _aid else '旁白'
                inner_thought_data = {
                    'actor': actor_name,
                    'content': action['content'],
                    'actor_id': _aid
                }

                # 将内心想法添加到inner_thoughts数组（保持向后兼容）
                current_segment['inner_thoughts'].append(inner_thought_data)

                # 将内心想法映射到对应的action部分索引
                if action_part_index not in current_segment['inner_thought_map']:
                    current_segment['inner_thought_map'][action_part_index] = []
                current_segment['inner_thought_map'][action_part_index].append(inner_thought_data)

    # 添加最后一个segment
    if current_segment:
        segments.append(current_segment)

    return segments


def generate_shots_for_segment(segment, scene, actors_map, locations_map, is_first_segment=False,
                               previous_segment_prompts=None, scene_layout=None,
                               characters_with_state=None, scene_name_with_state=None,
                               characters_for_ai=None, scene_name_for_ai=None,
                               previous_segment_end_state=None, ai_model=None,
                               props_for_ai=None):
    """为segment生成shots

    参数:
        previous_segment_prompts: 上一个segment的提示词（用于连续性）
        characters_with_state: 带状态的角色列表（如 ["白行风（傻子）", "灵霜"]），用于generate_prompts
        scene_name_with_state: 带状态的场景名称（如 "灵霜寝宫（夜晚）"），用于generate_prompts
        characters_for_ai: AI专用的ID格式角色列表（如 ["{act_001}", "{act_002}"]），用于AI提示词
        scene_name_for_ai: AI专用的ID格式场景名称（如 "{loc_001}"），用于AI提示词
        previous_segment_end_state: 上一个segment的结束状态（用于生成场景布局）
        ai_model: ClaudeSubagent 实例（必需）
    """
    # 使用带状态的角色列表和场景名称（如果提供）
    if characters_with_state:
        characters = characters_with_state
    else:
        characters = [actors_map.get(c['actor_id'], c['actor_id']) for c in scene['cast']]

    # 读取目标视频模型（用于分支提示词规则）
    _active_video_model = get_video_model_config().get('active_model', 'kling_omni')

    if scene_name_with_state:
        scene_name = scene_name_with_state
    else:
        scene_name = locations_map.get(scene.get('location_id', ''), scene.get('location', scene.get('scene_id', '未知场景')))

    # 使用AI专用的ID格式（如果提供）
    if characters_for_ai:
        ai_characters = characters_for_ai
    else:
        ai_characters = characters

    if scene_name_for_ai:
        ai_scene_name = scene_name_for_ai
    else:
        ai_scene_name = scene_name

    time_of_day = scene.get('environment', {}).get('time') or scene.get('time_of_day', 'day')

    # 按→拆分动作内容
    action_parts = segment['action_content'].split('→')
    action_parts = [p.strip() for p in action_parts]

    # Clip 级镜头规划：在逐 shot 生成之前，先规划整个 clip 的镜头策略
    shot_plan = _generate_clip_shot_plan(
        action_parts=action_parts,
        scene_name=ai_scene_name,
        time_of_day=time_of_day,
        characters=ai_characters,
        previous_end_state=previous_segment_end_state,
        segment=segment,
        model=ai_model,
        character_names=characters,
        scene_name_cn=scene_name,
    )

    # 如果有上一个segment的结束状态，用它作为初始状态
    previous_shot_end_state = previous_segment_end_state if previous_segment_end_state else None

    # 收集所有镜头的音效
    all_sound_effects = []

    # 收集第一个镜头的场景布局描述
    segment_scene_layout_description = ""

    # 第一步：为所有镜头生成 v1 描述，同时流水线式并行生成 v2
    # v1 串行（依赖前一个 shot 的 end_state）；v2 串行（保持与 v1 相同的生成逻辑）
    # v1 每完成一个 shot，立即交给 v2 线程处理，两条流水线并行推进
    import queue
    import threading

    v2_queue = queue.Queue()       # v1 → v2 的数据管道
    v2_results = {}                # {shot_index: v2_desc}

    def _v2_worker():
        """v2 工作线程：按顺序消费 v1 产出的结果，串行生成 v2"""
        while True:
            item = v2_queue.get()
            if item is None:       # 哨兵值，表示 v1 全部完成
                break
            idx, desc_cn, time_range, total = item
            v2_desc = _generate_shot_variant(
                ai_model, desc_cn, time_range,
                total_shots=total, shot_index=idx,
                target_model=_active_video_model
            )
            v2_results[idx] = v2_desc

    # 启动 v2 工作线程
    v2_thread = threading.Thread(target=_v2_worker, daemon=True)
    if ai_model:
        v2_thread.start()

    shot_results = []
    total_action_parts = len(action_parts)
    for i, part in enumerate(action_parts):
        dialogue_data = None
        if 'dialogue_map' in segment and i in segment['dialogue_map']:
            dialogue_data = segment['dialogue_map'][i]

        inner_thought_data = None
        if 'inner_thought_map' in segment and i in segment['inner_thought_map']:
            inner_thought_data = segment['inner_thought_map'][i]

        # 获取下一个镜头的信息（用于连续性检查）
        next_action_part = action_parts[i + 1] if i < len(action_parts) - 1 else None

        # 获取当前 shot 的规划约束
        shot_plan_item = shot_plan[i] if shot_plan and i < len(shot_plan) else None

        desc_cn, sound_effects, shot_layout_desc, suggested_duration, char_position, shot_end_state = generate_shot_description_with_ai(
            part, i, total_action_parts, ai_scene_name, time_of_day, ai_characters,
            is_first_shot=(i == 0),
            scene_layout=scene_layout,
            previous_shot_end_state=previous_shot_end_state,
            dialogue_data=dialogue_data,
            inner_thought_data=inner_thought_data,
            all_action_parts=action_parts,
            next_action_part=next_action_part,
            model=ai_model,
            character_names=characters,  # 传入名称列表，用于构建"名称=ID"映射
            scene_name_cn=scene_name,    # 传入场景中文名称
            props_for_ai=props_for_ai,   # 传入道具ID映射
            shot_plan_item=shot_plan_item,  # 传入镜头规划约束
            target_model=_active_video_model,  # 传入目标视频模型（用于分支提示词规则）
        )

        shot_results.append({
            'part': part,
            'desc_cn': desc_cn,
            'sound_effects': sound_effects,
            'shot_layout_desc': shot_layout_desc,
            'suggested_duration': suggested_duration,
            'shot_end_state': shot_end_state,
            'dialogue_data': dialogue_data,
        })
        previous_shot_end_state = shot_end_state

        if i == 0 and shot_layout_desc:
            segment_scene_layout_description = shot_layout_desc

        # v1 完成当前 shot，立即投递给 v2 线程（不阻塞，v1 继续下一个 shot）
        if ai_model:
            v2_queue.put((i, desc_cn, '', total_action_parts))  # time_range 在第三步才确定，此处传空

    # v1 全部完成，发送哨兵值通知 v2 线程结束
    if ai_model:
        v2_queue.put(None)
        v2_thread.join()  # 等待 v2 线程处理完所有剩余任务

    # 第二步：clamp 每个镜头到 2-4 秒，然后检查总时长
    for r in shot_results:
        r['suggested_duration'] = max(2, min(4, r['suggested_duration']))

    total_suggested = sum(r['suggested_duration'] for r in shot_results)
    if total_suggested > 15:
        scale = 15 / total_suggested
        for r in shot_results:
            r['suggested_duration'] = max(2, min(4, round(r['suggested_duration'] * scale)))
        # 修正舍入误差，确保总和不超过15
        while sum(r['suggested_duration'] for r in shot_results) > 15:
            # 找最长的镜头减1秒
            longest = max(shot_results, key=lambda r: r['suggested_duration'])
            if longest['suggested_duration'] > 2:
                longest['suggested_duration'] -= 1
            else:
                break

    # 第三步：组装shots
    shots = []
    current_time = 0
    for i, r in enumerate(shot_results):
        duration = r['suggested_duration']
        start_time = current_time
        end_time = current_time + duration

        # 收集音效（去重）
        for sound in r['sound_effects']:
            if sound and sound not in all_sound_effects:
                all_sound_effects.append(sound)

        # 使用AI生成的描述（已包含对话内容）
        partial_prompt = r['desc_cn']

        shot = {
            'shot_id': f"{segment['clip_id']}-C{i+1:02d}",
            'time_range': f"{start_time}-{end_time}s",
            'partial_prompt': partial_prompt
        }

        shots.append(shot)
        current_time = end_time

    total_duration = current_time
    last_shot_end_state = shot_results[-1]['shot_end_state'] if shot_results else None

    # 第四步：将 v2 线程的结果写入 shots
    if ai_model:
        for i, shot in enumerate(shots):
            if i in v2_results:
                shot['partial_prompt_v2'] = v2_results[i]
            else:
                # v2 未产出（不应发生），回退用 v1
                shot['partial_prompt_v2'] = shot['partial_prompt']

    return shots, f"{total_duration}s", all_sound_effects, segment_scene_layout_description, last_shot_end_state



def generate_prompts(segment, shots, characters, scene_name, scene_layout_description=""):
    """生成中文prompts

    参数:
        segment: segment数据
        shots: 镜头列表
        characters: 人物列表
        scene_name: 场景名称
        scene_layout_description: AI生成的场景布局描述
    """
    # 使用AI生成的场景布局描述
    position_prefix_cn = scene_layout_description if scene_layout_description else ""

    # 中文prompts（complete_prompt 只包含场景布局 + 镜头描述）
    prompts_cn_parts = []

    # 添加位置前缀
    if position_prefix_cn:
        prompts_cn_parts.append(position_prefix_cn)

    for shot in shots:
        time_range = shot['time_range'].replace('-', '–')
        shot_desc_cn = f"{time_range}，{shot['partial_prompt']}"
        prompts_cn_parts.append(shot_desc_cn)

    prompts_cn = " ".join(prompts_cn_parts)

    return prompts_cn, position_prefix_cn


def _generate_shot_variant(ai_model, original_desc, time_range, total_shots=1, shot_index=0, max_length=500, target_model: str = None):
    """为单个 shot 独立生成 v2 版本的镜头描述。

    不是对 v1 做润色，而是基于相同的核心信息（动作、角色、场景）重新生成，
    在景别、运镜、构图、光影描写等方面产生差异化表达。

    Args:
        ai_model: ClaudeSubagent 实例
        original_desc: v1 版本的 partial_prompt
        time_range: 时间范围（如 "0-6s"）
        total_shots: segment 中总 shot 数
        shot_index: 当前 shot 索引
        max_length: 单个 shot 最大字数

    Returns:
        str: v2 版本的 partial_prompt，失败时返回 v1 原文
    """
    # 每个 shot 统一字数上限，与 shot 总数无关
    char_limit = min(200, max_length)

    # 构图示例根据模型分支
    _is_jimeng_v2 = (target_model == 'seedance2') if target_model else False
    if _is_jimeng_v2:
        _comp_example = "构图（如 v1 人物居中，v2 可换人物偏左大量留白，或说话者在背景听者后脑占前景）"
    else:
        _comp_example = "构图（如 v1 三分法构图，v2 可换对角线构图或引导线构图）"

    system_instruction = (
        "你是一位精通电影镜头语言的视频提示词专家。\n"
        "请基于以下镜头描述的核心内容（角色动作、剧情），重新生成一个差异化的镜头描述。\n\n"
        "【重新生成要求】：\n"
        "1. 必须保留所有 {act_xxx}、{loc_xxx}、{prp_xxx} 占位符，格式和数量完全不变\n"
        "2. 对话内容必须完整保留，格式为 {act_xxx}（情绪）：对话 ，位置放在描述末尾\n"
        "3. 内心OS必须完整保留，格式为 {act_xxx}内心OS：内容 ，位置放在对话之后\n"
        "4. 核心动作和剧情走向保持一致\n"
        "5. 在以下维度做出变化：\n"
        "   - 景别选择（如 v1 用中景，v2 可换近景或全景）\n"
        "   - 运镜方式（如 v1 用推入，v2 可换跟拍或环绕）\n"
        f"   - {_comp_example}\n"
        "   - 光影氛围描写的措辞和侧重点\n"
        "   - 动作细节的描写角度和用词\n"
        f"6. 字数限制：不超过 {char_limit} 字\n"
        "7. 格式：直接输出镜头描述文本，不要输出任何前缀、解释或 JSON\n"
        "8. 禁止输出换行符，所有内容在一行内\n"
    )

    try:
        response = ai_model.generate_content(
            f"{system_instruction}\n\n原始镜头描述（v1）：\n{original_desc}"
        )
        variant = response.text.strip()
        # 清理换行符
        variant = re.sub(r'\n+', ' ', variant)
        variant = re.sub(r'\s{2,}', ' ', variant)
        # 去掉可能的 markdown 代码块包裹
        variant = re.sub(r'^```[a-z]*\s*', '', variant)
        variant = re.sub(r'\s*```$', '', variant)
        # 兜底：v2 保留对话和内心OS，只清理多余空白
        variant = re.sub(r'\s{2,}', ' ', variant).strip()
        # 字数限制
        if len(variant) > char_limit:
            # 在标点处截断
            truncated = variant[:char_limit]
            last_punct = max(truncated.rfind('，'), truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
            if last_punct > char_limit * 0.5:
                variant = truncated[:last_punct + 1]
            else:
                variant = truncated
        return variant
    except Exception as e:
        print(f"  [WARN] 生成 shot v2 失败 (shot {shot_index+1}): {e}，使用 v1")
        return original_desc


def extract_conflict(segment):
    """从segment内容中提取核心冲突"""
    # 提取核心冲突
    if segment.get('dialogues'):
        conflict = '对话冲突'
    elif segment.get('inner_thoughts'):
        conflict = '内心挣扎'
    else:
        conflict = '动作展示'

    return conflict


def _build_script_source(segment):
    """构建 script_source 字段：在每个 action 部分后插入对应的对话和内心OS。

    格式示例：
    action：动作1 {act_004}（威压）：「...」 → 动作2 {act_001}（平静）：「...」 {act_001}内心OS：... → 动作3
    """
    action_content = segment.get('action_content', '')
    dialogue_map = segment.get('dialogue_map', {})
    inner_thought_map = segment.get('inner_thought_map', {})

    if not dialogue_map and not inner_thought_map:
        return f"action：{action_content}"

    parts = action_content.split(' → ')
    result_parts = []

    for i, part in enumerate(parts):
        segment_text = part

        for d in dialogue_map.get(i, []):
            actor_id = d.get('actor_id', '')
            emotion = d.get('emotion', '')
            content = d.get('content', '')
            if actor_id and content:
                emo_str = f"（{emotion}）" if emotion else ''
                segment_text += f" {{{actor_id}}}{emo_str}：{content}"

        for t in inner_thought_map.get(i, []):
            actor_id = t.get('actor_id', '')
            content = t.get('content', '')
            if actor_id and content:
                segment_text += f" {{{actor_id}}}内心OS：{content}"

        result_parts.append(segment_text)

    return f"action：{' → '.join(result_parts)}"


def generate_segment_json(segment, scene, actors_map, locations_map, props_map,
                          is_first_segment=False, previous_segment_prompts=None,
                          scene_config=None, global_config=None,
                          previous_segment_end_state=None, ai_model=None):
    """生成完整的segment JSON

    参数:
        previous_segment_prompts: 上一个segment的中文提示词（用于连续性）
        global_config: 全局配置（包含actors、locations、props的完整定义）
        ai_model: ClaudeSubagent 实例（必需）
    """
    # 获取人物列表（带状态）和ID列表（兼容 cast 和 actors 两种字段名）
    characters = []
    characters_for_ai = []  # 用于传给AI的ID格式列表
    character_ids = []
    cast_list = scene.get('cast') or scene.get('actors', [])
    for cast_member in cast_list:
        actor_id = cast_member.get('actor_id') or cast_member.get('id')
        actor_name = actors_map.get(actor_id, actor_id)
        character_ids.append(actor_id)

        # 提取状态信息并拼接到名称中
        state_id = cast_member.get('state_id')
        if state_id and global_config:
            # 从global_config中查找该角色的状态定义
            for actor in global_config.get('actors', []):
                if actor.get('actor_id') == actor_id and 'states' in actor:
                    for state in actor['states']:
                        if state.get('state_id') == state_id:
                            actor_name = f"{actor_name}（{state.get('state_name', state.get('name', ''))}）"
                            break

        characters.append(actor_name)
        # 为AI构建ID格式：{act_001}
        characters_for_ai.append(f"{{{actor_id}}}")

    # 获取场景名称（带状态）和ID（兼容多种格式）
    # 新格式：locations 是数组 [{"location_id": "loc_1", "state_id": null}]
    # 旧格式：location_id 是字符串
    if 'locations' in scene and scene['locations']:
        location_id = scene['locations'][0].get('location_id') or scene['locations'][0].get('id')
    else:
        location_id = scene.get('location_id', '')
    if not location_id:
        location_id = scene.get('scene_id', '未知场景')  # 兜底：locations为空时用scene_id
    scene_name = locations_map.get(location_id, location_id)
    # 为AI构建ID格式：{loc_001}
    scene_name_for_ai = f"{{{location_id}}}"

    # 获取道具列表（带状态）和ID列表（兼容多种格式）
    # 新格式：props 是数组 [{"prop_id": "prp_1", "state_id": null}]
    # 旧格式：prop_ids 是字符串数组
    props = []
    prop_ids = []
    if 'props' in scene and scene['props'] and isinstance(scene['props'][0], dict):
        for p in scene['props']:
            pid = p.get('prop_id') or p.get('id')
            if pid:
                prop_ids.append(pid)
                props.append(props_map.get(pid, pid))
    else:
        prop_ids = scene.get('prop_ids', [])
        for prop_id in prop_ids:
            props.append(props_map.get(prop_id, prop_id))

    # 如果是第一个segment，加载场景布局信息
    scene_layout = None
    if is_first_segment and scene_config:
        scene_image_path = get_scene_image_path(scene_name, scene_config)
        if scene_image_path:
            scene_layout = analyze_scene_layout(scene_image_path, scene_name, ai_model)

    # 生成shots（带上下文和场景布局，使用带状态的角色和场景名称）
    shots, duration, sound_effects, scene_layout_description, segment_end_state = generate_shots_for_segment(
        segment, scene, actors_map, locations_map, is_first_segment,
        previous_segment_prompts, scene_layout,
        characters_with_state=characters,  # 传入带状态的角色列表（名称格式，用于generate_prompts）
        scene_name_with_state=scene_name,   # 传入带状态的场景名称（名称格式，用于generate_prompts）
        characters_for_ai=characters_for_ai,  # 传入ID格式角色列表（用于AI提示词）
        scene_name_for_ai=scene_name_for_ai,  # 传入ID格式场景名称（用于AI提示词）
        previous_segment_end_state=previous_segment_end_state,  # 传入上一个segment的结束状态
        ai_model=ai_model,  # 传入AI模型实例（必需）
        props_for_ai=list(zip(props, prop_ids)) if props and prop_ids else []  # 传入道具(名称, ID)列表
    )

    # 生成prompts（传入人物、场景和场景布局描述）
    prompts_cn, position_prefix_cn = generate_prompts(
        segment, shots, characters, scene_name, scene_layout_description
    )

    # 根据AI生成的音效列表生成音效提示词
    if sound_effects:
        # 限制最多3个音效，避免过于复杂
        sounds_text = '、'.join(sound_effects[:3])
        sound_effects_prompt = f"音效：严禁生成音乐，仅保留{sounds_text}等动作对应的轻微动效音效。"
    else:
        sound_effects_prompt = "音效：严禁生成音乐，仅保留动作对应的轻微动效音效。"

    # 将音效提示词添加到 prompts_cn 的最后
    prompts_cn = f"{prompts_cn} {sound_effects_prompt}"

    # 重新生成 complete_prompt（只含场景布局 + 镜头描述 + 音效）
    prompts_cn_parts = []
    if position_prefix_cn:
        prompts_cn_parts.append(position_prefix_cn)

    for shot in shots:
        time_range = shot['time_range'].replace('-', '–')
        shot_desc_cn = f"{time_range}，{shot['partial_prompt']}"
        prompts_cn_parts.append(shot_desc_cn)

    prompts_cn = " ".join(prompts_cn_parts)
    prompts_cn = f"{prompts_cn} {sound_effects_prompt}"

    # 字数限制检查和压缩（complete_prompt 不超过 750 字）
    MAX_PROMPT_LENGTH = 750
    if len(prompts_cn) > MAX_PROMPT_LENGTH:
        print(f"  [警告] complete_prompt 超过 {MAX_PROMPT_LENGTH} 字（当前 {len(prompts_cn)} 字），进行压缩")
        # 前缀只含场景布局
        prefix_parts = []
        if position_prefix_cn:
            prefix_parts.append(position_prefix_cn)
        prefix_text = " ".join(prefix_parts)

        # 计算所有镜头可用的总字数
        remaining_length = MAX_PROMPT_LENGTH - len(prefix_text) - len(sound_effects_prompt) - len(shots) - 5

        # 收集所有镜头描述
        all_shot_descs = []
        for shot in shots:
            time_range = shot['time_range'].replace('-', '–')
            shot_desc_cn = f"{time_range}，{shot['partial_prompt']}"
            all_shot_descs.append(shot_desc_cn)

        total_shot_len = sum(len(d) for d in all_shot_descs)

        # 按比例压缩每个镜头，确保所有镜头都保留
        shot_descriptions = []
        for desc in all_shot_descs:
            if total_shot_len > remaining_length:
                ratio = remaining_length / total_shot_len
                allowed = max(int(len(desc) * ratio), 35)
                truncated = desc[:allowed]
                last_punct = max(truncated.rfind('，'), truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
                if last_punct > 20:
                    truncated = truncated[:last_punct + 1]
                shot_descriptions.append(truncated)
            else:
                shot_descriptions.append(desc)

        prompts_cn = " ".join(prefix_parts + shot_descriptions)
        prompts_cn = f"{prompts_cn} {sound_effects_prompt}"
        print(f"  [信息] 压缩后字数: {len(prompts_cn)} 字，保留 {len(shot_descriptions)} 个镜头")

    # 从每个 shot 的 partial_prompt_v2 组装 complete_prompt_v2
    prompts_cn_v2_parts = []
    if position_prefix_cn:
        prompts_cn_v2_parts.append(position_prefix_cn)

    for shot in shots:
        time_range = shot['time_range'].replace('-', '–')
        v2_desc = shot.get('partial_prompt_v2', shot['partial_prompt'])
        shot_desc_v2 = f"{time_range}，{v2_desc}"
        prompts_cn_v2_parts.append(shot_desc_v2)

    prompts_cn_v2 = " ".join(prompts_cn_v2_parts)
    prompts_cn_v2 = f"{prompts_cn_v2} {sound_effects_prompt}"

    # v2 字数限制检查
    if len(prompts_cn_v2) > MAX_PROMPT_LENGTH:
        print(f"  [警告] v2 complete_prompt 超过 {MAX_PROMPT_LENGTH} 字（当前 {len(prompts_cn_v2)} 字），进行压缩")
        v2_prefix_parts = []
        if position_prefix_cn:
            v2_prefix_parts.append(position_prefix_cn)
        v2_prefix_text = " ".join(v2_prefix_parts)
        v2_remaining = MAX_PROMPT_LENGTH - len(v2_prefix_text) - len(sound_effects_prompt) - len(shots) - 5
        v2_all_descs = []
        for shot in shots:
            tr = shot['time_range'].replace('-', '–')
            v2d = shot.get('partial_prompt_v2', shot['partial_prompt'])
            v2_all_descs.append(f"{tr}，{v2d}")
        v2_total_len = sum(len(d) for d in v2_all_descs)
        v2_shot_descs = []
        for desc in v2_all_descs:
            if v2_total_len > v2_remaining:
                ratio = v2_remaining / v2_total_len
                allowed = max(int(len(desc) * ratio), 35)
                truncated = desc[:allowed]
                last_punct = max(truncated.rfind('，'), truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
                if last_punct > 20:
                    truncated = truncated[:last_punct + 1]
                v2_shot_descs.append(truncated)
            else:
                v2_shot_descs.append(desc)
        prompts_cn_v2 = " ".join(v2_prefix_parts + v2_shot_descs)
        prompts_cn_v2 = f"{prompts_cn_v2} {sound_effects_prompt}"

    # 即梦 SD2.0：在 complete_prompt 开头注入稳定性固定前缀
    if get_video_model_config().get('active_model') == 'seedance2':
        prompts_cn = _JIMENG_QUALITY_PREFIX + " " + prompts_cn
        prompts_cn_v2 = _JIMENG_QUALITY_PREFIX + " " + prompts_cn_v2
    # 风格关键词前缀置于最开头（所有模型均生效）
    if _STYLE_PREFIX:
        prompts_cn = _STYLE_PREFIX + prompts_cn
        prompts_cn_v2 = _STYLE_PREFIX + prompts_cn_v2

    # 提取冲突
    conflict = extract_conflict(segment)

    # 构建 source 字段（包含对话和内心OS）
    action_content = segment.get('action_content', '')
    source_content = _build_script_source(segment)

    # 构建segment JSON
    segment_json = {
        'clip_id': segment['clip_id'],
        'source': source_content,  # 包含 action 和 dialogue 两个部分
        'expected_duration': duration,
        'characters': character_ids,  # 使用ID而不是名字
        'location': location_id,  # 使用ID而不是名字
        'layout_prompt': position_prefix_cn.rstrip('。 ') if position_prefix_cn else '',  # 人物位置关系
        'time': scene.get('environment', {}).get('time') or ('day' if scene.get('time_of_day') == 'day' else 'night'),
        'weather': '晴' if (scene.get('environment', {}).get('time') or scene.get('time_of_day')) == 'day' else '夜',
        'props': prop_ids,  # 使用ID而不是名字
        'act_rhythm': conflict,
        'shots': shots,
        'complete_prompt': prompts_cn,
        'complete_prompt_v2': prompts_cn_v2,  # 第二版本提示词
        'shot_end_state': segment_end_state,  # clip 间连续性：保存最后一个 shot 的结束状态
    }

    return segment_json, prompts_cn, segment_end_state  # 返回中文提示词和结束状态供下一个segment使用


def generate_episode_json(episode_num, script_path, output_path=None, remove_colors=True):
    """生成指定集数的JSON文件

    参数:
        episode_num: 集数
        script_path: 剧本文件路径
        output_path: 输出路径（可选）
        remove_colors: 是否自动去除服饰颜色（默认True）
    """
    # 初始化AI模型（使用 Claude subagent）
    print("正在初始化 Claude subagent...")
    ai_model = ClaudeSubagent()
    print("Claude subagent 初始化完成，将使用 Claude 生成镜头描述\n")

    # 检测角色画风，生成风格关键词前缀（运行时单例）
    global _STYLE_PREFIX
    if not _STYLE_PREFIX:
        print("正在检测角色画风...")
        _STYLE_PREFIX = detect_art_style_from_actors(ai_model)
        if _STYLE_PREFIX:
            print(f"风格关键词前缀已设置: {_STYLE_PREFIX!r}\n")
        else:
            print("未能检测到风格关键词，将不添加风格前缀\n")

    # 如果需要去除颜色，先检查是否已有 script_no_colors 文件（在 workspace/ 下）
    if remove_colors:
        workspace_dir = WORKSPACE_ROOT

        # 查找所有 script_no_colors_*.json 文件
        import glob
        no_color_files = glob.glob(os.path.join(workspace_dir, 'script_no_colors_*.json'))

        if no_color_files:
            # 如果存在，使用最新的那个
            latest_file = max(no_color_files, key=os.path.getmtime)
            print(f"找到已存在的无颜色版本剧本: {os.path.basename(latest_file)}")
            print(f"使用现有文件，跳过颜色去除步骤")
            script_path = latest_file
        else:
            # 如果不存在，生成新的
            print("未找到 script_no_colors 文件，正在生成...")
            script_path = remove_costume_colors_with_gemini(script_path)
        print()

    # 加载数据
    episode_data, global_config = load_script_data(script_path, episode_num)
    actors_map, locations_map, props_map = build_mappings(global_config)

    # 加载场景配置
    scene_config = load_scene_config()

    # 生成所有segments，按scene_id分组
    scenes_dict = {}  # {scene_id: [segments]}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    segment_count = 0

    # ── 场景级别一次性生成：_build_scene_prompt / _parse_scene_response ──

    def _build_scene_prompt(scene, segments, actors_map, locations_map, props_map, global_config, is_first_scene):
        """为整个场景构建一次性 prompt，包含所有 clip 的数据。

        返回:
            (prompt_text, meta) — meta 中包含后续 parse 需要的辅助信息
        """
        # ── 提取场景元信息 ──
        cast_list = scene.get('cast') or scene.get('actors', [])
        characters = []
        characters_for_ai = []
        character_ids = []
        for cast_member in cast_list:
            actor_id = cast_member.get('actor_id') or cast_member.get('id')
            actor_name = actors_map.get(actor_id, actor_id)
            character_ids.append(actor_id)
            state_id = cast_member.get('state_id')
            if state_id and global_config:
                for actor in global_config.get('actors', []):
                    if actor.get('actor_id') == actor_id and 'states' in actor:
                        for state in actor['states']:
                            if state.get('state_id') == state_id:
                                actor_name = f"{actor_name}（{state.get('state_name', state.get('name', ''))}）"
                                break
            characters.append(actor_name)
            characters_for_ai.append(f"{{{actor_id}}}")

        if 'locations' in scene and scene['locations']:
            location_id = scene['locations'][0].get('location_id') or scene['locations'][0].get('id')
        else:
            location_id = scene.get('location_id', '')
        if not location_id:
            location_id = scene.get('scene_id', '未知场景')
        scene_name = locations_map.get(location_id, location_id)
        scene_name_for_ai = f"{{{location_id}}}"

        props = []
        prop_ids = []
        if 'props' in scene and scene['props'] and isinstance(scene['props'][0], dict):
            for p in scene['props']:
                pid = p.get('prop_id') or p.get('id')
                if pid:
                    prop_ids.append(pid)
                    props.append(props_map.get(pid, pid))
        else:
            prop_ids = scene.get('prop_ids', [])
            for pid in prop_ids:
                props.append(props_map.get(pid, pid))

        time_of_day = scene.get('environment', {}).get('time') or scene.get('time_of_day', 'day')

        char_mapping = ', '.join([f'{n} = {{{c}}}' for n, c in zip(characters, character_ids)]) if characters else '无'
        props_mapping = ', '.join([f'{n} = {{{pid}}}' for n, pid in zip(props, prop_ids)]) if props else '无'

        # ── 构建每个 clip 的数据块 ──
        clips_section = ""
        for seg_idx, segment in enumerate(segments):
            action_parts = segment['action_content'].split('→')
            action_parts = [p.strip() for p in action_parts]
            total_shots = len(action_parts)

            clips_section += f"\n### Clip {seg_idx + 1}: {segment['clip_id']}\n"
            clips_section += f"- 动作内容: {segment['action_content']}\n"
            clips_section += f"- 按→拆分的 shot 数量: {total_shots}\n"

            # 每个 shot 的对话和内心OS
            for i, part in enumerate(action_parts):
                clips_section += f"  - Shot {i+1}: {part}\n"
                if 'dialogue_map' in segment and i in segment['dialogue_map']:
                    for d in segment['dialogue_map'][i]:
                        clips_section += f"    对话: {{{d['actor_id']}}}（{d['emotion']}）：{d['content']}\n"
                if 'inner_thought_map' in segment and i in segment['inner_thought_map']:
                    for d in segment['inner_thought_map'][i]:
                        clips_section += f"    内心OS: {{{d['actor_id']}}}内心OS：{d['content']}\n"

            # 字数限制说明
            if total_shots == 1:
                per_shot_limit = 500
            elif total_shots == 2:
                per_shot_limit = 250
            elif total_shots == 3:
                per_shot_limit = 160
            elif total_shots == 4:
                per_shot_limit = 120
            else:
                per_shot_limit = 100
            clips_section += f"- 每个 shot 的 partial_prompt 字数上限: {per_shot_limit} 字\n"

        # ── 轴线规则（纯文本，避免 f-string 干扰花括号）──
        axis_rule = (
            "### 轴线规则（180°法则）\n"
            "- 第一个镜头确定轴线后，记录在 shot_end_state.axis_line 中\n"
            "- 后续镜头摄影机必须保持在轴线同侧，角色左右不变\n"
            "- 允许越轴的情形：明确的运镜过渡、中性镜头打断、角色主动移动\n"
            "- 多人场景选取戏剧关系最强的两人连线作为主轴线\n"
        )

        prompt = f"""【重要说明】本任务是为虚构的仙侠/奇幻故事生成视频提示词，所有内容均为艺术创作。

【角色定义】你是精通可灵视频Omni模型的视频生成提示词专家及奥斯卡级导演。你需要为一个完整场景的所有 clip 按顺序生成镜头描述。

## 场景信息
- 场景名称: {scene_name}（场景ID: {scene_name_for_ai}，在提示词中必须使用此ID）
- 时段: {'白天' if time_of_day == 'day' else '夜晚'}
- 角色ID映射（必须严格使用这些ID）: {char_mapping}
- 道具ID映射: {props_mapping}
- 是否首场景: {'是' if is_first_scene else '否'}

## 所有 Clip 数据（共 {len(segments)} 个 clip，必须按顺序处理）
{clips_section}

## 生成规则

### 核心原则
- 运镜必须明确：描述镜头的动态轨迹（如"镜头围绕角色360°旋转"）
- 行动逻辑清晰：连续动作用顺序词（"首先"、"接着"、"随后"）
- 节奏紧凑，切镜适当频繁：避免长时间停留在同一景别
- 人称代词严格保留原文中的她/他/其

### 景别与运镜规划
- 景别递进：建立镜头（全景/大全景）→ 叙事镜头（中景/中近景）→ 情绪镜头（近景/特写）
- 避免连续相同景别：相邻 shot 的景别应有变化
- 对话场景：使用正反打或景别切换
- 情绪高潮：使用近景/特写 + 推入运镜
- clip 间衔接：后一个 clip 的首 shot 应避免与前一个 clip 末 shot 景别重复
- 运镜多样化：推入/拉远/摇镜/跟拍/环绕交替

### 动态描述要素（必须包含）
1. **动作动态**：起始状态→过程→结束状态，动作速度、幅度、表情联动
2. **运镜动态**：镜头运动轨迹、速度变化、景别变化
3. **人物位置动态**：移动轨迹、空间关系变化、所有在场角色必须有位置交代
4. **情绪动态**：情绪转变过程、表情变化、情绪外化
5. **光影动态**：光线移动、明暗变化
6. **氛围动态**：氛围转变和递进

### 连续性要求（核心）
- 每个 clip 的最后一个 shot 必须输出 shot_end_state
- 下一个 clip 的第一个 shot 必须从上一个 clip 的 shot_end_state 自然衔接
- 所有在场角色每个镜头都必须有位置交代，禁止凭空消失
- 物体/道具状态必须延续

{axis_rule}

### 角色标记规则
- 主要角色: {{角色ID}} 格式（如 {{act_001}}）
- 次要角色/群众: 直接描述，不使用花括号
- 场景: {{场景ID}} 格式
- 道具: {{道具ID}} 格式（如 {{prp_001}}）

### 对话与内心OS
- 对话格式: {{角色ID}}（情绪）：对话内容，放在描述末尾
- 内心OS格式: {{角色ID}}内心OS：内容，放在对话之后
- 对话超过10字时必须体现切镜

### 场景布局描述
- 每个 clip 的第一个 shot（shot_index=0）必须生成 scene_layout_description
- 格式：场景布局：{{角色ID}}动词在{{场景ID}}的位置...

### 镜头时长
- 每个 shot 时长 2-4 秒
- 每个 clip 总时长不超过 15 秒

### 字数限制（硬性）
- 最终每个 clip 的 complete_prompt（场景布局+所有shot描述+音效）不超过 750 字
- 单个 shot 的 partial_prompt 字数按 clip 的 shot 数分配（见各 clip 说明）

### 音效
- 只生成动作产生的动效音效，严禁生成音乐
- 不包括环境底噪（风声、鸟鸣等）

## 输出格式（严格JSON数组）

请输出一个 JSON 数组，每个元素对应一个 clip，按输入顺序排列：

```json
[
  {{
    "clip_id": "clip的ID",
    "scene_layout_description": "场景布局描述（每个clip的首shot都必须填写，描述该clip开始时所有人物的初始位置关系）",
    "shots": [
      {{
        "shot_index": 0,
        "partial_prompt": "v1 镜头描述（中文，包含景别、运镜、动作、对话等）",
        "partial_prompt_v2": "v2 镜头描述（差异化版本：不同景别/运镜/构图，对话和内心OS完整保留）",
        "duration": 3,
        "sound_effects": ["音效1"],
        "scene_layout_description": "场景布局描述（每个clip的首shot都必须填写，描述该clip开始时所有人物的初始位置关系；其他shot返回空字符串）",
        "shot_end_state": {{
          "action": "结束时动作状态",
          "expression": "结束时表情",
          "objects": ["画面中物体"],
          "emotion": "结束时情绪",
          "atmosphere": "结束时氛围",
          "camera_movement": "运镜(英文)",
          "camera_movement_cn": "运镜(中文)",
          "shot_type": "景别(英文)",
          "shot_type_cn": "景别(中文)",
          "character_positions": {{"act_xxx": "位置描述"}},
          "object_states": {{"物体": "状态描述"}},
          "axis_line": {{
            "subject_a": "轴线一端",
            "subject_b": "轴线另一端",
            "camera_side": "摄影机所在侧",
            "established": true
          }}
        }}
      }}
    ]
  }}
]
```

**关键**：
1. 必须为每个 clip 输出所有 shot（按→拆分的数量）
2. clip 间的连续性由你内部处理：前一个 clip 最后的 shot_end_state 作为下一个 clip 首 shot 的上下文
3. partial_prompt_v2 是差异化版本，景别/运镜/构图不同，但核心动作、对话和内心OS与 v1 完全一致
4. JSON字符串值中禁止使用英文双引号（"），需要引用时改用「」或『』，禁止在字符串内换行
5. 请直接输出JSON数组，不要添加其他内容或 markdown 代码块标记"""

        meta = {
            'characters': characters,
            'character_ids': character_ids,
            'characters_for_ai': characters_for_ai,
            'location_id': location_id,
            'scene_name': scene_name,
            'scene_name_for_ai': scene_name_for_ai,
            'props': props,
            'prop_ids': prop_ids,
            'time_of_day': time_of_day,
        }

        return prompt, meta

    def _parse_scene_response(response_text, segments, scene, meta, global_config):
        """解析 Claude 返回的场景级 JSON，转换为现有 segment_json 格式列表。

        返回:
            scene_segments: list of segment_json dicts
        """
        clips_data = _safe_json_loads(response_text)
        if not isinstance(clips_data, list):
            raise ValueError(f"期望 JSON 数组，实际: {type(clips_data)}")

        characters = meta['characters']
        character_ids = meta['character_ids']
        location_id = meta['location_id']
        scene_name = meta['scene_name']
        prop_ids = meta['prop_ids']
        time_of_day = meta['time_of_day']

        MAX_PROMPT_LENGTH = 750
        scene_segments = []

        for clip_idx, clip_data in enumerate(clips_data):
            if clip_idx >= len(segments):
                print(f"  [警告] Claude 返回了多余的 clip（{clip_idx+1}），忽略")
                break

            segment = segments[clip_idx]
            ai_shots = clip_data.get('shots', [])

            # ── 组装 shots 列表 ──
            shots = []
            all_sound_effects = []
            segment_scene_layout_description = ""
            last_shot_end_state = None
            current_time = 0

            for shot_data in ai_shots:
                duration = max(2, min(4, shot_data.get('duration', 3)))
                start_time = current_time
                end_time = current_time + duration

                partial_prompt = shot_data.get('partial_prompt', '')
                partial_prompt_v2 = shot_data.get('partial_prompt_v2', partial_prompt)
                # v2 保留对话和内心OS
                partial_prompt_v2 = re.sub(r'\s{2,}', ' ', partial_prompt_v2).strip()

                sound_effects = shot_data.get('sound_effects', [])
                for s in sound_effects:
                    if s and s not in all_sound_effects:
                        all_sound_effects.append(s)

                shot_layout = shot_data.get('scene_layout_description', '')
                if shot_data.get('shot_index', 0) == 0 and shot_layout:
                    segment_scene_layout_description = shot_layout

                # 也检查 clip 级的 scene_layout_description
                if not segment_scene_layout_description and clip_data.get('scene_layout_description'):
                    segment_scene_layout_description = clip_data['scene_layout_description']

                last_shot_end_state = shot_data.get('shot_end_state', {})

                shot = {
                    'shot_id': f"{segment['clip_id']}-C{len(shots)+1:02d}",
                    'time_range': f"{start_time}-{end_time}s",
                    'partial_prompt': partial_prompt,
                    'partial_prompt_v2': partial_prompt_v2,
                }
                shots.append(shot)
                current_time = end_time

            # ── Clamp 总时长到 15s ──
            total_suggested = sum(max(2, min(4, s.get('duration', 3))) for s in ai_shots)
            if total_suggested > 15:
                # 缩放后修正舍入误差，确保总和不超过 15s
                scale = 15.0 / total_suggested
                durations = [max(2, min(4, round(max(2, min(4, ai_shots[i].get('duration', 3))) * scale))) for i in range(len(shots))]
                while sum(durations) > 15:
                    longest_idx = max(range(len(durations)), key=lambda i: durations[i])
                    if durations[longest_idx] > 2:
                        durations[longest_idx] -= 1
                    else:
                        break
                current_time = 0
                for i, shot in enumerate(shots):
                    dur = durations[i]
                    shot['time_range'] = f"{current_time}-{current_time + dur}s"
                    current_time += dur

            total_duration = current_time

            # ── 组装 complete_prompt (v1) ──
            position_prefix = segment_scene_layout_description
            prompts_parts = []
            if position_prefix:
                prompts_parts.append(position_prefix)
            for shot in shots:
                tr = shot['time_range'].replace('-', '–')
                prompts_parts.append(f"{tr}，{shot['partial_prompt']}")

            # 音效提示词
            if all_sound_effects:
                sounds_text = '、'.join(all_sound_effects[:3])
                sfx_prompt = f"音效：严禁生成音乐，仅保留{sounds_text}等动作对应的轻微动效音效。"
            else:
                sfx_prompt = "音效：严禁生成音乐，仅保留动作对应的轻微动效音效。"

            prompts_cn = " ".join(prompts_parts) + " " + sfx_prompt

            # ── 750 字压缩（v1）──
            if len(prompts_cn) > MAX_PROMPT_LENGTH:
                print(f"  [警告] clip {segment['clip_id']} complete_prompt {len(prompts_cn)} 字 > {MAX_PROMPT_LENGTH}，压缩中")
                prefix_parts = [position_prefix] if position_prefix else []
                prefix_len = len(" ".join(prefix_parts)) if prefix_parts else 0
                remaining = MAX_PROMPT_LENGTH - prefix_len - len(sfx_prompt) - len(shots) - 5
                all_descs = []
                for shot in shots:
                    tr = shot['time_range'].replace('-', '–')
                    all_descs.append(f"{tr}，{shot['partial_prompt']}")
                total_len = sum(len(d) for d in all_descs)
                compressed = []
                for desc in all_descs:
                    if total_len > remaining:
                        ratio = remaining / total_len
                        allowed = max(int(len(desc) * ratio), 35)
                        truncated = desc[:allowed]
                        last_punct = max(truncated.rfind('，'), truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
                        if last_punct > 20:
                            truncated = truncated[:last_punct + 1]
                        compressed.append(truncated)
                    else:
                        compressed.append(desc)
                prompts_cn = " ".join(prefix_parts + compressed) + " " + sfx_prompt

            # ── 组装 complete_prompt_v2 ──
            v2_parts = []
            if position_prefix:
                v2_parts.append(position_prefix)
            for shot in shots:
                tr = shot['time_range'].replace('-', '–')
                v2_parts.append(f"{tr}，{shot['partial_prompt_v2']}")
            prompts_cn_v2 = " ".join(v2_parts) + " " + sfx_prompt

            # v2 压缩
            if len(prompts_cn_v2) > MAX_PROMPT_LENGTH:
                v2_prefix_parts = [position_prefix] if position_prefix else []
                v2_prefix_len = len(" ".join(v2_prefix_parts)) if v2_prefix_parts else 0
                v2_remaining = MAX_PROMPT_LENGTH - v2_prefix_len - len(sfx_prompt) - len(shots) - 5
                v2_all_descs = []
                for shot in shots:
                    tr = shot['time_range'].replace('-', '–')
                    v2_all_descs.append(f"{tr}，{shot['partial_prompt_v2']}")
                v2_total_len = sum(len(d) for d in v2_all_descs)
                v2_compressed = []
                for desc in v2_all_descs:
                    if v2_total_len > v2_remaining:
                        ratio = v2_remaining / v2_total_len
                        allowed = max(int(len(desc) * ratio), 35)
                        truncated = desc[:allowed]
                        last_punct = max(truncated.rfind('，'), truncated.rfind('。'), truncated.rfind('！'), truncated.rfind('？'))
                        if last_punct > 20:
                            truncated = truncated[:last_punct + 1]
                        v2_compressed.append(truncated)
                    else:
                        v2_compressed.append(desc)
                prompts_cn_v2 = " ".join(v2_prefix_parts + v2_compressed) + " " + sfx_prompt

            # 即梦 SD2.0：在 complete_prompt 开头注入稳定性固定前缀
            if get_video_model_config().get('active_model') == 'seedance2':
                prompts_cn = _JIMENG_QUALITY_PREFIX + " " + prompts_cn
                prompts_cn_v2 = _JIMENG_QUALITY_PREFIX + " " + prompts_cn_v2
            # 风格关键词前缀置于最开头（所有模型均生效）
            if _STYLE_PREFIX:
                prompts_cn = _STYLE_PREFIX + prompts_cn
                prompts_cn_v2 = _STYLE_PREFIX + prompts_cn_v2

            # ── 构建 segment_json ──
            conflict = extract_conflict(segment)
            action_content = segment.get('action_content', '')

            segment_json = {
                'clip_id': segment['clip_id'],
                'source': _build_script_source(segment),
                'expected_duration': f"{total_duration}s",
                'characters': character_ids,
                'location': location_id,
                'layout_prompt': position_prefix.rstrip('。 ') if position_prefix else '',
                'time': time_of_day,
                'weather': '晴' if time_of_day == 'day' else '夜',
                'props': prop_ids,
                'act_rhythm': conflict,
                'shots': shots,
                'complete_prompt': prompts_cn,
                'complete_prompt_v2': prompts_cn_v2,
                'shot_end_state': last_shot_end_state,
            }
            scene_segments.append(segment_json)

        # 如果 Claude 返回的 clip 数少于 segments 数，用 fallback 处理剩余的
        if len(clips_data) < len(segments):
            print(f"  [警告] Claude 只返回了 {len(clips_data)} 个 clip，但有 {len(segments)} 个 segment，剩余用 fallback")
            for i in range(len(clips_data), len(segments)):
                segment = segments[i]
                action_parts = segment['action_content'].split('→')
                fallback_shots = []
                current_t = 0
                for j, part in enumerate(action_parts):
                    dur = 3
                    fallback_shots.append({
                        'shot_id': f"{segment['clip_id']}-C{j+1:02d}",
                        'time_range': f"{current_t}-{current_t+dur}s",
                        'partial_prompt': f"中景，稳定镜头，{part}，自然光线。",
                        'partial_prompt_v2': f"近景，跟拍镜头，{part}，柔和光线。",
                    })
                    current_t += dur
                fallback_full = " ".join([f"{s['time_range'].replace('-','–')}，{s['partial_prompt']}" for s in fallback_shots])
                fallback_full += " 音效：严禁生成音乐，仅保留动作对应的轻微动效音效。"
                # 注入即梦稳定性前缀和风格前缀
                if get_video_model_config().get('active_model') == 'seedance2':
                    fallback_full = _JIMENG_QUALITY_PREFIX + " " + fallback_full
                if _STYLE_PREFIX:
                    fallback_full = _STYLE_PREFIX + fallback_full
                scene_segments.append({
                    'clip_id': segment['clip_id'],
                    'source': _build_script_source(segment),
                    'expected_duration': f"{current_t}s",
                    'characters': character_ids,
                    'location': location_id,
                    'layout_prompt': '',
                    'time': time_of_day,
                    'weather': '晴' if time_of_day == 'day' else '夜',
                    'props': prop_ids,
                    'act_rhythm': extract_conflict(segment),
                    'shots': fallback_shots,
                    'complete_prompt': fallback_full,
                    'complete_prompt_v2': fallback_full,
                    'shot_end_state': {},
                })

        return scene_segments

    # 定义处理单个scene的函数
    def process_scene(scene_index, scene, is_first_scene):
        """处理单个scene：一次性调用 Claude 生成所有 clip 的镜头描述"""
        # 兼容多种 scene_id 格式
        scene_id = scene.get('scene_id') or scene.get('scene_number') or f'SC{scene_index+1:02d}'
        segments = convert_actions_to_segments(scene, actors_map)

        if not segments:
            return scene_id, [], 0

        # 构建场景级 prompt
        prompt, meta = _build_scene_prompt(
            scene, segments, actors_map, locations_map, props_map,
            global_config, is_first_scene
        )

        # 一次调用 Claude
        print(f"  [{scene_id}] 发送场景级 prompt（{len(segments)} clips）...")
        model = ClaudeSubagent()
        try:
            response = model.generate_content(prompt)
            if not response.candidates:
                raise RuntimeError("内容被安全过滤器阻止")
            scene_segments = _parse_scene_response(
                response.text, segments, scene, meta, global_config
            )
            print(f"  [{scene_id}] 解析完成，生成 {len(scene_segments)} 个 clip")
        except Exception as e:
            print(f"  [{scene_id}] 场景级生成失败 ({e})，回退到逐 clip 串行模式")
            # 回退：使用原有的 per-clip 串行方式
            scene_segments = []
            previous_prompts = None
            previous_end_state = None
            for seg_index, segment in enumerate(segments):
                is_first = is_first_scene and (seg_index == 0)
                segment_json, current_prompts, current_end_state = generate_segment_json(
                    segment, scene, actors_map, locations_map, props_map, is_first,
                    previous_prompts, scene_config, global_config,
                    previous_end_state, ai_model
                )
                scene_segments.append(segment_json)
                previous_prompts = current_prompts
                previous_end_state = current_end_state

        return scene_id, scene_segments, len(segments)

    # 使用线程池并行处理不同的scenes
    total_scenes = len(episode_data['scenes'])
    print(f"\n开始并行生成 {total_scenes} 个场景...")
    max_workers = min(8, total_scenes)  # 最多8个并行线程

    # 准备进度文件路径（放在 workspace/ep{NNN}/ 下，避免多集并行时互相覆盖）
    ep_workspace_dir = os.path.join(PROJECT_ROOT, 'workspace', f'ep{episode_num:03d}')
    os.makedirs(ep_workspace_dir, exist_ok=True)
    progress_file = os.path.join(ep_workspace_dir, 'progress.json')

    # 记录开始时间
    start_time = time.time()

    # 初始化进度信息
    def update_progress(status, current, total, scenes_info, message='', error=''):
        elapsed_time = time.time() - start_time
        progress_data = {
            'status': status,
            'current': current,
            'total': total,
            'scenes': scenes_info,
            'message': message,
            'error': error,
            'timestamp': time.time(),
            'start_time': start_time,
            'elapsed_seconds': int(elapsed_time)
        }
        try:
            with open(progress_file, 'w', encoding='utf-8') as f:
                json.dump(progress_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"警告: 无法写入进度文件: {e}")

    # 初始化场景信息
    scenes_info = [
        {'scene_id': scene.get('scene_id', f'SC{idx+1:02d}'), 'status': 'pending', 'segments': 0}
        for idx, scene in enumerate(episode_data['scenes'])
    ]
    update_progress('running', 0, total_scenes, scenes_info, '开始生成场景...')

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 提交所有scene处理任务
        future_to_scene = {
            executor.submit(process_scene, idx, scene, idx == 0): idx
            for idx, scene in enumerate(episode_data['scenes'])
        }

        # 使用 tqdm 显示进度条（使用ASCII字符避免乱码）
        completed_count = 0
        with tqdm(total=total_scenes, desc="Generating", unit="scene",
                  ncols=80, dynamic_ncols=False, mininterval=0.5,
                  file=sys.stdout, disable=False, ascii=True) as pbar:
            # 收集结果
            for future in as_completed(future_to_scene):
                scene_idx = future_to_scene[future]
                try:
                    scene_id, scene_segments, seg_count = future.result()
                    scenes_dict[scene_id] = scene_segments
                    segment_count += seg_count
                    completed_count += 1

                    # 更新场景状态
                    for scene_info in scenes_info:
                        if scene_info['scene_id'] == scene_id:
                            scene_info['status'] = 'completed'
                            scene_info['segments'] = seg_count
                            break

                    # 更新进度文件
                    update_progress('running', completed_count, total_scenes, scenes_info,
                                  f'正在处理第 {completed_count}/{total_scenes} 个场景')

                    # 更新进度条
                    pbar.set_postfix_str(f"{scene_id} ({seg_count})")
                    pbar.update(1)

                    # 同时输出文本信息（用于后台运行时查看）
                    print(f"  [{completed_count}/{total_scenes}] {scene_id} done ({seg_count} segs)", flush=True)
                except Exception as e:
                    print(f"  [ERROR] scene failed: {str(e)}", flush=True)
                    update_progress('error', completed_count, total_scenes, scenes_info,
                                  error=str(e))
                    raise

        print(f"\n所有场景生成完成！共 {total_scenes} 个场景，{segment_count} 个segments")
        # 更新为完成状态
        update_progress('completed', total_scenes, total_scenes, scenes_info,
                       f'生成完成！共 {segment_count} 个segments')

    # 构建最终JSON，按scene_id分组
    scenes_list = []
    for scene_id in sorted(scenes_dict.keys()):
        scenes_list.append({
            'scene_id': scene_id,
            'clips': scenes_dict[scene_id]
        })

    output_json = {
        'drama': global_config.get('title', ''),
        'episode': episode_num,
        'title': episode_data.get('title', ''),
        'scenes': scenes_list
    }

    # 确定输出路径
    if not output_path:
        # 使用 PROJECT_ROOT 下的 output 目录
        output_dir = os.path.join(OUTPUT_ROOT, f'ep{episode_num:03d}')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f'ep{episode_num:03d}_storyboard.json')

    # 清理不需要的字段并转换格式
    for scene in output_json['scenes']:
        for segment in scene['clips']:
            # 转换 clip_id: 大写改小写，- 改 _
            old_id = segment['clip_id']
            new_id = old_id.lower().replace('-', '_')
            segment['clip_id'] = new_id

            # 处理 shots - 每个 segment 内部独立编号
            if 'shots' in segment:
                shot_counter = 1  # 每个 segment 重置计数器
                for shot in segment['shots']:
                    # 使用 segment 内部递增编号替换 shot_id（三位数字格式）
                    if 'shot_id' in shot:
                        shot['shot_id'] = f'shot_{shot_counter:03d}'
                        shot_counter += 1

                    # 删除 description 字段
                    if 'description' in shot:
                        del shot['description']

    # 直接生成 storyboard 格式（跳过 shots.json）
    apply_clip_continuity(output_json)  # clip 间连续性后处理
    storyboard_data = convert_to_storyboard_format(output_json, global_config)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(storyboard_data, f, ensure_ascii=False, indent=2)

    # 返回 output_path 和 output_json（用于验证）
    return output_path, segment_count, output_json, global_config


# ── Clip 间连续性：复制末尾 shot + 桥接描述 ─────────────────────


def build_bridge_description(prev_end_state, max_chars=80):
    """根据前 clip 的 shot_end_state，生成同场景内的纯视觉桥接描述。

    返回不超过 max_chars 的中文描述，前置到下一个 clip 第一个原始 shot 的 prompt 中。
    """
    if not prev_end_state:
        return ''

    shot_type_cn = prev_end_state.get('shot_type_cn', '中景')
    atmosphere = prev_end_state.get('atmosphere', '')

    # 提取角色位置摘要
    char_positions = prev_end_state.get('character_positions', {})
    first_char = ''
    first_action = ''
    if char_positions:
        first_char = list(char_positions.keys())[0]
        first_action = list(char_positions.values())[0]

    char_part = f"{{{first_char}}}" if first_char else '角色'
    action_part = first_action[:8] if first_action else '动作'
    desc = f"延续前景，{shot_type_cn}，{char_part}保持{action_part}姿态，{atmosphere}，"

    # 截断到 max_chars
    if len(desc) > max_chars:
        desc = desc[:max_chars - 1] + '，'
    return desc


def _offset_time_range(time_range_str, offset):
    """将 time_range 如 '0-4s' 偏移 offset 秒，返回新字符串。"""
    m = re.match(r'([\d.]+)\s*[-–]\s*([\d.]+)\s*s?', time_range_str)
    if not m:
        return time_range_str
    start = float(m.group(1)) + offset
    end = float(m.group(2)) + offset
    return f"{start:.1f}-{end:.1f}s".replace('.0', '')


def _parse_time_range_duration(time_range_str):
    """从 time_range 如 '3-7s' 解析出时长（秒）。"""
    m = re.match(r'([\d.]+)\s*[-–]\s*([\d.]+)\s*s?', time_range_str)
    if not m:
        return 0
    return float(m.group(2)) - float(m.group(1))


def _parse_duration(duration_str):
    """解析 '8s' 或 '12' 为浮点数秒。"""
    if isinstance(duration_str, (int, float)):
        return float(duration_str)
    m = re.match(r'([\d.]+)', str(duration_str))
    return float(m.group(1)) if m else 10.0


def _create_overflow_clip(source_clip, overflow_shots, clip_index):
    """基于溢出的 shots 创建新 clip，插入到原 clip 之后。

    参数：
        source_clip: 原始 clip（溢出 shots 来自此 clip）
        overflow_shots: 被推出的 shot 列表
        clip_index: 原 clip 在 clips 数组中的索引（用于生成 clip_id）

    返回：
        新的 clip dict
    """
    # 重新计算 time_range，从 0 开始
    offset_to_remove = 0
    first_shot_tr = overflow_shots[0].get('time_range', '0-3s')
    m = re.match(r'([\d.]+)\s*[-–]\s*([\d.]+)\s*s?', first_shot_tr)
    if m:
        offset_to_remove = float(m.group(1))

    total_dur = 0
    for shot in overflow_shots:
        tr = shot.get('time_range', '0-3s')
        m = re.match(r'([\d.]+)\s*[-–]\s*([\d.]+)\s*s?', tr)
        if m:
            start = float(m.group(1)) - offset_to_remove
            end = float(m.group(2)) - offset_to_remove
            shot['time_range'] = f"{start:.1f}-{end:.1f}s".replace('.0', '')
            total_dur = end  # 最后一个 shot 的 end 即为总时长
        else:
            dur = _parse_time_range_duration(tr)
            shot['time_range'] = f"{total_dur}-{total_dur + dur}s"
            total_dur += dur

    # 生成 clip_id：在原 clip_id 后追加 _ovf
    source_clip_id = source_clip.get('clip_id', f'clip_{clip_index:03d}')
    new_clip_id = f"{source_clip_id}_ovf"

    new_clip = {
        'clip_id': new_clip_id,
        'expected_duration': f"{total_dur}s",
        'shots': overflow_shots,
        'scene_location': source_clip.get('scene_location', ''),
        'script_source': source_clip.get('script_source', ''),
        'layout_prompt': '',
    }

    # 复制场景相关的结构化字段
    for key in ('actors', 'locations', 'props', 'environment',
                'layout_prompt', 'sfx_prompt', 'shot_end_state',
                'source', 'characters', 'location', 'time', 'weather',
                'act_rhythm'):
        if key in source_clip:
            new_clip[key] = source_clip[key]

    # 重组 complete_prompt
    _rebuild_complete_prompt(new_clip)

    return new_clip


def apply_clip_continuity(output_json):
    """后处理主函数：将前 clip 的最后一个 shot 复制到下一个 clip 的 shots 开头。

    仅处理同 scene 内的相邻 clip，跨 scene 不处理。
    直接修改 output_json（in-place），不返回新对象。

    示例：clip1=[shot1,shot2,shot3,shot4], clip2=[shot5,shot6,shot7]
    处理后：clip1 不变, clip2=[shot4(复制),shot5,shot6,shot7]
    """
    from config_loader import get_continuity_config

    config = get_continuity_config()
    if not config.get('enabled', True):
        return

    # 按 scene 遍历，只处理同 scene 内相邻 clip
    for scene in output_json.get('scenes', []):
        clips = scene.get('clips', [])
        if len(clips) < 2:
            continue

        i = 1
        while i < len(clips):
            prev_clip = clips[i - 1]
            curr_clip = clips[i]

            prev_shots = prev_clip.get('shots', [])
            curr_shots = curr_clip.get('shots', [])
            if not prev_shots or not curr_shots:
                i += 1
                continue

            # 复制前 clip 的最后一个 shot
            last_shot = prev_shots[-1]
            overlap_shot = {
                'shot_id': 'overlap',
                'time_range': last_shot.get('time_range', '0-2s'),
                'partial_prompt': last_shot.get('partial_prompt', ''),
                'partial_prompt_v2': last_shot.get('partial_prompt_v2', last_shot.get('partial_prompt', '')),
                'is_overlap': True,
            }

            # 计算 overlap shot 的时长，重设 time_range 从 0 开始
            overlap_dur = _parse_time_range_duration(last_shot.get('time_range', '0-2s'))
            if overlap_dur <= 0:
                overlap_dur = 2.0
            overlap_shot['time_range'] = f"0-{overlap_dur}s"

            # 注入元数据（bridge_dur 在后面计算后回填）
            curr_clip['overlap_meta'] = {
                'duration': overlap_dur,
                'bridge_duration': 0.0,
                'prefix_total': overlap_dur,
                'source_clip': prev_clip.get('clip_id', ''),
                'source_shot_id': last_shot.get('shot_id', ''),
            }

            # 生成桥接描述，作为独立 bridge shot 插入
            prev_end_state = prev_clip.get('shot_end_state')
            bridge_desc = build_bridge_description(prev_end_state) if prev_end_state else ''
            bridge_dur = 0.0
            if bridge_desc:
                bridge_dur = min(2.0, max(1.0, overlap_dur))  # 1-2s，参考 overlap 时长
                bridge_shot = {
                    'shot_id': 'bridge',
                    'time_range': f"{overlap_dur}-{overlap_dur + bridge_dur}s",
                    'partial_prompt': bridge_desc,
                    'partial_prompt_v2': bridge_desc,
                    'is_bridge': True,
                }
            curr_clip['bridge_description'] = bridge_desc
            curr_clip['overlap_meta']['bridge_duration'] = bridge_dur
            curr_clip['overlap_meta']['prefix_total'] = overlap_dur + bridge_dur

            # 插入 overlap shot 到位置 0，bridge shot 到位置 1
            curr_shots.insert(0, overlap_shot)
            if bridge_desc:
                curr_shots.insert(1, bridge_shot)

            # 偏移原始 shots 的 time_range（overlap + bridge）
            prefix_dur = overlap_dur + bridge_dur
            start_idx = 2 if bridge_desc else 1
            for shot in curr_shots[start_idx:]:
                if 'time_range' in shot:
                    shot['time_range'] = _offset_time_range(shot['time_range'], prefix_dur)

            # 检查总时长，若超 15s 则将末尾 shot(s) 推入新 clip
            total_dur = _parse_duration(curr_clip.get('expected_duration', '10'))
            new_total = total_dur + overlap_dur + bridge_dur
            if new_total > 15 and len(curr_shots) > start_idx + 1:
                # 从后往前移除 shot，直到 ≤ 15s
                overflow_shots = []
                while new_total > 15 and len(curr_shots) > start_idx + 1:
                    removed = curr_shots.pop()
                    removed_dur = _parse_time_range_duration(removed.get('time_range', '0-3s'))
                    new_total -= removed_dur
                    overflow_shots.insert(0, removed)

                # 将溢出 shots 创建为新 clip，插入到当前 clip 之后
                if overflow_shots:
                    new_clip = _create_overflow_clip(curr_clip, overflow_shots, i)
                    clips.insert(i + 1, new_clip)

            curr_clip['expected_duration'] = f"{new_total}s"

            # 重组 complete_prompt / complete_prompt_v2
            _rebuild_complete_prompt(curr_clip)

            i += 1


def _rebuild_complete_prompt(segment):
    """根据 shots 数组重组 segment 的 complete_prompt 和 complete_prompt_v2。"""
    position_prefix = segment.get('layout_prompt', '')
    shots = segment.get('shots', [])

    # 提取原有音效部分
    sfx_v1 = ''
    sfx_v2 = ''
    if 'complete_prompt' in segment:
        sfx_match = re.search(r'(音效：.+?)$', segment['complete_prompt'])
        if sfx_match:
            sfx_v1 = ' ' + sfx_match.group(1)
    if 'complete_prompt_v2' in segment:
        sfx_match = re.search(r'(音效：.+?)$', segment.get('complete_prompt_v2', ''))
        if sfx_match:
            sfx_v2 = ' ' + sfx_match.group(1)

    # 重组 v1
    parts_v1 = []
    if position_prefix:
        parts_v1.append(position_prefix)
    for shot in shots:
        tr = shot['time_range'].replace('-', '–')
        parts_v1.append(f"{tr}，{shot.get('partial_prompt', '')}")
    segment['complete_prompt'] = ' '.join(parts_v1) + (sfx_v1 or '')

    # 重组 v2
    parts_v2 = []
    if position_prefix:
        parts_v2.append(position_prefix)
    for shot in shots:
        tr = shot['time_range'].replace('-', '–')
        parts_v2.append(f"{tr}，{shot.get('partial_prompt_v2', shot.get('partial_prompt', ''))}")
    segment['complete_prompt_v2'] = ' '.join(parts_v2) + (sfx_v2 or sfx_v1 or '')

    # 即梦 SD2.0：重组后同样注入稳定性固定前缀
    if get_video_model_config().get('active_model') == 'seedance2':
        segment['complete_prompt'] = _JIMENG_QUALITY_PREFIX + " " + segment['complete_prompt']
        segment['complete_prompt_v2'] = _JIMENG_QUALITY_PREFIX + " " + segment['complete_prompt_v2']
    # 风格关键词前缀置于最开头（所有模型均生效）
    if _STYLE_PREFIX:
        segment['complete_prompt'] = _STYLE_PREFIX + segment['complete_prompt']
        segment['complete_prompt_v2'] = _STYLE_PREFIX + segment['complete_prompt_v2']




def convert_to_storyboard_format(shots_data, global_config):
    """将 shots 格式转换为 storyboard 格式

    注意：AI已经生成了包含{act_001}格式的提示词，这里只需要做符号转换：【x】→{x}
    结构化字段（actors/locations/props数组）直接从segment数据中读取ID
    """
    import re

    # 简化的符号转换函数：只将【x】转换为{x}
    def replace_brackets(text):
        if not text:
            return text
        # 将【任意内容】替换为{任意内容}
        text = re.sub(r'【([^】]+)】', r'{\1}', text)
        # 修复AI生成的{{act_xxx}}/{{loc_xxx}}/{{prp_xxx}}双花括号为单花括号
        text = re.sub(r'\{\{((?:act|loc|prp)_\d+)\}\}', r'{\1}', text)
        return text

    # 构建 storyboard 结构
    result = {
        'episode_id': f"ep_{str(shots_data['episode']).zfill(3)}",
        'title': shots_data.get('title'),
        'scenes': []
    }

    for scene in shots_data['scenes']:
        # 提取场景编号
        scene_id_match = re.search(r'(\d+)(?!.*\d)', scene['scene_id'])
        scene_num = scene_id_match.group(1) if scene_id_match else '1'

        new_scene = {
            'scene_id': f"scn_{scene_num.zfill(3)}",
            'environment': {
                'space': 'interior',
                'time': scene['clips'][0].get('time', 'night') if scene['clips'] else 'night'
            },
            'locations': [],
            'actors': [],
            'props': [],
            'clips': []
        }

        # 收集场景中的所有角色ID、场景ID、道具ID（segment中已存储ID格式）
        all_character_ids = set()
        all_location_ids = set()
        all_prop_ids = set()

        for segment in scene['clips']:
            if 'characters' in segment:
                all_character_ids.update(segment['characters'])
            if 'location' in segment:
                all_location_ids.add(segment['location'])
            if 'props' in segment:
                all_prop_ids.update(segment['props'])

        # 添加 locations（直接使用ID）
        for loc_id in all_location_ids:
            if loc_id:
                new_scene['locations'].append({
                    'location_id': loc_id,
                    'state_id': None
                })

        # 添加 actors（直接使用ID）
        for actor_id in all_character_ids:
            if actor_id:
                new_scene['actors'].append({
                    'actor_id': actor_id,
                    'state_id': None
                })

        # 添加 props（直接使用ID）
        for prop_id in all_prop_ids:
            if prop_id:
                new_scene['props'].append({
                    'prop_id': prop_id,
                    'state_id': None
                })

        # 转换 clips
        clip_counter = 1
        for segment in scene['clips']:
            overlap_meta = segment.get('overlap_meta')

            clip = {
                'clip_id': segment.get('clip_id', f"clip_{clip_counter:03d}"),  # 已为 clip_NNN 格式
                'expected_duration': segment.get('expected_duration', 10),
                'script_source': segment.get('source', ''),
                'layout_prompt': replace_brackets(segment.get('layout_prompt', '')),
                'sfx_prompt': '',
                'shots': [],
                'overlap': overlap_meta,          # clip 间连续性
                'bridge_description': segment.get('bridge_description'),  # 桥接描述
            }

            # 提取音效提示词
            if 'complete_prompt' in segment:
                sfx_match = re.search(r'音效：(.+?)$', segment['complete_prompt'])
                if sfx_match:
                    clip['sfx_prompt'] = sfx_match.group(1).strip()

            # 转换 shots
            shot_counter = 1
            for shot in segment.get('shots', []):
                new_shot = {
                    'shot_id': f"shot_{shot_counter:03d}",
                    'time_range': shot.get('time_range', ''),
                    'partial_prompt': replace_brackets(shot.get('partial_prompt', '')),
                    'partial_prompt_v2': replace_brackets(shot.get('partial_prompt_v2', shot.get('partial_prompt', ''))),
                    'is_overlap': shot.get('is_overlap', False),  # clip 间连续性
                    'is_bridge': shot.get('is_bridge', False),  # 桥接镜头
                }
                clip['shots'].append(new_shot)
                shot_counter += 1

            # 添加 complete_prompt 和 complete_prompt_v2（分开的两个字段）
            if 'complete_prompt' in segment:
                clip['complete_prompt'] = replace_brackets(segment['complete_prompt']) + ' 无任何字幕，无文字，无水印'
                v2_raw = segment.get('complete_prompt_v2', segment['complete_prompt'])
                clip['complete_prompt_v2'] = replace_brackets(v2_raw) + ' 无任何字幕，无文字，无水印'

            new_scene['clips'].append(clip)
            clip_counter += 1

        result['scenes'].append(new_scene)

    return result




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
        return [int(ep['episode_id'].replace('ep_', '')) for ep in episodes]
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
    parser = argparse.ArgumentParser(description='生成视频提示词JSON文件')
    parser.add_argument('--episode', required=True,
                        help='集数编号，支持：单集(1)、范围(1-3)、列表(1,3,5)、全部(all)')
    parser.add_argument('--script', help='剧本JSON文件路径（可选，默认使用 script.json）')
    parser.add_argument('--output', help='输出目录路径（可选）')
    parser.add_argument('--no-remove-colors', action='store_true', help='不自动去除服饰颜色（默认会自动去除）')
    parser.add_argument('--force-regenerate', action='store_true', help='强制重新生成 script_no_colors 文件（即使已存在）')
    parser.add_argument('--no-generate-video', action='store_true', help='跳过视频生成阶段，只生成提示词 JSON')
    parser.add_argument('--model-code', default=None, help='视频生成模型代码（默认使用 config.json 配置）')
    parser.add_argument('--quality', default=None, choices=['720', '1080'], help='视频质量（默认使用 config.json 配置）')
    parser.add_argument('--ratio', default=None, choices=['16:9', '9:16', '1:1'], help='画幅比例（默认使用 config.json 配置）')
    parser.add_argument('--project-dir', default=None, help='Project root directory (falls back to PROJECT_DIR env var, then CWD)')
    parser.add_argument('--output-root', default=None, help='Output root directory containing script.json, actors/, etc. (default: PROJECT_ROOT/output)')
    parser.add_argument('--workspace-root', default=None, help='Workspace root directory for intermediate files (default: PROJECT_ROOT/workspace)')
    parser.add_argument('--parallel', action='store_true', help='并行处理多集（多集时生效，每集独立进程，日志写入 workspace/logs/）')
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
    WORKSPACE_ROOT = os.path.abspath(args.workspace_root) if args.workspace_root else os.path.join(PROJECT_ROOT, 'workspace')

    # 如果未指定script路径，使用 OUTPUT_ROOT 下的默认位置
    if not args.script:
        args.script = os.path.join(OUTPUT_ROOT, 'script.json')

    # 如果强制重新生成，先删除旧的 script_no_colors 文件（在 workspace/ 下）
    if args.force_regenerate and not args.no_remove_colors:
        _ws_dir = WORKSPACE_ROOT
        import glob
        no_color_files = glob.glob(os.path.join(_ws_dir, 'script_no_colors_*.json'))
        if no_color_files:
            print(f"强制重新生成模式：删除 {len(no_color_files)} 个旧的 script_no_colors 文件")
            for f in no_color_files:
                os.remove(f)
                print(f"  已删除: {os.path.basename(f)}")
            print()

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
        import glob

        # Step 1: 确保 script_no_colors 存在（只生成一次，所有集共享）
        script_path = args.script
        if not args.no_remove_colors:
            _ws_nc = WORKSPACE_ROOT
            _nc_files = glob.glob(os.path.join(_ws_nc, 'script_no_colors_*.json'))
            if _nc_files:
                script_path = max(_nc_files, key=os.path.getmtime)
                print(f"[并行模式] 复用已有无颜色剧本: {os.path.basename(script_path)}")
            else:
                print("[并行模式] 预生成 script_no_colors 文件（所有集共享）...")
                script_path = remove_costume_colors_with_gemini(args.script)
                print(f"[并行模式] 完成: {os.path.basename(script_path)}\n")

        # Step 2: 准备日志目录
        log_dir = os.path.join(PROJECT_ROOT, 'workspace', 'logs')
        os.makedirs(log_dir, exist_ok=True)

        print(f"[并行模式] 启动 {total} 集并行处理（日志目录: workspace/logs/）\n")
        print_lock = threading.Lock()

        def _run_ep_subprocess(ep_num):
            log_path = os.path.join(log_dir, f'ep{ep_num:03d}.log')
            cmd = [
                sys.executable, os.path.abspath(__file__),
                '--episode', str(ep_num),
                '--no-remove-colors',
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
                print(f"[ep{ep_num:03d}] 启动 → 日志: workspace/logs/ep{ep_num:03d}.log")
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

    # ── 串行模式（原有逻辑）──────────────────────────────────
    else:
        # 准备日志目录（所有模式都写 log）
        log_dir = os.path.join(PROJECT_ROOT, 'workspace', 'logs')
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
                if os.path.exists(_ep_out):
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
                    ep_num, args.script, args.output, remove_colors=not args.no_remove_colors
                )
                print(f'已生成 {segment_count} 个segments')
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
