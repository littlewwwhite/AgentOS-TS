#!/usr/bin/env python3
# input: storyboard_batch provider adapter and temporary project fixtures
# output: unittest assertions for offline storyboard draft generation
# pos: regression coverage for STORYBOARD-owned offline draft helper
import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class StoryboardBatchTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_chatfire_client_extracts_openai_compatible_text(self):
        import storyboard_batch

        response = {
            "choices": [
                {"message": {"content": "[{\"prompt\":\"镜头推进\"}]"}}
            ]
        }

        self.assertEqual(
            storyboard_batch.extract_chat_completion_text(response),
            "[{\"prompt\":\"镜头推进\"}]",
        )

    def test_loader_requires_gemini_env_by_default(self):
        os.environ.pop("GEMINI_API_KEY", None)

        import storyboard_batch
        importlib.reload(storyboard_batch)

        with self.assertRaises(SystemExit):
            storyboard_batch.load_storyboard_client()

    def test_loader_uses_gemini_env_key_with_chatfire_endpoint_by_default(self):
        os.environ["GEMINI_API_KEY"] = "chatfire-key"

        import storyboard_batch
        importlib.reload(storyboard_batch)

        client = storyboard_batch.load_storyboard_client()
        self.assertEqual(client.provider, "chatfire")
        self.assertEqual(client.api_key, "chatfire-key")
        self.assertEqual(client.base_url, "https://api.chatfire.cn/v1")

    def test_loader_can_use_chatfire_env_when_requested(self):
        os.environ["STORYBOARD_TEXT_PROVIDER"] = "chatfire"
        os.environ["GEMINI_API_KEY"] = "chatfire-key"

        import storyboard_batch
        importlib.reload(storyboard_batch)

        client = storyboard_batch.load_storyboard_client()
        self.assertEqual(client.provider, "chatfire")
        self.assertEqual(client.base_url, "https://api.chatfire.cn/v1")

    def test_default_text_model_tracks_provider(self):
        import storyboard_batch
        importlib.reload(storyboard_batch)

        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-flash-lite")

        os.environ["GEMINI_TEXT_MODEL"] = "gemini-3.1-pro-preview"
        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-pro-preview")

    def test_root_base_url_expands_to_v1_chat_completions(self):
        import storyboard_batch

        client = storyboard_batch.ChatFireStoryboardClient(
            api_key="key",
            base_url="https://api.chatfire.cn",
        )

        self.assertEqual(
            client.chat_completions_url,
            "https://api.chatfire.cn/v1/chat/completions",
        )

    def test_writes_draft_without_mutating_script(self):
        import storyboard_batch

        class FakeClient:
            def generate(self, system_prompt, user_content, model):
                return json.dumps([{"source_refs": ["beat_001"], "prompt": "draft prompt"}])

        script = {
            "episodes": [{
                "ep_id": "ep001",
                "scenes": [{"scene_id": "scn001", "beats": [{"beat_id": "beat_001"}]}],
            }]
        }
        bible = {"global_style": {"tone": "冷峻"}, "episodes": {"ep001": {"note": "近景压迫"}}}

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            (project_dir / "output").mkdir()
            with patch.object(storyboard_batch, "load_storyboard_client", return_value=FakeClient()):
                ok, status = storyboard_batch.generate_all_storyboards(
                    project_dir=project_dir,
                    bible=bible,
                    script=script,
                    model="gemini-3.1-flash-lite",
                )

            draft_path = project_dir / "output" / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertTrue(ok, status)
            self.assertTrue(draft_path.exists())
            self.assertNotIn("shots", script["episodes"][0]["scenes"][0])
            self.assertFalse((project_dir / "output" / "script.json").exists())
            draft_data = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(draft_data["episode_id"], "ep001")
            self.assertEqual(draft_data["status"], "draft")
            self.assertEqual(draft_data["scenes"][0]["shots"][0]["prompt"], "draft prompt")


if __name__ == "__main__":
    unittest.main()
