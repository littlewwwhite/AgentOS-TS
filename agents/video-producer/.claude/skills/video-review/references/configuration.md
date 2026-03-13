# Configuration

## Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `min_total_score` | 40 | Minimum total score (out of 50) |
| `min_dimension_score` | 7 | Minimum per-dimension score (out of 10) |

## Immutable Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `PROMPT_COMPLIANCE_THRESHOLD` | 0.2 | Prompt compliance veto threshold |
| `HARD_MIN_DIMENSION_SCORE` | 5 | Hard minimum per-dimension score |

## Supported Input Formats

- **Video files**: MP4, MOV (analyzed via Gemini API)
- **TXT**: Plain text scripts
- **Markdown**: Structured scripts (recommended)
- **JSON**: Scripts with metadata

## Output Files

| Suffix | Content |
|--------|---------|
| `*_analysis.json` | Gemini analysis (content + compliance) |
| `*_review.json` | Review result (scores, issues, recommendations) |
| `*_optimized.json` | Optimized prompt (if review failed) |
| `final_selection.json` | Final qualified video selections |

## Review Result JSON Schema

```json
{
  "segment_id": "SC01-L01",
  "prompt_compliance": {
    "score": 0.85,
    "percentage": "85.0%",
    "matched_elements": ["..."],
    "missing_elements": ["..."],
    "incorrect_elements": [],
    "deviation_description": "..."
  },
  "actual_content_description": "...",
  "scores": {
    "plot": 8.5,
    "character": 7.8,
    "scene": 8.2,
    "direction": 7.5,
    "duration": 9.0,
    "total": 41.0
  },
  "qualified": true,
  "failed_dimensions": []
}
```

## Modular Project Structure

video-review supports modular project layout via symlinks:

```
project-root/
  01-script/output/         # scripts & storyboard
  02-assets/output/         # character & scene assets
  03-video/
    workspace/
      input -> ../../01-script/output
      assets -> ../../02-assets/output
    output/
      ep01/sc01/l01/
        ep01-sc01-l01-01.mp4
        ep01-sc01-l01-01_analysis.json
        ep01-sc01-l01-01_review.json
      final_selection.json
```

### config.json

```json
{
  "paths": {
    "input": {
      "script": "workspace/input/episodes",
      "storyboard": "workspace/input/storyboard"
    },
    "assets": {
      "characters": "workspace/assets/characters",
      "scenes": "workspace/assets/scenes"
    },
    "output": {
      "root": "output",
      "final_selection": "output/final_selection.json"
    }
  },
  "naming": {
    "analysis_suffix": "_analysis.json",
    "review_suffix": "_review.json"
  }
}
```

## Environment

```bash
# Required
export GEMINI_API_KEY="your-api-key"

# Dependencies
pip install google-genai pydantic
```
