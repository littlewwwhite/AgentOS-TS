#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成视频提示词JSON文件（改进版v2）
基于 kling-video-prompt skill v2.45.0 规范

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

# 人物一致性前缀
CHARACTER_PREFIX_EN = "Maintain characters exactly as reference images, 100% identical facial features, same bone structure, eye spacing and jaw geometry, no beautification, no age changes."
CHARACTER_PREFIX_CN = "保持人物与参考图完全一致，面部特征100%相同，保持相同的骨骼结构、眼距和下颚几何形状，禁止美化，禁止改变年龄。"

# 风格提示词（三维CG风格）
STYLE_PROMPT_EN = "3D CG animation style, high-quality rendering with realistic lighting and shadows, detailed material textures (fabric, metal, wood), volumetric lighting effects, cinematic depth of field, physically-based rendering (PBR), ray-traced reflections and refractions."
STYLE_PROMPT_CN = "三维CG动画风格，高质量渲染，真实光影和阴影效果，精细材质质感（布料、金属、木质），体积光效果，电影级景深，基于物理的渲染（PBR），光线追踪的反射和折射。"


def load_script_data(script_path, episode_num):
    """加载剧本数据"""
    with open(script_path, 'r', encoding='utf-8') as f:
        global_config = json.load(f)

    # 查找指定集数
    episodes = global_config.get('episodes', [])
    episode_data = None
    for ep_idx, ep in enumerate(episodes, 1):
        # Support both numeric 'episode' field and string 'episode_id' (e.g. "ep_001")
        ep_num = ep.get('episode') or ep_idx
        ep_id = ep.get('episode_id', '')
        if ep_num == episode_num or ep_id == f"ep_{episode_num:03d}":
            episode_data = ep
            # Inject a numeric episode number for downstream use
            episode_data.setdefault('episode', episode_num)
            break

    if not episode_data:
        raise ValueError(f"未找到第{episode_num}集的数据")

    return episode_data, global_config


def build_mappings(global_config):
    """构建ID到名称的映射"""
    actors_map = {
        a.get('actor_id') or a.get('id'): a.get('actor_name') or a.get('name')
        for a in global_config.get('actors', [])
    }
    locations_map = {
        l.get('location_id') or l.get('id'): l.get('location_name') or l.get('name')
        for l in global_config.get('locations', [])
    }
    props_map = {
        p.get('prop_id') or p.get('id'): p.get('prop_name') or p.get('name')
        for p in global_config.get('props', [])
    }
    return actors_map, locations_map, props_map


