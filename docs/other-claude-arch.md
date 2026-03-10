# 漫剧创作平台 — 架构设计

## 1. 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                      用户浏览器                              │
│  Next.js + Tailwind + shadcn/ui                             │
│  ┌──────────┬──────────────────────┬──────────────────────┐  │
│  │ 文件树    │   产物预览区          │   对话区              │  │
│  │ (左栏)    │   (中栏)             │   (右栏)             │  │
│  │          │ 代码/图片/视频/JSON  │ 总控tab | 阶段tabs    │  │
│  └──────────┴──────────────────────┴──────────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket + REST
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 后端                              │
│  /ws/{project_id}          透明代理 orchestrator stdin/stdout │
│  /api/projects             项目 CRUD（内存存储）              │
│  /api/files/{project_id}   文件 CRUD + 二进制预览             │
└────────────────────────────┬────────────────────────────────┘
                             │ E2B SDK
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   E2B Sandbox (每个项目一个)                  │
│                   4 CPU / 4GB RAM                           │
│                                                             │
│  orchestrator.py (长驻进程, stdin/stdout JSON 协议)           │
│       │                                                     │
│       ├── master Agent (system_prompt, cwd=项目根)           │
│       │    └── MCP tool: switch_to_stage                    │
│       │                                                     │
│       └── stage Agent  (cwd=阶段目录, 加载 .claude/)         │
│            ├── .claude/CLAUDE.md    阶段指令                 │
│            ├── .claude/settings.json 权限+MCP              │
│            └── route_to 懒加载（用户在 tab 发消息时自动创建）  │
│                                                             │
│  /workspace/project/                                        │
│  ├── project.json                                           │
│  ├── 00-灵感/  (.claude/ + output/)                         │
│  ├── 01-剧本/  (.claude/ + output/)                         │
│  ├── 02-资产/  (.claude/ + output/)                         │
│  ├── 03-视频素材/ (.claude/ + output/)                      │
│  ├── 04-剪辑/  (.claude/ + output/)                         │
│  └── 05-后期/  (.claude/ + output/)                         │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心设计决策

| 问题 | 方案 | 原因 |
|------|------|------|
| 阶段配置隔离 | `ClaudeAgentOptions(cwd=阶段目录, setting_sources=["project"])` | Claude Code 自动加载 cwd 下的 `.claude/` |
| Master Agent 配置 | `system_prompt` 参数注入，**不放 .claude/ 在项目根** | 避免 Claude Code 向上遍历时污染阶段 Agent |
| 阶段间数据传递 | 约定路径 `../{上游}/output/`，不建 `input/` 软链接 | 简单直接，避免符号链接在沙箱中的问题 |
| 会话切换 | SDK MCP 工具信号 + orchestrator 检测 | agent 主动调用 → orchestrator 断开/重连 |
| Tab 路由 | chat 命令带 target，orchestrator 按需 route_to | Tab 切换纯前端，发消息才触发后端 Agent 切换 |
| 一键成片 vs 交互 | pipeline 模式开关，orchestrator Python 代码驱动 | 两种模式共存，用户按需切换 |
| 项目存储 | 内存字典 + E2B sandbox 文件系统 | 轻量化，无需数据库 |
| 文件预览 | 后端 base64 代理二进制文件，前端直接渲染 | 沙箱文件系统临时，通过 API 中转 |
| 聊天历史恢复 | SDK `get_session_messages()` → 前端 history 事件 | reconnect 时自动恢复之前的对话 |

## 3. Sandbox 目录结构

