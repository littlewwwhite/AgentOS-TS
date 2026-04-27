#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 script.json 自动提取资产并生成提示词 JSON

流程:
  1. 读取 script.json 中的 episodes 数组
  2. 使用 aos-cli model 分析指定集数的剧本内容
  3. 提取角色、场景、道具列表
  4. 为每个资产生成详细的英文提示词
  5. 输出三个 JSON 文件到 workspace

用法:
  python generate_prompts_from_script.py --episode 1 \
    --script-json "path/to/script.json" \
    --workspace "path/to/workspace" \
    --project-name "项目名"
"""
import sys, os, json, argparse, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from pipeline_state import ensure_state, update_artifact, update_stage
from threading import Lock

# UTF-8 输出
if sys.platform == 'win32':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    elif hasattr(sys.stdout, 'buffer'):
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
from common_gemini_client import generate_content_with_retry, generate_json_with_retry

# ── 加载生成配置 ───────────────────────────────────────────────────────────────
from common_config import get_config
_GC = get_config()

# ── 每个资产生成的提示词数量（按类型分开配置）────────────────────────────────
_num_prompts_cfg = _GC.get("num_prompts", {})
NUM_PROMPTS_CHARACTER = _num_prompts_cfg.get("character", 4)
NUM_PROMPTS_SCENE     = _num_prompts_cfg.get("scene", 4)
NUM_PROMPTS_PROP      = _num_prompts_cfg.get("prop", 4)


# 线程安全的日志锁
_log_lock = Lock()


def log(msg):
    with _log_lock:
        print(f"[提示词生成] {msg}", flush=True)


def read_script_from_json(episode, script_json):
    """从 script.json 中读取指定集数的剧本内容"""
    if not script_json or not Path(script_json).exists():
        log(f"❌ script.json 不存在: {script_json}")
        return None, {}

    try:
        with open(script_json, 'r', encoding='utf-8') as f:
            script_data = json.load(f)

        # 查找指定集数
        episodes = script_data.get('episodes', [])
        target_episode = None
        for ep in episodes:
            if ep.get('episode') == episode:
                target_episode = ep
                break

        if not target_episode:
            log(f"❌ 未找到第{episode}集的剧本数据")
            return None, script_data

        log(f"✓ 读取第{episode}集剧本: {target_episode.get('title', '未命名')}")

        # 将 episode 数据转换为文本格式
        script_text = format_episode_to_text(target_episode)
        return script_text, script_data

    except Exception as e:
        log(f"❌ 读取 script.json 失败: {e}")
        return None, {}


def format_episode_to_text(episode_data):
    """将 episode JSON 数据格式化为文本"""
    lines = []
    lines.append(f"# 第{episode_data.get('episode')}集: {episode_data.get('title', '未命名')}")
    lines.append("")

    for scene in episode_data.get('scenes', []):
        # 场次标题
        seq = scene.get('sequence')
        location = scene.get('location')
        time_of_day = scene.get('time_of_day', 'day')
        time_cn = {'day': '日', 'night': '夜', 'dusk': '昏'}[time_of_day]

        lines.append(f"## {seq} {time_cn} 内 {location}")
        lines.append("")

        # 角色列表
        cast = scene.get('cast', [])
        if cast:
            cast_names = [c.get('actor_name', '') for c in cast]
            lines.append(f"**角色**: {', '.join(cast_names)}")
            lines.append("")

        # 场景描述
        if scene.get('description'):
            lines.append(scene['description'])
            lines.append("")

        # 对话
        for dialogue in scene.get('dialogues', []):
            speaker = dialogue.get('speaker_name', '旁白')
            text = dialogue.get('text', '')
            lines.append(f"**{speaker}**: {text}")
            lines.append("")

        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def generate_voice_desc_with_gemini(actor_name, description, script_config):
    """通过 aos-cli model 为角色生成音色描述"""
    world_context = (
        f"世界观背景:\n"
        f"- 项目名: {script_config.get('title', '未知')}\n"
        f"- 世界观: {script_config.get('worldview', '未知')}"
    )

    template = _GC["prompt_templates"]["asset_description"]["voice_desc"]
    prompt = template.format(name=actor_name, world_context=world_context, description=description)

    try:
        text = generate_content_with_retry(prompt, f"生成音色描述({actor_name})")
        return text
    except Exception:
        return f"[待补充] {actor_name}音色描述。"


def generate_asset_description_with_gemini(asset_type, asset_name, description, script_config):
    """通过 aos-cli model 为单个资产生成中文描述"""
    world_context = (
        f"世界观背景:\n"
        f"- 项目名: {script_config.get('title', '未知')}\n"
        f"- 世界观: {script_config.get('worldview', '未知')}"
    )
    template = _GC["prompt_templates"]["asset_description"][asset_type]
    prompt = template.format(name=asset_name, world_context=world_context, description=description)

    try:
        return generate_content_with_retry(prompt, f"生成描述({asset_name})")
    except Exception:
        return f"[生成失败] {asset_name}"


def _build_gender_anchor(gender: str, height_cm) -> str:
    """Build a hard-coded gender/height anchor prefix to prevent model gender hallucination.

    This prefix is prepended to the generated text so the image model receives
    an unambiguous gender signal before any generated text.
    """
    try:
        h = int(height_cm)
    except (TypeError, ValueError):
        h = 170 if gender == 'male' else 160

    if gender == 'male':
        return f"男性，身高{h}cm，完美人体解剖学比例，修长双腿，标准垂直人体尺度，头宽与肩宽比例1:2。"
    else:
        return f"女性，身高{h}cm，完美人体解剖学比例，修长双腿，标准垂直人体尺度，头宽与肩宽比例1:1.5。"


def _extract_gender_height(description: str):
    """Extract gender and height from actor description string.

    Returns (gender, height_cm) where gender is 'male' or 'female'.
    Falls back to ('female', None) when not determinable.
    """
    import re
    gender = 'female'
    # Look for explicit gender keywords; 男 wins if present
    if re.search(r'男', description):
        gender = 'male'
    elif re.search(r'女', description):
        gender = 'female'

    # Try to extract height in cm, e.g. "180cm", "身高175", "175 cm"
    height_match = re.search(r'(\d{3})\s*[Cc][Mm]|身高\s*(\d{3})', description)
    height_cm = None
    if height_match:
        height_cm = int(height_match.group(1) or height_match.group(2))

    return gender, height_cm


def generate_prompt_with_gemini(asset_type, asset_name, asset_description, style_config,
                               appearance_region='', appearance_subtype='', appearance_region_traits='',
                               worldview='', region='', gender='', height_cm=None):
    """通过 aos-cli model 生成单个资产的中文提示词"""
    tpls = _GC["prompt_templates"]["asset_prompt"]

    if asset_type == "character_three_view":
        prompt = tpls["character_three_view"]["with_style"].format(
            name=asset_name, description=asset_description,
            appearance_region=appearance_region or '未指定',
            appearance_subtype=appearance_subtype or '未指定',
            appearance_region_traits=appearance_region_traits or '未指定',
        )

    elif asset_type == "scene":
        prompt = tpls["scene"]["with_style"].format(
            name=asset_name, description=asset_description,
            worldview=worldview or '未指定',
            region=region or '未指定',
        )

    else:  # props
        prompt = tpls["props"]["with_style"].format(
            name=asset_name, description=asset_description,
            worldview=worldview or '未指定',
            region=region or '未指定',
        )

    try:
        generated_text = generate_content_with_retry(prompt, f"生成提示词({asset_name})")
        if asset_type in ("character_three_view",):
            prefix = style_config['character_style'].get('prefix', '')
            suffix = style_config['character_style'].get('suffix', '')
            generated_text = generated_text.strip('，。, ')
            # Prepend a hard-coded gender/height anchor to prevent model gender hallucination.
            # Final order: style prefix + gender anchor + generated text + style suffix
            gender_anchor = _build_gender_anchor(gender or 'female', height_cm)
            return f"{prefix}{gender_anchor}{generated_text}，{suffix}"

        elif asset_type == "scene":
            prefix = style_config['scene_style'].get('prefix', '')
            suffix = style_config['scene_style'].get('suffix', '')
            # for keyword in _GC["generate_scenes"]["cleanup_keywords"]:
            #     generated_text = generated_text.replace(keyword, '')
            generated_text = generated_text.strip('，。, ')
            return f"{prefix}{generated_text}，{suffix}"

        elif asset_type == "props":
            prefix = style_config['prop_style'].get('prefix', '')
            suffix = style_config['prop_style'].get('suffix', '')
            # for keyword in _GC["generate_props"]["cleanup_keywords"]:
            #     generated_text = generated_text.replace(keyword, '')
            generated_text = generated_text.strip('，。, ')
            return f"{prefix}{generated_text}，{suffix}"
        else:
            return generated_text

    except Exception:
        return f"[生成失败] {asset_description}"


def collect_all_actions_text(script_data):
    """遍历 episodes > scenes > actions，拼接所有 content 为叙事文本。

    每个场景前标注出场角色，inner_thought 类型标注归属角色，方便 LLM 做角色维度分析。
    """
    actor_map = {a['actor_id']: a.get('actor_name', a['actor_id']) for a in script_data.get('actors', [])}
    lines = []
    for ep in script_data.get('episodes', []):
        for scene in ep.get('scenes', []):
            actors_in_scene = [actor_map.get(a['actor_id'], a['actor_id']) for a in scene.get('actors', [])]
            if actors_in_scene:
                lines.append(f"[出场角色: {', '.join(actors_in_scene)}]")
            for action in scene.get('actions', []):
                content = action.get('content', '').strip()
                if not content:
                    continue
                actor_id = action.get('actor_id', '')
                actor_name = actor_map.get(actor_id, '') if actor_id else ''
                lines.append(f"（{actor_name}内心）{content}" if actor_name else content)
    return '\n'.join(lines)


def analyze_actor_profiles_with_gemini(script_data, workspace_path):
    """调用 aos-cli model，基于剧本 actions 内容分析每个角色的性格、外貌、服装、情感弧线。

    输出保存到 draft/actor_analysis.json，支持断点续传。
    返回 {actor_id: {actor_name, personality, appearance, clothing, emotional_arc}}。
    """
    actors = script_data.get('actors', [])
    if not actors:
        return {}

    analysis_path = Path(workspace_path) / "actor_analysis.json"
    if analysis_path.exists():
        try:
            with open(analysis_path, 'r', encoding='utf-8') as f:
                cached = json.load(f)
            log(f"✓ 读取已有角色分析: {analysis_path}")
            return cached
        except Exception:
            pass

    actor_list_text = '\n'.join(
        f"- {a['actor_id']}: {a.get('actor_name', '')}（{a.get('description', '')}）"
        for a in actors
    )
    all_actions = collect_all_actions_text(script_data)

    prompt = f"""你是专业剧本角色分析师。请根据以下剧本内容，深度分析每个角色的形象。

