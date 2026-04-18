---
name: asset-gen
description: "从剧本批量生成角色、场景、道具视觉资产并上传。涵盖风格选择、提示词生成、并行出图、自动审核、断点续传。当用户要求生成资产、一键出图、批量出图、重新生成指定角色/场景/道具、上传资产到火山引擎时使用。"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# 统一资产生成编排器

从 `script.json` 自动批量生成角色、场景、道具三类视觉资产。

> **路径约定**：文档内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 指项目根目录（剧本、资产、workspace 等）。

---

## 前置检查（每次执行前按序完成）

### 步骤 0: AWB 登录 + 环境依赖 + Gemini 配置

```bash
python3 ./.claude/skills/asset-gen/scripts/preflight_awb.py \
  --check login,deps,gemini-config \
  --deps google-genai,Pillow,demucs,soundfile --cmds curl,ffmpeg \
  --gemini-config "./.claude/skills/asset-gen/assets/common/gemini_backend.json"
```

- 登录失败 → 使用相关登录 skill（如 `awb-login`）或等价登录流程引导用户登录，成功后重新执行
- 依赖缺失 → 按输出提示安装（`ffmpeg`: macOS `brew install ffmpeg`，Linux `apt install ffmpeg`）
- Gemini 配置异常 → 检查 `assets/common/gemini_backend.json`，支持 `official`/`proxy` 两种模式

### 步骤 0-C: 项目初始化检查（必须在步骤 0 之后执行）

检查 `${PROJECT_DIR}/workspace/style.json` 是否存在：

- **存在** → 项目已初始化，继续进入主菜单或快捷入口
- **不存在** → 项目未初始化，**必须先完成初始化**，按以下顺序执行：
  1. 检查剧本文件 `${PROJECT_DIR}/output/script.json` 是否存在，不存在则提示用户先生成剧本
  2. 执行两级风格选择（同「选项 3 → 3.3 风格选择」的逻辑）
  3. 执行步骤 1（提取世界观风格）
  4. 执行步骤 2（生成资产提示词）
  5. 初始化完成后，再进入主菜单或快捷入口

> **注意**：此检查确保进入主菜单时项目一定已初始化，避免用户在菜单中选择「查看项目状态」或「重新生成」时遇到未初始化错误。

---

## 统一状态文件

`asset-gen` 是 `VISUAL` 阶段，必须同步维护 `${PROJECT_DIR}/workspace/pipeline-state.json`。

- 进入本 skill 时：设置 `current_stage=VISUAL`、`stages.VISUAL.status=running`
- `style.json` 与 `*_gen.json` 已写出但尚未完成全部资产时：设置 `stages.VISUAL.status=partial`
- `actors.json`、`locations.json`、`props.json` 写出后：设置 `stages.VISUAL.status=completed`
- 资产与 `script.json` 一致性检查通过后：设置 `stages.VISUAL.status=validated`，`next_action=enter STORYBOARD`

如果状态文件缺失，可从以下 artifacts 回推：

- `${PROJECT_DIR}/workspace/style.json`
- `${PROJECT_DIR}/workspace/*_gen.json`
- `${PROJECT_DIR}/output/actors/actors.json`
- `${PROJECT_DIR}/output/locations/locations.json`
- `${PROJECT_DIR}/output/props/props.json`

## 快捷入口

前置检查通过后，**先判断用户输入是否匹配以下快捷入口**，匹配则跳过主菜单直接执行：

### 快捷入口 A：一键成片

**触发条件**：用户输入包含"一键成片"关键词。

#### 风格解析

Parse style from user input per [`references/style-mapping.md`](references/style-mapping.md).
- **With style keyword** -> map to `--style-override`
- **Without style keyword** -> omit `--style-override`, let script.json decide

#### 断点续传

- `${PROJECT_DIR}/workspace/style.json` 存在且 `visual_mode` 与本次风格一致 → 跳过步骤 1、2
- 否则正常执行步骤 1、2

#### 执行

直接执行步骤 3，参数追加 `--characters --scenes --props --voice`。

### 快捷入口 B：重新生成指定资产

**触发条件**：用户输入匹配以下模式之一（不含"一键成片"）：

