# Dialogue Rules & Word Limits

## Dialogue Shot Rules

### Dialogue Cut (Important)

When dialogue exceeds **10 characters**, **camera cuts are mandatory** — never use a single static shot for an entire dialogue segment:

- Use explicit cut markers: "切至", "镜头切换到"
- **Multi-person dialogue**: Use over-the-shoulder shot-reverse-shot alternation
- **Monologue/long lines**: Use push/pull to create shot-size variation (e.g. medium shot slowly pushing to close-up)

Example:
```
中景，{act_001}面对{act_002}开口说话。切至近景，{act_001}表情凝重。切至过肩镜头，{act_002}微微点头回应。
```

### Dialogue Duration Calculation

- Every 10 characters ≈ 2 seconds
- `suggested_duration = max(base_action_duration, dialogue_duration) + 0.5s buffer`
- Base action: simple 2-3s, complex 3-4s
- Range: min 2s, max 4s
- Camera cuts should occur during dialogue, but total duration must cover the complete dialogue

### Word Trimming Priority

- **Must keep**: Shot size, camera movement, action dynamics, character position, dialogue content
- **May trim**: Lighting details, atmosphere description, background details

## Word Limits

### Total: complete_prompt <= 750 characters

Breakdown:
- Scene layout: 20-40 chars
- All shot descriptions: ~680 chars
- SFX prompt: 25 chars

### Per-shot allocation

| Shots in clip | Max chars per shot |
|---------------|-------------------|
| 1 | 500 |
| 2 | 250 |
| 3 | 160 |
| 4 | 120 |
| 5+ | 100 |

AI auto-controls word count based on shot count. Overflow triggers auto-truncation (keeps complete shots, no ellipsis).

## Prompt Structure by Model

### Kling Omni
```
[style_prefix (if any)] [scene_layout] [【lsi】as first frame. {Gemini desc} (only clip N+1, injected by batch_generate.py)] [shot_1_desc] [shot_2_desc] ... [sfx_prompt]
```

### Seedance 2 (extra stability prefix injected at start)
```
[style_prefix (if any)] 面部稳定不变形，五官清晰，全程样貌一致，无崩脸；人体结构正常，四肢自然，服装发型全程不变；动作流畅，不僵硬，无穿模，无变脸。 [scene_layout] [【lsi】as first frame. {Gemini desc}] [shot_1_desc] ... [sfx_prompt]
```

> - `_JIMENG_QUALITY_PREFIX` (stability prefix): only for seedance2, defined as module constant
> - `_STYLE_PREFIX` (style keyword prefix): injected for **all models**, placed at the very start of complete_prompt
>   - On `generate_episode_json()` startup, auto-reads actor three-view URLs from `output/actors/actors.json`
>   - Uses Gemini API to analyze images for art style, then Claude subagent generates concise keywords (e.g. `三维CG动画，古风仙侠，`)
>   - Falls back to Claude inferring style from character names if Gemini API key missing
>   - Detected once per run (module-level variable cache)
