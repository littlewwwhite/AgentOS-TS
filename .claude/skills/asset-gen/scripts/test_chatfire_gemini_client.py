#!/usr/bin/env python3
# input: asset-gen Gemini backend config and environment
# output: unittest assertions for ChatFire Gemini proxy client creation
# pos: regression coverage for asset-gen text/review provider boundary

import os
import unittest
from unittest.mock import patch


class ChatFireGeminiClientTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        os.environ["GEMINI_API_KEY"] = "chatfire-key"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_proxy_mode_uses_chatfire_key_and_base_url(self):
        import common_gemini_client

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

        with patch.object(common_gemini_client.genai, "Client", fake_client):
            common_gemini_client.create_client(backend_config)

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertEqual(captured["http_options"]["base_url"], "https://api.chatfire.cn/gemini")

    def test_default_config_uses_chatfire_proxy(self):
        import common_gemini_client

        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        with patch.object(common_gemini_client.genai, "Client", fake_client):
            common_gemini_client.create_client()

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertEqual(captured["http_options"]["base_url"], "https://api.chatfire.cn/gemini")


if __name__ == "__main__":
    unittest.main()
