#!/usr/bin/env python3
# input: script-adapt execution entry scripts plus temporary project fixtures
# output: unittest coverage for pipeline-state synchronization in script stage
# pos: regression bridge ensuring real script entrypoints update shared state

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ScriptStagePipelineStateBridgeTest(unittest.TestCase):
    def test_prepare_source_project_initializes_script_stage_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source_path = tmp_path / "source.txt"
            project_dir = tmp_path / "workspace" / "demo"
            source_path.write_text("第一章 测试内容", encoding="utf-8")

            script_path = Path(__file__).resolve().parent / "prepare_source_project.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "--source-path",
                    str(source_path),
                    "--workspace-path",
                    str(project_dir),
                ],
                capture_output=True,
                text=True,
                cwd=script_path.parent,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}",
            )

            state_path = project_dir / "pipeline-state.json"
            self.assertTrue(state_path.exists())

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "SCRIPT")
            self.assertEqual(state["next_action"], "review SCRIPT")
            self.assertEqual(state["stages"]["SCRIPT"]["status"], "running")

    def test_parse_script_validates_and_promotes_script_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            draft_dir = project_dir / "draft"
            episodes_dir = draft_dir / "episodes"
            output_dir = project_dir / "output"
            episodes_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)

            (draft_dir / "design.json").write_text(
                json.dumps(
                    {
                        "title": "测试项目",
                        "style": "modern",
                        "worldview": "现实都市",
                        "bilingual": False,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (draft_dir / "catalog.json").write_text(
                json.dumps(
                    {
                        "actors": [{"id": "act_001", "name": "林夏"}],
                        "locations": [{"id": "loc_001", "name": "客厅"}],
                        "props": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (episodes_dir / "ep001.md").write_text(
                "\n".join(
                    [
                        "# 第1集：开场",
                        "1-1 日 内 客厅",
                        "人物：林夏",
                        "▲林夏站在客厅中央看向窗外",
                        "林夏：我们开始吧。",
                    ]
                ),
                encoding="utf-8",
            )

            script_path = Path(__file__).resolve().parent / "parse_script.py"
            result = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "--project-path",
                    str(project_dir),
                    "--output-path",
                    str(output_dir),
                    "--validate",
                ],
                capture_output=True,
                text=True,
                cwd=script_path.parent,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}",
            )

            state_path = project_dir / "pipeline-state.json"
            self.assertTrue(state_path.exists())
            state = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertEqual(state["current_stage"], "SCRIPT")
            self.assertEqual(state["next_action"], "enter VISUAL")
            self.assertEqual(state["stages"]["SCRIPT"]["status"], "validated")
            self.assertEqual(state["artifacts"]["output/script.json"]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
