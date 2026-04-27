#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Provider-neutral generated-video review adapter.

The implementation delegates to analyzer.py, which routes generated-clip review
through the aos-cli video.analyze capability.
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from analyzer import analyze_video_parallel


class VideoReviewAdapter:
    """Generated-video review adapter backed by aos-cli video.analyze."""

    def get_analysis_result(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str] = None,
        actor_references: Optional[List[str]] = None,
        output_dir: str = "draft/output",
        force_reanalyze: bool = False,
    ) -> Tuple[Dict, str]:
        print("[STAT] Calling generated-video review analyzer...")

        analysis = analyze_video_parallel(
            video_path=video_path,
            segment_id=segment_id,
            expected_duration=expected_duration,
            original_prompt=original_prompt or "",
            actor_references=actor_references,
        )

        if hasattr(analysis, "model_dump"):
            analysis = analysis.model_dump()

        print(f"[OK] Review complete: {segment_id}")
        return analysis, ""


def get_video_analysis(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: Optional[str] = None,
    actor_references: Optional[List[str]] = None,
    output_dir: str = "draft/output",
    force_reanalyze: bool = False,
) -> Tuple[Dict, str]:
    """Return generated-video review data and the optional JSON result path."""
    adapter = VideoReviewAdapter()
    return adapter.get_analysis_result(
        video_path=video_path,
        segment_id=segment_id,
        expected_duration=expected_duration,
        original_prompt=original_prompt,
        actor_references=actor_references,
        output_dir=output_dir,
        force_reanalyze=force_reanalyze,
    )


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Generated-video review adapter")
    parser.add_argument("video_path", help="Video file path")
    parser.add_argument("segment_id", help="Segment ID")
    parser.add_argument("expected_duration", type=float, help="Expected duration in seconds")
    parser.add_argument("-o", "--output-dir", default="draft/output", help="Output directory")
    parser.add_argument("--force", action="store_true", help="Force re-analysis")

    args = parser.parse_args()

    try:
        analysis, json_path = get_video_analysis(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            output_dir=args.output_dir,
            force_reanalyze=args.force,
        )

        print("\n[OK] Review complete")
        print(f"[FILE] Result file: {json_path}")
        print(json.dumps(analysis, ensure_ascii=False, indent=2))
        return 0
    except Exception as err:
        print(f"\n[FAIL] Review failed: {err}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
