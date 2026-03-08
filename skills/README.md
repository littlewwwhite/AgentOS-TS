# Skills

AgentOS 的 Skill 目录，共 11 个 skill，覆盖从剧本创作到视频交付的完整 AI 微短剧生产管线。

## 架构概览

### Skill 标准结构

每个 skill 是一个独立目录，包含 `SKILL.md`（必需）和可选的支撑文件：

```
skill-name/
├── SKILL.md              # 入口：YAML frontmatter + Markdown 指令
├── references/           # 按需加载的参考文档（详细规则、协议等）
├── resources/            # 共享知识库（领域知识、写作规则等）
├── assets/               # 输出模板（交付物模板、风格指南等）
└── scripts/              # 可执行脚本（Python/Bash）
```

### Frontmatter 字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | Skill 标识符（省略时用目录名） | `script-writer` |
| `description` | 功能描述 + 触发条件（主触发机制） | `"微短剧剧本写作流水线..."` |
| `allowed-tools` | 限制可用工具集（可选） | `["Read", "Write"]` |
| `model` | 指定模型（可选） | `sonnet` |
| `argument-hint` | 参数提示（可选） | `<视频文件路径>` |

### Loader 机制

`src/agentos/loader.py` 递归扫描 `skills/` 下的 `SKILL.md`，解析 frontmatter 构建 `AgentDefinition`。支撑文件（references/、resources/、assets/）在 skill 调用时按需加载到 prompt 上下文中。

---

## 数据管线（DAG）

```
创意/小说
    │
    ├─► script-writer (原创 SWS / 改编 NTSV2)
    │       产出: s7-scripts.md (需转换)
    │
    ├─► script-adapt (3 阶段直转)
    │       产出: script.json + catalog.json + design.json
    │
    └───────────────┬──────────────────────────┐
                    ▼                          ▼
             image-create/edit          kling-video-prompt
             (角色/场景/道具              (剧本 → 镜头提示词)
              资产图生成)                      │
                    │                   ep{XX}_shots.json
                    │                          │
                    └──────────┬───────────────┘
                               ▼
                          video-create
                          (资产上传 + 视频生成)
                               │
                               ▼
                          video-review
                          (六级评审 + 自动重生成)
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
               合格 → 继续          不合格 → 优化提示词
                    │                → video-create 重生成
                    ▼
               music-matcher
               (视频分析 → 向量匹配 → 配乐合成)
                    │
                    ▼
               最终视频交付
```

辅助链路：
- `music-finder` → `music-matcher`（音乐风格查询服务）
- `browser-agent`（独立工具，无管线依赖）
- `skill-creator`（元 skill，用于创建新 skill）

---

## 核心数据合约

管线各阶段通过文件进行数据传递，以下是不可破坏的核心合约：

| 合约文件 | 上游 Skill | 下游 Skill | 格式 |
|----------|-----------|-----------|------|
| `script.json` | script-adapt (Phase 3) | kling-video-prompt | JSON (episodes > scenes > actions) |
| `catalog.json` | script-adapt (Phase 1) | 全管线（角色/地点 ID 映射） | JSON (actors + locations) |
| `design.json` | script-adapt (Phase 1) | 全管线（世界观 + 视觉风格） | JSON |
| `s7-scripts.md` | script-writer (S7) | kling-video-prompt（需转换） | Markdown + SWS/NTSV2 标记 |
| `ep{XX}_shots.json` | kling-video-prompt | video-create, video-review | JSON (segments 数组) |
| `*_optimized.json` | video-review | video-create（重生成） | JSON (优化后提示词) |

### 项目工作区目录约定

```
project-workspace/
├── 01-script/output/         # 剧本产物
│   ├── script.json
│   ├── design.json
│   ├── catalog.json
│   └── episodes/ep*.md
├── 02-资产/output/            # 图片资产
│   ├── characters/
│   ├── scenes/
│   └── props/
└── 03-视频素材/               # 视频 + 评审
    ├── workspace/input  → symlink → 01-script/output/
    ├── workspace/assets → symlink → 02-资产/output/
    └── output/ep{XX}/ep{XX}_shots.json
```

---

## Skill 模块详情

### 剧本创作层

#### script-writer — 微短剧剧本写作流水线

九阶段（S1→S9）流水线，支持两种模式：

| 模式 | 输入 | 目标集数 | 工作区 |
|------|------|---------|--------|
| 原创（SWS） | 用户创意灵感 | 用户指定 | `sws-workspace/` |
| 改编扩写（NTSV2） | 短篇小说（≤1万字） | 50-60 集 | `ntsv2-workspace/` |

**特色**：改编模式支持六维度扩写（主线细化/支线补写/角色深化/世界观补足/情感扩写/冲突升级）。

**文件规模**：11 references + 9 resources + 12 assets（含共享领域知识、写作规则、协议规范等）。

#### script-adapt — 小说直转剧本流水线

三阶段（Phase 1→3）精简流水线，适合体量充足的小说直接改编：

| 阶段 | 输入 | 产物 |
|------|------|------|
| Phase 1 分析设计 | source.txt | design.json + catalog.json |
| Phase 2 写作 | design.json + catalog.json | ep\*.md |
| Phase 3 结构解析 | ep\*.md + catalog.json | script.json |

