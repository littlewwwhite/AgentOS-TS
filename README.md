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
- **文件系统驱动的智能体配置** — 每个智能体的身份定义在 `agents/<name>/.claude/`（CLAUDE.md、settings.json、skills/*.md）中，SDK 通过 `settingSources: ["project"]` + 独立 `cwd` 原生加载。
- **分层权限模型** — 编排器以 `dontAsk` 模式运行，仅允许 TodoWrite + switch_to_agent；子智能体以 `bypassPermissions` 运行，配合 settings.json 的 deny-list 控制。
- **惰性智能体创建** — 智能体会话在首次分派时按需创建，而非启动时全部初始化。
- **E2B 沙箱隔离** — 智能体在云端沙箱中执行；宿主机通过 stdin/stdout JSON Lines 协议通信。

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
├── tools/
│   ├── agent-switch.ts      # switch_to_agent / return_to_main MCP 工具
│   ├── storage.ts           # JSON 与资产持久化
│   ├── image.ts             # AI 图片生成
│   ├── video.ts             # AI 视频生成
│   ├── audio.ts             # TTS、音效、配乐生成
│   ├── script-parser.ts     # 基于正则的剧本解析器
│   └── index.ts             # 工具服务器注册表
├── hooks/                   # SDK 钩子：Schema 验证 + 工具调用日志
├── schemas/                 # Zod Schema：剧本、设计、目录、资产
├── e2b-*.ts                 # E2B 沙箱客户端、CLI REPL、模板管理
├── session-history.ts       # 会话历史回放（用于恢复）
└── parallel/                # 并行执行配置

agents/
├── screenwriter/
│   ├── screenwriter.yaml          # 路由元数据 (name, description, mcpServers)
│   └── .claude/
│       ├── CLAUDE.md              # 智能体系统提示词
│       ├── settings.json          # 工具权限 (allow/deny)
│       └── skills/                # 领域技能 (script-writer.md, script-adapt.md)
├── art-director/                  # 同构 — image-create, asset-gen 技能
├── video-producer/                # video-create, video-review 技能
├── post-production/               # music-matcher 技能
└── skill-creator/                 # skill-creator 技能

web/                               # Next.js 16 + shadcn/ui 前端
├── app/                           # App Router：布局、页面、运行时状态
├── components/                    # 聊天界面、工作台（文件树、预览、活动日志）
├── hooks/                         # WebSocket 连接、文件树状态
└── lib/                           # 协议、事件归约、消息转换
```

## SDK 集成

系统以 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）作为运行时，核心集成点：

| 维度 | 编排器 (main) | 子智能体 (worker) |
|------|--------------|------------------|
| systemPrompt | `preset: "claude_code"` + 分派规则 | `preset: "claude_code"` + 工作区上下文 |
| tools | `preset: "claude_code"`（大部分被禁用） | `preset: "claude_code"`（完整工具集 + 技能发现） |
| permissionMode | `dontAsk` — 仅白名单工具可用 | `bypassPermissions` + settings.json deny-list |
| mcpServers | `switch`（仅 switch_to_agent） | 领域服务器 (storage, image 等) + `switch`（含 return_to_main） |
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

# 启动 HTTP/WebSocket 服务（供 Web 前端连接）
bun run server

# 启动 Web 前端
cd web && bun dev
```

### 运行测试

```bash
bun test
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
