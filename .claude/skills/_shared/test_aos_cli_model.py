#!/usr/bin/env python3
# input: repo-local aos-cli examples and shared adapter import path
# output: regression checks for CLI adapter command resolution
# pos: smoke coverage for skill-side model CLI adapter

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = REPO_ROOT / "aos-cli" / "examples"
ADAPTER_PATH = Path(__file__).with_name("aos_cli_model.py")

spec = importlib.util.spec_from_file_location("aos_cli_model", ADAPTER_PATH)
assert spec and spec.loader
aos_cli_model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aos_cli_model)


class AosCliModelAdapterTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        os.environ["AOS_CLI_MODEL_FAKE"] = "1"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_run_resolves_cli_from_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "response.json"

            result = aos_cli_model.aos_cli_model_run(
                EXAMPLES / "text.request.json",
                output_path,
                cwd=REPO_ROOT,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["output"]["kind"], "text")

    def test_video_submit_poll_resolves_cli_from_skill_subdir(self):
        skill_subdir = REPO_ROOT / ".claude" / "skills" / "storyboard" / "scripts"
        with tempfile.TemporaryDirectory() as tmp:
            task_path = Path(tmp) / "task.json"
            result_path = Path(tmp) / "result.json"

            submit = aos_cli_model.aos_cli_model_submit(
                EXAMPLES / "video.submit.request.json",
                task_path,
                cwd=skill_subdir,
            )
            poll = aos_cli_model.aos_cli_model_poll(
                task_path,
                result_path,
                cwd=skill_subdir,
            )

            self.assertEqual(submit.returncode, 0, submit.stderr)
            self.assertEqual(poll.returncode, 0, poll.stderr)
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["output"]["kind"], "task_result")

    def test_validate_command_returns_stdout_json_without_adapter_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            request_path = Path(tmp) / "request.json"
            request_path.write_text(
                json.dumps(
                    {
                        "apiVersion": "aos-cli.model/v1",
                        "task": "adapter-validate",
                        "capability": "generate",
                        "output": {"kind": "text"},
                        "input": {"content": "hello"},
                    }
                ),
                encoding="utf-8",
            )

            result = aos_cli_model.aos_cli_model_validate(request_path, cwd=REPO_ROOT)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["task"], "adapter-validate")
        self.assertEqual(payload["capability"], "generate")

    def test_adapter_source_does_not_import_json_or_model_modules(self):
        source = ADAPTER_PATH.read_text(encoding="utf-8")

        self.assertNotIn("import json", source)
        self.assertNotIn("from aos_cli.model", source)
        self.assertNotIn("import aos_cli.model", source)


if __name__ == "__main__":
    unittest.main()
