#!/usr/bin/env python3
# input: provider adapter modules under video-gen/scripts
# output: unittest assertions for provider switching behavior
# pos: regression coverage for external model provider adapters
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ProviderSwitchTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)
        try:
            import config_loader

            config_loader._config_cache.clear()
        except Exception:
            pass

    def test_config_loader_uses_gemini_env_key_with_chatfire_base_url(self):
        import config_loader

        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "video_model": {"active_model": "seedance2", "models": {}},
                        "gemini": {"api_key": "", "base_url": "https://example.test"},
                    }
                ),
                encoding="utf-8",
            )
            os.environ["STORYBOARD_CONFIG"] = str(config_path)
            os.environ["GEMINI_API_KEY"] = "env-chatfire-key"
            os.environ["GEMINI_BASE_URL"] = "https://api.chatfire.cn/gemini"
            config_loader._config_cache.clear()

            self.assertEqual(config_loader.get_gemini_config()["api_key"], "env-chatfire-key")
            self.assertEqual(config_loader.get_gemini_config()["api_key_env"], "GEMINI_API_KEY")
            self.assertEqual(
                config_loader.get_gemini_config()["base_url"],
                "https://api.chatfire.cn/gemini",
            )
            self.assertNotIn("sk-", json.dumps(config_loader._BUILTIN_DEFAULTS))

    def test_video_config_defaults_use_chatfire_gemini_proxy(self):
        import config_loader

        gemini = config_loader._BUILTIN_DEFAULTS["gemini"]
        self.assertEqual(gemini["base_url"], "https://api.chatfire.cn/gemini")
        self.assertEqual(gemini["api_key_env"], "GEMINI_API_KEY")

    def test_video_config_defaults_use_ark_only(self):
        import config_loader

        defaults = config_loader._BUILTIN_DEFAULTS["video_model"]
        self.assertEqual(defaults["provider"], "volcengine_ark")
        self.assertEqual(defaults["models"]["seedance2"]["provider"], "volcengine_ark")
        self.assertEqual(defaults["models"]["seedance2"]["model_code"], "ep-20260303234827-tfnzm")
        self.assertNotIn("kling_omni", defaults["models"])

    def test_asset_config_uses_seedance2_test_model_code(self):
        config_path = Path(__file__).resolve().parent.parent / "assets" / "config.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))

        model = config["video_model"]["models"]["seedance2"]
        self.assertEqual(model["provider"], "volcengine_ark")
        self.assertEqual(model["model_code"], "ep-20260303234827-tfnzm")

    def test_ark_payload_maps_refs_and_continuity(self):
        import video_api

        body = video_api.build_ark_video_task_body(
            model_code="ep-20260303234827-tfnzm",
            prompt="女孩走向镜头",
            reference_images=[
                {"url": "https://cdn.example.com/actor.png", "name": "act_001"},
                {"url": "https://cdn.example.com/prev.png", "name": "lsi"},
            ],
            reference_videos=[{"url": "https://cdn.example.com/prev.mp4"}],
            duration="8",
            quality="720",
            ratio="9:16",
            first_frame_url="https://cdn.example.com/prev.png",
            need_audio=True,
        )

        self.assertEqual(body["model"], "ep-20260303234827-tfnzm")
        self.assertEqual(body["duration"], 8)
        self.assertEqual(body["resolution"], "720p")
        self.assertEqual(body["ratio"], "9:16")
        self.assertTrue(body["generate_audio"])
        self.assertTrue(body["return_last_frame"])

        roles = [item.get("role") for item in body["content"] if item["type"] != "text"]
        self.assertEqual(roles.count("first_frame"), 1)
        self.assertEqual(roles.count("reference_image"), 1)
        self.assertEqual(roles.count("reference_video"), 1)
        self.assertTrue(
            any(
                item.get("role") == "first_frame"
                and item["image_url"]["url"].startswith("https://")
                for item in body["content"]
            )
        )

    def test_ark_poll_result_keeps_video_and_last_frame_urls(self):
        import video_api

        ark_response = {
            "id": "cgt-test",
            "status": "succeeded",
            "content": {
                "video_url": "https://cdn.example.com/out.mp4",
                "last_frame_url": "https://cdn.example.com/last.png",
            },
        }

        with patch.object(video_api, "poll_ark_video_task", return_value=ark_response), \
             patch.object(video_api, "download_video", return_value="/tmp/out.mp4"):
            results = video_api.poll_multiple_tasks(
                tasks=[{
                    "task_id": "cgt-test",
                    "output_path": "/tmp/out.mp4",
                    "provider": "volcengine_ark",
                    "model_code": "ep-20260303234827-tfnzm",
                }],
                interval=0,
                timeout=1,
            )

        self.assertTrue(results[0]["success"])
        self.assertEqual(results[0]["video_url"], "https://cdn.example.com/out.mp4")
        self.assertEqual(results[0]["last_frame_url"], "https://cdn.example.com/last.png")
        self.assertEqual(results[0]["video_path"], "/tmp/out.mp4")


if __name__ == "__main__":
    unittest.main()