| 用户说 | 解析结果 |
|--------|---------|
| 重新生成角色 XX、重跑角色 XX | 类型=角色，名称=XX |
| 重新生成场景 XX、重跑场景 XX | 类型=场景，名称=XX |
| 重新生成道具 XX、重跑道具 XX | 类型=道具，名称=XX |
| 重新生成音色 XX、重跑音色 XX | 类型=音色，名称=XX |

**执行流程**：直接执行步骤 3，参数按以下映射：

| 类型 | 命令参数 |
|------|---------|
| 角色 | `--characters --voice --regenerate-actors "XX"` |
| 音色 | `--characters --voice --regenerate-actors "XX"` |
| 场景 | `--scenes --regenerate-scenes "XX"` |
| 道具 | `--props --regenerate-props "XX"` |

> 多个名称用逗号分隔，如"重新生成角色 Olivia, Ethan"。

### 快捷入口通用参数

从用户输入额外识别以下关键词，追加到步骤 3 命令行：

| 用户说 | 追加参数 |
|--------|---------|
| debug、调试模式 | `--debug` |

### 不匹配任何快捷入口

→ 进入主菜单。

---

## 主菜单（不匹配快捷入口时弹出）

向用户展示 5 个选项（例如使用 `AskUserQuestion` 或等价的交互式提问方式）：

```
问题: "请选择操作："
选项:
  1. 查看项目状态          → 进入选项 1
  2. 修改世界观/风格        → 进入选项 2
  3. 生成资产              → 进入选项 3
  4. 重新生成指定资产       → 进入选项 4
  5. 上传角色资产到火山引擎  → 进入选项 5
```

---

## 选项 1：查看项目状态

分三部分展示：

### 1.1 风格信息

使用 `Read` 工具读取 `${PROJECT_DIR}/workspace/style.json`，格式化展示关键字段：
- 世界观类型（worldview_type）
- 视觉模式（visual_mode）
- 渲染前缀（render_prefix，截取前 80 字符）

### 1.2 资产生成情况

读取以下 JSON 文件，汇总展示已有资产列表：

```python
# 伪代码：读取并汇总
actors_json  = "${PROJECT_DIR}/output/actors/actors.json"   # 角色
scenes_json  = "${PROJECT_DIR}/output/locations/locations.json"  # 场景
props_json   = "${PROJECT_DIR}/output/props/props.json"     # 道具
```

对每类资产，展示表格：

```
【角色】共 N 个
  名称         | 三视图 | 正面 | 侧面 | 背面 | 音色 | 主体ID
  Olivia       |  ✓    |  ✓  |  ✓  |  ✓  |  ✓  | asset-xxx
  Ethan        |  ✓    |  ✓  |  ✓  |  ✓  |  ✗  | -

【场景】共 N 个
  名称         | 图片 | 主体ID
  Beach        |  ✓  | asset-xxx
  Castle Hall  |  ✓  | asset-xxx

【道具】共 N 个
  名称         | 图片 | 主体ID
  Glass Shard  |  ✓  | asset-xxx
```

- 角色检查字段：`three_view`、`face_view`、`side_view`、`back_view`（非空即 ✓）、`voice`（actor 级）、`subject_id`
- 场景检查字段：`image`（非空即 ✓）、`subject_id`
- 道具检查字段：`image`（非空即 ✓）、`subject_id`
- 文件不存在时显示"尚未生成"

### 1.3 剧本一致性检查

对比 `${PROJECT_DIR}/output/script.json` 中的角色/场景/道具列表与已生成的资产，提示差异：

```
⚠ 剧本中有角色「NewChar」但尚未生成资产
⚠ 已生成资产中有角色「OldChar」但剧本中已不存在
```

展示完毕后结束流程。

---

## 选项 2：修改世界观/风格

### 流程

1. **展示当前状态**：先执行「查看项目状态」（选项 1）的逻辑展示当前信息。

2. **询问修改方式**：向用户展示选择题（例如使用 `AskUserQuestion` 或等价交互方式）：
   ```
   问题: "请选择修改方式："
   选项:
     - 更换视觉风格     → 弹出风格选择
     - 自定义修改       → 用户自由输入描述
   ```

3. **更换视觉风格**时，使用两级风格选择（同下方 3.3 风格选择逻辑）。

