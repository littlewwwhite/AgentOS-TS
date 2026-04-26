# CLI 稳定边界与核心 Skills 迁移计划

## 根本目标

把模型调用从 skills 中剥离出来，形成一个稳定、可复用、低耦合的 CLI 基础层，让业务 skills 不再关心 provider 鉴权、HTTP 接口、错误归一化和模型差异。

第一阶段不追求完整服务评价平台。第一阶段只追求一件事：

> 证明 `aos-cli` 可以作为稳定模型调用边界，被一个真实 core skill 以最小改动接入。

## 真实约束

1. `aos-cli` 现在是本地 on-demand CLI，不是后台 daemon。
2. skills 的事实源仍然是 `.claude/skills/`。
3. skills 是给 Claude Code / Codex 这类 agent 消费的业务工作流，不应被 CLI runtime 反向污染。
4. provider 调用需要统一，但 prompt、阶段、artifact 命名、`pipeline-state.json` 不应进入 CLI。
5. 过早引入完整 `eval` 平台会增加偶然复杂度，不能直接解决当前最紧迫的解耦问题。

## 修正后的判断

上一版“先做完整评价体系”的方向过重。它适合作为 CLI 成熟后的质量体系，不适合作为第一阶段。

第一阶段最小正确解应该是：

1. 固化 CLI 调用边界。
2. 提供一个 repo-level skill adapter，隐藏 `uv run --project` 等运行细节。
3. 选择一个最低风险 core skill 做纵向迁移。
4. 用 fake E2E + 一个真实 provider smoke 证明边界可用。
5. 再决定是否需要更完整的 `aos-cli model eval`。

## 稳定边界

| 层 | 应该拥有 | 不应该拥有 |
| --- | --- | --- |
| `aos-cli` | provider adapter、request/response envelope、error code、`.env` 加载、preflight、artifact descriptor | storyboard、asset、episode、shot、pipeline stage、skill 激活规则 |
| shared adapter | 解析 repo-local CLI 路径、调用 `aos-cli model ...`、统一 exit code 处理 | provider 逻辑、业务 prompt、状态修改 |
| core skills | 业务 prompt、输入输出文件、阶段流转、artifact 命名、review policy | provider HTTP、key/base url、模型错误归一化 |

## Phase 1: 固化 CLI 最小可用边界

目的：确认 CLI 本身作为模型调用边界是稳定的，不先做重型评价系统。

修改范围：

- `aos-cli/README.md`
- `aos-cli/docs/MODEL_PROTOCOL.md`
- `aos-cli/src/aos_cli/env.py`
- `aos-cli/src/aos_cli/cli.py`
- `aos-cli/tests/test_env.py`

验收标准：

- CLI 自动加载 root `.env` 与 `aos-cli/.env`，且优先级明确。
- `uv run --project aos-cli aos-cli model preflight --json` 可运行。
- `AOS_CLI_MODEL_FAKE=1` 下 `run`、`submit`、`poll` 可运行。
- `uv run pytest -q` 和 `uv run ruff check .` 通过。

当前状态：

- 这一步基本已完成。
- 不需要在此阶段新增 `aos-cli model eval`。

## Phase 2: 增加 shared skill adapter

目的：让业务 skills 不直接感知 CLI 的安装方式和 `uv --project` 细节。

新增文件：

- `.claude/skills/_shared/aos_cli_model.py`

提供函数：

```python
aos_cli_model_run(request_path, response_path)
aos_cli_model_submit(request_path, task_path)
aos_cli_model_poll(task_path, result_path)
```

实现规则：

1. 如果 PATH 中存在 `aos-cli`，优先用全局 `aos-cli`。
2. 否则从当前 repo root 找 `aos-cli/pyproject.toml`。
3. fallback 到 `uv run --project "$repo_root/aos-cli" aos-cli ...`。
4. 保留 CLI 原始 exit code。
5. 不解析业务 response，不修改业务文件。

验收标准：

