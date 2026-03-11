# AgentOS-TS

基于 [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk) 的多智能体编排系统，面向 AI 驱动的视频制作流水线。

中央编排器通过信号驱动的 MCP 工具将用户意图分派给专业子智能体。每个智能体在独立工作区中运行，拥有自己的提示词、权限和领域技能——全部以文件声明，而非硬编码。

## 架构概览

```
用户 ──► 编排器 (main)
              │  通过 switch_to_agent MCP 工具分派
              ├──► screenwriter    ← 编剧：剧本创作与改编
              ├──► art-director    ← 美术：图片生成与视觉设计
              ├──► video-producer  ← 视频：图/文生视频与质量审核
              ├──► post-production ← 后期：配乐、音效、语义选曲
              └──► skill-creator   ← 技能编写指南
```

### 核心设计决策

- **信号驱动分派** — 自定义 `switch_to_agent` / `return_to_main` MCP 工具写入共享的 `SwitchSignal`；编排器在每次 query 结束后轮询信号并执行上下文切换。这实现了 SDK 原生 Agent 工具不支持的**粘性多轮会话**。
- **文件系统驱动的智能体配置** — 每个智能体的身份定义在 `agents/<name>/.claude/`（CLAUDE.md、settings.json、skills/）中，SDK 通过 `settingSources: ["project"]` + 独立 `cwd` 原生加载。
- **分层权限模型** — 编排器以 `dontAsk` 模式运行，仅允许 TodoWrite + switch_to_agent；子智能体以 `bypassPermissions` 运行，配合 settings.json 的 deny-list 控制。
- **惰性智能体创建** — 智能体会话在首次分派时按需创建，而非启动时全部初始化。
- **E2B 沙箱隔离** — 智能体在云端沙箱中执行；宿主机通过 stdin/stdout JSON Lines 协议通信。
- **本地运行时** — `runtime: "local"` 模式下智能体直接在主机侧运行，无需 E2B 沙箱，文件 I/O 直接操作本地文件系统。
- **异步任务队列** — 长耗时任务（图片/视频生成）通过 MCP tool 提交到独立队列，SQLite 持久化，支持重试和并发限制。
- **项目引擎** — Project / Phase / Checkpoint DAG 调度器，支持审阅-打回-修改循环和项目记忆注入。

## 项目结构

```
src/
├── sandbox-orchestrator.ts  # 核心：信号驱动分派循环、会话管理
├── sandbox.ts               # CLI 入口 (bun start)
├── server.ts                # HTTP + WebSocket 桥接（供 Web 前端）
├── options.ts               # 编排器 SDK 选项构建
├── agent-options.ts         # 子智能体 SDK 选项工厂
├── session-specs.ts         # 系统提示词与权限规格（main/worker）
├── agent-manifest.ts        # 智能体 YAML + 技能发现
├── protocol.ts              # 沙箱 ↔ 宿主 JSON Lines 协议
├── auth.ts                  # Session 签发与验证
├── fixed-model.ts           # 固定模型常量
├── loader.ts                # 智能体配置加载
├── session-store.ts         # Session 持久化
├── session-history.ts       # 会话历史回放（用于恢复）
├── e2b-client.ts            # E2B 沙箱客户端
├── tools/
│   ├── agent-switch.ts      # switch_to_agent / return_to_main MCP 工具
│   ├── image.ts             # AI 图片生成
│   ├── video.ts             # AI 视频生成
│   ├── audio.ts             # TTS、音效、配乐生成
│   ├── script-parser.ts     # 基于正则的剧本解析器
│   ├── source.ts            # 原始素材准备与结构检测
│   ├── workspace.ts         # 工作区检查工具
│   └── index.ts             # 工具服务器注册表
├── local-orchestrator.ts    # 本地模式编排器（无 E2B 依赖）
├── local-runtime.ts         # 主机侧 SDK query() 封装
├── local-entry.ts           # 本地模式 CLI 入口
├── task-queue/              # 异步任务队列（SQLite 持久化 + API 轮询）
│   ├── store.ts             # 任务存储与状态机
│   ├── queue.ts             # 核心队列引擎（提交/轮询/重试）
│   ├── executor.ts          # API 调用执行器
│   ├── registry.ts          # YAML API 配置加载
│   └── tools.ts             # MCP tool 定义
├── engine/                  # 项目引擎（DAG 调度 + 审阅循环）
│   ├── schema.ts            # Project / Phase / Checkpoint 类型
│   ├── store.ts             # SQLite 持久化
│   ├── scheduler.ts         # DAG 依赖推进
│   ├── checkpoint.ts        # 审阅 MCP tool
│   └── memory.ts            # 项目记忆
├── hooks/                   # SDK 钩子：Schema 验证 + 工具调用日志
├── schemas/                 # Zod Schema：剧本、设计、目录、资产、时间线
├── parallel/                # 并行执行配置与执行器
└── repl-*.ts                # REPL 渲染与交互（Markdown、Spinner）

apis/                              # API 配置注册表（YAML 声明式）
├── animeworkbench-image.yaml      # 图片生成 API 配置
└── animeworkbench-video.yaml      # 视频生成 API 配置

agents/
├── screenwriter/
│   ├── screenwriter.yaml          # 路由元数据 (name, description, mcpServers)
│   └── .claude/
│       ├── CLAUDE.md              # 智能体系统提示词
│       ├── settings.json          # 工具权限 (allow/deny)
│       └── skills/                # 领域技能 (script-writer/, script-adapt/)
├── art-director/                  # 同构 — image-create, asset-gen, image-edit 技能
├── video-producer/                # video-create, video-review 技能
├── post-production/               # music-matcher 技能
└── skill-creator/                 # skill-creator 技能

skills/                            # 全局技能注册目录（与 agents 技能同步）

web/                               # Next.js + shadcn/ui 前端
├── app/                           # App Router：布局、页面、API 路由
│   ├── api/                       # chat/, morph-chat/, sandbox/ 路由
│   └── actions/                   # Server Actions
├── components/                    # UI 组件
│   ├── agentos-*.tsx              # 核心组件（工作台、文件浏览、状态面板）
│   ├── chat*.tsx                  # 聊天界面
│   ├── fragment-*.tsx             # 代码/预览/解释器片段
│   └── ui/                        # shadcn/ui 基础组件
├── hooks/                         # AgentOS Bridge、文件树状态
└── lib/                           # AgentOS 协议、聊天逻辑、工具函数

workspace/                         # 运行时工作区（按项目隔离）
```

