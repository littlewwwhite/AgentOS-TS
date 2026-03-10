# 漫剧创作平台

E2B Sandbox + Claude Agent SDK 驱动的 AI 漫剧全流程创作平台。

用户通过 Web 界面与 AI Agent 对话，Agent 在云端沙箱中自动完成从灵感到成片的 6 个创作阶段。

## 架构

```
浏览器 ←WebSocket→ FastAPI 后端 ←stdin/stdout→ E2B Sandbox
                                                    │
                                                    ├── orchestrator.py  (主控，管理 Agent 会话)
                                                    ├── validate.py      (阶段产出校验)
                                                    ├── init_project.sh  (项目初始化)
                                                    └── Claude Agent SDK (实际执行创作)
```

**核心思路**：每个项目对应一个 E2B 云端沙箱（4 CPU / 4GB RAM）。沙箱内运行 `orchestrator.py` 长驻进程，通过 Claude Agent SDK 管理两类 Agent 会话：

- **总控 (master)**：项目根目录，理解用户意图，决定切换到哪个阶段
- **阶段 (stage)**：阶段子目录，自动加载该阶段的 `.claude/CLAUDE.md` + `settings.json`，执行具体创作

用户可以直接在各阶段 Tab 发消息与阶段 Agent 对话（懒加载，首次发消息时自动创建 Agent），也可以通过总控统一调度。

## 6 个创作阶段

| 阶段 | 说明 | 产出 |
|------|------|------|
| 00-灵感 | 市场调研、参考作品分析 | `output/inspiration.json` |
| 01-剧本 | 人物/场景/道具设定 + 分集剧本 | `output/script.json` + `output/episodes/ep*.md` |
| 02-资产 | 角色三视图、场景参考图、道具图 | `output/characters/*/entity.json` + 图片 |
| 03-视频素材 | 逐集逐镜头生成视频 | `output/ep*/manifest.json` + `take*.mp4` |
| 04-剪辑 | 按集剪辑合成 | `output/ep*.mp4` |
| 05-后期 | 配乐、字幕、最终输出 | `output/ep*.mp4` |

阶段间通过 `output/` 目录传递数据，下游直接读取上游的 `../XX-阶段/output/`。

## 目录结构

```
e2b-claude-agent/
├── backend/app/              # FastAPI 后端
│   ├── main.py               #   应用入口 + CORS + 路由挂载
│   ├── config.py             #   配置（.env 读取）
│   ├── schemas.py            #   Pydantic 模型
│   ├── routers/
│   │   ├── projects.py       #   /api/projects — 项目 CRUD
│   │   ├── files.py          #   /api/files — 沙箱文件浏览 + 二进制预览
│   │   └── ws.py             #   /ws/{project_id} — WebSocket 代理
│   └── services/
│       ├── sandbox.py        #   E2B Sandbox 管理（创建/销毁/通信/自动同步）
│       └── storage.py        #   文件存储辅助
│
├── frontend/src/             # Next.js 前端（深色主题）
│   ├── app/                  #   页面路由
│   ├── components/
│   │   ├── chat/             #   聊天面板（多 tab + 消息流）
│   │   ├── file-tree/        #   文件树浏览器
│   │   ├── layout/           #   三栏布局
│   │   ├── preview/          #   文件预览（代码/图片/视频/JSON）
│   │   └── ui/               #   shadcn/ui 基础组件
│   ├── hooks/
│   │   └── use-websocket.ts  #   WebSocket Hook（消息分 tab、target 路由）
│   └── lib/
│       └── types.ts          #   类型定义（WSEvent、Project 等）
│
├── sandbox/                  # E2B Sandbox 内运行的代码
│   ├── orchestrator.py       #   主控编排（Agent 会话管理 + Pipeline + route_to）
│   ├── validate.py           #   阶段产出校验
│   └── init_project.sh       #   项目目录初始化
│
├── templates/                # 项目模板（各阶段 .claude/ 配置）
│   ├── 00-灵感/.claude/      #   CLAUDE.md + settings.json
│   ├── 01-剧本/.claude/
│   ├── 02-资产/.claude/
│   ├── 03-视频素材/.claude/
│   ├── 04-剪辑/.claude/
│   ├── 05-后期/.claude/
│   └── project.json          #   项目元数据模板
│
├── template.py               # E2B v2 模板定义（镜像配置）
├── build_template.py         # 构建脚本（支持 --dev 参数）
├── build_dev.py              # 构建开发版模板
├── build_prod.py             # 构建生产版模板
├── main.py                   # 后端启动入口（uvicorn）
├── pyproject.toml            # Python 依赖
├── Makefile                  # 常用命令
└── docs/
    └── CHANGELOG.md          # 变更日志
```

## 快速开始

### 环境要求

