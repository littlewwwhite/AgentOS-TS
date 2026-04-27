#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compile one clip intent into the provider-facing request shape.

Default mode is reference_image only. Continuity from the previous clip is
routed as additional reference media to avoid Ark Seedance 2.0's per-task
mode-mutex (`reference_image` items cannot share `content[]` with
`first_frame`/`last_frame` items).

Routing rules
-------------

* `intent.reference_images[]`         -> kept verbatim, indexed by `[图N]`.
* `continuity.first_frame_url`        -> appended as another reference_image
  with `role="reference_image"` and `name="prev_frame"`. The runtime
  `ContinuityContext.first_frame_url` (in-scene override) takes precedence
  over the upstream `ClipIntent.first_frame_url` (cross-run JSON `lsi.url`).
* `continuity.prev_video_url`         -> emitted as a `reference_video`.

`GenerationRequest.first_frame_url` stays None on this default path. Callers
that need the dedicated first/last-frame channel must bypass this compiler
and call `video_api.submit_video` directly.
"""

from production_types import ClipIntent, ContinuityContext, GenerationRequest


def compile_request(
    intent: ClipIntent,
    continuity: ContinuityContext,
    model_code: str,
    quality: str,
    ratio: str,
) -> GenerationRequest:
    """Compile the shortest default path: prompt + refs + continuity + params."""

    effective_prev_frame_url = continuity.first_frame_url or intent.first_frame_url

    reference_images = list(intent.reference_images)
    if effective_prev_frame_url:
        reference_images.append(
            {
                "url": effective_prev_frame_url,
                "role": "reference_image",
                "name": "prev_frame",
            }
        )

    reference_videos = []
    if continuity.prev_video_url:
        reference_videos.append(
            {
                "url": continuity.prev_video_url,
                "role": "reference_video",
                "name": "prev_video",
            }
        )

    return GenerationRequest(
        clip_id=intent.clip_id,
        scene_id=intent.scene_id,
        prompt=intent.prompt_text,
        duration_seconds=intent.duration_seconds,
        quality=quality,
        ratio=ratio,
        subjects=[],
        reference_images=reference_images,
        first_frame_url=None,
        first_frame_text=continuity.first_frame_text,
        reference_videos=reference_videos,
    )
