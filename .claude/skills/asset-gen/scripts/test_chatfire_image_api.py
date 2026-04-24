#!/usr/bin/env python3
# input: ChatFire image adapter
# output: unittest assertions for request shape and synthetic task state
# pos: regression coverage for asset-gen image provider boundary

import json
import os
import unittest
from unittest.mock import patch


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({
            "data": [{"url": "https://cdn.example.com/generated.png"}],
            "created": 1764583220,
            "usage": {},
        }).encode("utf-8")


class ChatFireImageApiTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        os.environ["CHATFIRE_API_KEY"] = "test-key"
        os.environ["GEMINI_API_KEY"] = "gemini-key"
        os.environ.pop("CHATFIRE_BASE_URL", None)
        os.environ.pop("CHATFIRE_IMAGE_MODEL", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_submit_image_task_posts_gpt_image_2_request(self):
        import common_image_api

        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["timeout"] = timeout
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return _FakeResponse()

        with patch("urllib.request.urlopen", fake_urlopen):
            task_id = common_image_api.submit_image_task(
                "角色三视图",
                {"ratio": "9:16", "image": ["https://cdn.example.com/ref.png"]},
                max_retries=1,
            )

        self.assertTrue(task_id.startswith("chatfire-"))
        self.assertEqual(captured["url"], "https://api.chatfire.cn/v1/images/generations")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(captured["body"]["model"], "gpt-image-2")
        self.assertEqual(captured["body"]["prompt"], "角色三视图")
        self.assertEqual(captured["body"]["size"], "1024x1536")
        self.assertEqual(captured["body"]["image"], ["https://cdn.example.com/ref.png"])

        status = common_image_api.check_task_once(task_id)
        self.assertEqual(status["status"], "SUCCESS")
        self.assertEqual(status["result_urls"], ["https://cdn.example.com/generated.png"])

    def test_submit_image_task_requires_chatfire_api_key(self):
        import common_image_api

        os.environ.pop("CHATFIRE_API_KEY", None)

        self.assertIsNone(common_image_api.submit_image_task("场景图", {}, max_retries=1))


if __name__ == "__main__":
    unittest.main()
