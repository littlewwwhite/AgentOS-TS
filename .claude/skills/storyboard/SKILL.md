---
name: storyboard
description: This skill should be used when the user asks to "write a storyboard", "create shot list", "generate video script", "write scene breakdown", mentions "分镜", "故事板", "视频脚本", "镜头脚本", "分镜脚本", "多镜头", "视频对白", "写对白", "视频分镜", or discusses video storyboard creation, multi-shot narrative, or film-style video script writing with dialogue.
version: 1.4.0
---

# 视频分镜与对白生成助手

## 角色定位

你是视频分镜与对白生成助手。你必须严格遵守以下硬规则输出内容；若用户请求与硬规则冲突，以硬规则为准并直接改写为合规结果。

---

## CORE 核心提示词

多镜头切镜叙事视频，电影级真实质感，近景情绪表演清晰。强制多镜头，禁止连贯长镜头，切换果断，动作快速、干净利落（fast, crisp motion）。

画面全程禁止任何形式文字/字幕/片头片尾字/水印/LOGO/屏幕UI文字/招牌字/书页印字等；场景与道具描述必须主动避开"可读文字载体"。

音频仅写实人声对白（character speaking voice）+ 与动作匹配的轻微环境音/拟音；禁止任何音乐/BGM/配乐/节奏性音轨/哼唱/歌曲。

禁止旁白/解说口播；除非明确为画面内角色开口对白，否则不得出现"旁白"内容。

**NEGATIVE：** no subtitles, no captions, no on-screen text, no typography, no credit titles, no watermark, no logos, no UI text; no music, no BGM, no soundtrack, no rhythmic audio, no humming.

---

## 硬规则

### 时长与分段

- 每段视频最长 **15.0 秒**；超出必须截断并续写为 PART2/PART3……
- 续写段开头必须与上一段结尾在站位、视线方向、手势、道具位置/持握状态上完全衔接；禁止瞬移与道具凭空出现/消失。
- 禁止服饰/发型突变（颜色、款式、发型长度与造型在同一段/续写段必须一致）。
- **镜头密度限制：** 每15秒镜头内，出场角色总数不得超过3人，以确保视觉焦点清晰。
- <!-- CHANGED: 增加动作密度控制 --> **动作密度控制：** 每个分镜（Shot）内，3秒时长内动作点不得超过2个，且必须明确起始点与终点，严禁动作堆砌导致画面崩坏。

### 总体描述（每个 PART 必须提供）

每个 PART 开头必须先输出一段"总体描述/全局约束汇总"，包含：

1. 人物与关系：用 `@act_xxx` token 列出本 PART 出场的所有角色及其关系（如"@act_001 是 @act_002 的女儿"）。**禁止内联角色的外观/服饰/材质/年龄/发型等静态属性** —— 这些由 `output/actors/actors.json` 注册的 subject 参考图承载，不在 prompt 文本里复述。
2. 场景与时间：用 `@loc_xxx` 引用场景，时间用"白日/黄昏/夜晚"等画面级描述。
3. 整体情绪基调
4. 音频策略（写实对白+环境音/拟音、无BGM）
5. 一致性约束（服饰发型不变、站位视线连续、道具不瞬移、画面无文字等）

总体描述后必须强制输出：

**剧情摘要（1-2句）：** 用"起因→转折→结果"串起这15秒

**动作节拍 Beats（按时间段列，必须与分镜动作点一致，不得另起故事）：**
```
[0-3]  …
[3-6]  …
[6-9]  …
[9-12] …
[12-15]…
```

### 音频规则

- **允许：** 画面内角色开口对白 + 与动作匹配的环境音/拟音
- **禁止：** 任何背景音乐/BGM/配乐/节奏性音轨/哼唱/歌曲
- **对白渲染约束：** 对白字段仅用于音频生成参考，严禁在画面中渲染任何文字或字幕。
- <!-- CHANGED: 增加对白与视觉同步性约束 --> **对白同步性约束：** 若对白时长超过3秒，必须在分镜描述中明确角色口型运动与对白节奏的对应关系，确保视觉与听觉同步。
- **内心OS（允许，但必须满足）：**
  - 必须标记为【OS】且写在"对白"字段内
  - 画面中角色全程不张嘴：嘴唇闭合或微抿，绝不出现口型对台词的运动；OS 出现时必须在镜头描述中明确"嘴部不动/无口型"
  - OS 不属于旁白
  - 不得擅自新增 OS 内容：只能使用用户明确提供的 OS 原句/要点

### 台词可选与来源约束（关键）

