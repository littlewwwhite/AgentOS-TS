# 视觉描述扩展规则（v2.42.0 新增）

## 概述

本章节说明如何将简短的剧本动作描述扩展为详细的视觉描述，用于生成高质量的视频提示词。

## 核心原则

**从简短剧本到详细描述**：剧本中的动作描述通常很简洁（如"陆云凑到灵霜耳边，声音压得很低"），需要扩展为包含丰富视觉细节的描述。

## 扩展策略

### 1. 动作细节扩展

根据动作类型添加相应的细节描述：

| 原始动作 | 扩展描述 |
|---------|---------|
| 凑到...耳边 | 身体微微前倾，声音压得极低，眼神不时瞥向周围 |
| 皱起眉 | 眉头紧锁，眼神复杂 |
| 目光落在...身上 | 眼神中透露出思索和犹豫 |
| 呆坐 | 双眼空洞无神，仿佛失去了灵魂 |
| 沉默片刻 | 陷入短暂的思考 |
| 点头 | 动作缓慢而坚定 |
| 攥紧成拳 | 指节因用力而发白 |
| 独自坐在 | 周围空无一人，显得格外孤独 |
| 看向窗外 | 眼神空洞，似乎在回忆什么 |
| 阳光洒在 | 形成明暗对比，突显伤痕的触目惊心 |

### 2. 情绪表现扩展

根据情绪关键词添加可见的表演细节：

| 情绪 | 视觉表现 |
|------|---------|
| 警惕 | 眼神不时瞥向周围，身体微微紧绷 |
| 复杂 | 眉头紧锁，眼神游移不定 |
| 虚弱 | 脸色苍白，身体微微颤抖 |
| 冷漠 | 面无表情，眼神空洞 |
| 痛苦 | 五官扭曲，额头冒汗 |
| 绝望 | 眼神失焦，嘴巴微张 |
| 坚定 | 眉宇间透出决心，目光锐利 |

### 3. 人物标注规则

在扩展描述时，自动为人物名称添加【】标注：

```
原始：陆云凑到灵霜耳边
扩展：【陆云】凑到【灵霜】耳边，身体微微前倾，声音压得极低
```

### 4. 场景标注规则

为场景名称添加【】标注：

```
原始：背景是灵霜寝宫
扩展：背景是【灵霜寝宫】内景
```

## 实现示例

### Python 实现

```python
def expand_action_to_visual_description(action_content, characters, scene_name, shot_type, is_chinese=False):
    """
    将简短的剧本动作扩展为详细的视觉描述

    参数:
        action_content: 原始剧本动作内容
        characters: 场景中的人物列表
        scene_name: 场景名称
        shot_type: 镜头类型
        is_chinese: 是否生成中文描述

    返回:
        扩展后的详细视觉描述
    """
    # 分析动作内容
    parts = action_content.split('→')

    if is_chinese:
        # 中文描述
        descriptions = []
        for i, part in enumerate(parts):
            part = part.strip()

            # 添加人物标注
            for char in characters:
                if char in part and f'【{char}】' not in part:
                    part = part.replace(char, f'【{char}】', 1)

            # 添加场景标注
            if scene_name in part and f'【{scene_name}】' not in part:
                part = part.replace(scene_name, f'【{scene_name}】', 1)

            # 扩展描述
            if '凑到' in part and '耳边' in part:
                part = f"{part}，身体微微前倾，声音压得极低，眼神不时瞥向周围"
            elif '皱起眉' in part:
                part = f"{part}，眉头紧锁，眼神复杂"
            elif '目光落在' in part:
                part = f"{part}，眼神中透露出思索和犹豫"
            elif '呆坐' in part:
                part = f"{part}，双眼空洞无神，仿佛失去了灵魂"
            elif '沉默' in part:
                part = f"{part}，陷入短暂的思考"
            elif '点头' in part:
                part = f"{part}，动作缓慢而坚定"
            elif '攥紧' in part:
                part = f"{part}，指节因用力而发白"
            elif '独自' in part:
                part = f"{part}，周围空无一人，显得格外孤独"
            elif '看向窗外' in part:
                part = f"{part}，眼神空洞，似乎在回忆什么"
            elif '阳光洒在' in part:
                part = f"{part}，形成明暗对比，突显伤痕的触目惊心"

            descriptions.append(part)

        return '，'.join(descriptions)
    else:
        # 英文描述（类似逻辑）
        # ...
```

### 使用示例

**输入（原始剧本）：**
```
陆云凑到灵霜耳边，声音压得很低 → 眼神警惕地瞥向白行风
```

**输出（扩展后）：**
```
【陆云】凑到【灵霜】耳边，声音压得很低，身体微微前倾，声音压得极低，眼神不时瞥向周围，眼神警惕地瞥向【白行风】
```

**输入（原始剧本）：**
```
灵霜皱起眉，目光落在白行风身上 → 白行风呆坐轮椅，毫无反应
```

**输出（扩展后）：**
```
【灵霜】皱起眉，目光落在【白行风】身上，眉头紧锁，眼神复杂，【白行风】呆坐轮椅，毫无反应，双眼空洞无神，仿佛失去了灵魂
```

## 集成到生成流程

在生成 JSON 文件时，使用此函数扩展 shot 的 description：

```python
# 生成详细的 shot description
desc_en, desc_cn = generate_detailed_shot_description(
    action_content,
    segment['characters'],
    segment['scene'],
    shot_index,
    num_shots,
    segment['dialogues']
)
```

其中 `generate_detailed_shot_description` 函数内部调用 `expand_action_to_visual_description` 来扩展视觉描述。

## 质量标准

扩展后的描述应该：

- ✅ 包含具体的动作细节（身体姿态、手部动作、眼神方向）
- ✅ 包含情绪表现（表情、眼神、肢体语言）
- ✅ 包含空间关系（人物位置、相对关系）
- ✅ 包含环境细节（光线、氛围、背景元素）
- ✅ 长度至少是原始描述的 2-3 倍
- ❌ 不要添加剧本中没有的情节
- ❌ 不要改变原始动作的核心含义

## 参考脚本

完整的实现参考：`workspace/regenerate_ep02_improved.py`

该脚本包含了完整的视觉描述扩展逻辑，可以作为生成其他集数 JSON 文件的模板。