- Python 3.12+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/)（Python 包管理）

### 1. 安装依赖

```bash
make install
# 等价于:
#   uv sync                      (后端 Python 依赖)
#   cd frontend && npm install   (前端 Node 依赖)
```

### 2. 配置环境变量

在项目根目录创建 `.env`：

```env
ANTHROPIC_API_KEY=sk-ant-xxx
E2B_API_KEY=e2b_xxx
```

### 3. 构建 E2B Sandbox 模板

```bash
make build-template
# 等价于: uv run python build_template.py

# 构建开发版（模板名 comic-agent-dev）
make build-template-dev
```

使用 E2B v2 远程构建系统（无需本地 Docker），基于 Node.js 20 镜像，预装：
- ffmpeg、ImageMagick
- Claude Code CLI
- claude-agent-sdk、anthropic

模板资源：4 CPU / 4GB RAM。

### 4. 启动服务

```bash
# 同时启动前后端
make run

# 或分别启动
make run-backend   # FastAPI http://localhost:8000
make run-frontend  # Next.js  http://localhost:3000
```

打开 `http://localhost:3000`，创建项目，开始对话。

## 可用的 Make 命令

| 命令 | 说明 |
|------|------|
| `make install` | 安装全部依赖 |
| `make run` | 同时启动前后端 |
| `make run-backend` | 只启动后端 (port 8000) |
| `make run-frontend` | 只启动前端 (port 3000) |
| `make build-frontend` | 前端生产构建 |
| `make build-template` | 构建 E2B Sandbox 生产模板 (v2) |
| `make build-template-dev` | 构建 E2B Sandbox 开发模板 |
| `make check-syntax` | 检查前后端语法 |
| `make lint` | 前端 lint 检查 |
| `make clean` | 清理缓存 |

## 本地测试

以下是**不需要 E2B / Anthropic API Key** 就能验证的内容：

### 语法检查

```bash
make check-syntax
```

### validate.py 单元测试

```bash
# 查看用法
python3 sandbox/validate.py

# 模拟 00-灵感 校验通过
mkdir -p /tmp/test-00/output
echo '{"core_concept":"test","genre":"玄幻"}' > /tmp/test-00/output/inspiration.json
python3 sandbox/validate.py 00-灵感 /tmp/test-00/output
# => ✅ 00-灵感 校验通过

# 清理
rm -rf /tmp/test-00
```

### 需要 API Key 的测试

| 测试项 | 需要的 Key | 说明 |
|--------|-----------|------|
| 创建项目 + 启动 Sandbox | `E2B_API_KEY` | POST `/api/projects` 会创建真实的 E2B Sandbox |
| Agent 对话 | `E2B_API_KEY` + `ANTHROPIC_API_KEY` | WebSocket 连接后发消息触发 Claude Agent |
| 一键成片 Pipeline | 同上 | 串联执行 6 个阶段 + 每阶段自动校验 |

## WebSocket 协议

前端通过 `ws://localhost:8000/ws/{project_id}` 连接后端，后端透明代理 orchestrator 的 stdin/stdout。

### 发送命令（前端 → 后端 → orchestrator）

```jsonc
// 带 target 路由：在指定 tab 发消息，后端自动创建/恢复对应 Agent
{"cmd": "chat", "message": "帮我写第一集剧本", "target": "01-剧本"}
{"cmd": "chat", "message": "帮我分析一下", "target": "总控"}
{"cmd": "interrupt"}
{"cmd": "status"}
{"cmd": "pipeline_start", "from_stage": 0}
```

### 接收事件（orchestrator → 后端 → 前端）

| 事件类型 | 说明 |
|---------|------|
| `ready` | orchestrator 就绪 |
| `text` | Agent 输出文本 |
| `tool_use` / `tool_result` | Agent 调用/返回工具 |
| `result` | Agent 一轮对话结束 |
| `history` | 恢复的聊天历史（reconnect 时） |
| `agent_activated` | Agent 路由切换完成 |
| `stage_switch` / `stage_return` | 阶段切入/返回 |
| `switched` | 切换完成确认 |
| `stages_validation` | 各阶段校验状态 |
| `task_progress` | 任务进度更新 |
| `pipeline_start` / `pipeline_stage` / `pipeline_done` | 流水线进度 |
| `validation_passed` / `validation_failed` | 阶段产出校验结果 |
| `error` | 错误信息 |

## 技术栈

- **后端**: FastAPI + Pydantic + uvicorn
- **前端**: Next.js + React + Tailwind CSS + shadcn/ui
- **沙箱**: E2B Sandbox (v2 远程构建，4 CPU / 4GB RAM)
- **AI**: Claude Agent SDK (`claude-agent-sdk`)
- **包管理**: uv (Python) + npm (Node.js)