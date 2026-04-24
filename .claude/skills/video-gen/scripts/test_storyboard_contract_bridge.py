#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from path_manager import (
    build_validation_view_from_runtime_storyboard,
    count_storyboard_generation_units,
    prepare_runtime_storyboard_export,
    resolve_runtime_storyboard_path,
)


class StoryboardContractBridgeTest(unittest.TestCase):
    def test_resolves_runtime_storyboard_path_from_directory(self):
        resolved = resolve_runtime_storyboard_path("output/ep001", "output", 1)
        self.assertEqual(Path("output/ep001/ep001_storyboard.json"), resolved)

    def test_prefers_approved_canonical_and_exports_runtime_storyboard(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_root = project_dir / "output" / "ep001"
            output_root.mkdir(parents=True, exist_ok=True)

            approved_path = project_dir / "output" / "storyboard" / "approved" / "ep001_storyboard.json"
            approved_path.parent.mkdir(parents=True, exist_ok=True)
            approved_payload = {
                "episode_id": "ep001",
                "scenes": [
                    {
                        "scene_id": "scn_001",
                        "actors": [],
                        "locations": [],
                        "props": [],
                        "clips": [{"clip_id": "clip_001", "complete_prompt": "from approved"}],
                    }
                ],
            }
            approved_path.write_text(json.dumps(approved_payload, ensure_ascii=False), encoding="utf-8")

            runtime_path = output_root / "ep001_storyboard.json"
            runtime_path.write_text(
                json.dumps({"episode_id": "ep001", "scenes": []}, ensure_ascii=False),
                encoding="utf-8",
            )

            resolved_path, source_kind = prepare_runtime_storyboard_export(
                str(runtime_path),
                str(output_root),
                1,
            )

            self.assertEqual(resolved_path, runtime_path)
            self.assertEqual(source_kind, "approved")
            self.assertEqual(
                json.loads(runtime_path.read_text(encoding="utf-8")),
                approved_payload,
            )
            self.assertEqual(count_storyboard_generation_units(approved_payload), 1)

    def test_requires_approved_storyboard_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_root = project_dir / "output" / "ep001"
            output_root.mkdir(parents=True, exist_ok=True)

            requested_path = project_dir / "draft" / "storyboard" / "ep001_runtime_seed.json"
            requested_path.parent.mkdir(parents=True, exist_ok=True)
            requested_payload = {
                "episode_id": "ep001",
                "scenes": [
                    {
                        "scene_id": "scn_009",
                        "actors": [],
                        "locations": [],
                        "props": [],
                        "clips": [{"clip_id": "clip_001", "complete_prompt": "legacy fallback"}],
                    }
                ],
            }
            requested_path.write_text(json.dumps(requested_payload, ensure_ascii=False), encoding="utf-8")

            with self.assertRaises(FileNotFoundError):
                prepare_runtime_storyboard_export(
                    str(requested_path),
                    str(output_root),
                    1,
                )

    def test_can_explicitly_export_requested_storyboard_for_compatibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_root = project_dir / "output" / "ep001"
            output_root.mkdir(parents=True, exist_ok=True)

            requested_path = project_dir / "draft" / "storyboard" / "ep001_runtime_seed.json"
            requested_path.parent.mkdir(parents=True, exist_ok=True)
            requested_payload = {
                "episode_id": "ep001",
                "scenes": [
                    {
                        "scene_id": "scn_009",
                        "actors": [],
                        "locations": [],
                        "props": [],
                        "clips": [{"clip_id": "clip_001", "complete_prompt": "explicit compatibility export"}],
                    }
                ],
            }
            requested_path.write_text(json.dumps(requested_payload, ensure_ascii=False), encoding="utf-8")

            resolved_path, source_kind = prepare_runtime_storyboard_export(
                str(requested_path),
                str(output_root),
                1,
                allow_requested=True,
            )

            runtime_path = output_root / "ep001_storyboard.json"
            self.assertEqual(resolved_path, runtime_path)
            self.assertEqual(source_kind, "requested")
            self.assertEqual(
                json.loads(runtime_path.read_text(encoding="utf-8")),
                requested_payload,
            )

    def test_builds_validation_view_from_runtime_clips(self):
        storyboard_data = {
            "episode_id": "ep001",
            "title": "test",
            "scenes": [{
                "scene_id": "scn_001",
                "environment": {"time": "night", "weather": "rain"},
                "actors": [{"actor_id": "act_001"}],
                "locations": [{"location_id": "loc_001"}],
                "props": [{"prop_id": "prp_001"}],
                "clips": [{
                    "clip_id": "clip_001",
                    "script_source": "beat",
                    "expected_duration": 8,
                    "layout_prompt": "layout",
                    "shots": [{"shot_id": "shot_001", "partial_prompt": "p"}],
                    "complete_prompt": "full prompt",
                }],
            }],
        }

        validation_view = build_validation_view_from_runtime_storyboard(storyboard_data, 1)
        clip = validation_view["scenes"][0]["clips"][0]

        self.assertEqual(validation_view["episode"], 1)
        self.assertEqual(clip["characters"], ["act_001"])
        self.assertEqual(clip["location"], "loc_001")
        self.assertEqual(clip["props"], ["prp_001"])
        self.assertEqual(clip["complete_prompt"], "full prompt")

    def test_builds_validation_view_from_simplified_scene_shots(self):
        storyboard_data = {
            "episode_id": "ep001",
            "title": "test",
            "scenes": [{
                "scene_id": "scn_001",
                "environment": {"time": "day"},
                "actors": [{"actor_id": "act_001"}],
                "locations": [{"location_id": "loc_001"}],
                "props": [],
                "shots": [{
                    "source_refs": [0, 1],
                    "prompt": "simple prompt",
                }],
            }],
        }

        validation_view = build_validation_view_from_runtime_storyboard(storyboard_data, 1)
        clip = validation_view["scenes"][0]["clips"][0]

        self.assertEqual(count_storyboard_generation_units(storyboard_data), 1)
        self.assertEqual(clip["source"], "0,1")
        self.assertEqual(clip["complete_prompt"], "simple prompt")
        self.assertEqual(clip["characters"], ["act_001"])

    def test_generate_episode_json_short_circuits_to_approved_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            (output_dir / "storyboard" / "approved").mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_json = {
                "title": "demo",
                "actors": [{"actor_id": "act_001"}],
                "locations": [{"location_id": "loc_001"}],
                "props": [],
                "episodes": [{
                    "episode": 1,
                    "title": "ep1",
                }],
            }
            (output_dir / "script.json").write_text(
                json.dumps(script_json, ensure_ascii=False),
                encoding="utf-8",
            )

            approved_payload = {
                "episode_id": "ep001",
                "title": "approved ep1",
                "scenes": [{
                    "scene_id": "scn_001",
                    "environment": {"time": "night"},
                    "actors": [{"actor_id": "act_001"}],
                    "locations": [{"location_id": "loc_001"}],
                    "props": [],
                    "clips": [{
                        "clip_id": "clip_001",
                        "script_source": "beat",
                        "expected_duration": 8,
                        "layout_prompt": "layout",
                        "shots": [{"shot_id": "shot_001", "partial_prompt": "p"}],
                        "complete_prompt": "approved prompt",
                    }],
                }],
            }
            approved_path = output_dir / "storyboard" / "approved" / "ep001_storyboard.json"
            approved_path.write_text(json.dumps(approved_payload, ensure_ascii=False), encoding="utf-8")

            script_path = Path(__file__).resolve().parent / "generate_episode_json.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "--episode", "1",
                    "--script", str(output_dir / "script.json"),
                    "--output-root", str(output_dir),
                    "--workspace-root", str(draft_dir),
                    "--project-dir", str(project_dir),
                    "--no-generate-video",
                ],
                capture_output=True,
                text=True,
                cwd=script_path.parent,
            )

            runtime_path = output_dir / "ep001" / "ep001_storyboard.json"
            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}",
            )
            self.assertTrue(runtime_path.exists())
            self.assertIn("已批准 storyboard", result.stdout)
            self.assertEqual(
                json.loads(runtime_path.read_text(encoding="utf-8")),
                approved_payload,
            )

            state_path = project_dir / "pipeline-state.json"
            self.assertTrue(state_path.exists())
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "VIDEO")
            self.assertEqual(state["stages"]["VIDEO"]["status"], "running")
            self.assertEqual(
                state["episodes"]["ep001"]["video"]["status"],
                "partial",
            )
            self.assertEqual(
                state["episodes"]["ep001"]["video"]["artifact"],
                "output/ep001/ep001_storyboard.json",
            )

    def test_generate_episode_json_fails_without_approved_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            output_dir.mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_json = {
                "title": "demo",
                "actors": [],
                "locations": [],
                "props": [],
                "episodes": [{"episode": 1, "title": "ep1"}],
            }
            (output_dir / "script.json").write_text(
                json.dumps(script_json, ensure_ascii=False),
                encoding="utf-8",
            )

            script_path = Path(__file__).resolve().parent / "generate_episode_json.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "--episode", "1",
                    "--script", str(output_dir / "script.json"),
                    "--output-root", str(output_dir),
                    "--workspace-root", str(draft_dir),
                    "--project-dir", str(project_dir),
                    "--no-generate-video",
                ],
                capture_output=True,
                text=True,
                cwd=script_path.parent,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Approved storyboard not found", result.stderr)
            self.assertFalse((output_dir / "ep001" / "ep001_storyboard.json").exists())

    def test_batch_generate_resume_marks_episode_video_completed(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_root = project_dir / "output" / "ep001"
            output_root.mkdir(parents=True, exist_ok=True)
            storyboard_path = output_root / "ep001_storyboard.json"
            approved_path = project_dir / "output" / "storyboard" / "approved" / "ep001_storyboard.json"
            approved_path.parent.mkdir(parents=True, exist_ok=True)
            approved_payload = {
                "episode_id": "ep001",
                "scenes": [
                    {
                        "scene_id": "scn_001",
                        "actors": [],
                        "locations": [],
                        "props": [],
                        "clips": [
                            {
                                "clip_id": "clip_001",
                                "expected_duration": "3s",
                                "complete_prompt": "simple prompt",
                            }
                        ],
                    }
                ],
            }
            approved_path.write_text(
                json.dumps(approved_payload, ensure_ascii=False),
                encoding="utf-8",
            )

            scene_dir = output_root / "scn001"
            scene_dir.mkdir(parents=True, exist_ok=True)
            (scene_dir / "ep001_scn001_clip001.mp4").write_bytes(b"fake mp4")

            script_dir = Path(__file__).resolve().parent
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_dir / "batch_generate.py"),
                    str(storyboard_path),
                    "--output",
                    str(output_root),
                    "--episode",
                    "1",
                    "--resume",
                ],
                capture_output=True,
                text=True,
                cwd=script_dir,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}",
            )

            delivery_path = output_root / "ep001_delivery.json"
            self.assertTrue(delivery_path.exists())

            state_path = project_dir / "pipeline-state.json"
            self.assertTrue(state_path.exists())
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "VIDEO")
            self.assertEqual(state["stages"]["VIDEO"]["status"], "partial")
            self.assertEqual(state["next_action"], "review VIDEO")
            self.assertEqual(
                state["episodes"]["ep001"]["video"]["status"],
                "completed",
            )
            self.assertEqual(
                state["episodes"]["ep001"]["video"]["artifact"],
                "output/ep001/ep001_delivery.json",
            )


if __name__ == "__main__":
    unittest.main()