项目：{script_data.get('title', '')}
世界观：{script_data.get('worldview', '')}

角色列表：
{actor_list_text}

剧本内容：
{all_actions}

请为每个角色输出详细分析，严格返回以下 JSON 格式（key 使用 actor_id）：
{{
  "act_001": {{
    "actor_name": "角色名",
    "personality": "核心性格、行为模式、心理特点的简洁描述",
    "appearance": "年龄、性别、面部特征、发型发色、身形等可视化外貌特征",
    "clothing": "主要出场时的服装款式、颜色、材质、细节，适合作为绘图提示词参考",
    "emotional_arc": "角色在剧本中的情感变化轨迹"
  }}
}}

要求：
1. 覆盖所有角色，不得遗漏
2. clothing 和 appearance 要足够具体，可直接用于绘图提示词
3. 只返回 JSON，不要任何额外说明"""

    try:
        result = generate_json_with_retry(prompt, "角色属性分析")
        Path(workspace_path).mkdir(parents=True, exist_ok=True)
        with open(analysis_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        log(f"✓ 角色属性分析完成，已保存: {analysis_path}")
        return result
    except Exception as e:
        log(f"⚠ 角色属性分析失败: {e}，将使用原始描述")
        return {}


def extract_episodes_for_assets(script_config):
    """从 episodes 中提取每个资产出现的集数"""
    asset_episodes = {
        'actors': {},      # {actor_id: [episodes]}
        'locations': {},   # {location_id: [episodes]}
        'props': {}        # {prop_id: [episodes]}
    }

    for episode in script_config.get('episodes', []):
        episode_num = episode.get('episode') or episode.get('episode_id')

        for scene in episode.get('scenes', []):
            # 提取场景中的角色（兼容 actors / cast 两种字段名）
            for cast_member in scene.get('actors', scene.get('cast', [])):
                actor_id = cast_member.get('actor_id')
                if actor_id:
                    if actor_id not in asset_episodes['actors']:
                        asset_episodes['actors'][actor_id] = []
                    if episode_num not in asset_episodes['actors'][actor_id]:
                        asset_episodes['actors'][actor_id].append(episode_num)

            # 提取场景位置（兼容 locations 数组 / location_id 字段）
            locations = scene.get('locations', [])
            if locations:
                for loc in locations:
                    location_id = loc.get('location_id')
                    if location_id:
                        if location_id not in asset_episodes['locations']:
                            asset_episodes['locations'][location_id] = []
                        if episode_num not in asset_episodes['locations'][location_id]:
                            asset_episodes['locations'][location_id].append(episode_num)
            else:
                location_id = scene.get('location_id')
                if location_id:
                    if location_id not in asset_episodes['locations']:
                        asset_episodes['locations'][location_id] = []
                    if episode_num not in asset_episodes['locations'][location_id]:
                        asset_episodes['locations'][location_id].append(episode_num)

            # 提取道具
            for prop in scene.get('props', []):
                prop_id = prop.get('prop_id')
                if prop_id:
                    if prop_id not in asset_episodes['props']:
                        asset_episodes['props'][prop_id] = []
                    if episode_num not in asset_episodes['props'][prop_id]:
                        asset_episodes['props'][prop_id].append(episode_num)

    return asset_episodes


def process_character_state(actor_name, actor_id, actor_description, state, asset_episodes, script_config, style_config,
                           appearance_region='', appearance_subtype='', appearance_region_traits=''):
    """并发处理单个角色状态的提示词生成"""
    state_name = state.get('state_name') or state.get('name')
    log(f"  - 生成形态: {actor_name}({state_name})")

    # Extract gender and height before model generation to anchor the prompt
    gender, height_cm = _extract_gender_height(actor_description)

    # 生成该形态的描述
    description = generate_asset_description_with_gemini(
        "character", f"{actor_name}({state_name})",
        actor_description, script_config
    )

    # 生成三视图提示词（基于角色描述），生成 NUM_PROMPTS_CHARACTER 个
    three_view_prompts = [
        {"prompt_id": str(uuid.uuid4()), "prompt": generate_prompt_with_gemini(
            "character_three_view", f"{actor_name}({state_name})",
            description, style_config,
            appearance_region=appearance_region,
            appearance_subtype=appearance_subtype,
            appearance_region_traits=appearance_region_traits,
            gender=gender,
            height_cm=height_cm,
        )}
        for _ in range(NUM_PROMPTS_CHARACTER)
    ]

    # 生成音色描述
    voice_desc = generate_voice_desc_with_gemini(
        f"{actor_name}({state_name})", description, script_config
    )

    return {
        "state_id": state.get('state_id') or state.get('id'),
        "state_name": state_name,
        "description": description,
        "episodes": sorted(asset_episodes['actors'].get(actor_id, [])),
        "three_view_prompts": three_view_prompts,
        "voice_text": "",
        "voice_desc": voice_desc
    }


def process_character_default(actor_name, actor_id, actor_description, asset_episodes, script_config, style_config,
                              appearance_region='', appearance_subtype='', appearance_region_traits=''):
    """并发处理单个角色默认形态的提示词生成"""
    log(f"  - 生成默认形态: {actor_name}")

    # Extract gender and height before model generation to anchor the prompt
    gender, height_cm = _extract_gender_height(actor_description)

    description = generate_asset_description_with_gemini(
        "character", actor_name, actor_description, script_config
    )

    # 生成三视图提示词（基于角色描述），生成 NUM_PROMPTS_CHARACTER 个
    three_view_prompts = [
        {"prompt_id": str(uuid.uuid4()), "prompt": generate_prompt_with_gemini(
            "character_three_view", actor_name, description, style_config,
            appearance_region=appearance_region,
            appearance_subtype=appearance_subtype,
            appearance_region_traits=appearance_region_traits,
            gender=gender,
            height_cm=height_cm,
        )}
        for _ in range(NUM_PROMPTS_CHARACTER)
    ]

    # 生成音色描述
    voice_desc = generate_voice_desc_with_gemini(actor_name, description, script_config)

    return {
        "state_id": f"{actor_id}_default",
        "state_name": "default",
        "description": description,
        "episodes": sorted(asset_episodes['actors'].get(actor_id, [])),
        "three_view_prompts": three_view_prompts,
        "voice_text": "",
        "voice_desc": voice_desc
    }


def determine_scene_groups_with_gemini(locations, script_config):
    """通过 aos-cli model 语义分析场景列表，返回每个场景的组归属信息。

    返回格式:
        {location_name: {"group": "桃花楼", "group_default": True/False}, ...}

    规则:
    - 同一物理空间下的子场景归为一组（如桃花楼酿酒间、桃花楼院中 → "桃花楼"组）
    - 最宏观/通用的场景作为 group_default=True，其余为 False
    - 独立场景自成一组（group=自身名称, group_default=True）
    """
    location_names = [loc.get('location_name') or loc.get('name', '') for loc in locations]
    names_text = "\n".join(f"- {n}" for n in location_names)

    world_context = (
        f"项目名: {script_config.get('title', '未知')}\n"
        f"世界观: {script_config.get('worldview', '未知')}"
    )

    prompt = f"""你是一个场景分析专家。请分析以下场景名称列表，将它们语义分组。

