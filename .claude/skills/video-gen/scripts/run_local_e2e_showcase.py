#!/usr/bin/env python3
# input: repo-local video-gen runtime and aos-cli fake video provider
# output: playable episode 1-3 local E2E videos plus verification report
# pos: deterministic local E2E showcase for aos-cli video migration acceptance

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import batch_generate  # noqa: E402


EPISODES: dict[int, list[dict[str, Any]]] = {
    1: [
        {
            "scene_id": "scn_001",
            "title": "Arrival",
            "clips": [
                (6, "Episode 1 opens with Lin entering the archive at dusk."),
                (8, "Lin discovers the humming shard under a sealed table."),
            ],
        },
        {
            "scene_id": "scn_002",
            "title": "Signal",
            "clips": [
                (7, "The shard projects a map toward the abandoned tower."),
                (9, "Lin chooses to follow the signal before sunrise."),
            ],
        },
    ],
    2: [
        {
            "scene_id": "scn_001",
            "title": "Crossing",
            "clips": [
                (7, "Episode 2 follows Lin crossing the flooded market."),
                (10, "A masked courier warns that the tower is already awake."),
            ],
        },
        {
            "scene_id": "scn_002",
            "title": "Trace",
            "clips": [
                (6, "Lin matches the shard pulse to a hidden street mural."),
                (11, "The mural opens into a stairway below the city."),
            ],
        },
    ],
    3: [
        {
            "scene_id": "scn_001",
            "title": "Tower",
            "clips": [
                (9, "Episode 3 brings Lin to the tower control chamber."),
                (12, "The shard unlocks a memory of the missing engineer."),
            ],
        },
        {
            "scene_id": "scn_002",
            "title": "Choice",
            "clips": [
                (7, "Lin redirects the tower signal away from the city."),
                (10, "The season closes on the tower going dark at dawn."),
            ],
        },
    ],
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local playable video-gen E2E showcase")
    parser.add_argument(
        "--output-root",
        default="output/e2e/aos-full-migration",
        help="Generated showcase root, relative to repo root unless absolute",
    )
    parser.add_argument("--keep-existing", action="store_true", help="Do not remove prior output root")
    args = parser.parse_args()

    _require_tool("ffmpeg")
    _require_tool("ffprobe")

    output_root = Path(args.output_root)
    if not output_root.is_absolute():
        output_root = REPO_ROOT / output_root
    if output_root.exists() and not args.keep_existing:
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    os.environ["PROJECT_DIR"] = str(output_root)
    os.environ["AOS_CLI_MODEL_FAKE"] = "1"
    os.environ["AOS_CLI_MODEL_FAKE_VIDEO_VALID"] = "1"
    os.environ["AOS_CLI_MODEL_FAKE_ARTIFACT_DIR"] = str(output_root / "fake-artifacts")

    storyboards_dir = output_root / "storyboard" / "approved"
    storyboards_dir.mkdir(parents=True, exist_ok=True)

    episode_reports = []
    for episode, scenes in EPISODES.items():
        storyboard_path = _write_storyboard(storyboards_dir, episode, scenes)
        episode_dir = output_root / f"ep{episode:03d}"
        results = batch_generate.run_batch_generate(
            str(storyboard_path),
            str(episode_dir),
            episode,
            ratio="16:9",
            quality="720",
            poll_interval=0,
            timeout=5,
            skip_review=True,
        )
        manifest_path = episode_dir / f"ep{episode:03d}_video_task_manifest.json"
        final_path = output_root / "final" / f"ep{episode:03d}_final.mp4"
        final_path.parent.mkdir(parents=True, exist_ok=True)
        clip_paths = _clip_paths_from_manifest(manifest_path)
        _concat_videos(clip_paths, final_path, output_root / "concat")
        episode_reports.append(
            {
                "episode": episode,
                "storyboard": str(storyboard_path.relative_to(REPO_ROOT)),
                "delivery": str((episode_dir / f"ep{episode:03d}_delivery.json").relative_to(REPO_ROOT)),
                "task_manifest": str(manifest_path.relative_to(REPO_ROOT)),
                "final_video": str(final_path.relative_to(REPO_ROOT)),
                "clip_count": len(clip_paths),
                "clip_durations": [_probe_duration(path) for path in clip_paths],
                "final_duration": _probe_duration(final_path),
                "generation_success_count": sum(1 for result in results if result.get("success")),
            }
        )

    report = {
        "schema_version": "video-gen-local-e2e/v1",
        "provider": "aos-cli fake video.generate with valid ffmpeg artifacts",
        "remote_provider_available": False,
        "reason_remote_provider_not_used": "ARK_API_KEY and GEMINI_API_KEY were not present in the shell environment.",
        "scene_scheduling_contract": "batch_generate.py groups by scene, runs scenes in parallel, and processes clips serially inside each scene.",
        "episodes": episode_reports,
    }
    report_path = output_root / "local_e2e_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path = output_root / "LOCAL_E2E_REPORT.md"
    markdown_path.write_text(_format_markdown_report(report), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def _write_storyboard(storyboards_dir: Path, episode: int, scenes: list[dict[str, Any]]) -> Path:
    payload_scenes = []
    for scene in scenes:
        clips = []
        for index, (duration, prompt) in enumerate(scene["clips"], start=1):
            clips.append(
                {
                    "clip_id": f"clip_{index:03d}",
                    "expected_duration": duration,
                    "prompt": prompt,
                }
            )
        payload_scenes.append(
            {
                "scene_id": scene["scene_id"],
                "title": scene["title"],
                "actors": [],
                "locations": [],
                "props": [],
                "clips": clips,
            }
        )
    storyboard_path = storyboards_dir / f"ep{episode:03d}_storyboard.json"
    storyboard_path.write_text(
        json.dumps(
            {
                "episode_id": f"ep_{episode:03d}",
                "title": f"Local E2E Episode {episode}",
                "scenes": payload_scenes,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return storyboard_path


def _clip_paths_from_manifest(manifest_path: Path) -> list[Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tasks = sorted(manifest["tasks"], key=lambda task: (task["scene_id"], task["clip_id"]))
    return [Path(task["output_path"]) for task in tasks]


def _concat_videos(clip_paths: list[Path], final_path: Path, concat_dir: Path) -> None:
    concat_dir.mkdir(parents=True, exist_ok=True)
    list_path = concat_dir / f"{final_path.stem}.txt"
    list_path.write_text(
        "\n".join(f"file '{_quote_concat_path(path)}'" for path in clip_paths)
        + "\n",
        encoding="utf-8",
    )
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c",
            "copy",
            str(final_path),
        ],
        check=True,
    )


def _quote_concat_path(path: Path) -> str:
    return str(path).replace("'", "'\\''")


def _probe_duration(path: Path) -> float:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(completed.stdout.strip()), 3)


def _require_tool(name: str) -> None:
    if not shutil.which(name):
        raise RuntimeError(f"{name} is required for local playable E2E generation")


def _format_markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# Local E2E Report",
        "",
        f"- Provider: {report['provider']}",
        f"- Remote provider available: {report['remote_provider_available']}",
        f"- Remote provider note: {report['reason_remote_provider_not_used']}",
        f"- Scheduling: {report['scene_scheduling_contract']}",
        "",
        "| Episode | Clips | Clip durations | Final duration | Final video |",
        "| --- | ---: | --- | ---: | --- |",
    ]
    for episode in report["episodes"]:
        lines.append(
            "| ep{episode:03d} | {clip_count} | {clip_durations} | {final_duration} | `{final_video}` |".format(
                **episode
            )
        )
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
