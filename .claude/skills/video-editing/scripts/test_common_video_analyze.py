#!/usr/bin/env python3
# input: video-editing common_video_analyze + fake aos-cli adapter
# output: unittest assertions that video analysis paths build aos-cli envelopes correctly
# pos: regression coverage for video-editing video.analyze model boundary

import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class CommonVideoAnalyzeBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_module = sys.modules.get("common_video_analyze")

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("common_video_analyze", None)
        else:
            sys.modules["common_video_analyze"] = self._old_module

    def import_module(self):
        sys.modules.pop("common_video_analyze", None)
        return importlib.import_module("common_video_analyze")

    def import_envelope(self):
        return importlib.import_module("aos_cli_envelope")

    def test_call_video_analyze_uses_aos_cli_model_boundary(self):
        common_video_analyze = self.import_module()
        aos_cli_envelope = self.import_envelope()
        captured = {}

        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "clip.mp4"
            video_path.write_bytes(b"fake-mp4")

            def fake_run(request_path, response_path, cwd=None):
                captured["request"] = json.loads(Path(request_path).read_text(encoding="utf-8"))
                captured["cwd"] = Path(cwd)
                Path(response_path).write_text(
                    json.dumps(
                        {
                            "ok": True,
                            "output": {
                                "kind": "json",
                                "data": {
                                    "overall": {"recommendation": "use", "summary": "ok"},
                                    "shots": [],
                                    "clip_comparison": {},
                                },
                            },
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                return type("Completed", (), {"returncode": 0, "stderr": ""})()

            with patch.object(aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
                result = common_video_analyze.call_video_analyze(
                    [video_path],
                    "compare variants",
                    task="video-editing.phase1.clip",
                    model="video-model",
                    cwd=Path.cwd(),
                    raw_output_dir=Path(tmp),
                )

        self.assertEqual(result["overall"]["recommendation"], "use")
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "video-editing.phase1.clip")
        self.assertEqual(captured["request"]["capability"], "video.analyze")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "video-model"})
        content = captured["request"]["input"]["content"]
        self.assertEqual(content["prompt"], "compare variants")
        self.assertEqual(content["videos"], [video_path.resolve().as_uri()])

    def test_call_video_analyze_reports_missing_file_before_aos_cli(self):
        common_video_analyze = self.import_module()

        with self.assertRaisesRegex(FileNotFoundError, "Missing video input"):
            common_video_analyze.call_video_analyze(
                [Path("/missing/clip.mp4")],
                "compare variants",
                task="video-editing.phase1.clip",
            )


if __name__ == "__main__":
    unittest.main()
