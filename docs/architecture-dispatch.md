# AgentOS-TS Dispatch Architecture

Agent 调度与任务执行的完整链路。基于文件系统驱动的 agent 配置架构。

## 1. 三层结构总览

```
┌────────────────────────────────────────────────────┐
│  REPL 层                                            │
│  orchestrator.ts (local) / e2b-repl.ts (sandbox)   │
│  职责: 输入解析、slash command、自然语言拦截        │
└──────────────┬──────────────┬──────────────────────┘
               │              │
        默认模式        Direct Mode (/enter)
               │              │
               ▼              ▼
┌──────────────────┐  ┌─────────────────────┐
│  Orchestrator     │  │  Sub-Agent Session   │
│  (main LLM)       │  │  (screenwriter etc.) │
│  cwd=workspace/   │  │  cwd=agents/<name>/  │
│  有 Agent tool     │  │  无 Agent tool        │
└────────┬─────────┘  └──────────┬──────────┘
         │ Agent tool call                │
         ▼                                ▼
┌──────────────────┐            ┌─────────────────┐
│  Sub-Agent LLM    │            │  MCP Tool 调用   │
│  cwd=agents/<n>/  │            │  storage/image/  │
│  settingSources:  │            │  video/audio/    │
│    ["project"]    │            │  script          │
│  → SDK 原生加载    │            └─────────────────┘
│    .claude/ 配置   │
└──────────────────┘
```

## 2. Skills — 文件系统原生加载

Skills 是 `.claude/skills/*.md` 文件，放在每个 agent 的目录下，SDK 通过 `settingSources: ["project"]` 原生加载，无需手动 prompt 拼接。

### 2.1 目录结构

```
agents/<name>/
  ├── .claude/
  │   ├── CLAUDE.md          ← 角色身份 + 领域知识
  │   ├── settings.json      ← 权限 (allowedTools / disallowedTools)
  │   └── skills/*.md        ← 领域技能文档
  └── <name>.yaml            ← 路由元数据 (name, description, skills tags)
```

SDK 启动 sub-agent 时，以 `agents/<name>/` 为 `cwd`，设置 `settingSources: ["project"]`，SDK 自动读取 `.claude/` 下的所有配置：

- **CLAUDE.md** — 等效于旧架构中 `buildAgents()` 拼接的 system prompt（角色定义 + 工作流 + 约束）
- **settings.json** — 等效于旧 YAML 的 `allowed-tools` / `disallowed-tools`（SDK 强制执行）
- **skills/*.md** — 等效于旧的 `skills/*/SKILL.md` 知识注入，SDK 原生作为 context 加载

### 2.2 路由标签

`agents/<name>.yaml` 仅保留路由所需的最小元数据：

```yaml
name: screenwriter
description: "编剧：负责剧本创作..."
skills:
  - script-adapt
  - script-writer