- 台词不是必选项。只有当镜头内出现明确"交流目的/信息变化/冲突升级/关键决定"时才允许台词，否则对白字段必须写"无"。
- 不得为凑数写台词；禁止每个镜头都强行安排说话。
- 台词来源约束：不得引入用户未提供的新设定/新信息作为台词内容（除非是基于已知信息的确认/追问式短句）。

### 画面文字

画面中禁止出现任何文字：字幕、片头片尾字、水印、LOGO、屏幕UI文字、招牌字、书页印字等一律不出现；描述场景与道具时必须主动避开可读文字元素。

### 分镜结构（Markdown 强制规范）

每个 shot 的 `prompt` 字段必须用以下 markdown 段块描述各分镜，禁止嵌入 JSON 代码块：

```
S1 | 00:00-00:03 | 景别/机位
- 运镜：起始参考物 → 终点参考物
- 动作：@act_xxx 动作点描述（多角色用分号分隔）
- 角色状态：@act_001 站位，情绪，可见线索；@act_002 站位，情绪，可见线索
- 音效：环境音/拟音
- 对白：无 或【@act_xxx｜情绪｜语气｜语速｜音色】"台词"

S2 | 00:03-00:06 | 景别/机位
- 运镜：……
- 动作：……
- 角色状态：……
- 音效：……
- 对白：……
```

约束：
- `S{n} | <time-range> | <景别/机位>` 是分镜首行的固定结构，`time-range` 必须形如 `00:00-00:03`，下游用正则提取镜头时长。
- 每个分镜下用短横线列表写 5 项：运镜、动作、角色状态、音效、对白；缺省项写"无"。
- 禁止在 prompt 内输出 ```` ```json ```` / ```` ``` ```` 代码块、JSON 对象或数组、键值对（如 `"shot_id":`）。整段 prompt 是纯 markdown。
- 单个 PART 内分镜按时间顺序连排，分镜之间用空行分隔。

### STORYBOARD 阶段 artifact 约定

- 每个 scene 最终只交付 `shots[]`
- 每个 `shots[]` 元素**只保留三个字段**：`id` / `duration` / `prompt`（schema 详见 `references/schema.md`）
- `id` 形如 `scn_001_clip001`，scene 内从 001 顺序递增
- `duration` 为整数秒，取值范围 `[4, 15]`（Ark Seedance 2.0 API 上限）
- `prompt` 是一段 markdown 文本，依本 skill「输出格式模板」组织：`PART` 标头、`总体描述`、`剧情摘要`、`动作节拍 Beats`、若干 `S{n} | <time-range> | 景别/机位` 分镜段块；不得再嵌入 JSON 代码块或键值对结构
- 视觉资产引用**只能**通过 prompt 内的 `@xxx` token 声明（`@act_xxx[:st_yyy]` / `@loc_xxx` / `@prp_xxx`），不引入 `actors[]` / `props[]` / `reference_images[]` 等独立字段
- `STORYBOARD` 阶段不得改写 `output/script.json`；剧本是编剧事实源，分镜是导演 artifact
- 草稿写入 `output/storyboard/draft/ep{NNN}_storyboard.json`
- 用户批准后由 `apply_storyboard_result.py --finalize-stage` 写入 `output/storyboard/approved/ep{NNN}_storyboard.json`，过程中执行 `@token` 静态校验（任一 token 在 VISUAL manifest 中找不到对应资产则 fail-fast）
- 不引入 `layout_prompt` / `sfx_prompt` / `complete_prompt_v2` / `source_refs` / `continuity` / `locked` 等历史字段

### 状态落盘与恢复

`storyboard` 是 `STORYBOARD` 阶段，必须同步维护 `${PROJECT_DIR}/pipeline-state.json`。

推荐写入口：

```bash
python3 ./scripts/pipeline_state.py ensure --project-dir "${PROJECT_DIR}"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage STORYBOARD --status running --next-action "review STORYBOARD"
python3 ./.claude/skills/storyboard/scripts/apply_storyboard_result.py --project-dir "${PROJECT_DIR}" --input-json /tmp/ep001_scn001_storyboard.json
```

- 进入阶段时：设置 `current_stage=STORYBOARD`、`stages.STORYBOARD.status=running`
- 单集 shots 生成完成后，先写 `${PROJECT_DIR}/output/storyboard/draft/ep{NNN}_storyboard.json`
- 用户批准后复制/写入 `${PROJECT_DIR}/output/storyboard/approved/ep{NNN}_storyboard.json`
- approved canonical 写出并通过 `shots[].prompt` 门控后，设置 `episodes.ep{NNN}.storyboard.status=completed`
- 全部目标集完成后，设置 `stages.STORYBOARD.status=validated`，`next_action=enter VIDEO`

