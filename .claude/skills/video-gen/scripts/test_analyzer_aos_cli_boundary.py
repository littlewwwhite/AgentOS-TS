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

    def test_provider_rejection_retries_with_sanitized_review_prompt(self) -> None:
        analyzer = self.import_module()

        captured_requests: list[dict[str, object]] = []
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            video_path = tmp_dir / "clip.mp4"
            video_path.write_bytes(b"fake-mp4")

            def fake_run(request_path, response_path, cwd=None):
                request = json.loads(Path(request_path).read_text(encoding="utf-8"))
                captured_requests.append(request)
                if len(captured_requests) == 1:
                    Path(response_path).write_text(
                        json.dumps(
                            {
                                "ok": False,
                                "apiVersion": "aos-cli.model/v1",
                                "task": request["task"],
                                "capability": request["capability"],
                                "error": {
                                    "code": "PROVIDER_REJECTED",
                                    "message": "Gemini response missing candidates[0].content.parts[0].text",
                                    "retryable": True,
                                    "provider": "gemini",
                                },
                            }
                        ),
                        encoding="utf-8",
                    )
                    return subprocess.CompletedProcess(["aos-cli"], 2, "", "")

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
                                        "actor_consistency": 10,
                                        "location_consistency": 9,
                                        "props_consistency": 8,
                                        "actor_issues": [],
                                        "location_issues": [],
                                        "props_issues": [],
                                        "overall_consistency_note": "stable",
                                    },
                                    "prompt_compliance": {
                                        "content_compliance_score": 8,
                                        "matched_elements": ["staging"],
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
                result = analyzer.call_video_review_analyze(
                    video_path=video_path,
                    segment_id="ep004_scn001_clip002",
                    expected_duration=8.0,
                    original_prompt=(
                        "镜头：中景，固定机位。\n"
                        "在宫廷花园阴影中，两名女性角色注视前方。\n"
                        "对白：【反派｜尖锐】\"You wretched seductress.\""
                    ),
                    model="gemini-3-flash-preview",
                )

        self.assertEqual(len(captured_requests), 2)
        self.assertEqual(captured_requests[0]["task"], "video-gen.review.ep004_scn001_clip002")
        self.assertEqual(captured_requests[1]["task"], "video-gen.review.ep004_scn001_clip002.safe")
        retry_prompt = captured_requests[1]["input"]["content"]["prompt"]
        self.assertIn("在宫廷花园阴影中，两名女性角色注视前方", retry_prompt)
        self.assertIn("dialogue text omitted for review safety", retry_prompt)
        self.assertNotIn("wretched seductress", retry_prompt)
        self.assertEqual(result["prompt_compliance"]["content_compliance_score"], 8)


if __name__ == "__main__":
    unittest.main()
