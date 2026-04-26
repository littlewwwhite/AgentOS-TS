# CLI 拆分后的下一步计划（2026-04-24）

## 背景判断

你已经完成 CLI 拆分，当前仓库应继续收敛为 **skill pack 内容仓库**：

- 保持 `.claude/skills/` 作为唯一事实源。
- 保持 `.agents/skills` 仅为 Codex 发现入口映射。
- 不回滚到运行时平台职责（CLI/Web/Server/orchestrator）。

> 目标：把“拆分完成”推进到“可持续维护、可验证、可交付”的稳定状态。

---

## 阶段化执行计划

## Phase 1（P0，本周）

### 1. 文档可移植性修复

**动作**
- 将 README 中本机绝对路径（`/Users/...`）改为仓库相对路径。
- 统一 skill 文档中的命令示例为仓库根相对路径。

**验收标准**
- 在任意机器 clone 后，README 链接无需改动即可读通。
- 新增/修改的 `SKILL.md` 不再出现个人机器绝对路径。

### 2. 入口一致性守护

**动作**
- 增加轻量脚本（如 `scripts/check-skill-entry.sh`），检查：
  - `.agents/skills` 存在；
  - `.agents/skills` 是 symlink；
  - 指向 `../.claude/skills`；
  - `.claude/skills/*/SKILL.md` 至少一一可见。

**验收标准**
- 本地执行脚本返回 0 才允许合并。
- 失败时给出明确修复建议。

### 3. 最小 CI（仅文档与结构）

**动作**
- 配置最小化 CI（例如 GitHub Actions）：
  - Markdown lint（仅 docs + SKILL.md）；
  - 入口一致性脚本；
  - 禁止新增 `src/`、`web/`、`server/`、`tests/`（除非显式豁免）。

**验收标准**
- PR 至少有 1 条自动检查，且能拦截结构回退。

---

## Phase 2（P1，下周）

### 4. Skill 清单契约化

**动作**
- 新增 `docs/skill-catalog.md`，每个 skill 固定字段：
  - 触发语义
  - 输入工件
  - 输出工件
  - 外部依赖
  - 失败恢复方式
- 与 `docs/pipeline-state-contract.md` / `docs/inspiration-contract.md` 建立交叉引用。

**验收标准**
- 新同学只看 1 份文档就能理解“从 Stage 0 到 Stage 7 的可执行入口”。

### 5. Pipeline 状态一致性检查

**动作**
- 增加 `pipeline-state` 校验脚本：
  - stage key 合法性；
  - status 值合法性；
  - artifact 路径可达性（可选 warn）；
  - `current_stage` 与各 stage 状态不冲突。

**验收标准**
- 对示例文件和真实项目状态都能给出可读报告。

---

## Phase 3（P2，2~4 周）

### 6. Cross-skill 规范收敛

**动作**
- 统一 9 个 skill 的基础模板（不改业务逻辑，只改结构一致性）：
  - `SKILL.md` 元数据字段最小集合（name/description/version）
  - 前置检查段落格式
  - 输出工件声明格式
  - 故障排查段落格式

**验收标准**
- 任一 skill 的阅读体验一致，减少维护认知切换。

### 7. 依赖与密钥治理

**动作**
- 整理统一依赖矩阵（Gemini/AWB/ffmpeg/MCP）与最小安装命令。
- 将“必需 env / 可选 env / 默认值来源”写入单页文档。

**验收标准**
- 新环境首跑失败率下降（可用 checklist 自测）。

---

## 建议里程碑（可直接排期）

- **M1（+3 天）**：README 去绝对路径 + 入口一致性脚本落地。
- **M2（+7 天）**：最小 CI + skill-catalog 初版。
- **M3（+14 天）**：pipeline-state 校验脚本 + 文档互链完成。
- **M4（+28 天）**：9 个 skill 结构模板收敛 + 依赖治理文档完成。

---

## 风险与回避

1. **拆分后反向耦合回流**
   - 回避：CI 增加目录级守卫，防止 runtime 代码回流。
2. **文档更新不一致**
   - 回避：每次改 `SKILL.md` 必须同步 `skill-catalog`（可用 checklist）。
3. **环境依赖导致“看起来可用，实际不可跑”**
   - 回避：为每个关键 skill 保留 1 条可复制的 preflight 命令。

---

## 一句话结论

CLI 已拆分是正确方向；下一步重点不是“再加功能”，而是把 skill 仓库做到 **结构稳定、约束自动化、上手可复制**。
