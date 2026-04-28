# Ark Seedance Video Generation `duration` Parameter — Source-of-Truth Spec

**Date:** 2026-04-28
**Trigger:** 用户质疑"Ark Seedance 只接受 {5,10}"的论断是否有依据。本文档查阅官方与多个第三方来源核对 `duration` 参数真实规格，并修正先前的错误判断。

## TL;DR

- **Seedance 2.0** 的 `duration` 是 **整数，区间 `[4, 15]` 秒，默认 5**。任何在该区间内的整数都合法，**不是 `{5, 10}` 枚举**。
- 项目当前 `active_model = seedance2`（见 `video-gen/assets/config.json`），契约层 `_shared/storyboard_contract.py` 的 `[4,15]` 范围与提供商能力**一致**。
- 因此 5ep-duchess ep001 视频"没有按预期生成 15s"的根因 **不在提供商能力层**，而在 storyboard 阶段 LLM 把 `duration` 字段全部填成下限 4 —— provider 严格按请求生成 4s 视频，行为正确。
- 此前文档/讨论中"Ark Seedance 只接受 {5,10}"的说法 **错误**，应作废。

## Authoritative Findings

### Seedance 2.0 (`seedance-2-0-pro`)

| Field | Value | Source |
|-------|-------|--------|
| Type | Integer | apidog API guide; nxcode reference table |
| Range | `4 – 15` (秒) | 多源一致 |
| Default | `5` | apidog 引用文档原文 |
| Per-call cost | 与 duration 线性相关 | apidog |

**Verbatim quote (apidog, 2026-04-28 fetch):**
> "duration accepts integers from 4 to 15. The unit is seconds. The default is 5. Longer videos cost proportionally more."

**Code sample (nxcode, Python):**
```python
result = generate_video(
    prompt="A drone shot flying over a coastal city...",
    resolution="1080p",
    duration=8,           # 任意 [4,15] 整数皆合法
    aspect_ratio="16:9",
)
```

### 旧版豆包/Seedance 1.x（仅作对照，项目未使用）

| Model | Duration Range | Source |
|-------|----------------|--------|
| 豆包视频生成 (api-doc.vncps.com 镜像) | `2 – 12` 秒 | vncps mirror docs |
| Seedance 1.5 Pro | `1 – 10` 秒 | NxCode comparison |
| Seedance 1.0 Pro | `2 – 12` 秒 (中文搜索结果) | volcengine 中文站索引 |

不同代际能力不同，所以"提供商能力"不是单一常量，而是 `(model_code → capability)` 映射。

## What This Means For The Project

### 关于"为什么没有生成 15s"

修正后的根因链：

1. **storyboard LLM** 把 5ep-duchess ep001 全部 20 个 shots 的 `duration` 填成 `4`（契约下限）。
2. `_shared/storyboard_contract.validate_shot` 接受 `4`（合法）。
3. `video-gen/scripts/batch_generate.py:126` 取 `shot["duration"] → duration_seconds = 4`。
4. `video_api.submit_video(duration=4)` → Ark Seedance 2.0 严格按 4s 渲染。
5. 用户看到 4s 视频，认为"没有生成 15s"。

**provider 行为完全正确**。问题位于 storyboard schema 的正交分解失败：
- `prompt` 文本里的 `[0-3] / [3-6] / ... / [12-15]` 多拍时间戳是创意层装饰
- `duration` 字段是技术请求
- 两者在 schema 层无任何关联，LLM 可独立填写矛盾值

### 该修正/作废的论断

| 错误论断 | 正确事实 | 影响范围 |
|----------|----------|----------|
| "Ark Seedance 只接受 5/10 这两个枚举值" | 接受 `[4,15]` 任意整数 | 之前讨论的 P1 不成立 |
| "duration=15 会被 Ark 服务端归一化或拒绝" | 15 是合法上限，会按 15s 生成 | 不需要在适配层加 `min(duration, 10)` |
| "需要在 _shared 里加 provider_capability 收紧上界" | Seedance 2.0 上界恰好就是 15，与契约 `[4,15]` 一致 | 当前重构不必为此动手 |

**仍然成立的论断**：
- `_parse_duration_seconds` 静默兜底到 `6` 是坏味道（违反"不要过多 try-catch"）—— 应改为 fail-fast
- `submit_video(duration: str = "5")` 用字符串类型暧昧，apidog/nxcode 均显示 Ark 接受 int；应改为 `int`
- system prompt 里"不要全部填 5"是补丁式规则，被 LLM 用全填 4 绕过 —— 该规则需要重新设计

## Recommended Actions（按半衰期）

### 长半衰期：消除字段间无约束

**核心**：让 `duration` 与 prompt 内多拍语义在 schema 层挂钩，而不是用自然语言警告补丁。

候选方案 A — 拆 beats 为结构化字段：
```jsonc
{
  "id": "scn_001_clip001",
  "duration": 15,
  "beats": [
    {"start": 0,  "end": 3,  "desc": "..."},
    {"start": 3,  "end": 6,  "desc": "..."},
    {"start": 12, "end": 15, "desc": "..."}
  ],
  "prompt": "..."  // 由 beats + 描述模板拼出
}
```
契约校验：`sum(b.end - b.start for b in beats) == duration`。LLM 不可能再写出矛盾值。

候选方案 B — 让 LLM 不写时间戳：
- system prompt 改为"不要在 prompt 内写 [0-3] / 0:00-0:03 这类时间戳，节奏交给视频模型自动安排"
- 配套地把 duration 决策移到一个独立 LLM 调用，输入 = beat 数 + 戏剧节奏建议

A 长半衰期更高但实现成本大；B 是较轻的纠偏。

### 短半衰期：立即清理

1. `video_api.py:37-41` `_parse_duration_seconds` 删掉 `return 6` 兜底，改为 `raise ValueError`
2. `video_api.py:205, 242` `duration: str = "5"` → `duration: int = 5`，与契约一致
3. `storyboard_batch.py:304-310` system prompt 删除"不要全部填 5"句，改成更结构化的 duration 约束（取决于上面候选方案选 A 还是 B）

## Sources

- **apidog API guide (Seedance 2.0)** — verbatim duration spec: "integers from 4 to 15, default 5"
  https://apidog.com/blog/seedance-2-0-api/
- **NxCode reference (Seedance 2.0 pricing & setup)** — code samples confirming int range 4-15
  https://www.nxcode.io/resources/news/seedance-2-0-api-guide-pricing-setup-2026
- **api-doc.vncps.com** (豆包视频 / 旧版) — 2-12s 范围（项目未使用）
  https://api-doc.vncps.com/api-reference/video-generation
- **Volcengine 中文文档（视频生成 API 入口）** — 页面动态渲染，正文未抓取成功，仅作链接索引
  https://www.volcengine.com/docs/82379/1366799
  https://www.volcengine.com/docs/82379/1520757
- **BytePlus 英文文档（同一份 API 的英文镜像）** — 同样动态渲染
  https://docs.byteplus.com/en/docs/ModelArk/1520757

## Verification Note

本文档基于第三方文档与博客交叉核对。火山引擎/BytePlus 官方页面是 SPA 渲染，`WebFetch` 拿不到正文。**建议在动手任何 duration 相关改动前，由 zjding 直接登录 ark 控制台或 API 调试页，对当前活跃 endpoint (`ep-20260303234827-tfnzm`) 做一次 `duration=15` 的真实请求验证**，把返回时长记录到本文末尾作为最终事实源。

[ ] TODO: 用 `duration=15` 实测一次 Seedance 2.0，把实际返回视频秒数补充到这里。
