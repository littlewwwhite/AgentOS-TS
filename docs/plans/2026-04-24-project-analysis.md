# AgentOS-TS 项目分析（2026-04-24）

## 1. 项目定位结论

该仓库当前是 **skill pack 内容仓库**，而非应用运行时仓库：

- README 与 AGENTS 共同约束了“仅保留 skills，不恢复 CLI/Web/Server/runtime 壳层”的方向。
- `.claude/skills/` 为唯一事实源，`.agents/skills` 仅作为 Codex 发现入口的映射层。
- 目标是让 Claude Code / Codex 能直接发现并执行视频生产流水线相关技能。

## 2. 结构与边界

### 2.1 目录结构

核心内容集中在以下区域：

- `.claude/skills/`：9 个技能主体（含 `SKILL.md`、`scripts/`、`assets/`、`references/`）
- `.agents/skills`：指向 `.claude/skills` 的适配入口
- `docs/`：契约文档与维护计划
- 仓库级约束：`AGENTS.md`、`CLAUDE.md`

### 2.2 流水线边界

文档将业务拆为 8 个阶段（INSPIRATION → SUBTITLE），并通过 skill 明确职责边界：

- 调研：`wangwen`
- 剧本：`script-adapt` / `script-writer`
- 视觉与分镜：`asset-gen` / `storyboard`
- 生产后段：`video-gen` / `video-editing` / `music-matcher` / `subtitle-maker`

这种拆分降低了单一 skill 的复杂度，也便于用户按阶段重跑。

## 3. 当前优势

1. **事实源明确**：`.claude/skills` 单一事实源 + `.agents/skills` 适配层，降低重复维护风险。
2. **阶段化清晰**：从灵感到字幕形成完整链路，且有门禁（gate）与状态流转定义。
3. **文档契约化**：`inspiration-contract`、`pipeline-state-contract` 保障结构化产物可校验。
4. **脚本化较充分**：多个 skill 具备 `scripts/`，可复用而非靠临时手工指令。

## 4. 潜在风险

1. **绝对路径残留**：README 中仍存在本机绝对路径示例（`/Users/...`），对跨环境可读性不友好。
2. **双入口认知成本**：虽有“事实源/适配层”定义，但新维护者可能误改 `.agents/skills`。
3. **依赖外部环境较重**：AWB、Gemini、ffmpeg、MCP 等链路对环境一致性要求高。
4. **跨 skill 规范漂移风险**：若各 skill 独立演进，路径约定、输出契约、命名风格可能逐步分叉。

## 5. 建议的短期治理动作（按优先级）

1. **README 去本机路径化（P0）**
   - 将所有 `/Users/...` 链接改为仓库相对路径，避免误导。
2. **增加“技能入口一致性检查脚本”（P1）**
   - 自动校验 `.agents/skills` 是否存在且指向 `.claude/skills`。
3. **增加“技能清单快照”文档（P1）**
   - 记录每个 skill 的输入/输出/依赖，降低 onboarding 成本。
4. **建立轻量 lint 规则（P2）**
   - 对 `SKILL.md` 中路径写法、命令前缀（仓库根相对路径）做一致性检查。

## 6. 结论

仓库整体状态健康，定位清晰，已从“运行时平台”收敛到“技能内容仓库”，适合继续沿“单一事实源 + 阶段化流水线 + 契约文档”演进。

后续优先事项应聚焦在 **文档可移植性** 与 **技能治理自动化**，而不是恢复应用壳层。