```

Orchestrator 的 system prompt 中，`describeAgentList()` 使用这些元数据生成路由提示：

```typescript
"## Sub-Agents (dispatch via Agent tool, subagent_type = name)\n"
"- **screenwriter**: 编剧... [skills: script-adapt, script-writer]"
```

### 2.3 新旧对比

| 维度 | 旧架构 | 新架构 |
|------|--------|--------|
| 知识来源 | `skills/*/SKILL.md` → `loadSkillContents()` → `buildAgents()` 拼接 | `agents/<name>/.claude/skills/*.md`，SDK 原生加载 |
| 权限配置 | `agents/*.yaml` 的 `allowed-tools` 字段 → `buildAgents()` 传给 SDK | `.claude/settings.json`，SDK 原生执行 |
| 角色身份 | `buildAgents()` 在代码中硬编码拼接 prompt | `.claude/CLAUDE.md` 声明式定义 |
| 路由标签 | 同一 YAML 既承载运行配置又承载路由 | YAML 仅承载路由元数据 |

## 3. Orchestrator 分发模式

用户消息默认发给 Orchestrator (main session)，由 LLM 决定分发。

### 3.1 分发流程

```
用户: "帮我写一个第1集剧本"
  │
  ▼
Orchestrator LLM 收到消息
  │ system prompt:
  │   "Your ONLY job is dispatch to the right sub-agent"
  │   "Sub-Agents: screenwriter [skills: script-adapt, script-writer]"
  │   "CRITICAL: Agent tool 的 prompt 参数必须包含用户完整消息"
  │
  ▼ LLM 推理 → 调用 Agent tool:
  │   {
  │     tool: "Agent",
  │     input: {
  │       subagent_type: "screenwriter",
  │       prompt: "帮我写一个第1集剧本",
  │       description: "dispatch to screenwriter"
  │     }
  │   }
  │
  ▼ SDK 处理 Agent tool call:
  │   1. 查找 agents["screenwriter"]
  │   2. 创建子 query():
  │      cwd           = agents/screenwriter/
  │      settingSources = ["project"]
  │      → SDK 读取 .claude/CLAUDE.md (角色 + 知识)
  │      → SDK 读取 .claude/settings.json (权限)
  │      → SDK 读取 .claude/skills/*.md (领域技能)
  │      user message  = Agent tool 的 prompt 参数
  │
  ▼ Screenwriter LLM 执行任务
  │   调用 Read, Write, mcp__storage__write_json 等
  │   按 skills/*.md 中定义的工作流产出剧本
  │
  ▼ 结果返回给 Orchestrator → 汇报给用户
```

### 3.2 buildAgentOptions

```typescript
private buildAgentOptions(name: string): Record<string, unknown> {
  const agentDir = path.resolve(this.config.agentsDir, name);
  return {
    ...rest,                          // inherit mcpServers, hooks, etc.
    agent: name,
    agents: undefined,                // prevent recursive Agent tool
    cwd: agentDir,                    // agent's own directory
    settingSources: ["project"],      // SDK loads .claude/ natively
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `Project workspace: ${workspacePath}/\nAll file operations must use absolute paths within this workspace.`,
    },
  };
}
```

关键变化：
- `cwd` 指向 `agents/<name>/`（旧架构继承 workspace/）
- `settingSources: ["project"]` 让 SDK 原生读取 `.claude/`（旧架构用 `[]` 隔离）
- `systemPrompt` 仅追加 workspace 路径（旧架构无 systemPrompt，依赖 `AgentDefinition.prompt`）
- 不再需要 `loadSkillContents()` → `buildAgents()` 的 prompt 拼接链路

### 3.3 Dispatch Rules

Orchestrator 的 system prompt 中定义了严格的分发规则：

1. **所有领域任务必须分发** — 不得自己执行
2. **Agent tool 的 prompt 必须包含用户完整消息** — 防止空消息 bug
3. **Skill 名称路由** — 用户提到 skill 名时，映射到拥有该 skill 的 agent
4. **不得读取 agents/ 目录** — 防止信息泄露

## 4. Direct Mode（/enter）

用户手动进入某个 agent 的直连模式。

### 4.1 进入方式

```
/enter screenwriter        ← slash command
进入screenwriter           ← 自然语言 (matchEnterAgent)
切换到screenwriter         ← 自然语言
```

### 4.2 消息流

```
用户: "帮我写第1集剧本"
  │
  ▼ REPL 检测到 activeAgent = "screenwriter"
  │
  ▼ 跳过 Orchestrator，直接:
  │
  │ query({
  │   prompt: "帮我写第1集剧本",
  │   options: {
  │     agent: "screenwriter",
  │     agents: undefined,              // prevent recursive dispatch
  │     cwd: "agents/screenwriter/",    // agent's own directory
  │     settingSources: ["project"],    // SDK loads .claude/ natively
  │     resume: "session-id-xxx",       // resume history
  │   }
  │ })
  │
  ▼ Screenwriter LLM 直接与用户对话
```

### 4.3 两种模式对比

| | Orchestrator 分发 | Direct Mode |
|---|---|---|
| LLM 轮数 | 2 轮 (orchestrator + agent) | 1 轮 |
| 成本 | ~2x | 1x |
| 路由 | LLM 自动选择 agent | 用户手动选择 |
| 会话连续性 | 每次 Agent tool call 是独立子会话 | resume 保持历史上下文 |
| 适用场景 | 用户不确定找谁 | 用户明确要和某个 agent 持续交互 |

## 5. E2B Sandbox 模式

E2B 模式通过消息队列调度 agent session，采用懒加载策略。

### 5.1 初始化

```typescript
// SandboxOrchestrator.init()
mainSession = createSession("main", baseOptions)

// Agent sessions — lazy creation on first use
// Each agent gets its own cwd + settingSources
for (const name of Object.keys(agentDefinitions)) {
  agents[name] = createSession(name, buildAgentOptions(name));
  // buildAgentOptions(name) → { cwd: agents/<name>/, settingSources: ["project"], ... }
}
```

### 5.2 消息路由

```
chat(message, target):
  target 有值      → agents[target].queue.push(message)
  target 空 + activeAgent → agents[activeAgent].queue.push(message)
  都空             → mainSession.queue.push(message)
```

### 5.3 执行约束

```typescript
// processQuery() 中的互斥锁
const prev = this.queryLock;
this.queryLock = next;
await prev;  // 等待上一个 query 完成
```

SDK 的 MCP Protocol 不支持并发连接，所有 agent session 共享同一个 MCP 通道，因此必须串行执行。

### 5.4 Agent Options — 与 Local 模式统一

```typescript
buildAgentOptions(name):
  { ...rest }                    // inherit mcpServers, hooks
  + agent: name                  // agent identity
  + agents: undefined            // prevent recursive Agent tool
  + cwd: agents/<name>/          // agent's own directory
  + settingSources: ["project"]  // SDK reads .claude/ natively
  + systemPrompt: workspace path append
```

## 6. 数据流全景

```
agents/<name>/
  ├── .claude/                    ← SDK 原生读取
  │   ├── CLAUDE.md               ← 角色身份 + 领域知识
  │   ├── settings.json           ← 权限 (allow/deny tools)
  │   └── skills/*.md             ← 领域技能文档
  │
  └── <name>.yaml                 ← 路由元数据 (name, description, skills)
      │
      ▼ loadAgentConfigs()
      │   读取 YAML → { name, description, skills }
      │
      ▼ describeAgentList()
          生成路由提示 → Orchestrator system prompt

┌──────────────────────────────────────────────────────┐
│  Orchestrator                                          │
│  cwd = workspace/                                      │
│  system prompt:                                        │
│    agent 列表 + [skills: ...] tags + dispatch rules    │
└───────────┬──────────────────────────────────────────┘
            │ Agent tool
            ▼
┌──────────────────────────────────────────────────────┐
│  Sub-Agent Session                                     │
│  cwd = agents/<name>/                                  │
│  settingSources = ["project"]                          │
│  → SDK 自动加载:                                       │
│      .claude/CLAUDE.md → system context                │
│      .claude/settings.json → tool permissions          │
│      .claude/skills/*.md → domain knowledge            │
│  + systemPrompt.append: workspace path                 │
└───────────┬──────────────────────────────────────────┘
            │ Read / Write / MCP tools
            ▼
┌──────────────────────────────────────────────────────┐
│  workspace/                                            │
│    draft/          ← 草稿                              │
│    assets/         ← 视觉资产                          │
│    production/     ← 生产文件                          │
│    output/         ← 最终产出                          │
└──────────────────────────────────────────────────────┘
```

## 7. 文件视野与权限

| 角色 | cwd | 配置来源 | 权限控制 |
|------|-----|---------|---------|
| Orchestrator | workspace/ | `options.ts` systemPrompt | 所有 tools (Agent, TodoWrite, Read, Write, Bash, Glob, Grep) |
| Sub-agent | agents/\<name\>/ | `.claude/CLAUDE.md` + `settings.json` | SDK 从 `settings.json` 读取 allow/deny，原生执行 |

**关键区别**：
- Orchestrator 的 `settingSources: ["project"]` 读取项目根 `.claude/`，权限通过 `allowedTools` 代码配置
- Sub-agent 的 `settingSources: ["project"]` 读取 `agents/<name>/.claude/`，权限通过各自的 `settings.json` 声明式管理
- `cwd` 决定 SDK 在哪里查找 `.claude/` 目录，从而实现每个 agent 独立的配置隔离
