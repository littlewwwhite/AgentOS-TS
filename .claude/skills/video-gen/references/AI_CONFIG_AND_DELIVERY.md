# AI Configuration & Delivery Format

## AI Configuration

### Video Generation Boundary (aos-cli model)

`video-gen` 的视频生成调用一律走 `aos-cli model` 边界，由 `aos-cli` 负责 provider 选择、鉴权与底层 HTTP 调用：

- Submit：`apiVersion=aos-cli.model/v1`、`capability=video.generate`、`output.kind=task`，由 `aos-cli model submit` 处理。
- Poll：把 submit 返回的 task envelope 写入临时文件，由 `aos-cli model poll` 处理，期望返回 `output.kind=task_result` 与 `output.artifacts[*].kind=video`。
- Preflight：`uv run --project aos-cli aos-cli model preflight --json`。

#### 责任边界

- `aos-cli` 拥有 provider 专属字段（如 Ark 的 `model_code`、`base_url`、`api_key`、`generate_audio`、`watermark`、`return_last_frame` 等），由 aos-cli 配置与 manifest 管理。
- `video-gen` 只负责：从 storyboard/runtime export 派生 `prompt` / `duration` / `ratio` / `quality` / `referenceImages` / `firstFrameUrl`、组装 aos-cli envelope、解析 `output.artifacts` 中的 `video` artifact，并把结果写入 delivery JSON。
- 切换底层 provider 不需要修改 `video-gen` 的脚本，只需调整 aos-cli 一侧的 provider 配置。

仓库内 `assets/config.json` 仍保留 `video_model` 段落，但其作用已退化为：标识当前 active model 名称，供 `video-gen` 自身的展示/校验逻辑使用；真正的 provider/endpoint/key 在 aos-cli。

### Prompt Generation Boundary

VIDEO 阶段不再从 `script.json` 生成 prompt。提示词创作属于 STORYBOARD 阶段，VIDEO 阶段只消费 approved storyboard canonical 并导出 runtime copy。

- **仓库级交互运行时**：`apps/console/` 使用 `@anthropic-ai/claude-agent-sdk`
- **离线分镜草稿 helper**：属于 `storyboard` skill（`.claude/skills/storyboard/scripts/storyboard_batch.py`），不属于 VIDEO 阶段

也就是说：项目整体并不是“去 Claude 化”；Claude Agent SDK 仍是交互层核心，VIDEO 只保留视频生成、视频评审与连续性帧描述的业务编排。

> Note: 当前这个 CLI adapter 不支持图片输入，所以 scene layout analysis 会在读不到图片时退回 generic layout。

### Video Review Boundary (aos-cli model)

Generated-clip review uses `aos-cli model` with `capability=video.analyze`.
`video-gen/scripts/analyzer.py` preserves the existing review JSON contract
(`reference_consistency` + `prompt_compliance`) while moving provider
selection, authentication, and multimodal upload handling behind aos-cli.

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "video-gen.review.ep001_scn001_clip001",
  "capability": "video.analyze",
  "output": { "kind": "json" }
}
```

Continuity frame description goes through `frame_extractor.describe_frame_with_aos_cli`,
which routes the call to `aos-cli model` `vision.review` and never imports a
provider SDK directly.

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

# Video generation auth
# Provider keys (Ark/etc) are managed by aos-cli; configure them per aos-cli docs.
# `video-gen` itself no longer reads ARK_API_KEY.

# No legacy video-provider fallback is configured in the current MVP.
```

> `opencv-python` is used for face detection during last-shot first-frame extraction (Gaussian blur on face regions only).
> Falls back to full-image blur if not installed, but results may not match expectations. Installation recommended.