{world_context}

场景列表：
{names_text}

分组规则：
1. 同一物理空间下的子场景归为同一组，组名取最宏观的父空间名称
   例：桃花楼、桃花楼酿酒间、桃花楼院中 → 全归 "桃花楼" 组
2. 每组中，最宏观/最通用的场景标记为 group_default=true，其余为 false
   - 若组内存在与组名完全相同的场景，则该场景为 group_default=true
   - 若不存在与组名相同的场景，则选最宏观的作为 group_default=true
3. 独立场景（无法归入任何组）自成一组：group=自身名称，group_default=true

请严格返回 JSON 格式，不要有任何额外说明：
{{
  "场景名称1": {{"group": "组名", "group_default": true}},
  "场景名称2": {{"group": "组名", "group_default": false}},
  ...
}}

要求：覆盖列表中所有场景，不得遗漏。"""

    try:
        result = generate_json_with_retry(prompt, "场景分组")
        log(f"✓ 场景分组完成，共 {len(result)} 个场景")
        return result
    except Exception as e:
        log(f"⚠ aos-cli model 场景分组失败: {e}，使用默认策略（每个场景自成一组）")
        return {(loc.get('location_name') or loc.get('name', '')): {"group": (loc.get('location_name') or loc.get('name', '')), "group_default": True} for loc in locations}


def process_scene(location_name, location_id, location_description, asset_episodes, script_config, style_config,
                  group=None, group_default=True, worldview='', region=''):
    """并发处理单个场景的提示词生成"""
    log(f"  - 生成场景: {location_name}")

    # 生成场景描述
    description = generate_asset_description_with_gemini(
        "scene", location_name, location_description, script_config
    )

    # 生成场景提示词，生成 NUM_PROMPTS_SCENE 个
    scene_prompts = [
        {"prompt_id": str(uuid.uuid4()), "prompt": generate_prompt_with_gemini(
            "scene", location_name, description, style_config,
            worldview=worldview, region=region,
        )}
        for _ in range(NUM_PROMPTS_SCENE)
    ]

    return {
        "id": location_id,
        "name": location_name,
        "description": description,
        "episodes": sorted(asset_episodes['locations'].get(location_id, [])),
        "scene_prompts": scene_prompts,
        "group": group if group is not None else location_name,
        "group_default": group_default
    }


def process_prop(prop_name, prop_id, prop_description, asset_episodes, script_config, style_config,
                 worldview='', region=''):
    """并发处理单个道具的提示词生成"""
    log(f"  - 生成道具: {prop_name}")

    # 生成道具描述
    description = generate_asset_description_with_gemini(
        "props", prop_name, prop_description, script_config
    )

    # 生成道具提示词，生成 NUM_PROMPTS_PROP 个
    prop_prompts = [
        {"prompt_id": str(uuid.uuid4()), "prompt": generate_prompt_with_gemini(
            "props", prop_name, description, style_config,
            worldview=worldview, region=region,
        )}
        for _ in range(NUM_PROMPTS_PROP)
    ]

    return {
        "id": prop_id,
        "name": prop_name,
        "description": description,
        "episodes": sorted(asset_episodes['props'].get(prop_id, [])),
        "prop_prompts": prop_prompts,
        "group": prop_name,  # 默认取 name 的值
        "group_default": True  # 默认为 True
    }


def _load_script(script_json_path):
    path = Path(script_json_path)
    if not path.exists():
        log(f"❌ script.json 不存在: {script_json_path}")
        sys.exit(1)
    with open(path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    title = config.get('title', '未命名项目').replace(' ', '')
    log(f"✓ 项目名称: {title}")
    log(f"  - 角色: {len(config.get('actors', []))} 个")
    log(f"  - 场景: {len(config.get('locations', []))} 个")
    log(f"  - 道具: {len(config.get('props', []))} 个")
    return config


def _load_style(style_json_path):
    if style_json_path and Path(style_json_path).exists():
        with open(style_json_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        log(f"✓ 已加载风格配置: {style_json_path}")
        return config
    return None


def _build_chars(actors, asset_episodes, script_config, style_config, project_title, actor_analysis=None):
    log("\n=== 生成角色提示词（并发模式）===")
    data = {
        "project": project_title,
        "style_config": "style.json",
        "actors": []
    }
    character_tasks = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        for actor in actors:
            actor_id = actor.get('actor_id') or actor.get('id')
            actor_name = actor.get('actor_name') or actor.get('name')
            actor_description = actor.get('description', '')
            # 合并剧本分析结果，丰富角色描述
            if actor_analysis and actor_id in actor_analysis:
                profile = actor_analysis[actor_id]
                parts = [actor_description] if actor_description else []
                if profile.get('personality'):
                    parts.append(f"性格：{profile['personality']}")
                if profile.get('appearance'):
                    parts.append(f"外貌：{profile['appearance']}")
                if profile.get('clothing'):
                    parts.append(f"服装：{profile['clothing']}")
                if profile.get('emotional_arc'):
                    parts.append(f"情感弧线：{profile['emotional_arc']}")
                actor_description = '；'.join(parts)
            states = actor.get('states', [])
            # 提取外观地域字段
            appearance_region = actor.get('appearance_region', '')
            appearance_subtype = actor.get('appearance_subtype', '')
            appearance_region_traits = actor.get('appearance_region_traits', '')
            log(f"提交角色任务: {actor_name}")
            if len(states) >= 1:
                default_future = executor.submit(
                    process_character_default, actor_name, actor_id, actor_description, asset_episodes, script_config, style_config,
                    appearance_region, appearance_subtype, appearance_region_traits
                )
                state_futures = [
                    executor.submit(process_character_state, actor_name, actor_id, actor_description, s, asset_episodes, script_config, style_config,
                                    appearance_region, appearance_subtype, appearance_region_traits)
                    for s in states
                ]
                character_tasks.append(('multi', actor_id, actor_name, default_future, state_futures))
            else:
                fn = process_character_default
                args = (actor_name, actor_id, actor_description, asset_episodes, script_config, style_config,
                        appearance_region, appearance_subtype, appearance_region_traits)
                character_tasks.append(('single', actor_id, actor_name, executor.submit(fn, *args)))

        for task_entry in character_tasks:
            task_type, actor_id, actor_name = task_entry[0], task_entry[1], task_entry[2]
            if task_type == 'multi':
                _, _, _, default_future, state_futures = task_entry
                forms_data = []
                voice_text, voice_desc = '', ''
                try:
                    default_form = default_future.result()
                    voice_text = default_form.pop('voice_text', '')
                    voice_desc = default_form.pop('voice_desc', '')
                    default_form['is_default'] = True
                    forms_data.append(default_form)
                except Exception as e:
                    log(f"⚠ default 形态生成失败 ({actor_name}): {e}")
                for fut in state_futures:
                    try:
                        state_form = fut.result()
                        state_form.pop('voice_text', None)
                        state_form.pop('voice_desc', None)
                        state_form['is_default'] = False
                        forms_data.append(state_form)
                    except Exception as e:
                        log(f"⚠ 角色形态生成失败 ({actor_name}): {e}")
                data['actors'].append({
                    "actor_id": actor_id, "actor_name": actor_name,
                    "voice_text": voice_text, "voice_desc": voice_desc,
                    "states": forms_data
                })
            else:
                try:
                    form_result = task_entry[3].result()
                    voice_text = form_result.pop('voice_text', '')
                    voice_desc = form_result.pop('voice_desc', '')
                    form_result['is_default'] = True
                    data['actors'].append({
                        "actor_id": actor_id, "actor_name": actor_name,
                        "voice_text": voice_text, "voice_desc": voice_desc,
                        "states": [form_result]
                    })
                except Exception as e:
                    log(f"⚠ 角色生成失败 ({actor_name}): {e}")
    return data


def _build_scenes(locations, asset_episodes, script_config, style_config, project_title):
    log("\n=== 生成场景提示词（并发模式）===")
    data = {"project": project_title, "style_config": "style.json", "scenes": []}

    # 从 style_config 和 script_config 提取世界观和地域信息
    worldview = (style_config or {}).get('worldview_subtype', '') or script_config.get('worldview', '')
    region = (style_config or {}).get('appearance_region', '')

    # 先用 aos-cli model 语义分组
    log("  → 使用 aos-cli model 分析场景分组...")
    groups_info = determine_scene_groups_with_gemini(locations, script_config)

    with ThreadPoolExecutor(max_workers=10) as executor:
        scene_futures = {}
        for loc in locations:
            loc_name = loc.get('location_name') or loc.get('name')
            loc_id = loc.get('location_id') or loc.get('id')
            loc_description = loc.get('description', '')
            g_info = groups_info.get(loc_name, {"group": loc_name, "group_default": True})
            log(f"提交场景任务: {loc_name}（组: {g_info['group']}, 默认: {g_info['group_default']}）")
            future = executor.submit(
                process_scene,
                loc_name, loc_id, loc_description, asset_episodes, script_config, style_config,
                g_info.get('group', loc_name),
                g_info.get('group_default', True),
                worldview=worldview,
                region=region,
            )
            scene_futures[future] = loc_name

        for future in as_completed(scene_futures):
            try:
                data['scenes'].append(future.result())
            except Exception as e:
                log(f"⚠ 场景生成失败 ({scene_futures[future]}): {e}")
    return data


def _build_props(props, asset_episodes, script_config, style_config, project_title):
    log("\n=== 生成道具提示词（并发模式）===")
    data = {"project": project_title, "style_config": "style.json", "props": []}

    # 从 style_config 和 script_config 提取世界观和地域信息
    worldview = (style_config or {}).get('worldview_subtype', '') or script_config.get('worldview', '')
    region = (style_config or {}).get('appearance_region', '')

    with ThreadPoolExecutor(max_workers=10) as executor:
        prop_futures = {}
        for prop in props:
            prop_name = prop.get('prop_name') or prop.get('name')
            prop_id = prop.get('prop_id') or prop.get('id')
            prop_description = prop.get('description', '')
            log(f"提交道具任务: {prop_name}")
            future = executor.submit(
                process_prop, prop_name, prop_id, prop_description, asset_episodes, script_config, style_config,
                worldview=worldview, region=region,
            )
            prop_futures[future] = prop_name
        for future in as_completed(prop_futures):
            try:
                data['props'].append(future.result())
            except Exception as e:
                log(f"⚠ 道具生成失败 ({prop_futures[future]}): {e}")
    return data


def _run_parallel(run_types, actors, locations, props, asset_episodes, script_config, style_config, project_title, actor_analysis=None):
    builders = {
        "actors":  lambda: _build_chars(actors, asset_episodes, script_config, style_config, project_title, actor_analysis),
        "scenes": lambda: _build_scenes(locations, asset_episodes, script_config, style_config, project_title),
        "props":  lambda: _build_props(props, asset_episodes, script_config, style_config, project_title),
    }
    log(f"\n=== 并行生成提示词: {', '.join(sorted(run_types))} ===")
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {key: executor.submit(fn) for key, fn in builders.items() if key in run_types}
        return {key: fut.result() for key, fut in futures.items()}


def _save_outputs(workspace_path, project_title, results):
    workspace_path.mkdir(parents=True, exist_ok=True)
    key_to_file = {
        "actors":  f"{project_title}_actors_gen.json",
        "scenes": f"{project_title}_scenes_gen.json",
        "props":  f"{project_title}_props_gen.json",
    }
    log("\n=== 保存 JSON 文件 ===")
    saved_paths = []
    for key, data in results.items():
        filename = key_to_file[key]
        try:
            output_path = workspace_path / filename
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            log(f"✓ {filename}")
            saved_paths.append(output_path)
        except Exception as e:
            log(f"❌ 保存失败 ({filename}): {e}")
    return saved_paths


def main():
    parser = argparse.ArgumentParser(description="从 script.json 预定义资产生成提示词 JSON")
    parser.add_argument("--script-json", required=True, help="script.json 路径")
    parser.add_argument("--workspace", required=True, help="输出目录")
    parser.add_argument("--style-json", help="style.json 路径（可选）")
    parser.add_argument(
        "--only", nargs="+", choices=["actors", "scenes", "props"],
        help="只生成指定类型（可多选），默认全部。例: --only scenes props"
    )
    args = parser.parse_args()
    run_types = set(args.only) if args.only else {"actors", "scenes", "props"}

    log("=== 开始从 script.json 提取预定义资产 ===")
    script_config  = _load_script(args.script_json)
    style_config   = _load_style(args.style_json)
    asset_episodes = extract_episodes_for_assets(script_config)

    # # 生成角色提示词前，先用剧本 actions 内容分析角色属性
    # actor_analysis = {}
    # if "actors" in run_types:
    #     log("\n=== 分析角色属性（基于剧本 actions 内容）===")
    #     actor_analysis = analyze_actor_profiles_with_gemini(script_config, Path(args.workspace))

    project_title = script_config.get('title', '未命名项目').replace(' ', '')

    results = _run_parallel(
        run_types,
        script_config.get('actors', []),
        script_config.get('locations', []),
        script_config.get('props', []),
        asset_episodes, script_config, style_config,
        project_title,
        # actor_analysis=actor_analysis,
    )

    workspace_path = Path(args.workspace)
    saved_paths = _save_outputs(workspace_path, project_title, results)
    project_root = workspace_path.resolve().parent
    ensure_state(str(project_root))
    for saved_path in saved_paths:
        update_artifact(
            str(project_root),
            saved_path.resolve().relative_to(project_root).as_posix(),
            "derived",
            "visual",
            "completed",
        )
    if saved_paths:
        update_stage(
            str(project_root),
            "VISUAL",
            "partial",
            next_action="review VISUAL",
            artifact=saved_paths[0].resolve().relative_to(project_root).as_posix(),
        )
    log(f"\n=== 项目资产提示词生成完成 ===")
    log(f"输出目录: {args.workspace}")


if __name__ == "__main__":
    main()
