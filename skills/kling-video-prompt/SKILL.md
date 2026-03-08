# Kling Video Prompt Skill

可灵视频提示词生成规范 - 基于剧本 JSON 结构的视频生成提示词格式化工具。

## 快速开始

使用 `${CLAUDE_SKILL_DIR}/scripts/generate_episode_json.py` 自动从 `script.json` 生成符合规范的视频提示词 JSON 文件：

```bash
cd ${CLAUDE_SKILL_DIR}/scripts
python generate_episode_json.py --episode 1
```

**输出**: `03-video/output/ep{XX}/ep{XX}_shots.json`

---

## 文件管理规范

**核心规则：只保留最终文件，删除所有中间/备份文件。**

| 项目 | 规范 |
|------|------|
| 最终文件名 | `ep{XX}_shots.json` |
| 存放位置 | `03-video/output/ep{XX}/ep{XX}_shots.json` |
| 禁止保留 | `*_backup.json`, `*_temp.json`, `*_test.json`, `*_draft.json`, `*_corrected.json`, `*_fixed.json`, `*_merged.json`, `*_final.json` |
| 版本控制 | 使用 Git，不要用文件名后缀管理版本 |

---

## 剧本解析核心规则

### 数据来源

- **剧本文件**: `01-script/output/episodes/ep{XX}.md`
- **全局配置**: `01-script/output/script.json`（包含 actors / locations / props 标准定义）

**重要原则：必须使用 script.json 的精确内容，不要使用节拍表概述。**

### action_sequence 转 Segment 规则

- 每个 `type: "action"` 的 action_sequence → 一个 **L 单位**（segment）
- `dialogue` / `inner_thought` 类型 → 附加到前一个 action 的 segment
- 每个 L 单位时长: **3-15 秒**

### 智能段落合并（同一 scene 内）

- 相邻 action 合并条件：总时长 <= 15s
- 使用 ` → ` 连接多个 action 的 content
- 对话和内心想法附加到当前 segment
- **禁止跨场次合并**

### 元数据一致性规范

所有元数据必须参考 `script.json`：

| 字段 | 来源 | 规则 |
|------|------|------|
| `characters` | `actors` 字段 | 使用标准名称，不含状态后缀，不重复 |
| `scene` | `locations` 字段 | 使用简化标准名称（去掉"·神坛"等） |
| `props` | `props` 字段 | 使用标准名称，只列关键道具 |

### props 字段判断标准

- **写入 props**: 角色专门携带/使用的具体道具（手帕、佩刀、内丹、轮椅等）
- **不写入 props**: 场景固有元素（建筑结构、家具、光影效果、床上用品）
- **判断**: 该物品是否因场景/人物身份而自然存在？是 → 不写入；否 → 写入

---

## Segment / Shot JSON 结构规范

### 顶层结构

```json
{
  "drama": "剧名",
  "episode": 1,
  "episode_logline": "本集概要",
  "scenes": [...]
}
```

### Segment 字段（严格按此顺序）

1. `segment_id` — 格式 `SC{XX}-L{XX}`
2. `source_beat` — 剧本原文
3. `duration_seconds` — **必须带 "s"**（如 `"15s"`），范围 **3s–15s**
4. `characters` — 标准人物名数组
5. `scene` — 标准场景名
6. `time` — 日/夜
7. `weather` — 天气/光线
8. `props` — 标准道具名数组
9. `emotion` — 情绪变化
10. `core_conflict` — 核心冲突
11. `shots` — 镜头数组
12. `{segment_id}_prompts` — 英文提示词（字符串）
13. `{segment_id}_prompts_cn` — 中文提示词（字符串）

**时长超限拆分规则**: 超过 15s 必须拆分为多个 segment（每段 7-15s），拆分后 segment 编号顺延，元数据继承，时间从 0 重置。

### Shot 字段（严格 5 个，禁止其他）

1. `shot_id` — 格式 `SC{XX}-L{XX}-C{XX}`
2. `time_range` — 格式 `"0-3s"`（连字符 `-`），每个 segment 从 0 开始
3. `description` — 英文视觉描述（≥100 字符），技术参数用方括号整合
4. `dialogue` — 对话内容（无则空字符串）
5. `description_cn` — 中文视觉描述（≥50 字符）

**禁止的 shot 字段**: `shot_number`, `duration`, `shot_type`, `camera_angle`, `camera_movement`, `focal_length`, `depth_of_field`, `lighting`, `color_palette` — 全部整合到 `description` 中。

---

## 景别与镜头语言规则

### 基础景别

