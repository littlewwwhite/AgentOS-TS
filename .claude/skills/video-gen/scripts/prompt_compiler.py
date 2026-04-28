#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: director-facing storyboard markdown prompt
# output: compact provider-facing video generation prompt
# pos: VIDEO boundary compiler that preserves storyboard reviewability while slimming model requests
"""Compile rich storyboard markdown into compact provider-facing prompts."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List


_HEADING_RE = re.compile(r"^(S\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$")
_BULLET_RE = re.compile(r"^-\s*([^：:]+)[：:]\s*(.*?)\s*$")
_FIELD_RE = re.compile(r"^(总体描述|动作|角色状态|音效|对白)[：:]\s*(.*?)\s*$")
_NOISE_RE = re.compile(r"\s+")


@dataclass
class Segment:
    """One timed camera/action segment inside a storyboard prompt."""

    label: str
    time_range: str
    setup: str
    fields: Dict[str, str] = field(default_factory=dict)


def _clean(text: str) -> str:
    return _NOISE_RE.sub(" ", text.strip())


def _clip(text: str, limit: int) -> str:
    text = _clean(text)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip(" ，,。;；") + "…"


def _extract_prefixed_line(lines: List[str], prefix: str) -> str:
    for line in lines:
        if line.startswith(prefix):
            return line.split("：", 1)[1].strip() if "：" in line else ""
    return ""


def _parse_segments(lines: List[str]) -> List[Segment]:
    segments: List[Segment] = []
    current: Segment | None = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        heading = _HEADING_RE.match(line)
        if heading:
            current = Segment(
                label=heading.group(1),
                time_range=_clean(heading.group(2)),
                setup=_clean(heading.group(3)),
            )
            segments.append(current)
            continue

        if current is None:
            continue

        bullet = _BULLET_RE.match(line)
        if bullet:
            key = _clean(bullet.group(1))
            value = _clean(bullet.group(2))
            if key and value:
                current.fields[key] = value

    return segments


def _parse_simple_block(lines: List[str]) -> tuple[str, Dict[str, str]]:
    setup = ""
    fields: Dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if not setup and "|" in line and line.startswith("景别/机位"):
            setup = _clean(line.split("|", 1)[1])
            continue
        field_match = _FIELD_RE.match(line)
        if field_match:
            fields[field_match.group(1)] = _clean(field_match.group(2))
    return setup, fields


def _segment_to_line(segment: Segment) -> str:
    action = _clip(segment.fields.get("动作", ""), 95)
    camera = _clip(segment.fields.get("运镜", ""), 55)
    state = _clip(segment.fields.get("角色状态", ""), 75)
    sfx = _clip(segment.fields.get("音效", ""), 38)
    dialogue = _clean(segment.fields.get("对白", ""))

    parts = [f"{segment.time_range} {segment.setup}"]
    if action:
        parts.append(f"动作：{action}")
    if camera:
        parts.append(f"镜头：{camera}")
    if state and len(parts) < 4:
        parts.append(f"状态：{state}")
    if sfx and sfx != "无":
        parts.append(f"音：{sfx}")
    if dialogue and dialogue != "无":
        parts.append(f"对白：{dialogue}")

    return "；".join(parts)


def _compile_simple_block(setup: str, fields: Dict[str, str]) -> str:
    output: List[str] = [
        "电影级真实短剧，多镜头切换，动作清晰干净；画面禁止文字、字幕、水印、LOGO、UI；无BGM，仅写实对白、环境音和拟音。",
    ]
    if setup:
        output.append(f"镜头：{_clip(setup, 80)}。")
    overview = fields.get("总体描述", "")
    action = fields.get("动作", "")
    state = fields.get("角色状态", "")
    sfx = fields.get("音效", "")
    dialogue = fields.get("对白", "")

    if overview:
        output.append(_clip(overview, 180))
    if action:
        output.append(f"动作：{_clip(action, 180)}")
    if state:
        output.append(f"状态：{_clip(state, 120)}")
    if sfx and sfx != "无":
        output.append(f"音频：{_clip(sfx, 60)}")
    if dialogue and dialogue != "无":
        output.append(f"对白：{_clean(dialogue)}")
    return "\n".join(output)


def compile_video_prompt(storyboard_prompt: str) -> str:
    """Return a compact prompt for the video model.

    The storyboard prompt remains the canonical director artifact. This compiler
    removes review-only structure, duplicated beat summaries, and markdown field
    ceremony before subject-token resolution and provider submission.
    """

    lines = [line.rstrip() for line in storyboard_prompt.splitlines()]
    non_empty_lines = [_clean(line) for line in lines if line.strip()]
    segments = _parse_segments(lines)

    if not segments:
        setup, fields = _parse_simple_block(lines)
        if fields:
            return _compile_simple_block(setup, fields)
        return _clip(" ".join(non_empty_lines), 1800)

    overview = _extract_prefixed_line(non_empty_lines, "总体描述：")
    summary = _extract_prefixed_line(non_empty_lines, "剧情摘要：")

    output: List[str] = [
        "电影级真实短剧，多镜头切换，动作清晰干净；画面禁止文字、字幕、水印、LOGO、UI；无BGM，仅写实对白、环境音和拟音。",
    ]
    if overview:
        output.append(f"场景与氛围：{_clip(overview, 180)}")
    if summary:
        output.append(f"剧情目标：{_clip(summary, 130)}")

    output.append("按以下时间顺序生成：")
    output.extend(_segment_to_line(segment) for segment in segments)

    return "\n".join(line for line in output if line.strip())
