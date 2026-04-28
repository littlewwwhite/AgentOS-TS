#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: runtime storyboard JSON, approved storyboard JSON, and video generation options
# output: generated video clips, delivery JSON, generation summary, and video task manifest
# pos: VIDEO stage batch entrypoint that bridges storyboard artifacts to aos-cli model generation
"""
Batch Video Generation from ep_storyboard.json

Reads prompts from ep_storyboard.json (simplified scenes[].shots[] or current scenes[].clips[]),
extracts subject references ({act_xxx}/{loc_xxx}), queries element_id
mapping via local assets or API, and generates videos using KeLing 3.0 Omni
subject reference mode.

Usage:
    python batch_generate.py <storyboard_json> --output <output_dir> --episode <num>

Example:
    python batch_generate.py \
      ${PROJECT_DIR}/output/ep001/ep001_storyboard.json \
      --output ${PROJECT_DIR}/output/ep001 \
      --episode 1

    # Dry run (parse only, no API calls):
    python batch_generate.py storyboard.json --output output/ep001 --dry-run
"""

import json
import os
import re
import sys
import time
import argparse
import threading
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

# Force unbuffered output so logs appear in real time
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# Add script directory to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from batch_generate_runtime import _process_scene_clips, process_scenes_parallel
from subject_resolver import resolve_subject_tokens
from production_types import ClipIntent
from video_api import DEFAULT_MODEL_CODE, image_path_to_data_uri
from path_manager import VideoReviewPaths, prepare_runtime_storyboard_export
from config_loader import get_generation_config, get_clip_review_config
from pipeline_state import ensure_state, update_episode, update_stage

# ============================================================
# Generation-Review Loop Constants (from config.json)
# ============================================================
_gen_cfg = get_generation_config()
MIN_GENERATION_ATTEMPTS = _gen_cfg.get("min_attempts", 1)
MAX_GENERATION_ATTEMPTS = _gen_cfg.get("max_attempts", 2)


# ============================================================
# JSON Loading
# ============================================================

