---
name: asset-gen-asset
description: |
  统一资产生成编排器，从剧本(script.json)自动批量生成角色、场景、道具三类资产的完整生产流程，包含提示词生成、并行出图、Gemini自动审核、断点续传。

  当用户提到以下任何情况时必须使用此 skill：
  - "生成项目资产"、"批量生成资产"、"一键生成角色场景道具"
  - "生成全部资产"、"资产生产"、"统一生成"、"开始出图"
  - "帮我生成所有角色和场景"、"把剧本里的资产都生成出来"
  - "批量出图"、"自动生成角色/场景/道具"、"资产批量生成"
  - 用户有 script.json 且想生产动画/影视所需的所有视觉资产

  核心流程：
    Phase 0: generate_style.py → style.json（世界观风格提取）
    Phase 1: generate_prompts_from_script.py → 三类提示词 JSON
    Phase 2: generate_all_assets.py 并行生成（角色三视图+审核、场景主图+审核、道具主图+审核）
    Phase 3: 保存到统一目录，生成元数据索引
---

# 统一资产生成编排器

## ⭐ 完整资产生成流程

从剧本到最终资产的三步骤流程：

### 步骤 1: 提取世界观风格

```bash
GEMINI_API_KEY="..." python3 -X utf8 \
  ".claude/skills/asset-gen-asset/scripts/generate_style.py" \
  --script-json "../01-script/output/script.json" \
  --output "workspace/style.json"
```

**输出**: `workspace/style.json` - 包含世界观类型、渲染前缀、防污染规则

### 步骤 2: 生成资产提示词

```bash
GEMINI_API_KEY="..." python3 -X utf8 \
  ".claude/skills/asset-gen-asset/scripts/generate_prompts_from_script.py" \
  --script-json "../01-script/output/script.json" \
  --workspace "workspace" \
  --style-json "workspace/style.json"
```

**输出**: 三个提示词 JSON 文件（项目级别，包含所有集数的资产）
- `{title}_chars_gen.json` - 所有角色提示词
- `{title}_scenes_gen.json` - 所有场景提示词
- `{title}_props_gen.json` - 所有道具提示词

### 步骤 3: 并行生成所有资产

```bash
GEMINI_API_KEY="..." python3 -X utf8 \
  ".claude/skills/asset-gen-asset/scripts/generate_all_assets.py" \
  --script-json "../01-script/output/script.json" \
  --project-dir "output" \
  --workspace "workspace"
```

**输出**: 并行生成所有角色、场景、道具，包含自动审核和重生机制

### 输入文件要求

#### script.json (项目剧本配置)

唯一的输入文件，包含完整的项目信息：

```json
{
  "title": "剑仙复仇录",
  "worldview": "仙侠修真世界，万剑宗为顶级宗门...",
  "style": "Dark fantasy aesthetic with cold blue-purple tones...",
  "actors": [
    {
      "actor_id": "act_001",
      "actor_name": "白行风",
      "states": [
        {"state_id": "st_001", "state_name": "傻子"},
        {"state_id": "st_002", "state_name": "重伤"},
        {"state_id": "st_003", "state_name": "全盛"}
      ]
    }
  ],
  "locations": [
    {"location_id": "loc_001", "location_name": "万剑宗大殿"}
  ],
  "episodes": [...]
}
```

**目录结构要求**：
```
01-script/output/
├── script.json          ← 主配置文件（必需）
    └── ...
```


### 执行流程

#### 步骤 1: 世界观风格提取

调用 `generate_style.py` 分析 script.json,生成 `style.json`:

```json
{
  "worldview_type": "修仙/仙侠",
  "render_prefix": "仙侠游戏角色CG渲染,全身立绘,竖构图,影视级光影,纯白背景,",
  "anti_contamination": "NO Western fantasy armor, NO European medieval clothing...",
  "style_source": "《黑神话:悟空》级别3D写实国风CG"
}
```

#### 步骤 2: 从剧本生成资产提示词

调用 `generate_prompts_from_script.py` 分析剧本内容,使用 Gemini 自动提取资产并生成提示词:

1. **读取剧本** → 从 script.json 的 episodes 数组中读取所有集数
2. **Gemini 分析** → 提取所有角色、场景、道具列表
3. **生成提示词** → 为每个资产生成详细的英文提示词
4. **输出 JSON** → 生成三个文件:
   - `{title}_chars_gen.json` - 所有角色提示词
   - `{title}_scenes_gen.json` - 所有场景提示词
   - `{title}_props_gen.json` - 所有道具提示词

#### 步骤 3: 并行资产生成

调用 `generate_all_assets.py` 并行生成三类资产:

| 生成器 | 流程 | 输出 |
|-------|------|------|
| **角色** | 三视图 → Gemini审核 → 切分为正/侧/背 + 音频 | `characters/{name}/{form}/` |
| **场景** | 主图 → Gemini审核 → 参考附图 | `scene/{name}/` |
| **道具** | 主图 → Gemini审核 → 细节附图 | `props/{name}/` |

