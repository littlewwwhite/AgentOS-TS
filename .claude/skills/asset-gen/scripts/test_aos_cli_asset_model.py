# input: asset-gen image prompts and mocked aos-cli model envelopes
# output: unittest assertions for aos-cli image artifact boundary behavior
# pos: regression coverage for asset-gen image provider migration

from __future__ import annotations

import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class AosCliAssetImageModelTest(unittest.TestCase):
    def setUp(self) -> None:
        sys.modules.pop("common_image_api", None)
        self.common_image_api = importlib.import_module("common_image_api")
        self.aos_cli_envelope = importlib.import_module("aos_cli_envelope")
        self.common_image_api._TASKS.clear()

    def tearDown(self) -> None:
        self.common_image_api._TASKS.clear()

    def test_submit_image_task_uses_aos_cli_artifact_boundary(self) -> None:
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps(
                    {
                        "ok": True,
                        "output": {
                            "kind": "artifact",
                            "artifacts": [
                                {
                                    "kind": "image",
                                    "uri": "file:///tmp/asset.png",
                                    "remoteUrl": "https://cdn.example.test/asset.png",
                                    "mimeType": "image/png",
                                    "role": "character.front",
                                }
                            ],
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        params = {
            "ratio": "16:9",
            "quality": "2K",
            "generate_num": "1",
            "iref": ["https://cdn.example.test/ref.png"],
            "local_dir": "workspace/project/output/actors",
            "role": "character.front",
            "task": "asset.character.generate",
        }

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            task_id = self.common_image_api.submit_image_task(
                "asset-image-model",
                "A cinematic character concept portrait under moonlight.",
                params=params,
                max_retries=1,
            )

        self.assertIsNotNone(task_id)
        self.assertEqual(captured["cwd"], Path.cwd().resolve())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "asset.character.generate")
        self.assertEqual(captured["request"]["capability"], "image.generate")
        self.assertEqual(captured["request"]["output"], {"kind": "artifact"})
        self.assertEqual(
            captured["request"]["input"],
            {"prompt": "A cinematic character concept portrait under moonlight."},
        )
        self.assertEqual(
            captured["request"]["options"],
            {
                "size": "1536x1024",
                "quality": "2K",
                "generateNum": 1,
                "referenceImages": ["https://cdn.example.test/ref.png"],
            },
        )
        self.assertEqual(
            captured["request"]["artifactPolicy"],
            {
                "download": True,
                "localDir": str(Path("workspace/project/output/actors").resolve()),
                "role": "character.front",
            },
        )
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asset-image-model"})

        task = self.common_image_api.check_task_once(task_id)
        self.assertEqual(task["status"], "succeeded")
        self.assertEqual(task["result_urls"], ["file:///tmp/asset.png"])
        self.assertEqual(task["display_urls"], ["https://cdn.example.test/asset.png"])
        self.assertEqual(task["artifacts"][0]["role"], "character.front")
        self.assertEqual(
            self.common_image_api.poll_image_task(task_id),
            {
                "result": ["file:///tmp/asset.png"],
                "show": ["https://cdn.example.test/asset.png"],
            },
        )

    def test_submit_image_task_uses_uri_when_remote_url_is_absent(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps(
                    {
                        "ok": True,
                        "output": {
                            "kind": "artifact",
                            "artifacts": [
                                {
                                    "kind": "image",
                                    "uri": "file:///tmp/local-only.png",
                                    "mimeType": "image/png",
                                }
                            ],
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            task_id = self.common_image_api.submit_image_task("", "prompt", params={}, max_retries=1)

        self.assertEqual(
            self.common_image_api.poll_image_task(task_id),
            {"result": ["file:///tmp/local-only.png"], "show": ["file:///tmp/local-only.png"]},
        )

    def test_download_image_copies_file_uri_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.png"
            target = Path(tmp) / "nested" / "target.png"
            source.write_bytes(b"png-bytes")

            result = self.common_image_api.download_image(source.resolve().as_uri(), target)

            self.assertEqual(result, str(target))
            self.assertEqual(target.read_bytes(), b"png-bytes")

    def test_wrong_output_kind_fails(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({"ok": True, "output": {"kind": "text", "text": "nope"}}, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "output.kind mismatch"):
                self.common_image_api._post_generation("prompt", {}, "asset-image-model")

    def test_missing_artifacts_fails(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({"ok": True, "output": {"kind": "artifact", "artifacts": []}}, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing output.artifacts"):
                self.common_image_api._post_generation("prompt", {}, "asset-image-model")

    def test_non_object_artifact_fails(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps(
                    {"ok": True, "output": {"kind": "artifact", "artifacts": ["file:///tmp/asset.png"]}},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "artifact must be an object"):
                self.common_image_api._post_generation("prompt", {}, "asset-image-model")

    def test_rate_limited_error_maps_to_insufficient_credits(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps(
                    {
                        "ok": False,
                        "error": {"code": "RATE_LIMITED", "message": "quota exhausted"},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(self.common_image_api.InsufficientCreditsError, "quota exhausted"):
                self.common_image_api.submit_image_task("", "prompt", params={}, max_retries=1)

    def test_missing_response_reports_cli_stderr(self) -> None:
        def fake_run(request_path, response_path, cwd=None):
            return type("Completed", (), {"returncode": 2, "stderr": "invalid request"})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "invalid request"):
                self.common_image_api._post_generation("prompt", {}, "asset-image-model")

    def test_image_api_preserves_submit_and_poll_contract(self) -> None:
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            captured["request"] = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps(
                    {
                        "ok": True,
                        "apiVersion": "aos-cli.model/v1",
                        "task": "asset-gen.image",
                        "capability": "image.generate",
                        "output": {
                            "kind": "artifact",
                            "artifacts": [
                                {
                                    "kind": "image",
                                    "uri": "file:///tmp/actor.png",
                                    "remoteUrl": "https://example.test/actor.png",
                                    "mimeType": "image/png",
                                    "sha256": "abc",
                                    "bytes": 3,
                                    "role": "character.front",
                                }
                            ],
                        },
                        "warnings": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir).resolve()
            with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
                task_id = self.common_image_api.submit_image_task(
                    "ignored-by-boundary",
                    "Moonlit portrait",
                    params={"local_dir": str(tmp_path), "role": "character.front"},
                    project_dir=tmp_path,
                )
                result = self.common_image_api.check_task_once(task_id)

            self.assertEqual(captured["cwd"], tmp_path)
            self.assertEqual(captured["request"]["capability"], "image.generate")
            self.assertEqual(captured["request"]["output"], {"kind": "artifact"})
            self.assertEqual(captured["request"]["artifactPolicy"]["download"], True)
            self.assertEqual(captured["request"]["artifactPolicy"]["localDir"], str(tmp_path))
            self.assertEqual(captured["request"]["artifactPolicy"]["role"], "character.front")
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["result_urls"], ["file:///tmp/actor.png"])
            self.assertEqual(result["display_urls"], ["https://example.test/actor.png"])
            self.assertEqual(result["artifacts"][0]["sha256"], "abc")

    def test_retry_exhaustion_returns_none_without_storing_task(self) -> None:
        attempts = {"count": 0}

        def fake_run(request_path, response_path, cwd=None):
            attempts["count"] += 1
            Path(response_path).write_text(
                json.dumps(
                    {"ok": False, "error": {"code": "PROVIDER_ERROR", "message": "boom"}},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(self.aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
            with patch.object(self.common_image_api.time, "sleep", lambda *_: None):
                task_id = self.common_image_api.submit_image_task(
                    "asset-image-model",
                    "prompt",
                    params={},
                    max_retries=2,
                )

        self.assertIsNone(task_id)
        self.assertEqual(attempts["count"], 2)
        self.assertEqual(self.common_image_api._TASKS, {})


if __name__ == "__main__":
    unittest.main()