```
/workspace/project/
├── project.json                 # 项目元数据（名称、集数、阶段进度）
│
├── 00-灵感/
│   ├── .claude/
│   │   ├── CLAUDE.md            # 灵感阶段指令
│   │   └── settings.json        # 权限 + MCP (wangwen-mcp)
│   └── output/
│       └── inspiration.json     # 灵感分析结果
│
├── 01-剧本/
│   ├── .claude/
│   │   ├── CLAUDE.md            # 剧本阶段指令
│   │   └── settings.json        # 权限 + MCP
│   └── output/
│       ├── script.json          # 总剧本（角色表、场景表、全局设定）
│       └── episodes/
│           ├── ep01.md          # 第1集分集剧本
│           └── ...
│
├── 02-资产/
│   ├── .claude/
│   │   ├── CLAUDE.md            # 资产阶段指令
│   │   └── settings.json        # 权限 + MCP (图片生成)
│   └── output/
│       ├── characters/          # 角色立绘
│       ├── scenes/              # 场景图
│       ├── props/               # 道具图
│       └── entity_registry.json # 资产注册表
│
├── 03-视频素材/
│   ├── .claude/
│   │   ├── CLAUDE.md            # 视频素材阶段指令
│   │   └── settings.json        # 权限 + MCP (视频生成)
│   └── output/
│       └── ep01/
│           └── scene01/beat01/take*.mp4
│
├── 04-剪辑/
│   ├── .claude/
│   │   ├── CLAUDE.md            # 剪辑阶段指令
│   │   └── settings.json        # 权限 (ffmpeg)
│   └── output/
│       └── ep01.mp4             # 剪辑成片
│
└── 05-后期/
    ├── .claude/
    │   ├── CLAUDE.md            # 后期阶段指令
    │   └── settings.json        # 权限 (ffmpeg + 音频)
    └── output/
        └── ep01.mp4             # 最终成品

注意：项目根目录 **不放 .claude/**，master Agent 通过 system_prompt 注入指令。
```

### 阶段数据流

```
00-灵感/output/inspiration.json
       ↓  01-剧本 读取 ../00-灵感/output/
01-剧本/output/script.json + episodes/ep*.md
       ↓  02-资产 读取 ../01-剧本/output/script.json (角色/道具/场景定义)
       ↓  03-视频素材 读取 ../01-剧本/output/episodes/ (分集剧本)
02-资产/output/characters/ + scenes/ + props/
       ↓  03-视频素材 读取 ../02-资产/output/ (角色/场景图作为视频生成参考)
03-视频素材/output/ep{N}/scene{N}/beat{N}/take*.mp4
       ↓  04-剪辑 读取 ../03-视频素材/output/ (选取最佳 take 剪辑成片)
04-剪辑/output/ep{N}.mp4
       ↓  05-后期 读取 ../04-剪辑/output/ (配乐、音效、字幕)
05-后期/output/ep{N}.mp4 → 成品
```

## 4. Orchestrator 设计

### 4.1 两种 Agent 会话

| | Master Agent | Stage Agent |
|---|---|---|
| 角色 | 总控，理解用户意图 | 阶段执行者 |
| 指令来源 | `ClaudeAgentOptions.system_prompt` | `cwd/.claude/CLAUDE.md` |
| cwd | 项目根目录 | 阶段子目录 |
| MCP 工具 | `switch_to_stage(stage, task)` | `return_to_master(summary)` |
| 典型交互 | "帮我从灵感开始" → 调用 switch_to_stage | 执行阶段任务 → 完成后调 return_to_master |

### 4.2 Tab 路由（route_to）

用户在前端切换 Tab 时是纯 UI 操作，只有发消息时才触发后端 Agent 切换：

```
用户在 "01-剧本" tab 输入消息
  │
  ▼
前端 sendMessage({ cmd: "chat", message: "...", target: "01-剧本" })
  │
  ▼
orchestrator.route_to("01-剧本")
  │ 1. 当前不在 01-剧本 → disconnect 当前 client
  │ 2. create/resume "01-剧本" stage client
  │ 3. emit agent_activated 事件
  ▼
orchestrator.chat(message) → 流式输出
```

### 4.3 会话切换流程（MCP 驱动）

```
用户: "帮我写第1集剧本"
  │
  ▼
Master Agent 理解意图
  │ 调用 switch_to_stage(stage="01-剧本", task="写第1集剧本")
  ▼
Orchestrator 检测到 _switch_request
  │ 1. 断开 master client
  │ 2. 创建 stage client (cwd=01-剧本/, 加载 .claude/)
  │ 3. 发送 task 消息
  ▼
01-剧本 Agent 开始工作
  │ 完成后调用 return_to_master(summary="第1集剧本已完成")
  ▼
Orchestrator 检测到 _return_request
  │ 1. 断开 stage client
  │ 2. 恢复 master client (resume session)
  │ 3. 发送 "[01-剧本 完成] 第1集剧本已完成"
  ▼
Master Agent 收到总结，告知用户
```

### 4.4 Pipeline 模式（一键成片）