| 景别 | 英文 | 画面范围 |
|------|------|---------|
| 大远景 | Extreme Wide Shot | 极广阔环境，人物极小 |
| 远景 | Long Shot | 人物全身，环境主导 |
| 全景 | Full Shot | 人物头顶至脚底完整 |
| 中景 | Medium Shot | 膝盖以上 |
| 中近景 | Medium Close-Up | 腰部以上 |
| 近景 | Close Shot | 胸部以上 |
| 特写 | Close-Up | 面部或单一局部 |
| 大特写 | Extreme Close-Up | 眼睛/嘴唇/手指等 |

### 焦距

| 类型 | 等效焦距 | 特征 |
|------|---------|------|
| 超广角 | 12-24mm | 近大远小夸张，边缘畸变 |
| 广角 | 24-35mm | 空间感强，轻微透视拉伸 |
| 标准 | 40-60mm | 接近人眼，无畸变 |
| 中长焦 | 70-105mm | 背景虚化开始明显 |
| 长焦 | 135-200mm | 空间压缩，强烈虚化 |
| 超长焦 | 200mm+ | 极度空间压缩 |

### 镜头运动

缓推 / 急推 / 拉远 / 横移 / 跟拍 / 环绕 / 摇镜 / 俯仰 / 手持 / 稳定器 / 升降

### 景深

浅景深 / 深景深 / 背景虚化 / 前景虚化 / 焦点转移

### 拍摄角度

低角度仰拍 / 高角度俯拍 / 鸟瞰 / 过肩 / 主观视角(POV) / 斜角构图 / 平视

### AI 运镜触发器

| 触发条件 | 自动触发的镜头规则 |
|----------|-------------------|
| 对话切换 | 正反打，过肩角度交替 |
| 动作关键词（打/摔/举/拔/出拳） | 动作特写 + 动接动 + 升格慢动作 |
| 时空转换 | 空镜头，大远景/全景，淡入或叠化 |
| 内心独白(OS) | 大特写凝视或叠化 |
| 人物登场 | 全景 → 缓推至中景，低角度仰拍 |
| 情绪爆发 | 近景/特写，浅景深，升格或快切 |
| 秘密/发现 | POV 或前景遮挡，视线匹配 |
| 权力/宣判 | 中心对称，低角度仰拍权威方 |
| 追逐/打斗 | 手持跟拍，斜线构图，快切 |
| 场景收尾 | 拉远或升降，淡出至黑场 |

---

## Prompts 格式核心规则

### 人物一致性前缀（每段必加）

**英文**:
```
Maintain characters exactly as reference images, 100% identical facial features, same bone structure, eye spacing and jaw geometry, no beautification, no age changes.
```

**中文**:
```
保持人物与参考图完全一致，面部特征100%相同，保持相同的骨骼结构、眼距和下颚几何形状，禁止美化，禁止改变年龄。
```

禁止在前缀中包含角色详细描述（外貌、服装、气质等）。

### 风格提示词（人物一致性前缀之后、时间标记之前）

根据参考图片判断风格，全剧统一，每段必加：

| 风格 | 英文提示词 | 中文提示词 |
|------|-----------|-----------|
| 三维CG | 3D CG animation style, high-quality rendering with realistic lighting... PBR, ray-traced... | 三维CG动画风格，高质量渲染，真实光影...体积光...PBR... |
| 二维动漫 | 2D anime style, cel-shaded rendering, clean line art... | 二维动漫风格，赛璐璐渲染，清晰线条... |
| 真人实拍 | Live-action cinematic style, photorealistic rendering... | 真人实拍电影风格，照片级真实渲染... |
| 水墨国风 | Chinese ink wash painting style, flowing brushstrokes... | 中国水墨画风格，流畅笔触... |
| 通用 | Maintain consistent visual style with reference images... | 保持与参考图一致的视觉风格... |

### Prompts 字段格式

| 规则 | 说明 |
|------|------|
| 字段命名 | `{segment_id}_prompts` 和 `{segment_id}_prompts_cn` |
| 字段类型 | **字符串**（不是对象） |
| 字段顺序 | 英文在前，中文在后 |
| 时间格式 | 英文用连字符 `-`（`0-3s`），中文用 en dash `–`（`0–3s`） |
| 对话规则 | 英文 prompts 中对话保留中文原文 |
| 最小长度 | ≥ 200 字符（不含前缀） |
| 禁止占位符 | `[待添加]`、`[TODO]` 等 |

### 人物动作指向性规则

人物动作必须明确朝向和方向：
- "面朝X" 表示朝向，"背对X" 表示背向
- 转身必须说明从哪个朝向转到哪个朝向

### 背景描述精简规则

shot `description` 中的完整背景 → prompts 中精简为 5-15 字背景标签，放在景别之后、人物动作之前。

