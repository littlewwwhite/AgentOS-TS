#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini Video Adapter
Wraps the built-in gemini_analyzer with result caching.
"""

import sys
import json
from pathlib import Path
from typing import Optional, Dict, Tuple, List

# UTF-8 output for Windows compatibility
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


class GeminiVideoAdapter:
    """
    Gemini Video Adapter

    Two-level strategy:
    1. Return cached analysis JSON if it exists
    2. Invoke built-in gemini_analyzer and persist the result
    """

    def get_analysis_result(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str] = None,
        character_references: Optional[List[str]] = None,
        output_dir: str = "workspace/output",
        force_reanalyze: bool = False,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """
        Return video analysis result.

        Args:
            video_path: path to the video file
            segment_id: shot identifier (SC##-L##)
            expected_duration: expected duration in seconds
            original_prompt: original generation prompt for compliance comparison
            character_references: list of character reference image paths
            output_dir: directory for output files
            force_reanalyze: skip cache and re-run analysis
            api_key: Gemini API key (falls back to GEMINI_API_KEY env var)

        Returns:
            Tuple[Dict, str]: (analysis result dict, JSON file path)
        """
        analysis_filename = f"{segment_id.lower().replace('-', '')}_analysis.json"
        analysis_path = Path(output_dir) / analysis_filename

        # 1. Return cached result if available
        if analysis_path.exists() and not force_reanalyze:
            print(f"[OK] Found cached analysis: {analysis_path}")
            return self._load_analysis_result(str(analysis_path)), str(analysis_path)

        # 2. Run built-in analyzer
        print(f"[STAT] No cached result found, analyzing video...")
        return self._use_builtin_analyzer(
            video_path,
            segment_id,
            expected_duration,
            original_prompt,
            character_references,
            output_dir,
            api_key
        )

    def _load_analysis_result(self, json_path: str) -> Dict:
        """Load analysis result from JSON file."""
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _use_builtin_analyzer(
        self,
        video_path: str,
        segment_id: str,
        expected_duration: float,
        original_prompt: Optional[str],
        character_references: Optional[List[str]],
        output_dir: str,
        api_key: Optional[str] = None
    ) -> Tuple[Dict, str]:
        """Delegate to the built-in gemini_analyzer module."""
        import sys
        sys.path.insert(0, str(Path(__file__).parent))

        from gemini_analyzer import analyze_video_for_review, save_analysis_result

        analysis = analyze_video_for_review(
            video_path=video_path,
            segment_id=segment_id,
            expected_duration=expected_duration,
            original_prompt=original_prompt,
            character_references=character_references,
            api_key=api_key
        )

        analysis_file = save_analysis_result(
            analysis=analysis,
            output_dir=output_dir
        )

        return analysis.model_dump(), analysis_file


def get_video_analysis(
    video_path: str,
    segment_id: str,
    expected_duration: float,
    original_prompt: Optional[str] = None,
    character_references: Optional[List[str]] = None,
    output_dir: str = "workspace/output",
    force_reanalyze: bool = False,
    api_key: Optional[str] = None
) -> Tuple[Dict, str]:
    """
    Convenience function: get video analysis result.

    Priority:
    1. Read existing *_analysis.json (cache)
    2. Run built-in gemini_analyzer

    Args:
        video_path: path to the video file
        segment_id: shot identifier
        expected_duration: expected duration in seconds
        original_prompt: original generation prompt for compliance comparison
        character_references: list of character reference image paths
        output_dir: output directory
        force_reanalyze: skip cache and force re-analysis
        api_key: Gemini API key

    Returns:
        Tuple[Dict, str]: (analysis result, JSON file path)
    """
    adapter = GeminiVideoAdapter()
    return adapter.get_analysis_result(
        video_path=video_path,
        segment_id=segment_id,
        expected_duration=expected_duration,
        original_prompt=original_prompt,
        character_references=character_references,
        output_dir=output_dir,
        force_reanalyze=force_reanalyze,
        api_key=api_key
    )


def main():
    """Command-line entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Gemini Video Adapter")
    parser.add_argument("video_path", help="path to video file")
    parser.add_argument("segment_id", help="shot identifier (SC##-L##)")
    parser.add_argument("expected_duration", type=float, help="expected duration in seconds")
    parser.add_argument("-o", "--output-dir", default="workspace/output", help="output directory")
    parser.add_argument("--force", action="store_true", help="force re-analysis, ignore cache")

    args = parser.parse_args()

    try:
        analysis, json_path = get_video_analysis(
            video_path=args.video_path,
            segment_id=args.segment_id,
            expected_duration=args.expected_duration,
            output_dir=args.output_dir,
            force_reanalyze=args.force,
        )

        print(f"\n[OK] Analysis complete")
        print(f"[FILE] Result: {json_path}")
        print(f"[STAT] Segment: {analysis['segment_id']}")

        return 0

    except Exception as e:
        print(f"\n[FAIL] Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
