---
name: video-review
description: AI 视频内容评审工具，基于提示词符合度+五维度进行结构化审核，自动识别不合格视频并触发重新生成。当用户提到"评审视频"、"检查视频质量"、"视频合格吗"、"审核视频"、"视频不合格"时使用。不适用于视频生成任务（使用 video-create）。
argument-hint: <视频文件路径或脚本路径>
allowed-tools: Read, Bash
---

# 视频评审 (Video Review)

AI 驱动的视频内容评审工具。基于**提示词符合度**和**五个核心维度**进行结构化审核，
自动识别不合格视频，通过智能时间段分析决定重新生成策略（整段 L / 局部 C），
并调用 prompt_enhancement 优化提示词后自动重新生成。

支持 MP4/MOV 视频文件（Gemini API 分析）和 TXT/Markdown/JSON 脚本评审。

## 六级判定规则

| 级别 | 规则 | 阈值 | 可配置 |
|------|------|------|:------:|
| 0 | 提示词符合度过低 | `compliance_score < 0.2` | 否 |
| 1 | 人物一致性不足 | `character_consistency < 7` | 否 |
| 2 | 场景一致性不足 | `scene_consistency < 7` | 否 |
| 3 | 任意维度严重不达标 | `any dimension < 5` | 否 |
| 4 | 任意维度未达标 | `any dimension < min_dimension_score(7)` | 是 |
| 5 | 总分不足 | `total < min_total_score(40)` | 是 |

判定按级别从 0 到 5 依次执行，任一级别触发即判定不合格。

## 视频命名规则

```
L 级: ep##-sc##-l##-##.mp4           例: ep01-sc01-l02-01.mp4
C 级: ep##-sc##-l##-[Lver]-c##.mp4   例: ep01-sc01-l02-02-c01.mp4
C 多版本: ep##-sc##-l##-[Lver]-c##-##.mp4
```

- L 级：完整镜头（3-15秒），版本号从 01 递增
- C 级：单个时间切片（3-5秒），必须标明基于哪个 L 版本
- C 级首次生成不带版本号后缀，重新生成从 02 开始
- 所有版本保存在同一目录下

## 评审维度（满分 50 分）

| 维度 | key | 权重 | 满分 | 评审重点 |
|------|-----|------|------|----------|
| 剧情 | plot | 高 | 10 | 叙事连贯性、场景转换、故事逻辑、**空间位置连贯性** |
| 人物 | character | 高 | 10 | 角色一致性、外观匹配、动作逻辑 |
| 场景 | scene | 中 | 10 | 环境质量、光影质量、道具准确性、**人物空间位置** |
| 调度 | direction | 中 | 10 | 运镜、构图、剪辑节奏、技术质量 |
| 时长 | duration | 低 | 10 | 时长偏差、节奏把控 |

### 评分标准

- 9-10：优秀，超出预期
- 7-8：良好，符合要求
- 5-6：及格，基本达标
- 3-4：不及格，需要改进
- 1-2：差，严重问题

### 人物位置规范

**剧情维度 - 空间位置连贯性**：检查跨镜头人物位置是否连贯，是否存在瞬移。
- 轻微不连贯：narrative_coherence -1 分
- 明显瞬移：-2~3 分
- 严重位置混乱：-4 分以上

**场景维度 - 人物空间位置**：检查人物在场景中的位置合理性、与道具/背景的空间关系。
- 位置描述不清：environment_quality -1 分
- 空间关系错误：-2~3 分
- 严重位置不合理：-4 分以上

## 工作流程

```
drama-storyboard (生成提示词JSON)
  -> 视频生成平台 (可灵/Seedance)
  -> gemini_analyzer (视频内容分析，Gemini API)
  -> video-review (提示词符合度 + 5维度评审)
  -> 六级判定
     | 合格 -> 记录到 final_selection.json
     | 不合格 -> 时间段分析 (analyze_timeranges)
        -> 智能决策 (>=70% C 不合格 -> regenerate_l / 部分 -> regenerate_c)
        -> scripts/optimizer.py (提示词优化)
        -> 自动重新生成 -> 循环评审
```

