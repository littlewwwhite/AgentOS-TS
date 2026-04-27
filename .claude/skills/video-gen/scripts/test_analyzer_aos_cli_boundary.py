# input: video-gen analyzer and fake aos-cli model adapter
# output: unittest assertions that video review uses the aos-cli video.analyze boundary
# pos: regression coverage for video-gen review model migration

from __future__ import annotations

import importlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
import unittest


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class AnalyzerAosCliBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_module = sys.modules.get("analyzer")
        if "analyzer" in sys.modules:
            sys.modules.pop("analyzer")

    def tearDown(self) -> None:
        sys.modules.pop("analyzer", None)
        if self._old_module is not None:
            sys.modules["analyzer"] = self._old_module

    def import_module(self):
        sys.modules.pop("analyzer", None)
        return importlib.import_module("analyzer")

    def test_analyze_video_parallel_uses_aos_cli_video_analyze(self) -> None:
        analyzer = self.import_module()

        captured: dict[str, object] = {}
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            video_path = tmp_dir / "clip.mp4"
            video_path.write_bytes(b"fake-mp4")

            def fake_run(request_path, response_path, cwd=None):
                request = json.loads(Path(request_path).read_text(encoding="utf-8"))
                captured["request"] = request
                Path(response_path).write_text(
                    json.dumps(
                        {
                            "ok": True,
                            "task": request["task"],
                            "capability": request["capability"],
                            "output": {
                                "kind": "json",
                                "data": {
                                    "reference_consistency": {
                                        "actor_consistency": 9,
                                        "location_consistency": 8,
                                        "props_consistency": 7,
                                        "actor_issues": [],
                                        "location_issues": [],
                                        "props_issues": [],
                                        "overall_consistency_note": "stable",
                                    },
                                    "prompt_compliance": {
                                        "content_compliance_score": 8,
                                        "matched_elements": ["action"],
                                        "missing_elements": [],
                                        "incorrect_elements": [],
                                        "deviation_description": "",
                                        "overall_compliance_note": "matched",
                                    },
                                },
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(["aos-cli"], 0, "", "")

            with patch.object(analyzer, "aos_cli_model_run", side_effect=fake_run):
                result = analyzer.analyze_video_parallel(
                    video_path=str(video_path),
                    segment_id="ep001_scn001_shot001",
                    expected_duration=6.0,
                    original_prompt="hero walks through the corridor",
                    api_key=None,
                    model="gemini-3.1-pro-preview",
                )

        request = captured["request"]
        self.assertEqual(request["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(request["task"], "video-gen.review.ep001_scn001_shot001")
        self.assertEqual(request["capability"], "video.analyze")
        self.assertEqual(request["output"]["kind"], "json")
        self.assertEqual(request["input"]["content"]["videos"], [video_path.resolve().as_uri()])
        self.assertIn("hero walks through the corridor", request["input"]["content"]["prompt"])
        self.assertEqual(request["options"]["expectedDuration"], 6.0)
        self.assertEqual(result["segment_id"], "ep001_scn001_shot001")
        self.assertEqual(result["expected_duration"], 6.0)
        self.assertEqual(result["parallel_results"]["reference_consistency"]["actor_consistency"], 9)
        self.assertEqual(result["parallel_results"]["prompt_compliance"]["content_compliance_score"], 8)
        self.assertEqual(result["raw_results"][0]["reviewer"], "aos_cli_video_analyze")

    def test_analyze_video_parallel_reports_missing_file_before_aos_cli(self) -> None:
        analyzer = self.import_module()
        with self.assertRaises(FileNotFoundError):
            analyzer.analyze_video_parallel(
                video_path="/missing/clip.mp4",
                segment_id="missing",
                expected_duration=5.0,
                original_prompt="prompt",
                api_key=None,
            )


if __name__ == "__main__":
    unittest.main()
