#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 script.json 自动提取资产并生成提示词 JSON

流程:
  1. 读取 script.json 中的 episodes 数组
  2. 使用 Gemini 分析指定集数的剧本内容
  3. 提取角色、场景、道具列表
  4. 为每个资产生成详细的英文提示词
  5. 输出三个 JSON 文件到 workspace

用法:
  python generate_prompts_from_script.py --episode 1 \
    --script-json "path/to/script.json" \
    --workspace "path/to/workspace" \
    --project-name "项目名"
"""
import sys, os, json, argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# UTF-8 输出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

try:
    from google import genai
except ImportError:
    print("❌ 缺少 google-genai 包,请安装: pip install google-genai", file=sys.stderr)
    sys.exit(1)

# ── 加载生成配置 ───────────────────────────────────────────────────────────────
import pathlib as _pathlib, json as _json
_GENERATION_CONFIG_PATH = _pathlib.Path(__file__).parent / "generation_config.json"
with open(_GENERATION_CONFIG_PATH, "r", encoding="utf-8") as _f:
    _GC = _json.load(_f)

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


def generate_asset_description_with_gemini(asset_type, asset_name, asset_id, script_config, gemini_key):
    """使用 Gemini 为单个资产生成中文描述"""
    _base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=gemini_key,
        **(_base_url and {"http_options": {"base_url": _base_url}} or {}),
    )
    model = 'gemini-3.1-flash-lite-preview'

    world_context = f"""
世界观背景:
- 项目名: {script_config.get('title', '未知')}
- 世界观: {script_config.get('worldview', '未知')}
"""

    if asset_type == "character":
        prompt = f"""你是专业的角色设计师。请根据世界观背景,为角色"{asset_name}"生成详细的外貌描述。

{world_context}

角色名: {asset_name}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只描述客观的外貌特征和具体细节
- 避免主观的情绪词汇(如"忧郁的"、"开朗的"、"冷酷的"等)
- 保持中性、客观的描述风格

请生成该角色的详细外貌描述(中文),包括:
- 面部特征(眼睛形状/颜色、发型/发色、五官特点)
- 服装风格(颜色、材质、款式、配饰)
- 身材体态(身高比例、体型特征)
- 整体视觉特征(姿态、表情特点)

只输出描述文本,不要有任何其他内容。"""

    elif asset_type == "scene":
        prompt = f"""你是专业的场景设计师。请根据世界观背景,为场景"{asset_name}"生成详细的环境描述。

{world_context}

场景名: {asset_name}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只描述客观的物理特征和具体细节
- 避免主观的情绪词汇(如"悲伤的"、"欢快的"、"压抑的"等)
- 保持中性、客观的描述风格

**名称解析规则**:
- 识别场景名称中的关键信息(组织名称、场景类型等)
- 忽略名称中的人名部分(人名通常只是标识,不影响场景本身的设计)
- 根据场景类型(房间/大厅/广场等)和所属组织/地点的特征来设计
- 例如:组织总部应体现该组织的标志性元素和文化特征
- 例如:角色的房间应该是该类型房间的通用设计,不要因为角色名字而添加不相关的元素

请生成该场景的详细环境描述(中文),包括:
- 建筑结构和布局(具体形状、尺寸、材料)
- 光线类型(自然光/人工光、光源位置、光线强度)
- 材质和色调(具体材料名称、颜色描述)
- 关键装饰元素(具体物品、位置、样式,需符合场景类型和所属组织特征)

只输出描述文本,不要有任何其他内容。"""

    else:  # props
        prompt = f"""你是专业的道具设计师。请根据世界观背景,为道具"{asset_name}"生成详细的外观描述。

{world_context}

道具名: {asset_name}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只描述客观的物理特征和具体细节
- 避免主观的情绪词汇(如"神秘的"、"悲伤的"、"威严的"等)
- 保持中性、客观的描述风格

**名称解析规则**:
- 识别道具名称中的本质类型(武器/饰品/药品/工具等)
- 忽略名称中的人名部分(人名通常只是标识,不影响道具本身的形态)
- 根据道具的本质类型和世界观来判断其合理形态
- 例如:丹药/药品应该是圆形/球形、有机质感,而不是机械的
- 例如:剑类武器应该是剑的形态,可以有特效,但基本形态是剑
- 例如:饰品应该符合其材质和类型的特征,不要因为人名而改变其本质

