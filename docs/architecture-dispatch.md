# AgentOS-TS Dispatch Architecture

Agent 调度与任务执行的完整链路，包括 Skills 在系统中的三重角色。

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
│  preset=claude_code│  │  无 orchestrator 层   │
│  有 Agent tool     │  │  无 Agent tool        │
└────────┬─────────┘  └──────────┬──────────┘
         │ Agent tool call                │
         ▼                                ▼
┌──────────────────┐            ┌─────────────────┐
│  Sub-Agent LLM    │            │  MCP Tool 调用   │
│  system = prompt  │            │  storage/image/  │
│  tools = YAML 白名单│           │  video/audio/   │
│  skills = 领域知识  │           │  script          │
└──────────────────┘            └─────────────────┘
```

## 2. Skills 的三重角色

Skills 在系统中同时承担三个不同层面的功能：

### 2.1 知识注入层 — SKILL.md → Agent prompt

```
skills/script-writer/SKILL.md
  │
  ▼ loadSkillContents() (loader.ts)
  │   读取 Markdown 内容 + YAML frontmatter
  │   提取 description、替换路径变量
  │   返回 { prompt, description, referencesDir }
  │
  ▼ buildAgents() (agents.ts)
  │   遍历 agent YAML 的 skills 列表
  │   将每个 skill 的 prompt 拼接到 agent 的 system prompt
  │
  ▼ AgentDefinition.prompt =
      "# Role: screenwriter\n...\n\n"     ← 角色身份
    + "Project workspace: /path/\n\n"       ← 工作区
    + "[script-writer SKILL.md 内容]\n\n"   ← 领域知识 ①
    + "[script-adapt SKILL.md 内容]\n\n"    ← 领域知识 ②
    + "## Domain Skills\n- script-writer: ..." ← 能力清单
```

这是 skills 最核心的用途：**将领域专业知识注入 agent 的 system prompt**，让 LLM 具备该领域的工作流程和质量标准。

### 2.2 SDK Skills 字段 — AgentDefinition.skills

```typescript
// agents.ts
agents[name] = {
  prompt: ...,
  skills: config.skills ?? [],   // ["script-writer", "script-adapt"]
  ...
};
```

SDK `AgentDefinition.skills` 的语义是 "Array of skill names to preload into the agent context"。SDK 会尝试在 Claude Code 的 skill 系统中查找这些名称并加载到 agent 上下文。

**当前状态**：
- 我们传入的是项目自定义 skill 名称（如 "script-writer"）
- 这些不是 Claude Code 平台 skills（如 "simplify", "loop"）
- SDK 找不到同名平台 skill 时会静默忽略
- 主要作用是让 SDK 的 session metadata 中记录 agent 配置了哪些 skills

### 2.3 路由标签 — Orchestrator 的调度依据

```typescript
// options.ts — describeAgentList()
"## Sub-Agents (dispatch via Agent tool, subagent_type = name)\n"
"- **screenwriter**: 编剧... [skills: script-adapt, script-writer]"
"- **art-director**: 美术设计... [skills: asset-gen, image-create, ...]"
```

Orchestrator 的 system prompt 中，每个 agent 后面标注了 `[skills: ...]` 标签。当用户提到某个 skill 名称时，orchestrator LLM 可以据此定位到正确的 agent。

**三重角色对照**：

| 层面 | 存储位置 | 消费者 | 作用 |
|------|---------|--------|------|
| 知识注入 | `AgentDefinition.prompt` | Sub-agent LLM | 赋予领域专业能力 |
| SDK 注册 | `AgentDefinition.skills` | SDK 内部 | 元数据记录 |
| 路由标签 | Orchestrator system prompt | Orchestrator LLM | 意图 → agent 映射 |

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
  │   1. 查找 agents["screenwriter"] → AgentDefinition
  │   2. 创建子 query():
  │      system prompt = AgentDefinition.prompt (含 skill 知识)
  │      user message  = Agent tool 的 prompt 参数
  │      tools         = AgentDefinition.tools (YAML 白名单)
  │      model         = AgentDefinition.model
  │      cwd           = 继承 parent 的 cwd
  │
  ▼ Screenwriter LLM 执行任务
  │   调用 Read, Write, mcp__storage__write_json 等
  │   按 SKILL.md 中定义的工作流产出剧本
  │
  ▼ 结果返回给 Orchestrator → 汇报给用户
```

