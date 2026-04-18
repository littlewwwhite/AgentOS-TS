---
name: video-editing
description: "AI 驱动的漫剧视频剪辑：多变体选优、Gemini 循环剪辑引擎、Premiere XML 工程生成。三阶段流水线自动完成从素材分析到成片输出。Applicable to: 视频剪辑, 剪辑视频, 自动剪辑, 漫剧剪辑, video editing, 变体选优, 多变体选优, 素材拼接, 生成XML, 导出Premiere, 循环质检, 拼接视频, 合并视频, 剪辑引擎"
argument-hint: "[ep编号，如 ep001]"
---

# AI 漫剧自动剪辑

三阶段流水线：对 AI 生成的多变体视频素材进行分析、选优、剪辑，输出 Premiere 工程文件和成片视频。

> **路径约定**：文档内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 含义保持不变。

```
${PROJECT_DIR}/output/ep{NNN}/scn*/clip*/*.mp4  (多变体素材)
        ↓
  Phase 1: PySceneDetect + Gemini 多变体对比 → analysis.json
        ↓
  Phase 2: 剪辑引擎（切点调整/跳过镜头/过渡效果/变体替换）→ edit_decision.json
        ↓
  Phase 3: 合并所有 scn plan → 从源文件直接拼接 ep.mp4 + ep.xml
        ↓
${PROJECT_DIR}/output/ep{NNN}/ep{NNN}.mp4 + ep{NNN}.xml  (最终交付)
```

## 核心理念

**Phase 2 是真正的剪辑引擎，不只是变体替换器。**

无论上游素材质量如何，Phase 2 的职责是：**把手上的素材剪辑成能看的东西**。

剪辑手段包括：
1. **trim** - 调整切点（裁掉有问题的片段）
2. **skip** - 跳过镜头（删掉重复/无用的 shot）
3. **add_transition** - 添加过渡效果（淡入淡出/叠化）
4. **reorder** - 调整镜头顺序
5. **replace_variant** - 替换变体（最后手段）

## Resources

- **一键脚本（首选）**：`scripts/run_pipeline.py` — 一次调用完成全部 3 个阶段
- **分阶段脚本（备用）**：`scripts/phase1_analyze.py`, `scripts/phase2_assemble.py`, `scripts/phase3_merge.py`
- **切镜工具**：`scripts/detect_scenes.py` — 独立 PySceneDetect 切镜检测
- **Prompt 模块**：`assets/phase1_clip_scoring.py`, `assets/phase2_loop_analysis.py`
- **默认配置**：`assets/default.env` — Gemini 模型、压缩参数、循环阈值等

## 依赖

### Python 包
```bash
pip install google-genai python-dotenv "scenedetect[opencv]" av
```

### 系统工具
- `ffmpeg` + `ffprobe`（视频拼接和分析）

### 环境变量
- `GEMINI_API_KEY` — 必须设置。可写在项目根目录 `.env` 文件中。

## Workflow

### ⚡ 一键执行（首选，必须优先使用）

**禁止逐集逐阶段调用分阶段脚本**。使用一键脚本一次完成所有集的全部阶段：

```bash
python3 ./.claude/skills/video-editing/scripts/run_pipeline.py \
  ${PROJECT_DIR}/output \
  --skip-existing \
  --concurrency 2
```

**可选参数**：
- `--episodes ep001,ep003` — 只处理指定集
- `--skip-existing` — 跳过已有输出（断点续传）
- `--concurrency N` — Phase 2 并行数（默认 2）

**输出**：
- 每集 `ep{NNN}.mp4` + `ep{NNN}.xml`
- 汇总 `editing_summary.json`（含每集状态和路径）

### 统一状态文件

`video-editing` 是 `EDITING` 阶段，必须同步维护 `${PROJECT_DIR}/workspace/pipeline-state.json`。

- 进入阶段时：设置 `current_stage=EDITING`、`stages.EDITING.status=running`
- `_tmp/` 下已有 `analysis.json` 或 `edit_decision.json` 时：设置 `episodes.ep{NNN}.editing.status=partial`
- `ep{NNN}.mp4` 与 `ep{NNN}.xml` 写出后：设置 `episodes.ep{NNN}.editing.status=completed`
- 汇总 `editing_summary.json` 验证通过后：设置 `stages.EDITING.status=validated`，`next_action=enter MUSIC`

`editing_summary.json` 是本 skill 的局部汇总；跨 skill 恢复时应优先看 `pipeline-state.json`。

**Agent 操作流程**（最多 3 次 tool call）：
1. `Bash`: 环境检查（依赖 + GEMINI_API_KEY）
2. `Bash`: 运行 `run_pipeline.py`（一次完成所有工作）
3. `Read`: 读 `editing_summary.json` 验证结果

---

### 分阶段执行（备用，仅在一键脚本失败时使用）

> **注意**：以下分阶段步骤仅在 `run_pipeline.py` 失败或需要单独调试某个阶段时使用。正常情况下禁止使用。

#### 0. 前置检查（每次执行前按序完成）

#### 步骤 0-A: 环境依赖检查

```bash
python3 ./.claude/skills/video-editing/scripts/preflight_awb.py \
  --check deps \
  --deps google-genai,python-dotenv,"scenedetect[opencv]" --cmds ffmpeg --env GEMINI_API_KEY
```

> `ffmpeg` macOS 安装: `brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass`（需含 libass 以支持字幕烧录）。

### 1. 定位素材

根据参数 `` 确定集数编号（如 `ep001`）。