### 主体调用规则

使用 `【角色名】` / `【场景名】` 格式直接调用可灵平台已创建的主体，系统自动识别。
- 焦点角色（在 characters 列表中）：使用 `【角色名】`
- 背景角色（不在列表但可见）：直接描述，不用 `【】`

---

## 质量标准

### Segment 级别

- 全部 12 个字段完整，顺序严格
- `duration_seconds` 带 "s"，在 3s-15s 之间
- prompts 是字符串且 ≥ 200 字符，含人物一致性前缀 + 风格提示词
- 禁止占位符文本

### Shot 级别

- 全部 5 个字段完整
- 每个 segment 的 shots 时间从 0 开始
- `description` ≥ 100 字符，含景别/运镜/构图/焦距/光线/背景/人物位置
- `description_cn` ≥ 50 字符
- `time_range` 使用连字符 `-`

### 跨 Segment 连贯性

- L02+ 起始位置必须与上一段结束位置逻辑连贯
- L01 必须参考场景图片（从 `02-assert/output/scenes/scene.json` 获取）
- 物体和人物不会无故消失：有外力可消失，无外力必须继续存在
- 背景人物（不在 characters 列表但在上一段出现）必须继续提及

---

## 检查与修复规范

### A. Segment 级别

| # | 检查项 | 修复 |
|---|--------|------|
| A1 | `duration_seconds` 单位须带 "s" | auto |
| A2 | `duration_seconds` 范围 3s-15s | >15s 拆分, <3s 合并 |
| A3 | `duration_seconds` = 最后 shot 结束时间 | auto |
| A4 | 字段名 `scene`（禁止 `location`） | auto rename |
| A5 | 12 字段完整 | manual |
| A6 | prompts 字段命名 `{id}_prompts` | auto |
| A7 | characters 包含提示词中所有人物 | auto |
| A8 | prompts 类型为字符串 | auto |
| A9 | 英文/中文 prompts 都存在 | manual |
| A10 | prompts 含人物一致性前缀 | auto |
| A11 | 英文用 `-`，中文用 `–` | auto |
| A12 | props 不含场景固有元素 | auto |

### B. Shot 级别

| # | 检查项 | 修复 |
|---|--------|------|
| B1 | `time_range` 用连字符 `-` | auto |
| B2 | 第一个 shot 从 0 开始 | manual |
| B3 | 相邻 shot 时间连续 | manual |
| B4 | description 含背景描述 | manual |
| B5 | 光线与 weather 一致 | manual |
| B6 | description ≥ 100 字符 | manual |
| B7 | description_cn ≥ 50 字符 | manual |
| B8 | 5 字段完整 | manual |

### C. Prompts 级别

| # | 检查项 | 修复 |
|---|--------|------|
| C0 | 字符串类型（非对象） | auto |
| C1 | 含人物一致性前缀 | auto |
| C2 | 英文时间用 `-` | auto |
| C3 | 中文时间用 `–` | auto |
| C4 | 中文禁止 `【场景建立】` 等标记 | auto |
| C5 | 英文含对话 | auto |
| C6 | ≥ 200 字符 | manual |
| C7 | 英文在中文上方 | auto |
| C8 | 人物/场景/道具用【】标注 | auto |
| C9 | 命名为 `{id}_prompts` | auto |
| C10 | 英文/中文都存在 | manual |
| C11 | 禁止占位符 | manual |
| C12 | ≥ 200 字符（不含前缀） | manual |

---

## References 索引

| 文件 | 内容 |
|------|------|
| [`references/prompt-generation-rules.md`](references/prompt-generation-rules.md) | 完整提示词生成规则（元素清单、生成流程、质量检查） |
| [`references/prompts-format.md`](references/prompts-format.md) | Prompts 格式规范总结（字段格式、props 规则、检查工具） |
| [`references/visual-expansion.md`](references/visual-expansion.md) | 视觉描述扩展规则（动作/情绪扩展策略、标注规则） |
| [`references/batch-generation.md`](references/batch-generation.md) | 批量视频生成流程（可灵 3.0 Omni 参考生视频模式） |
| [`references/video-download.md`](references/video-download.md) | 视频下载和目录组织规范 |
| `scripts/generate_episode_json.py` | 自动生成 ep{XX}_shots.json 的主脚本 |
| `scripts/check_all.py` | 综合检查脚本 |
| `scripts/check_prompts_format.py` | Prompts 格式检查 |
| `scripts/check_props_field.py` | Props 字段检查 |
| `scripts/check_a7_characters_v2.py` | Characters 字段完整性检查 |
| `scripts/clean_json_files.py` | JSON 文件清理工具 |
