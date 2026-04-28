#!/usr/bin/env python3
# input: storyboard apply helper plus temporary project fixtures
# output: unittest coverage for STORYBOARD stage pipeline-state synchronization
# pos: regression bridge ensuring storyboard writeback updates shared state safely

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class StoryboardPipelineStateBridgeTest(unittest.TestCase):
    def test_apply_storyboard_result_writes_draft_and_marks_episode_completed(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            output_dir.mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_path = output_dir / "script.json"
            script_path.write_text(
                json.dumps(
                    {
                        "title": "分镜项目",
                        "episodes": [
                            {
                                "episode": 1,
                                "episode_id": "ep001",
                                "scenes": [
                                    {
                                        "scene_id": "scn_001",
                                        "actions": [{"content": "test action"}],
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            payload_path = draft_dir / "scene_payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scene_id": "scn_001",
                        "shots": [{"id": "scn_001_clip001", "duration": 8, "prompt": "镜头提示词"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            helper = Path(__file__).resolve().parent / "apply_storyboard_result.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(helper),
                    "--project-dir",
                    str(project_dir),
                    "--input-json",
                    str(payload_path),
                ],
                capture_output=True,
                text=True,
                cwd=helper.parent,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}",
            )

            draft_storyboard = output_dir / "storyboard" / "draft" / "ep001_storyboard.json"
            self.assertTrue(draft_storyboard.exists())
            script_data = json.loads(script_path.read_text(encoding="utf-8"))
            scene = script_data["episodes"][0]["scenes"][0]
            self.assertNotIn("shots", scene)
            draft_data = json.loads(draft_storyboard.read_text(encoding="utf-8"))
            self.assertEqual(draft_data["status"], "draft")
            shot = draft_data["scenes"][0]["shots"][0]
            self.assertEqual(shot["prompt"], "镜头提示词")
            self.assertEqual(shot["duration"], 8)
            self.assertEqual(shot["id"], "scn_001_clip001")

            state = json.loads((project_dir / "pipeline-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "STORYBOARD")
            self.assertEqual(state["stages"]["STORYBOARD"]["status"], "partial")
            self.assertEqual(state["episodes"]["ep001"]["storyboard"]["status"], "draft")
            self.assertEqual(
                state["episodes"]["ep001"]["storyboard"]["artifact"],
                "output/storyboard/draft/ep001_storyboard.json",
            )

    def test_apply_storyboard_result_can_finalize_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "script.json").write_text(
                json.dumps(
                    {
                        "title": "分镜项目",
                        "episodes": [
                            {
                                "episode": 1,
                                "episode_id": "ep001",
                                "scenes": [{"scene_id": "scn_001", "actions": []}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            payload_path = project_dir / "draft" / "payload.json"
            payload_path.parent.mkdir(parents=True, exist_ok=True)
            payload_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scene_id": "scn_001",
                        "shots": [{"id": "scn_001_clip001", "duration": 8, "prompt": "镜头提示词"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            helper = Path(__file__).resolve().parent / "apply_storyboard_result.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(helper),
                    "--project-dir",
                    str(project_dir),
                    "--input-json",
                    str(payload_path),
                    "--finalize-stage",
                ],
                capture_output=True,
                text=True,
                cwd=helper.parent,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            approved_path = output_dir / "storyboard" / "approved" / "ep001_storyboard.json"
            self.assertTrue(approved_path.exists())
            state = json.loads((project_dir / "pipeline-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["stages"]["STORYBOARD"]["status"], "validated")
            self.assertEqual(state["next_action"], "enter VIDEO")
            self.assertEqual(
                state["episodes"]["ep001"]["storyboard"]["artifact"],
                "output/storyboard/approved/ep001_storyboard.json",
            )


    def test_finalize_rejects_unresolved_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "script.json").write_text(
                json.dumps(
                    {
                        "episodes": [
                            {
                                "episode": 1,
                                "episode_id": "ep001",
                                "actors": [{"actor_id": "act_001", "states": [{"state_id": "st_001"}]}],
                                "scenes": [{"scene_id": "scn_001", "actions": []}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "actors").mkdir()
            (output_dir / "actors" / "actors.json").write_text(
                json.dumps({"act_001": {"name": "Alice"}}, ensure_ascii=False),
                encoding="utf-8",
            )

            payload_path = project_dir / "draft" / "payload.json"
            payload_path.parent.mkdir(parents=True, exist_ok=True)
            payload_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scene_id": "scn_001",
                        "shots": [
                            {
                                "id": "scn_001_clip001",
                                "duration": 8,
                                "prompt": "@act_001 站立；@act_999 闯入；@loc_404 灯光昏暗",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            helper = Path(__file__).resolve().parent / "apply_storyboard_result.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(helper),
                    "--project-dir",
                    str(project_dir),
                    "--input-json",
                    str(payload_path),
                    "--finalize-stage",
                ],
                capture_output=True,
                text=True,
                cwd=helper.parent,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("@act_999", result.stderr)
            self.assertIn("@loc_404", result.stderr)
            self.assertNotIn("@act_001", result.stderr)
            approved_path = output_dir / "storyboard" / "approved" / "ep001_storyboard.json"
            self.assertFalse(approved_path.exists())

    def test_finalize_rejects_undeclared_state_suffix(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "script.json").write_text(
                json.dumps(
                    {
                        "episodes": [
                            {
                                "episode": 1,
                                "episode_id": "ep001",
                                "actors": [
                                    {
                                        "actor_id": "act_001",
                                        "states": [{"state_id": "st_001"}, {"state_id": "st_002"}],
                                    }
                                ],
                                "scenes": [{"scene_id": "scn_001", "actions": []}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "actors").mkdir()
            (output_dir / "actors" / "actors.json").write_text(
                json.dumps({"act_001": {"name": "Alice"}}, ensure_ascii=False),
                encoding="utf-8",
            )

            payload_path = project_dir / "draft" / "payload.json"
            payload_path.parent.mkdir(parents=True, exist_ok=True)
            payload_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scene_id": "scn_001",
                        "shots": [
                            {
                                "id": "scn_001_clip001",
                                "duration": 8,
                                "prompt": "@act_001:st_002 走入，@act_001:st_777 切换",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            helper = Path(__file__).resolve().parent / "apply_storyboard_result.py"
            result = subprocess.run(
                [sys.executable, str(helper), "--project-dir", str(project_dir),
                 "--input-json", str(payload_path), "--finalize-stage"],
                capture_output=True, text=True, cwd=helper.parent,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("st_777", result.stderr)
            self.assertNotIn(":st_002 ", result.stderr)

    def test_finalize_passes_with_resolved_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "script.json").write_text(
                json.dumps(
                    {
                        "episodes": [
                            {
                                "episode": 1,
                                "episode_id": "ep001",
                                "actors": [
                                    {"actor_id": "act_001", "states": [{"state_id": "st_001"}]}
                                ],
                                "scenes": [{"scene_id": "scn_001", "actions": []}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            for kind, key in [("actors", "act_001"), ("locations", "loc_001"), ("props", "prp_001")]:
                (output_dir / kind).mkdir()
                (output_dir / kind / f"{kind}.json").write_text(
                    json.dumps({key: {"name": kind}}, ensure_ascii=False),
                    encoding="utf-8",
                )

            payload_path = project_dir / "draft" / "payload.json"
            payload_path.parent.mkdir(parents=True, exist_ok=True)
            payload_path.write_text(
                json.dumps(
                    {
                        "episode_id": "ep001",
                        "scene_id": "scn_001",
                        "shots": [
                            {
                                "id": "scn_001_clip001",
                                "duration": 8,
                                "prompt": "@act_001:st_001 在 @loc_001 持 @prp_001",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            helper = Path(__file__).resolve().parent / "apply_storyboard_result.py"
            result = subprocess.run(
                [sys.executable, str(helper), "--project-dir", str(project_dir),
                 "--input-json", str(payload_path), "--finalize-stage"],
                capture_output=True, text=True, cwd=helper.parent,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue((output_dir / "storyboard" / "approved" / "ep001_storyboard.json").exists())


if __name__ == "__main__":
    unittest.main()
