# 第二阶段：循环剪辑引擎 — 需求规格

> 这是给实现 agent 的业务逻辑描述。不是最终代码，是你要理解的"做什么"和"为什么"。

---

## 上下文

第一阶段（`scripts/analyze_video.py`）已经完成。它对每个 clip 目录下的所有变体做了 Gemini 多模态分析，输出了结构化的 `analysis.json`。

每个 analysis.json 包含：
- `shots[]`：逐 shot 逐变体的分析数据（camera、quality_score、quality_issues、continuity_to_next、script_match）
- `clip_comparison.recommended_assembly`：Gemini 推荐的最佳组装方案（哪个 shot 用哪个变体、转场方式）
- `clip_comparison.per_shot_best`：每个 shot 的最佳变体和分数
- `clip_comparison.mix_warnings`：混剪风险提示

输出目录结构：
```
output/
  ep001/
    scn001/clip001/analysis.json
    scn002/clip001/analysis.json
    scn003/clip001/analysis.json
    scn004/clip001/analysis.json
    ep001_analysis_index.json      # ep 级索引
```

**现在要做的是：读取这些分析数据，组装最佳序列，然后通过 gemini 分析并检测问题，替换修补，循环直到满意，最终输出 XML 时间线。**

---

## 核心流程

```
加载所有 clip 的 analysis.json
  ↓
对每个 scn，按 clip 顺序：
  取 recommended_assembly 作为初始方案
    ↓
  Gemini 看完整序列 + 剧本 → 整体评分 + 发现问题
    ↓
  有问题？
    是 → 从标签库搜索替代 shot → 替换 → 回到 Gemini 重新评估
    否 → 结束循环
    ↓
  循环终止条件：整体分 ≥ 阈值 OR 达到最大轮次
    ↓
输出最终方案（以 scn 为单位） → 生成 XML
```

---

## 详细描述

### 1. 加载阶段

读取 `output/ep{NNN}/` 下所有 `analysis.json`，构建一个内存数据结构（我称之为"视频素材的标签库"），支持按 shot 特征搜索。

标签库的用途：当循环中发现某个 shot 有问题（比如 quality_score 太低、script_match 不符），需要从**同一 clip 的其他变体**中找一个更好的 shot 来替换。这个搜索应该是纯代码操作（遍历 analysis.json 里的 per_variant 数据），不需要调 Gemini。

### 2. 初始方案组装

对每个 scn，按 clip 顺序，取每个 clip 的 `clip_comparison.recommended_assembly.plan` 作为初始剪辑方案。

方案是一个有序列表：
```json
[
  { "shot": "shot_1", "use": "v1", "source_file": "ep001_scn001_clip001.mp4", "in": 0.0, "out": 5.708 },
  { "shot": "shot_2", "use": "v1", "source_file": "...", "in": 5.708, "out": 10.25 },
  { "shot": "shot_3", "use": "v3", "source_file": "...", "in": 10.25, "out": 15.042 }
]
```

如果一个 scn 有多个 clip（clip001 → clip002 → clip003），它们的 plan 按顺序拼接成一个完整的 scn 级方案。

### 3. 循环分析

把当前方案对应的视频序列（可能是多个视频的不同片段）和剧本一起发送给 Gemini，做一次整体评估。

**第一轮**：如果 `recommended_assembly.strategy == "single"`（单一变体最优），直接发送那个完整视频即可。如果是 "mixed"（混剪），需要按方案顺序发送多段视频片段。

Gemini 在这一轮需要回答：
- 整体综合分（1-10）
- 逐 shot 是否有问题（quality、continuity、script_match）
- 需要修补的 shot 列表及原因

**后续轮**：替换了 shot 之后，再发一次让 Gemini 重新评估。

### 4. 替换逻辑

当 Gemini 指出某个 shot 有问题：

