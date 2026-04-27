#!/usr/bin/env python3
# input: music-matcher video analysis scripts and fake aos-cli model adapter
# output: unittest assertions that music analysis uses the aos-cli video.analyze boundary
# pos: regression coverage for the music-matcher model boundary

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


class MusicMatcherAosCliVideoAnalysisTest(unittest.TestCase):
    def import_module(self, name: str):
        sys.modules.pop(name, None)
        return importlib.import_module(name)

    def test_analyze_with_aos_cli_uses_video_analyze_boundary(self):
        analyze_video = self.import_module("analyze_video")
        captured = {}

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video_path = tmp_path / "clip.mp4"
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
                                "data": [
                                    {
                                        "segment_id": 1,
                                        "start": "00:00",
                                        "end": "00:05",
                                        "needs_music": True,
                                    }
                                ],
                            },
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                return type("Completed", (), {"returncode": 0, "stderr": ""})()

            with patch.object(analyze_video, "aos_cli_model_run", side_effect=fake_run):
                segments = analyze_video.analyze_with_aos_cli(
                    str(video_path),
                    "clip",
                    output_dir=tmp_path,
                    cwd=Path.cwd(),
                )

        self.assertEqual(segments[0]["segment_id"], 1)
        self.assertEqual(segments[0]["duration_seconds"], 5.0)
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "music-matcher.analyze-video")
        self.assertEqual(captured["request"]["capability"], "video.analyze")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": analyze_video.VIDEO_ANALYZE_MODEL})
        content = captured["request"]["input"]["content"]
        self.assertEqual(content["videos"], [video_path.resolve().as_uri()])
        self.assertIn("专业的影视配乐顾问", content["prompt"])

    def test_batch_analyze_single_reuses_aos_cli_analysis(self):
        batch_analyze = self.import_module("batch_analyze")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video_path = tmp_path / "clip.mp4"
            video_path.write_bytes(b"fake-mp4")
            batch_analyze.OUTPUT_DIR = tmp_path / "output"

            with patch.object(
                batch_analyze,
                "analyze_with_aos_cli",
                return_value=[
                    {
                        "segment_id": 1,
                        "start": "00:00",
                        "end": "00:03",
                        "needs_music": False,
                        "duration_seconds": 3.0,
                    }
                ],
            ) as fake_analyze:
                result = batch_analyze.analyze_single(video_path, 1, 1)

            output_path = batch_analyze.OUTPUT_DIR / "segments-clip.json"
            saved = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(result, {"video": "clip.mp4", "status": "success", "segments": 1})
        fake_analyze.assert_called_once()
        self.assertEqual(saved[0]["duration_seconds"], 3.0)


if __name__ == "__main__":
    unittest.main()
