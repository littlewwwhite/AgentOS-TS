#!/usr/bin/env python3
# input: storyboard_batch model boundary adapter and temporary project fixtures
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

    def test_aos_cli_client_uses_json_model_boundary(self):
        import storyboard_batch
        importlib.reload(storyboard_batch)

        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {
                        "kind": "json",
                        "data": [{"source_refs": ["beat_001"], "prompt": "镜头推进"}],
                    },
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            client = storyboard_batch.StoryboardModelClient(project_dir=project_dir)
            with patch.object(storyboard_batch, "aos_cli_model_run", side_effect=fake_run):
                result = client.generate("system prompt", "user content", "storyboard-model")

        self.assertEqual(result, [{"source_refs": ["beat_001"], "prompt": "镜头推进"}])
        self.assertEqual(captured["cwd"], project_dir.resolve())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "storyboard.batch")
        self.assertEqual(captured["request"]["capability"], "generate")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["input"]["system"], "system prompt")
        self.assertEqual(captured["request"]["input"]["content"], "user content")
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "storyboard-model"})

    def test_aos_cli_client_parses_text_fallback(self):
        import storyboard_batch

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {
                        "kind": "text",
                        "text": "```json\n[{\"source_refs\":[\"beat_002\"],\"prompt\":\"俯拍走廊\"}]\n```",
                    },
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp:
            client = storyboard_batch.StoryboardModelClient(project_dir=Path(tmp))
            with patch.object(storyboard_batch, "aos_cli_model_run", side_effect=fake_run):
                result = client.generate("system prompt", "user content", None)

        self.assertEqual(result, [{"source_refs": ["beat_002"], "prompt": "俯拍走廊"}])

    def test_aos_cli_client_reports_missing_response_envelope(self):
        import storyboard_batch

        def fake_run(request_path, response_path, cwd=None):
            return type("Completed", (), {"returncode": 7, "stderr": "aos-cli failed"})()

        with tempfile.TemporaryDirectory() as tmp:
            client = storyboard_batch.StoryboardModelClient(project_dir=Path(tmp))
            with patch.object(storyboard_batch, "aos_cli_model_run", side_effect=fake_run):
                with self.assertRaisesRegex(RuntimeError, "aos-cli failed"):
                    client.generate("system prompt", "user content", None)

    def test_default_text_model_prefers_storyboard_override(self):
        import storyboard_batch
        importlib.reload(storyboard_batch)

        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-flash-lite")

        os.environ["GEMINI_TEXT_MODEL"] = "gemini-3.1-pro-preview"
        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-pro-preview")

        os.environ["STORYBOARD_TEXT_MODEL"] = "storyboard-model"
        self.assertEqual(storyboard_batch.get_default_text_model(), "storyboard-model")

    def test_normalizes_source_refs_to_scene_indexes(self):
        import storyboard_batch

        scene = {
            "scene_id": "scn001",
            "actions": [{"action_id": "act_001"}, {"action_id": "act_002"}],
        }

        result = storyboard_batch.normalize_scene_shots(
            {"shots": [{"source_refs": ["act_002", 0], "prompt": "draft prompt"}]},
            scene,
        )

        self.assertEqual(result, [{"source_refs": [1, 0], "prompt": "draft prompt"}])

    def test_empty_actions_falls_back_to_beats_for_source_refs(self):
        import storyboard_batch

        scene = {
            "scene_id": "scn001",
            "actions": [],
            "beats": [{"beat_id": "beat_001"}, {"beat_id": "beat_002"}],
        }

        result = storyboard_batch.normalize_scene_shots(
            {"shots": [{"source_refs": ["beat_002", 0], "prompt": "draft prompt"}]},
            scene,
        )

        self.assertEqual(result, [{"source_refs": [1, 0], "prompt": "draft prompt"}])

    def test_source_refs_require_scene_source_items(self):
        import storyboard_batch

        with self.assertRaisesRegex(ValueError, "source_ref out of range"):
            storyboard_batch.normalize_scene_shots(
                {"shots": [{"source_refs": [0], "prompt": "draft prompt"}]},
                {"scene_id": "scn001"},
            )

    def test_writes_draft_without_mutating_script(self):
        import storyboard_batch

        class FakeClient:
            def generate(self, system_prompt, user_content, model):
                return [{"source_refs": ["beat_001"], "prompt": "draft prompt"}]

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
                    model="storyboard-model",
                )

            draft_path = project_dir / "output" / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertTrue(ok, status)
            self.assertTrue(draft_path.exists())
            self.assertNotIn("shots", script["episodes"][0]["scenes"][0])
            self.assertFalse((project_dir / "output" / "script.json").exists())
            draft_data = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(draft_data["episode_id"], "ep001")
            self.assertEqual(draft_data["status"], "draft")
            self.assertEqual(draft_data["scenes"][0]["shots"][0]["source_refs"], [0])
            self.assertEqual(draft_data["scenes"][0]["shots"][0]["prompt"], "draft prompt")

    def test_generation_failure_does_not_write_success_draft(self):
        import storyboard_batch

        class FailingClient:
            def generate(self, system_prompt, user_content, model):
                raise RuntimeError("model unavailable")

        script = {
            "episodes": [{
                "ep_id": "ep001",
                "scenes": [{"scene_id": "scn001", "beats": [{"beat_id": "beat_001"}]}],
            }]
        }

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            (project_dir / "output").mkdir()
            with patch.object(storyboard_batch, "load_storyboard_client", return_value=FailingClient()):
                ok, status = storyboard_batch.generate_all_storyboards(
                    project_dir=project_dir,
                    bible={},
                    script=script,
                    model="storyboard-model",
                )

            draft_path = project_dir / "output" / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertFalse(ok)
            self.assertIn("FAILED", status)
            self.assertFalse(draft_path.exists())


if __name__ == "__main__":
    unittest.main()
