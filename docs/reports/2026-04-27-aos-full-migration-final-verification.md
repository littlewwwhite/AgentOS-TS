# aos-cli Skill Migration Final Verification

## Verdict

本轮已把 skill pack 中实际使用的模型任务类型收敛到 `aos-cli model` 边界，并补齐本地可播放的 1-3 集 E2E 验收产物。

远程视频 provider 未执行：当前 shell 环境没有 `ARK_API_KEY` / `GEMINI_API_KEY`。因此最终视频产物使用 `AOS_CLI_MODEL_FAKE=1` + `AOS_CLI_MODEL_FAKE_VIDEO_VALID=1`，由 repo-local `aos-cli model video.generate` fake provider 通过 ffmpeg 生成有效 MP4。该产物验证的是 pipeline / scheduling / duration / manifest / playable artifact contract，不伪装成真实商业模型输出。

## Generated E2E Artifacts

Generated root:

`output/e2e/aos-full-migration/`

| Episode | Clips | Clip durations | Final duration | Final video |
| --- | ---: | --- | ---: | --- |
| ep001 | 4 | `[6.0, 8.0, 7.0, 9.0]` | `30.0s` | `output/e2e/aos-full-migration/final/ep001_final.mp4` |
| ep002 | 4 | `[7.0, 10.0, 6.0, 11.0]` | `34.0s` | `output/e2e/aos-full-migration/final/ep002_final.mp4` |
| ep003 | 4 | `[9.0, 12.0, 7.0, 10.0]` | `38.0s` | `output/e2e/aos-full-migration/final/ep003_final.mp4` |

Each episode also has:

- `output/e2e/aos-full-migration/storyboard/approved/epXXX_storyboard.json`
- `output/e2e/aos-full-migration/epXXX/epXXX_storyboard.json`
- `output/e2e/aos-full-migration/epXXX/epXXX_delivery.json`
- `output/e2e/aos-full-migration/epXXX/epXXX_video_task_manifest.json`
- `output/e2e/aos-full-migration/workspace/epXXX/epXXX_generation_summary.json`

## Scheduling Evidence

`batch_generate.py` groups clips by `scene_id`, runs independent scenes in parallel, and calls `_process_scene_clips` serially per scene.

The local E2E run produced `6` `[LSI] ... lsi 已写入` events: each of the 3 episodes has 2 scenes, and each scene's second clip received the first clip's provider tail-frame URL.

## Migration Coverage

The shared guardrail now states that there are no deferred multimodal skill paths left. New direct provider SDK calls inside skills are blocked by `.claude/skills/_shared/test_no_new_direct_provider_calls.py`.

Covered capability boundaries:

- `generate` / structured JSON text through shared aos-cli adapter.
- `image.generate` through aos-cli image boundary.
- `video.generate` submit/poll through aos-cli task/task_result boundary.
- `vision.review` for asset review and video frame description.
- `video.analyze` for video review / analysis paths.
- `audio.transcribe` for subtitle ASR.

## Final Verification Commands

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --offline pytest .claude/skills/_shared/test_no_new_direct_provider_calls.py -q
UV_CACHE_DIR=/tmp/uv-cache uv run --offline pytest .claude/skills/asset-gen/scripts/test_common_vision_review.py .claude/skills/video-editing/scripts/test_common_video_analyze.py .claude/skills/video-editing/scripts/test_phase2_assemble_aos_cli_boundary.py .claude/skills/music-matcher/scripts/test_aos_cli_video_analysis.py .claude/skills/subtitle-maker/scripts/test_common_audio_transcribe.py -q
UV_CACHE_DIR=/tmp/uv-cache uv run --offline pytest .claude/skills/video-gen/scripts/test_fake_e2e_generation.py .claude/skills/video-gen/scripts/test_duration_manifest.py .claude/skills/video-gen/scripts/test_video_generation_scheduling.py -q
UV_CACHE_DIR=/tmp/uv-cache uv run --offline --no-sync --project aos-cli pytest aos-cli/tests/test_capabilities.py aos-cli/tests/test_model_service.py aos-cli/tests/test_model_protocol.py aos-cli/tests/test_model_submit_poll_cli.py -q
python3 .claude/skills/video-gen/scripts/run_local_e2e_showcase.py
python3 -m compileall -q .claude/skills/_shared .claude/skills/asset-gen/scripts .claude/skills/video-gen/scripts .claude/skills/video-editing/scripts .claude/skills/music-matcher/scripts .claude/skills/subtitle-maker/scripts aos-cli/src/aos_cli aos-cli/tests
git diff --check
```

## Remaining Risks

- Remote provider E2E still needs real credentials in the shell or configured environment.
- Local showcase videos are valid, playable MP4 files, but they are deterministic ffmpeg artifacts rather than real model-generated visual storytelling.
- `upload_to_cos` remains disabled locally, so the E2E relies on provider `lastFrameUrl` artifacts for LSI continuity instead of uploading extracted local frames.
