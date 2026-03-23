# Golden Case: script-adapt Skill Optimization

> autoresearch evaluation spec for screenwriter agent

## 1. Test Case Definition

### Input

```yaml
task: novel-to-script adaptation
source: 穿书 + 修仙 + 逆后宫 题材短篇 / 大纲
target: 2 episodes (ep1 + ep2)
constraints:
  episode_duration: 60s (+-5s)
  action_points_per_episode: 17-22
  style: B (打脸逆袭) + C (甜宠撒糖) mixed
```

### Baseline Output

见本目录下 `golden-case-script-sample.md`（用户提供的第 1-2 集剧本原文）。

---

## 2. Evaluation Rubric (8 Dimensions)

> LLM Judge 逐维度打分 1-10，附必须引用原文证据。

### D1: 时长合规 (weight: 0.15)

**规则**: 单集 60s(±5s) = 17-22 个动作点。1 动作点 ≈ 3 秒。

| Score | Criteria |
|-------|----------|
| 9-10 | 每集 17-22 动作点，总时长 55-65s |
| 7-8 | 每集 15-24 动作点，偏差 ≤10s |
| 5-6 | 偏差 10-20s，部分场景过密 |
| 3-4 | 偏差 >20s，整体严重超时或不足 |
| 1-2 | 完全无视时间约束 |

**计算方法**: 统计每行 `▲` 后的 `→` 分隔的动作短语数量，求和。

### D2: 对白质量 (weight: 0.15)

**规则**: 短句 8-14 字；三句一转折；五类功能标签（事件/回忆/情绪/感情/欲望）每场≥2 类；禁止代称。

| Score | Criteria |
|-------|----------|
| 9-10 | 90%+ 对白在 8-14 字，功能标签丰富，无代称 |
| 7-8 | 70%+ 合规，偶有超标但不影响节奏 |
| 5-6 | 50% 合规，多处长句破坏节奏 |
| 3-4 | 大量 20+ 字长句，功能单一 |
| 1-2 | 对白无结构意识 |

**计算方法**: 抽取所有对白行（含 OS），统计字符数分布。

### D3: 画面可执行性 (weight: 0.15)

**规则**: 有白必有画；单行 ≤5 动作点；时空耦合（对白字数 ≤ 紧邻动作点数 × 9）。

| Score | Criteria |
|-------|----------|
| 9-10 | 100% 有白必有画，无超标行，时空耦合全部通过 |
| 7-8 | 95%+ 合规，1-2 处小超标 |
| 5-6 | 80% 合规，多处时空耦合失败 |
| 3-4 | 大量裸对白或动作点爆表 |
| 1-2 | 画面描述与对白脱节 |

### D4: 节奏控制 (weight: 0.15)

**规则**: 0 帧起手（禁止空镜/铺垫开场）；每 15s 一个转折；60s 时间轴结构（钩子-建立-升级-高潮-余韵-钉子）。

| Score | Criteria |
|-------|----------|
| 9-10 | 开场第一秒声画同步，转折密度 ≥4/集，完美的 60s 弧线 |
| 7-8 | 开场有力（3s 内进入），转折 3+/集 |
| 5-6 | 开场有短暂铺垫（5s 内进入），转折 2+/集 |
| 3-4 | 慢热开场，转折不足 |
| 1-2 | 平铺直叙无节奏感 |

### D5: 去 AI 味 (weight: 0.10)

**规则**: 禁用模板副词（不禁/竟然/缓缓/默默/渐渐）；禁用公式描写（"XX 的眼中闪过一丝 XX"）；删除空泛承诺和连续独白。

| Score | Criteria |
|-------|----------|
| 9-10 | 零禁用词，描写具体生动，每个角色语感独特 |
| 7-8 | ≤2 处禁用词，整体自然 |
| 5-6 | 3-5 处禁用词，部分公式化描写 |
| 3-4 | 频繁出现禁用模式，AI 感明显 |
| 1-2 | 通篇模板化写作 |

**检测方法**: 正则匹配禁用词表 + 重复短语统计。

### D6: 角色区分度 (weight: 0.10)

**规则**: 遮住名字能识别角色；每个角色有独特语感和行为模式。

| Score | Criteria |
|-------|----------|
| 9-10 | 所有出场角色有独特语感，行为模式与设定严格一致 |
| 7-8 | 主要角色区分明显，次要角色有基本个性 |
| 5-6 | 主角有个性，次要角色同质化 |
| 3-4 | 多数角色语感雷同 |
| 1-2 | 所有角色一个声音 |

### D7: 格式规范 (weight: 0.10)

**规则**: 场次头格式（`{ep}-{scene} {时间} {内/外} {地点}`）；人物行/道具行/状态行；六类正文行语法。

