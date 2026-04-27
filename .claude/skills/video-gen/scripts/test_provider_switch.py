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

    def test_poll_multiple_tasks_maps_aos_cli_artifacts_to_video_fields(self):
        import video_api

        envelope_seed = {
            "ok": True,
            "apiVersion": "aos-cli.model/v1",
            "task": "video.generate",
            "capability": "video.generate",
            "output": {"kind": "task", "taskId": "task-poll-1"},
            "warnings": [],
        }

        result_envelope = {
            "ok": True,
            "apiVersion": "aos-cli.model/v1",
            "task": "video.generate",
            "capability": "video.generate",
            "output": {
                "kind": "task_result",
                "status": "SUCCESS",
                "artifacts": [
                    {
                        "kind": "video",
                        "uri": "https://cdn.example.com/out.mp4",
                        "lastFrameUrl": "https://cdn.example.com/last.png",
                        "durationSeconds": 8.0,
                    }
                ],
            },
            "warnings": [],
        }

        with patch.object(video_api, "poll_video_generation", return_value=result_envelope), \
             patch.object(video_api, "download_video", return_value="/tmp/out.mp4"):
            results = video_api.poll_multiple_tasks(
                tasks=[{
                    "task_id": "task-poll-1",
                    "task_envelope": envelope_seed,
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
        self.assertEqual(results[0]["actual_duration_seconds"], 8.0)
        self.assertEqual(results[0]["video_path"], "/tmp/out.mp4")


def test_video_submit_uses_aos_cli_task_boundary(tmp_path, monkeypatch):
    import video_api

    calls = []

    def fake_submit(request_path, task_path, *, cwd=None):
        calls.append((request_path, task_path, cwd))
        request = json.loads(request_path.read_text(encoding="utf-8"))
        assert request["apiVersion"] == "aos-cli.model/v1"
        assert request["capability"] == "video.generate"
        assert request["output"]["kind"] == "task"
        task_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "video.ep001.scn001.clip001",
                    "capability": "video.generate",
                    "output": {"kind": "task", "taskId": "task-1"},
                    "provider": "ark",
                    "model": "fake-video-model",
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(video_api, "aos_cli_model_submit", fake_submit)

    result = video_api.submit_video_generation(
        prompt="Slow camera push.",
        duration=5,
        ratio="16:9",
        quality="standard",
        project_dir=tmp_path,
        task="video.ep001.scn001.clip001",
    )

    assert calls
    assert result["output"]["taskId"] == "task-1"


def test_video_poll_uses_aos_cli_task_result_boundary(tmp_path, monkeypatch):
    import video_api

    def fake_poll(task_path, result_path, *, cwd=None):
        result_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "video.ep001.scn001.clip001",
                    "capability": "video.generate",
                    "output": {
                        "kind": "task_result",
                        "status": "SUCCESS",
                        "artifacts": [
                            {
                                "kind": "video",
                                "uri": "https://example.test/video.mp4",
                                "lastFrameUrl": "https://example.test/last.png",
                            }
                        ],
                    },
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(video_api, "aos_cli_model_poll", fake_poll)

    result = video_api.poll_video_generation(
        task_envelope={
            "ok": True,
            "apiVersion": "aos-cli.model/v1",
            "task": "video.ep001.scn001.clip001",
            "capability": "video.generate",
            "output": {"kind": "task", "taskId": "task-1"},
            "warnings": [],
        },
        project_dir=tmp_path,
    )

    assert result["output"]["status"] == "SUCCESS"
    assert result["output"]["artifacts"][0]["lastFrameUrl"] == "https://example.test/last.png"


if __name__ == "__main__":
    unittest.main()
