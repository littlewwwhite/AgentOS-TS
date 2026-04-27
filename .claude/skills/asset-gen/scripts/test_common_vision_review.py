#!/usr/bin/env python3
# input: asset-gen common_vision_review + fake aos-cli adapter
# output: unittest assertions that multimodal review paths build aos-cli envelopes correctly
# pos: regression coverage for asset-gen vision.review model boundary

import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class CommonVisionReviewBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_module = sys.modules.get("common_vision_review")

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("common_vision_review", None)
        else:
            sys.modules["common_vision_review"] = self._old_module

    def import_module(self):
        sys.modules.pop("common_vision_review", None)
        return importlib.import_module("common_vision_review")

    def test_call_vision_review_uses_aos_cli_model_boundary(self):
        common_vision_review = self.import_module()
        captured = {}

        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp) / "scene.png"
            image_path.write_bytes(b"fake-png")
            image_part, error = common_vision_review.load_image_part(str(image_path))
            self.assertIsNone(error)

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
                                    "approved": False,
                                    "summary": "style mismatch",
                                    "issues": [{"name": "scene", "severity": "high"}],
                                },
                            },
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                return type("Completed", (), {"returncode": 0, "stderr": ""})()

            with patch.object(common_vision_review, "aos_cli_model_run", side_effect=fake_run):
                result = common_vision_review.call_vision_review(
                    ["system prompt", image_part, "scene prompt"],
                    task="scene.main.review",
                    models=["review-model"],
                    max_retries=1,
                )

        self.assertEqual(result["summary"], "style mismatch")
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "scene.main.review")
        self.assertEqual(captured["request"]["capability"], "vision.review")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "review-model"})
        content = captured["request"]["input"]["content"]
        self.assertIn("system prompt", content["prompt"])
        self.assertIn("scene prompt", content["prompt"])
        self.assertEqual(content["images"], [image_path.resolve().as_uri()])

    def test_load_image_part_reports_missing_file_without_provider_sdk(self):
        common_vision_review = self.import_module()

        image_part, error = common_vision_review.load_image_part("/missing/review.png")

        self.assertIsNone(image_part)
        self.assertEqual(error, "[image not found: /missing/review.png]")


if __name__ == "__main__":
    unittest.main()