def load_storyboard_json(json_path: str) -> dict:
    """Load ep_storyboard.json and return parsed data.

    Expected format: top-level 'scenes' with simplified 'shots' or current runtime 'clips'.

    Args:
        json_path: Path to ep_storyboard.json

    Returns:
        Parsed JSON dict with scenes, clips, etc.
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if 'scenes' not in data:
        raise ValueError(f"Invalid storyboard JSON: missing 'scenes' key in {json_path}")

    return data


def iter_clips(data: dict) -> list:
    """Iterate all generation units from storyboard JSON.

    Each shot in `scene.shots[]` is one generation unit. Required shot fields:
    `id` (e.g. "scn_001_clip001"), `duration` (int seconds), `prompt` (str).

    Returns one dict per shot — the runtime no longer produces multiple prompt
    versions per shot.
    """
    result = []
    for scene in data['scenes']:
        scene_id = scene['scene_id']
        scene_actors = [a['actor_id'] for a in scene.get('actors', [])]
        locations = scene.get('locations') or []
        scene_location = locations[0]['location_id'] if locations else ''

        for shot in scene.get('shots') or scene.get('clips') or []:
            shot_id = shot.get('id') or shot.get('clip_id')
            if not shot_id:
                raise KeyError(f"shot in {scene_id} missing id")
            normalized_clip_id = re.sub(r'[_\-]', '', shot_id)
            normalized_clip_id = re.sub(r'(scn\d+)(clip\d+)', r'\1_\2', normalized_clip_id)

            prompt_text = shot.get('prompt')
            if not prompt_text:
                raise KeyError(f"shot {shot_id} missing prompt")
            duration = shot.get('duration')
            if not isinstance(duration, int) or isinstance(duration, bool):
                raise ValueError(f"shot {shot_id} duration must be int, got {duration!r}")

            lsi_dict = shot.get('lsi') or {}
            result.append({
                'clip_id': normalized_clip_id,
                'scene_id': scene_id,
                'full_prompts': prompt_text,
                'duration_seconds': duration,
                'actors': scene_actors,
                'location': scene_location,
                'prompt_version': 0,
                'lsi_url': lsi_dict.get('url', '') or '',
                'lsi_video_url': lsi_dict.get('video_url', '') or '',
            })

    return result


# ============================================================
# Subject Extraction from {id} placeholders and 【】 brackets
# ============================================================

# Pattern: matches @act_xxx / {act_xxx} / @loc_xxx / {loc_xxx} / @prp_xxx / {prp_xxx}
# Storyboard skill v1.5.0+ may append :st_xxx for state-aware actor refs:
#   @act_001:st_002 → actor act_001 in state st_002
# Storyboard skill v1.4.0 emits @-form; legacy storyboards still use {-form.
# Note: prop ids use the `prp_` prefix to match asset-gen / props.json conventions.
_SUBJECT_ID_PATTERN = re.compile(r'[@{]((?:act|loc|prp)_\d+(?::st_\d+)?)\}?')

# Legacy patterns: matches 【xxx】 or 【xxx（yyy）】
_SUBJECT_PATTERN = re.compile(r'【([^】]+)】')
_PAREN_SUFFIX = re.compile(r'[（(].+?[）)]$')


def extract_subject_ids(full_prompt: str) -> List[str]:
    """Extract all unique subject IDs from @ or {} forms in prompt.

    Accepted forms (per storyboard skill v1.4.0): @act_xxx, @loc_xxx,
    @prp_xxx, plus legacy {act_xxx}/{loc_xxx}/{prp_xxx} for back-compat.

    Examples:
    - "@act_001 站在演武场中央" -> ["act_001"]
    - "@act_001 和 @act_002 在 @loc_003 对话" -> ["act_001", "act_002", "loc_003"]
    - "{act_001} 与 @prp_004" -> ["act_001", "prp_004"]

    Args:
        full_prompt: The full_prompts string from ep_storyboard.json

    Returns:
        De-duplicated list of subject IDs (preserving order)
    """
    return list(dict.fromkeys(_SUBJECT_ID_PATTERN.findall(full_prompt)))




def convert_prompt_brackets(full_prompt: str) -> str:
    """Convert 【xxx】 and 【xxx（yyy）】 in prompt to {base_name} placeholders.

    Transforms:
    - 【钟离书雨（重伤血衣）】 -> {钟离书雨}
    - 【诛仙台】 -> {诛仙台}

    Args:
        full_prompt: Original full_prompts with 【】 brackets

    Returns:
        Prompt with {name} placeholders for video_api
    """
    def _replace(m):
        raw = m.group(1)
        base_name = _PAREN_SUFFIX.sub('', raw).strip()
        return f'{{{base_name}}}'

    return _SUBJECT_PATTERN.sub(_replace, full_prompt)


# ============================================================
# Subject ID Mapping (file-based from project output)
# ============================================================


def find_assets_dir(start_dir: str) -> Optional[Path]:
    """Auto-detect directory containing actors/ and locations/ by searching upward.

    Checks PROJECT_DIR env var first, then walks up from start_dir.
    Handles both nested (current/output/actors/) and flat (current/actors/) layouts.

    Args:
        start_dir: Starting directory to search from

    Returns:
        Path to directory containing actors/, locations/, or None if not found
    """
    def _has_actors(d: Path) -> bool:
        return d.is_dir() and (d / "actors").exists()

    # First try PROJECT_DIR env var
    project_dir = os.environ.get('PROJECT_DIR')
    if project_dir:
        pdir = Path(project_dir)
        if _has_actors(pdir / "output"):
            return pdir / "output"
        if _has_actors(pdir):
            return pdir

    # Fall back to searching upward
    current = Path(start_dir).resolve()
    for _ in range(10):
        if _has_actors(current / "output"):
            return current / "output"
        if _has_actors(current):
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def _find_actor_subject_id(actor_data: dict) -> str:
    """Find subject_id from actor data by searching all state keys.

    Actor structure: {"name": "...", "voice": "...", "<state_key>": {"subject_id": "...", ...}}
    The state key can be "default", "中药", or any custom name.
    Skips known non-state keys: "name", "voice".

    Returns:
        subject_id string, or empty string if not found
    """
    for key, value in actor_data.items():
        if key in ("name", "voice"):
            continue
        if isinstance(value, dict) and value.get("subject_id"):
            return value["subject_id"]
    return ""


def _find_actor_image_url(actor_data: dict) -> str:
    """Find image url from actor data by searching all state keys.

    Priority: three_view_url > main_url

    Returns:
        image url string, or empty string if not found
    """
    for key, value in actor_data.items():
        if key in ("name", "voice"):
            continue
        if isinstance(value, dict):
            url = value.get("three_view_url") or value.get("main_url")
            if url:
                return url
    return ""



def _coerce_asset_url(url: str, fallback_rel_path: str, assets_base: Path) -> str:
    """Convert a file:// asset URL to a usable URL for the video API.

    Priority:
    1. If url is already http(s) or data: → return as-is
    2. If url starts with file:// → try converting the actual local asset file
       (using fallback_rel_path relative to project root, since temp _temp/ may be gone)
    3. If no usable URL found → return empty string
    """
    if not url:
        return url
    if url.startswith(("http://", "https://", "data:")):
        return url
    if url.startswith("file://"):
        # Try the fallback relative path first (more reliable than _temp/)
        if fallback_rel_path:
            candidate = (assets_base.parent / fallback_rel_path).resolve()
            if candidate.exists():
                try:
                    return image_path_to_data_uri(candidate)
                except Exception:
                    pass
        # Try extracting local path from file:// URL
        local_path = Path(url[7:])  # strip file://
        if local_path.exists():
            try:
                return image_path_to_data_uri(local_path)
            except Exception:
                pass
        return ""
    return url


def load_assets_subject_mapping(assets_dir: str) -> Dict[str, Dict]:
    """Load subject mapping from output/actors/actors.json and locations/locations.json.

    Actor subject_id is nested under a state key (e.g. "default", "中药").
    Location subject_id is at the top level of each location entry.

    Args:
        assets_dir: Path to output/ directory

    Returns:
        Dict mapping id (e.g., "act_001", "loc_001") to:
        {"subject_id": str, "name": str, "type": "actor"|"location", "image_url": str}
        image_url: face_view_url for actors, main_url for locations
    """
    mapping = {}
    assets_path = Path(assets_dir)

    # Load actors from actors/actors.json
    actors_file = assets_path / "actors" / "actors.json"
    if actors_file.exists():
        with open(actors_file, 'r', encoding='utf-8') as f:
            actors = json.load(f)
        actor_count = 0
        state_count = 0
        for actor_id, actor_data in actors.items():
            name = actor_data.get("name", actor_id)
            # Default entry (used for bare @act_xxx tokens)
            subject_id = _find_actor_subject_id(actor_data)
            image_url = _find_actor_image_url(actor_data)
            fallback_path = ""
            for key, value in actor_data.items():
                if key in ("name", "voice", "voice_url", "states") or not isinstance(value, dict):
                    continue
                fallback_path = value.get("three_view") or value.get("face_view") or ""
                break
            image_url = _coerce_asset_url(image_url, fallback_path, assets_path)
            if subject_id or image_url:
                mapping[actor_id] = {
                    "subject_id": subject_id,
                    "name": name,
                    "type": "actor",
                    "image_url": image_url,
                }
                actor_count += 1
            else:
                print(f"  [WARN] Actor '{actor_id}' ({name}) has no subject_id or image_url, skipping",
                      file=sys.stderr)

            # State-specific entries (used for @act_xxx:st_yyy tokens)
            states_map = actor_data.get("states") or {}
            if not isinstance(states_map, dict):
                states_map = {}
            for state_id, state_entry in states_map.items():
                if not isinstance(state_entry, dict) or not state_id:
                    continue
                st_subject = state_entry.get("subject_id", "")
                st_url = state_entry.get("three_view_url") or state_entry.get("face_view_url", "")
                st_fallback = state_entry.get("three_view") or state_entry.get("face_view") or ""
                st_url = _coerce_asset_url(st_url, st_fallback, assets_path)
                if not (st_subject or st_url):
                    continue
                mapping[f"{actor_id}:{state_id}"] = {
                    "subject_id": st_subject,
                    "name": f"{name}({state_entry.get('state_name', state_id)})",
                    "type": "actor",
                    "image_url": st_url,
                }
                state_count += 1
        print(f"[ASSETS] Loaded {actor_count} actors + {state_count} actor-state aliases from {actors_file}")
    else:
        print(f"[WARN] actors.json not found: {actors_file}", file=sys.stderr)

    # Load locations from locations/locations.json
    locations_file = assets_path / "locations" / "locations.json"
    if locations_file.exists():
        with open(locations_file, 'r', encoding='utf-8') as f:
            locations_data = json.load(f)
        loc_count = 0
        for loc_id, loc_data in locations_data.items():
            subject_id = loc_data.get("subject_id", "")
            image_url = loc_data.get("three_view_url") or loc_data.get("main_url", "")
            name = loc_data.get("name", loc_id)
            fallback_path = loc_data.get("three_view") or loc_data.get("main") or ""
            image_url = _coerce_asset_url(image_url, fallback_path, assets_path)
            if subject_id or image_url:
                mapping[loc_id] = {
                    "subject_id": subject_id,
                    "name": name,
                    "type": "location",
                    "image_url": image_url,
                }
                loc_count += 1
            else:
                print(f"  [WARN] Location '{loc_id}' ({name}) has no subject_id or image_url, skipping",
                      file=sys.stderr)
        print(f"[ASSETS] Loaded {loc_count} locations from {locations_file}")
    else:
        print(f"[WARN] locations.json not found: {locations_file}", file=sys.stderr)

    # Load props from props/props.json
    props_file = assets_path / "props" / "props.json"
    if props_file.exists():
        with open(props_file, 'r', encoding='utf-8') as f:
            props_data = json.load(f)
        prop_count = 0
        for prop_id, prop_data in props_data.items():
            subject_id = prop_data.get("subject_id", "")
            image_url = (
                prop_data.get("three_view_url")
                or prop_data.get("main_url")
                or prop_data.get("image_url", "")
            )
            name = prop_data.get("name", prop_id)
            fallback_path = prop_data.get("three_view") or prop_data.get("main") or ""
            image_url = _coerce_asset_url(image_url, fallback_path, assets_path)
            if subject_id or image_url:
                mapping[prop_id] = {
                    "subject_id": subject_id,
                    "name": name,
                    "type": "prop",
                    "image_url": image_url,
                }
                prop_count += 1
            else:
                print(f"  [WARN] Prop '{prop_id}' ({name}) has no subject_id or image_url, skipping",
                      file=sys.stderr)
        print(f"[ASSETS] Loaded {prop_count} props from {props_file}")
    else:
        print(f"[INFO] props.json not found: {props_file} (props/* tokens will pass through unresolved)")

    return mapping


def map_subject_ids_to_images(
    subject_ids: List[str],
    assets_mapping: Dict[str, Dict],
) -> List[Dict]:
    """Map extracted subject IDs to reference image dicts using asset image URLs.

    Args:
        subject_ids: List of subject IDs (e.g., ["act_001", "loc_003"])
        assets_mapping: Dict from load_assets_subject_mapping()

    Returns:
        List of image dicts: [{"url": "https://...", "name": "act_001", "display_name": "钟离书雨"}]
        Only includes subjects that have image_url.
    """
    mapped = []
    for sid in subject_ids:
        entry = assets_mapping.get(sid)
        # Fallback: actor:state token → strip :state suffix when no state-specific entry
        if entry is None and ":st_" in sid:
            base = sid.split(":", 1)[0]
            fallback = assets_mapping.get(base)
            if fallback is not None:
                print(f"  [INFO] Subject ID '{sid}' has no state-specific entry; "
                      f"falling back to base '{base}'", file=sys.stderr)
                entry = fallback
        if entry is None:
            print(f"  [WARN] Subject ID '{sid}' not found in assets mapping, skipping",
                  file=sys.stderr)
            continue
        url = entry.get("image_url", "")
        if not url:
            print(f"  [WARN] Subject ID '{sid}' ({entry.get('name', sid)}) has no image_url, skipping",
                  file=sys.stderr)
            continue
        mapped.append({
            "url": url,
            "name": sid,
            "display_name": entry.get("name", sid),
            "subject_id": entry.get("subject_id", ""),
        })
    return mapped


# ============================================================
# Video Generation
# ============================================================

def parse_clip_id(ls_id: str) -> Tuple[int, int]:
    """Parse clip_id like 'scn001_clip001' into (location, clip) numbers.

    Args:
        ls_id: e.g., "scn001_clip001"

    Returns:
        (location_num, clip_num) tuple, e.g., (1, 1)
    """
    m = re.match(r'scn(\d+)_clip(\d+)', ls_id, re.IGNORECASE)
    if not m:
        raise ValueError(f"Cannot parse clip_id: {ls_id}")
    return int(m.group(1)), int(m.group(2))


def _select_default_clip_entries(clips: List[dict]) -> List[dict]:
    """Keep only the first prompt variant for each clip on the default path."""
    selected = []
    seen_clip_ids = set()
    for clip in clips:
        clip_id = clip["clip_id"]
        if clip_id in seen_clip_ids:
            print(
                f"  [INFO] {clip_id} legacy prompt_version={clip.get('prompt_version', 0)} "
                "ignored by default single-shot path"
            )
            continue
        seen_clip_ids.add(clip_id)
        selected.append(clip)
    return selected


# ============================================================
# Cleanup for Re-run
# ============================================================

def _clean_clip_data(paths: VideoReviewPaths, episode: int, location_num: int, clip_num: int):
    """
    清除指定 clip 的所有已有数据（视频、元数据、workspace 任务文件），
    用于重跑时从干净状态开始。
    """
    # 1. 清除当前 clip 对应的输出文件（.mp4 + .json）
    clip_dir = paths.get_clip_dir(episode, location_num, clip_num)
    if clip_dir.exists():
        removed = []
        for suffix in ('.mp4', '.json'):
            for f in paths.get_clip_files(episode, location_num, clip_num, suffix):
                f.unlink()
                removed.append(f.name)
        if removed:
            print(
                f"  [CLEAN] 已清除 {len(removed)} 个旧文件: "
                f"scn{location_num:03d}/clip{clip_num:03d}"
            )

    # 2. 清除 workspace 任务文件
    workspace_tasks_dir = (
        paths.output_root.parent.parent / "workspace" / paths.output_root.name
        / f"scn{location_num:03d}" / f"clip{clip_num:03d}"
    )
    if workspace_tasks_dir.exists():
        ws_removed = 0
        for f in workspace_tasks_dir.iterdir():
            if f.is_file() and f.suffix == '.json':
                f.unlink()
                ws_removed += 1
        if ws_removed:
            print(f"  [CLEAN] 已清除 {ws_removed} 个 workspace 任务文件")


def _build_video_task_manifest(
    *,
    episode: int,
    source_json: Path,
    runtime_json_path: Path,
    results: List[Dict],
    generated_at: str,
) -> Dict:
    tasks = []
    for result in results:
        for version in result.get("versions", []):
            output_path = version.get("output_path") or version.get("video_path")
            tasks.append(
                {
                    "episode": episode,
                    "scene_id": result.get("scene_id"),
                    "clip_id": result.get("clip_id"),
                    "shot_id": result.get("clip_id"),
                    "prompt_version": result.get("prompt_version", 0) + 1,
                    "version": version.get("version"),
                    "success": bool(version.get("success")),
                    "passed": bool(version.get("passed")),
                    "requested_duration_seconds": version.get(
                        "requested_duration_seconds"
                    ),
                    "actual_duration_seconds": version.get("actual_duration_seconds"),
                    "provider_task_id": version.get("provider_task_id")
                    or version.get("task_id"),
                    "provider": version.get("provider"),
                    "model_code": version.get("model_code"),
                    "output_path": output_path,
                }
            )

    return {
        "schema_version": "video-task-manifest/v1",
        "episode": episode,
        "source_json": str(source_json),
        "runtime_storyboard_json": str(runtime_json_path),
        "generated_at": generated_at,
        "tasks": tasks,
    }


# ============================================================
# Batch Generation Entry Point
# ============================================================

def run_batch_generate(
    json_path: str,
    output_root: str,
    episode: int,
    mapping_file: str = None,
    model_code: str = DEFAULT_MODEL_CODE,
    quality: str = "720",
    ratio: str = "16:9",
    timeout: int = 1830,
    poll_interval: int = 10,
    dry_run: bool = False,
    shot_filter: str = None,
    gemini_api_key: str = None,
    skip_review: bool = False,
    resume: bool = False,
    no_ref: bool = False,
) -> list:
    """Main entry: iterate all clips and generate videos.

    Args:
        json_path: Path to ep_shots.json
        output_root: Root output directory (e.g., output/ep001)
        episode: Episode number
        mapping_file: Optional path to subject_mapping.json
        model_code: Model code for API
        quality: Video quality
        ratio: Aspect ratio (e.g. "9:16", "16:9", "1:1")
        timeout: Per-video generation timeout
        poll_interval: Polling interval
        dry_run: If True, parse and print but don't call API
        shot_filter: Optional filter like "scn001_clip001" to generate specific shot only
        resume: If True, skip clips that already have .mp4 files (checkpoint mode)

    Returns:
        List of generation result dicts
    """
    print(f"{'='*60}")
    print(f"BATCH VIDEO GENERATION")
    print(f"{'='*60}")
    runtime_json_path, storyboard_source_kind = prepare_runtime_storyboard_export(
        json_path,
        output_root,
        episode,
    )
    output_root_path = Path(output_root)
    project_root = Path(os.environ.get('PROJECT_DIR', output_root_path.parent.parent)).resolve()
    runtime_relative = runtime_json_path.resolve().relative_to(project_root).as_posix()
    episode_key = f"ep{episode:03d}"

    if not dry_run:
        ensure_state(str(project_root))
        update_stage(str(project_root), "VIDEO", "running", next_action="enter VIDEO")
        update_episode(
            str(project_root),
            episode_key,
            "video",
            "partial",
            artifact=runtime_relative,
        )

    print(f"JSON: {json_path}")
    print(f"Runtime JSON: {runtime_json_path}")
    print(f"Storyboard source: {storyboard_source_kind}")
    print(f"Output: {output_root}")
    print(f"Episode: {episode}")
    print(f"Model: {model_code}")
    print(f"Dry run: {'YES' if dry_run else 'NO'}")

    # 1. Load shots JSON
    data = load_storyboard_json(str(runtime_json_path))
    clips = iter_clips(data)
    print(f"Found {len(clips)} clips")

    # Apply filter if specified
    if shot_filter:
        clips = [ls for ls in clips if ls['clip_id'] == shot_filter]
        print(f"Filtered to {len(clips)} clips (filter: {shot_filter})")

    clips = _select_default_clip_entries(clips)
    print(f"Using {len(clips)} clips in default single-shot path")

    if not clips:
        print("[WARN] No clips to process")
        return []

    # 2. Build element mapping from output/ assets
    print(f"[INFO] 参考模式: 图片参考 (model={model_code})")
    assets_dir = find_assets_dir(output_root)
    assets_mapping = {}

    if no_ref:
        print("[INFO] no_ref=True: skipping all reference images (plain-text prompt mode).")
    elif assets_dir:
        print(f"[MAP] Found assets directory: {assets_dir}")
        assets_mapping = load_assets_subject_mapping(str(assets_dir))
        print(f"[MAP] Loaded {len(assets_mapping)} subjects from local assets")
    else:
        print(f"[WARN] output/actors directory not found")
        print("[INFO] Will generate without subject references (plain text mode).")

    # 3. Phase 1: Parallel generation with review loop
    paths = VideoReviewPaths(output_root)
    total = len(clips)
    results = []

    print(f"\n{'='*60}")
    print(f"PHASE 1: SINGLE-SHOT GENERATE ({total} clips)")
    print(f"  default path: intent -> compile -> generate once -> continuity update")
    print(f"{'='*60}")

    if dry_run:
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)
            prompt_with_indices, resolved_refs = resolve_subject_tokens(
                ls['full_prompts'], assets_mapping
            )
            print(f"  [{ls_id}] pv={pv} [DRY-RUN] Skipping")
            results.append({
                "clip_id": ls_id,
                "scene_id": scene_id,
                "prompt_version": pv,
                "prompt": convert_prompt_brackets(prompt_with_indices),
                "success": True,
                "dry_run": True,
                "subjects_found": len(extract_subject_ids(ls['full_prompts'])),
                "subjects_mapped": len(resolved_refs),
            })
    else:
        # ── Pre-process all clips ──
        clip_states = []
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)

            # Default per-clip mode: reference_image (subject binding via [图N]).
            # Continuity from the previous clip is appended as another
            # reference_image (role=reference_image) plus a reference_video, so
            # we never trigger Ark Seedance 2.0's content[] mode-mutex
            # ("first/last frame content cannot be mixed with reference media
            # content"). The first_frame channel remains opt-in via direct
            # video_api calls.
            lsi_url_raw = (ls.get('lsi_url') or '').strip()
            usable_lsi = bool(lsi_url_raw) and lsi_url_raw.startswith(
                ('http://', 'https://', 'data:')
            )
            if lsi_url_raw and not usable_lsi:
                print(
                    f"  [{ls_id}] [WARN] lsi.url 既非 http(s) 也非 data URI，跳过续帧: {lsi_url_raw[:60]}",
                    file=sys.stderr,
                )

            subject_ids = extract_subject_ids(ls['full_prompts'])
            prompt_with_indices, reference_images = resolve_subject_tokens(
                ls['full_prompts'], assets_mapping
            )
            if reference_images:
                print(
                    f"  [{ls_id}] reference mode: {len(reference_images)}/{len(subject_ids)} 参考图映射 [图N]"
                )
            clip_first_frame_url: Optional[str] = lsi_url_raw if usable_lsi else None
            if clip_first_frame_url:
                print(
                    f"  [{ls_id}] 跨次续帧（lsi.url）将作为追加 reference_image 注入: "
                    f"{clip_first_frame_url[:60]}"
                )
            lsi_video_url_raw = (ls.get('lsi_video_url') or '').strip()
            usable_lsi_video = bool(lsi_video_url_raw) and lsi_video_url_raw.startswith(
                ('http://', 'https://')
            )
            clip_prev_video_url: Optional[str] = (
                lsi_video_url_raw if usable_lsi_video else None
            )
            if clip_prev_video_url:
                print(
                    f"  [{ls_id}] 跨次续接视频（lsi.video_url）将作为 reference_video 注入: "
                    f"{clip_prev_video_url[:60]}"
                )

            prompt = convert_prompt_brackets(prompt_with_indices)
            duration_value = ls['duration_seconds']
            if not isinstance(duration_value, int) or isinstance(duration_value, bool):
                raise ValueError(
                    f"clip {ls_id} duration_seconds must be int from iter_clips, got {duration_value!r}"
                )
            dur_api = duration_value
            location_num, clip_num = parse_clip_id(ls_id)

            # Resume mode: skip clips that already have .mp4 output files
            if resume:
                clip_dir = paths.get_clip_dir(episode, location_num, clip_num)
                existing_mp4s = paths.get_clip_files(episode, location_num, clip_num, ".mp4")
                if clip_dir.exists() and existing_mp4s:
                    mp4_count = len(existing_mp4s)
                    print(f"  [{ls_id}] [resume] Skipping {ls_id} — video already exists ({mp4_count} file(s))")
                    results.append({
                        "clip_id": ls_id,
                        "scene_id": scene_id,
                        "prompt_version": pv,
                        "prompt": prompt,
                        "success": True,
                        "passed": True,
                        "skipped_resume": True,
                    })
                    continue

            # Clean up existing data
            _clean_clip_data(paths, episode, location_num, clip_num)

            intent = ClipIntent(
                clip_id=ls_id,
                scene_id=scene_id,
                prompt_text=prompt,
                duration_seconds=dur_api,
                subject_ids=subject_ids,
                subjects=[],
                reference_images=list(reference_images or []),
                first_frame_url=clip_first_frame_url,
                prev_video_url=clip_prev_video_url,
                location_num=location_num,
                clip_num=clip_num,
            )

            clip_states.append({
                'ls': ls,
                'intent': intent,
                'ls_id': ls_id,
                'scene_id': scene_id,
                'prompt_version': 0,
                'subjects': [],
                'reference_images': reference_images,
                'first_frame_url': clip_first_frame_url,
                'prompt': prompt,
                'dur_api': dur_api,
                'location_num': location_num,
                'clip_num': clip_num,
                'attempts': 0,
                'passed': False,
                'done': False,
                'versions': [],
                'best_version': None,
            })

        # ── 按场景分组，场景间并行，场景内 clip 顺序生成 ──
        from collections import defaultdict as _defaultdict
        scenes_clip_states: Dict[str, list] = _defaultdict(list)
        for clip in clip_states:
            scenes_clip_states[clip['scene_id']].append(clip)

        # lsi 增量写入锁：多场景线程并发时保护 data dict 和文件写操作
        json_lock = threading.Lock()

        print(f"\n{'='*60}")
        print(f"PHASE 1: 场景并行 / Clip 顺序生成 ({total} clips, {len(scenes_clip_states)} 个场景)")
        print(f"  同场景 clip 顺序处理，每个 clip 最后镜头首帧（人脸模糊）作为下一 clip 首帧参考")
        print(f"  不同场景并行处理，lsi 边生成边写入")
        print(f"{'='*60}")

        def process_scene(scene_id, clips):
            _process_scene_clips(
                scene_id, clips, episode, paths, model_code,
                quality, ratio, poll_interval, timeout, gemini_api_key,
                get_clip_review_config(), data, str(runtime_json_path), json_lock, skip_review,
            )

        def report_scene_error(scene_id, err):
            print(f"  [SCENE] {scene_id} 处理异常: {err}", file=sys.stderr)
            import traceback
            traceback.print_exception(type(err), err, err.__traceback__)

        process_scenes_parallel(
            scenes_clip_states,
            process_scene=process_scene,
            on_scene_complete=lambda scene_id: print(f"  [SCENE] {scene_id} 所有 clip 处理完成"),
            on_scene_error=report_scene_error,
        )

        # Build results from clip_states
        for clip in clip_states:
            results.append({
                "clip_id": clip['ls_id'],
                "scene_id": clip['scene_id'],
                "prompt_version": clip['prompt_version'],
                "prompt": clip['prompt'],
                "success": any(v.get("success") for v in clip['versions']),
                "passed": clip['passed'],
                "best_version": clip['best_version'],
                "attempts": len(clip['versions']),
                "versions": clip['versions'],
                "prev_frame_url": clip.get('prev_frame_url'),
                "prev_frame_description": clip.get('prev_frame_description'),
            })

    # 4. Print summary
    print(f"\n\n{'='*60}")
    print(f"BATCH GENERATION COMPLETE")
    print(f"{'='*60}")

    success_count = sum(1 for r in results if r.get('success', False))
    passed_count = sum(1 for r in results if r.get('passed', False))
    fail_count = total - success_count

    print(f"Total clips: {total}")
    print(f"Generated: {success_count}")
    print(f"Passed review: {passed_count}")
    print(f"Failed: {fail_count}")

    print(f"\n{'─'*60}")
    print(f"{'Shot':<15} {'Scene':<8} {'Gen':<5} {'Review':<8} {'Attempts':<8} {'Details'}")
    print(f"{'─'*60}")

    for r in results:
        ls_id = r.get('clip_id', '?')
        scene_id = r.get('scene_id', '?')
        gen_status = "OK" if r.get('success') else "FAIL"
        review_status = "PASS" if r.get('passed') else ("N/A" if r.get('dry_run') else "FAIL")
        attempts = r.get('attempts', 0)
        if r.get('dry_run'):
            detail = f"dry-run, {r.get('subjects_mapped', 0)}/{r.get('subjects_found', 0)} subjects mapped"
        elif r.get('best_version'):
            detail = f"best=v{r['best_version']:03d}"
        else:
            detail = ""
        print(f"{ls_id:<15} {scene_id:<8} {gen_status:<5} {review_status:<8} {attempts:<8} {detail}")

    print(f"{'─'*60}")

    # Save generation summary to workspace directory (not output)
    # output_root is ${PROJECT_DIR}/output/ep001 → project root is two levels up
    ep_name = output_root_path.name              # ep001
    workspace_dir = project_root / "workspace" / ep_name
    workspace_dir.mkdir(parents=True, exist_ok=True)
    summary_path = workspace_dir / f"ep{episode:03d}_generation_summary.json"
    task_manifest_path = output_root_path / f"ep{episode:03d}_video_task_manifest.json"
    generated_at = datetime.now().isoformat()
    summary = {
        "episode": episode,
        "source_json": str(json_path),
        "runtime_storyboard_json": str(runtime_json_path),
        "video_task_manifest_json": str(task_manifest_path),
        "storyboard_source_kind": storyboard_source_kind,
        "total": total,
        "success": success_count,
        "failed": fail_count,
        "dry_run": dry_run,
        "model_code": model_code,
        "timestamp": generated_at,
        "results": results,
    }
    task_manifest = _build_video_task_manifest(
        episode=episode,
        source_json=Path(json_path),
        runtime_json_path=runtime_json_path,
        results=results,
        generated_at=generated_at,
    )
    with open(task_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(task_manifest, f, ensure_ascii=False, indent=2)
    print(f"[FILE] Video task manifest: {task_manifest_path}")

    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n[FILE] Summary: {summary_path}")

    # Generate delivery.json — SKILL.md format
    delivery_path = output_root_path / f"ep{episode:03d}_delivery.json"

    # Group results by scene_id -> clip_base -> pv
    from collections import defaultdict
    scenes_map = defaultdict(lambda: defaultdict(dict))  # scene_id -> clip_raw -> {pv: r}
    for r in results:
        scene_id = r.get("scene_id", "")
        ls_id = r.get("clip_id", "")
        clip_raw = ls_id.split('_', 1)[1] if '_' in ls_id else ls_id
        pv = r.get("prompt_version", 0)
        scenes_map[scene_id][clip_raw][pv] = r

    locations = []
    for scene_id in sorted(scenes_map.keys()):
        clips_out = []
        for clip_raw in sorted(scenes_map[scene_id].keys()):
            m = re.match(r'([a-z]+)(\d+)', clip_raw)
            clip_id = f"{m.group(1)}_{m.group(2)}" if m else clip_raw
            for pv in sorted(scenes_map[scene_id][clip_raw].keys()):
                r = scenes_map[scene_id][clip_raw][pv]
                # recommended: 通过评审的版本文件名，否则 null
                fname = None
                bv = r.get("best_version")
                if bv:
                    for v in r.get("versions", []):
                        if v.get("version") == bv and v.get("video_path"):
                            fname = Path(v["video_path"]).name
                            break
                clips_out.append({
                    "clip_id": clip_id,
                    "prompt_version": pv + 1,       # 1=v1, 2=v2，始终有值
                    "prompt": r.get("prompt", ""),  # 始终有值
                    "recommended": fname,
                    "shots": [fname] if fname else [],
                })
        locations.append({"scene_id": scene_id, "clips": clips_out})

    delivery = {
        "episode_id": f"ep_{episode:03d}",
        "locations": locations,
    }
    with open(delivery_path, 'w', encoding='utf-8') as f:
        json.dump(delivery, f, ensure_ascii=False, indent=2)
    print(f"[FILE] Delivery: {delivery_path}")

    if not dry_run:
        delivery_relative = delivery_path.resolve().relative_to(project_root).as_posix()
        if fail_count == 0 and success_count > 0:
            update_episode(
                str(project_root),
                episode_key,
                "video",
                "completed",
                artifact=delivery_relative,
            )
        update_stage(
            str(project_root),
            "VIDEO",
            "partial",
            next_action="review VIDEO",
            artifact=delivery_relative,
        )

    return results


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Batch Video Generation from ep_storyboard.json"
    )
    parser.add_argument(
        "json_path",
        help="Path to ep_storyboard.json"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output root directory (e.g., output/ep001)"
    )
    parser.add_argument(
        "--episode", "-e",
        type=int,
        default=1,
        help="Episode number (default: 1)"
    )
    parser.add_argument(
        "--mapping", "-m",
        default=None,
        help="Path to subject_mapping.json (fallback if API unavailable)"
    )
    parser.add_argument(
        "--model-code",
        default=DEFAULT_MODEL_CODE,
        help=f"Model code (default: {DEFAULT_MODEL_CODE})"
    )
    parser.add_argument(
        "--quality",
        default=_gen_cfg.get("default_quality", "720"),
        choices=["720", "1080"],
        help=f"Video quality (default: {_gen_cfg.get('default_quality', '720')})"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=_gen_cfg.get("poll_timeout", 1830),
        help=f"Poll timeout in seconds (default: {_gen_cfg.get('poll_timeout', 1830)})"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=_gen_cfg.get("poll_interval", 10),
        help=f"Polling interval in seconds (default: {_gen_cfg.get('poll_interval', 10)})"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print only, no API calls"
    )
    parser.add_argument(
        "--shot",
        default=None,
        help="Generate specific shot only (e.g., scn001_clip001)"
    )
    parser.add_argument(
        "--ratio",
        default=_gen_cfg.get("default_ratio", "16:9"),
        choices=["16:9", "9:16", "1:1"],
        help=f"Aspect ratio (default: {_gen_cfg.get('default_ratio', '16:9')})"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume mode: skip clips that already have .mp4 output files"
    )
    parser.add_argument(
        "--skip-review",
        action="store_true",
        help="Skip aos-cli video review, mark all generated clips as passed"
    )
    parser.add_argument(
        "--no-ref",
        dest="no_ref",
        action="store_true",
        help="Skip all reference images; use text-only prompt mode"
    )

    args = parser.parse_args()

    run_batch_generate(
        json_path=args.json_path,
        output_root=args.output,
        episode=args.episode,
        mapping_file=args.mapping,
        model_code=args.model_code,
        quality=args.quality,
        ratio=args.ratio,
        timeout=args.timeout,
        poll_interval=args.interval,
        dry_run=args.dry_run,
        shot_filter=args.shot,
        resume=args.resume,
        skip_review=args.skip_review,
        no_ref=getattr(args, "no_ref", False),
    )


if __name__ == "__main__":
    main()
