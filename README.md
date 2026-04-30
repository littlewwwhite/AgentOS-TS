# AgentOS-TS

AgentOS-TS 是面向 AI 视频生产的 skill pack。它的核心价值不是启动一个完整平台，而是把编剧、视觉资产、分镜、视频生成、剪辑、配乐和字幕能力整理成 Claude Code / Codex 可以直接执行的工作流。

仓库同时保留了一个轻量交互控制台 `apps/console/`，用于项目上传、状态浏览、对话推进和线上体验。控制台是可选入口，skills 仍是事实源。

## 适用场景

- 把小说、故事大纲或已有剧本推进为结构化短剧剧本
- 从 `script.json` 继续生成角色、场景、道具等视觉资产
- 将剧本和资产转成分镜、镜头脚本和视频生成任务
- 对生成的视频做剪辑、配乐、字幕和交付整理
- 通过控制台给非工程成员提供可体验的项目工作区

## 生产流程

```text
Novel / Story / Script
  -> SCRIPT
  -> VISUAL
  -> STORYBOARD
  -> VIDEO
  -> EDITING
  -> MUSIC
  -> SUBTITLE
  -> Final
```

| Stage | Skill | 主要产物 |
| --- | --- | --- |
| SCRIPT | `script-adapt`, `script-writer` | `workspace/{name}/output/script.json` |
| VISUAL | `asset-gen` | `output/actors`, `output/locations`, `output/props` |
| STORYBOARD | `storyboard` | approved storyboard JSON |
| VIDEO | `video-gen` | runtime storyboard, delivery JSON, videos |
| EDITING | `video-editing` | selected / assembled videos |
| MUSIC | `music-matcher` | scored videos with music |
| SUBTITLE | `subtitle-maker` | final videos and subtitle tracks |

`pipeline-state.json` 是项目状态的唯一机器可读索引。继续执行、断点恢复和控制台状态展示都应先读取它。

## 快速使用

把素材放入项目工作区：

```text
workspace/{name}/
├── source.txt
├── pipeline-state.json
├── draft/
└── output/
```

然后在 Claude Code / Codex 中直接描述目标，例如：

- `把 workspace/c1/source.txt 改编成短剧结构化剧本`
- `继续 c1 的 SCRIPT 阶段，生成 output/script.json`
- `根据 script.json 生成角色、场景、道具资产`
- `把第 1 集 approved storyboard 生成视频`

长篇小说保骨架直转优先使用 `script-adapt`；原创构思或短篇扩写优先使用 `script-writer`。

## 控制台

本地调试控制台位于 `apps/console/`：

```bash
cd apps/console
bun install
bun run dev
```

控制台提供：

- 项目创建与源文件上传
- workspace 文件浏览
- pipeline 状态查看
- 对话式执行入口
- `dist` 静态资源托管和 WebSocket 后端

线上体验当前部署在 `yc-hk` 服务器，服务端口为 `3001`。控制台依赖 Claude Agent SDK；当模型提供方不支持完整 SDK 工具链时，服务端会使用受限的 Messages API 工具适配层读取和写入当前项目 workspace。

## 仓库结构

```text
.
├── .claude/skills/          # skills 事实源
├── .agents/skills -> .claude/skills
├── apps/console/            # 可选交互控制台
├── aos-cli/                 # 模型能力边界与 provider 适配
├── scripts/                 # pipeline / state / deployment helpers
├── docs/                    # 架构与计划文档
└── workspace/               # 本地项目工作区，不应作为代码发布内容
```

维护约定：

- 修改 skill 时只改 `.claude/skills/<skill-name>/`
- `.agents/skills/` 只是 Codex 发现 skill 的映射层
- 新的模型调用应走 `aos-cli model`，不要在 skill 脚本里新增直连 provider SDK
- `workspace/`, `data/`, `output/`, `.env` 是运行态数据，不纳入部署同步

## 测试与构建

控制台：

```bash
cd apps/console
bun test
bun run build
```

Python / aos-cli：

```bash
cd aos-cli
uv run pytest
```

只改某个 skill 脚本时，优先运行该 skill 目录下的就近测试，再按影响面补跑 `aos-cli` 或 console 测试。

## 部署

仓库已迁移到 GitHub org：

```text
https://github.com/JiuZhou-ailab/AgentOS-TS
```

CI/CD 工作流位于 `.github/workflows/deploy-yc-hk.yml`。push 到 `master` 或手动触发 workflow 时：

1. GitHub Actions 通过 `YC_HK_SSH_KEY` 登录 `yc-hk`
2. 服务器维护干净 clone：`/home/zjding/agentos-console-repo`
3. 服务器执行 `git fetch` + `git reset --hard`
4. 在服务器上运行 console 测试与构建
5. 同步到运行目录 `/home/zjding/agentos-console-deploy`
6. 保留 `.env`, `workspace/`, `data/`, `output/`
7. 重启 `apps/console/server.ts`

如果仓库改为 private，服务器端 clone 需要额外配置 deploy key 或 GitHub token。

## 一句话

AgentOS-TS 是公司级 AI 视频生产能力仓库：skills 是核心，console 是体验入口，`pipeline-state.json` 是跨阶段协作契约。
