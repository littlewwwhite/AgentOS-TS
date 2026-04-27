# input: video-gen frame extractor and fake aos-cli model adapter
# output: unittest assertions that frame description uses the aos-cli vision.review boundary
# pos: regression coverage for video-gen continuity frame-description migration

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


class FrameExtractorAosCliBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_module = sys.modules.get("frame_extractor")
        if "frame_extractor" in sys.modules:
            sys.modules.pop("frame_extractor")

    def tearDown(self) -> None:
        sys.modules.pop("frame_extractor", None)
        if self._old_module is not None:
            sys.modules["frame_extractor"] = self._old_module

    def import_module(self):
        sys.modules.pop("frame_extractor", None)
        return importlib.import_module("frame_extractor")

    def test_describe_frame_uses_aos_cli_vision_review(self) -> None:
        frame_extractor = self.import_module()

        captured: dict[str, object] = {}
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            image_path = tmp_dir / "last-frame.png"
            image_path.write_bytes(b"fake-png")

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
                                    "description": "两名角色站在走廊中央，面向彼此交谈。"
                                },
                            },
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(["aos-cli"], 0, "", "")

            with patch.object(frame_extractor, "aos_cli_model_run", side_effect=fake_run):
                result = frame_extractor.describe_frame_with_gemini(
                    img_path=str(image_path),
                    last_shot_prompt="角色在走廊交谈",
                    character_names=["李明", "王芳"],
                    gemini_cfg={"model": "gemini-3.1-pro-preview"},
                )

        request = captured["request"]
        self.assertEqual(request["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(request["task"], "video-gen.frame.describe")
        self.assertEqual(request["capability"], "vision.review")
        self.assertEqual(request["output"]["kind"], "json")
        self.assertEqual(request["input"]["content"]["images"], [image_path.resolve().as_uri()])
        self.assertIn("角色在走廊交谈", request["input"]["content"]["prompt"])
        self.assertIn("李明、王芳", request["input"]["content"]["prompt"])
        self.assertEqual(
            request["output"]["schema"]["properties"]["description"]["type"],
            "string",
        )
        self.assertEqual(result, "两名角色站在走廊中央，面向彼此交谈。")

    def test_describe_frame_reports_missing_file_before_aos_cli(self) -> None:
        frame_extractor = self.import_module()
        with patch.object(frame_extractor, "aos_cli_model_run") as fake_run:
            result = frame_extractor.describe_frame_with_gemini(
                img_path="/missing/last-frame.png",
                last_shot_prompt="prompt",
                character_names=[],
                gemini_cfg={},
            )

        self.assertIsNone(result)
        fake_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
