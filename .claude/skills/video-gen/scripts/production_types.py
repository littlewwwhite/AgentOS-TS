#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal runtime types for the default video generation path."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass(frozen=True)
class ClipIntent:
    """Upstream intent for generating one clip.

    `first_frame_url` carries cross-run continuity loaded from JSON `clip.lsi.url`
    (orthogonal to `reference_images`, which is for subject binding only).
    Runtime in-scene continuity arrives separately via `ContinuityContext`.
    """

    clip_id: str
    scene_id: str
    prompt_text: str
    duration_seconds: int
    subject_ids: List[str] = field(default_factory=list)
    subjects: List[Dict] = field(default_factory=list)
    reference_images: List[Dict] = field(default_factory=list)
    first_frame_url: Optional[str] = None
    location_num: int = 0
    clip_num: int = 0


@dataclass(frozen=True)
class ContinuityContext:
    """Carry-over continuity from the previous clip."""

    first_frame_url: Optional[str] = None
    first_frame_text: Optional[str] = None
    prev_video_url: Optional[str] = None


@dataclass(frozen=True)
class GenerationRequest:
    """Compiled request that can be submitted to the provider adapter."""

    clip_id: str
    scene_id: str
    prompt: str
    duration_seconds: int
    quality: str
    ratio: str
    subjects: List[Dict] = field(default_factory=list)
    reference_images: List[Dict] = field(default_factory=list)
    first_frame_url: Optional[str] = None
    first_frame_text: Optional[str] = None
    reference_videos: List[Dict] = field(default_factory=list)


@dataclass(frozen=True)
class GenerationResult:
    """Outcome of one generation request."""

    clip_id: str
    scene_id: str
    success: bool
    video_path: Optional[str] = None
    video_url: Optional[str] = None
    task_id: Optional[str] = None
    error_message: Optional[str] = None