4. **自定义修改**时：
   a. 提示用户输入修改意图（如"把整体色调改暖一些"、"增加蒸汽朋克元素"）
   b. 读取当前 `${PROJECT_DIR}/workspace/style.json`
   c. 根据用户意图，用 `Edit` 工具修改 style.json 中对应字段（如 `render_prefix`、`anti_contamination`、`character_style` 等）
   d. 展示修改后的 style.json 给用户确认
   e. 确认后删除 `${PROJECT_DIR}/workspace/*_gen.json`，重新执行步骤 2 生成新提示词

5. **更换视觉风格**后：
   a. 删除 `${PROJECT_DIR}/workspace/style.json` 和 `${PROJECT_DIR}/workspace/*_gen.json`
   b. 重新执行步骤 1（`style_generate.py --style-override {新风格}`）和步骤 2

6. **展示新配置**：展示新的 style.json 内容。

---

## 选项 3：生成资产

### 3.1 选择生成模式

向用户展示选择题（例如使用 `AskUserQuestion` 或等价交互方式）：

```
问题: "请选择生成模式："
选项:
  - 一键成片（全部生成）  → --characters --scenes --props --voice
  - 分步制作（按类型选择）→ 进入多选
```

**分步制作**时，向用户展示多选题（例如使用 `AskUserQuestion` 或等价交互方式）：

```
问题: "请选择要生成的资产类型（可多选）："
multiSelect: true
选项:
  - 角色（含三视图）  → --characters
  - 场景             → --scenes
  - 道具             → --props
  - 角色音色         → --voice
```

### 3.2 断点续传检查

1. **style.json 不存在** → 先询问风格（见 3.3），然后执行步骤 1、2
2. **style.json 存在且 `visual_mode` 与本次风格一致** + `*_gen.json` 存在 → 执行剧本一致性校验（见 3.2.1），通过后跳过步骤 1、2
3. **style.json 存在但 `visual_mode` 与本次风格不一致** → 删除 `${PROJECT_DIR}/workspace/style.json` 和 `${PROJECT_DIR}/workspace/*_gen.json`，重新执行步骤 1、2

> 判断一致性：读取 `${PROJECT_DIR}/workspace/style.json` 中的 `visual_mode` 字段，与本次 `--style-override` 对应的视觉模式比较。

#### 3.2.1 剧本一致性校验

当 `*_gen.json` 已存在时，对比 `${PROJECT_DIR}/output/script.json` 与 `*_gen.json` 的资产列表：

```python
# 伪代码
script_actors = {c['name'] for c in script['characters']}
gen_actors    = {a['actor_name'] for a in actors_gen['actors']}

new_actors     = script_actors - gen_actors   # 剧本新增的角色
removed_actors = gen_actors - script_actors   # 剧本已删除的角色
```

- **完全一致** → 跳过步骤 1、2
- **有差异** → 提示用户：
  ```
  检测到剧本已更新：
  - 新增角色：NewChar1, NewChar2
  - 已移除角色：OldChar1
  建议重新生成提示词以同步剧本变更。
  ```
  向用户提问确认：
  ```
  问题: "是否重新生成提示词？"
  选项:
    - 是，重新生成  → 删除 *_gen.json，重新执行步骤 2
    - 否，继续使用旧提示词  → 跳过步骤 1、2
  ```

### 3.3 风格选择（仅 style.json 不存在时触发）

**第一级**——选择风格大类（必须进行交互式选择，例如 `AskUserQuestion`）：

```
问题: "请选择视觉风格大类："
选项（最多4项）:
  - 真人影视风                          → style-override: 真人（直接确定，跳过第二级）
  - 东方动画风（国漫 / 日漫）           → 进入第二级
  - 欧美 & 趣味动画（美漫 / 条漫 / Q版）→ 进入第二级
  - 游戏 CG 风（风格化3D / 次世代）     → 进入第二级
```

**第二级**——细分（仅非真人影视时触发，使用交互式选择方式）：

```
东方动画：
  - 国漫动画风 → 国漫
  - 日漫动画风 → 日漫

欧美 & 趣味动画：
  - 美漫动画风 → 美漫
  - 条漫动态风 → 条漫
  - Q版卡通风  → Q版

游戏CG：
  - 风格化3D游戏CG风 → 游戏CG
  - 次世代游戏CG风   → 次世代
```

