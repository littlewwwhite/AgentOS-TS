---
name: subtitle-maker
description: "智能字幕生成：剧本名词提取 → Gemini ASR 转录 → SRT 生成 → 字幕烧录 → XML 字幕轨道。Applicable to: subtitle, 字幕, 加字幕, 生成字幕, ASR, 语音识别, 转录, SRT, 烧录字幕."
argument-hint: "[视频文件路径] [--episode ep_001]"
---

# Subtitle Maker — 智能字幕生成

输入配乐后的视频，自动完成：剧本名词提取 → Gemini ASR 转录（字幕指南辅助） → SRT 生成 → 字幕烧录 MP4 → XML 字幕轨道。

## Resources

- **环境检查脚本**：`scripts/phase0_check.py` — 检查所有依赖，缺失时给出安装指令
- **名词提取脚本**：`scripts/phase1_glossary.py` — 剧本 → 字幕指南 JSON
- **ASR 转录脚本**：`scripts/phase2_transcribe.py` — Gemini ASR → 逐句时间戳 JSON
- **SRT 生成脚本**：`scripts/phase3_srt.py` — ASR JSON → SRT 文件
- **字幕烧录脚本**：`scripts/phase4_burn.py` — SRT → 烧录字幕的 MP4
- **XML 字幕轨脚本**：`scripts/phase5_xml.py` — SRT → FCP XML 字幕轨道
- **ASR 提示词**：`assets/asr_prompt.txt` — Gemini ASR prompt（含 `{glossary_hint}` 占位符）
- **默认配置**：`assets/default.env` — 内置默认参数
- **样式预设**：`assets/styles.json` — 字幕样式预设（横/竖 × 有描边/无描边 = 4 套）
- **样式加载模块**：`scripts/styles.py` — 共享样式加载（ffprobe 探测视频方向 → 自动选择预设）

## Prerequisites（首次使用时检查）

| 依赖 | 检查方式 | 安装 |
|------|---------|------|
| Python 3.10+ | `python3 --version` | — |
| ffmpeg (含 libass) | `ffmpeg -filters \| grep subtitle` | macOS: `brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg`；Linux: `apt install ffmpeg` |
| google-genai | `pip show google-genai` | `pip install google-genai` |
| python-dotenv | `pip show python-dotenv` | `pip install python-dotenv` |
| GEMINI_API_KEY | `echo $GEMINI_API_KEY` | 填写 ChatFire key |
| 中文字体 (Noto Sans CJK) | `fc-list :lang=zh` | macOS 自带；Linux: `apt install fonts-noto-cjk` |

> **macOS 用户注意**：`brew install ffmpeg`（homebrew/core）是精简版，**不含 libass**，subtitles 滤镜不可用。必须用 `homebrew-ffmpeg/ffmpeg` tap 安装完整版。

可用 Phase 0 脚本一键检查：`python3 ./.claude/skills/subtitle-maker/scripts/phase0_check.py`

**GEMINI_API_KEY** 是唯一必需的用户配置，值填写 ChatFire key。配置优先级同 music-matcher：
1. 系统环境变量
2. CWD `.env`
3. skill 内置 `assets/default.env`

## 工作顺序（ASR 用原始视频 → 配乐 + 字幕合并）

本 skill 与 music-matcher 并行独立运行，各自处理不同输入：

1. **ASR 转录**（Phase 1-3）：输入 `${PROJECT_DIR}/output/ep00x/ep00x.mp4`（**原始剪辑，无 BGM**，避免干扰 ASR）
2. **字幕烧录**（Phase 4）：输入配乐视频 `output/ep00x/ep00x_final.mp4` + SRT → 输出最终成品（配乐 + 字幕）
3. **XML 字幕轨**（Phase 5）：追加字幕轨到配乐 XML

## Workflow

## 统一状态文件

`subtitle-maker` 是 `SUBTITLE` 阶段，必须同步维护 `${PROJECT_DIR}/pipeline-state.json`。

- 进入阶段时：设置 `current_stage=SUBTITLE`、`stages.SUBTITLE.status=running`
- `glossary.json`、`asr.json`、`ep{NNN}.srt` 任一已生成但最终视频未完成时：设置 `episodes.ep{NNN}.subtitle.status=partial`
- `ep{NNN}.mp4`、`ep{NNN}.xml`、`ep{NNN}.srt` 写出后：设置 `episodes.ep{NNN}.subtitle.status=completed`
- 全部目标集完成并验证后：设置 `stages.SUBTITLE.status=validated`

恢复顺序：

1. 优先读取 `${PROJECT_DIR}/pipeline-state.json`
2. 若缺失，再检查 `output/ep{NNN}/_tmp/asr.json`
3. 最后检查 `output/ep{NNN}/ep{NNN}.mp4`、`ep{NNN}.xml`、`ep{NNN}.srt`

### 输入确认

用户提供：
1. **视频文件**：通常是 `output/ep00x/ep00x_final.mp4`（music-matcher 的输出）
2. **剧集 ID**（可选）：如 `ep_001`，用于从剧本提取对白

确认：
1. 视频文件存在
2. GEMINI_API_KEY 已配置
3. 上游剧本 `${PROJECT_DIR}/output/script.json` 存在（Phase 1 需要）

### Phase 0：环境检查

**首次使用时必须运行**，后续可跳过。检查所有依赖是否就绪。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase0_check.py
```

检查项：Python 版本、ffmpeg + subtitles 滤镜（libass）、google-genai、python-dotenv、GEMINI_API_KEY、中文字体。

如有缺失，脚本会输出具体的安装命令。加 `--fix` 可自动安装 Python 包：

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase0_check.py --fix
```

> **重点**：如果 ffmpeg subtitles 滤镜检查失败，Phase 4 无法运行。必须先修复再继续。

