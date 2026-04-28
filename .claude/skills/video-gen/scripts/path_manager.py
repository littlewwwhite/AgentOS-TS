#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Path Manager & Name Parser
Manages hierarchical path structure (ep -> scn) and video naming conventions.

Path structure:
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001.mp4
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001.json
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001_002.mp4  (version 2)
"""

import json
import re
import shutil
import urllib.request
import ssl
from pathlib import Path
from typing import Optional, Dict


_MINIMAL_SHOT_ID_RE = re.compile(r"^scn_\d{3}_clip\d{3}$")


def _validate_minimal_shots(data: dict, source_label: str) -> None:
    """Reject legacy storyboard shapes before VIDEO API calls.

    Shot contract is exhaustive: {id, duration, prompt}. See
    .claude/skills/video-gen/references/STORYBOARD_SCHEMA.md.

    This is the read-side gate complementing the storyboard finalize gate.
    Any storyboard predating the minimal-schema migration (e.g. shapes
    carrying source_refs / partial_prompt / complete_prompt only) is
    rejected here so it cannot silently fall through to Ark with a
    missing duration.
    """
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError(f"{source_label}: scenes[] missing or empty")
    for sc_idx, scene in enumerate(scenes):
        scene_id = scene.get("scene_id") or f"<unnamed scene #{sc_idx}>"
        shots = scene.get("shots")
        if not isinstance(shots, list) or not shots:
            raise ValueError(f"{source_label}: scene {scene_id}.shots[] missing or empty")
        for sh_idx, shot in enumerate(shots):
            label = f"{source_label}: scene {scene_id} shots[{sh_idx}]"
            sid = shot.get("id")
            if not isinstance(sid, str) or not _MINIMAL_SHOT_ID_RE.match(sid):
                raise ValueError(
                    f"{label}: id must match ^scn_\\d{{3}}_clip\\d{{3}}$ (got {sid!r}). "
                    "Legacy storyboard schema — regenerate via storyboard finalize gate."
                )
            duration = shot.get("duration")
            if not isinstance(duration, int) or isinstance(duration, bool) or duration < 4 or duration > 15:
                raise ValueError(
                    f"{label}: duration must be int in [4, 15] (got {duration!r}). "
                    "Legacy storyboard schema — regenerate via storyboard finalize gate."
                )
            prompt = shot.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError(
                    f"{label}: prompt must be non-empty string. "
                    "Legacy storyboard schema — regenerate via storyboard finalize gate."
                )


class VideoNameParser:
    """
    Parse and format video names following the naming standard.

    Format: ep###_scn###_clip###[_###][_shot###[_###]]
    Examples:
        ep001_scn001_clip001               -> clip-level original
        ep001_scn001_clip001_002           -> clip-level version 2
        ep001_scn001_clip001_003_shot001   -> shot-level shot 1 based on clip version 3
        ep001_scn001_clip001_003_shot001_002 -> shot-level shot 1 version 2
    """

    FULL_PATTERN = re.compile(
        r'^ep(\d{3})_scn(\d{3})_clip(\d{3})'  # required: ep_scn_clip
        r'(?:_(\d{3}))?'                        # optional: clip version
        r'(?:_shot(\d{3}))?'                    # optional: shot number
        r'(?:_(\d{3}))?$'                       # optional: shot version
    )

    # Map segment ID (SCN###-CLIP###) to ep/scn/clip components
    SEGMENT_PATTERN = re.compile(
        r'^SCN(\d+)-CLIP(\d+)$', re.IGNORECASE
    )

    @classmethod
    def parse(cls, video_name: str) -> Optional[Dict]:
        """
        Parse video name into components.

        Args:
            video_name: Video name with or without extension

        Returns:
            Parsed dict or None if invalid
        """
        name = video_name.replace('.mp4', '').replace('.json', '')
        m = cls.FULL_PATTERN.match(name)
        if not m:
            return None

        return {
            'episode': int(m.group(1)),
            'location': int(m.group(2)),
            'clip': int(m.group(3)),
            'clip_version': int(m.group(4)) if m.group(4) else None,
            'shot': int(m.group(5)) if m.group(5) else None,
            'shot_version': int(m.group(6)) if m.group(6) else None,
            'type': 'shot' if m.group(5) else 'clip',
            'full_name': name,
        }

    @classmethod
    def parse_segment_id(cls, segment_id: str, episode: int = 1) -> Optional[Dict]:
        """
        Parse segment ID (SCN###-CLIP###) into ep/scn/clip components.

        Args:
            segment_id: Segment ID like "SCN001-CLIP001"
            episode: Episode number (default 1)

        Returns:
            Dict with episode, location, clip or None
        """
        m = cls.SEGMENT_PATTERN.match(segment_id)
        if not m:
            return None

        return {
            'episode': episode,
            'location': int(m.group(1)),
            'clip': int(m.group(2)),
        }

    @classmethod
    def format_clip_name(cls, ep: int, location: int, clip: int, version: int = None) -> str:
        """Format clip-level video name (without extension)."""
        name = f"ep{ep:03d}_scn{location:03d}_clip{clip:03d}"
        if version and version > 1:
            name += f"_{version:03d}"
        return name

    @classmethod
    def format_shot_name(cls, ep: int, location: int, clip: int,
                         shot: int, clip_version: int = None, shot_version: int = None) -> str:
        """Format shot-level shot name (without extension)."""
        name = f"ep{ep:03d}_scn{location:03d}_clip{clip:03d}"
        if clip_version and clip_version > 1:
            name += f"_{clip_version:03d}"
        name += f"_shot{shot:03d}"
        if shot_version and shot_version > 1:
            name += f"_{shot_version:03d}"
        return name

    @classmethod
    def extract_from_filename(cls, filename: str) -> Optional[Dict]:
        """
        Extract ep/scn/clip info from a video filename.
        Handles both standard names and arbitrary filenames containing the pattern.
        """
        # Try direct parse first
        result = cls.parse(filename)
        if result:
            return result

        # Try to find pattern in filename
        m = re.search(r'ep(\d{3})_scn(\d{3})_clip(\d{3})', filename, re.IGNORECASE)
        if m:
            return {
                'episode': int(m.group(1)),
                'location': int(m.group(2)),
                'clip': int(m.group(3)),
                'clip_version': None,
                'shot': None,
                'shot_version': None,
                'type': 'clip',
                'full_name': filename.replace('.mp4', '').replace('.json', ''),
            }

        return None


class VideoReviewPaths:
    """
    Manage video review path hierarchy (ep -> scn).

    Directory structure:
        output/
          ep001/
            scn001/
              ep001_scn001_clip001.mp4
              ep001_scn001_clip001.json
              ep001_scn001_clip001_002.mp4
              ep001_scn001_clip001_002.json
    """

    def __init__(self, output_root: str):
        """
        Initialize path manager.

        Args:
            output_root: Root output directory (e.g., "${PROJECT_DIR}/output/ep001" or absolute path)
        """
        self.output_root = Path(output_root)

    def get_ep_dir(self, episode: int) -> Path:
        """Get episode directory (output_root is already the episode directory)."""
        return self.output_root

    def get_scn_dir(self, episode: int, location: int) -> Path:
        """Get location directory."""
        return self.get_ep_dir(episode) / f"scn{location:03d}"

    def get_clip_dir(self, episode: int, location: int, clip: int) -> Path:
        """Get clip container directory.

        Clip outputs are stored directly under the scene directory.
        """
        return self.get_scn_dir(episode, location)

    def get_clip_file_prefix(self, ep: int, location: int, clip: int) -> str:
        """Get the filename prefix for one clip."""
        return VideoNameParser.format_clip_name(ep, location, clip)

    def get_clip_files(self, ep: int, location: int, clip: int, ext: str) -> list[Path]:
        """List existing files for one clip by extension."""
        clip_dir = self.get_clip_dir(ep, location, clip)
        if not clip_dir.exists():
            return []
        prefix = self.get_clip_file_prefix(ep, location, clip)
        return sorted(clip_dir.glob(f"{prefix}*{ext}"))

    def get_video_path(self, ep: int, location: int, clip: int,
                       version: int = None, ext: str = ".mp4") -> Path:
        """Get clip-level video file path."""
        clip_dir = self.get_clip_dir(ep, location, clip)
        name = VideoNameParser.format_clip_name(ep, location, clip, version)
        return clip_dir / f"{name}{ext}"

    def init_clip_dir(self, episode: int, location: int, clip: int) -> Path:
        """Create clip container directory if not exists, return its path."""
        clip_dir = self.get_clip_dir(episode, location, clip)
        clip_dir.mkdir(parents=True, exist_ok=True)
        return clip_dir

    def find_next_version(self, ep: int, location: int, clip: int) -> int:
        """
        Find the next available version number for a clip-level video.

        Scans existing files in the scene directory to determine the next version.

        Returns:
            Next version number (1 if no files exist, 2+ otherwise)
        """
        if not self.get_clip_dir(ep, location, clip).exists():
            return 1

        max_version = 0

        for f in self.get_clip_files(ep, location, clip, ".mp4"):
            parsed = VideoNameParser.parse(f.stem)
            if parsed and parsed['type'] == 'clip':
                v = parsed['clip_version'] or 1
                max_version = max(max_version, v)

        if max_version == 0:
            return 1
        return max_version + 1

    @staticmethod
    def get_review_workspace_dir(review_root, scn: int, clip: int, shot: int = None) -> Path:
        """构建 workspace review 层级路径。

        Args:
            review_root: review 根目录 (如 draft/ep001/review)
            scn: 场景号
            clip: 镜头号
            shot: shot 号（可选，None 表示 clip 级）

        Returns:
            clip 级: review_root/scn001/clip001/
            shot 级: review_root/scn001/clip001/shot001/
        """
        p = Path(review_root) / f"scn{scn:03d}" / f"clip{clip:03d}"
        if shot is not None:
            p = p / f"shot{shot:03d}"
        p.mkdir(parents=True, exist_ok=True)
        return p


def resolve_runtime_storyboard_path(
    output_path: Optional[str],
    output_root: str,
    episode: int,
) -> Path:
    """Resolve the runtime storyboard path for one episode.

    `output_path` may be either:
    - None                     -> use <output_root>/epNNN/epNNN_storyboard.json
    - a directory path         -> use <dir>/epNNN_storyboard.json
    - a concrete json filepath -> use it directly
    """
    if output_path:
        candidate = Path(output_path)
        if candidate.suffix.lower() == ".json":
            return candidate
        return candidate / f"ep{episode:03d}_storyboard.json"

    return Path(output_root) / f"ep{episode:03d}" / f"ep{episode:03d}_storyboard.json"


def prepare_runtime_storyboard_export(
    requested_storyboard_path: str,
    output_root: str,
    episode: int,
    allow_requested: bool = False,
) -> tuple[Path, str]:
    """Resolve the runtime storyboard path consumed by VIDEO stage.

    Priority:
    1. approved canonical storyboard under output/storyboard/approved/
    2. caller-provided storyboard path only when explicitly allowed

    The returned path is always the runtime export path inside output/epNNN/,
    because downstream VIDEO runtime mutates the storyboard JSON in place
    (for example writing `lsi` continuity data). Canonical storyboard files
    must therefore never be modified directly by VIDEO phase.
    """
    output_root_path = Path(output_root)
    runtime_path = output_root_path / f"ep{episode:03d}_storyboard.json"
    approved_path = output_root_path.parent / "storyboard" / "approved" / runtime_path.name
    requested_path = Path(requested_storyboard_path)

    if approved_path.exists():
        source_path = approved_path
        source_kind = "approved"
    elif allow_requested and requested_path.exists():
        source_path = requested_path
        source_kind = "requested"
    else:
        raise FileNotFoundError(
            f"Approved storyboard not found: {approved_path}. "
            "VIDEO requires output/storyboard/approved/epNNN_storyboard.json."
        )

    runtime_path.parent.mkdir(parents=True, exist_ok=True)

    if source_path.resolve() != runtime_path.resolve():
        if (not runtime_path.exists()) or source_path.read_bytes() != runtime_path.read_bytes():
            shutil.copyfile(source_path, runtime_path)
    elif not runtime_path.exists():
        raise FileNotFoundError(f"Runtime storyboard not found: {runtime_path}")

    try:
        runtime_data = json.loads(runtime_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Runtime storyboard {runtime_path} is not valid JSON: {exc}") from exc
    _validate_minimal_shots(runtime_data, str(runtime_path))

    return runtime_path, source_kind


def count_storyboard_generation_units(storyboard_data: dict) -> int:
    """Count shots[] across all scenes in approved storyboard."""
    return sum(len(scene.get("shots") or []) for scene in storyboard_data.get("scenes", []))


def download_video(url: str, save_path: str, timeout: int = 120) -> bool:
    """
    Download video from URL to local path.

    Args:
        url: Video URL to download
        save_path: Local file path to save
        timeout: Download timeout in seconds

    Returns:
        True if download succeeded
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"  [DOWNLOAD] {save_path.name}")
    print(f"  [URL] {url[:80]}...")

    try:
        # Create SSL context that doesn't verify (for internal APIs)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (video-review/6.0)'
        })

        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
            total_size = response.headers.get('Content-Length')
            if total_size:
                total_size = int(total_size)
                print(f"  [SIZE] {total_size / 1024 / 1024:.1f} MB")

            with open(save_path, 'wb') as f:
                downloaded = 0
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)

        print(f"  [OK] Saved: {save_path}")
        return True

    except Exception as e:
        print(f"  [FAIL] Download failed: {e}")
        # Clean up partial file
        if save_path.exists():
            save_path.unlink()
        return False
