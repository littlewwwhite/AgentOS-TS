#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: runtime storyboard clips, provider submit/poll functions, and review config
# output: generated clip versions, delivery state, and continuity references
# pos: stateful VIDEO generation loop for video-gen
"""
Runtime helpers for batch video generation.

This module isolates the stateful generate/review/continuity loop from
`batch_generate.py` so the top-level entrypoint can stay focused on loading,
planning, and result assembly.
"""

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

from config_loader import (
    get_generation_config,
    get_gemini_config,
    get_video_model_config,
)
from evaluator import evaluate_from_gemini_analysis, is_video_qualified
from frame_extractor import (
    describe_frame_with_gemini,
    extract_last_shot_first_frame_blurred,
)
from production_types import ClipIntent, ContinuityContext
from request_compiler import compile_request
from sensitive_precheck import precheck_and_fix
from video_review_adapter import get_video_analysis
from video_api import (
    _cos_relative_url,
    get_subject_reference_for_model,
    poll_multiple_tasks,
    submit_video,
    upload_to_cos,
)

_gen_cfg = get_generation_config()
MIN_GENERATION_ATTEMPTS = _gen_cfg.get("min_attempts", 1)
MAX_GENERATION_ATTEMPTS = _gen_cfg.get("max_attempts", 2)


def upload_frame_to_cos(png_path: str) -> Optional[str]:
    """Upload the last-shot first-frame PNG to COS and return the relative URL."""
    cos_url = upload_to_cos(png_path, "first_frame")
    if cos_url is None:
        return None
    return _cos_relative_url(cos_url)


def _save_clip_result(
    clip,
    version,
    actual_path,
    task_id,
    video_url,
    last_frame_url,
    passed,
    analysis_dict,
    review_dict,
    requested_duration_seconds=None,
    actual_duration_seconds=None,
    provider=None,
    model_code=None,
):
    """Update one clip's in-memory review state."""
    clip["versions"].append(
        {
            "version": version,
            "attempt": clip["attempts"],
            "prompt_version": clip["prompt_version"],
            "prompt": clip["prompt"],
            "success": True,
            "passed": passed,
            "video_path": actual_path,
            "output_path": actual_path,
            "video_url": video_url,
            "last_frame_url": last_frame_url,
            "task_id": task_id,
            "provider_task_id": task_id,
            "provider": provider,
            "model_code": model_code,
            "requested_duration_seconds": requested_duration_seconds,
            "actual_duration_seconds": actual_duration_seconds,
            "total_score": review_dict.get("total_score"),
            "analysis": analysis_dict,
            "review": review_dict,
        }
    )
    if passed:
        clip["best_version"] = version
        clip["passed"] = True


def _review_single_clip(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: str,
    output_dir: str,
) -> Tuple[bool, Dict, Dict]:
    """Review a single generated clip through aos-cli video.analyze and flatten the result."""
    print(f"  [REVIEW] aos-cli video.analyze 评审: {segment_id}")

    try:
        analysis_result, _ = get_video_analysis(
            video_path=video_path,
            segment_id=segment_id,
            expected_duration=expected_duration,
            original_prompt=original_prompt,
            output_dir=output_dir,
            force_reanalyze=True,
        )

        parallel_results = analysis_result.get("parallel_results", {})
        flat_analysis = {
            "segment_id": segment_id,
            "reference_consistency": parallel_results.get("reference_consistency", {}),
            "prompt_compliance": parallel_results.get("prompt_compliance", {}),
        }

        evaluation = evaluate_from_gemini_analysis(flat_analysis)
        passed, failed_dims = is_video_qualified(evaluation)

        status_str = "PASS" if passed else f"FAIL ({', '.join(failed_dims)})"
        scores = evaluation.get("scores", {})
        print(f"  [REVIEW] 结果: {status_str} | 总分: {scores.get('total', 0)}/20")

        review_dict = {
            "dimensions": {
                "reference_consistency": scores.get("reference_consistency", 0),
                "prompt_compliance": scores.get("prompt_compliance", 0),
            },
            "total_score": scores.get("total", 0),
            "failed_dimensions": failed_dims,
        }

        return passed, flat_analysis, review_dict
    except Exception as err:
        print(f"  [REVIEW] 评审失败: {err}")
        import traceback

        traceback.print_exc()
        return False, {}, {"error": str(err)}


