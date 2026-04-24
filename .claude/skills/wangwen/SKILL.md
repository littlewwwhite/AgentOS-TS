---
name: wangwen
description: PAUSED。网文大数据 MCP 市场调研能力当前不作为默认项目入口；除非用户明确要求恢复/调用 wangwen，否则不要触发。本项目当前从完整小说、剧本或结构化源文档进入 SCRIPT。
version: "0.2.0"
author: "official"
metadata:
  pattern: mcp-backed-research
  mcp_server: "wangwen (HTTP, 网文大数据 v1.26.0)"
  language_support: "zh"
---

# Wangwen — 网文大数据驱动的灵感调研 skill

> 当前状态：暂停。`wangwen` 保留为历史/可选能力，但不参与当前 MVP 主流程、不自动生成 `output/inspiration.json`，也不作为 `pipeline-state.json` 的默认起点。当前业务起点是完整小说、剧本或结构化源文档，直接进入 `SCRIPT`。

本 skill 是 MCP `query_sql` 工具的**使用经验封装层**：把灵感调研的常见问题意图翻译为"读哪个 resource → 跑什么风格的 SQL → 结果如何归纳进 inspiration.json"。

单一事实源原则——skill 不复读上位/同位文档，重复即漂移：

| 需要什么 | 去哪里查 |
|---------|---------|
| `inspiration.json` schema / 填充规则 / 自检清单 / 反模式 | `docs/inspiration-contract.md` |
| 意图 → 业务域 → 表 → 思路 | `references/playbook.md` |
| 实测空字段 / 覆盖率红线 / MCP 后端行为异常 | `references/pitfalls.md` |
| 字段定义 / 官方 SQL 模板 | `resource://table-map` + `resource://domain-*`（每次现读） |

## MCP 真实表面

MCP 服务器注册在仓库根 `.mcp.json`（URL 和 API Key 由 `MCP_WANGWEN_URL` / `MCP_WANGWEN_API_KEY` env 变量注入）。

**网文大数据 MCP Server v1.26.0** 对外暴露：

- **仅 1 个 tool**：`query_sql(sql, limit=100)` — 只读 SQL，服务端自动注入 LIMIT
- **4 个 resource**（schema 文档，使用前必读）：
  - `resource://table-map` — 11 张表的业务域路由总览
  - `resource://domain-anime` — 抖音漫剧 5 张表 + 8 条官方 SQL 模板
  - `resource://domain-novel` — 番茄小说 4 张表 + 7 条官方 SQL 模板
  - `resource://domain-video` — 红果短剧+漫剧 2 张表 + 6 条官方 SQL 模板
- 0 个 prompt

**使用模式**：先读 resource 拿 schema+模板 → 用 `query_sql` 执行。**不要凭记忆拼 SQL**，字段名/分区键/类型细节现读最准。

---

## 工作流（6 步，顺序不可跳）

1. **意图澄清**
   若用户尚未明确题材 / 受众 / 核心钩子 / 期望对标样式，就先用一条简洁问题确认；若这些关键信息已明确给出，则直接继续。意图模糊时不得擅自开跑查询。

2. **读 `resource://table-map`**
   按意图定位业务域（抖音漫剧 / 番茄小说 / 红果短剧+漫剧 / 跨域）。

3. **读对应 `resource://domain-*`**
   拿字段定义 + 官方 SQL 模板。不要凭记忆写 SQL。

4. **用 `query_sql` 执行查询**
   - 意图 → 表 → 思路：查 `references/playbook.md`
   - 分区键 / 阈值 / 榜单陷阱 / 字段类型差异：查 `references/pitfalls.md`

5. **校验数据覆盖**
   按 `references/pitfalls.md` 的"空字段"、"样本强约束"两节逐项核。命中低覆盖字段主动告知用户并走 pitfalls 注明的降级路径，不得沉默。

6. **写 `output/inspiration.json`**
   按 `docs/inspiration-contract.md` 执行字段填充 + 自检清单。**自检任一项未通过不得写入**——回到第 4 步补查询，不得降级为"经验判断"。

---

## 触发词

- "市场调研"、"查榜单"、"找对标作品"、"改编漏斗"、"首秀动能"
- "什么题材在涨"、"爆款参考"、"深度分析某部作品"
- Pipeline Stage 0 (INSPIRATION) 阶段中任何需要数据背书的灵感问题

## 非触发条件

- 纯创意发散、无需数据验证 → 直接由 `script-writer` 的 SWS 模式从零原创
- 用户已有明确对标作品并打算直接改编 → 下游 SCRIPT 阶段（`script-adapt` 或 `script-writer`）
- 用户已提供剧本/小说原文求改编 → 下游 SCRIPT 阶段

## 产物路径

- `output/inspiration.json` — 最终产物（供下游 SCRIPT 阶段消费）
- 查询过程中的中间笔记可写入 `draft/inspiration/` 目录（可选）

## 统一状态文件

`wangwen` 是 `INSPIRATION` 阶段，必须同步维护 `pipeline-state.json`。

- 进入本 skill 时：设置 `current_stage=INSPIRATION`、`stages.INSPIRATION.status=running`
- 已完成查询与归纳但尚未通过自检时：设置 `stages.INSPIRATION.status=partial`
- `output/inspiration.json` 写出后：设置 `stages.INSPIRATION.status=completed`
- 自检全部通过后：设置 `stages.INSPIRATION.status=validated`、`next_action=enter SCRIPT`

恢复顺序：

1. 先读 `pipeline-state.json`
2. 若缺失，再检查 `output/inspiration.json`
3. 最后检查 `draft/inspiration/` 中是否已有调研笔记
