#!/usr/bin/env python3
# input: asset-gen Gemini backend config and environment
# output: unittest assertions for official and proxy Gemini client creation
# pos: regression coverage for asset-gen text/review provider boundary

import importlib
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class GeminiClientTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        self._old_modules = {
            name: sys.modules.get(name)
            for name in (
                "google",
                "google.genai",
                "google.genai.types",
                "common_gemini_client",
                "gemini_multimodal_legacy",
            )
        }
        google_module = types.ModuleType("google")
        genai_module = types.ModuleType("google.genai")
        genai_types_module = types.ModuleType("google.genai.types")
        genai_module.Client = lambda **kwargs: object()
        genai_types_module.Part = type(
            "Part",
            (),
            {"from_bytes": staticmethod(lambda data, mime_type: (data, mime_type))},
        )
        google_module.genai = genai_module
        sys.modules["google"] = google_module
        sys.modules["google.genai"] = genai_module
        sys.modules["google.genai.types"] = genai_types_module
        os.environ["GEMINI_API_KEY"] = "chatfire-key"

    def tearDown(self):
        for name, module in self._old_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
        os.environ.clear()
        os.environ.update(self._old_env)

    def import_common_gemini_client(self):
        sys.modules.pop("common_gemini_client", None)
        return importlib.import_module("common_gemini_client")

    def import_gemini_multimodal_legacy(self):
        sys.modules.pop("common_gemini_client", None)
        sys.modules.pop("gemini_multimodal_legacy", None)
        return importlib.import_module("gemini_multimodal_legacy")

    def test_proxy_mode_uses_chatfire_key_and_base_url(self):
        gemini_multimodal_legacy = self.import_gemini_multimodal_legacy()

        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        backend_config = {
            "mode": "proxy",
            "model": "gemini-3.1-flash-lite-preview",
            "proxy": {
                "api_key": "",
                "api_key_env": "GEMINI_API_KEY",
                "base_url": "https://api.chatfire.cn/gemini",
            },
        }

        with patch.object(gemini_multimodal_legacy.genai, "Client", fake_client):
            gemini_multimodal_legacy.create_client(backend_config)

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertEqual(captured["http_options"]["base_url"], "https://api.chatfire.cn/gemini")

    def test_default_config_uses_official_gemini(self):
        gemini_multimodal_legacy = self.import_gemini_multimodal_legacy()

        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        with patch.object(gemini_multimodal_legacy.genai, "Client", fake_client):
            gemini_multimodal_legacy.create_client()

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertNotIn("http_options", captured)

    def test_generate_text_with_retry_uses_aos_cli_model_boundary(self):
        common_gemini_client = self.import_common_gemini_client()

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

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
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
        common_gemini_client = self.import_common_gemini_client()

        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"worldview_type": "科幻"}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
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
        common_gemini_client = self.import_common_gemini_client()

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

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_json_with_retry("prompt", max_retries=1)

        self.assertEqual(result, {"worldview_type": "奇幻"})

    def test_aos_cli_wrong_output_kind_fails(self):
        common_gemini_client = self.import_common_gemini_client()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"unexpected": True}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "output.kind mismatch"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_aos_cli_missing_text_field_fails(self):
        common_gemini_client = self.import_common_gemini_client()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing output.text"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_generate_content_with_retry_returns_text(self):
        common_gemini_client = self.import_common_gemini_client()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text", "text": "generated description"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_content_with_retry("prompt", max_retries=1)

        self.assertEqual(result, "generated description")

    def test_aos_cli_failure_reports_error_message(self):
        common_gemini_client = self.import_common_gemini_client()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": False,
                    "error": {"code": "CONFIG_ERROR", "message": "missing key"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing key"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)


if __name__ == "__main__":
    unittest.main()
