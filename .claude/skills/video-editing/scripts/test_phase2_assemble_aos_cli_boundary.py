#!/usr/bin/env python3
# input: video-editing phase2_assemble + fake aos-cli adapter
# output: unittest assertions that assembled-video review uses the aos-cli video.analyze boundary
# pos: regression coverage for video-editing Phase 2 model boundary

import importlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class Phase2AssembleAosCliBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_module = sys.modules.get("phase2_assemble")

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("phase2_assemble", None)
        else:
            sys.modules["phase2_assemble"] = self._old_module

    def import_module(self):
        sys.modules.pop("phase2_assemble", None)
        return importlib.import_module("phase2_assemble")

    def test_evaluate_assembled_video_uses_aos_cli_video_analyze(self):
        phase2_assemble = self.import_module()
        captured = {}

        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "assembled.mp4"
            video_path.write_bytes(b"fake-mp4")

            def fake_call(video_paths, prompt, *, task, model, options, cwd, raw_output_dir):
                captured["video_paths"] = [Path(p) for p in video_paths]
                captured["prompt"] = prompt
                captured["task"] = task
                captured["model"] = model
                captured["options"] = options
                captured["cwd"] = cwd
                captured["raw_output_dir"] = raw_output_dir
                return {
                    "overall_score": 8.2,
                    "summary": "coherent assembled scene",
                    "issues": [],
                    "edit_suggestions": [],
                }

            with patch.object(phase2_assemble, "call_video_analyze", side_effect=fake_call):
                result = phase2_assemble.evaluate_with_aos_cli(
                    str(video_path),
                    "review prompt",
                    "ep001_scn001",
                    raw_output_dir=Path(tmp),
                )

        self.assertEqual(result["overall_score"], 8.2)
        self.assertEqual(captured["video_paths"], [video_path])
        self.assertEqual(captured["prompt"], "review prompt")
        self.assertEqual(captured["task"], "video-editing.phase2.loop-review")
        self.assertEqual(captured["model"], phase2_assemble.LOOP_VIDEO_ANALYZE_MODEL)
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["raw_output_dir"], Path(tmp))
        self.assertEqual(captured["options"]["temperature"], phase2_assemble.LOOP_VIDEO_ANALYZE_TEMPERATURE)
        self.assertEqual(captured["options"]["thinking_level"], phase2_assemble.LOOP_VIDEO_ANALYZE_THINKING_LEVEL)
        self.assertEqual(captured["options"]["media_resolution"], phase2_assemble.LOOP_VIDEO_ANALYZE_MEDIA_RESOLUTION)
        self.assertEqual(captured["options"]["label"], "ep001_scn001")


if __name__ == "__main__":
    unittest.main()
