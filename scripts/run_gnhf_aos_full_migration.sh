#!/usr/bin/env bash
# input: AgentOS-TS git checkout with gnhf and Codex CLI available
# output: a long-running gnhf run for full aos-cli model migration
# pos: operator entrypoint for the aos-cli migration automation objective

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && git rev-parse --show-toplevel)"

AGENT="${GNHF_AGENT:-codex}"
MAX_ITERATIONS="${GNHF_MAX_ITERATIONS:-30}"
MAX_TOKENS="${GNHF_MAX_TOKENS:-100000000}"
PREVENT_SLEEP="${GNHF_PREVENT_SLEEP:-on}"
CREATE_WORKTREE="${GNHF_CREATE_WORKTREE:-1}"
RUN_ID="${GNHF_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
WORKTREE_ROOT="${GNHF_WORKTREE_ROOT:-$REPO_ROOT/.worktrees}"
RUN_WORKTREE="${GNHF_RUN_WORKTREE:-$WORKTREE_ROOT/gnhf-aos-full-migration-$RUN_ID}"
RUN_BRANCH="${GNHF_RUN_BRANCH:-aos-full-migration-base-$RUN_ID}"

STOP_WHEN="${GNHF_STOP_WHEN:-all requested work is implemented, committed, and verified: aos-cli supports every model task type currently used by skills, useless content is cleaned, episode 1-3 E2E artifacts are produced, video duration evidence proves outputs are not all 5 seconds, and the final report lists changed files plus verification commands}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 127
  fi
}

require_cmd git
require_cmd gnhf