### 输出目录结构

```
output/
├── characters/
│   ├── 白行风/
│   │   ├── 受辱废人期/
│   │   │   ├── 正面.png
│   │   │   ├── 侧面.png
│   │   │   ├── 背面.png
│   │   │   ├── 三视图.png
│   │   │   └── voice.mp3
│   │   └── characters.json
│   └── characters.json
├── scene/
│   ├── 灵霜寝宫/
│   │   ├── 主图.png
│   │   ├── 特写附图.png
│   │   └── scene.json
│   └── scene.json
└── props/
    ├── 飞升水晶/
    │   ├── 主图.png
    │   ├── 特写附图.png
    │   └── props.json
    └── props.json
```

### 命令行参数

```bash
python generate_all_assets.py \
  --script-json PATH             # script.json 路径
  --project-dir PATH             # 最终输出目录
  --workspace PATH               # 工作临时目录
  [--skip-single-views]          # 可选:角色跳过独立侧/背图
```


### 断点续传

- **步骤 1**: 若 `style.json` 已存在,跳过风格提取
- **步骤 2**: 若提示词 JSON 文件已存在,跳过提示词生成
- **步骤 3**: 各生成器内部支持断点续传(已存在的图片自动复用)

### 并行执行策略

- **步骤 1**: 串行执行（必须先完成风格提取）
- **步骤 2**: 串行执行（必须先完成提示词生成）
- **步骤 3**: 3个生成器并行(角色/场景/道具同时进行)

### 环境要求

- Python 3.10+ (`python3`)
- 依赖: `google-genai`, `pydantic`, `requests`, `qcloud_cos`
- API Key: `GEMINI_API_KEY` 环境变量

### 常见问题

**Q: 角色生成流程与之前有何不同?**

A: 新流程先生成三视图整合图,审核通过后再以三视图为参考生成独立的正/侧/背视图,确保视角一致性。

**Q: 如何只生成某一类资产?**

A: 直接运行对应的子脚本：
- 仅角色: `python .claude/skills/asset-gen-asset/scripts/generate_characters.py --characters-json ...`
- 仅场景: `python .claude/skills/asset-gen-asset/scripts/generate_scenes.py --scenes-json ...`
- 仅道具: `python .claude/skills/asset-gen-asset/scripts/generate_props.py --props-json ...`

**Q: 生成失败如何重试?**

A: 删除对应的输出文件,重新运行编排器即可。断点续传机制会自动跳过已完成的部分。

---

## 子生成器说明

### 角色生成器

**脚本**: `.claude/skills/asset-gen-asset/scripts/generate_characters.py`

**关键参数**:
- `--skip-single-views`: 精简模式,只出三视图

**审核脚本**: `.claude/skills/asset-gen-asset/scripts/char_review.py`
- `front` 模式: 审查正视图
- `views` 模式: 审查侧/背视图一致性

### 场景生成器

**脚本**: `.claude/skills/asset-gen-asset/scripts/generate_scenes.py`

**审核脚本**:
- `.claude/skills/asset-gen-asset/scripts/scene_review.py`: 主图审核

### 道具生成器

**脚本**: `.claude/skills/asset-gen-asset/scripts/generate_props.py`

**审核脚本**: `.claude/skills/asset-gen-asset/scripts/props_review.py`

---

## 技术架构

### 编排器职责

1. **流程协调**: 按正确顺序执行各阶段
2. **并行管理**: 使用 `ThreadPoolExecutor` 并行执行独立任务
3. **错误处理**: 捕获子进程异常,汇总执行结果
4. **日志聚合**: 统一输出各生成器的执行状态

### 子生成器职责

1. **资产生成**: 调用灵境AI生图API
2. **质量审核**: 调用 Gemini Vision 审图
3. **断点续传**: 检测已存在文件,避免重复生成
4. **元数据生成**: 输出 JSON 索引文件

### 数据流

```
script.json
    ↓
[步骤 1] generate_style.py
    ↓
style.json
    ↓
[步骤 2] generate_prompts_from_script.py
    ├→ Gemini 分析提取资产
    └→ 生成提示词 JSON
        ├→ {title}_chars_gen.json
        ├→ {title}_scenes_gen.json
        └→ {title}_props_gen.json
    ↓
[步骤 3] generate_all_assets.py
    ├→ generate_characters.py → characters/
    ├→ generate_scenes.py     → scene/
    └→ generate_props.py      → props/
```

---

## 迭代经验

### 并行执行优化

- 角色生成耗时最长(三视图 + 多视角 + 音频),优先启动
- 场景和道具相对较快,可后启动
- 使用 `ThreadPoolExecutor` 而非 `ProcessPoolExecutor`,避免序列化开销

### 审核策略

- 正视图审核最严格(头身比 + 无道具强制检查)
- 三视图审核关注角度准确性
- 侧/背视图审核关注与正面一致性

### 断点续传

- 检查最终输出目录,而非临时目录
- 复用已存在文件时,需上传到COS获取 iref URL
- 临时文件在流程结束后统一清理