1. 在标签库中查找同一 clip 的其他变体的对应 shot
2. 按 quality_score 排序，选分最高且不是当前正在使用的那个
3. 替换方案中的对应条目
4. 一次只替换一个 shot（避免多处同时变化导致难以判断效果）

### 5. 回退机制

每轮循环前保存当前方案的快照（方案 JSON + 综合分）。

替换后如果新的综合分 **低于** 替换前的综合分 → 回退到上一轮的方案，并标记该 shot 为"已尝试替换，无改善"。

### 6. 终止条件

满足以下任一条件时停止循环：
- 综合分 ≥ 配置的阈值（如 7.5，可在 default.env 中配置）
- 达到最大循环轮次（如 3，可配置）
- 所有问题 shot 都已尝试替换且无改善

### 7. 失败处理

如果循环结束时仍有未解决的问题：
- 不阻塞流程，继续输出
- 在输出中标记这些 shot 为 `"status": "unresolved"`，附带问题描述
- 后续 XML 生成时在对应位置加入 marker（标记人工待处理）

### 8. 输出

每个 scn 输出一份剪辑决策文件（如 `output/ep001/scn001/edit_decision.json`）：

```json
{
  "scn": "scn001",
  "ep": "ep001",
  "final_score": 8.2,
  "iterations": 2,
  "plan": [
    {
      "shot": "shot_1",
      "source_file": "ep001_scn001_clip001.mp4",
      "variant": "v1",
      "in": 0.0,
      "out": 5.708,
      "transition": "cut",
      "status": "ok"
    },
    {
      "shot": "shot_3",
      "source_file": "ep001_scn001_clip001_003.mp4",
      "variant": "v3",
      "in": 10.25,
      "out": 15.042,
      "transition": "cut",
      "status": "unresolved",
      "issue": "v3 出现血迹元素，与整体设定不确定是否一致"
    }
  ],
  "iteration_log": [
    { "round": 1, "score": 7.5, "actions": ["初始方案"] },
    { "round": 2, "score": 8.2, "actions": ["替换 shot_2: v1→v2"] }
  ]
}
```

---

## 并行策略

- **scn 之间无依赖**，可以并行循环（并发数由 `--concurrency` 参数或 `CONCURRENCY` 环境变量控制）
- **同一 scn 内的 clip 之间有衔接依赖**，必须按顺序处理（clip001 的最终方案确定后，才处理 clip002）
- 当前数据中每个 scn 只有 1 个 clip，所以实际上所有 scn 可以完全并行

---

## 配置项

这些参数应该可以在 `default.env` 中配置：

```env
# ═══════════════ 第二阶段：循环引擎 ═══════════════
# 综合分阈值（达到即停止循环）
LOOP_SCORE_THRESHOLD=7.5
# 最大循环轮次
LOOP_MAX_ITERATIONS=3
# scn 并发处理数（0=不限制）
CONCURRENCY=4
# 循环分析用的 Gemini 模型（可以和第一阶段不同）
LOOP_GEMINI_MODEL=gemini-3.1-flash-preview
```

---

## 不需要做的事

- 不需要重新做切镜检测（第一阶段已完成）
- 不需要重新上传 clip 视频到 Gemini（循环分析时上传的是拼接的 scn 单位的视频，）
- 不需要生成 Excel/TXT 报告
- 不需要做物理状态盲测、表情盲测（第一阶段的数据已足够）
- 不需要修改第一阶段的代码

---

## 文件结构建议

```
scripts/
  analyze_video.py          # 第一阶段（已完成）
  assemble_sequence.py      # 第二阶段：循环引擎（新建）

assets/
  default.env               # 配置（追加循环参数）
  phase1_clip_scoring.py    # 第一阶段 prompt（已完成）
  phase2_loop_analysis.py   # 第二阶段 prompt（新建）
```

---

## phase2 prompt 设计指导

### 旧 pipeline 18 个 prompt 的归属分析

旧 pipeline 有 18 个 prompt 文件（共 1485 行），分别服务于 14 步串行流程。在新架构中：

