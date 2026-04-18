# AI Configuration & Delivery Format

## AI Configuration

### Prompt Generation (Claude subagent)

Prompt generation (shot descriptions, costume color removal, v2 variant generation, etc.) uses **Claude subagent** (via `claude -p` command). **No extra API configuration needed** — just ensure Claude Code CLI is installed and logged in.

> Note: `claude -p` does not support image input. Scene layout analysis falls back to generic layout when images cannot be read.

### Video Review (Gemini API)

Video review uses Gemini API, configured from the `gemini` section of `assets/config.json`:

```json
{
  "gemini": {
    "base_url": "https://aihubmix.com/gemini",
    "api_key": "",
    "review_model": "gemini-3.1-pro-preview"
  }
}
```

| Field | Description |
|-------|-------------|
| `base_url` | API proxy address (via aihubmix relay) |
| `api_key` | API key (set via GEMINI_API_KEY env var) |
| `review_model` | Video review model |

## Delivery JSON Format

**File location:** `${OUTPUT_EP}/ep001_delivery.json`

```json
{
  "episode_id": "ep_001",
  "locations": [
    {
      "scene_id": "scn_001",
      "clips": [
        {
          "clip_id": "clip_001",
          "recommended": "ep001_scn001_clip001_002.mp4",
          "prompt": "一个男子站在岸边",
          "prompt_version": 1,
          "shots": ["ep001_scn001_clip001_002.mp4"]
        }
      ]
    }
  ]
}
```

`prompt_version` marks which prompt version was used: `1` (complete_prompt / v1) or `2` (complete_prompt_v2 / v2).

## Dependencies

```bash
# Python
pip install pydantic tqdm opencv-python

# Claude Code CLI (prompt generation uses claude -p subagent)
# Must be installed and configured

# Video generation auth (AnimeWorkbench)
# Requires ~/.animeworkbench_auth.json (generated via awb-login skill)
```

> `opencv-python` is used for face detection during last-shot first-frame extraction (Gaussian blur on face regions only).
> Falls back to full-image blur if not installed, but results may not match expectations. Installation recommended.
