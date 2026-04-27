#!/usr/bin/env python3
# input: subtitle-maker phase0_check preflight helpers
# output: unittest assertions for aos-cli model boundary readiness checks
# pos: regression coverage for subtitle-maker environment checks after ASR migration

import importlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class Phase0CheckTest(unittest.TestCase):
    def import_module(self):
        sys.modules.pop("phase0_check", None)
        return importlib.import_module("phase0_check")

    def test_check_aos_cli_capability_reads_audio_transcribe_preflight(self):
        phase0_check = self.import_module()
        preflight_payload = {
            "ok": False,
            "checks": [
                {"capability": "video.generate", "ok": False},
                {"capability": "audio.transcribe", "ok": True, "provider": "gemini", "probeMode": "env"},
            ],
        }

        def fake_run(args, cwd=None):
            self.assertEqual(args, ["model", "preflight", "--json"])
            return type(
                "Completed",
                (),
                {
                    "returncode": 2,
                    "stdout": json.dumps(preflight_payload),
                    "stderr": "",
                },
            )()

        with patch.object(phase0_check, "run_aos_cli", side_effect=fake_run):
            ok, message = phase0_check.check_aos_cli_capability("audio.transcribe")

        self.assertTrue(ok)
        self.assertIn("audio.transcribe", message)

    def test_check_aos_cli_capability_reports_missing_audio_config(self):
        phase0_check = self.import_module()
        missing_message = "GEMINI" + "_API_KEY is not set"
        preflight_payload = {
            "ok": False,
            "checks": [
                {
                    "capability": "audio.transcribe",
                    "ok": False,
                    "error": {"message": missing_message},
                }
            ],
        }

        def fake_run(args, cwd=None):
            return type(
                "Completed",
                (),
                {
                    "returncode": 2,
                    "stdout": json.dumps(preflight_payload),
                    "stderr": "",
                },
            )()

        with patch.object(phase0_check, "run_aos_cli", side_effect=fake_run):
            ok, message = phase0_check.check_aos_cli_capability("audio.transcribe")

        self.assertFalse(ok)
        self.assertIn(missing_message, message)


if __name__ == "__main__":
    unittest.main()
