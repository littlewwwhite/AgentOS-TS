# AgentOS-TS Lite

一个面向 `Claude Code` / `Codex` 直接使用的本地 skill pack 仓库。

这个 `lite` 分支不再维护以下能力：

- `bun start` 启动的 CLI
- TypeScript runtime / orchestrator / task queue
- Web 前端与 HTTP server
- sandbox / E2B / OpenViking 相关运行时壳层

保留内容只围绕一件事组织：让模型在当前仓库里直接发现并执行视频生产相关 skills。

## 保留结构

```text
.claude/skills/          # Skills 事实源
.agents/skills -> ../.claude/skills
AGENTS.md                # Codex 仓库约束
CLAUDE.md                # Claude Code 仓库级指令
docs/                    # 少量 skill 维护文档
data/                    # 可选输入素材
workspace/               # 可选项目工作目录
```

## 当前 Skills

- `wangwen` — 数据支撑型灵感调研（Stage 0）
- `script-adapt`
- `script-writer`
- `asset-gen`
- `storyboard`
- `video-gen`
- `video-editing`
- `music-matcher`
- `subtitle-maker`

这些 skills 的正文、引用资料和脚本都位于 [`.claude/skills`](/Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills)。

## 使用方式

### Claude Code

把当前仓库作为工作目录打开即可。仓库级指令见 [CLAUDE.md](/Users/dingzhijian/lingjing/AgentOS-TS/CLAUDE.md)。

### Codex

Codex 使用 [`.agents/skills`](/Users/dingzhijian/lingjing/AgentOS-TS/.agents/skills) 作为 repo-local skills 入口；该目录只是适配层，事实源仍是 [`.claude/skills`](/Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills)。

仓库约束见 [AGENTS.md](/Users/dingzhijian/lingjing/AgentOS-TS/AGENTS.md)。

## 环境说明

仓库不再要求安装 Bun / Node 运行主程序。

是否需要额外环境，取决于你实际调用的 skill：

- Python 类 skill 脚本优先使用 `uv` 或 `python3`
- 部分视频/字幕/配乐链路依赖外部 API key、FFmpeg、Gemini、AWB 等环境
- 具体前置条件以各 skill 自身的 `SKILL.md` 与 `scripts/` 说明为准

## 维护原则

- 新增或修改 skill，只改 [`.claude/skills`](/Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills)
- 不要恢复 `src/`、`tests/`、`web/`、`server` 这类应用壳层，除非仓库目标再次变回“可启动应用”
- 优先保持仓库是“技能内容仓库”而不是“运行时平台仓库”