```python
async def run_pipeline(self, start_stage: int = 0):
    for stage in STAGES[start_stage:]:
        self.stage_client = await self._create_stage_client(stage)
        await self.stage_client.query("执行本阶段全部任务")
        async for msg in self.stage_client.receive_response():
            yield self._to_event(msg)
        # 校验产出
        validate_result = validate_stage(stage)
        if not validate_result.ok:
            yield {"type": "pipeline_error", "stage": stage, "errors": validate_result.errors}
            break
        yield {"type": "pipeline_next", "completed": stage, "next": next_stage}
    yield {"type": "pipeline_done"}
```

### 4.5 Session 持久化

- Claude Code 自动将会话存储到 `~/.claude/projects/{sanitized-cwd}/{uuid}.jsonl`
- `ResultMessage.session_id` 返回会话 ID
- 通过 `ClaudeAgentOptions(resume=session_id)` 恢复会话
- orchestrator 维护 `master_session_id` 和 `stage_sessions: dict[stage, session_id]`
- reconnect 时通过 `get_session_messages()` 恢复聊天历史

### 4.6 stdin/stdout JSON 协议

**命令（后端 → orchestrator）：**

```jsonc
{"cmd": "chat", "message": "帮我写剧本", "target": "01-剧本"}
{"cmd": "interrupt"}
{"cmd": "status"}
{"cmd": "pipeline_start", "from_stage": 0}
{"cmd": "pipeline_stop"}
```

**事件（orchestrator → 后端）：**

```jsonc
// 就绪
{"type": "ready", "project": "/workspace/project", "active_mode": "master"}

// Agent 文本输出
{"type": "text", "text": "好的，让我帮你..."}

// Agent 工具调用
{"type": "tool_use", "tool": "Write", "input": {"file_path": "...", "content": "..."}}
{"type": "tool_result", "id": "toolu_xxx", "is_error": false}

// Agent 路由切换
{"type": "agent_activated", "agent_id": "01-剧本"}

// 阶段切换（MCP 驱动）
{"type": "stage_switch", "stage": "01-剧本"}
{"type": "stage_return", "stage": "01-剧本", "summary": "第1集剧本完成"}
{"type": "switched", "active_mode": "stage", "stage": "01-剧本"}

// 聊天历史恢复
{"type": "history", "agent_id": "总控", "messages": [...]}

// 会话结束
{"type": "result", "active_mode": "master", "stage": null, "session_id": "uuid", "cost_usd": 0.5, "turns": 12}

// 阶段校验状态
{"type": "stages_validation", "stages": {"00-灵感": "passed", "01-剧本": "pending", ...}}

// Pipeline 事件
{"type": "pipeline_next", "completed": "00-灵感", "next": "01-剧本"}
{"type": "pipeline_done"}
```

## 5. 后端设计 (FastAPI)

### 5.1 项目结构

```
backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, 路由挂载
│   ├── config.py            # 配置 (E2B_API_KEY, ANTHROPIC_API_KEY)
│   ├── routers/
│   │   ├── projects.py      # /api/projects CRUD（内存存储）
│   │   ├── files.py         # /api/files/{project_id} 文件操作 + 二进制预览
│   │   └── ws.py            # /ws/{project_id} WebSocket 代理
│   ├── services/
│   │   ├── sandbox.py       # E2B sandbox 管理 (创建/恢复/销毁/自动同步)
│   │   └── storage.py       # 文件存储辅助
│   └── schemas.py           # Pydantic schemas
```

### 5.2 WebSocket 代理

```
浏览器 ←WebSocket→ FastAPI ←stdin/stdout→ E2B Sandbox (orchestrator.py)
```

FastAPI 作为透明代理：
- 前端 WebSocket 消息 → JSON 写入 sandbox stdin
- Sandbox stdout JSON → WebSocket 推送给前端
- 自动同步文件变更事件（tool_result 触发文件树刷新）

### 5.3 文件 API

```
GET    /api/files/{project_id}/tree           # 文件树
GET    /api/files/{project_id}/read?path=...  # 读文件内容（文本 UTF-8）
GET    /api/files/{project_id}/binary?path=.. # 读二进制文件（图片/视频 base64）
POST   /api/files/{project_id}/write          # 写文件
DELETE /api/files/{project_id}/delete         # 删文件
```

通过 E2B SDK 的 `sandbox.files` API 代理。二进制文件（图片/视频）通过 sandbox 内 `base64` 命令捕获 stdout 返回。

### 5.4 项目存储

项目元数据存储在后端内存字典中：

```python
projects_db: dict[str, dict] = {}
```