**特色**：`allowed-tools` 限制为 Read/Write + MCP 工具，指定 `model: sonnet`。references 预加载到 prompt 中，无运行时文件读取。

### 资产生成层

#### image-create — 图片生成

通过 anime-material-workbench API 生成角色、场景、道具等图片资产。

**工作流**：认证 → 模型选择 → 参数配置 → 提交任务 → 后台轮询 → 返回结果。

**Base URL**：`https://animeworkbench-pre.lingjingai.cn`

#### image-edit — 图片编辑

通过 anime-material-workbench API 编辑图片，支持风格迁移等操作。

**工作流**：与 image-create 相同，额外支持本地图片上传至腾讯云 COS。

**Base URL**：`https://animeworkbench-pre.lingjingai.cn`

### 视频生产层

#### kling-video-prompt — 可灵视频提示词生成

将 `script.json` 转化为视频生成平台可用的结构化提示词 JSON。

**核心规则**：
- 每个 action → 一个 L 单位（segment），时长 3-15s
- Segment 含 12 个字段（严格顺序），Shot 含 5 个字段
- 英文/中文双语提示词，含人物一致性前缀 + 风格提示词
- 支持智能段落合并、时长超限拆分

**产物**：`ep{XX}_shots.json`

#### video-create — 视频生成

通过 anime-material-workbench API 生成视频，支持图生视频、文生视频。

**工作流**：认证 → 模型选择 → 参数配置 → 上传素材（COS）→ 提交任务 → 后台轮询。

**Base URL**：`https://animeworkbench.lingjingai.cn`

#### video-review — 视频评审

基于提示词符合度 + 五维度的结构化视频评审。

**六级判定规则**（按级别 0→5 依次触发）：

| 级别 | 规则 | 阈值 |
|------|------|------|
| 0 | 提示词符合度过低 | < 0.2 |
| 1 | 人物一致性不足 | < 7 |
| 2 | 场景一致性不足 | < 7 |
| 3 | 任意维度严重不达标 | < 5 |
| 4 | 任意维度未达标 | < 7 |
| 5 | 总分不足 | < 40 |

**闭环**：不合格 → 时间段分析 → 提示词优化 → video-create 重生成 → 再评审。

### 音频层

#### music-matcher — 智能视频配乐

基于向量语义匹配的视频配乐工具。

**管线**：Gemini 视频分析 → DashScope 向量化 → 余弦相似度匹配 → FFmpeg 合成。

**依赖**：`.env`（GEMINI_API_KEY + DASHSCOPE_API_KEY + MUSIC_LIBRARY_CSV）、ffmpeg。

#### music-finder — 音乐风格查询

基于 RateYourMusic 的 5947 个音乐风格数据库，支持精确查询、语义推荐、层级探索。

**数据结构**：49 主分类 → 737 子分类 → 5161 孙分类，渐进式加载。

**硬性约束**：禁止凭记忆回答，必须从 references/ 文件读取数据。

### 独立工具

#### browser-agent — 浏览器自动化

基于 agent-browser CLI 的浏览器自动化工具。

**核心模式**：Navigate → Snapshot（获取 @ref）→ Interact → Re-snapshot。

**能力**：表单填写、身份认证、数据抓取、截图、PDF 导出、多会话并行、iOS 模拟器支持。

**限制**：`allowed-tools: Bash(npx agent-browser:*)`

#### skill-creator — Skill 创建指南

元 skill，指导创建新的 skill。提供六步创建流程：理解需求 → 规划内容 → 初始化 → 编辑 → 打包 → 迭代。

---

## Skill 间通信方式

Skill 之间**不直接通信**，而是通过以下机制协作：

1. **文件合约**：上游 skill 将产物写入约定路径，下游 skill 从该路径读取（见核心数据合约表）
2. **Symlink 桥接**：`03-视频素材/workspace/` 通过 symlink 指向 `01-script/output/` 和 `02-资产/output/`
3. **用户编排**：用户按管线顺序逐个调用 skill，或由 AgentOS orchestrator 自动编排
4. **共享认证**：image-create/image-edit/video-create 共享 `~/.animeworkbench_auth.json` 认证状态

### 共享资源

script-writer 内部的 resources/ 包含共享领域知识（writing-rules.md、shared-domain.md 等），这些文件在原创模式和改编模式间共享。script-adapt 的 writing-rules.md 为独立副本。

修改共享资源时需注意同步：

| 文件 | 存在于 |
|------|--------|
| `writing-rules.md` | script-writer/resources/, script-adapt/references/ |
| `shared-domain.md` | script-writer/resources/, script-adapt/references/ |
| `style-options.md` | script-writer/resources/, script-adapt/references/ |

---

## 开发规范

- SKILL.md 行数上限 **500 行**，详细内容移入 references/
- 脚本路径使用 `${CLAUDE_SKILL_DIR}` 变量，禁止硬编码绝对路径
- Frontmatter 工具限制使用 `allowed-tools`（非 `tools`）
- 禁止在 skill 中放置 README.md（本文件是 skills/ 目录级文档，非 skill 内部文件）、CHANGELOG.md、INSTALLATION_GUIDE.md 等非标准文件
- 每个 skill 保持自包含，不依赖其他 skill 目录下的文件
