#!/usr/bin/env python3
"""Read-side structure gate at the VIDEO entry.

Asserts prepare_runtime_storyboard_export rejects legacy storyboard shapes
(missing id / duration / prompt) so they cannot silently fall through to
Ark with a default duration.
"""
import json
import tempfile
import unittest
from pathlib import Path

from path_manager import _validate_minimal_shots, prepare_runtime_storyboard_export


def _valid_shot(idx: int) -> dict:
    return {
        "id": f"scn_001_clip{idx:03d}",
        "duration": 5,
        "prompt": "test prompt with @act_001",
    }


def _valid_storyboard() -> dict:
    return {
        "episode_id": "ep001",
        "scenes": [{"scene_id": "scn_001", "shots": [_valid_shot(1), _valid_shot(2)]}],
    }


class ValidateMinimalShotsTest(unittest.TestCase):
    def test_accepts_valid_minimal_schema(self) -> None:
        _validate_minimal_shots(_valid_storyboard(), "valid")

    def test_rejects_legacy_source_refs_shape(self) -> None:
        legacy = {
            "episode_id": "ep001",
            "scenes": [
                {"scene_id": "scn_001", "shots": [{"source_refs": [0, 1], "prompt": "x"}]}
            ],
        }
        with self.assertRaisesRegex(ValueError, "id must match"):
            _validate_minimal_shots(legacy, "legacy")

    def test_rejects_missing_duration(self) -> None:
        sb = _valid_storyboard()
        del sb["scenes"][0]["shots"][0]["duration"]
        with self.assertRaisesRegex(ValueError, "duration must be int"):
            _validate_minimal_shots(sb, "missing-dur")

    def test_rejects_out_of_range_duration(self) -> None:
        sb = _valid_storyboard()
        sb["scenes"][0]["shots"][0]["duration"] = 3
        with self.assertRaisesRegex(ValueError, r"\[4, 15\]"):
            _validate_minimal_shots(sb, "below-range")

    def test_rejects_empty_prompt(self) -> None:
        sb = _valid_storyboard()
        sb["scenes"][0]["shots"][0]["prompt"] = "   "
        with self.assertRaisesRegex(ValueError, "prompt must be"):
            _validate_minimal_shots(sb, "blank-prompt")

    def test_rejects_empty_scenes(self) -> None:
        with self.assertRaisesRegex(ValueError, "scenes\\[\\] missing or empty"):
            _validate_minimal_shots({"episode_id": "ep001", "scenes": []}, "empty")


class PrepareRuntimeExportGateTest(unittest.TestCase):
    def test_runtime_export_blocks_legacy_storyboard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp) / "output" / "ep001"
            output_root.mkdir(parents=True)
            approved_dir = Path(tmp) / "output" / "storyboard" / "approved"
            approved_dir.mkdir(parents=True)
            legacy_path = approved_dir / "ep001_storyboard.json"
            legacy_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scenes": [
                            {
                                "scene_id": "scn_001",
                                "shots": [{"source_refs": [0], "prompt": "x"}],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "Legacy storyboard schema"):
                prepare_runtime_storyboard_export(
                    requested_storyboard_path=str(legacy_path),
                    output_root=str(output_root),
                    episode=1,
                )

    def test_runtime_export_passes_minimal_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp) / "output" / "ep001"
            output_root.mkdir(parents=True)
            approved_dir = Path(tmp) / "output" / "storyboard" / "approved"
            approved_dir.mkdir(parents=True)
            approved_path = approved_dir / "ep001_storyboard.json"
            approved_path.write_text(
                json.dumps(_valid_storyboard()), encoding="utf-8"
            )

            runtime_path, source_kind = prepare_runtime_storyboard_export(
                requested_storyboard_path=str(approved_path),
                output_root=str(output_root),
                episode=1,
            )
            self.assertEqual(source_kind, "approved")
            self.assertTrue(runtime_path.exists())


if __name__ == "__main__":
    unittest.main()