def translate_action_to_visual_description(action_text, characters, scene_name, time_of_day):
    """将中文剧本动作转换为详细的英文视觉描述

    规则：
    1. 提取人物、动作、位置、情绪
    2. 转换为电影化的英文描述
    3. 添加环境细节和氛围
    """
    import re

    # 先给原始文本添加【】标注（用于后续提取）
    annotated_text = action_text
    for char in characters:
        annotated_text = annotated_text.replace(char, f'【{char}】')
    if scene_name in annotated_text:
        annotated_text = annotated_text.replace(scene_name, f'【{scene_name}】')

    # 中文版：直接使用标注后的文本
    visual_desc_cn = annotated_text

    # 英文版：基础翻译（保留【】标注的人物和场景名）
    # 提取【】标注的内容，保持不变

    # 先提取所有【】标注
    brackets_pattern = r'【([^】]+)】'
    brackets_content = re.findall(brackets_pattern, annotated_text)

    # 创建占位符映射
    placeholders = {}
    temp_text = annotated_text  # 使用标注后的文本
    for i, content in enumerate(brackets_content):
        placeholder = f'__BRACKET_{i}__'
        placeholders[placeholder] = f'【{content}】'
        temp_text = temp_text.replace(f'【{content}】', placeholder, 1)

    # 基础中英文映射（常见动作和描述）
    translation_map = {
        # 虚词
        '地': ' ',
        '的': ' ',
        '了': '',
        '着': '',
        '过': '',
        # 动作
        '站在': 'standing in',
        '坐在': 'sitting on',
        '走向': 'walking towards',
        '看着': 'looking at',
        '看向': 'looking at',
        '看': 'looking at',
        '转头': 'turning head',
        '抬头': 'raising head',
        '低头': 'lowering head',
        '伸手': 'reaching out',
        '握住': 'grasping',
        '放下': 'putting down',
        '拿起': 'picking up',
        '微笑': 'smiling',
        '皱眉': 'frowning',
        '叹气': 'sighing',
        '点头': 'nodding',
        '摇头': 'shaking head',
        # 描述
        '一袭白衣': 'dressed in white robes',
        '剑眉星目': 'with sharp eyebrows and bright eyes',
        '周身灵气环绕': 'surrounded by spiritual energy',
        '目光复杂': 'with complex gaze',
        '嘴角勾起': 'lips curling up',
        '一抹': 'a hint of',
        '不易察觉': 'barely noticeable',
        '冷笑': 'cold smile',
        '眼神温柔': 'with gentle eyes',
        '爆发出': 'bursting with',
        '热烈的': 'enthusiastic',
        '掌声': 'applause',
        '欢呼': 'cheers',
        '人群中': 'in the crowd',
        '光柱': 'beam of light',
        '从': 'from',
        '穹顶': 'dome',
        '直射而下': 'shining down',
        '立于': 'standing at',
        '中央': 'center',
        '巍峨': 'majestic',
        '大殿': 'hall',
        '金色': 'golden',
    }

    # 应用翻译映射
    visual_desc_en = temp_text
    for cn, en in translation_map.items():
        visual_desc_en = visual_desc_en.replace(cn, en)

    # 恢复【】标注
    for placeholder, bracket_text in placeholders.items():
        visual_desc_en = visual_desc_en.replace(placeholder, bracket_text)

    # 清理多余的中文字符（如果还有未翻译的）
    # 保留【】中的内容，其他中文字符用通用描述替换
    visual_desc_en = re.sub(r'[→，。、]', ', ', visual_desc_en)
    visual_desc_en = re.sub(r'\s+', ' ', visual_desc_en).strip()
    visual_desc_en = visual_desc_en.replace(', ,', ',').replace(',,', ',')

    # 添加环境细节
    if time_of_day == 'day':
        atmosphere_en = "Sunlight filters through, casting warm shadows"
        atmosphere_cn = "阳光透过，投下温暖的阴影"
    else:
        atmosphere_en = "Moonlight casts ethereal glow, shadows dance"
        atmosphere_cn = "月光投下空灵的光辉，阴影舞动"

    return visual_desc_en, visual_desc_cn, atmosphere_en, atmosphere_cn