| Score | Criteria |
|-------|----------|
| 9-10 | 100% 格式合规，可直接被 parse_script.py 解析 |
| 7-8 | 95%+ 合规，1-2 处小格式偏差 |
| 5-6 | 80% 合规，需少量手动修正 |
| 3-4 | 大量格式错误，解析器会报错 |
| 1-2 | 自由格式，无法机器解析 |

### D8: 集间衔接 (weight: 0.10)

**规则**: 第 N 集结尾钉子与第 N+1 集开场钩子必须形成因果/对照/回答关系。

| Score | Criteria |
|-------|----------|
| 9-10 | 钉子→钩子因果紧密，观众有强烈追看欲 |
| 7-8 | 衔接清晰，有一定悬念 |
| 5-6 | 有衔接但力度不足 |
| 3-4 | 衔接生硬或断裂 |
| 1-2 | 集与集之间无关联 |

---

## 3. Baseline Scoring (Current Script)

| Dim | Score | Evidence |
|-----|-------|----------|
| D1 时长合规 | **3** | Ep1 = 4 scenes/90s, 场景 1-1 alone has ~47 action points for 30s slot (should be ~10). Massively over budget. |
| D2 对白质量 | **5** | Multiple lines exceed 14-char: "要命，怎么穿成了原书中的恶毒女配苏瑶...唉？我记得原书里她有六个巨帅的兽夫！"(~35 chars). Some good short lines: "没毒。你看，我自己吃。" |
| D3 画面可执行性 | **4** | Line "闪回快速切换：原身虐打云松→给凌天下毒→羞辱驰风→陷害墨羽→虐待焰霜→六人眼中的恨意" has 6 action points (limit=5). Many ▲ lines describe internal states not renderable as video. |
| D4 节奏控制 | **6** | Opening is establishing shot (violates 0-frame rule). But twist density is good (穿越→记忆→六夫→系统→灵田→凌天夜遇, ~6 twists across 90s). Loses points for non-compliant opening. |
| D5 去AI味 | **4** | Forbidden words: "缓缓走近", "微微一变", "猛地"×2, "瞳孔骤缩"×2. Panic OS pattern repetitive: "完了完了"/"要死要死要死"/"要命". |
| D6 角色区分 | **6** | 凌天(温柔+危险), 驰风(礼貌疏离), 霜(冷淡), 云松(沉默) — differentiated but thin. 苏瑶 OS lines all follow same panic template. |
| D7 格式规范 | **6** | Scene headers have non-standard `（0-30s）` timing suffix. Uses `▲【叙事】`/`▲【演绎】` tags not in format spec (spec says plain `▲description`). Core structure is correct. |
| D8 集间衔接 | **8** | Ep1 ends: 凌天 approaches with veiled threat. Ep2 opens: 凌天 blocks kitchen door, directly continuing confrontation. Clean causal link. |

### Weighted Total

```
D1: 3 × 0.15 = 0.45
D2: 5 × 0.15 = 0.75
D3: 4 × 0.15 = 0.60
D4: 6 × 0.15 = 0.90
D5: 4 × 0.10 = 0.40
D6: 6 × 0.10 = 0.60
D7: 6 × 0.10 = 0.60
D8: 8 × 0.10 = 0.80
─────────────────────
Baseline Score: 5.10 / 10
```

### Top 3 Improvement Priorities

1. **D1 时长合规 (3/10)** — 最严重。SKILL.md 需要强化动作点计数与时长核查的执行力度。当前 skill 有规则但 agent 未严格执行。
2. **D5 去AI味 (4/10)** — SKILL.md 的禁用词检查清单存在但缺乏强制执行机制。建议在 SKILL.md 中加入写作后强制 self-check 步骤。
3. **D3 画面可执行性 (4/10)** — 大量心理描写和内部状态描述无法转化为视频画面。SKILL.md 需强调"每行 ▲ 必须是摄像机能拍到的内容"。

---

## 4. Judge Prompt Template

> 直接喂给 LLM-as-Judge 使用。

