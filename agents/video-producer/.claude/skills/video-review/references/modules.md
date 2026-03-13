# Core Modules

Detailed module descriptions extracted from SKILL.md.

## 1. gemini_analyzer.py - Gemini Video Analyzer

Uses Google Gemini API to analyze video content.

**Capabilities:**
- Describe actual video content (`actual_content_description`)
- Compare with original prompt, compute compliance (`prompt_compliance`)
- Output 5-dimension structured data (Pydantic Schema)
- Auto file upload, processing, cleanup

**Input:** video file, segment ID (SC##-L##), expected duration, original prompt (optional)
**Output:** `*_analysis.json`

**Scoring algorithm (evaluator.py):**
- Plot: narrative_coherence(40%) + scene_transition(30%) + story_logic(30%)
- Character: character_consistency(40%) + appearance_match(30%) + action_logic(30%)
- Scene: environment_quality(40%) + lighting_quality(30%) + props_accuracy(30%)
- Direction: camera_movement(25%) + shot_composition(25%) + editing_rhythm(25%) + technical_quality(25%)
- Duration: duration_deviation(50%) + pacing_score(50%)

## 2. evaluator.py - Review Evaluator

Reads Gemini analysis, performs six-level judgment.

**Capabilities:**
- Level 0: prompt compliance < 20% -> one-vote veto
- Compute weighted dimension scores
- Six-level qualification check
- Generate review report with recommendations

**Input:** `*_analysis.json`, video file path
**Output:** `*_review.json`

## 3. workflow.py - Complete Workflow

One-click: analyze -> review -> timerange analysis -> optimize -> smart regeneration.

**Capabilities:**
- Auto-extract original prompt from JSON (supports dict/list/nested formats)
- Identify problem time-slices (C)
- Smart regeneration strategy decision
- Full error handling

**Input:** video, segment ID, duration, prompt JSON, storyboard (optional)
**Output:** `*_analysis.json`, `*_review.json`, `*_optimized.json` (if failed), regenerated video

## 4. c_level_generator.py - C-level Video Generator

Generates single time-slice (3-5s) videos.

**Capabilities:**
- Extract single C description from storyboard
- Auto-expand to full video prompt with context
- Standard C-level naming
- Auto-retry (max 3)

**Input:** storyboard, shot ID, C ID, L version, output dir
**Output:** C-level video file

## 5. prompt_enhancement/optimizer.py - Prompt Optimizer

Optimizes prompts based on review results.

**Strategies by dimension:**
- **Prompt compliance**: re-examine core elements, ensure key content explicit
- **Plot**: strengthen narrative logic, scene continuity
- **Character**: refine appearance, action descriptions
- **Scene**: enhance environment detail, lighting effects
- **Direction**: optimize camera instructions, composition
- **Duration**: adjust pacing, compress/expand content

**Input:** original prompt JSON, segment ID, review result
**Output:** `*_optimized.json`

## 6. gemini_adapter.py - Analysis Adapter

Two-level strategy for analysis:
1. Read existing `*_analysis.json` (cache)
2. Run built-in gemini_analyzer.py

## 7. final_selection.py - Final Selection Manager

```bash
# Set selected L video
python3 ${CLAUDE_SKILL_DIR}/scripts/final_selection.py set-l <id> <path>

# Add replacement shot
python3 ${CLAUDE_SKILL_DIR}/scripts/final_selection.py add-shot <id> <path>

# List all selections
python3 ${CLAUDE_SKILL_DIR}/scripts/final_selection.py list

# Export file list
python3 ${CLAUDE_SKILL_DIR}/scripts/final_selection.py export -o file_list.txt
```

## Prompt JSON Format Support

workflow.py supports multiple JSON formats:

**Format 1: Direct dict mapping**
```json
{ "SC01-L01": { "prompt": "...", "duration": 5.0 } }
```

**Format 2: Nested segments array**
```json
{ "segments": [{ "id": "SC01-L01", "prompt": "...", "duration": 5.0 }] }
```

**Format 3: Top-level array**
```json
[{ "id": "SC01-L01", "prompt": "...", "duration": 5.0 }]
```