**素材来源约定**：
- 交付清单：`${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_delivery.json`
- 分镜表（可选）：`${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_storyboard.json`
- 视频文件：`${PROJECT_DIR}/output/ep{NNN}/scn{NNN}/clip{NNN}/*.mp4`

### 2. Phase 1 — 变体分析与选优

对每个 clip 目录运行分析：

```bash
python3 ./.claude/skills/video-editing/scripts/phase1_analyze.py \
  ${PROJECT_DIR}/output/ep{NNN} \
  --storyboard auto \
  --skip-existing
```

**做什么**：
- PySceneDetect 切镜检测
- Gemini 多模态分析：逐 shot 对比所有变体，评分质量、脚本匹配度
- 输出每个 clip 的 `analysis.json`，含推荐混剪方案

**输出位置**：`${PROJECT_DIR}/output/ep{NNN}/_tmp/scn{NNN}/clip{NNN}/analysis.json`

### 3. Phase 2 — 循环剪辑引擎

对每个 scn 运行剪辑引擎：

```bash
python3 ./.claude/skills/video-editing/scripts/phase2_assemble.py \
  ${PROJECT_DIR}/output/ep{NNN} \
  --project-dir ${PROJECT_DIR} \
  --storyboard auto \
  --concurrency 4
```

**做什么**：

1. **构建初始方案**：从 Phase 1 的推荐方案提取
2. **循环剪辑**：
   - ffmpeg 拼接当前方案
   - Gemini 评估 + 给出剪辑建议（不只是问题）
   - 执行剪辑动作（优先 trim/skip/transition，最后才 replace_variant）
   - 重新评估
3. **终止条件**：评分 ≥ 7.5 OR 达到 3 轮 OR 无可用动作

**Gemini 输出的剪辑建议**：
```json
{
  "overall_score": 7.5,
  "edit_suggestions": [
    {"shot_id": "clip001_shot_2", "action": "trim", "params": {"trim_type": "out", "new_time": 8.5}},
    {"shot_id": "clip001_shot_3", "action": "skip", "params": {"reason": "与shot_1重复"}},
    {"shot_id": "clip001_shot_4", "action": "add_transition", "params": {"type": "fade", "duration": 0.3}}
  ],
  "summary": "通过裁剪和跳过解决了主要问题"
}
```

**输出位置**：
- `${PROJECT_DIR}/output/ep{NNN}/_tmp/scn{NNN}/edit_decision.json`
- `${PROJECT_DIR}/output/ep{NNN}/_tmp/scn{NNN}/*_r{N}.mp4`（临时视频）

### 4. Phase 3 — EP 级合并

合并所有 scn 为完整单集：

```bash
python3 ./.claude/skills/video-editing/scripts/phase3_merge.py \
  ${PROJECT_DIR}/output/ep{NNN}
```

**输出位置**：
- `${PROJECT_DIR}/output/ep{NNN}/ep{NNN}.xml`（Premiere XML 工程）
- `${PROJECT_DIR}/output/ep{NNN}/ep{NNN}.mp4`（成片视频）

### 5. 验证输出

完成后检查：
1. `${PROJECT_DIR}/output/ep{NNN}/ep{NNN}.mp4` 存在且时长合理
2. `${PROJECT_DIR}/output/ep{NNN}/ep{NNN}.xml` 存在且是有效 XML

## Key Rules

- 用中文简体与用户交流
- 脚本命令统一使用仓库根相对路径 `./.claude/skills/video-editing/scripts/...`
- 所有中间产物写入 `${PROJECT_DIR}/output/ep{NNN}/_tmp/`，最终交付写入 `${PROJECT_DIR}/output/ep{NNN}/`
- Phase 2 **无论素材质量如何都要输出成片**，不因素材差而中断
- 剪辑动作优先级：trim/skip/transition > reorder > replace_variant
- 每轮最多执行 3 个剪辑建议，聚焦最关键的问题

## 配置调优

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `LOOP_SCORE_THRESHOLD` | 7.5 | 循环终止分数阈值 |
| `LOOP_MAX_ITERATIONS` | 3 | 最大循环轮次 |
| `CONCURRENCY` | 4 | scn 级并行数 |
| `COMPRESS_BEFORE_UPLOAD` | true | 上传 Gemini 前压缩视频 |
| `COMPRESS_CRF` | 28 | 压缩质量 |

## References

| Document | Content |
|----------|---------|
| `references/phase2_spec.md` | Phase 2 循环剪辑引擎详细规格（评估 prompt、剪辑动作优先级、终止条件） |

## Troubleshooting

### Gemini API errors
- **Rate limit**: Wait 60s and retry. For batch operations, add `--delay 2` between requests.
- **Invalid API key**: Verify `GEMINI_API_KEY` env var is set. Re-export if expired.
- **Timeout**: Increase timeout with `--timeout 120`. Long videos may need 180s+.

### FFmpeg errors
- **Missing codec**: Ensure ffmpeg is built with libx264. On macOS: `brew install ffmpeg`.
- **File not found**: Verify input paths are absolute and files exist before running.
- **Permission denied**: Check write permissions on `${PROJECT_DIR}/output/`.

### Missing analysis.json
- Phase 1 (`phase1_analyze.py`) must complete before Phase 2. Check that `analysis.json` exists in the episode directory.
- If Phase 1 was interrupted, re-run it: `python3 ./.claude/skills/video-editing/scripts/phase1_analyze.py ${PROJECT_DIR}/output/ep{NNN}`

### Phase 2 assembly failures
- **"No clips found"**: Ensure Phase 1 analysis found valid video clips. Check `analysis.json` for empty segments.
- **Storyboard mismatch**: Verify the storyboard JSON episode number matches the video directory.