## 核心模块

核心模块详情见 `${CLAUDE_SKILL_DIR}/references/modules.md`

## Bundled Scripts

Deterministic scripts in `${CLAUDE_SKILL_DIR}/scripts/`, via `Bash` tool 调用。

### Core Workflow
| Script | Purpose |
|--------|---------|
| `workflow.py` | One-click pipeline: analyze -> review -> timerange analysis -> optimize -> regenerate |
| `review.py` | Main review script, supports text scripts and video file analysis |
| `evaluator.py` | Six-level quality judgment and scoring, outputs `*_review.json` |
| `quality_control.py` | Quality control and regeneration tool, identifies failed videos and generates optimized prompts |

### Video Generation & Management
| Script | Purpose |
|--------|---------|
| `video_generator.py` | Automatically call video generation API to regenerate videos |
| `submit_video_create.py` | Submit video generation task (battle mode disabled by default) |
| `poll_video_create_task.py` | Poll video generation task status until completion or timeout |
| `regenerate_videos.py` | Auto-regenerate failed videos based on quality control report |
| `auto_regenerate.py` | Automated video regeneration tool, calls drama-storyboard skill to optimize prompts |
| `c_level_generator.py` | Generate C-level videos (single time slice 3-5s) |
| `final_selection.py` | Final selection management (set-l / add-shot / list / export) |

### Video Analysis
| Script | Purpose |
|--------|---------|
| `video_analyzer.py` | Video file analyzer, parses video path metadata and uses Gemini for content analysis |
| `gemini_analyzer.py` | Gemini API video analysis, outputs `*_analysis.json` |
| `gemini_adapter.py` | Two-tier strategy: cache -> built-in analyzer |

### Authentication & Configuration
| Script | Purpose |
|--------|---------|
| `auth.py` | Authentication module, obtains valid JWT via refreshToken interface |
| `login.py` | Initial login via phone verification code, select work team, save session to local config |
| `config.py` | Configuration management tool for review dimensions, weights, and platform standards |
| `config_manager.py` | Unified project path and configuration management |
| `dimensions_config.py` | Video review dimension configuration (5-dimension system) |

### Batch Processing
| Script | Purpose |
|--------|---------|
| `batch_workflow.py` | Batch process video folders, auto analyze, review, and optimize |
| `batch_review.py` | Batch review tool, supports processing multiple video script files |
| `batch_analyze.sh` | Shell script for batch video analysis |

### Utilities
| Script | Purpose |
|--------|---------|
| `optimizer.py` | Optimize video generation prompts based on review results |
| `upload_to_cos.py` | Upload local files to Tencent Cloud COS (public-read, returns direct access URL) |

## 关键约束

- 提示词符合度是最关键标准，< 20% 一票否决
- 硬性规则（任意维度 < 5 分）不可修改
- 单个镜头必须基于最新通过判定的 L 版本
- 评审结果文件与视频文件存储在同一目录
- 评分要客观公正、具体详细，改进建议要可操作

## 参考文档

| 文件 | 内容 |
|------|------|
| `${CLAUDE_SKILL_DIR}/references/quality-rules.md` | 完整判定规则、命名规范、工作流细节 |
| `${CLAUDE_SKILL_DIR}/references/modules.md` | 各模块详细说明、评分算法、JSON 格式支持 |
| `${CLAUDE_SKILL_DIR}/references/configuration.md` | 配置参数、输入输出格式、项目结构、JSON Schema |
| `${CLAUDE_SKILL_DIR}/references/prompt-enhancement.md` | 提示词优化策略、XML 规则说明、集成方式 |
| `${CLAUDE_SKILL_DIR}/references/auto-regeneration.md` | 自动重新生成使用指南 |
