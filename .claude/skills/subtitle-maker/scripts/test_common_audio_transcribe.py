#!/usr/bin/env python3
# input: subtitle-maker common_audio_transcribe + fake aos-cli adapter
# output: unittest assertions that ASR transcription builds aos-cli envelopes correctly
# pos: regression coverage for subtitle-maker audio.transcribe model boundary

import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


class CommonAudioTranscribeBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_module = sys.modules.get("common_audio_transcribe")

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("common_audio_transcribe", None)
        else:
            sys.modules["common_audio_transcribe"] = self._old_module

    def import_module(self):
        sys.modules.pop("common_audio_transcribe", None)
        return importlib.import_module("common_audio_transcribe")

    def import_envelope(self):
        return importlib.import_module("aos_cli_envelope")

    def test_call_audio_transcribe_uses_aos_cli_model_boundary(self):
        common_audio_transcribe = self.import_module()
        aos_cli_envelope = self.import_envelope()
        captured = {}

        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "ep001.mp4"
            video_path.write_bytes(b"fake-mp4")

            def fake_run(request_path, response_path, cwd=None):
                captured["request"] = json.loads(Path(request_path).read_text(encoding="utf-8"))
                captured["cwd"] = Path(cwd)
                Path(response_path).write_text(
                    json.dumps(
                        {
                            "ok": True,
                            "output": {
                                "kind": "json",
                                "data": {
                                    "segments": [
                                        {
                                            "start": "00:00:00,000",
                                            "end": "00:00:02,000",
                                            "speaker": "",
                                            "text": "hello",
                                        }
                                    ]
                                },
                            },
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                return type("Completed", (), {"returncode": 0, "stderr": ""})()

            with patch.object(aos_cli_envelope, "aos_cli_model_run", side_effect=fake_run):
                result = common_audio_transcribe.call_audio_transcribe(
                    video_path,
                    "transcribe this video",
                    task="subtitle-maker.phase2.transcribe",
                    model="asr-model",
                    language="zh",
                    cwd=Path.cwd(),
                    raw_output_dir=Path(tmp),
                )

        self.assertEqual(result[0]["text"], "hello")
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "subtitle-maker.phase2.transcribe")
        self.assertEqual(captured["request"]["capability"], "audio.transcribe")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asr-model"})
        self.assertEqual(captured["request"]["input"]["prompt"], "transcribe this video")
        self.assertEqual(captured["request"]["input"]["audio"], video_path.resolve().as_uri())
        self.assertEqual(captured["request"]["input"]["language"], "zh")

    def test_call_audio_transcribe_reports_missing_file_before_aos_cli(self):
        common_audio_transcribe = self.import_module()

        with self.assertRaisesRegex(FileNotFoundError, "Missing audio or video input"):
            common_audio_transcribe.call_audio_transcribe(
                Path("/missing/ep001.mp4"),
                "transcribe",
                task="subtitle-maker.phase2.transcribe",
            )


if __name__ == "__main__":
    unittest.main()