请生成该道具的详细外观描述(中文),包括:
- 形状和尺寸(具体数值或比例,需符合道具类型的合理性)
- 材质和质感(具体材料名称,需符合世界观和道具类型)
- 颜色和光泽(具体色彩描述)
- 特殊纹理或装饰(具体图案、位置)

只输出描述文本,不要有任何其他内容。"""

    try:
        response = client.models.generate_content(model=model, contents=[prompt])
        return response.text.strip()
    except Exception as e:
        log(f"⚠ 生成描述失败 ({asset_name}): {e}")
        return f"[生成失败] {asset_name}"


def generate_prompt_with_gemini(asset_type, asset_name, asset_description, script_config, gemini_key, style_config=None, reference_image_note=""):
    """使用 Gemini 生成单个资产的中文提示词"""
    _base_url = os.getenv("GEMINI_BASE_URL")
    client = genai.Client(
        api_key=gemini_key,
        **(_base_url and {"http_options": {"base_url": _base_url}} or {}),
    )
    model = 'gemini-3.1-flash-lite-preview'

    # 根据资产类型构建不同的提示词模板
    if asset_type == "character_three_view":
        # 三视图提示词生成
        if style_config and 'character_style' in style_config:
            prefix = style_config['character_style'].get('prefix', '')
            suffix = style_config['character_style'].get('suffix', '')
            worldview_type = style_config.get('worldview_type', '修仙/仙侠')

            # 根据世界观类型选择参考图提示
            reference_hint = _GC["generate_prompts"]["reference_hints"]["default"]
            for _rule in _GC["generate_prompts"]["reference_hints"]["keywords_map"]:
                if any(kw in worldview_type for kw in _rule["keywords"]):
                    reference_hint = _rule["hint"]
                    break

            template = f"""你是专业的游戏角色三视图设计提示词生成器。请根据以下角色描述,生成用于 AI 绘图的中文三视图提示词。

角色名: {{name}}
角色描述: {{description}}

**重要原则**:
- 三视图需要展示角色的正面、侧面、背面完整视角
- 保持角色设计的一致性，所有视角的服装、发型、配饰必须完全一致
- 只使用客观的外貌描述，避免情绪化词汇
- 描述具体的视觉元素，而非抽象的性格或氛围

要求:
1. 使用中文，详细描述角色的外貌、服装、姿态
2. 必须使用以下前缀: "{prefix}"
3. 必须使用以下后缀: "{suffix}"
4. 中间部分详细描述角色特征，包括：
   - 面部特征（五官形状/颜色、表情特点）
   - 发型和发色（注意三视图需要展示不同角度的发型）
   - 服装风格（颜色、材质、款式、配饰，需要描述正面、侧面、背面的细节）
   - 身材体态
   - 整体视觉特征（姿态、动作）
5. 风格要求: {reference_hint}，全身三视图（正面、侧面、背面），游戏3D角色设计表，CG渲染，虚幻引擎5渲染，8K高清，丰富光影和质感，白光，丰富服饰细节和纹理，纯白色背景
6. 避免使用情绪化词汇(如"忧郁"、"开朗"、"冷酷"等)，使用客观描述(如"眉头微皱"、"嘴角上扬"等)
7. 格式: [前缀] + [详细角色描述] + 全身三视图（正面、侧面、背面），角色设计表 + [后缀]
8. 只输出完整的提示词文本，不要有任何其他内容

提示词:"""
        else:
            _fb_ctv = _GC["generate_prompts"]["fallback"]["character_three_view"]
            template = f"""你是专业的游戏角色三视图设计提示词生成器。请根据以下角色描述,生成用于 AI 绘图的中文三视图提示词。

角色名: {{name}}
角色描述: {{description}}

**重要原则**:
- 三视图需要展示角色的正面、侧面、背面完整视角
- 保持角色设计的一致性，所有视角的服装、发型、配饰必须完全一致
- 只使用客观的外貌描述，避免情绪化词汇
- 描述具体的视觉元素，而非抽象的性格或氛围