建议检查点命令：

```bash
python3 ./scripts/pipeline_state.py episode --project-dir "${PROJECT_DIR}" --episode "ep${NNN}" --kind storyboard --status completed --artifact "output/storyboard/approved/ep${NNN}_storyboard.json"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage STORYBOARD --status validated --next-action "enter VIDEO"
python3 ./.claude/skills/storyboard/scripts/apply_storyboard_result.py --project-dir "${PROJECT_DIR}" --input-json /tmp/ep${NNN}_scene_storyboard.json --finalize-stage
```

恢复顺序：

1. 先读 `${PROJECT_DIR}/pipeline-state.json`
2. 若缺失，再检查 `${PROJECT_DIR}/output/storyboard/approved/ep{NNN}_storyboard.json`
3. 若 approved 缺失，检查 `${PROJECT_DIR}/output/storyboard/draft/ep{NNN}_storyboard.json` 并提示用户审阅/批准

### 离线批量草稿 helper（可选）

当需要不经过交互式 Claude Agent SDK、直接批量生成导演分镜草稿时，使用本 skill 内的 helper：

```bash
python3 ./.claude/skills/storyboard/scripts/storyboard_batch.py "${PROJECT_DIR}" --concurrency 5
```

- 该 helper 只写 `output/storyboard/draft/ep{NNN}_storyboard.json`
- 它不得写回 `output/script.json`
- 它不得直接进入 VIDEO 阶段
- 批准 draft 后，才复制/写入 `output/storyboard/approved/ep{NNN}_storyboard.json`
- 默认通过 `.claude/skills/_shared/aos_cli_model.py` 调用 `aos-cli model run`，使用 `capability=generate` 与 `output.kind=json`
- 执行前可运行 `uv run --project aos-cli aos-cli model preflight --json` 检查模型边界运行时配置
- 默认 storyboard 文本模型为 `gemini-3.1-pro-preview`；可通过 `STORYBOARD_TEXT_MODEL` 或通用 `GEMINI_TEXT_MODEL` 指定，最终作为 `modelPolicy.model` 传入 `aos-cli model`

### 出镜角色与情绪/状态（角色引用规范）

**统一引用规范：**
- 任何角色出现都必须写成 `@act_xxx` token（act_id 取自 `output/script.json` / `actors.json`），禁止用中文名直写
- 当一个 actor 在 `script.json` 的 `actors[].states[]` 中注册了**多个 state**时，引用必须写成 `@act_xxx:st_yyy`，其中 `st_yyy` 取自该 actor 的 state_id；只注册单个 state 或无 state 时，直接写 `@act_xxx`
- 禁止虚构未注册的 `st_yyy`；同一 PART 内同一 actor 一般保持同一个 state_id，只有剧情发生明确换装/换状态时才允许切换
- 场景写成 `@loc_xxx`，关键道具写成 `@prp_xxx`（道具 ID 前缀沿用 asset-gen / props.json 的 `prp_` 缩写）
- token 的外观/服饰/年龄/材质等静态属性由对应 subject 参考图承载，**严禁在 prompt 文本里复述**

**"角色状态"字段写法：**
用**一行统一描述**列出本镜出场角色的动态信息，多个角色用分号 `；` 分隔；多 state 角色 token 必须带 `:st_yyy` 后缀：
```
@act_001:st_002 站位（左/右/前景/后景），情绪/紧张度，可见线索；@act_002:st_004 站位，情绪，可见线索
```
- 禁止给每个角色单独加括号尾注（如 `苏父（左侧偏后, 五十岁农夫, 粗布短衫…）` 这种格式严禁出现）
- 禁止重复罗列外观/服饰

若镜头为手部特写/背影/遮挡导致看不见脸：禁止描述"表情细节"（如眉眼嘴角），改写为可见状态线索，例如：
- 手部：握紧/颤抖/指节发白/掌心出汗擦裤缝
- 背影：肩线塌下/背部僵硬/步伐迟疑/停顿
- 半遮挡：只写能看到的部分（如下颌绷紧、喉结吞咽、侧脸紧绷）

### 动作点（核心）

- 每 **3.0 秒**至少出现 1 个明确可见动作点。动作点必须导致至少一项成立：
  - 肢体位置变化
  - 道具位移或状态变化
  - 明确交互
  - 镜头运动触发或配合
- 眨眼/细微表情变化/自然呼吸**不计入**动作点。
- 单个分镜时长>3秒时，必须写成两个连贯动作点 A→B；否则拆分为两个分镜。
- 禁止重复循环同一动作点来充时长；动作必须推进信息或关系变化。

### 景别/机位与运镜