## 智能体与技能

| 智能体 | MCP 服务 | 领域技能 |
|--------|---------|---------|
| screenwriter | source, script | script-adapt, script-writer |
| art-director | image | asset-gen, image-create, image-edit, kling-video-prompt |
| video-producer | video | video-create, video-review |
| post-production | audio | music-matcher |
| skill-creator | — | skill-creator |

## SDK 集成

系统以 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）作为运行时，核心集成点：

| 维度 | 编排器 (main) | 子智能体 (worker) |
|------|--------------|------------------|
| systemPrompt | `preset: "claude_code"` + 分派规则 | `preset: "claude_code"` + 工作区上下文 |
| tools | `preset: "claude_code"`（大部分被禁用） | `preset: "claude_code"`（完整工具集 + 技能发现） |
| permissionMode | `dontAsk` — 仅白名单工具可用 | `bypassPermissions` + settings.json deny-list |
| mcpServers | `switch`（仅 switch_to_agent） | 领域服务器 (image, video 等) + `switch`（含 return_to_main） |
| maxTurns | 30（仅做分派） | 200（安全上限） |
| settingSources | `["project"]` → 项目根 `.claude/` | `["project"]` → `agents/<name>/.claude/` |
| 会话 | 持久化，可恢复 | 持久化，惰性创建，可恢复 |

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) ≥ 1.0
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)（需要 Anthropic API Key）
- Node.js ≥ 20

### 安装与运行

```bash
# 安装依赖
bun install

# 启动 CLI REPL（本地沙箱模式）
bun start

# 启动本地模式 CLI（无 E2B，直接主机侧运行）
bun src/local-entry.ts workspace/my-project --agents agents/

# 启动 E2B 云端 REPL
bun run start:e2b

# 启动 HTTP/WebSocket 服务（供 Web 前端连接，默认 local 模式）
bun run server

# 启动 Web 前端
cd web && bun dev
```

### 常用命令

```bash
bun test              # 运行测试
bun run lint          # Biome 代码检查
bun run build         # TypeScript 编译
bun run build:e2b     # 构建 E2B 沙箱镜像
```

## 工作流程

1. 用户发送消息 → 编排器 LLM 判断应由哪个智能体处理
2. LLM 调用 `switch_to_agent(agent, task)` → 写入 `SwitchSignal.switchRequest`
3. 编排器检测到信号，创建/恢复目标智能体会话，推送任务
4. 智能体在独立上下文中工作，拥有完整工具访问和领域技能
5. 完成后，智能体调用 `return_to_main(summary)` → 编排器恢复主控
6. 会话 ID 持久化至 `.sessions.json`，支持跨重启恢复

## 许可证

私有项目，非开源。