def _run_generation_rounds(
    clip_group: list,
    episode: int,
    paths,
    model_code: str,
    quality: str,
    ratio: str,
    poll_interval: int,
    timeout: int,
    gemini_api_key: Optional[str],
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    prev_video_url: Optional[str] = None,
    on_first_video_ready: Optional[callable] = None,
    skip_review: bool = False,
) -> Tuple[Optional[str], Optional[str]]:
    """Run the default single-shot path for one logical clip."""

    pending = [clip for clip in clip_group if not clip["done"]]
    if not pending:
        return None, None

    print(
        f"\n  [GENERATE] {len(pending)} 个 clip 单次提交 "
        f"(首帧: {'有' if first_frame_url else '无'})"
    )

    submitted = []
    for clip in pending:
        intent = clip.get("intent") or ClipIntent(
            clip_id=clip["ls_id"],
            scene_id=clip["scene_id"],
            prompt_text=clip["prompt"],
            duration_seconds=int(clip["dur_api"]),
            subject_ids=[],
            subjects=list(clip.get("subjects") or []),
            reference_images=list(clip.get("reference_images") or []),
            location_num=clip["location_num"],
            clip_num=clip["clip_num"],
        )
        continuity = ContinuityContext(
            first_frame_url=first_frame_url,
            first_frame_text=first_frame_text,
            prev_video_url=prev_video_url,
        )
        request = compile_request(
            intent=intent,
            continuity=continuity,
            model_code=model_code,
            quality=quality,
            ratio=ratio,
        )

        version = 1
        video_path = paths.get_video_path(
            episode, intent.location_num, intent.clip_num, version
        )
        paths.init_clip_dir(episode, intent.location_num, intent.clip_num)

        can_submit, safe_prompt, _subs = precheck_and_fix(
            request.prompt, clip_id=clip["ls_id"]
        )
        clip["attempts"] += 1
        if not can_submit:
            clip["done"] = True
            clip["versions"].append(
                {
                    "version": version,
                    "attempt": clip["attempts"],
                    "success": False,
                    "passed": False,
                    "message": "Skipped: residual sensitive words after auto-replace",
                }
            )
            continue

        submit_result = submit_video(
            prompt=safe_prompt,
            model_code=model_code,
            subjects=request.subjects or None,
            reference_images=request.reference_images or None,
            duration=str(request.duration_seconds),
            quality=request.quality,
            ratio=request.ratio,
            first_frame_url=request.first_frame_url,
            first_frame_text=None,
            reference_videos=None,
        )

        if submit_result["success"]:
            task_id = submit_result["task_id"]
            print(f"    [{clip['ls_id']}] 已提交 v{version:03d} task_id={task_id}")
            submitted.append(
                {
                    "clip": clip,
                    "task_id": task_id,
                    "output_path": str(video_path),
                    "version": version,
                    "provider": submit_result.get("provider"),
                    "model_code": submit_result.get("model_code") or model_code,
                    "task_envelope": submit_result.get("task_envelope"),
                }
            )
        else:
            message = submit_result.get("message", "unknown")
            print(f"    [{clip['ls_id']}] 提交失败: {message}")
            clip["done"] = True
            clip["versions"].append(
                {
                    "version": version,
                    "attempt": clip["attempts"],
                    "success": False,
                    "passed": False,
                    "message": message,
                }
            )

    if not submitted:
        return None, None

    print(f"    [POLL] 等待 {len(submitted)} 个视频...")
    poll_tasks = [
        {
            "task_id": item["task_id"],
            "output_path": item["output_path"],
            "provider": item.get("provider"),
            "model_code": item.get("model_code"),
            "task_envelope": item.get("task_envelope"),
        }
        for item in submitted
    ]
    poll_results = poll_multiple_tasks(
        tasks=poll_tasks,
        interval=poll_interval,
        timeout=timeout,
    )

    poll_map = {}
    if poll_results:
        for poll_result in poll_results:
            for submitted_item in submitted:
                if submitted_item["output_path"] == poll_result.get("output_path"):
                    poll_map[submitted_item["clip"]["ls_id"]] = poll_result
                    break

    review_items = []
    for submitted_item in submitted:
        clip = submitted_item["clip"]
        version = submitted_item["version"]
        poll_result = poll_map.get(clip["ls_id"], {})
        gen_success = poll_result.get("success", False)
        actual_path = poll_result.get("video_path")

        if not gen_success:
            message = poll_result.get("message", "generation failed or timeout")
            print(f"    [{clip['ls_id']}] v{version:03d} 生成失败: {message}")
            clip["done"] = True
            clip["versions"].append(
                {
                    "version": version,
                    "attempt": clip["attempts"],
                    "success": False,
                    "passed": False,
                    "message": message,
                }
            )
            continue

        print(f"    [{clip['ls_id']}] v{version:03d} 生成成功")
        review_items.append(
            {
                "clip": clip,
                "version": version,
                "actual_path": actual_path,
                "task_id": submitted_item["task_id"],
                "provider": submitted_item.get("provider"),
                "model_code": submitted_item.get("model_code"),
                "video_url": poll_result.get("video_url"),
                "last_frame_url": poll_result.get("last_frame_url"),
                "requested_duration_seconds": clip["dur_api"],
                "actual_duration_seconds": poll_result.get("actual_duration_seconds"),
            }
        )

    if on_first_video_ready and review_items:
        first_ready_path = review_items[0]["actual_path"]
        if first_ready_path:
            try:
                on_first_video_ready(first_ready_path)
            except Exception as callback_error:
                print(
                    f"    [WARN] on_first_video_ready callback error: {callback_error}",
                    file=sys.stderr,
                )

    review_requested = not skip_review
    if skip_review and review_items:
        print(
            f"    [REVIEW] --skip-review: skipping aos-cli video review, "
            f"marking {len(review_items)} clips as passed"
        )
        for item in review_items:
            _save_clip_result(
                item["clip"],
                item["version"],
                item["actual_path"],
                item["task_id"],
                item.get("video_url"),
                item.get("last_frame_url"),
                True,
                {},
                {"skipped": True, "reason": "skip-review"},
                item.get("requested_duration_seconds"),
                item.get("actual_duration_seconds"),
                item.get("provider"),
                item.get("model_code"),
            )
    elif review_requested and review_items:
        print(f"    [REVIEW] 启用 aos-cli video.analyze 评审，处理 {len(review_items)} 个视频...")

        def do_review(item):
            clip = item["clip"]
            clip_dir = str(
                paths.get_video_path(
                    episode, clip["location_num"], clip["clip_num"], 1
                ).parent
            )
            return item, _review_single_clip(
                video_path=item["actual_path"],
                segment_id=clip["ls_id"],
                expected_duration=float(clip["dur_api"]),
                original_prompt=clip["ls"].get("full_prompts", ""),
                output_dir=clip_dir,
            )

        with ThreadPoolExecutor(max_workers=len(review_items)) as executor:
            futures = {
                executor.submit(do_review, item): item for item in review_items
            }
            for future in as_completed(futures):
                try:
                    item, (passed, analysis_dict, review_dict) = future.result()
                except Exception as err:
                    item = futures[future]
                    passed, analysis_dict, review_dict = (
                        False,
                        {},
                        {"error": str(err)},
                    )
                    print(f"    [{item['clip']['ls_id']}] 评审异常: {err}")

                _save_clip_result(
                    item["clip"],
                    item["version"],
                    item["actual_path"],
                    item["task_id"],
                    item.get("video_url"),
                    item.get("last_frame_url"),
                    passed,
                    analysis_dict,
                    review_dict,
                    item.get("requested_duration_seconds"),
                    item.get("actual_duration_seconds"),
                    item.get("provider"),
                    item.get("model_code"),
                )
                print(
                    f"    [{item['clip']['ls_id']}] v{item['version']:03d} "
                    f"评审: {'PASS' if passed else 'FAIL'}"
                )
    elif review_items:
        print(
            "    [REVIEW] 未启用 aos-cli video review，生成成功即通过"
        )
        for item in review_items:
            _save_clip_result(
                item["clip"],
                item["version"],
                item["actual_path"],
                item["task_id"],
                item.get("video_url"),
                item.get("last_frame_url"),
                True,
                {},
                {"skipped": True, "reason": "default-path"},
                item.get("requested_duration_seconds"),
                item.get("actual_duration_seconds"),
                item.get("provider"),
                item.get("model_code"),
            )

    for clip in clip_group:
        if clip["attempts"] > 0:
            clip["done"] = True

    for clip in clip_group:
        best_version = clip.get("best_version")
        if best_version:
            for version_result in clip["versions"]:
                if (
                    version_result.get("version") == best_version
                    and version_result.get("video_path")
                ):
                    return version_result["video_path"], version_result.get("last_frame_url")

    for clip in clip_group:
        for version_result in clip["versions"]:
            if version_result.get("success") and version_result.get("video_path"):
                return version_result["video_path"], version_result.get("last_frame_url")

    return None, None


