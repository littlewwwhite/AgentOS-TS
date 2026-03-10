# Quality Rules & Workflow

Merged from `complete_rules.md` and `quality_control_workflow.md`.
Authoritative thresholds per SKILL.md.

## Naming Convention

### L-level (shot-level)

| Type | Format | Example |
|------|--------|---------|
| Original L | `ep##-sc##-l##.mp4` | `ep01-sc01-l01.mp4` |
| Regenerated L | `ep##-sc##-l##-##.mp4` | `ep01-sc01-l01-02.mp4` |
| C-level (time slice) | `ep##-sc##-l##-[Lver]-c##.mp4` | `ep01-sc01-l02-02-c01.mp4` |
| C-level versioned | `ep##-sc##-l##-[Lver]-c##-##.mp4` | `ep01-sc01-l02-02-c01-02.mp4` |

Field reference: `ep`=episode, `sc`=scene, `l`=shot, `##`=version, `c`=time-slice.

### Path Rule

All versions saved in the same directory:

```
output/ep01/sc01/l01/
  ep01-sc01-l01.mp4              # original
  ep01-sc01-l01-01.mp4           # regen L v01
  ep01-sc01-l01-02.mp4           # regen L v02 (qualified)
  ep01-sc01-l01-02-c01.mp4       # C01 based on L v02
  ep01-sc01-l01-02-c01-02.mp4    # C01 regen v02
```

## Six-level Judgment

| Level | Rule | Threshold | Configurable |
|-------|------|-----------|:---:|
| 0 | Prompt compliance < 20% | `PROMPT_COMPLIANCE_THRESHOLD = 0.2` | No |
| 1 | Character consistency < 7 | One-vote veto | No |
| 2 | Scene consistency < 7 | One-vote veto | No |
| 3 | Any dimension < 5 | `HARD_MIN_DIMENSION_SCORE = 5` | No |
| 4 | Any dimension < threshold | `min_dimension_score = 7` | Yes |
| 5 | Total score < threshold | `min_total_score = 40` | Yes |

## Review Dimensions (5, total 50 pts)

| Dimension | Key | Weight | Sub-scores |
|-----------|-----|--------|------------|
| Plot | `plot` | High | narrative_coherence(40%) + scene_transition(30%) + story_logic(30%) |
| Character | `character` | High | character_consistency(40%) + appearance_match(30%) + action_logic(30%) |
| Scene | `scene` | Medium | environment_quality(40%) + lighting_quality(30%) + props_accuracy(30%) |
| Direction | `direction` | Medium | camera_movement(25%) + shot_composition(25%) + editing_rhythm(25%) + technical_quality(25%) |
| Duration | `duration` | Low | duration_deviation(50%) + pacing_score(50%) |

### Score Scale

- 9-10: Excellent
- 7-8: Good
- 5-6: Acceptable
- 3-4: Below standard
- 1-2: Severe issues

## Regeneration Strategy

### Timerange Analysis

After review failure, `analyze_timeranges` evaluates each time-slice (C):

| Condition | Strategy |
|-----------|----------|
| >=70% C failed | `regenerate_l` (whole shot) |
| Some C failed | `regenerate_c` (specific slices only) |
| All C passed but L failed | `regenerate_l` |

### Constraints

1. `HARD_MIN_DIMENSION_SCORE = 5` is immutable
2. C-level must reference the latest qualified L version
3. Filenames are self-documenting (type, version, base version)
4. `final_selection.json` records id + full path
5. All versions in the same L directory

## Quality Control Workflow

```
1. Gemini analysis -> *_analysis.json (content + compliance)
2. Evaluator scoring -> *_review.json
3. Six-level judgment
4. If failed:
   a. Timerange analysis (identify bad C slices)
   b. Strategy decision (regenerate_l / regenerate_c)
   c. Prompt optimization -> *_optimized.json
   d. Regeneration -> new video
   e. Loop back to step 1
5. If passed:
   -> Record to final_selection.json
```

## final_selection.json Format

```json
{
  "ep01-sc01-l01": {
    "id": "ep01-sc01-l01",
    "selected_l": {
      "filename": "ep01-sc01-l01-02.mp4",
      "path": "output/ep01/sc01/l01/ep01-sc01-l01-02.mp4"
    },
    "selected_shots": [
      {
        "filename": "ep01-sc01-l01-02-c01.mp4",
        "path": "output/ep01/sc01/l01/ep01-sc01-l01-02-c01.mp4"
      }
    ]
  }
}
```