每个项目记录包含：项目 ID、名称、沙箱 ID、创建时间等。沙箱销毁时项目数据丢失（当前为 MVP 阶段）。

## 6. 前端设计 (Next.js)

### 6.1 三栏布局

```
┌──────────┬──────────────────────────────┬──────────────────────┐
│          │                              │                      │
│ 文件树    │      产物预览区               │      对话区           │
│          │                              │                      │
│ 00-灵感/  │ ┌────────────────────────┐   │ ┌──────┬──────────┐  │
│ 01-剧本/  │ │                        │   │ │ 总控  │ 01-剧本  │  │
│ 02-资产/  │ │  代码高亮               │   │ ├──────┴──────────┤  │
│ 03-视频/  │ │  JSON 格式化            │   │ │                  │  │
│ 04-剪辑/  │ │  图片/视频预览           │   │ │ [对话消息流]      │  │
│ 05-后期/  │ │  Markdown 渲染          │   │ │                  │  │
│          │ │                        │   │ ├──────────────────┤  │
│          │ └────────────────────────┘   │ │ [输入框]          │  │
│          │                              │ └──────────────────┘  │
└──────────┴──────────────────────────────┴──────────────────────┘
```

### 6.2 文件树

- 展示 sandbox 文件系统，按阶段分组
- 点击文件 → 中栏预览
- 文件树高亮跟随当前选中 Tab（activeTab）
- Agent 操作文件后自动刷新

### 6.3 预览区

支持的文件类型：
- **文本**: 代码高亮（语法着色）
- **JSON**: 格式化 + 折叠展示
- **图片**: PNG/JPG/WebP 内联预览（通过 binary API）
- **视频**: MP4 播放器（通过 binary API）
- **Markdown**: 渲染展示

### 6.4 对话区

**Tab 切换（纯前端）:**
- "总控" tab: master agent 对话（始终存在）
- 阶段 tab: 当进入某阶段时自动创建
- Tab 切换不触发后端调用，仅发消息时按 target 路由

**消息类型展示:**
- `text`: 文本气泡（支持 Markdown）
- `tool_use`: 折叠面板（工具名 + 参数摘要）
- `tool_result`: 结果状态（成功/失败 + 输出）
- `stage_switch` / `agent_activated`: 系统消息条

## 7. E2B Sandbox 模板

### 7.1 v2 构建系统

使用 E2B v2 远程构建（无需本地 Docker）：

```python
# template.py
template = (
    Template()
    .from_node_image("20")
    .set_user("root")
    .set_workdir("/")
    .run_cmd("apt-get update && apt-get install -y --no-install-recommends "
             "ffmpeg imagemagick python3 python3-pip python3-venv")
    .run_cmd("npm install -g @anthropic-ai/claude-code")
    .run_cmd("pip install --no-cache-dir --break-system-packages claude-agent-sdk anthropic")
    .copy("sandbox/", "/opt/sandbox/")
    .copy("templates/", "/opt/templates/")
    .run_cmd("mkdir -p /workspace/project")
    .set_user("user")
    .set_workdir("/home/user")
)
```

### 7.2 Sandbox 初始化流程

```
创建项目 → 启动 Sandbox (comic-agent 模板)
  → 运行 init_project.sh (从 /opt/templates 初始化项目目录)
  → 启动 orchestrator.py (stdin/stdout 长驻进程)
  → 等待 ready 事件
  → 用户开始对话
```

### 7.3 资源配置

| 配置 | 值 |
|------|-----|
| CPU | 4 核 |
| 内存 | 4096 MB |
| 模板名 | comic-agent (生产) / comic-agent-dev (开发) |

## 8. 技术栈汇总

| 层 | 技术 | 用途 |
|---|---|---|
| 前端 | Next.js + Tailwind + shadcn/ui | Web UI（深色主题） |
| 后端 | FastAPI + Uvicorn | API + WebSocket 代理 |
| 项目存储 | 内存字典 | 项目元数据（MVP） |
| 沙箱 | E2B Sandbox (v2) | 隔离执行环境 (4C/4G) |
| AI Agent | Claude Agent SDK | 会话管理 + 流式输出 |
| Agent 配置 | .claude/ (CLAUDE.md + settings.json) | 阶段隔离 |
| 编排器 | orchestrator.py (stdin/stdout) | 会话路由 + 阶段编排 + Pipeline |