### Phase 1：提取字幕指南

从上游剧本中提取专有名词和对白文本，生成字幕指南供 ASR 参考。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase1_glossary.py ${PROJECT_DIR}/output/script.json --episode ep_001 --ep-dir output/ep001
```

输出：`output/ep001/_tmp/glossary.json`（中间产物）

### Phase 2：Gemini ASR 转录

上传**原始剪辑视频**（无 BGM）到 Gemini，带字幕指南提示词进行语音识别。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase2_transcribe.py ${PROJECT_DIR}/output/ep001/ep001.mp4 --glossary output/ep001/_tmp/glossary.json --ep-dir output/ep001
```

可选参数：
- `--language <语言代码>`：强制指定 ASR 输出语言（zh/ja/ko/en）。不传则从 glossary 读取。

脚本自动：
- 压缩视频（480p + 128kbps 音频，侧重语音质量）
- 读取 glossary，注入 ASR prompt 的 `{glossary_hint}` 占位符
- 根据语言选择对应的 ASR 指令（中文简体/日语/韩语/英语）
- 上传到 Gemini Files API + 调用 ASR
- 输出 `output/ep001/_tmp/asr.json`（中间产物，含 language + segments）

**等待脚本完成**，读取 ASR JSON 向用户展示转录结果摘要。

### Phase 3：生成 SRT

将 ASR JSON 转为标准 SRT 字幕文件。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase3_srt.py output/ep001/_tmp/asr.json --output output/ep001/ep001.srt
```

可选参数：
- `--show-speaker`：在字幕文本前加角色名前缀

输出：`output/ep001/ep001.srt`（**交付文件**）

### Phase 4：烧录字幕

用 FFmpeg subtitles 滤镜将 SRT 烧录进视频。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase4_burn.py output/ep001/ep001_final.mp4 output/ep001/ep001.srt --output output/ep001/ep001.mp4
```

可选参数：
- `--style <预设名>`：指定字幕样式预设（horizontal/vertical/horizontal_clean/vertical_clean）。不传则自动检测视频方向。
- `--language <语言代码>`：强制指定语言（zh/ja/ko/en）。不传则从 ASR JSON 读取。

**注意**：此步骤**必须重编码视频轨**（libx264 crf=18），音频 `-c:a copy`。

字幕样式由 `assets/styles.json` 管理，字号/描边/底距按视频高度比例自动计算。

输出：`output/ep001/ep001.mp4`（**交付文件**：配乐 + 字幕）

### Phase 5：XML 字幕轨道

在现有 FCP XML 中追加字幕轨道。

```bash
python3 ./.claude/skills/subtitle-maker/scripts/phase5_xml.py output/ep001/ep001_final.xml output/ep001/_tmp/asr.json --output output/ep001/ep001.xml --video output/ep001/ep001_final.mp4
```

可选参数：
- `--style <预设名>`：指定字幕样式预设（同 Phase 4）
- `--language <语言代码>`：强制指定语言（同 Phase 4）
- `--video <视频路径>`：视频文件路径，用于 ffprobe 探测尺寸自动选择样式。不传时尝试从 XML 同目录找 `_final.mp4`。

在 `<media><video>` 下追加 V2 字幕轨道，每条字幕 → 一个 `<generatoritem>`（Text generator）。样式与 Phase 4 一致（读取相同 `styles.json` 预设）。

输出：`output/ep001/ep001.xml`（**交付文件**：含视频轨 + 配乐轨 + 字幕轨）

### 完成

最终输出目录结构：
```
output/ep001/
├── ep001.mp4           # 交付：最终成品（配乐 + 字幕）
├── ep001.srt           # 交付：字幕文件
├── ep001.xml           # 交付：Premiere XML（含字幕轨）
├── ep001_final.mp4     # music-matcher 中间产物（仅配乐）
├── ep001_final.xml     # music-matcher 中间产物
└── _tmp/               # 中间产物（不交付）
    ├── glossary.json   # Phase 1 字幕指南
    ├── asr.json        # Phase 2 ASR 转录
    ├── gemini-asr-*.json  # Gemini 原始输出
    └── music_*.mp3     # music-matcher 配乐素材
```

## 配置说明

ASR 专用参数（`assets/default.env`）：

| 参数 | 默认值 | 说明 |
|------|----|------|
| GEMINI_MODEL | gemini-3.1-pro-preview | Gemini 模型 |
| GEMINI_TEMPERATURE | 0.3 | ASR 精确度优先 |
| GEMINI_THINKING_LEVEL | low | 思考深度 |
| ASR_COMPRESS_RESOLUTION | 480 | ASR 压缩目标高度（侧重音频） |
| ASR_COMPRESS_FPS | 6 | ASR 压缩帧率（降低带宽） |
| ASR_AUDIO_BITRATE | 128k | 音频码率（保证语音质量） |
| BURN_CRF | 18 | 字幕烧录视频质量 |
| SUBTITLE_STYLE | auto | 字幕样式预设（auto=自动检测视频方向） |

字幕样式详见 `references/subtitle-styles.md` 和 `assets/styles.json`。

语言配置详见 `references/language-config.md` 和 `assets/languages.json`。

覆盖方式同 music-matcher：环境变量 > CWD/.env > default.env

## Key Rules

- 用中文简体与用户交流
- Phase 1-5 全部用 Bash 执行 Python 脚本
- Phase 4 **必须** `-c:v libx264`（字幕烧录需修改视频帧）
- Phase 2 的视频压缩侧重语音质量（128kbps 音频），不同于 music-matcher 的 64k
- 字幕指南直接给 Gemini，不做事后校正——减少步骤，让 ASR 一次出正确结果
- 每步完成后向用户汇报进度