def _write_lsi_to_json(
    data: dict,
    json_path: str,
    lock,
    target_scene_id: str,
    target_clip_num: int,
    url: str,
    description: Optional[str],
) -> bool:
    """Persist only the next clip's continuity reference without mutating prompt text."""
    with lock:
        for scene in data["scenes"]:
            if scene["scene_id"] != target_scene_id:
                continue
            for clip_item in scene["clips"]:
                match = re.match(r"clip[_]?(\d+)", clip_item["clip_id"], re.IGNORECASE)
                if not match or int(match.group(1)) != target_clip_num:
                    continue

                frame_ref_value = {"url": url}
                new_clip = {}
                inserted = False
                first_prompt_key = (
                    "prompt" if clip_item.get("prompt") else "complete_prompt"
                )
                for key, value in clip_item.items():
                    if key == "lsi":
                        continue
                    if key == first_prompt_key and not inserted:
                        new_clip["lsi"] = frame_ref_value
                        inserted = True
                    new_clip[key] = value
                if not inserted:
                    new_clip["lsi"] = frame_ref_value
                clip_item.clear()
                clip_item.update(new_clip)

                with open(json_path, "w", encoding="utf-8") as file:
                    json.dump(data, file, ensure_ascii=False, indent=2)
                print(
                    f"[LSI] {target_scene_id} clip{target_clip_num:03d} lsi 已写入: {json_path}"
                )
                return True
    return False