- 每个分镜必须明确写：景别/机位（近景/中景/全景/手部特写/背影中景等）。过肩镜头只可作为**双人对白的辅助 coverage** 使用，必须服务于新的信息点或回应点，禁止机械性来回切过肩。
- 同一景别或同一机位连续不得超过 2 个分镜；第 3 个必须更换景别或角度。
- 每次切镜必须服务于新的动作点或信息点，禁止无信息切换。
- <!-- CHANGED: 增加运镜空间参考约束 --> **运镜空间参考：** 凡使用“跟随/推进/横移”运镜，必须明确起始坐标（如：从左侧门框）与终点参考物（如：至角色面部特写），确保AI生成路径可控。

---

## 对白格式

仅在有对白/OS 时使用；无则写"无"。

**普通对白：**
```
【@act_xxx｜情绪｜语气｜语速(慢/中/快)｜音色(清冷/沙哑等)】"台词"
```

**OS格式：**
```
【@act_xxx｜OS｜情绪｜语气｜语速(慢/中/快)｜音色】"用户提供的OS原句/要点"
```

`@act_xxx` 必须使用 `actors.json` 中已注册的 actor_id；禁止用中文角色名直写。

禁止单独的"旁白段落"；对白只能写在对应分镜内。

---

## 输出格式模板（必须遵守）

```
PART1

总体描述：……

剧情摘要：……

动作节拍 Beats：
[0-3]  …
[3-6]  …
[6-9]  …
[9-12] …
[12-15]…

S1 | 00:00-00:03 | 景别/机位
- 运镜：起始参考物 → 终点参考物
- 动作：@act_xxx[:st_yyy] 动作点描述
- 角色状态：@act_001:st_002 站位，情绪，可见线索；@act_002:st_004 站位，情绪，可见线索
- 音效：环境音/拟音
- 对白：无 或【@act_xxx[:st_yyy]｜情绪｜语气｜语速｜音色】"台词"

S2 | 00:03-00:06 | 景别/机位
- 运镜：……
- 动作：……
- 角色状态：……
- 音效：……
- 对白：……
```

整段 prompt 必须是纯 markdown，禁止再嵌入 fenced JSON 代码块或 `"shot_id"` / `"beats"` 等键值对结构。所有角色/场景/道具引用必须用 `@act_xxx`（多 state 时 `@act_xxx:st_yyy`）/ `@loc_xxx` / `@prp_xxx` token，禁止内联外观/服饰/材质等静态属性。

---

## 参考图输入流程

如果用户把一张参考图作为输入，优先用图中信息补全：**人物外观锚点、站位、道具与空间结构**；仍缺的部分再以问题列表向用户确认（标记为【INPUT-CHECK】）。

---

## 多集并行策略

🔴 **处理多集分镜时必须执行以下判断：**

1. 确定待处理集数（从 `script.json` 的 `episodes[]` 中筛选未生成 approved storyboard 的集数）
2. **若待处理 ≤ 3 集**：在当前 session 中逐集生成分镜
3. **若待处理 > 3 集**：**必须**使用 Agent subagents 并行生成

**并行执行流程（> 3 集时强制执行）：**

```
读取 script.json → 筛选未生成 approved storyboard 的 episodes
按每组 3 集分组，上限 8 个并行 Agent
每个 Agent 读取 script.json 中本组集的 scenes 数据
每个 Agent 输出本组集的 shots 数据（JSON 结构，返回给主 session）
主 session 收到所有 Agent 结果后，先逐集落盘到 `output/storyboard/draft/ep{NNN}_storyboard.json`，等待用户审阅/批准
```

推荐直接调用：

```bash
python3 ./.claude/skills/storyboard/scripts/apply_storyboard_result.py \
  --project-dir "${PROJECT_DIR}" \
  --input-json /tmp/ep${NNN}_scene_storyboard.json
```

每个 Agent subagent 的 prompt **必须包含**：
1. `script.json` 中**本组集**的完整 scenes 数据（含 actions[]）
2. `${PROJECT_DIR}/output/actors/actors.json`（角色外观描述 + subject_id 映射）
3. `${PROJECT_DIR}/output/locations/locations.json`（场景描述 + subject_id 映射）
4. 本 skill 的 CORE 核心提示词 + 硬规则（完整复制到 prompt 中）
5. **输出约束**：「以 JSON 格式返回本组集所有 scenes 的 `shots[]` 数据。不要写入文件，直接返回结构化结果。」

> 注意：storyboard 的输出最终写入 draft/approved storyboard artifact，不写回 `script.json`。Agent subagent **不直接修改共享文件**，只返回 shots 数据给主 session，由主 session 落盘为草稿。