def generate_shot_description(part, shot_index, total_shots, scene_name, time_of_day,
                              characters, is_first_shot=False, previous_position=None):
    """生成详细的镜头描述

    参数:
        part: 动作内容片段
        shot_index: 当前shot在segment中的索引
        total_shots: segment中总shot数
        scene_name: 场景名称
        time_of_day: 时段（day/night）
        characters: 人物列表
        is_first_shot: 是否是第一个segment的第一个shot
        previous_position: 上一个shot中人物的位置（用于连续性）

    返回:
        (description_en, description_cn, character_position)
    """
    # 1. 根据镜头位置选择景别、运动、构图
    if is_first_shot:
        shot_type = "Extreme wide shot"
        shot_type_cn = "超广角大全景"
        camera_movement = "slowly pushing in"
        camera_movement_cn = "缓慢推入"
        composition = "deep depth composition with leading lines"
        composition_cn = "深度构图，引导线构图"
        focal_length = "ultra-wide angle lens"
        focal_length_cn = "超广角镜头"
        depth = "deep depth of field"
        depth_cn = "深景深"
    elif shot_index == 0:
        shot_type = "Wide shot"
        shot_type_cn = "全景"
        camera_movement = "steady"
        camera_movement_cn = "稳定"
        composition = "rule of thirds composition"
        composition_cn = "三分法构图"
        focal_length = "standard lens"
        focal_length_cn = "标准镜头"
        depth = "shallow depth of field"
        depth_cn = "浅景深"
    elif shot_index == total_shots - 1:
        shot_type = "Close-up"
        shot_type_cn = "特写"
        camera_movement = "slow push in"
        camera_movement_cn = "缓推"
        composition = "center composition"
        composition_cn = "中心构图"
        focal_length = "85mm telephoto lens"
        focal_length_cn = "85mm长焦镜头"
        depth = "shallow depth of field with background bokeh"
        depth_cn = "浅景深，背景虚化"
    else:
        shot_type = "Medium shot"
        shot_type_cn = "中景"
        camera_movement = "steady tracking"
        camera_movement_cn = "稳定跟拍"
        composition = "diagonal composition"
        composition_cn = "对角线构图"
        focal_length = "50mm standard lens"
        focal_length_cn = "50mm标准镜头"
        depth = "shallow depth of field"
        depth_cn = "浅景深"

    # 2. 根据time_of_day生成光线描述
    if time_of_day == 'day':
        lighting = "warm golden light streaming from high windows, soft ambient lighting"
        lighting_cn = "暖黄光线从高窗斜射，柔和环境光"
    else:
        lighting = "dim candlelight flickering, cool moonlight through windows, dramatic shadows"
        lighting_cn = "昏暗烛火摇曳，冷色月光透窗，戏剧性阴影"

    # 3. 添加背景描述
    background_desc = f"Background: interior 【{scene_name}】"
    background_desc_cn = f"背景是【{scene_name}】内景"

    # 4. 转换动作内容为视觉描述
    visual_en, visual_cn, atmosphere_en, atmosphere_cn = translate_action_to_visual_description(
        part, characters, scene_name, time_of_day
    )

    # 5. 提取人物位置（用于下一个shot的连续性）
    # 简单提取：如果包含"中央"、"角落"等位置词
    character_position = "center"  # 默认位置
    if "角落" in part or "corner" in part.lower():
        character_position = "corner"
    elif "中央" in part or "center" in part.lower():
        character_position = "center"
    elif "前方" in part or "front" in part.lower():
        character_position = "front"

    # 6. 如果有上一个位置，添加位置连续性描述
    position_continuity_en = ""
    position_continuity_cn = ""
    if previous_position and previous_position != character_position:
        if previous_position == "corner" and character_position == "center":
            position_continuity_en = "moving from corner towards center"
            position_continuity_cn = "从角落向中央移动"
        elif previous_position == "center" and character_position == "front":
            position_continuity_en = "advancing from center to front"
            position_continuity_cn = "从中央向前方推进"

    # 7. 构建完整描述（纯英文）
    description_parts_en = [
        shot_type,
        camera_movement,
        composition,
        focal_length,
        depth,
        background_desc,
        lighting,
    ]

    if position_continuity_en:
        description_parts_en.append(position_continuity_en)

    description_parts_en.append(visual_en)
    description_parts_en.append(atmosphere_en)

    description_en = ", ".join(description_parts_en[:5]) + ". " + ", ".join(description_parts_en[5:]) + "."

    # 8. 构建完整描述（纯中文）
    description_parts_cn = [
        shot_type_cn,
        camera_movement_cn,
        composition_cn,
        focal_length_cn,
        depth_cn,
        background_desc_cn,
        lighting_cn,
    ]

    if position_continuity_cn:
        description_parts_cn.append(position_continuity_cn)

    description_parts_cn.append(visual_cn)
    description_parts_cn.append(atmosphere_cn)

    description_cn = "，".join(description_parts_cn[:5]) + "。" + "，".join(description_parts_cn[5:]) + "。"

    return description_en, description_cn, character_position


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

    # 记录当前场次信息（用于调试和验证）
    scene_location = scene.get('location') or scene.get('scene_id', 'Unknown')

    # 提取 sequence 数字用于 segment_id，兼容 scene_id="scn_001" 格式
    raw_seq = scene.get('sequence')
    if raw_seq is None:
        sid = scene.get('scene_id', 'scn_001')
        try:
            raw_seq = int(sid.split('_')[-1])
        except (ValueError, IndexError):
            raw_seq = 1
    scene_sequence = raw_seq

    for action in scene['actions']:
        action_type = action['type']

        if action_type == 'action':
            action_duration = estimate_action_duration(action['content'])

            # 判断是否可以合并到当前segment
            # 注意：由于此函数只处理单个scene，所以合并自动限制在场内
            can_merge = (
                current_segment is not None and
                current_duration + action_duration <= 15
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

                # 创建新segment
                current_segment = {
                    'segment_id': f"SC{scene_sequence:02d}-L{segment_counter:02d}",
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
                actor_name = actors_map.get(action['actor_id'], action['actor_id'])
                dialogue_data = {
                    'actor': actor_name,
                    'content': action['content'],
                    'emotion': action.get('emotion', '')
                }

                # 将对话添加到dialogues数组（保持向后兼容）
                current_segment['dialogues'].append(dialogue_data)

                # 将对话映射到对应的action部分索引
                if action_part_index not in current_segment['dialogue_map']:
                    current_segment['dialogue_map'][action_part_index] = []
                current_segment['dialogue_map'][action_part_index].append(dialogue_data)

        elif action_type == 'inner_thought':
            if current_segment:
                actor_name = actors_map.get(action['actor_id'], action['actor_id'])
                inner_thought_data = {
                    'actor': actor_name,
                    'content': action['content']
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


def estimate_shot_duration(action_text, dialogue_data=None):
    """估算单个shot的时长（秒）

    规则：
    - 基础时长：根据动作文本长度
    - 短文本（<20字）：2秒
    - 中等文本（20-40字）：3秒
    - 长文本（>40字）：4秒
    - 对话时长：根据对话长度灵活估算
    - 短对话（<10字）：+2秒
    - 中等对话（10-20字）：+3秒
    - 长对话（>20字）：+4秒
    """
    text_length = len(action_text)

    if text_length < 20:
        base_duration = 2
    elif text_length < 40:
        base_duration = 3
    else:
        base_duration = 4

    # 如果有对话，根据对话长度估算时长
    if dialogue_data:
        # 计算所有对话的总字数
        total_dialogue_chars = sum(len(d['content']) for d in dialogue_data)

        # 根据对话长度分段估算
        if total_dialogue_chars < 10:
            dialogue_duration = 2
        elif total_dialogue_chars < 20:
            dialogue_duration = 3
        else:
            dialogue_duration = 4

        # 基础时长 + 对话时长
        base_duration += dialogue_duration

    return int(base_duration)


def generate_shots_for_segment(segment, scene, actors_map, locations_map, is_first_segment=False,
                               previous_segment_last_position=None):
    """为segment生成shots

    参数:
        previous_segment_last_position: 上一个segment最后一个shot的人物位置
    """
    # 获取人物和场景 — 兼容新旧格式
    cast = scene.get('actors', scene.get('cast', []))
    characters = [
        actors_map.get(c.get('actor_id') or c.get('id'), c.get('actor_id') or c.get('id'))
        for c in cast
    ]
    characters = [c for c in characters if c]
    locs = scene.get('locations', [])
    if locs:
        loc_id = locs[0].get('location_id') or locs[0].get('id')
        scene_name = locations_map.get(loc_id, loc_id or '未知场景')
    else:
        scene_name = locations_map.get(scene.get('location_id'), scene.get('location', '未知场景'))
    env = scene.get('environment', {})
    time_of_day = env.get('time') or scene.get('time_of_day', 'day')

    # 按→拆分动作内容
    action_parts = segment['action_content'].split('→')
    action_parts = [p.strip() for p in action_parts]

    # 估算每个shot的时长
    shot_durations = []
    for i, part in enumerate(action_parts):
        # 检查当前action部分是否有对应的对话
        dialogue_data = None
        if 'dialogue_map' in segment and i in segment['dialogue_map']:
            dialogue_data = segment['dialogue_map'][i]

        duration = estimate_shot_duration(part, dialogue_data)
        shot_durations.append(duration)

    # 计算总时长，确保不超过15秒
    total_duration = sum(shot_durations)
    if total_duration > 15:
        # 按比例缩减每个shot的时长
        scale_factor = 15 / total_duration
        shot_durations = [max(2, int(d * scale_factor)) for d in shot_durations]
        total_duration = sum(shot_durations)

    shots = []
    previous_position = previous_segment_last_position
    current_time = 0

    for i, part in enumerate(action_parts):
        start_time = current_time
        end_time = current_time + shot_durations[i]

        # 生成详细描述（带上下文）
        desc_en, desc_cn, char_position = generate_shot_description(
            part, i, len(action_parts), scene_name, time_of_day, characters,
            is_first_shot=(is_first_segment and i == 0),
            previous_position=previous_position
        )

        # 更新位置用于下一个shot
        previous_position = char_position

        shot = {
            'shot_id': f"{segment['segment_id']}-C{i+1:02d}",
            'time_range': f"{start_time}-{end_time}s",
            'description': f"{start_time}-{end_time}s, {desc_en}",
            'dialogue': "",
            'description_cn': desc_cn
        }

        # 检查当前action部分是否有对应的对话
        if 'dialogue_map' in segment and i in segment['dialogue_map']:
            dialogue_text = " ".join([
                f"【{d['actor']}】（{d['emotion']}）：{d['content']}"
                for d in segment['dialogue_map'][i]
            ])
            shot['dialogue'] = dialogue_text

        shots.append(shot)
        current_time = end_time  # 更新当前时间

    return shots, f"{total_duration}s", previous_position


def generate_prompts(segment, shots):
    """生成英文和中文prompts"""
    # 英文prompts
    prompts_en_parts = [CHARACTER_PREFIX_EN, STYLE_PROMPT_EN]

    for shot in shots:
        shot_desc = shot['description']
        if shot['dialogue']:
            shot_desc += f" {shot['dialogue']}"
        prompts_en_parts.append(shot_desc)

    prompts_en = " ".join(prompts_en_parts)

    # 中文prompts
    prompts_cn_parts = [CHARACTER_PREFIX_CN, STYLE_PROMPT_CN]

    for shot in shots:
        time_range = shot['time_range'].replace('-', '–')
        shot_desc_cn = f"{time_range}，{shot['description_cn']}"
        if shot['dialogue']:
            shot_desc_cn += f" {shot['dialogue']}"
        prompts_cn_parts.append(shot_desc_cn)

    prompts_cn = " ".join(prompts_cn_parts)

    return prompts_en, prompts_cn


def extract_emotion_and_conflict(segment):
    """从segment内容中提取情绪和核心冲突"""
    action = segment['action_content']

    # 提取情绪关键词
    emotion_keywords = ['温柔', '冷笑', '焦急', '虚弱', '惨叫', '得意', '绝望', '愤怒']
    emotions = [kw for kw in emotion_keywords if kw in action]
    emotion = '→'.join(emotions) if emotions else '平静'

    # 提取核心冲突
    if segment.get('dialogues'):
        conflict = '对话冲突'
    elif segment.get('inner_thoughts'):
        conflict = '内心挣扎'
    else:
        conflict = '动作展示'

    return emotion, conflict


def generate_segment_json(segment, scene, actors_map, locations_map, props_map,
                          is_first_segment=False, previous_segment_last_position=None):
    """生成完整的segment JSON"""
    # 获取人物列表 — 兼容 {actor_id} 和 {id} 两种格式
    cast = scene.get('actors', scene.get('cast', []))
    characters = [
        actors_map.get(c.get('actor_id') or c.get('id'), c.get('actor_id') or c.get('id'))
        for c in cast
    ]
    characters = [c for c in characters if c]  # filter None

    # 获取场景名称 — 兼容 locations 数组和旧版 location_id 字段
    scene_name = '未知场景'
    locs = scene.get('locations', [])
    if locs:
        loc_id = locs[0].get('location_id') or locs[0].get('id')
        scene_name = locations_map.get(loc_id, loc_id or '未知场景')
    elif scene.get('location_id'):
        scene_name = locations_map.get(scene['location_id'], scene.get('location', '未知场景'))
    elif scene.get('location'):
        scene_name = scene['location']

    # 获取道具列表 — 兼容 props 数组（含 prop_id）和旧版 prop_ids 字段
    props_raw = scene.get('props', [])
    props = []
    for p in props_raw:
        if isinstance(p, dict):
            pid = p.get('prop_id') or p.get('id')
            name = props_map.get(pid, pid)
            if name:
                props.append(name)
        else:
            props.append(props_map.get(p, p))

    # 获取时间 — 兼容 environment.time 和旧版 time_of_day 字段
    env = scene.get('environment', {})
    time_val = env.get('time') or scene.get('time_of_day', 'day')

    # 生成shots（带上下文）
    shots, duration, last_position = generate_shots_for_segment(
        segment, scene, actors_map, locations_map, is_first_segment, previous_segment_last_position
    )

    # 生成prompts
    prompts_en, prompts_cn = generate_prompts(segment, shots)

    # 提取情绪和冲突
    emotion, conflict = extract_emotion_and_conflict(segment)

    # 构建segment JSON
    segment_json = {
        'segment_id': segment['segment_id'],
        'source_beat': segment['action_content'],
        'duration_seconds': duration,
        'characters': characters,
        'scene': scene_name,
        'time': 'day' if time_val == 'day' else 'night',
        'weather': '晴' if time_val == 'day' else '夜',
        'props': props,
        'emotion': emotion,
        'core_conflict': conflict,
        'shots': shots,
        f"{segment['segment_id']}_prompts": prompts_en,
        f"{segment['segment_id']}_prompts_cn": prompts_cn
    }

    return segment_json, last_position


def generate_episode_json(episode_num, script_path, output_path=None):
    """生成指定集数的JSON文件"""
    # 加载数据
    episode_data, global_config = load_script_data(script_path, episode_num)
    actors_map, locations_map, props_map = build_mappings(global_config)

    # 生成所有segments
    all_segments = []
    segment_count = 0
    last_position = None

    for scene in episode_data['scenes']:
        segments = convert_actions_to_segments(scene, actors_map)

        for segment in segments:
            is_first = (segment_count == 0)
            segment_json, last_position = generate_segment_json(
                segment, scene, actors_map, locations_map, props_map, is_first, last_position
            )
            all_segments.append(segment_json)
            segment_count += 1

    # 构建最终JSON
    output_json = {
        'drama': global_config.get('title', ''),
        'episode': episode_num,
        'episode_logline': episode_data.get('title', ''),
        'scenes': [{
            'scene_id': 'SC01',
            'segments': all_segments
        }]
    }

    # 确定输出路径
    if not output_path:
        # 使用相对路径：从脚本所在目录向上4级到项目根目录，然后进入03-video/output
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # 脚本在 .claude/skills/kling-video-prompt/scripts/，向上4级到项目根目录
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(script_dir))))
        output_dir = os.path.join(project_root, '03-video', 'output', f'ep{episode_num:02d}')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f'ep{episode_num:02d}_shots.json')

    # 保存文件
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_json, f, ensure_ascii=False, indent=2)

    return output_path, len(all_segments)


def main():
    parser = argparse.ArgumentParser(description='生成视频提示词JSON文件')
    parser.add_argument('--episode', type=int, required=True, help='集数编号')
    parser.add_argument('--script', help='剧本JSON文件路径（可选，默认使用相对路径）')
    parser.add_argument('--output', help='输出文件路径（可选）')

    args = parser.parse_args()

    # 如果未指定script路径，使用相对路径
    if not args.script:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # 脚本在 .claude/skills/kling-video-prompt/scripts/，向上4级到项目根目录
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(script_dir))))
        args.script = os.path.join(project_root, '01-script', 'output', 'script.json')

    try:
        output_path, segment_count = generate_episode_json(
            args.episode, args.script, args.output
        )
        print(f'已生成 {segment_count} 个segments')
        print(f'文件已保存到: {output_path}')
        return 0
    except Exception as e:
        print(f'错误: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