```markdown
You are a professional script quality evaluator for short-form animated drama.

## Task
Evaluate the following script against 8 quality dimensions. For each dimension:
1. Give a score from 1-10
2. Cite specific lines from the script as evidence
3. List concrete issues found

## Rules Reference (abbreviated)
- Episode duration: 60s (±5s) = 17-22 action points per episode
- 1 action point ≈ 3 seconds ≈ 9 chars of dialogue capacity
- Dialogue: 8-14 chars per sentence; 3 sentences per turn
- Action lines: ≤5 action points per line, connected by →
- Opening: first second must be explosive (no establishing shots)
- Twist density: ≥1 per 15 seconds
- Forbidden words: 不禁, 竟然, 缓缓, 默默, 渐渐, XX的眼中闪过一丝XX, XX的嘴角微微上扬
- Every dialogue line must have a preceding ▲ action line (有白必有画)
- Time-space coupling: dialogue_chars ≤ adjacent_action_points × 9

## Dimensions
D1: 时长合规 (0.15) — action point count vs 17-22 target
D2: 对白质量 (0.15) — sentence length, function tags, no pronouns
D3: 画面可执行性 (0.15) — 有白必有画, ≤5 pts/line, time-space coupling
D4: 节奏控制 (0.15) — 0-frame opening, twist density, 60s arc
D5: 去AI味 (0.10) — forbidden patterns, repetition, specificity
D6: 角色区分度 (0.10) — unique voice per character
D7: 格式规范 (0.10) — scene header, 人物行, action line syntax
D8: 集间衔接 (0.10) — cliffhanger → hook continuity

## Output Format (JSON)
{
  "dimensions": {
    "D1_duration": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D2_dialogue": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D3_visual": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D4_pacing": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D5_deai": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D6_character": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D7_format": { "score": N, "evidence": ["..."], "issues": ["..."] },
    "D8_continuity": { "score": N, "evidence": ["..."], "issues": ["..."] }
  },
  "weighted_total": N,
  "top3_issues": ["...", "...", "..."],
  "improvement_suggestion": "One paragraph describing what to change in SKILL.md"
}

## Script to Evaluate
<SCRIPT>
{paste script here}
</SCRIPT>
```

---

## 5. Improver Prompt Template

> 用于 autoresearch 循环中修改 SKILL.md。

```markdown
You are optimizing a screenwriting skill (SKILL.md) for an AI agent.

## Current Score
{paste judge output JSON}

## Current SKILL.md
{paste current SKILL.md content}

## Constraints
- You may ONLY modify the SKILL.md body (markdown content after frontmatter)
- Do NOT modify: frontmatter (name, description, allowed-tools), references/, scripts/
- Maximum body length: 5000 words
- All changes must be backward-compatible with existing scripts

## Goal
Improve the weighted_total score by addressing the top3_issues.

## Strategy
For each issue:
1. Identify which section of SKILL.md is responsible
2. Propose a specific, targeted modification
3. Explain why this modification will improve the score

## Output
Return the complete modified SKILL.md (frontmatter + body).
Mark each modification with a comment: <!-- CHANGED: reason -->
```

---

## 6. Automation Loop (Pseudocode)

```python
SKILL_PATH = "agents/screenwriter/.claude/skills/script-adapt/SKILL.md"
TEST_CASES = ["golden-case-script-sample.md"]  # expand to 2-3
MAX_ROUNDS = 10
ACCEPT_THRESHOLD = 0.3  # minimum improvement to accept

best_score = 5.10  # baseline
history = []

for round in range(MAX_ROUNDS):
    # 1. Improve SKILL.md
    new_skill = llm_improve(
        current_skill=read(SKILL_PATH),
        judge_output=history[-1] if history else baseline_scoring,
        template=IMPROVER_PROMPT
    )

    # 2. Run skill on test cases
    for case in TEST_CASES:
        output = run_agent("screenwriter", skill="script-adapt", input=case)

    # 3. Judge output
    scores = llm_judge(output, template=JUDGE_PROMPT)
    avg = scores["weighted_total"]

    # 4. Accept / Reject
    if avg > best_score + ACCEPT_THRESHOLD:
        write(SKILL_PATH, new_skill)
        git_commit(f"skill/script-adapt: {best_score:.1f} → {avg:.1f}")
        best_score = avg
        history.append({"round": round, "score": avg, "accepted": True})
    else:
        history.append({"round": round, "score": avg, "accepted": False})

    # 5. Early stop
    if best_score >= 8.5:
        break
```

---

## 7. Expected Optimization Trajectory

Based on issue analysis, expected improvement order:

| Round | Target | Expected Δ | Mechanism |
|-------|--------|-----------|-----------|
| 1 | D1 时长 | +2.0 | Add mandatory action-point counting step before output |
| 2 | D5 去AI味 | +1.5 | Add post-write forbidden-word scan with explicit rewrite |
| 3 | D3 画面 | +1.5 | Enforce "camera-visible only" rule for ▲ lines |
| 4 | D2 对白 | +1.0 | Add char-count validator per dialogue line |
| 5 | D4 节奏 | +0.5 | Strengthen 0-frame opening constraint |

Projected trajectory: 5.1 → 6.5 → 7.2 → 7.8 → 8.2 → 8.5