要求:
1. 使用中文，详细描述角色的外貌、服装、姿态
2. 必须包含以下前缀: "{_fb_ctv['prefix']}"
3. 必须包含以下后缀: "{_fb_ctv['suffix']}"
4. 中间部分详细描述角色特征（面部、发型、服装、身材、姿态）
5. 避免使用情绪化词汇(如"忧郁"、"开朗"、"冷酷"等)，使用客观描述(如"眉头微皱"、"嘴角上扬"等)
6. 只输出提示词文本，不要有任何其他内容

提示词:"""

    elif asset_type == "character":
        # 从 style.json 读取人物风格配置
        if style_config and 'character_style' in style_config:
            prefix = style_config['character_style'].get('prefix', '')
            suffix = style_config['character_style'].get('suffix', '')
            worldview_type = style_config.get('worldview_type', '修仙/仙侠')

            # 根据世界观类型选择参考图提示
            reference_hint = _GC["generate_prompts"]["reference_hints"]["default"]
            for _rule in _GC["generate_prompts"]["reference_hints"]["keywords_map"]:
                if any(kw in worldview_type for kw in _rule["keywords"]):
                    reference_hint = _rule["hint"]
                    break

            template = f"""你是专业的游戏角色设计提示词生成器。请根据以下角色描述,生成用于 AI 绘图的中文提示词。

角色名: {{name}}
角色描述: {{description}}
{f"参考图说明: {reference_image_note}" if reference_image_note else ""}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的外貌描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的性格或氛围

要求:
1. 使用中文,详细描述角色的外貌、服装、姿态
2. 必须使用以下前缀: "{prefix}"
3. 必须使用以下后缀: "{suffix}"
4. 中间部分详细描述角色特征，包括：
   - 面部特征（五官形状/颜色、表情特点）
   - 发型和发色
   - 服装风格（颜色、材质、款式、配饰）
   - 身材体态
   - 整体视觉特征（姿态、动作）
5. 风格要求: {reference_hint}，细致皮肤纹理，cg渲染，虚幻引擎渲染，8k高清，丰富光影和质感，白光，丰富服饰细节和纹理，纯白色背景，Built using Unreal Engine 5, the 3D modeling, high resolution, and ultra-high-definition graphics showcase a unique 3D art style
6. 避免使用情绪化词汇(如"忧郁"、"开朗"、"冷酷"等),使用客观描述(如"眉头微皱"、"嘴角上扬"等)
7. 格式: [前缀] + [详细角色描述] + [后缀]
8. 只输出完整的提示词文本,不要有任何其他内容

提示词:"""
        else:
            _fb_char = _GC["generate_prompts"]["fallback"]["character"]
            template = f"""你是专业的游戏角色设计提示词生成器。请根据以下角色描述,生成用于 AI 绘图的中文提示词。

角色名: {{name}}
角色描述: {{description}}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的外貌描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的性格或氛围

要求:
1. 使用中文,详细描述角色的外貌、服装、姿态
2. 必须包含以下前缀: "{_fb_char['prefix']}"
3. 必须包含以下后缀: "{_fb_char['suffix']}"
4. 中间部分详细描述角色特征（面部、发型、服装、身材、姿态）
5. 避免使用情绪化词汇(如"忧郁"、"开朗"、"冷酷"等),使用客观描述(如"眉头微皱"、"嘴角上扬"等)
6. 只输出提示词文本,不要有任何其他内容

提示词:"""

    elif asset_type == "scene":
        # 从 style.json 读取场景前缀和后缀
        if style_config and 'scene_style' in style_config:
            prefix = style_config['scene_style'].get('prefix', '')
            suffix = style_config['scene_style'].get('suffix', '')
            template = f"""你是专业的场景设计提示词生成器。请根据以下场景描述,生成用于 AI 绘图的中文场景描述（仅中间部分）。

场景名: {{name}}
场景描述: {{description}}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的物理描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的氛围感受

**名称解析规则**:
- 识别场景名称中的关键信息(组织名称、场景类型等)
- 忽略名称中的人名部分(人名通常只是标识,不影响场景本身的设计)
- 根据场景类型和所属组织/地点的特征来设计
- 例如:组织总部应体现该组织的标志性元素和文化特征
- 例如:角色的房间应该是该类型房间的通用设计,不要因为角色名字而添加不相关的元素

