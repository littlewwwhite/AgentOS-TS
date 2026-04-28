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


def _shot(clip_num: int, duration: int = 8, prompt: str = "draft prompt") -> dict:
    return {
        "id": f"scn_001_clip{clip_num:03d}",
        "duration": duration,
        "prompt": prompt,
    }


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
        envelope = [{"id": "scn_001_clip001", "duration": 6, "prompt": "镜头推进"}]

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps({"ok": True, "output": {"kind": "json", "data": envelope}}, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            client = storyboard_batch.StoryboardModelClient(project_dir=project_dir)
            with patch.object(storyboard_batch, "aos_cli_model_run", side_effect=fake_run):
                result = client.generate("system prompt", "user content", "storyboard-model")

        self.assertEqual(result, envelope)
        self.assertEqual(captured["cwd"], project_dir.resolve())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "storyboard.batch")
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "storyboard-model"})

    def test_aos_cli_client_parses_text_fallback(self):
        import storyboard_batch

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {
                        "kind": "text",
                        "text": '```json\n[{"id":"scn_001_clip001","duration":7,"prompt":"俯拍走廊"}]\n```',
                    },
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp:
            client = storyboard_batch.StoryboardModelClient(project_dir=Path(tmp))
            with patch.object(storyboard_batch, "aos_cli_model_run", side_effect=fake_run):
                result = client.generate("system prompt", "user content", None)

        self.assertEqual(result, [{"id": "scn_001_clip001", "duration": 7, "prompt": "俯拍走廊"}])

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

        os.environ.pop("STORYBOARD_TEXT_MODEL", None)
        os.environ.pop("GEMINI_TEXT_MODEL", None)
        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-flash-lite")

        os.environ["GEMINI_TEXT_MODEL"] = "gemini-3.1-pro-preview"
        self.assertEqual(storyboard_batch.get_default_text_model(), "gemini-3.1-pro-preview")

        os.environ["STORYBOARD_TEXT_MODEL"] = "storyboard-model"
        self.assertEqual(storyboard_batch.get_default_text_model(), "storyboard-model")


class NormalizeShotsTest(unittest.TestCase):
    def test_passes_through_canonical_envelope(self):
        import storyboard_batch
        scene = {"scene_id": "scn_001"}
        result = storyboard_batch.normalize_scene_shots([_shot(1, 8), _shot(2, 12)], scene)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["duration"], 8)
        self.assertEqual(result[1]["id"], "scn_001_clip002")

    def test_backfills_missing_id_from_scene(self):
        import storyboard_batch
        scene = {"scene_id": "scn_007"}
        result = storyboard_batch.normalize_scene_shots(
            [{"duration": 5, "prompt": "p"}, {"duration": 6, "prompt": "q"}], scene,
        )
        self.assertEqual(result[0]["id"], "scn_007_clip001")
        self.assertEqual(result[1]["id"], "scn_007_clip002")

    def test_rejects_missing_duration(self):
        import storyboard_batch
        with self.assertRaisesRegex(ValueError, "duration"):
            storyboard_batch.normalize_scene_shots(
                [{"id": "scn_001_clip001", "prompt": "p"}], {"scene_id": "scn_001"},
            )

    def test_rejects_out_of_range_duration(self):
        import storyboard_batch
        with self.assertRaisesRegex(ValueError, r"duration must be int in \[4, 15\]"):
            storyboard_batch.normalize_scene_shots(
                [{"id": "scn_001_clip001", "duration": 16, "prompt": "p"}], {"scene_id": "scn_001"},
            )

    def test_rejects_empty_prompt(self):
        import storyboard_batch
        with self.assertRaisesRegex(ValueError, "prompt"):
            storyboard_batch.normalize_scene_shots(
                [{"id": "scn_001_clip001", "duration": 8, "prompt": ""}], {"scene_id": "scn_001"},
            )

    def test_rejects_malformed_id(self):
        import storyboard_batch
        with self.assertRaisesRegex(ValueError, r"id must match \^scn_"):
            storyboard_batch.normalize_scene_shots(
                [{"id": "scn1_clip1", "duration": 8, "prompt": "p"}], {"scene_id": "scn_001"},
            )


class ValidateShotsTest(unittest.TestCase):
    def test_pass_with_sequential_ids(self):
        import storyboard_batch
        shots = [_shot(1, 5), _shot(2, 8), _shot(3, 12)]
        ok, msg = storyboard_batch.validate_scene_shots(shots, {"scene_id": "scn_001"})
        self.assertTrue(ok, msg)
        self.assertIn("total_duration=25s", msg)

    def test_fail_on_id_gap(self):
        import storyboard_batch
        shots = [_shot(1, 5), _shot(3, 8)]
        ok, msg = storyboard_batch.validate_scene_shots(shots, {"scene_id": "scn_001"})
        self.assertFalse(ok)
        self.assertIn("out of sequence", msg)

    def test_fail_on_empty(self):
        import storyboard_batch
        ok, _ = storyboard_batch.validate_scene_shots([], None)
        self.assertFalse(ok)


