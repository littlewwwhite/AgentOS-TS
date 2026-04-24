# AI Configuration & Delivery Format

## AI Configuration

### Video Generation Provider (Volcengine Ark / Seedance 2)

当前 `video-gen` 的默认视频生成供应商已切到火山方舟 Ark，不再把任何 API Key 写入仓库配置。

```json
{
  "video_model": {
    "provider": "volcengine_ark",
    "active_model": "seedance2",
    "models": {
      "seedance2": {
        "model_code": "ep-20260303234827-tfnzm",
        "subject_reference": false
      }
    },
    "providers": {
      "volcengine_ark": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "api_key_env": "ARK_API_KEY"
      }
    }
  }
}
```

使用前在本地 shell 注入：

```bash
export ARK_API_KEY="your-ark-api-key"
```

Ark 视频任务走官方异步接口：

- 创建任务：`POST /contents/generations/tasks`
- 查询任务：`GET /contents/generations/tasks/{task_id}`
- 输出视频：查询结果中的 `content.video_url`

`ep-20260303234827-tfnzm` 被视为火山方舟推理接入点/模型标识，直接写入请求体的 `model` 字段。若后续更换接入点，只改 `assets/config.json` 中 `video_model.models.seedance2.model_code`。

当前视频生成只保留 Seedance2 / Volcengine Ark 路径；不保留旧供应商 fallback。

### Prompt Generation Boundary

VIDEO 阶段不再从 `script.json` 生成 prompt。提示词创作属于 STORYBOARD 阶段，VIDEO 阶段只消费 approved storyboard canonical 并导出 runtime copy。

- **仓库级交互运行时**：`apps/console/` 使用 `@anthropic-ai/claude-agent-sdk`
- **离线分镜草稿 helper**：属于 `storyboard` skill（`.claude/skills/storyboard/scripts/storyboard_batch.py`），不属于 VIDEO 阶段

也就是说：项目整体并不是“去 Claude 化”；Claude Agent SDK 仍是交互层核心，VIDEO 只保留视频生成与视频评审供应商配置。

> Note: 当前这个 CLI adapter 不支持图片输入，所以 scene layout analysis 会在读不到图片时退回 generic layout。

### Video Review (Gemini API)

Video review uses Gemini models through the ChatFire Gemini proxy, configured from the `gemini` section of `assets/config.json`:

```json
{
  "gemini": {
    "base_url": "https://api.chatfire.cn/gemini",
    "api_key": "",
    "review_model": "gemini-3.1-pro-preview"
  }
}
```

| Field | Description |
|-------|-------------|
| `base_url` | ChatFire Gemini proxy address |
| `api_key` | API key (set GEMINI_API_KEY to the ChatFire key value) |
| `review_model` | Video review model |

## Delivery JSON Format

**File location:** `output/ep001/ep001_delivery.json`

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

# Claude runtime
# apps/console/ uses Claude Agent SDK; this skill's offline helper currently also requires Claude CLI availability

# Video generation auth (Seedance2 / Ark)
# Default provider: Volcengine Ark
export ARK_API_KEY="your-ark-api-key"

# No legacy video-provider fallback is configured in the current MVP.
```

> `opencv-python` is used for face detection during last-shot first-frame extraction (Gaussian blur on face regions only).
> Falls back to full-image blur if not installed, but results may not match expectations. Installation recommended.
