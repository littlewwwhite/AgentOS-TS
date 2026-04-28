#!/usr/bin/env python3
"""Read-side structure gate at the VIDEO entry.

Asserts prepare_runtime_storyboard_export rejects legacy storyboard shapes
(missing id / duration / prompt) so they cannot silently fall through to
Ark with a default duration.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from path_manager import prepare_runtime_storyboard_export


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
