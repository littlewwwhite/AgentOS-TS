---
name: music-matcher
description: 基于向量语义匹配的智能视频配乐工具。输入视频文件，自动完成 Gemini 视频分析、向量匹配选曲、FFmpeg 合成输出。
---

# Music Matcher — 智能视频配乐

基于向量语义匹配，自动为视频选曲并合成配乐。核心流程：Gemini 分析视频画面 → 向量化 → 余弦相似度匹配音乐库 → FFmpeg 合成输出。

## 项目路径

```
PROJECT_DIR = ${CLAUDE_SKILL_DIR}
```

## 前置条件检查

每次运行前，按顺序确认：

1. **Python 环境**：项目目录下有 `requirements.txt`，确认依赖已安装
2. **`.env` 文件**：确认 `$PROJECT_DIR/.env` 存在且包含：
   - `DASHSCOPE_API_KEY` — 阿里云 DashScope（向量化）
   - `GEMINI_API_KEY` — Google Gemini（视频分析）
   - `MUSIC_LIBRARY_CSV` — 音乐库 CSV 文件路径
3. **外部工具**：`ffmpeg` 和 `ffprobe` 可用（`which ffmpeg && which ffprobe`）
4. **输入视频**：用户提供的视频文件存在且为有效视频格式

如果任何条件不满足，告知用户具体缺什么，不要继续执行。

## Workflow

### 能力 A：一键配乐（主流程）

用户提供视频路径，自动跑完 4 步管线。

**所有脚本均在 `$PROJECT_DIR` 目录下执行。**

#### Step 1：向量化音乐库

检查 `$PROJECT_DIR/data/music_vectors.pkl` 是否存在：
- **存在** → 跳过，告知用户"音乐库向量缓存已存在，跳过此步"
- **不存在** → 执行：

```bash
cd ${CLAUDE_SKILL_DIR} && python embed_library.py
```

预期输出：生成 `data/music_vectors.pkl`，终端显示处理了多少条音乐记录。

#### Step 2：Gemini 分析视频

```bash
cd ${CLAUDE_SKILL_DIR} && python analyze_video.py "<视频绝对路径>"
```

这一步耗时较长（视频上传 + Gemini 分析），预计 1-3 分钟。

预期输出：
- `data/target_segments.pkl` — 视频分段向量数据
- `output/gemini-v2t-<视频名>-<时间戳>.json` — Gemini 原始分析结果

**完成后**：读取 Gemini 分析的 JSON 文件，向用户简要展示分段结果（每段的时间范围和情绪关键词），让用户确认分析是否合理。

#### Step 3：向量匹配选曲

```bash
cd ${CLAUDE_SKILL_DIR} && python match.py --top 5 --output output/results.json
```

预期输出：`output/results.json`

**完成后**：读取 results.json，向用户展示每个片段的推荐曲目（selected=true 的那首），格式：

```
片段 1 (00:00-00:46) 情绪：紧张、压抑
  → 推荐：Crisis_Point.wav（相似度 0.83）

片段 2 (00:46-01:21) 情绪：震惊、神圣
  → 推荐：Divine_Arrival.wav（相似度 0.81）
```

询问用户：**"选曲结果满意吗？可以直接合成，也可以换曲。"**

#### Step 4：FFmpeg 合成

```bash
cd ${CLAUDE_SKILL_DIR} && python compose.py "<视频绝对路径>" output/results.json
```

预期输出：
- `output/compose-<视频名>-<时间戳>.mp4` — 配乐视频
- `output/compose-<视频名>-<时间戳>.txt` — 配乐清单

**完成后**：告知用户输出文件的完整路径。

---

### 能力 B：重建音乐库向量

当用户说"刷新音乐库""重建向量""音乐库更新了"时触发。

```bash
cd ${CLAUDE_SKILL_DIR} && rm -f data/music_vectors.pkl && python embed_library.py
```

删除旧缓存后重新向量化。

---

### 能力 C：人工干预匹配

当用户看完 Step 3 的结果后想换曲，支持两种方式：

1. **指定 rank**：用户说"片段 2 用第 3 名的曲子"
   ```bash
   cd ${CLAUDE_SKILL_DIR} && python compose.py "<视频路径>" output/results.json --rank 3
   ```
   注意：`--rank` 是全局参数，会影响所有片段。

2. **手动编辑 results.json**：用户想对不同片段选不同曲目时，帮用户修改 results.json 中对应片段的 `selected` 标记（将想要的曲目设为 `true`，其他设为 `false`），然后重新运行 compose.py（不带 `--rank`）。

---

## 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| Gemini API 超时/失败 | 提示用户检查 GEMINI_API_KEY，建议重试 |
| DashScope API 失败 | 提示检查 DASHSCOPE_API_KEY |
| 音乐库 CSV 路径无效 | 提示检查 .env 中 MUSIC_LIBRARY_CSV 路径 |
| ffmpeg 不存在 | 提示 `brew install ffmpeg` |
| 视频文件过大上传失败 | 检查 .env 中 COMPRESS_BEFORE_UPLOAD 是否为 true |
| match.py 无候选曲目 | 可能音乐库太小或向量空间偏差大，建议检查 Gemini 分析结果 |

## Key Rules

- 用中文简体与用户交流
- 所有脚本必须在 `$PROJECT_DIR` 目录下执行（脚本内部用相对路径读写 data/ 和 output/）
- Step 2 完成后必须展示 Gemini 分析结果，让用户确认
- Step 3 完成后必须展示选曲结果，给用户换曲的机会
- 不要在 Step 3 和 Step 4 之间自动跳过用户确认
- Step 1 有缓存机制，不要每次都重跑
- 视频路径必须用绝对路径传给脚本
