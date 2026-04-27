#!/usr/bin/env python3
# input: asset-gen gemini_multimodal_legacy + fake google.genai modules
# output: unittest assertions that deferred multimodal client builds expected SDK args
# pos: regression coverage for the deferred image+text review path
#
# Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
# These tests cover gemini_multimodal_legacy.py, which is intentionally excluded
# from the aos-cli migration guardrail because aos-cli model v1 does not yet
# define a multimodal review contract.

import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch


class GeminiMultimodalLegacyTest(unittest.TestCase):
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

    def import_module(self):
        sys.modules.pop("common_gemini_client", None)
        sys.modules.pop("gemini_multimodal_legacy", None)
        return importlib.import_module("gemini_multimodal_legacy")

    def test_proxy_mode_uses_chatfire_key_and_base_url(self):
        legacy = self.import_module()
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

        with patch.object(legacy.genai, "Client", fake_client):
            legacy.create_client(backend_config)

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertEqual(captured["http_options"]["base_url"], "https://api.chatfire.cn/gemini")

    def test_default_config_uses_official_gemini(self):
        legacy = self.import_module()
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        with patch.object(legacy.genai, "Client", fake_client):
            legacy.create_client()

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertNotIn("http_options", captured)


if __name__ == "__main__":
    unittest.main()