if [[ "$CREATE_WORKTREE" == "1" ]]; then
  if [[ "$RUN_BRANCH" == gnhf/* ]]; then
    echo "GNHF_RUN_BRANCH must not start with gnhf/." >&2
    echo "gnhf treats gnhf/* branches as existing runs and will try to resume a missing .gnhf/runs directory." >&2
    exit 2
  fi
  mkdir -p "$WORKTREE_ROOT"
  echo "Creating dedicated worktree:"
  echo "  path:   $RUN_WORKTREE"
  echo "  branch: $RUN_BRANCH"
  git -C "$REPO_ROOT" worktree add -b "$RUN_BRANCH" "$RUN_WORKTREE" HEAD
  RUN_DIR="$RUN_WORKTREE"
else
  RUN_DIR="$REPO_ROOT"
  if [[ -n "$(git -C "$RUN_DIR" status --porcelain)" && "${ALLOW_DIRTY:-0}" != "1" ]]; then
    echo "Working tree is dirty. Refusing to run gnhf in-place because it may edit or roll back files." >&2
    echo "Use the default GNHF_CREATE_WORKTREE=1, clean/stash first, or rerun with ALLOW_DIRTY=1 if you accept the risk." >&2
    git -C "$RUN_DIR" status --short >&2
    exit 2
  fi
fi

PROMPT_FILE="$(mktemp -t aos-full-migration.XXXXXX.md)"
cleanup() {
  rm -f "$PROMPT_FILE"
}
trap cleanup EXIT

cat >"$PROMPT_FILE" <<'PROMPT'
你在 /Users/dingzhijian/lingjing/AgentOS-TS 中工作。目标不是“做一点迁移”，而是把当前 skill pack 中所有实际使用的模型任务类型完整迁移到 aos-cli/aos model 边界，并用测试和 E2E 证据证明结果可用。

硬性原则：
- 用中文向用户汇报；代码、注释、标识符、提交信息使用英文。
- 遵守仓库 AGENTS.md：skill 事实源是 .claude/skills/，不要直接改 .agents/skills/。
- 使用 uv / python3 维持现有脚本风格；不要引入新依赖，除非已有依赖无法完成目标并在报告中说明原因。
- TDD 优先：先写或补齐能暴露边界的测试，再实现；每个阶段必须有可重复验证命令。
- 不允许把未支持的多模态/音频/视频任务强行塞进通用 generate capability 来伪装完成。应扩展 aos-cli model 协议，使领域语义成为一等 capability。
- 不允许进行到一半后把“部分完成”当作完成。只有最终验收条件全部满足，才能停止。
- 若发现之前计划文档勾选状态与真实代码不一致，以真实代码和测试为准。
- 若遇到失败，继续定位、修复、重测；不要只汇报失败。

当前基线注意：
- master 可能已经包含一个 follow-up 任务，把多模态/ASR 直连路径登记为 Deferred Paths Registry，并通过 guardrail 要求这些路径携带 "Model boundary note: deferred multimodal" 标记。
- 这只能视为临时事实基线，不是最终架构目标。本任务的目标是实现 aos-cli model 对这些任务类型的一等支持，并在迁移完成后逐项从 Deferred Paths Registry 中退休对应条目。
- 不要新增或强化“允许继续直连 provider”的守卫作为终态。可以保留临时 guardrail 防止未登记直连扩散，但最终报告必须说明哪些 deferred 条目已经删除、哪些仍因真实 blocker 暂留。
- 如果存在 docs/superpowers/plans/2026-04-27-skills-aos-cli-migration-followup.md，把它当作已完成的历史临时边界计划；不要按它继续扩大 deferred 范围。

背景目标：
1. 清理无用内容。
2. 全面迁移 aos-cli/aos model，支持当前 skills 中原本包含的所有任务类型。
3. 做 1-3 集 E2E 测试。视频生成必须遵循 skill 里的调度逻辑：场内串行、场间并行。修复“生成视频全是 5s”的 bug，视频时长必须正确符合分镜/任务时长，最终要产出逻辑连贯的 3 集视频。
4. 完成后继续做架构优化和冗余内容清理。
5. 严格测试每个阶段输出，确保最终输出符合要求。

阶段 0：建立事实基线
- 检查 git status，识别当前分支和已有改动；不要覆盖用户改动。
- 阅读 README.md、scripts/README.md、docs/superpowers/plans/2026-04-26-skills-aos-cli-model-migration.md、aos-cli 相关代码、.claude/skills/*/SKILL.md。
- 全仓扫描直接 provider SDK/env/config 使用点：
  - google.genai / genai / Gemini / GEMINI_API_KEY
  - ARK_API_KEY / VOLC / Seedance / video provider
  - OpenAI / Anthropic / Claude direct SDK
  - model.generate_content / files.upload / audio transcription / video analysis
- 输出一份真实迁移矩阵：已迁移、待迁移、无需迁移、可删除残留。这个矩阵要基于文件路径和调用证据。

阶段 1：先补 aos-cli model 协议与测试
目标 capability 至少覆盖当前 skills 原本真实用到的任务类型：
- text/json generation：已有则收敛和补测。
- image generation：已有则收敛和补测。
- video generation submit/poll/result：已有则收敛和补测。
- vision.review：图片 + 文本输入，输出结构化审图 JSON。
- video.analyze：视频或片段引用 + 提示词，输出结构化分析 JSON。
- audio.transcribe：音频/视频输入，输出带时间戳的 transcript/segments/subtitle-ready data。

实现要求：
- 在 aos-cli model 协议规范、registry/service/preflight/fake mode 中增加 capability。
- fake mode 使用 AGENTOS_MODEL_FAKE=1，可被 skill 端测试稳定调用。
- 错误分类要清楚：缺配置、provider 不支持、输入文件不存在、响应 schema 不合法。
- 测试要覆盖成功路径、fake mode、缺 capability、缺输入文件、schema 校验。

阶段 2：迁移 skill 端所有直接模型调用
需要重点检查并迁移：
- .claude/skills/asset-gen/scripts/review_scene.py
- .claude/skills/asset-gen/scripts/review_char.py
- .claude/skills/asset-gen/scripts/review_props.py
- .claude/skills/video-editing/scripts/phase1_analyze.py
- .claude/skills/video-editing/scripts/phase2_assemble.py
- .claude/skills/music-matcher/scripts/analyze_video.py
- .claude/skills/music-matcher/scripts/batch_analyze.py
- .claude/skills/video-gen/scripts/analyzer.py
- .claude/skills/video-gen/scripts/frame_extractor.py
- .claude/skills/subtitle-maker/scripts/phase0_check.py
- .claude/skills/subtitle-maker/scripts/phase2_transcribe.py
- 以及阶段 0 扫描出的任何其它直连 provider 调用。

迁移要求：
- 复用现有 shared aos-cli model runner/helper，不要在每个脚本里复制 subprocess/JSON envelope 逻辑。
- skill 脚本保持原有 CLI 输入输出契约，除非原契约本身错误；任何契约变化必须有迁移说明和测试。
- 清理历史 env 检查文案，例如 script-writer/SKILL.md 中不真实的 GEMINI_API_KEY 检查。
- 不需要迁移的脚本要在报告里说明原因，例如纯结构化处理、MCP、或 Claude/Codex 主会话子 agent 工作。

阶段 3：修复 video-gen 时长与调度
必须验证并修复：
- 场内串行：同一 scene 内 shots/tasks 必须按顺序生成或至少按依赖顺序提交，不得破坏剧情连续性。
- 场间并行：不同 scenes 可以并行，且并发边界与现有 skill 逻辑一致。
- 时长正确：不得所有视频都退化为 5s。每个视频 task 应从 approved storyboard/runtime storyboard 中读取目标 duration，并传递到 aos-cli/video provider；若 provider 返回时长不符，必须在结果校验中标记或重试/失败。
- 结果 manifest 必须包含 episode、scene、shot、requested duration、actual duration、provider task id、output path。

测试要求：
- 单元测试覆盖 duration 解析、duration 传递、manifest 写入。
- 调度测试覆盖同场串行、跨场并行。优先用 fake provider 和时间戳/事件日志证明顺序。
- 回归测试覆盖“所有输出都是 5s”的 bug。

阶段 4：1-3 集 E2E
目标是最终看到逻辑连贯的 3 集视频，不是只跑 mock 单测。
- 先用 fake mode 跑完整流水线，验证结构、状态文件、manifest、duration、调度顺序。
- 再按仓库现有真实 provider 配置能力尝试真实生成；如果凭证或外部服务不可用，必须明确记录 blocker，并保留 fake E2E 证据和真实调用前置检查证据。
- E2E 范围至少包含 episode 1、2、3；每集产物路径必须明确。
- 最终报告必须列出每集：
  - storyboard/runtime input path
  - video task manifest path
  - generated clip paths
  - merged/final video path（若 pipeline 支持合成）
  - requested vs actual duration summary
  - 连贯性检查结论

阶段 5：清理和架构优化
- 删除或更新已无效的 provider env 文案、重复 config_loader、过时 docs、无用 compatibility wrapper。
- 保留必要的 provider adapter 和 preflight；不要为了“清理”删除还被 deferred capability 或真实 provider 使用的代码。
- 更新 README / skill docs / plan docs，使当前架构边界清楚：skills -> aos-cli model -> provider。
- 保持 diff 小而可审查；每个删除都要能说明“不再被引用”。

最低验证命令要求：
- 至少运行 aos-cli model 相关单元测试。
- 至少运行每个被迁移 skill 的 boundary/fake tests。
- 至少运行 video-gen duration/scheduling tests。
- 至少运行 1-3 episode fake E2E。
- 若真实 E2E 可用，运行真实 E2E；若不可用，运行 preflight 并记录缺失项。
- 结束前运行 repo 里合理的 lint/typecheck/test 集合；若部分历史测试与本任务无关且失败，给出文件级证据和隔离说明。

提交要求：
- 使用 git 提交最终结果，commit message 遵守 AGENTS.md Lore Commit Protocol。
- 不要提交无关用户改动。
- 如果任务太大需要多个提交，按可审查边界拆分：protocol/tests、skill migration、video duration/scheduler、docs cleanup、E2E evidence。

最终报告必须包含：
- 当前分支、commit hash、是否有未提交改动。
- 变更文件清单。
- 删除/清理内容清单。
- capability 覆盖矩阵：text/json、image、video submit/poll、vision.review、video.analyze、audio.transcribe。
- skill 迁移矩阵：每个 skill 原调用点、迁移后调用点、测试命令。
- 1-3 集 E2E 产物路径和 duration 证据。
- 运行过的测试命令及通过/失败摘要。
- 未解决风险和真实 blocker，不允许隐瞒。
PROMPT

cd "$RUN_DIR"

GNHF_ARGS=(
  --agent "$AGENT"
  --max-iterations "$MAX_ITERATIONS"
  --max-tokens "$MAX_TOKENS"
  --prevent-sleep "$PREVENT_SLEEP"
  --stop-when "$STOP_WHEN"
)

echo
echo "Starting gnhf:"
echo "  run dir:        $RUN_DIR"
echo "  agent:          $AGENT"
echo "  max iterations: $MAX_ITERATIONS"
echo "  max tokens:     $MAX_TOKENS"
echo "  prevent sleep:  $PREVENT_SLEEP"
echo "  prompt file:    $PROMPT_FILE"
echo

PROMPT_TEXT="$(cat "$PROMPT_FILE")"
gnhf "${GNHF_ARGS[@]}" "$PROMPT_TEXT"