### 3.4 执行生成

执行步骤 3（`generate_all_assets.py`），带对应的资产类型参数。

---

## 选项 4：重新生成指定资产

### 4.1 展示项目状态

先执行「查看项目状态」（选项 1）的逻辑，展示所有已有资产名称列表，方便用户参照输入。

### 4.2 用户输入资产名称

直接让用户手动输入要重新生成的资产名称，不需要的类别可省略。提示格式：

```
请输入要重新生成的资产名称（不需要的类别可省略）：

格式示例：
- 角色图片：Olivia, Ethan
- 角色音色：Olivia
- 场景：Beach, Castle Hall
- 道具：Glass Shard, Brass Lamp
```

解析用户输入，按类别提取名称。

### 4.3 选择操作

向用户展示选择题（例如使用 `AskUserQuestion` 或等价交互方式）：

```
问题: "请选择操作："
选项:
  - 直接重新生成         → 跳到 4.5
  - 查看提示词           → 进入 4.4（仅查看，查看后回到本步骤重新选择）
  - 修改提示词后重新生成  → 进入 4.4，修改后执行 4.5
```

### 4.4 查看 / 修改提示词

对用户指定的每个资产：

1. **读取提示词**：从 `${PROJECT_DIR}/workspace/*_gen.json` 中查找该资产，读取其 prompt（取第一个 prompt）
   - 角色 → `${PROJECT_DIR}/workspace/*_actors_gen.json`，匹配 `actors[].actor_name`，读取 `prompts` 字段
   - 场景 → `${PROJECT_DIR}/workspace/*_scenes_gen.json`，匹配 `scenes[].name`，读取 `prompts` 字段
   - 道具 → `${PROJECT_DIR}/workspace/*_props_gen.json`，匹配 `props[].name`，读取 `prompts` 字段

2. **展示当前提示词**：以代码块形式展示给用户，格式如：
   ```
   【Olivia】当前提示词：
   A young woman in medieval European attire, standing in a dimly lit castle corridor...

   【Beach】当前提示词：
   A secluded beach at dawn, waves crashing against weathered rocks...
   ```

3. **仅查看** → 展示后回到 4.3 重新选择操作

4. **修改提示词** → 对每个资产：
   a. 用户描述修改意图（如"把服装改成现代风"、"增加雾气效果"）
   b. Claude 根据用户意图重写 prompt
   c. 展示新 prompt 给用户确认
   d. 确认后将新 prompt 写入 `*_gen.json` 对应的**所有 prompt 槽位**

### 4.5 执行重新生成

执行步骤 3（`generate_all_assets.py`），带对应的 `--regenerate-*` 参数和资产类型标志。

**参数映射**：

| 用户输入类别 | 命令参数 |
|------------|---------|
| 角色图片 | `--characters --voice --regenerate-actors "名称"`（重新生成角色图片时自动包含音色） |
| 角色音色 | `--characters --voice --regenerate-actors "名称"`（仅重新生成音色也需带 --characters） |
| 场景 | `--scenes --regenerate-scenes "名称"` |
| 道具 | `--props --regenerate-props "名称"` |

---

## 选项 5：上传角色资产到火山引擎

> **Platform support**: Currently only Volcengine (火山引擎) is supported. Scenes and props upload not yet available.

### 快捷入口

| User Input | Action |
|-----------|--------|
| Contains "character/actor" + "Volcengine/upload" + **specific names** | Upload specified actors (`--actors "Name"`) |
| Contains "character/actor" + "Volcengine/upload", **no names** | Upload all un-uploaded actors |
| Contains "scene" + "upload" | Prompt: scene upload not yet supported |
| Contains "prop" + "upload" | Prompt: prop upload not yet supported |

**Name parsing**: "upload Driver" -> `--actors "Driver"`, "upload Driver, Boy" -> `--actors "Driver,Boy"`. Names match `${PROJECT_DIR}/output/actors/actors.json` `name` field (case-sensitive).

### 前置检查

#### 步骤 0-A: 登录检查

Same as asset generation preflight — run `python3 ./.claude/skills/asset-gen/scripts/preflight_awb.py --check login`.