要求:
1. 使用中文,简洁描述场景的核心特征（3-5个关键要素即可）
2. 重点突出：建筑风格、主要材质、光源类型、色调
3. 避免过度细节化，不要描述每一个装饰物和细节元素
4. 避免使用情绪化词汇(如"神秘"、"压抑"、"欢快"等),使用客观描述(如"昏暗光线"、"明亮光线"等)
5. **重要**: 只输出场景描述的中间部分，不要包含任何前缀或后缀
6. **重要**: 不要输出"杰作"、"最佳质量"、"禁止文字"等质量控制词，这些会自动添加
7. 只输出纯粹的场景描述文本

场景描述（仅中间部分）:"""
        else:
            _fb_scene = _GC["generate_prompts"]["fallback"]["scene"]
            template = f"""你是专业的场景设计提示词生成器。请根据以下场景描述,生成用于 AI 绘图的中文提示词。

场景名: {{name}}
场景描述: {{description}}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的物理描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的氛围感受

**名称解析规则**:
- 识别场景名称中的关键信息(组织名称、场景类型等)
- 忽略名称中的人名部分(人名通常只是标识,不影响场景本身的设计)
- 根据场景类型和所属组织/地点的特征来设计
- 例如:组织总部应体现该组织的标志性元素和文化特征
- 例如:角色的房间应该是该类型房间的通用设计,不要因为角色名字而添加不相关的元素

要求:
1. 使用中文,简洁描述场景的核心特征（3-5个关键要素即可）
2. 风格: {_fb_scene['style']}
3. 必须包含: "{_fb_scene['required']}"
4. 必须包含后缀: "{_fb_scene['suffix']}"
5. 描述要有电影感和沉浸感，但保持简洁
6. 避免使用情绪化词汇(如"神秘"、"压抑"、"欢快"等),使用客观描述(如"昏暗光线"、"明亮光线"等)
7. 只输出中文提示词文本,不要有任何其他内容

提示词:"""

    else:  # props
        # 从 style.json 读取道具前缀和后缀
        if style_config and 'prop_style' in style_config:
            prefix = style_config['prop_style'].get('prefix', '')
            suffix = style_config['prop_style'].get('suffix', '')
            template = f"""你是专业的道具设计提示词生成器。请根据以下道具描述,生成用于 AI 绘图的中文道具描述（仅中间部分）。

道具名: {{name}}
道具描述: {{description}}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的物理描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的氛围感受

**名称解析规则**:
- 识别道具名称中的本质类型(武器/饰品/药品/工具等)
- 忽略名称中的人名部分(人名通常只是标识,不影响道具本身的形态)
- 根据道具的本质类型和世界观来判断其合理形态
- 例如:丹药/药品应该是圆形/球形、有机质感,而不是机械的
- 例如:剑类武器应该是剑的形态,可以有特效,但基本形态是剑
- 例如:饰品应该符合其材质和类型的特征,不要因为人名而改变其本质

要求:
1. 使用中文,简洁描述道具的核心特征（2-3个关键要素即可）
2. 重点突出：形状、主要材质、色彩
3. 避免过度细节化，不要描述每一个纹理和装饰
4. 避免使用情绪化词汇(如"神秘"、"威严"、"邪恶"等),使用客观描述(如"黑色"、"金属质感"等)
5. **重要**: 只输出道具描述的中间部分，不要包含任何前缀或后缀
6. **重要**: 不要输出"杰作"、"最佳质量"、"禁止文字"、"纯白色背景"等质量控制词，这些会自动添加
7. 只输出纯粹的道具描述文本

道具描述（仅中间部分）:"""
        else:
            _fb_props = _GC["generate_prompts"]["fallback"]["props"]
            template = f"""你是专业的道具设计提示词生成器。请根据以下道具描述,生成用于 AI 绘图的中文提示词。

道具名: {{name}}
道具描述: {{description}}

**重要原则**:
- 资产是独立元素,不受剧本情感色彩影响
- 只使用客观的物理描述,避免情绪化词汇
- 描述具体的视觉元素,而非抽象的氛围感受

