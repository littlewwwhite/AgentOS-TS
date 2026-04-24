#!/usr/bin/env python3
# input: asset-gen execution entry functions plus temporary project fixtures
# output: unittest coverage for VISUAL stage pipeline-state synchronization
# pos: regression bridge ensuring asset generation entrypoints update shared state

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class AssetGenPipelineStateBridgeTest(unittest.TestCase):
    def test_style_generate_marks_visual_stage_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            output_dir.mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_json = output_dir / "script.json"
            script_json.write_text(
                json.dumps(
                    {
                        "title": "视觉测试",
                        "worldview": "仙侠",
                        "style": "动漫",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            module = load_module(
                "asset_style_generate",
                Path(__file__).resolve().parent / "style_generate.py",
            )

            class FakeClient:
                class models:
                    @staticmethod
                    def generate_content(model, contents):
                        return SimpleNamespace(
                            text=json.dumps(
                                {
                                    "worldview_type": "仙侠",
                                    "render_prefix": "古风CG",
                                },
                                ensure_ascii=False,
                            )
                        )

            module.create_client = lambda: FakeClient()
            style_path = draft_dir / "style.json"
            module.generate_style(str(script_json), str(style_path), "动漫")

            state = json.loads((project_dir / "pipeline-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "VISUAL")
            self.assertEqual(state["stages"]["VISUAL"]["status"], "partial")
            self.assertEqual(state["next_action"], "review VISUAL")

        # state artifact path should be rooted at draft/style.json
            self.assertEqual(
                state["artifacts"]["draft/style.json"]["status"],
                "completed",
            )

    def test_generate_prompts_marks_visual_stage_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            output_dir.mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_json = output_dir / "script.json"
            script_json.write_text(
                json.dumps(
                    {
                        "title": "提示词测试",
                        "actors": [{"actor_id": "act_001", "actor_name": "林夏"}],
                        "locations": [{"location_id": "loc_001", "location_name": "客厅"}],
                        "props": [{"prop_id": "prp_001", "prop_name": "茶杯"}],
                        "episodes": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (draft_dir / "style.json").write_text(
                json.dumps({"worldview_type": "都市"}, ensure_ascii=False),
                encoding="utf-8",
            )

            module = load_module(
                "asset_generate_prompts",
                Path(__file__).resolve().parent / "generate_prompts_from_script.py",
            )

            result_sets = {
                "actors": {"project": "提示词测试", "actors": []},
                "scenes": {"project": "提示词测试", "scenes": []},
                "props": {"project": "提示词测试", "props": []},
            }

            module._run_parallel = lambda *args, **kwargs: result_sets
            with patch.object(
                module.sys,
                "argv",
                [
                    "generate_prompts_from_script.py",
                    "--script-json",
                    str(script_json),
                    "--workspace",
                    str(draft_dir),
                    "--style-json",
                    str(draft_dir / "style.json"),
                ],
            ):
                module.main()

            state = json.loads((project_dir / "pipeline-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "VISUAL")
            self.assertEqual(state["stages"]["VISUAL"]["status"], "partial")
            self.assertEqual(
                state["artifacts"]["draft/提示词测试_actors_gen.json"]["status"],
                "completed",
            )

    def test_generate_all_assets_marks_visual_stage_completed(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            output_dir = project_dir / "output"
            draft_dir = project_dir / "draft"
            output_dir.mkdir(parents=True, exist_ok=True)
            draft_dir.mkdir(parents=True, exist_ok=True)

            script_json = output_dir / "script.json"
            script_json.write_text(json.dumps({"title": "资产项目"}, ensure_ascii=False), encoding="utf-8")
            (draft_dir / "style.json").write_text("{}", encoding="utf-8")
            for suffix in ("actors", "scenes", "props"):
                (draft_dir / f"资产项目_{suffix}_gen.json").write_text("{}", encoding="utf-8")

            module = load_module(
                "asset_generate_all",
                Path(__file__).resolve().parent / "generate_all_assets.py",
            )

            def fake_run_subprocess(label, script_path, args, timeout=7200):
                if "角色生成" in label:
                    target = output_dir / "actors" / "actors.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("{}", encoding="utf-8")
                elif "场景生成" in label:
                    target = output_dir / "locations" / "locations.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("{}", encoding="utf-8")
                elif "道具生成" in label:
                    target = output_dir / "props" / "props.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("{}", encoding="utf-8")
                return {"success": True, "label": label, "stdout": ""}

            module.run_subprocess = fake_run_subprocess
            module.generate_all_assets(
                str(script_json),
                str(output_dir),
                str(draft_dir),
                characters=True,
                scenes=True,
                props=True,
            )

            state = json.loads((project_dir / "pipeline-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["current_stage"], "VISUAL")
            self.assertEqual(state["stages"]["VISUAL"]["status"], "completed")
            self.assertEqual(state["next_action"], "review VISUAL")
            self.assertEqual(state["artifacts"]["output/actors/actors.json"]["status"], "completed")
            self.assertEqual(state["artifacts"]["output/locations/locations.json"]["status"], "completed")
            self.assertEqual(state["artifacts"]["output/props/props.json"]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
