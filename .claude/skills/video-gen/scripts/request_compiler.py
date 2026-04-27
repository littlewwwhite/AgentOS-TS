#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compile one clip intent into the provider-facing request shape."""

from typing import Dict, List

from production_types import ClipIntent, ContinuityContext, GenerationRequest


def _with_continuity_frame(
    reference_images: List[Dict],
    first_frame_url: str | None,
) -> List[Dict]:
    if not first_frame_url:
        return list(reference_images)

    compiled = list(reference_images)
    if any(ref.get("name") == "lsi" for ref in compiled):
        return compiled

    compiled.append(
        {
            "url": first_frame_url,
            "name": "lsi",
            "display_name": "上一镜头首帧",
        }
    )
    return compiled


def compile_request(
    intent: ClipIntent,
    continuity: ContinuityContext,
    model_code: str,
    quality: str,
    ratio: str,
) -> GenerationRequest:
    """Compile the shortest default path: prompt + refs + continuity + params."""

    reference_images = _with_continuity_frame(
        intent.reference_images,
        continuity.first_frame_url,
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
        first_frame_url=continuity.first_frame_url,
        first_frame_text=continuity.first_frame_text,
        reference_videos=[],
    )
