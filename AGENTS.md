# Codex 仓库约定

## 仓库定位

- 当前仓库的主体定位仍然是给 `Claude Code` / `Codex` 直接消费的 **skill pack**。
- 仓库默认不以传统 `bun start` / Web 平台 / 多壳层运行时为主；但当前**保留** `apps/console/` 作为基于 Claude Agent SDK 的交互控制台。
- 除非用户明确要求扩展应用层，否则默认不要再新增额外的 `src/`、`tests/`、`web/`、E2B、OpenViking 一类壳层或平行 runtime。

## Skills 适配

- 本仓库给 `Codex` 使用的 repo-local skills 入口是 `.agents/skills/`。
- `.agents/skills/` 只是 `Codex` 发现 skill 的适配层，不是事实源。
- skills 的唯一事实源是 `.claude/skills/`。
- 如果需要修改或新增 skill，请编辑 `.claude/skills/<skill-name>/`，不要直接改 `.agents/skills/` 下的内容。
- 不要复制出第二份 skill 目录；优先保持 `.agents/skills` 指向 `.claude/skills` 的单一映射。

## Skill 使用规则

- 当任务明显匹配某个 skill 时，优先通过 `.agents/skills/` 暴露给 `Codex` 的 skill 执行，而不是临时拼接一次性流程。
- 除非用户明确要求，否则只使用本仓库暴露的 project skills，不依赖 user-level skills 作为仓库能力的一部分。
- skill 正文应尽量保持平台中性：
  - 文档内引用 skill 内文件时，直接使用 skill 目录内相对路径，如 `references/...`、`assets/...`、`scripts/...`
  - 命令示例统一使用仓库根相对路径，如 `python3 ./.claude/skills/<skill-name>/scripts/...`
  - 不再在文档层引入新的环境变量路径抽象
  - 使用 `subagent`、`ask the user` 这类中性表达

## 仓库操作

- Python 工作流优先使用 `uv`；若现有脚本明确依赖 `python3` 直接执行，则保持最小侵入式修改。
- 只有在仓库重新承担运行时职责时，才考虑恢复 Bun / TypeScript 工程骨架。
- 修改 skill 适配层后，至少验证：
  - `.agents/skills` 存在且指向 `.claude/skills`
  - `Codex` 可从 `.agents/skills/` 看到对应 skill 目录
