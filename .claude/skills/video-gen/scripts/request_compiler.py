#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compile one clip intent into the provider-facing request shape.

Two orthogonal continuity axes are kept strictly separate here:

* `reference_images[]` — subject-binding refs only (act/loc/prp), each with
  `role: "reference_image"`, indexed by `[图N]` in the prompt.
* `first_frame_url`    — the previous clip's last-shot first frame URL,
  carried independently. Runtime `ContinuityContext.first_frame_url` (in-scene
  override) takes precedence over the upstream `ClipIntent.first_frame_url`
  (cross-run JSON `lsi.url`).
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

    effective_first_frame_url = continuity.first_frame_url or intent.first_frame_url

    return GenerationRequest(
        clip_id=intent.clip_id,
        scene_id=intent.scene_id,
        prompt=intent.prompt_text,
        duration_seconds=intent.duration_seconds,
        quality=quality,
        ratio=ratio,
        subjects=[],
        reference_images=list(intent.reference_images),
        first_frame_url=effective_first_frame_url,
        first_frame_text=continuity.first_frame_text,
        reference_videos=[],
    )