| 归属 | prompt 文件 | 说明 |
|------|------------|------|
| **已被 phase1 替代** | video-scoring.txt, plot-analysis.txt, blind-expression.txt, blind-physical-state.txt, supplement-blind.txt, script-mapping.txt | phase1 已覆盖 |
| **→ 合入 phase2 循环 prompt** | editing-continuity.txt, connection-analysis.txt, state-regression-check.txt | 核心判断能力需保留 |
| **→ 纯代码替代** | supplement-match.txt, bridge-select.txt | 标签库搜索替代 Gemini |
| **→ 循环天然覆盖** | score-validation.txt, critical-issue-validation.txt, supplement-result-validation.txt | 循环中 Gemini 重新评估时自然验证 |
| **保留概念** | bridge-fallback.txt | 无合适替代时的兜底描述 |
| **暂缓** | audio-duplicate.txt, bridge-candidate-eval.txt | 后续按需加入 |

### phase2 循环 prompt 需要覆盖的 3 个核心判断能力

**不要把旧 prompt 搬过去。** 旧 prompt 是为 14 步串行设计的，新 prompt 是一次综合评估。需要写一个全新的 prompt，浓缩以下能力：

#### 1. 剪辑逻辑检测（来自 editing-continuity.txt 的精华）

- **重复镜头**：相邻 shot 是否画面高度相似（尤其混剪时，不同变体可能有相似内容）
- **逻辑断裂**：前一个 shot 人物在做 A 动作，下一个 shot 突然在做完全无关的 B 动作
- **状态回溯**：不可逆事件（人倒地、物品破碎）在后续 shot 中状态莫名恢复
- **时空跳跃**：场景/光线/时间突然变化但没有合理转场

#### 2. 衔接连贯性（来自 connection-analysis.txt 的精华）

- **人物位置**：shot A 结尾人物在左边，shot B 开头是否还在左边
- **动作连续**：shot A 结尾人物在走，shot B 开头是否还在走（而不是突然站定）
- **光线/色调**：前后 shot 的光线方向和色温是否一致（混剪时尤其重要）
- **运镜逻辑**：前 shot 推镜头，后 shot 是否视觉上接得上

#### 3. 状态回溯（来自 state-regression-check.txt 的概念）

- 识别"不可逆事件"：倒地、昏迷、死亡、破碎、拆除、打开
- 检查后续 shot 中状态是否回溯

### prompt 输出格式建议

```json
{
  "overall_score": 7.5,
  "summary": "整体概述（30-50字）",
  "issues": [
    {
      "shot_id": 3,
      "type": "state_regression",
      "severity": "high",
      "description": "shot 2 中墙壁已拆开，但 shot 3 中墙壁又完好",
      "suggestion": "替换 shot 3 或在 shot 2-3 之间添加转场"
    },
    {
      "shot_id": 2,
      "type": "continuity",
      "severity": "medium",
      "description": "shot 1 结尾人物面朝左，shot 2 开头人物面朝右",
      "suggestion": "从其他变体找面朝一致的 shot 2"
    }
  ],
  "shot_scores": [
    { "shot_id": 1, "score": 8, "notes": "无问题" },
    { "shot_id": 2, "score": 6, "notes": "衔接方向不一致" },
    { "shot_id": 3, "score": 4, "notes": "状态回溯" }
  ]
}
```

### prompt 设计注意事项

1. **必须基于视频实际画面评判**，不要因为剧本写了什么就假设视频也做到了
2. **混剪序列要特别关注变体间的视觉一致性**（角色外观、光线色调、场景细节）
3. **问题要给出可操作的 suggestion**，方便代码层面决定"用哪个变体的哪个 shot 替换"
4. **severity 分级明确**：high = 必须修复（逻辑错误/状态回溯），medium = 建议修复（衔接不流畅），low = 可忽略（微小瑕疵）