def _extract_and_upload_frame(
    video_path: str,
    scene_id: str,
    clip_num: int,
    scn_label: str,
    clip_group: list,
    paths,
    gemini_cfg: Optional[dict],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Extract, describe, and upload the last-shot first frame for continuity."""
    if not (video_path and os.path.exists(video_path)):
        return None, None, None

    frames_dir = (
        paths.output_root.parent.parent / "workspace" / paths.output_root.name / "frames"
    )
    frames_dir.mkdir(parents=True, exist_ok=True)
    frame_filename = f"{scene_id}_clip{clip_num:03d}_last_shot_first_frame.png"
    frame_path = str(frames_dir / frame_filename)

    active_model = get_video_model_config().get("active_model", "kling_omni")
    do_blur = active_model == "seedance2"
    png_path = extract_last_shot_first_frame_blurred(
        video_path,
        output_path=frame_path,
        blur_faces=do_blur,
    )
    if not png_path:
        return None, None, None

    first_frame_text: Optional[str] = None
    raw_path = frame_path.replace(".png", "_raw.png")
    if gemini_cfg and os.path.exists(raw_path):
        character_names = []
        clip0 = clip_group[0]
        if clip0.get("subjects"):
            character_names = [
                subject["name"] for subject in clip0["subjects"] if subject.get("name")
            ]
        elif clip0.get("reference_images"):
            character_names = [
                ref.get("display_name") or ref.get("name", "")
                for ref in clip0["reference_images"]
            ]
        first_frame_text = describe_frame_with_gemini(
            img_path=raw_path,
            last_shot_prompt=clip0.get("prompt", ""),
            character_names=character_names,
            gemini_cfg=gemini_cfg,
        )

    cos_key = upload_frame_to_cos(png_path)
    if cos_key:
        print(
            f"  [FRAME] {scn_label}_clip{clip_num:03d} 最后镜头首帧已保存并上传: "
            f"{frame_path} -> {cos_key}"
            f"{' (含描述)' if first_frame_text else ''}"
        )
        return cos_key, first_frame_text, frame_filename

    print(
        f"  [FRAME] {scn_label}_clip{clip_num:03d} 最后镜头首帧提取/上传失败，"
        "下一 clip 不注入首帧参考",
        file=sys.stderr,
    )
    return None, None, None


def process_scenes_parallel(
    scenes_clip_states: Dict[str, list],
    process_scene,
    on_scene_complete=None,
    on_scene_error=None,
) -> None:
    """Run independent scenes concurrently while each scene owns its clip ordering."""
    if not scenes_clip_states:
        return

    with ThreadPoolExecutor(max_workers=max(1, len(scenes_clip_states))) as executor:
        scene_futures = {
            executor.submit(process_scene, scene_id, clips): scene_id
            for scene_id, clips in scenes_clip_states.items()
        }
        for future in as_completed(scene_futures):
            scene_id = scene_futures[future]
            try:
                future.result()
                if on_scene_complete:
                    on_scene_complete(scene_id)
            except Exception as err:
                if on_scene_error:
                    on_scene_error(scene_id, err)
                else:
                    raise


def _process_scene_clips(
    scene_id: str,
    scene_clip_states: list,
    episode: int,
    paths,
    model_code: str,
    quality: str,
    ratio: str,
    poll_interval: int,
    timeout: int,
    gemini_api_key: Optional[str],
    gemini_cfg: Optional[dict] = None,
    data: Optional[dict] = None,
    json_path: Optional[str] = None,
    json_lock=None,
    skip_review: bool = False,
) -> None:
    """Process all clips in one scene with the minimal default continuity path."""
    from collections import defaultdict

    clips_by_num: Dict[int, list] = defaultdict(list)
    for clip in scene_clip_states:
        clips_by_num[clip["clip_num"]].append(clip)

    first_frame_url: Optional[str] = None
    prev_frame_filename: Optional[str] = None

    for clip_num in sorted(clips_by_num.keys()):
        clip_group = clips_by_num[clip_num]
        scn_label = clip_group[0]["ls_id"].split("_")[0]

        if prev_frame_filename and first_frame_url:
            for clip in clip_group:
                clip["prev_frame_url"] = first_frame_url
                clip["prev_frame_description"] = None

        print(f"\n{'='*60}")
        print(
            f"  场景 {scene_id}  Clip {clip_num:03d}  开始生成"
            f"  (首帧: {'有, COS=' + first_frame_url[:40] if first_frame_url else '无'})"
        )
        print(f"{'='*60}")

        best_video_path, provider_last_frame_url = _run_generation_rounds(
            clip_group=clip_group,
            episode=episode,
            paths=paths,
            model_code=model_code,
            quality=quality,
            ratio=ratio,
            poll_interval=poll_interval,
            timeout=timeout,
            gemini_api_key=gemini_api_key,
            first_frame_url=first_frame_url,
            first_frame_text=None,
            prev_video_url=None,
            on_first_video_ready=None,
            skip_review=skip_review,
        )

        if provider_last_frame_url:
            next_frame_url = provider_last_frame_url
            _first_frame_text = None
            prev_frame_filename = f"{scene_id}_clip{clip_num:03d}_provider_last_frame"
            print(
                f"  [FRAME] {scn_label}_clip{clip_num:03d} 使用 provider 返回的尾帧 URL 续接"
            )
        else:
            next_frame_url, _first_frame_text, prev_frame_filename = _extract_and_upload_frame(
                video_path=best_video_path,
                scene_id=scene_id,
                clip_num=clip_num,
                scn_label=scn_label,
                clip_group=clip_group,
                paths=paths,
                gemini_cfg=None,
            )
        first_frame_url = next_frame_url

        if not first_frame_url:
            print(
                f"  [FRAME] {scn_label}_clip{clip_num:03d} 首帧未就绪，下一 clip 不注入首帧参考",
                file=sys.stderr,
            )

        if first_frame_url and data is not None and json_path and json_lock is not None:
            next_in_json: Optional[int] = None
            for scene in data["scenes"]:
                if scene["scene_id"] != scene_id:
                    continue
                scene_clip_ids = scene["clips"]
                for clip_index, clip_item in enumerate(scene_clip_ids):
                    match = re.match(
                        r"clip[_]?(\d+)", clip_item["clip_id"], re.IGNORECASE
                    )
                    if (
                        match
                        and int(match.group(1)) == clip_num
                        and clip_index + 1 < len(scene_clip_ids)
                    ):
                        next_match = re.match(
                            r"clip[_]?(\d+)",
                            scene_clip_ids[clip_index + 1]["clip_id"],
                            re.IGNORECASE,
                        )
                        if next_match:
                            next_in_json = int(next_match.group(1))
                        break
                break

            if next_in_json is not None:
                written = _write_lsi_to_json(
                    data=data,
                    json_path=json_path,
                    lock=json_lock,
                    target_scene_id=scene_id,
                    target_clip_num=next_in_json,
                    url=first_frame_url,
                    description=None,
                )
                if not written:
                    print(
                        f"  [LSI] 警告：未找到 {scene_id} clip{next_in_json:03d}，lsi 未写入",
                        file=sys.stderr,
                    )