class GenerateAllStoryboardsTest(unittest.TestCase):
    def test_writes_draft_without_mutating_script(self):
        import storyboard_batch

        sample_prompt = (
            "中景|缓推\n\n"
            "总体描述：@act_001 走入 @loc_001\n\n"
            "动作：迈步穿过走廊\n\n"
            "角色状态：@act_001 居中，紧绷\n\n"
            "音效：脚步声\n\n"
            "对白：无\n"
        )

        class FakeClient:
            def generate(self, system_prompt, user_content, model):
                return [{"id": "scn_001_clip001", "duration": 8, "prompt": sample_prompt}]

        script = {
            "episodes": [{
                "episode_id": "ep001",
                "scenes": [{"scene_id": "scn_001", "beats": [{"beat_id": "beat_001"}]}],
            }]
        }
        bible = {"global_style": {"tone": "冷峻"}, "episodes": {"ep001": {"note": "近景压迫"}}}

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            (project_dir / "output").mkdir()
            (project_dir / "output" / "script.json").write_text(
                json.dumps(script, ensure_ascii=False), encoding="utf-8"
            )
            with patch.object(storyboard_batch, "load_storyboard_client", return_value=FakeClient()):
                ok, status = storyboard_batch.generate_all_storyboards(
                    project_dir=project_dir, bible=bible, script=script, model="storyboard-model",
                )

            draft_path = project_dir / "output" / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertTrue(ok, status)
            self.assertTrue(draft_path.exists())
            self.assertNotIn("shots", script["episodes"][0]["scenes"][0])
            draft_data = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertEqual(draft_data["episode_id"], "ep001")
            self.assertEqual(draft_data["status"], "draft")
            shot = draft_data["scenes"][0]["shots"][0]
            self.assertEqual(shot["id"], "scn_001_clip001")
            self.assertEqual(shot["duration"], 8)
            self.assertEqual(shot["prompt"], sample_prompt)

            state_path = project_dir / "pipeline-state.json"
            self.assertTrue(state_path.exists(), "apply_storyboard_result must sync pipeline-state")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn("STORYBOARD", state["stages"])
            self.assertIn(state["stages"]["STORYBOARD"]["status"], {"partial", "completed"})

    def test_generation_failure_does_not_write_success_draft(self):
        import storyboard_batch

        class FailingClient:
            def generate(self, system_prompt, user_content, model):
                raise RuntimeError("model unavailable")

        script = {
            "episodes": [{
                "ep_id": "ep001",
                "scenes": [{"scene_id": "scn_001", "beats": [{"beat_id": "beat_001"}]}],
            }]
        }

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            (project_dir / "output").mkdir()
            with patch.object(storyboard_batch, "load_storyboard_client", return_value=FailingClient()):
                ok, status = storyboard_batch.generate_all_storyboards(
                    project_dir=project_dir, bible={}, script=script, model="storyboard-model",
                )

            draft_path = project_dir / "output" / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertFalse(ok)
            self.assertIn("FAILED", status)
            self.assertFalse(draft_path.exists())


class ActorsCatalogTest(unittest.TestCase):
    def test_build_actors_catalog_extracts_states(self):
        import storyboard_batch
        script = {
            "actors": [
                {
                    "actor_id": "act_001",
                    "actor_name": "Rosalind",
                    "states": [
                        {"state_id": "st_001", "state_name": "Slave"},
                        {"state_id": "st_002", "state_name": "Attendant"},
                    ],
                },
                {"actor_id": "act_002", "actor_name": "Cyrus"},
            ]
        }
        catalog = storyboard_batch.build_actors_catalog(script)
        self.assertEqual(len(catalog), 2)
        self.assertEqual(len(catalog[0]["states"]), 2)
        self.assertEqual(catalog[1]["states"], [])

    def test_render_actors_catalog_marks_multi_state(self):
        import storyboard_batch
        rendered = storyboard_batch.render_actors_catalog([
            {"actor_id": "act_001", "actor_name": "Rosalind", "states": [
                {"state_id": "st_001", "state_name": "Slave"},
                {"state_id": "st_002", "state_name": "Attendant"},
            ]},
            {"actor_id": "act_002", "actor_name": "Cyrus", "states": []},
        ])
        self.assertIn("@act_001:st_xxx", rendered)
        self.assertIn("st_001=Slave", rendered)
        self.assertIn("@act_002", rendered)
        self.assertNotIn("@act_002:st_xxx", rendered)

    def test_generate_scene_prompt_injects_catalog(self):
        import storyboard_batch
        captured = {}

        class CapturingClient:
            def generate(self, system_prompt, user_content, model):
                captured["user"] = user_content
                return [{"id": "scn_001_clip001", "duration": 8, "prompt": "中景|缓推\n\n总体描述：@act_001"}]

        scene = {"scene_id": "scn_001", "beats": [{"beat_id": "beat_001"}]}
        catalog = [{"actor_id": "act_001", "actor_name": "Rosalind", "states": [
            {"state_id": "st_001", "state_name": "Slave"},
        ]}]
        storyboard_batch.generate_scene_prompt(
            CapturingClient(), "system", "notes", scene, "model", actors_catalog=catalog,
        )
        self.assertIn("角色状态目录", captured["user"])
        self.assertIn("act_001", captured["user"])


if __name__ == "__main__":
    unittest.main()