**名称解析规则**:
- 识别道具名称中的本质类型(武器/饰品/药品/工具等)
- 忽略名称中的人名部分(人名通常只是标识,不影响道具本身的形态)
- 根据道具的本质类型和世界观来判断其合理形态
- 例如:丹药/药品应该是圆形/球形、有机质感,而不是机械的
- 例如:剑类武器应该是剑的形态,可以有特效,但基本形态是剑
- 例如:饰品应该符合其材质和类型的特征,不要因为人名而改变其本质

要求:
1. 使用中文,简洁描述道具的核心特征（2-3个关键要素即可）
2. 风格: {_fb_props['style']}
3. 构图: {_fb_props['layout']}
4. 必须包含后缀: "{_fb_props['suffix']}"
5. 强调质感，但保持简洁
6. 避免使用情绪化词汇(如"神秘"、"威严"、"邪恶"等),使用客观描述(如"黑色"、"金属质感"等)
7. 只输出中文提示词文本,不要有任何其他内容

提示词:"""

    prompt = template.format(name=asset_name, description=asset_description)

    try:
        response = client.models.generate_content(model=model, contents=[prompt])
        generated_text = response.text.strip()

        # 对于场景和道具，强制拼接 style.json 的前缀后缀
        if asset_type == "scene" and style_config and 'scene_style' in style_config:
            prefix = style_config['scene_style'].get('prefix', '')
            suffix = style_config['scene_style'].get('suffix', '')
            # 清理 Gemini 可能自己添加的前缀后缀关键词
            for keyword in _GC["generate_prompts"]["cleanup_keywords"]["scene"]:
                generated_text = generated_text.replace(keyword, '')
            generated_text = generated_text.strip('，。, ')
            return f"{prefix}{generated_text}，{suffix}"

        elif asset_type == "props" and style_config and 'prop_style' in style_config:
            prefix = style_config['prop_style'].get('prefix', '')
            suffix = style_config['prop_style'].get('suffix', '')
            # 清理 Gemini 可能自己添加的前缀后缀关键词
            for keyword in _GC["generate_prompts"]["cleanup_keywords"]["props"]:
                generated_text = generated_text.replace(keyword, '')
            generated_text = generated_text.strip('，。, ')
            return f"{prefix}{generated_text}，{suffix}"

        return generated_text
    except Exception as e:
        log(f"⚠ 生成提示词失败 ({asset_name}): {e}")
        return f"[生成失败] {asset_description}"


def generate_all_prompts(assets, episode, script_config, gemini_key, project_name, style_config=None):
    """为所有资产生成提示词并构建 JSON 结构"""
    log("\\n=== 生成资产提示词 ===")

    # 角色 JSON
    chars_data = {
        "project": project_name,
        "style_config": "style.json",
        "_style_note": "所有角色使用完全统一的前缀和后缀,仅角色描述部分不同,确保风格一致",
        "characters": []
    }

    for char in assets.get('characters', []):
        char_name = char['name']
        log(f"生成角色提示词: {char_name}")

        forms_data = []
        for form in char.get('forms', [{'name': 'default', 'description': char['description']}]):
            form_name = form['name']
            form_desc = form['description']

            # 生成三视图提示词（基于角色描述）
            three_view_prompt = generate_prompt_with_gemini(
                "character_three_view", f"{char_name}({form_name})", form_desc, script_config, gemini_key, style_config
            )

            forms_data.append({
                "name": form_name,
                "episodes": [episode],
                "three_view_prompt": three_view_prompt,
                "voice_text": f"[待配音] {char_name}"
            })

        chars_data['characters'].append({
            "name": char_name,
            "forms": forms_data
        })

    # 场景 JSON
    scenes_data = {
        "project": project_name,
        "style_config": "style.json",
        "scenes": []
    }

    for scene in assets.get('scenes', []):
        scene_name = scene['name']
        log(f"生成场景提示词: {scene_name}")

        scene_prompt = generate_prompt_with_gemini(
            "scene", scene_name, scene['description'], script_config, gemini_key, style_config
        )

        scenes_data['scenes'].append({
            "name": scene_name,
            "episodes": [episode],
            "scene_prompt": scene_prompt
        })

    # 道具 JSON
    props_data = {
        "project": project_name,
        "style_config": "style.json",
        "props": []
    }

    for prop in assets.get('props', []):
        prop_name = prop['name']
        log(f"生成道具提示词: {prop_name}")

        prop_prompt = generate_prompt_with_gemini(
            "props", prop_name, prop['description'], script_config, gemini_key, style_config
        )

        props_data['props'].append({
            "name": prop_name,
            "episodes": [episode],
            "prop_prompt": prop_prompt
        })

    return chars_data, scenes_data, props_data


def extract_episodes_for_assets(script_config):
    """从 episodes 中提取每个资产出现的集数"""
    asset_episodes = {
        'actors': {},      # {actor_id: [episodes]}
        'locations': {},   # {location_id: [episodes]}
        'props': {}        # {prop_id: [episodes]}
    }

    for ep_idx, episode in enumerate(script_config.get('episodes', []), 1):
        # Support both numeric 'episode' field and string 'episode_id'
        episode_num = episode.get('episode') or episode.get('episode_id') or ep_idx

        for scene in episode.get('scenes', []):
            # Support new format: actors array with actor_id
            for cast_member in scene.get('actors', []) + scene.get('cast', []):
                actor_id = cast_member.get('actor_id') or cast_member.get('id')
                if actor_id:
                    if actor_id not in asset_episodes['actors']:
                        asset_episodes['actors'][actor_id] = []
                    if episode_num not in asset_episodes['actors'][actor_id]:
                        asset_episodes['actors'][actor_id].append(episode_num)

            # Support new format: locations array with location_id
            for loc in scene.get('locations', []):
                location_id = loc.get('location_id') or loc.get('id')
                if location_id:
                    if location_id not in asset_episodes['locations']:
                        asset_episodes['locations'][location_id] = []
                    if episode_num not in asset_episodes['locations'][location_id]:
                        asset_episodes['locations'][location_id].append(episode_num)
            # Also support old format: single location_id on scene
            old_location_id = scene.get('location_id')
            if old_location_id:
                if old_location_id not in asset_episodes['locations']:
                    asset_episodes['locations'][old_location_id] = []
                if episode_num not in asset_episodes['locations'][old_location_id]:
                    asset_episodes['locations'][old_location_id].append(episode_num)

            # Extract props
            for prop in scene.get('props', []):
                prop_id = prop.get('prop_id') or prop.get('id')
                if prop_id:
                    if prop_id not in asset_episodes['props']:
                        asset_episodes['props'][prop_id] = []
                    if episode_num not in asset_episodes['props'][prop_id]:
                        asset_episodes['props'][prop_id].append(episode_num)

    return asset_episodes


def process_character_state(actor_name, actor_id, state, asset_episodes, script_config, gemini_key, style_config):
    """并发处理单个角色状态的提示词生成"""
    state_name = state.get('state_name') or state.get('name')
    log(f"  - 生成形态: {actor_name}({state_name})")

    # 生成该形态的描述
    description = generate_asset_description_with_gemini(
        "character", f"{actor_name}({state_name})",
        actor_id, script_config, gemini_key
    )

    # 生成三视图提示词（基于角色描述）
    three_view_prompt = generate_prompt_with_gemini(
        "character_three_view", f"{actor_name}({state_name})",
        description, script_config, gemini_key, style_config
    )

    return {
        "state_id": state.get('state_id') or state.get('id'),
        "name": state_name,
        "episodes": sorted(asset_episodes['actors'].get(actor_id, [])),
        "three_view_prompt": three_view_prompt,
        "voice_text": f"[待配音] {actor_name}"
    }


def process_character_default(actor_name, actor_id, asset_episodes, script_config, gemini_key, style_config):
    """并发处理单个角色默认形态的提示词生成"""
    log(f"  - 生成默认形态: {actor_name}")

    description = generate_asset_description_with_gemini(
        "character", actor_name, actor_id, script_config, gemini_key
    )

    # 生成三视图提示词（基于角色描述）
    three_view_prompt = generate_prompt_with_gemini(
        "character_three_view", actor_name, description, script_config, gemini_key, style_config
    )

    return {
        "name": "default",
        "episodes": sorted(asset_episodes['actors'].get(actor_id, [])),
        "three_view_prompt": three_view_prompt,
        "voice_text": f"[待配音] {actor_name}"
    }


def process_scene(location_name, location_id, asset_episodes, script_config, gemini_key, style_config):
    """并发处理单个场景的提示词生成"""
    log(f"  - 生成场景: {location_name}")

    # 生成场景描述
    description = generate_asset_description_with_gemini(
        "scene", location_name, location_id, script_config, gemini_key
    )

    # 生成场景提示词
    scene_prompt = generate_prompt_with_gemini(
        "scene", location_name, description, script_config, gemini_key, style_config
    )

    return {
        "id": location_id,
        "name": location_name,
        "episodes": sorted(asset_episodes['locations'].get(location_id, [])),
        "scene_prompt": scene_prompt
    }


def process_prop(prop_name, prop_id, asset_episodes, script_config, gemini_key, style_config):
    """并发处理单个道具的提示词生成"""
    log(f"  - 生成道具: {prop_name}")

    # 生成道具描述
    description = generate_asset_description_with_gemini(
        "props", prop_name, prop_id, script_config, gemini_key
    )

    # 生成道具提示词
    prop_prompt = generate_prompt_with_gemini(
        "props", prop_name, description, script_config, gemini_key, style_config
    )

    return {
        "id": prop_id,
        "name": prop_name,
        "episodes": sorted(asset_episodes['props'].get(prop_id, [])),
        "prop_prompt": prop_prompt
    }


def main():
    parser = argparse.ArgumentParser(description="从 script.json 预定义资产生成提示词 JSON")
    parser.add_argument("--script-json", required=True, help="script.json 路径")
    parser.add_argument("--workspace", required=True, help="输出目录")
    parser.add_argument("--style-json", help="style.json 路径（可选）")

    args = parser.parse_args()

    # 获取 Gemini API Key
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        log("❌ GEMINI_API_KEY 未设置")
        sys.exit(1)

    log("=== 开始从 script.json 提取预定义资产 ===")

    # 1. 读取 script.json
    script_json_path = Path(args.script_json)
    if not script_json_path.exists():
        log(f"❌ script.json 不存在: {args.script_json}")
        sys.exit(1)

    with open(script_json_path, 'r', encoding='utf-8') as f:
        script_config = json.load(f)

    project_title = script_config.get('title', '未命名项目')
    actors = script_config.get('actors', [])
    locations = script_config.get('locations', [])
    props = script_config.get('props', [])

    log(f"✓ 项目名称: {project_title}")
    log(f"✓ 预定义资产:")
    log(f"  - 角色: {len(actors)} 个")
    log(f"  - 场景: {len(locations)} 个")
    log(f"  - 道具: {len(props)} 个")

    # 2. 读取 style.json（如果提供）
    style_config = None
    if args.style_json and Path(args.style_json).exists():
        with open(args.style_json, 'r', encoding='utf-8') as f:
            style_config = json.load(f)
        log(f"✓ 已加载风格配置: {args.style_json}")

    # 3. 提取每个资产出现的集数
    log("\n=== 提取资产出现集数 ===")
    asset_episodes = extract_episodes_for_assets(script_config)

    # 4. 为角色生成提示词（并发执行）
    log("\n=== 生成角色提示词（并发模式）===")
    chars_data = {
        "project": project_title,
        "style_config": "style.json",
        "_style_note": "所有角色使用完全统一的前缀和后缀,仅角色描述部分不同,确保风格一致",
        "characters": []
    }

    # 准备所有角色任务
    character_tasks = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        for actor in actors:
            actor_id = actor.get('actor_id') or actor.get('id')
            actor_name = actor.get('actor_name') or actor.get('name')
            states = actor.get('states', [])

            log(f"提交角色任务: {actor_name}")

            if len(states) > 1:
                # 多状态：先生成 default 基础形态，再并发生成各状态形态
                default_future = executor.submit(
                    process_character_default,
                    actor_name, actor_id, asset_episodes,
                    script_config, gemini_key, style_config
                )
                state_futures = []
                for state in states:
                    future = executor.submit(
                        process_character_state,
                        actor_name, actor_id, state, asset_episodes,
                        script_config, gemini_key, style_config
                    )
                    state_futures.append(future)
                character_tasks.append(('multi', actor_id, actor_name, default_future, state_futures))
            else:
                # 单状态或无状态：只生成 default
                if states:
                    future = executor.submit(
                        process_character_state,
                        actor_name, actor_id, states[0], asset_episodes,
                        script_config, gemini_key, style_config
                    )
                else:
                    future = executor.submit(
                        process_character_default,
                        actor_name, actor_id, asset_episodes,
                        script_config, gemini_key, style_config
                    )
                character_tasks.append(('single', actor_id, actor_name, future))

        # 收集结果
        for task_entry in character_tasks:
            task_type  = task_entry[0]
            actor_id   = task_entry[1]
            actor_name = task_entry[2]

            if task_type == 'multi':
                _, _, _, default_future, state_futures = task_entry
                forms_data = []
                try:
                    default_form = default_future.result()
                    default_form['is_default'] = True
                    forms_data.append(default_form)
                except Exception as e:
                    log(f"⚠ default 形态生成失败 ({actor_name}): {e}")
                for fut in state_futures:
                    try:
                        state_form = fut.result()
                        state_form['is_default'] = False
                        forms_data.append(state_form)
                    except Exception as e:
                        log(f"⚠ 角色形态生成失败 ({actor_name}): {e}")
                chars_data['characters'].append({
                    "id": actor_id,
                    "name": actor_name,
                    "forms": forms_data
                })
            else:  # single
                _, _, _, future = task_entry
                try:
                    form_result = future.result()
                    form_result['is_default'] = True
                    chars_data['characters'].append({
                        "id": actor_id,
                        "name": actor_name,
                        "forms": [form_result]
                    })
                except Exception as e:
                    log(f"⚠ 角色生成失败 ({actor_name}): {e}")

    # 5. 为场景生成提示词（并发执行）
    log("\n=== 生成场景提示词（并发模式）===")
    scenes_data = {
        "project": project_title,
        "style_config": "style.json",
        "scenes": []
    }

    with ThreadPoolExecutor(max_workers=10) as executor:
        scene_futures = {}
        for location in locations:
            location_id = location.get('location_id') or location.get('id')
            location_name = location.get('location_name') or location.get('name')
            log(f"提交场景任务: {location_name}")

            future = executor.submit(
                process_scene,
                location_name, location_id, asset_episodes,
                script_config, gemini_key, style_config
            )
            scene_futures[future] = location_name

        # 收集结果
        for future in as_completed(scene_futures):
            try:
                scene_result = future.result()
                scenes_data['scenes'].append(scene_result)
            except Exception as e:
                location_name = scene_futures[future]
                log(f"⚠ 场景生成失败 ({location_name}): {e}")

    # 6. 为道具生成提示词（并发执行）
    log("\n=== 生成道具提示词（并发模式）===")
    props_data = {
        "project": project_title,
        "style_config": "style.json",
        "props": []
    }

    with ThreadPoolExecutor(max_workers=10) as executor:
        prop_futures = {}
        for prop in props:
            prop_id = prop.get('prop_id') or prop.get('id')
            prop_name = prop.get('prop_name') or prop.get('name')
            log(f"提交道具任务: {prop_name}")

            future = executor.submit(
                process_prop,
                prop_name, prop_id, asset_episodes,
                script_config, gemini_key, style_config
            )
            prop_futures[future] = prop_name

        # 收集结果
        for future in as_completed(prop_futures):
            try:
                prop_result = future.result()
                props_data['props'].append(prop_result)
            except Exception as e:
                prop_name = prop_futures[future]
                log(f"⚠ 道具生成失败 ({prop_name}): {e}")

    # 7. 保存 JSON 文件
    workspace = Path(args.workspace)
    workspace.mkdir(parents=True, exist_ok=True)

    output_files = {
        f"{project_title}_chars_gen.json": chars_data,
        f"{project_title}_scenes_gen.json": scenes_data,
        f"{project_title}_props_gen.json": props_data
    }

    log("\n=== 保存 JSON 文件 ===")
    for filename, data in output_files.items():
        output_path = workspace / filename
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            log(f"✓ {filename}")
        except Exception as e:
            log(f"❌ 保存失败 ({filename}): {e}")

    log(f"\n=== 项目资产提示词生成完成 ===")
    log(f"输出目录: {workspace}")


if __name__ == "__main__":
    main()
