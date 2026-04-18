---
name: music-matcher
description: "基于向量语义匹配的智能视频配乐。输入一个视频文件，自动完成 Gemini 视频分析、向量匹配选曲、FFmpeg 合成，输出配好背景音乐的视频。Applicable to: music-matcher, 配乐, 给视频配乐, 视频配乐, 自动配乐, 智能配乐, 匹配音乐, 背景音乐, BGM, 加背景音乐."
allowed-tools:
  - mcp__anime-mcp__match_music
  - Bash
  - Read
argument-hint: "[视频文件路径或目录]"
---

# Music Matcher — 智能视频配乐

输入一个视频文件，自动完成：Gemini 视频分析 → MCP 向量匹配选曲 → FFmpeg 合成配乐视频。
支持单视频和批量目录两种模式。

## Resources

- **视频分析脚本**：`scripts/analyze_video.py` — 压缩视频 + Gemini 分析 → segments JSON
- **合成脚本**：`scripts/compose.py` — 下载音频 + ffmpeg 混音 → 配乐视频（快速预览）
- **专业交付脚本**：`scripts/compose_pro.py` — 输出成片 MP4 + Premiere XML 工程文件
- **批量分析脚本**：`scripts/batch_analyze.py` — 并发 Gemini 分析目录下所有视频
- **批量合成脚本**：`scripts/batch_compose.py` — 并发 ffmpeg 合成所有配乐视频
- **Gemini 提示词**：`assets/video_analysis.txt` — 视频分析 prompt
- **默认配置**：`assets/default.env` — 内置默认参数（无需用户手动创建 .env）
- **MCP 工具**：`mcp__anime-mcp__match_music` — 向量匹配选曲

## Prerequisites（首次使用时检查）

运行前确认以下环境：

| 依赖 | 检查方式 | 安装 |
|------|---------|------|
| Python 3.10+ | `python3 --version` | — |
| ffmpeg / ffprobe | `ffmpeg -version` | `brew install ffmpeg` |
| google-genai | `pip show google-genai` | `pip install google-genai` |
| python-dotenv | `pip show python-dotenv` | `pip install python-dotenv` |
| GEMINI_API_KEY | 环境变量 `echo $GEMINI_API_KEY` | 从 Google AI Studio 获取 |
| MCP anime-mcp | Claude Code MCP 设置中已配置 | — |

**GEMINI_API_KEY** 是唯一必需的用户配置。脚本会按以下优先级读取配置：
1. 系统环境变量（最高优先）
2. 当前目录 `.env` 文件
3. skill 内置 `assets/default.env`（兜底默认值）

如果环境变量和 CWD 都没有 GEMINI_API_KEY，提示用户设置：`export GEMINI_API_KEY=xxx`

## Workflow

### 输入确认

用户会提供一个视频文件路径或目录路径（通过参数 `$ARGUMENTS` 或对话中）。

**判断模式**：
- 如果 `$ARGUMENTS` 是一个**目录**（如 `./videos/`）→ 进入**批量模式**（见下方「批量模式」章节）
- 如果 `$ARGUMENTS` 是一个**文件** → 进入**单视频模式**（继续下面的流程）

确认：
1. 文件存在且为视频格式（.mp4/.mov/.avi/.mkv 等）
2. GEMINI_API_KEY 已配置（环境变量或 .env）

如果用户没给视频路径，先扫描当前目录，再问。

### Step 0：配置确认

在开始分析前，读取 `assets/default.env` 展示当前生效的关键配置，让用户确认或修改。如果用户要修改某个参数，用环境变量方式传给脚本（在 bash 命令前加 `KEY=value`），不修改文件。

### Step 1：视频分析

运行分析脚本（在用户的当前工作目录下执行）：

```bash
python3 ./.claude/skills/music-matcher/scripts/analyze_video.py <视频文件路径>
```

脚本会自动：
- 大文件(>100MB)先压缩到 720p/12fps
- 上传到 Gemini Files API
- 调用 Gemini 分析视频内容
- 输出到 `output/segments-<视频名>-<时间戳>.json`

**等待脚本完成**，然后读取生成的 segments JSON 文件。

### Step 2：MCP 向量匹配选曲

读取 Step 1 输出的 segments JSON，构造 MCP 调用。MCP 调用字段映射和示例见 `references/mcp-match-music.md`。

**注意**：
- 只传 `needs_music: true` 的片段（`needs_music: false` 的直接跳过，mood 等字段传空字符串即可）
- 不需要传 `duration_seconds`（MCP 会自动从 start/end 计算）

收到 MCP 返回后，将结果保存到 `output/results-<视频名>.json`。

向用户展示匹配结果摘要：每个片段的 Top1 匹配（文件名 + 相似度）。询问用户是否满意，或是否要调整（如换用 Top2），若匹配度全部大于 80%，且没有重复的，可以不用询问，直接进行下一步合成。