#### 步骤 0-B: 资产完整性检查

Read `${PROJECT_DIR}/output/actors/actors.json`, verify per actor:

| Field | Requirement |
|-------|------------|
| `voice` | Non-empty |
| `voice_url` | Non-empty |
| `default.three_view` | Non-empty |
| `default.three_view_url` | Non-empty |
| `default.subject_id` | Non-null = already uploaded, auto-skip |

- `subject_id` non-null -> skip (idempotent)
- Other required fields missing -> print details, abort, prompt user to regenerate via option 3/4
- All actors already uploaded -> prompt "no action needed"

### 执行上传

```bash
python3 -X utf8 "./.claude/skills/asset-gen/scripts/upload_actors.py" --project-dir "${PROJECT_DIR}" [--actors "Driver,Boy"]
```

| Param | Description | Default |
|-------|-------------|---------|
| `--project-dir` | Project root directory | `PROJECT_DIR` env var or CWD |
| `--actors` | Actor names to upload, comma-separated | Empty = all un-uploaded |

**Script flow**: Read actors.json -> validate fields -> `create_asset_group()` per actor -> upload assets (three-view, front, side, back, voice; empty URLs skipped) -> print summary.

**Request timeout**: 60s per API call (configured in `common_asset_group_api.py` `DEFAULT_TIMEOUT`).

### 展示结果

Upload summary table:

```
Actor  | Asset Group ID | Uploaded      | Failed
-------|----------------|---------------|-------
Boy    | xxx            | 3-view,front,side,back,voice | None
```

---

## 完整步骤（供上述选项内部调用）

### 步骤 1: 提取世界观风格

```bash
python3 -X utf8 \
  "./.claude/skills/asset-gen/scripts/style_generate.py" \
  --script-json "${PROJECT_DIR}/output/script.json" \
  --output "${PROJECT_DIR}/workspace/style.json" \
  [--style-override 真人]
```

**输出**: `${PROJECT_DIR}/workspace/style.json`（世界观类型、渲染前缀、防污染规则）

### 步骤 2: 生成资产提示词

```bash
python3 -X utf8 \
  "./.claude/skills/asset-gen/scripts/generate_prompts_from_script.py" \
  --script-json "${PROJECT_DIR}/output/script.json" \
  --workspace "${PROJECT_DIR}/workspace" \
  --style-json "${PROJECT_DIR}/workspace/style.json"
```

**输出**: `${PROJECT_DIR}/workspace/{title}_actors_gen.json`、`_scenes_gen.json`、`_props_gen.json`

### 步骤 3: 并行生成所有资产

```bash
python3 -X utf8 \
  "./.claude/skills/asset-gen/scripts/generate_all_assets.py" \
  --script-json "${PROJECT_DIR}/output/script.json" \
  --project-dir "${PROJECT_DIR}/output" \
  --workspace "${PROJECT_DIR}/workspace" \
  [--characters] \
  [--scenes] \
  [--props] \
  [--voice] \
  [--regenerate-actors "李明,王芳"] \
  [--regenerate-scenes "客厅,卧室"] \
  [--regenerate-props "手机,钥匙"] \
  [--debug]
```

**参数说明**:

| 参数 | 说明 | 默认 |
|------|------|------|
| `--characters` | 生成角色（含三视图） | 否 |
| `--scenes` | 生成场景 | 否 |
| `--props` | 生成道具 | 否 |
| `--voice` | 生成角色音色（仅音色时自动进入 voice-only 模式，跳过图片/场景/道具） | 否 |
| `--regenerate-actors` | 指定重新生成的角色名，逗号分隔 | 无 |
| `--regenerate-scenes` | 指定重新生成的场景名，逗号分隔 | 无 |
| `--regenerate-props` | 指定重新生成的道具名，逗号分隔 | 无 |
| `--debug` | 调试模式，保留 `_temp` 临时文件 | 否 |

---

## References

| File | Content |
|------|---------|
| [`references/troubleshooting.md`](references/troubleshooting.md) | Log locations, common issues, checkpoint resume mechanism |
| [`references/style-mapping.md`](references/style-mapping.md) | Quick-entry style keyword mapping table |