### 3.2 Dispatch Rules

Orchestrator 的 system prompt 中定义了严格的分发规则：

1. **所有领域任务必须分发** — 不得自己执行
2. **Agent tool 的 prompt 必须包含用户完整消息** — 防止空消息 bug
3. **Skill 名称路由** — 用户提到 skill 名时，映射到拥有该 skill 的 agent
4. **不得读取 skills/ 目录** — 防止信息泄露

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
  │     agent: "screenwriter",       // 使用 screenwriter 的 AgentDefinition
  │     agents: undefined,           // 禁止递归 dispatch
  │     settingSources: [],          // 隔离全局配置
  │     resume: "session-id-xxx",    // 恢复历史会话
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

E2B 模式预创建所有 agent 的 worker，通过消息队列调度。

### 5.1 初始化

```typescript
// SandboxOrchestrator.init()
mainSession   = createSession("main", baseOptions)
agents["screenwriter"]    = createSession("screenwriter", buildAgentOptions("screenwriter"))
agents["art-director"]    = createSession("art-director", buildAgentOptions("art-director"))
// ...
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

### 5.4 Agent Options 隔离

```typescript
buildAgentOptions(name):
  { ...baseOptions }
  - systemPrompt: 移除 (agent 使用自己的 AgentDefinition.prompt)
  - agents: undefined (禁止 sub-agent 递归调用 Agent tool)
  - settingSources: [] (隔离全局 CLAUDE.md)
  + agent: name (指定身份)
```

## 6. 数据流全景

```
                         ┌──────────────────────┐
                         │  skills/*/SKILL.md    │
                         │  领域知识 + 工作流     │
                         └──────────┬───────────┘
                                    │ loadSkillContents()
                                    ▼
┌──────────────────┐    ┌──────────────────────┐
│  agents/*.yaml    │───▶│  buildAgents()       │
│  tools, model,    │    │  AgentDefinition =    │
│  skills, policy   │    │    prompt (含 skill)  │
└──────────────────┘    │    tools (白名单)      │
                         │    skills (名称列表)   │
                         │    model, mcpServers   │
                         └──────────┬───────────┘
                                    │
                     ┌──────────────┴───────────────┐
                     ▼                               ▼
          ┌────────────────┐              ┌────────────────────┐
          │  Orchestrator   │              │  Sub-Agent Session  │
          │  system prompt: │              │  prompt = 角色+skills│
          │   agent 列表     │              │  tools = YAML 白名单 │
          │   [skills: ...] │              │  cwd = workspace/   │
          │   dispatch rules│              └────────┬───────────┘
          └────────┬───────┘                        │
                   │ Agent tool                     │ Read/Write/MCP
                   ▼                                ▼
          ┌────────────────┐              ┌────────────────────┐
          │  SDK 启动子 query│              │  workspace/         │
          │  传入 prompt     │              │    draft/           │
          │  + AgentDefinition│             │    assets/          │
          └────────────────┘              │    output/          │
                                          └────────────────────┘
```

## 7. 文件视野（当前状态）

| 角色 | cwd | tools | 实际可访问 |
|------|-----|-------|-----------|
| Orchestrator | workspace/ | Agent, TodoWrite, Read, Write, Bash, Glob, Grep | **整个文件系统**（cwd 仅影响相对路径） |
| Sub-agent | workspace/ (继承) | YAML 白名单 | 同上（有 Bash 的 agent 可访问任意路径） |

**待改进**：
- Orchestrator 只需 Agent + TodoWrite + Read，不需要 Bash/Write/Glob/Grep
- Agent YAML 中的 `file-policy` 字段已定义但未被代码消费
- `cwd` 不是访问控制，只设置工作目录