### Step 3：合成配乐视频

用户确认后，运行合成：

```bash
python3 ./.claude/skills/music-matcher/scripts/compose.py <原视频路径> <results.json路径> --rank 1 --volume -6
```

参数说明：
- `--rank N`：使用第 N 名匹配（默认 1 = Top1）
- `--volume -N`：配乐音量 dB（默认 -6，越小越安静）

输出：
- `output/compose-<视频名>-<时间戳>.mp4` — 配乐视频
- `output/compose-<视频名>-<时间戳>.txt` — 配乐清单

### Step 3-Pro：专业交付（可选）

如果是**正式交付**而非快速预览，使用专业交付脚本输出成片 + Premiere 工程文件：

```bash
python3 ./.claude/skills/music-matcher/scripts/compose_pro.py <上游ep目录> <results.json> --rank 1 --volume -6
```

**输入**：
- 上游 ep 目录：包含 `ep00x.mp4` 和 `ep00x.xml` 的目录（上游剪辑输出）
- results.json：Step 2 的 MCP 匹配结果

**输出**（在 `output/ep00x/` 目录下）：
```
output/ep00x/
├── ep00x_final.mp4     # 成片（配乐已混入）
├── ep00x_final.xml     # Premiere 工程文件
└── _tmp/               # 配乐素材（XML 相对路径引用）
    ├── music_001.mp3
    └── music_002.mp3
```

**ep00x_final.xml 包含**：
- V1 视频轨：引用 `ep00x_final.mp4`
- A1-A2 原声轨：已混入 mp4
- A3~An 配乐轨：独立轨道，引用 `_tmp/*.mp3`（后期可单独调整音量/时机）

### 完成

告知用户输出文件路径，建议预览检查效果。如需调整：
- 换曲：重新运行 Step 3，`--rank 2` 或 `--rank 3`
- 音量：调整 `--volume` 参数（如 `-10` 更安静）
- 重新分析：重新运行 Step 1

## 单步模式

如果用户只需要部分流程：

**仅分析视频**：只执行 Step 1，输出 segments JSON
**仅合成**：用户已有 results.json，直接执行 Step 3

## 配置说明

所有参数都有内置默认值（见 `assets/default.env`），用户只需配置 `GEMINI_API_KEY`。

**覆盖方式**（任选其一）：
1. **环境变量**：`export GEMINI_MODEL=gemini-2.5-flash`（推荐）
2. **CWD/.env 文件**：在当前工作目录创建 `.env`
3. **运行时传参**：`GEMINI_MODEL=gemini-2.5-flash python3 ./.claude/skills/music-matcher/scripts/analyze_video.py ...`

## Key Rules

- 用中文简体与用户交流
- Step 1 和 Step 3 用 Bash 工具执行 Python 脚本，Step 2 用 MCP 工具调用
- 合成视频时 `-c:v copy` 不重新编码视频轨，只处理音频
- 每步完成后向用户汇报进度
- 如果 MCP 匹配返回的某片段无结果（matches 为空），告知用户并跳过该片段
- results.json 中的 `audio_url` 是临时 URL，合成时会自动下载

## 统一状态文件

`music-matcher` 是 `MUSIC` 阶段，必须同步维护 `${PROJECT_DIR}/workspace/pipeline-state.json`。

- 进入阶段时：设置 `current_stage=MUSIC`、`stages.MUSIC.status=running`
- `segments-*.json` 或 `results-*.json` 已写出但尚未合成完成时：设置 `episodes.ep{NNN}.music.status=partial`
- `ep{NNN}_final.mp4` 与 `ep{NNN}_final.xml` 写出后：设置 `episodes.ep{NNN}.music.status=completed`
- 批量目标集全部完成后：设置 `stages.MUSIC.status=validated`，`next_action=enter SUBTITLE`

## 批量模式

当输入为目录时自动进入批量模式，分三阶段执行。所有脚本使用固定文件名（无时间戳），支持断点续传——已有输出文件的视频自动跳过，中断后重跑即可。

```bash
# Phase 1: Concurrent Gemini analysis
python3 ./.claude/skills/music-matcher/scripts/batch_analyze.py <video_dir> [--workers 3] [--recursive]

# Phase 2: Sequential MCP matching (Claude executes, same as single-video Step 2)

# Phase 3: Concurrent FFmpeg composition
python3 ./.claude/skills/music-matcher/scripts/batch_compose.py <video_dir> [--rank 1] [--volume -6] [--workers 4] [--recursive]
```

Phase 2 由主 agent 顺序循环执行 MCP 调用（读取 `output/segments-*.json`，逐个匹配保存 `output/results-*.json`），无需用户逐个确认。各脚本详细参数见 `--help`。
