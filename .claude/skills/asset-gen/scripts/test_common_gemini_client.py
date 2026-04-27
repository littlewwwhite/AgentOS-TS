#!/usr/bin/env python3
# input: asset-gen common_gemini_client + fake aos-cli adapter
# output: unittest assertions that text/JSON paths build aos-cli envelopes correctly
# pos: regression coverage for asset-gen text/JSON model boundary

import importlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


class CommonGeminiClientBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        self._old_module = sys.modules.get("common_gemini_client")
        os.environ["GEMINI_API_KEY"] = "test-key"

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("common_gemini_client", None)
        else:
            sys.modules["common_gemini_client"] = self._old_module
        os.environ.clear()
        os.environ.update(self._old_env)

    def import_module(self):
        sys.modules.pop("common_gemini_client", None)
        module = importlib.import_module("common_gemini_client")
        self.aos_cli_envelope = importlib.import_module("aos_cli_envelope")
        return module

    def test_generate_text_with_retry_uses_aos_cli_model_boundary(self):
        common_gemini_client = self.import_module()
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text", "text": " rewritten prompt "},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_text_with_retry(
                "rewrite this",
                label="rewrite_prompt",
                max_retries=1,
                model="asset-text-model",
            )

        self.assertEqual(result, "rewritten prompt")
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "rewrite_prompt")
        self.assertEqual(captured["request"]["capability"], "generate")
        self.assertEqual(captured["request"]["output"], {"kind": "text"})
        self.assertEqual(captured["request"]["input"], {"content": "rewrite this"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asset-text-model"})

    def test_generate_json_with_retry_uses_aos_cli_model_boundary(self):
        common_gemini_client = self.import_module()
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            captured["request"] = json.loads(Path(request_path).read_text(encoding="utf-8"))
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"worldview_type": "科幻"}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_json_with_retry(
                "analyze style",
                label="世界观分析",
                max_retries=1,
                model="asset-json-model",
            )

        self.assertEqual(result, {"worldview_type": "科幻"})
        self.assertEqual(captured["request"]["task"], "世界观分析")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["input"], {"content": "analyze style"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asset-json-model"})

    def test_generate_json_with_retry_parses_text_fallback(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {
                        "kind": "json",
                        "text": "```json\n{\"worldview_type\": \"奇幻\"}\n```",
                    },
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_json_with_retry("prompt", max_retries=1)

        self.assertEqual(result, {"worldview_type": "奇幻"})

    def test_aos_cli_wrong_output_kind_fails(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"unexpected": True}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "output.kind mismatch"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_aos_cli_missing_text_field_fails(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing output.text"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_generate_content_with_retry_returns_text(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text", "text": "generated description"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_content_with_retry("prompt", max_retries=1)

        self.assertEqual(result, "generated description")

    def test_aos_cli_failure_reports_error_message(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": False,
                    "error": {"code": "CONFIG_ERROR", "message": "missing key"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing key"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)


if __name__ == "__main__":
    unittest.main()