- 从 repo root 调用通过。
- 从任意 skill 子目录调用通过。
- fake 模式下 text run 通过。
- fake 模式下 video submit/poll 通过。

## Phase 3: 迁移 Storyboard 文本生成

目的：用最低风险的 core skill 证明“skill -> adapter -> CLI -> provider”的纵向链路。

修改范围：

- `.claude/skills/storyboard/`

允许修改：

- provider 调用点改为 `aos_cli_model_run`。
- provider readiness 检查改为调用 CLI preflight 或 adapter smoke。
- 增加 fake-mode smoke test。

禁止修改：

- 不改 prompt 语义。
- 不改 skill 触发规则。
- 不改分镜业务阶段。
- 不把 storyboard 概念放进 CLI。

验收标准：

- fake 模式下 storyboard 生成链路通过。
- 真实 Gemini 最小调用通过。
- 输出结构与迁移前一致。
- 如果 CLI 调用失败，错误 envelope 能被 skill 侧清晰暴露。

## Phase 4: 迁移 Video-gen Ark 调用

目的：把 Ark provider 生命周期从 skill 中剥离到 CLI。

修改范围：

- `.claude/skills/video-gen/`

允许修改：

- Ark direct submit 改为 `aos_cli_model_submit`。
- Ark poll 改为 `aos_cli_model_poll`。
- 保存 CLI task envelope 作为 runtime artifact。

禁止修改：

- 不改 approved storyboard contract。
- 不改 episode / shot 业务语义。
- 不让 CLI 管 `pipeline-state.json`。

验收标准：

- fake submit/poll 通过。
- 真实 Ark submit 返回 task id。
- poll 失败、未完成、超时时，skill 状态可恢复。

## Phase 5: 迁移 Asset-gen 图片调用

目的：把图片 provider 防腐层从 asset-gen 中移出。

修改范围：

- `.claude/skills/asset-gen/`

允许修改：

- 图片 provider 调用改为 `aos_cli_model_run` + `image.generate`。
- 保留 prompt generation、review、gallery、命名策略。

需要单独判断：

- 图片下载与落盘由 CLI 负责，还是 asset-gen 负责。
- 这个判断必须基于一次真实 image artifact E2E，不提前抽象。

验收标准：

- fake image artifact descriptor 通过。
- 原 asset-gen tests 通过。
- 真实图片最小生成返回可用 artifact。

## Utility Skills 策略

本轮不主动迁移：

- `.claude/skills/music-matcher/`
- `.claude/skills/subtitle-maker/`
- `.claude/skills/video-editing/`

原因：

- 它们是完整 agent workflow skill，不只是模型 provider wrapper。
- 强行迁移会破坏它们面向 Claude Code / Codex 的自然结构。
- 如果未来要迁移其中某个 provider 调用，必须单独写小计划，只替换 provider adapter，不动 workflow 结构。

## 什么时候再做 `aos-cli model eval`

不是现在。

只有当下面任一条件成立时，再做 eval 命令：

1. 已有两个以上 core skills 接入 CLI，需要统一健康报告。
2. CI 需要机器可读的 CLI readiness gate。
3. 真实 provider E2E 开始频繁失败，需要区分配置、quota、provider、contract 问题。
4. CLI 要发布给当前 repo 之外的项目使用。

届时 `eval` 也应从最小版本开始：

```bash
aos-cli model eval --profile smoke --report /tmp/aos-cli-smoke.json
```

不要一开始就做完整评分系统。

## 当前下一步

只做 Phase 2：shared skill adapter。

具体任务：

1. 新增 `.claude/skills/_shared/aos_cli_model.py`。
2. 写一个最小 smoke 脚本或测试，验证 root 与 skill 子目录都能调用。
3. 用 `AOS_CLI_MODEL_FAKE=1` 跑 text run。
4. 用 `AOS_CLI_MODEL_FAKE=1` 跑 video submit/poll。
5. 不修改任何业务 skill。

Phase 2 通过后，再开始 Phase 3 的 storyboard 迁移。
